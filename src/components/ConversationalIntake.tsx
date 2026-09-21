import React, { useRef, useState } from "react";
import type { Id } from "../../convex/_generated/dataModel";
import {
  ActionTimeoutError,
  INTAKE_SAVE_TIMEOUT_MESSAGE,
  INTAKE_SAVE_TIMEOUT_MS,
  withActionTimeout,
} from "../actionSafety";
import type { LocationAllowlist } from "../formatters";
import { normalizeProjectError } from "../projectErrors";
import { AlertTriangleIcon, ArrowRightIcon, BoltIcon, HammerIcon, LeafIcon, LockIcon, PackageIcon, PaletteIcon, SnowflakeIcon, SparklesIcon, ToolsIcon, WrenchIcon } from "./UiIcons";

interface ConversationalIntakeProps {
  initialPrompt?: string;
  initialCategory?: string;
  initialLocation?: {
    country?: string;
    city?: string;
    region?: string;
    locality?: string;
  };
  initialTiming?: string;
  initialBudget?: string;
  /** When set, submitting updates this existing job instead of creating one. */
  editingJobId?: Id<"jobs"> | null;
  onSubmitRequest: (payload: {
    title: string;
    rawIntake: string;
    category: string;
    location: LocationAllowlist;
    timing: string;
    budget?: string;
    clientRequestId: string;
  }) => Promise<void>;
  onCancel: () => void;
}

const CATEGORIES = [
  { id: "electrical", label: "Electrical", icon: BoltIcon },
  { id: "plumbing", label: "Plumbing", icon: WrenchIcon },
  { id: "cleaning", label: "House Cleaning", icon: SparklesIcon },
  { id: "handyman", label: "Handyman", icon: HammerIcon },
  { id: "painting", label: "Painting", icon: PaletteIcon },
  { id: "moving", label: "Moving", icon: PackageIcon },
  { id: "hvac", label: "AC & Heating", icon: SnowflakeIcon },
  { id: "landscaping", label: "Landscaping", icon: LeafIcon },
  { id: "other", label: "Other Project", icon: ToolsIcon },
];

const TIMING_OPTIONS = [
  { id: "asap", label: "Today / Urgently", desc: "Need immediate assistance" },
  { id: "this_week", label: "This week", desc: "Within the next few days" },
  { id: "next_week", label: "Next week", desc: "Planning ahead" },
  { id: "flexible", label: "Flexible", desc: "Whenever the right pro is available" },
];

const COUNTRY_OPTIONS = [
  { value: "", label: "Select country" },
  { value: "Nigeria", label: "Nigeria" },
  { value: "United States", label: "United States" },
  { value: "United Kingdom", label: "United Kingdom" },
  { value: "Canada", label: "Canada" },
  { value: "Germany", label: "Germany" },
  { value: "India", label: "India" },
  { value: "United Arab Emirates", label: "United Arab Emirates" },
  { value: "South Africa", label: "South Africa" },
  { value: "Ghana", label: "Ghana" },
  { value: "Kenya", label: "Kenya" },
  { value: "Other", label: "Other" },
];

function inferCategoryFromPrompt(text: string): string {
  const lowered = text.toLowerCase();
  if (/\b(?:clean|cleaning|maid|janitor|janitorial|housekeep|sweep|mop|deep clean|flat|apartment)\b/i.test(lowered)) return "cleaning";
  if (/\b(?:plumb|plumber|plumbing|pipe|leak|drain|faucet|sink|toilet|clog|tap|water closet)\b/i.test(lowered)) return "plumbing";
  if (/\b(?:electric|electrician|electrical|wiring|outlet|panel|breaker|bulb|switch|light|chandelier)\b/i.test(lowered)) return "electrical";
  if (/\b(?:paint|painter|painting|wall|drywall)\b/i.test(lowered)) return "painting";
  if (/\b(?:move|moving|mover|relocat|haul)\b/i.test(lowered)) return "moving";
  if (/\b(?:hvac|air condition|ac|furnace|heating|cool|vent)\b/i.test(lowered)) return "hvac";
  if (/\b(?:lawn|landscap|garden|yard|mow|tree)\b/i.test(lowered)) return "landscaping";
  if (/\b(?:handyman|fixture|mount|repair|assembly|carpenter)\b/i.test(lowered)) return "handyman";
  return "other";
}

export function ConversationalIntake({
  initialPrompt = "",
  initialCategory = "",
  initialLocation,
  initialTiming,
  initialBudget,
  editingJobId,
  onSubmitRequest,
  onCancel,
}: ConversationalIntakeProps) {
  const isEditing = Boolean(editingJobId);
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [prompt, setPrompt] = useState(initialPrompt);
  const [hasUserSelectedCategory, setHasUserSelectedCategory] = useState(Boolean(initialCategory));
  const [category, setCategory] = useState(() => {
    if (initialCategory) return initialCategory;
    if (initialPrompt) {
      const inferred = inferCategoryFromPrompt(initialPrompt);
      if (inferred && inferred !== "other") return inferred;
    }
    return "other";
  });

  // Location fields (no prefilled defaults: Findor is country-agnostic and
  // must never leak one region's geography into another job).
  const [country, setCountry] = useState(initialLocation?.country || "");
  const [city, setCity] = useState(initialLocation?.city || "");
  const [region, setRegion] = useState(initialLocation?.region || "");
  const [locality, setLocality] = useState(initialLocation?.locality || "");

  // Timing & Budget
  const [timing, setTiming] = useState(initialTiming || "this_week");
  const [budget, setBudget] = useState(initialBudget || "");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [requiresRefresh, setRequiresRefresh] = useState(false);
  const submissionInFlightRef = useRef(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [errorReference, setErrorReference] = useState<string | undefined>(undefined);
  // Idempotency key for one intake submission: retries/double-clicks
  // carrying the same key reuse the original job server-side.
  const [clientRequestId] = useState(
    () =>
      `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`,
  );

  const selectedCategoryObj = CATEGORIES.find((c) => c.id === category) || CATEGORIES[CATEGORIES.length - 1];

  const handlePromptChange = (val: string) => {
    setPrompt(val);
    if (!hasUserSelectedCategory) {
      const inferred = inferCategoryFromPrompt(val);
      if (inferred && inferred !== "other") {
        setCategory(inferred);
      }
    }
  };

  const handleSelectCategory = (catId: string) => {
    setCategory(catId);
    setHasUserSelectedCategory(true);
  };

  const handleStep1Next = (e: React.FormEvent) => {
    e.preventDefault();
    if (!prompt.trim()) return;
    setStep(2);
  };

  const handleStep2Next = (e: React.FormEvent) => {
    e.preventDefault();
    if (!country.trim() || !city.trim()) return;
    setStep(3);
  };

  const handleStep3Next = () => {
    void handleFinalSubmit();
  };

  const handleFinalSubmit = async () => {
    if (isSubmitting || requiresRefresh || submissionInFlightRef.current) return;
    submissionInFlightRef.current = true;
    setIsSubmitting(true);
    setErrorMessage(null);
    setErrorReference(undefined);
    try {
      const generatedTitle =
        prompt.length > 50 ? `${selectedCategoryObj.label}: ${prompt.slice(0, 45)}...` : prompt;

      await withActionTimeout(onSubmitRequest({
        title: generatedTitle,
        rawIntake: prompt,
        category,
        location: {
          country: country.trim(),
          city: city.trim(),
          region: region.trim() || undefined,
          locality: locality.trim() || undefined,
        },
        timing,
        budget: budget.trim() || undefined,
        clientRequestId,
      }), INTAKE_SAVE_TIMEOUT_MS);
    } catch (err) {
      if (err instanceof ActionTimeoutError) {
        setRequiresRefresh(true);
        setErrorMessage(INTAKE_SAVE_TIMEOUT_MESSAGE);
        setErrorReference(undefined);
      } else {
        const normalized = normalizeProjectError(err, "save");
        setErrorMessage(normalized.message);
        setErrorReference(normalized.referenceId);
      }
    } finally {
      submissionInFlightRef.current = false;
      setIsSubmitting(false);
    }
  };

  return (
    <div className="w-full max-w-2xl mx-auto px-4 sm:px-6 py-8">
      {/* Progress Indicator */}
      <div className="mb-8 flex items-center justify-between">
        <div className="flex items-center gap-2">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className={`h-1.5 rounded-full transition-all duration-300 ${
                i === step
                  ? "w-8 bg-emerald-700"
                  : i < step
                  ? "w-4 bg-emerald-300"
                  : "w-4 bg-gray-200"
              }`}
            />
          ))}
        </div>
        <button
          type="button"
          onClick={onCancel}
          className="text-xs text-gray-700 hover:text-gray-900 font-medium"
        >
          Cancel
        </button>
      </div>

      {errorMessage && (
        <div
          role="alert"
          className="mb-6 p-4 rounded-xl bg-red-50 border border-red-200 text-xs text-red-800 flex items-center justify-between gap-2"
        >
          <span className="flex items-center gap-2">
            <AlertTriangleIcon className="w-4 h-4 shrink-0" />
            <span>{errorMessage}</span>
          </span>
          {errorReference && (
            <span className="text-[10px] text-red-400 font-mono tracking-wide shrink-0">
              Ref: {errorReference}
            </span>
          )}
        </div>
      )}

      {/* STEP 1: What do you need help with? */}
      {step === 1 && (
        <form onSubmit={handleStep1Next} className="space-y-6">
          <div className="space-y-2">
            <h1 className="text-2xl sm:text-3xl font-extrabold text-gray-900 tracking-tight">
              What do you need help with?
            </h1>
            <p className="text-sm text-gray-600">
              Describe your problem in your own words. Findor will structure and clarify the details.
            </p>
          </div>

          <div className="space-y-3">
            <div className="rounded-2xl border-2 border-emerald-600/30 focus-within:border-emerald-600 focus-within:ring-4 focus-within:ring-emerald-100 bg-white p-4 shadow-sm transition-all">
              <textarea
                value={prompt}
                onChange={(e) => handlePromptChange(e.target.value)}
                rows={4}
                autoFocus
                placeholder="E.g. Replace bathroom light fixtures this week, or repair a leaking kitchen sink..."
                className="w-full resize-none border-none p-0 text-base text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-0"
              />
            </div>
          </div>

          <div className="space-y-2.5">
            <label className="text-xs font-bold uppercase tracking-wider text-gray-600">
              Select Category
            </label>
            <div className="flex flex-wrap gap-2">
              {CATEGORIES.map((c) => {
                const isSelected = category === c.id;
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => handleSelectCategory(c.id)}
                    className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold transition-all ${
                      isSelected
                        ? "bg-emerald-700 text-white shadow-sm ring-2 ring-emerald-600"
                        : "bg-white border border-gray-200 text-gray-700 hover:border-emerald-600 hover:text-emerald-800"
                    }`}
                  >
                    <c.icon className="w-4 h-4" />
                    <span>{c.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="pt-4 flex justify-end">
            <button
              type="submit"
              disabled={!prompt.trim()}
              className="inline-flex items-center gap-2 px-6 py-3 bg-emerald-700 hover:bg-emerald-800 disabled:bg-gray-200 disabled:text-gray-400 text-white text-sm font-semibold rounded-xl shadow-sm transition-all active:scale-[0.98]"
            >
              <span>Continue</span>
              <ArrowRightIcon className="w-4 h-4" />
            </button>
          </div>
        </form>
      )}

      {/* STEP 2: Location & Timing Clarification */}
      {step === 2 && (
        <form onSubmit={handleStep2Next} className="space-y-6">
          <div className="space-y-2">
            <h1 className="text-2xl sm:text-3xl font-extrabold text-gray-900 tracking-tight">
              Where and when is the work?
            </h1>
            <p className="text-sm text-gray-600">
              Findor uses your general area to discover verified local providers.
            </p>
          </div>

          {/* Privacy Assurance Notice */}
          <div className="p-3.5 rounded-xl bg-emerald-50/80 border border-emerald-200/80 flex items-start gap-3">
            <LockIcon className="w-4 h-4 text-emerald-700 mt-0.5 shrink-0" />
            <div className="text-xs text-emerald-950">
              <span className="font-bold">Privacy protected: </span>
              Exact street addresses and house numbers are strictly withheld during research and exploratory outreach.
            </div>
          </div>

          {/* Location Fields */}
          <div className="space-y-4 bg-white p-5 rounded-2xl border border-gray-200 shadow-sm">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-bold text-gray-700 mb-1">Country</label>
                <select
                  value={country}
                  onChange={(e) => setCountry(e.target.value)}
                  className="w-full px-3 py-2.5 rounded-xl border border-gray-300 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-emerald-600 focus:border-emerald-600 bg-white"
                >
                  {COUNTRY_OPTIONS.map((c) => (
                    <option key={c.value} value={c.value}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-gray-700 mb-1">City</label>
                <input
                  type="text"
                  value={city}
                  onChange={(e) => setCity(e.target.value)}
                  required
                  placeholder="e.g. Brooklyn, New York"
                  className="w-full px-3 py-2.5 rounded-xl border border-gray-300 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-emerald-600 focus:border-emerald-600"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-gray-700 mb-1">State / Region (optional)</label>
                <input
                  type="text"
                  value={region}
                  onChange={(e) => setRegion(e.target.value)}
                  placeholder="e.g. New York, Texas, California"
                  className="w-full px-3 py-2.5 rounded-xl border border-gray-300 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-emerald-600 focus:border-emerald-600"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-gray-700 mb-1">Area / Neighborhood</label>
                <input
                  type="text"
                  value={locality}
                  onChange={(e) => setLocality(e.target.value)}
                  placeholder="e.g. Park Slope, Brooklyn"
                  className="w-full px-3 py-2.5 rounded-xl border border-gray-300 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-emerald-600 focus:border-emerald-600"
                />
              </div>
            </div>
          </div>

          {/* Timing Selection */}
          <div className="space-y-2.5">
            <label className="text-xs font-bold uppercase tracking-wider text-gray-600">
              When do you need this done?
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {TIMING_OPTIONS.map((t) => {
                const isSelected = timing === t.id;
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setTiming(t.id)}
                    className={`p-3 rounded-xl border text-left transition-all ${
                      isSelected
                        ? "bg-emerald-50/70 border-emerald-600 ring-2 ring-emerald-600/30"
                        : "bg-white border-gray-200 hover:border-gray-300"
                    }`}
                  >
                    <div className="text-xs font-bold text-gray-900">{t.label}</div>
                    <div className="text-[11px] text-gray-500 mt-0.5">{t.desc}</div>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="pt-4 flex items-center justify-between">
            <button
              type="button"
              onClick={() => setStep(1)}
              className="px-4 py-2.5 text-xs font-semibold text-gray-600 hover:text-gray-900"
            >
              Back
            </button>
            <button
              type="submit"
              disabled={!country.trim() || !city.trim()}
              className="inline-flex items-center gap-2 px-6 py-3 bg-emerald-700 hover:bg-emerald-800 disabled:bg-gray-200 disabled:text-gray-400 text-white text-sm font-semibold rounded-xl shadow-sm transition-all active:scale-[0.98]"
            >
              <span>Review Summary</span>
              <ArrowRightIcon className="w-4 h-4" />
            </button>
          </div>
        </form>
      )}

      {/* STEP 3: Request Summary & Save (backend truth renders next) */}
      {step === 3 && (
        <div className="space-y-6">
          <div className="space-y-2">
            <h1 className="text-2xl sm:text-3xl font-extrabold text-gray-900 tracking-tight">
              Your request
            </h1>
            <p className="text-sm text-gray-600">
              {isEditing
                ? "Review your updated details. Findor will re-check what is still needed."
                : "Review your project details. Findor will prepare your standardized brief next."}
            </p>
          </div>

          <div className="rounded-2xl bg-white border border-gray-200 p-6 shadow-sm space-y-5">
            <div className="flex items-start justify-between border-b border-gray-100 pb-4">
              <div>
                <span className="text-xs font-semibold text-emerald-700 uppercase tracking-wider">
                  {selectedCategoryObj.label}
                </span>
                <h3 className="text-lg font-bold text-gray-900 mt-0.5">
                  {locality ? `${locality}, ` : ""}{city}, {country}
                </h3>
              </div>
              <button
                onClick={() => setStep(1)}
                disabled={isSubmitting || requiresRefresh}
                className="text-xs font-semibold text-emerald-700 hover:text-emerald-800 hover:underline"
              >
                Edit
              </button>
            </div>

            <div className="space-y-2">
              <h4 className="text-xs font-bold text-gray-600 uppercase tracking-wider">Description</h4>
              <p className="text-sm text-gray-800 leading-relaxed bg-stone-50 p-3.5 rounded-xl border border-stone-200/60">
                {prompt}
              </p>
            </div>

            <div className="grid grid-cols-2 gap-4 pt-1">
              <div>
                <span className="text-xs font-medium text-gray-600 block">Target Timing</span>
                <span className="text-xs font-bold text-gray-900 mt-0.5 block">
                  {TIMING_OPTIONS.find((t) => t.id === timing)?.label || timing}
                </span>
              </div>
              <div>
                <span className="text-xs font-medium text-gray-600 block">Budget (Optional)</span>
                <input
                  type="text"
                  value={budget}
                  onChange={(e) => setBudget(e.target.value)}
                  disabled={isSubmitting || requiresRefresh}
                  placeholder="e.g. $500 or Flexible"
                  className="mt-1 w-full px-2.5 py-1.5 rounded-lg border border-gray-300 text-xs text-gray-900 focus:outline-none focus:ring-1 focus:ring-emerald-600"
                />
              </div>
            </div>
          </div>

          <div className="pt-4 flex items-center justify-between">
            <button
              type="button"
              onClick={() => setStep(2)}
              disabled={isSubmitting || requiresRefresh}
              className="px-4 py-2.5 text-xs font-semibold text-gray-600 hover:text-gray-900"
            >
              Back
            </button>
            <button
              type="button"
              onClick={handleStep3Next}
              disabled={isSubmitting || requiresRefresh || !prompt.trim()}
              className="inline-flex items-center gap-2 px-6 py-3 bg-emerald-700 hover:bg-emerald-800 disabled:bg-gray-300 text-white text-sm font-semibold rounded-xl shadow-sm transition-all active:scale-[0.98]"
            >
              {isSubmitting ? (
                <>
                  <span className="w-4 h-4 rounded-full border-2 border-white border-t-transparent animate-spin" />
                  <span>Saving...</span>
                </>
              ) : (
                <>
                  <span>{isEditing ? "Save details" : "Continue to review"}</span>
                  <ArrowRightIcon className="w-4 h-4" />
                </>
              )}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
