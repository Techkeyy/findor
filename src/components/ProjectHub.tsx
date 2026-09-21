import { useState } from "react";
import type { Doc, Id } from "../../convex/_generated/dataModel";
import { formatEnumLabel, formatTimingLabel } from "../formatters";
import { resolveConsumerProjectState } from "../projectState";
import { normalizeProjectError } from "../projectErrors";
import {
  countContactedProviders,
  countContactedProvidersInCycle,
} from "../outreachLedger";
import { resolveBusinessDisplay } from "../providerDisplay";
import {
  ArrowLeftIcon,
  CheckIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  ClipboardIcon,
  ExternalLinkIcon,
  LoaderIcon,
  MailIcon,
  XIcon,
} from "./UiIcons";

interface CandidateItem {
  _id: Id<"providerCandidates">;
  _creationTime: number;
  jobId: Id<"jobs">;
  ownerId: Id<"users">;
  cycleId?: Id<"jobCycles">;
  name: string;
  url: string;
  description: string;
  entityType?: "provider" | "discovery_source";
  contactability: "email_found" | "website_only";
  contactEmail?: string;
  contactDiscoveryStatus?: "unresolved" | "resolved" | "failed";
  evidence?: Array<{ sourceUrl: string; claim: string }>;
}

interface OutreachItem {
  _id: Id<"outreachMessages">;
  _creationTime: number;
  jobId: Id<"jobs">;
  ownerId: Id<"users">;
  candidateId: Id<"providerCandidates">;
  cycleId?: Id<"jobCycles">;
  status: "approved" | "sending" | "sent" | "delivery_failed" | "failed";
  purpose?: "initial" | "routine_clarification" | "follow_up";
  providerEmail: string;
  subject: string;
  body: string;
}

interface InboundConversationItem {
  message: Doc<"inboundMessages">;
  attachments: Array<Doc<"inboundAttachments">>;
  response: Doc<"providerResponses"> | null;
}

interface JobEventItem {
  _id: Id<"jobEvents">;
  eventType: string;
  message?: string;
  _creationTime: number;
}

export interface RecoveryMandate {
  quoteTarget?: 1 | 2 | 3;
  responseWindowHours?: 1 | 3 | 6 | 12 | 24;
  continuousRecovery?: boolean;
}

export interface ContinuousRecoverySettings {
  enabled: boolean;
  quoteTarget?: 1 | 2 | 3;
  responseWindowHours?: 1 | 3 | 6 | 12 | 24;
}

interface ProjectHubProps {
  job: Doc<"jobs">;
  briefDoc?: Doc<"briefVersions"> | null;
  candidates: CandidateItem[];
  outreachMessages: OutreachItem[];
  conversations: InboundConversationItem[];
  events: JobEventItem[];
  onApproveBrief: (mandate?: RecoveryMandate) => Promise<void>;
  onStartResearch: () => Promise<void>;
  onSetContinuousRecovery?: (settings: ContinuousRecoverySettings) => Promise<void>;
  onEditBrief: () => void;
  onPauseJob: () => Promise<void>;
  onResumeJob: () => Promise<void>;
  onCancelJob: () => Promise<void>;
  onCompleteJob: () => Promise<void>;
  onRetryCycle: () => Promise<void>;
  onSelectProvider?: (candidateId: Id<"providerCandidates">) => Promise<void>;
  onSetContinuationMode?: (mode: "findor_assisted" | "user_takeover") => Promise<void>;
  onClearSelectedProvider?: () => Promise<void>;
  onAskProviderQuestion?: (
    question: string,
    forceApprove?: boolean,
  ) => Promise<{ status: "sent" | "needs_approval"; reason?: string; question: string }>;
  onBackToProjects: () => void;
  onStartNewRequest: () => void;
}

const QUOTE_TARGET_OPTIONS: Array<1 | 2 | 3> = [1, 2, 3];
const RESPONSE_WINDOW_OPTIONS: Array<1 | 3 | 6 | 12 | 24> = [1, 3, 6, 12, 24];

function windowLabel(hours: 1 | 3 | 6 | 12 | 24): string {
  return hours === 1 ? "1 hr" : `${hours} hrs`;
}

function RecoveryMandateControls(props: {
  quoteTarget: 1 | 2 | 3;
  windowHours: 1 | 3 | 6 | 12 | 24;
  autoSearch: boolean;
  disabled?: boolean;
  onQuoteTarget: (value: 1 | 2 | 3) => void;
  onWindowHours: (value: 1 | 3 | 6 | 12 | 24) => void;
  onAutoSearch: (value: boolean) => void;
}) {
  return (
    <div className="space-y-4 p-4 rounded-xl bg-stone-50 border border-stone-200">
      <div className="space-y-2">
        <span className="text-xs font-bold text-gray-900 block">
          How many quotes would you like?
        </span>
        <div className="flex items-center gap-2">
          {QUOTE_TARGET_OPTIONS.map((n) => (
            <button
              key={n}
              type="button"
              disabled={props.disabled}
              onClick={() => props.onQuoteTarget(n)}
              className={`w-11 h-11 rounded-xl text-sm font-bold transition-all ${
                props.quoteTarget === n
                  ? "bg-emerald-700 text-white shadow-sm"
                  : "bg-white border border-gray-300 text-gray-700 hover:border-emerald-600"
              }`}
            >
              {n}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-2">
        <span className="text-xs font-bold text-gray-900 block">
          How long should Findor wait before trying new providers?
        </span>
        <div className="flex flex-wrap items-center gap-2">
          {RESPONSE_WINDOW_OPTIONS.map((h) => (
            <button
              key={h}
              type="button"
              disabled={props.disabled}
              onClick={() => props.onWindowHours(h)}
              className={`px-3.5 py-2 rounded-xl text-xs font-bold transition-all ${
                props.windowHours === h
                  ? "bg-emerald-700 text-white shadow-sm"
                  : "bg-white border border-gray-300 text-gray-700 hover:border-emerald-600"
              }`}
            >
              {windowLabel(h)}
            </button>
          ))}
        </div>
      </div>

      <label className="flex items-start gap-2.5 cursor-pointer">
        <input
          type="checkbox"
          checked={props.autoSearch}
          disabled={props.disabled}
          onChange={(e) => props.onAutoSearch(e.target.checked)}
          className="mt-0.5 w-4 h-4 rounded accent-emerald-700"
        />
        <span className="text-xs text-gray-700 leading-relaxed">
          <span className="font-bold">Keep looking automatically</span> until I
          have enough quotes or I stop Findor. Each provider is contacted at
          most once, with at most one follow-up.
        </span>
      </label>
    </div>
  );
}

export function ProjectHub({
  job,
  briefDoc,
  candidates,
  outreachMessages,
  conversations,
  events,
  onApproveBrief,
  onStartResearch,
  onSetContinuousRecovery,
  onEditBrief,
  onPauseJob,
  onResumeJob,
  onCancelJob,
  onCompleteJob,
  onRetryCycle,
  onSelectProvider,
  onSetContinuationMode,
  onClearSelectedProvider,
  onAskProviderQuestion,
  onBackToProjects,
  onStartNewRequest,
}: ProjectHubProps) {
  const [showActivityDrawer, setShowActivityDrawer] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const [selectedResponseModal, setSelectedResponseModal] = useState<Doc<"providerResponses"> | null>(null);
  const [isRetryModalOpen, setIsRetryModalOpen] = useState(false);
  const [isCancelModalOpen, setIsCancelModalOpen] = useState(false);
  const [isActionLoading, setIsActionLoading] = useState(false);
  const [actionError, setActionError] = useState<{
    message: string;
    referenceId?: string;
  } | null>(null);

  // Question / Clarification State
  const [customQuestion, setCustomQuestion] = useState("");
  const [questionFeedback, setQuestionFeedback] = useState<string | null>(null);
  const [consequentialApproval, setConsequentialApproval] = useState<{
    question: string;
    reason: string;
  } | null>(null);
  const [isSendingQuestion, setIsSendingQuestion] = useState(false);
  const [copyFeedback, setCopyFeedback] = useState(false);

  const verifiedResponses = conversations
    .map((c) => c.response)
    .filter((r): r is Doc<"providerResponses"> => r !== null);

  const consumerState = resolveConsumerProjectState(job, {
    candidates,
    responses: verifiedResponses,
    outreachMessages,
  });

  const isPaused = consumerState === "paused";
  const isCompleted = consumerState === "completed";
  const isCancelled = consumerState === "cancelled";

  const loc = job.structuredLocation;
  const locationStr =
    loc?.city && loc?.country
      ? `${loc.locality ? loc.locality + ", " : ""}${loc.city}, ${loc.country}`
      : job.serviceLocation || "Location unspecified";

  // Filter candidates for display: actual providers vs discovery evidence
  const actualProviders = candidates.filter((c) => c.entityType === "provider");
  const discoverySources = candidates.filter((c) => c.entityType === "discovery_source" || !c.entityType);

  // Truthful contacted-providers count: distinct sent initials across the job.
  const contactedCount = countContactedProviders(outreachMessages);
  const latestCycleContactedCount = countContactedProvidersInCycle(
    outreachMessages,
    job.currentCycleId,
  );
  const contactedCopy =
    contactedCount === 1
      ? "1 provider contacted so far."
      : `${contactedCount} providers contacted so far.`;

  // Continuous quote-recovery mandate state (explicit owner authorization).
  const continuousOn = job.autonomy?.continuousRecoveryEnabled === true;
  const quoteTarget: 1 | 2 | 3 =
    job.autonomy?.quoteTarget === 1 || job.autonomy?.quoteTarget === 2 || job.autonomy?.quoteTarget === 3
      ? job.autonomy.quoteTarget
      : 3;
  // Client mirror of the backend usable-quote rule (convex/jobs.ts
  // isUsableQuoteResponse): kinds ack/decline/needs_information and
  // priceless availability never count toward the target.
  const usableQuotes = verifiedResponses.filter((r) => {
    if (r.kind === "quote") return true;
    const hasPrice =
      (r.headlinePrice ?? "").trim().length > 0 ||
      r.priceMin != null ||
      r.priceMax != null;
    return hasPrice && (r.kind === "mixed" || r.kind === "availability");
  });
  const usableCount = usableQuotes.length;
  const targetOpen = usableCount < quoteTarget;

  // Approval-card draft mandate (reset when switching projects).
  const [mandateJobId, setMandateJobId] = useState(job._id);
  const [draftQuoteTarget, setDraftQuoteTarget] = useState<1 | 2 | 3>(quoteTarget);
  const [draftWindowHours, setDraftWindowHours] = useState<1 | 3 | 6 | 12 | 24>(
    job.autonomy?.responseWindowHours === 1 ||
      job.autonomy?.responseWindowHours === 3 ||
      job.autonomy?.responseWindowHours === 6 ||
      job.autonomy?.responseWindowHours === 12 ||
      job.autonomy?.responseWindowHours === 24
      ? job.autonomy.responseWindowHours
      : 24,
  );
  const [draftAutoSearch, setDraftAutoSearch] = useState(continuousOn);
  const [isRecoverySettingsOpen, setIsRecoverySettingsOpen] = useState(false);
  if (mandateJobId !== job._id) {
    setMandateJobId(job._id);
    setDraftQuoteTarget(quoteTarget);
    setDraftWindowHours(
      job.autonomy?.responseWindowHours === 1 ||
        job.autonomy?.responseWindowHours === 3 ||
        job.autonomy?.responseWindowHours === 6 ||
        job.autonomy?.responseWindowHours === 12 ||
        job.autonomy?.responseWindowHours === 24
        ? job.autonomy.responseWindowHours
        : 24,
    );
    setDraftAutoSearch(continuousOn);
  }

  // Persisted recovery deadline display (pure: absolute time only, no live
  // countdown). Rendered directly so SSR and tests see the same copy.
  function formatRecoveryDeadline(deadline: number | null | undefined): string | null {
    if (!deadline) return null;
    return new Date(deadline).toLocaleString(undefined, {
      weekday: "short",
      hour: "numeric",
      minute: "2-digit",
    });
  }
  const recoveryDeadlineText = continuousOn
    ? formatRecoveryDeadline(job.nextRecoveryAt)
    : null;

  const selectedCandidate = job.selectedCandidateId
    ? candidates.find((c) => c._id === job.selectedCandidateId)
    : null;
  // Resolved business display (non-destructive): article-shaped rows show
  // the evidence-backed business identity instead of the article title.
  const selectedDisplay = selectedCandidate
    ? resolveBusinessDisplay(selectedCandidate)
    : null;
  const providerCardDisplay = actualProviders[0]
    ? resolveBusinessDisplay(actualProviders[0])
    : null;
  const selectedResponse = selectedCandidate
    ? verifiedResponses.find((r) => r.providerId === selectedCandidate._id)
    : null;

  const handleAction = async (action: () => Promise<void>) => {
    setIsActionLoading(true);
    setActionError(null);
    try {
      await action();
    } catch (err) {
      // Never surface raw backend exceptions; render normalized consumer copy.
      const normalized = normalizeProjectError(err);
      setActionError({
        message: normalized.message,
        referenceId: normalized.referenceId,
      });
    } finally {
      setIsActionLoading(false);
    }
  };

  const handleSendQuestion = async (questionText: string, forceApprove = false) => {
    if (!onAskProviderQuestion || !questionText.trim()) return;
    setIsSendingQuestion(true);
    setQuestionFeedback(null);
    try {
      const res = await onAskProviderQuestion(questionText, forceApprove);
      if (res.status === "needs_approval") {
        setConsequentialApproval({
          question: res.question,
          reason: res.reason || "This inquiry requires your explicit confirmation before sending.",
        });
      } else {
        setConsequentialApproval(null);
        setCustomQuestion("");
        setQuestionFeedback(`Question sent: "${questionText}"`);
        setTimeout(() => setQuestionFeedback(null), 5000);
      }
    } catch (err) {
      const normalized = normalizeProjectError(err, "question");
      setQuestionFeedback(normalized.message);
    } finally {
      setIsSendingQuestion(false);
    }
  };

  const handleCopySummary = async () => {
    if (!selectedCandidate) return;
    const display = resolveBusinessDisplay(selectedCandidate);
    const priceText = selectedResponse?.headlinePrice || "Estimate provided";
    const availText = selectedResponse?.availability || "Flexible";
    const includedText = selectedResponse?.included?.length
      ? selectedResponse.included.join(", ")
      : "Not specified";
    const excludedText = selectedResponse?.excluded?.length
      ? selectedResponse.excluded.join(", ")
      : "None listed";
    const emailText = selectedCandidate.contactEmail || "None stored";

    const textToCopy = [
      `FINDOR PROJECT SUMMARY: ${job.jobTitle}`,
      `Provider: ${display.name}`,
      `Location: ${locationStr}`,
      `Quote: ${priceText}`,
      `Availability: ${availText}`,
      `Included: ${includedText}`,
      `Excluded: ${excludedText}`,
      `Verified Contact: ${emailText}`,
      display.url ? `Website: ${display.url}` : "",
      "",
      `Conversation Excerpt:`,
      `"${selectedResponse?.evidenceText || selectedResponse?.summary || ""}"`,
    ]
      .filter(Boolean)
      .join("\n");

    try {
      await navigator.clipboard.writeText(textToCopy);
      setCopyFeedback(true);
      setTimeout(() => setCopyFeedback(false), 3000);
    } catch {
      // Fallback
      setCopyFeedback(true);
      setTimeout(() => setCopyFeedback(false), 3000);
    }
  };

  return (
    <div className="w-full max-w-4xl mx-auto px-4 sm:px-6 py-6 sm:py-10 space-y-8">
      {/* 1. Top Breadcrumb & Controls Bar */}
      <div className="flex items-center justify-between">
        <button
          onClick={onBackToProjects}
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-gray-600 hover:text-gray-900 transition-colors"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
          <span>All projects</span>
        </button>

        {/* Project Controls */}
        <div className="flex items-center gap-2">
          {isPaused ? (
            <button
              onClick={() => {
                void handleAction(onResumeJob);
              }}
              disabled={isActionLoading}
              className="px-3 py-1.5 bg-emerald-800 hover:bg-emerald-900 text-white text-xs font-semibold rounded-lg shadow-sm transition-all"
            >
              Resume
            </button>
          ) : !isCompleted && !isCancelled ? (
            <button
              onClick={() => {
                void handleAction(onPauseJob);
              }}
              disabled={isActionLoading}
              className="px-3 py-1.5 bg-white hover:bg-gray-50 text-gray-700 text-xs font-semibold rounded-lg border border-gray-200 transition-all"
            >
              Pause
            </button>
          ) : null}

          {!isCompleted && !isCancelled && (
            <>
              <button
                onClick={() => {
                  void handleAction(onCompleteJob);
                }}
                disabled={isActionLoading}
                className="px-3 py-1.5 bg-white hover:bg-gray-50 text-gray-700 text-xs font-semibold rounded-lg border border-gray-200 transition-all"
              >
                Mark done
              </button>
              <button
                onClick={() => setIsCancelModalOpen(true)}
                disabled={isActionLoading}
                className="px-3 py-1.5 bg-white hover:bg-red-50 text-red-700 text-xs font-semibold rounded-lg border border-red-200 transition-all"
              >
                Cancel project
              </button>
            </>
          )}

          <button
            onClick={() => setShowActivityDrawer(true)}
            className="px-3 py-1.5 bg-white hover:bg-stone-50 text-gray-600 text-xs font-semibold rounded-lg border border-gray-200 transition-all"
          >
            Activity
          </button>
        </div>
      </div>

      {/* 2. Project Header */}
      <div className="space-y-1.5 border-b border-gray-100 pb-6">
        <h1 className="text-2xl sm:text-3xl font-extrabold text-gray-900 tracking-tight">
          {job.jobTitle || "Project Overview"}
        </h1>
        <p className="text-xs sm:text-sm text-gray-600">
          {locationStr} · {formatTimingLabel(job.desiredTiming)}
        </p>
      </div>

      {/* 3. DOMINANT CURRENT STATE SECTION */}

      {/* Normalized action feedback (never raw backend errors) */}
      {actionError && (
        <div className="rounded-2xl bg-red-50 border border-red-200 p-4 sm:p-5 shadow-sm flex items-center justify-between gap-3">
          <p className="text-xs text-red-900 font-medium">{actionError.message}</p>
          {actionError.referenceId && (
            <span className="text-[10px] text-red-400 font-mono tracking-wide shrink-0">
              Ref: {actionError.referenceId}
            </span>
          )}
        </div>
      )}

      {/* A. NEEDS DETAILS (needs_info / brief missing details) */}
      {consumerState === "needs_details" && (
        <div className="rounded-2xl bg-white border-2 border-amber-500/30 p-6 sm:p-8 shadow-sm space-y-5">
          <div className="space-y-1">
            <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-amber-50 text-amber-900 border border-amber-200 text-xs font-semibold">
              <span>A few details needed</span>
            </div>
            <h2 className="text-xl font-bold text-gray-900">
              A few details needed to complete your brief
            </h2>
            <p className="text-xs text-gray-600">
              Findor needs a bit more information before finding verified local providers.
            </p>
          </div>

          {job.missingFields && job.missingFields.length > 0 && (
            <div className="p-4 rounded-xl bg-amber-50/50 border border-amber-200/80 space-y-2 text-xs text-amber-950">
              <span className="font-bold">Missing details:</span>
              <ul className="list-disc list-inside space-y-1 text-amber-900">
                {job.missingFields.map((info: string, idx: number) => (
                  <li key={idx}>{info}</li>
                ))}
              </ul>
            </div>
          )}

          <div className="flex items-center gap-3 pt-2">
            <button
              onClick={onEditBrief}
              className="px-6 py-3 bg-emerald-800 hover:bg-emerald-900 text-white text-sm font-bold rounded-xl shadow-sm transition-all"
            >
              Provide details
            </button>
            <button
              onClick={onStartNewRequest}
              className="px-4 py-3 bg-white hover:bg-stone-50 text-gray-700 text-xs font-semibold rounded-xl border border-gray-300 transition-all"
            >
              Start new request
            </button>
          </div>
        </div>
      )}

      {/* B. READY FOR REVIEW (brief_ready) */}
      {consumerState === "ready_for_review" && (
        <div className="rounded-2xl bg-white border-2 border-emerald-600/30 p-6 sm:p-8 shadow-sm space-y-5">
          <div className="space-y-1">
            <h2 className="text-xl font-bold text-gray-900">
              Review project summary & start search
            </h2>
            <p className="text-xs text-gray-600">
              Confirm your requirements below so Findor can begin discovering local pros.
            </p>
          </div>

          <div className="p-4 rounded-xl bg-stone-50 border border-stone-200 space-y-2 text-xs text-gray-800">
            <p><span className="font-bold">Summary: </span>{briefDoc?.brief.projectSummary || job.brief?.projectSummary || job.jobTitle}</p>
            <p><span className="font-bold">Location: </span>{locationStr}</p>
            <p><span className="font-bold">Timing: </span>{formatTimingLabel(job.desiredTiming)}</p>
          </div>

          <RecoveryMandateControls
            quoteTarget={draftQuoteTarget}
            windowHours={draftWindowHours}
            autoSearch={draftAutoSearch}
            disabled={isActionLoading || isPaused}
            onQuoteTarget={setDraftQuoteTarget}
            onWindowHours={setDraftWindowHours}
            onAutoSearch={setDraftAutoSearch}
          />

          <div className="flex items-center gap-3 pt-2">
            <button
              onClick={() => {
                void handleAction(() =>
                  onApproveBrief({
                    quoteTarget: draftQuoteTarget,
                    responseWindowHours: draftWindowHours,
                    continuousRecovery: onSetContinuousRecovery ? draftAutoSearch : undefined,
                  }),
                );
              }}
              disabled={isActionLoading || isPaused || !job.brief}
              className="px-6 py-3 bg-emerald-800 hover:bg-emerald-900 disabled:bg-gray-200 text-white text-sm font-bold rounded-xl shadow-sm transition-all"
            >
              Approve & start search
            </button>
            <button
              onClick={onEditBrief}
              className="px-4 py-3 bg-white hover:bg-stone-50 text-gray-700 text-xs font-semibold rounded-xl border border-gray-300 transition-all"
            >
              Edit details
            </button>
          </div>
        </div>
      )}

      {/* C. READY TO SEARCH (brief_approved) */}
      {consumerState === "ready_to_search" && (
        <div className="rounded-2xl bg-white border-2 border-emerald-600/30 p-6 sm:p-8 shadow-sm space-y-5">
          <div className="space-y-1">
            <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-emerald-50 text-emerald-800 text-xs font-semibold">
              <CheckIcon className="w-4 h-4" />
              <span>Requirements & permissions confirmed</span>
            </div>
            <h2 className="text-xl font-bold text-gray-900">
              Ready to find providers
            </h2>
            <p className="text-xs text-gray-600">
              Your request and permissions are confirmed. Click below to begin discovering verified local pros.
            </p>
          </div>

          <div className="p-4 rounded-xl bg-stone-50 border border-stone-200 space-y-2 text-xs text-gray-800">
            <p><span className="font-bold">Project: </span>{briefDoc?.brief.projectSummary || job.brief?.projectSummary || job.jobTitle}</p>
            <p><span className="font-bold">Service Area: </span>{locationStr}</p>
            <p><span className="font-bold">Operating Limits: </span>Up to {job.autonomy?.maxProviders ?? 3} providers · 1 follow-up · Private address withheld</p>
          </div>

          <div className="flex items-center gap-3 pt-2">
            <button
              onClick={() => {
                void handleAction(onStartResearch);
              }}
              disabled={isActionLoading || isPaused}
              className="px-6 py-3 bg-emerald-800 hover:bg-emerald-900 disabled:bg-gray-200 text-white text-sm font-bold rounded-xl shadow-sm transition-all flex items-center gap-2"
            >
              {isActionLoading && <LoaderIcon className="w-4 h-4 animate-spin" />}
              <span>Start finding providers</span>
            </button>
            <button
              onClick={onEditBrief}
              className="px-4 py-3 bg-white hover:bg-stone-50 text-gray-700 text-xs font-semibold rounded-xl border border-gray-300 transition-all"
            >
              Edit details
            </button>
          </div>
        </div>
      )}

      {/* D. RESEARCH IN PROGRESS */}
      {consumerState === "researching" && (
        <div className="rounded-2xl bg-white border border-emerald-200 p-6 sm:p-8 shadow-sm space-y-4">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-emerald-100 text-emerald-800 flex items-center justify-center text-lg animate-spin">
              <LoaderIcon className="w-5 h-5 animate-spin" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-gray-900">
                Finding suitable local providers
              </h2>
              <p className="text-xs text-gray-500">
                Checking public websites and verified business contacts in {locationStr}...
              </p>
            </div>
          </div>
        </div>
      )}

      {/* E. PROVIDERS READY */}
      {consumerState === "providers_ready" && (
        <div className="rounded-2xl bg-white border border-emerald-200 p-6 sm:p-8 shadow-sm space-y-4">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-emerald-50 text-emerald-800 flex items-center justify-center text-lg">
              <ClipboardIcon className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-gray-900">
                Providers identified · Preparing outreach
              </h2>
              <p className="text-xs text-gray-500">
                {actualProviders.length} local provider{actualProviders.length === 1 ? "" : "s"} identified. Findor is preparing introductory inquiries.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* F. OUTREACH IN FLIGHT */}
      {consumerState === "outreach_in_flight" && (
        <div className="rounded-2xl bg-white border border-blue-200 p-6 sm:p-8 shadow-sm space-y-4">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-blue-50 text-blue-700 flex items-center justify-center text-lg animate-pulse">
              <MailIcon className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-gray-900">
                Outreach approved · Sending inquiries
              </h2>
              <p className="text-xs text-gray-500">
                Inquiries are being dispatched to verified local providers in {locationStr}.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* G. WAITING FOR REPLIES */}
      {consumerState === "waiting_for_replies" && (
        <div className="rounded-2xl bg-white border border-blue-200 p-6 sm:p-8 shadow-sm space-y-4">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-blue-50 text-blue-700 flex items-center justify-center text-lg">
              <MailIcon className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-gray-900">
                Inquiries sent · Waiting for provider replies
              </h2>
              <p className="text-xs text-gray-500">
                {contactedCopy} Responses will appear here as they arrive.
              </p>
            </div>
          </div>

          {continuousOn ? (
            <div className="p-4 rounded-xl bg-blue-50/60 border border-blue-200/70 space-y-3">
              <p className="text-xs text-gray-800">
                <span className="font-bold">
                  {`${usableCount} of ${quoteTarget} quotes received.`}
                </span>{" "}
                {targetOpen && recoveryDeadlineText
                  ? `If we still don't have enough quotes, Findor will look for another batch after ${recoveryDeadlineText}.`
                  : null}
              </p>
              <p className="text-xs text-gray-600">
                {latestCycleContactedCount} new providers contacted in the latest search.
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  onClick={() => {
                    setDraftQuoteTarget(quoteTarget);
                    setDraftWindowHours(
                      job.autonomy?.responseWindowHours === 1 ||
                        job.autonomy?.responseWindowHours === 3 ||
                        job.autonomy?.responseWindowHours === 6 ||
                        job.autonomy?.responseWindowHours === 12 ||
                        job.autonomy?.responseWindowHours === 24
                        ? job.autonomy.responseWindowHours
                        : 24,
                    );
                    setDraftAutoSearch(true);
                    setIsRecoverySettingsOpen(true);
                  }}
                  disabled={isActionLoading}
                  className="px-4 py-2 bg-white hover:bg-stone-50 text-gray-800 text-xs font-semibold rounded-xl border border-gray-300 transition-all"
                >
                  Change wait time
                </button>
                {onSetContinuousRecovery && (
                  <button
                    onClick={() => {
                      void handleAction(() =>
                        onSetContinuousRecovery({ enabled: false }),
                      );
                    }}
                    disabled={isActionLoading}
                    className="px-4 py-2 bg-white hover:bg-red-50 text-red-700 text-xs font-semibold rounded-xl border border-red-200 transition-all"
                  >
                    Stop automatic searching
                  </button>
                )}
              </div>
            </div>
          ) : (
            onSetContinuousRecovery && (
              <div className="flex flex-wrap items-center gap-2">
                <button
                  onClick={() => {
                    setDraftQuoteTarget(quoteTarget);
                    setDraftWindowHours(24);
                    setDraftAutoSearch(true);
                    setIsRecoverySettingsOpen(true);
                  }}
                  disabled={isActionLoading}
                  className="px-5 py-2.5 bg-emerald-800 hover:bg-emerald-900 disabled:bg-gray-200 text-white text-xs font-bold rounded-xl shadow-sm transition-all"
                >
                  Keep looking for more options
                </button>
              </div>
            )
          )}
        </div>
      )}

      {/* H. NEEDS DECISION / ZERO-RESULT OUTCOME / FAILURE */}
      {consumerState === "needs_decision" && (
        <section className="space-y-6">
          <div className="rounded-2xl bg-white border border-gray-200 p-6 sm:p-8 shadow-sm space-y-6">
            <div className="space-y-2">
              <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-bold bg-amber-50 text-amber-900 border border-amber-200">
                Needs your decision
              </span>
              <h2 className="text-xl sm:text-2xl font-bold text-gray-900">
                {candidates.length === 0 && job.autonomyStopReason && !job.autonomyStopReason.includes("No contactable")
                  ? "Research paused"
                  : "No contactable providers found"}
              </h2>
              <p className="text-sm text-gray-600 leading-relaxed max-w-2xl">
                {job.autonomyStopReason ? (
                  job.autonomyStopReason
                ) : actualProviders.length > 0 ? (
                  `Findor checked ${candidates.length} source${candidates.length === 1 ? "" : "s"} and identified ${actualProviders.length} potential provider${actualProviders.length === 1 ? "" : "s"}, but none published a verified business email address, so nobody was contacted.`
                ) : candidates.length > 0 ? (
                  `Findor checked ${candidates.length} source${candidates.length === 1 ? "" : "s"} but did not find a provider with a verified public business email address.`
                ) : (
                  `Findor searched for verified local ${job.serviceCategory || "service"} providers in ${locationStr}, but no matching providers with public contact routes were found for this attempt.`
                )}
              </p>
            </div>

            {/* Primary Recovery Actions */}
            <div className="flex flex-wrap items-center gap-3 pt-2">
              <button
                onClick={() => setIsRetryModalOpen(true)}
                disabled={isActionLoading}
                className="px-5 py-2.5 bg-emerald-800 hover:bg-emerald-900 disabled:bg-gray-200 text-white text-sm font-bold rounded-xl shadow-sm transition-all"
              >
                Try again
              </button>
              <button
                onClick={onEditBrief}
                className="px-4 py-2.5 bg-white hover:bg-stone-50 text-gray-800 text-sm font-semibold rounded-xl border border-gray-300 transition-all"
              >
                Update request
              </button>
              <button
                onClick={onStartNewRequest}
                className="px-4 py-2.5 text-xs font-semibold text-gray-600 hover:text-gray-900 transition-all"
              >
                Start new request
              </button>
            </div>

            {/* Continuous recovery status / opt-in (no new attempt without explicit approval) */}
            {continuousOn ? (
              <div className="p-4 rounded-xl bg-blue-50/60 border border-blue-200/70 space-y-2">
                <p className="text-xs text-gray-800">
                  <span className="font-bold">Findor is still watching for replies.</span>{" "}
                  {targetOpen && recoveryDeadlineText
                    ? `If there still aren't enough quotes, Findor will look for another batch after ${recoveryDeadlineText}.`
                    : null}
                </p>
                {onSetContinuousRecovery && (
                  <button
                    onClick={() => {
                      void handleAction(() =>
                        onSetContinuousRecovery({ enabled: false }),
                      );
                    }}
                    disabled={isActionLoading}
                    className="px-4 py-2 bg-white hover:bg-red-50 text-red-700 text-xs font-semibold rounded-xl border border-red-200 transition-all"
                  >
                    Stop automatic searching
                  </button>
                )}
              </div>
            ) : (
              onSetContinuousRecovery &&
              job.autonomy?.enabled && (
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    onClick={() => {
                      setDraftQuoteTarget(quoteTarget);
                      setDraftWindowHours(24);
                      setDraftAutoSearch(true);
                      setIsRecoverySettingsOpen(true);
                    }}
                    disabled={isActionLoading}
                    className="px-5 py-2.5 bg-emerald-800 hover:bg-emerald-900 disabled:bg-gray-200 text-white text-xs font-bold rounded-xl shadow-sm transition-all"
                  >
                    Keep looking for more options
                  </button>
                </div>
              )
            )}
          </div>

          {/* Provider Checked Card (ONLY for real provider entities) */}
          {actualProviders.length > 0 && actualProviders[0]?.name && (
            <div className="space-y-3 pt-2">
              <h3 className="text-xs font-bold uppercase tracking-wider text-gray-500">
                Provider checked
              </h3>
              <div className="p-5 rounded-2xl bg-white border border-gray-200 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="space-y-1">
                  <h4 className="text-base font-bold text-gray-900">
                    {providerCardDisplay?.name ?? actualProviders[0].name}
                  </h4>
                  <p className="text-xs text-gray-500">
                    {job.serviceCategory || "Local service"} · {locationStr}
                  </p>
                  <div className="flex items-center gap-2 pt-1 text-xs">
                    <span className="text-emerald-800 font-semibold">
                      {actualProviders[0].url ? "Website available" : "Source identified"}
                    </span>
                    <span className="text-gray-500">and</span>
                    <span className="text-stone-500">
                      {actualProviders[0].contactability === "email_found"
                        ? "Contact verified"
                        : "No verified email found"}
                    </span>
                  </div>
                </div>
                {providerCardDisplay?.url && (
                  <a
                    href={providerCardDisplay.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 px-4 py-2 bg-stone-50 hover:bg-stone-100 text-gray-800 text-xs font-semibold rounded-xl border border-gray-200 transition-all self-start sm:self-center"
                  >
                    <span>View website</span>
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                    </svg>
                  </a>
                )}
              </div>
            </div>
          )}

          {/* Sources Checked Card (rendered when 0 actual providers exist, but discovery sources were evaluated) */}
          {actualProviders.length === 0 && discoverySources.length > 0 && (
            <div className="space-y-3 pt-2">
              <h3 className="text-xs font-bold uppercase tracking-wider text-gray-500">
                Sources checked ({discoverySources.length})
              </h3>
              <div className="rounded-2xl bg-white border border-gray-200 divide-y divide-gray-100 shadow-sm overflow-hidden">
                {discoverySources.slice(0, 5).map((source) => (
                  <div key={source._id} className="p-4 flex items-center justify-between gap-4">
                    <div className="space-y-0.5 min-w-0">
                      <div className="text-xs font-bold text-gray-900 truncate">
                        {source.name}
                      </div>
                      <div className="text-[11px] text-gray-500">
                        Discovery evidence · No direct business email
                      </div>
                    </div>
                    {source.url && (
                      <a
                        href={source.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-emerald-800 hover:text-emerald-900 font-semibold shrink-0"
                      >
                        <span>View source</span>
                        <ExternalLinkIcon className="w-3.5 h-3.5" />
                      </a>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>
      )}

      {/* I. USER TAKE OVER SCREEN */}
      {consumerState === "user_takeover" && selectedCandidate && (
        <div className="rounded-2xl bg-white border border-emerald-200 p-6 sm:p-8 shadow-sm space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-gray-100 pb-5">
            <div>
              <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-emerald-50 text-emerald-800 text-xs font-semibold mb-1.5">
                <span>Direct Handoff Active</span>
              </div>
              <h2 className="text-2xl font-bold text-gray-900">
                {selectedDisplay?.name ?? selectedCandidate.name}
              </h2>
              <p className="text-xs text-gray-500 mt-0.5">
                {job.serviceCategory || "Home Service"} · {locationStr}
              </p>
            </div>
            <div className="text-left sm:text-right">
              <span className="text-2xl font-extrabold text-emerald-800 block">
                {selectedResponse?.headlinePrice || "Quote received"}
              </span>
              <span className="text-xs text-gray-500">
                {selectedResponse?.availability || "Flexible availability"}
              </span>
            </div>
          </div>

          {/* Quote & Scope Details */}
          <div className="grid sm:grid-cols-2 gap-4 text-xs">
            <div className="p-4 bg-stone-50 rounded-xl border border-stone-200/80 space-y-2">
              <h4 className="font-bold text-gray-900 uppercase tracking-wider text-[11px]">
                Included Scope
              </h4>
              {selectedResponse?.included && selectedResponse.included.length > 0 ? (
                <ul className="list-disc list-inside text-gray-700 space-y-1">
                  {selectedResponse.included.map((inc, i) => (
                    <li key={i}>{inc}</li>
                  ))}
                </ul>
              ) : (
                <p className="text-gray-500">Standard deep cleaning scope as requested.</p>
              )}
            </div>

            <div className="p-4 bg-stone-50 rounded-xl border border-stone-200/80 space-y-2">
              <h4 className="font-bold text-gray-900 uppercase tracking-wider text-[11px]">
                Excluded / Notes
              </h4>
              {selectedResponse?.excluded && selectedResponse.excluded.length > 0 ? (
                <ul className="list-disc list-inside text-gray-700 space-y-1">
                  {selectedResponse.excluded.map((exc, i) => (
                    <li key={i}>{exc}</li>
                  ))}
                </ul>
              ) : (
                <p className="text-gray-500">No exclusions stated.</p>
              )}
            </div>
          </div>

          {/* Conversation Summary */}
          <div className="p-4 bg-stone-50 rounded-xl border border-stone-200/80 space-y-2 text-xs">
            <h4 className="font-bold text-gray-900 uppercase tracking-wider text-[11px]">
              Conversation Summary
            </h4>
            <p className="text-gray-700 leading-relaxed">
              &ldquo;{selectedResponse?.evidenceText || selectedResponse?.summary}&rdquo;
            </p>
          </div>

          {/* Verified Contact Details */}
          <div className="p-4 bg-emerald-50/50 rounded-xl border border-emerald-100 space-y-2 text-xs">
            <h4 className="font-bold text-emerald-900 uppercase tracking-wider text-[11px]">
              Verified Contact Routes
            </h4>
            <div className="flex flex-wrap items-center gap-4 text-gray-800">
              {selectedCandidate.contactEmail ? (
                <div className="flex items-center gap-1.5">
                  <span className="font-semibold text-gray-600">Email:</span>
                  <span className="font-mono text-emerald-900 font-semibold">{selectedCandidate.contactEmail}</span>
                </div>
              ) : (
                <span className="text-gray-500">No public email published (website route only)</span>
              )}
              {selectedDisplay?.url && (
                <div className="flex items-center gap-1.5">
                  <span className="font-semibold text-gray-600">Website:</span>
                  <a
                    href={selectedDisplay.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-emerald-800 hover:underline font-semibold"
                  >
                    {selectedDisplay.url}
                  </a>
                </div>
              )}
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-gray-100">
            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={() => void handleCopySummary()}
                className="px-4 py-2.5 bg-white hover:bg-stone-50 text-gray-800 text-xs font-semibold rounded-xl border border-gray-300 shadow-sm transition-all"
              >
                {copyFeedback ? <span className="inline-flex items-center gap-1.5"><CheckIcon className="w-3.5 h-3.5" />Copied summary</span> : "Copy summary"}
              </button>
              {selectedCandidate.contactEmail && (
                <a
                  href={`mailto:${selectedCandidate.contactEmail}?subject=Re: ${encodeURIComponent(job.jobTitle)}`}
                  className="px-4 py-2.5 bg-white hover:bg-stone-50 text-gray-800 text-xs font-semibold rounded-xl border border-gray-300 shadow-sm transition-all inline-flex items-center gap-1.5"
                >
                  <span>Open email</span>
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                  </svg>
                </a>
              )}
              {selectedDisplay?.url && (
                <a
                  href={selectedDisplay.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-4 py-2.5 bg-white hover:bg-stone-50 text-gray-800 text-xs font-semibold rounded-xl border border-gray-300 shadow-sm transition-all inline-flex items-center gap-1.5"
                >
                  <span>Visit website</span>
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                  </svg>
                </a>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {onSetContinuationMode && (
                <button
                  onClick={() => void handleAction(() => onSetContinuationMode("findor_assisted"))}
                  disabled={isActionLoading}
                  className="px-3 py-2 text-xs font-semibold text-gray-700 hover:text-gray-900 transition-colors underline"
                >
                  Let Findor help again
                </button>
              )}
              {onClearSelectedProvider && (
                <button
                  onClick={() => void handleAction(onClearSelectedProvider)}
                  disabled={isActionLoading}
                  className="px-3 py-2 text-xs font-semibold text-gray-500 hover:text-gray-700 transition-colors"
                >
                  Choose a different provider
                </button>
              )}
              <button
                onClick={() => void handleAction(onCompleteJob)}
                disabled={isActionLoading}
                className="px-5 py-2.5 bg-emerald-800 hover:bg-emerald-900 text-white text-xs font-bold rounded-xl shadow-sm transition-all"
              >
                Mark project done
              </button>
            </div>
          </div>
        </div>
      )}

      {/* J. CONTINUE WITH FINDOR SCREEN */}
      {consumerState === "findor_assisted" && selectedCandidate && (
        <div className="rounded-2xl bg-white border border-emerald-200 p-6 sm:p-8 shadow-sm space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-gray-100 pb-5">
            <div>
              <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-emerald-50 text-emerald-800 text-xs font-semibold mb-1.5">
                <span>Findor Assisting</span>
              </div>
              <h2 className="text-xl sm:text-2xl font-bold text-gray-900">
                Continuing with {selectedDisplay?.name ?? selectedCandidate.name}
              </h2>
              <p className="text-xs text-gray-600 mt-0.5">
                Findor handles routine communication. Consequential decisions stop for your explicit approval.
              </p>
            </div>
            <div className="text-left sm:text-right">
              <span className="text-xl font-extrabold text-emerald-800 block">
                {selectedResponse?.headlinePrice || "Estimate received"}
              </span>
              <span className="text-xs text-gray-500">
                {selectedResponse?.availability || "Flexible"}
              </span>
            </div>
          </div>

          {/* Quick Questions */}
          <div className="space-y-3">
            <h4 className="text-xs font-bold uppercase tracking-wider text-gray-700">
              Ask a routine question
            </h4>
            <div className="flex flex-wrap gap-2">
              {[
                "Ask if Friday morning works",
                "Ask whether supplies are included",
                "Ask how long the job will take",
              ].map((q, idx) => (
                <button
                  key={idx}
                  onClick={() => void handleSendQuestion(q)}
                  disabled={isSendingQuestion || isPaused}
                  className="px-3.5 py-2 bg-stone-50 hover:bg-stone-100 text-gray-800 text-xs font-medium rounded-xl border border-stone-200 transition-all text-left"
                >
                  {q}
                </button>
              ))}
            </div>
          </div>

          {/* Custom Question Box */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={customQuestion}
                onChange={(e) => setCustomQuestion(e.target.value)}
                placeholder="Ask another non-binding clarification..."
                disabled={isSendingQuestion || isPaused}
                className="flex-1 px-4 py-2.5 rounded-xl border border-gray-300 text-xs focus:ring-2 focus:ring-emerald-700 focus:border-emerald-700 outline-none"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && customQuestion.trim()) {
                    void handleSendQuestion(customQuestion);
                  }
                }}
              />
              <button
                onClick={() => void handleSendQuestion(customQuestion)}
                disabled={isSendingQuestion || !customQuestion.trim() || isPaused}
                className="px-5 py-2.5 bg-emerald-800 hover:bg-emerald-900 disabled:bg-gray-200 text-white text-xs font-bold rounded-xl shadow-sm transition-all"
              >
                {isSendingQuestion ? "Sending..." : "Send question"}
              </button>
            </div>

            {questionFeedback && (
              <p className="text-xs font-semibold text-emerald-800 animate-in fade-in">
                <span className="inline-flex items-center gap-1"><CheckIcon className="w-3.5 h-3.5" />{questionFeedback}</span>
              </p>
            )}
          </div>

          {/* Consequential Human Decision Stop Prompt */}
          {consequentialApproval && (
            <div className="p-4 rounded-xl bg-amber-50 border border-amber-200 space-y-3">
              <div className="space-y-1">
                <span className="text-xs font-bold uppercase text-amber-900 block">
                  Approval Required
                </span>
                <p className="text-xs text-amber-900 leading-relaxed">
                  {consequentialApproval.reason}
                </p>
                <p className="text-xs font-semibold text-amber-950 mt-1">
                  Would you like Findor to send this inquiry with your explicit approval?
                </p>
              </div>
              <div className="flex items-center gap-2 pt-1">
                <button
                  onClick={() => void handleSendQuestion(consequentialApproval.question, true)}
                  disabled={isSendingQuestion}
                  className="px-4 py-2 bg-emerald-800 hover:bg-emerald-900 text-white text-xs font-bold rounded-lg shadow-sm"
                >
                  Confirm and send
                </button>
                <button
                  onClick={() => setConsequentialApproval(null)}
                  className="px-3 py-2 bg-white hover:bg-gray-100 text-gray-700 text-xs font-semibold rounded-lg border border-gray-300"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {/* Footer Switch Actions */}
          <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-gray-100 text-xs">
            <div className="flex items-center gap-3">
              {onSetContinuationMode && (
                <button
                  onClick={() => void handleAction(() => onSetContinuationMode("user_takeover"))}
                  disabled={isActionLoading}
                  className="text-gray-600 hover:text-gray-900 font-semibold underline"
                >
                  I&#39;ll take it from here
                </button>
              )}
              {onClearSelectedProvider && (
                <button
                  onClick={() => void handleAction(onClearSelectedProvider)}
                  disabled={isActionLoading}
                  className="text-gray-600 hover:text-gray-900 font-semibold"
                >
                  Choose a different provider
                </button>
              )}
            </div>
            <button
              onClick={() => void handleAction(onCompleteJob)}
              disabled={isActionLoading}
              className="px-4 py-2 bg-white hover:bg-gray-50 text-gray-700 font-semibold rounded-lg border border-gray-200"
            >
              Mark project done
            </button>
          </div>
        </div>
      )}

      {/* K. CONTINUATION CHOICE SCREEN (provider selected, mode not chosen yet) */}
      {consumerState === "provider_selected" && selectedCandidate && (
        <div className="rounded-2xl bg-white border-2 border-emerald-600/30 p-6 sm:p-8 shadow-sm space-y-6">
          <div className="space-y-1">
            <span className="text-xs font-bold text-emerald-800 uppercase tracking-wider">
              Provider Selected: {selectedDisplay?.name ?? selectedCandidate.name}
            </span>
            <h2 className="text-2xl font-bold text-gray-900">
              How would you like to continue?
            </h2>
            <p className="text-xs text-gray-600">
              Choose how you want to proceed with {selectedCandidate.name}.
            </p>
          </div>

          <div className="grid sm:grid-cols-2 gap-4">
            {/* Option 1: Continue with Findor */}
            <div className="p-5 rounded-2xl bg-stone-50 border border-stone-200/90 space-y-3 flex flex-col justify-between hover:border-emerald-600/50 transition-all">
              <div className="space-y-2">
                <h3 className="text-base font-bold text-gray-900">
                  Continue with Findor
                </h3>
                <p className="text-xs text-gray-600 leading-relaxed">
                  Findor can keep handling routine questions and communication. You will approve anything consequential.
                </p>
              </div>
              <button
                onClick={() => {
                  if (onSetContinuationMode) {
                    void handleAction(() => onSetContinuationMode("findor_assisted"));
                  }
                }}
                disabled={isActionLoading}
                className="w-full py-2.5 bg-emerald-800 hover:bg-emerald-900 text-white text-xs font-bold rounded-xl shadow-sm transition-all"
              >
                Continue with Findor
              </button>
            </div>

            {/* Option 2: I'll take it from here */}
            <div className="p-5 rounded-2xl bg-stone-50 border border-stone-200/90 space-y-3 flex flex-col justify-between hover:border-emerald-600/50 transition-all">
              <div className="space-y-2">
                <h3 className="text-base font-bold text-gray-900">
                  I&#39;ll take it from here
                </h3>
                <p className="text-xs text-gray-600 leading-relaxed">
                  See the provider&#39;s contact details, quote, scope, availability, and conversation summary so you can continue directly.
                </p>
              </div>
              <button
                onClick={() => {
                  if (onSetContinuationMode) {
                    void handleAction(() => onSetContinuationMode("user_takeover"));
                  }
                }}
                disabled={isActionLoading}
                className="w-full py-2.5 bg-white hover:bg-stone-100 text-gray-800 text-xs font-bold rounded-xl border border-gray-300 shadow-sm transition-all"
              >
                I&#39;ll take it from here
              </button>
            </div>
          </div>

          <div className="pt-2 text-center">
            {onClearSelectedProvider && (
              <button
                onClick={() => void handleAction(onClearSelectedProvider)}
                disabled={isActionLoading}
                className="text-xs text-gray-500 hover:text-gray-800 font-semibold"
              >
                <span className="inline-flex items-center gap-1"><ArrowLeftIcon className="w-3.5 h-3.5" />Choose a different provider</span>
              </button>
            )}
          </div>
        </div>
      )}

      {/* L. OPTIONS READY (Comparison list) */}
      {consumerState === "options_ready" && (
        <section className="space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-xl font-bold text-gray-900">
                {usableCount >= 2
                  ? `Compare ${usableCount} options`
                  : usableCount === 1
                    ? "1 quote received"
                    : "Reviewing replies"}
              </h2>
              <p className="text-xs text-gray-500">
                {usableCount >= 2
                  ? "Review quotes side by side and choose which provider you want to proceed with. No automatic ranking or winner."
                  : "Review the replies and choose how you want to proceed. No automatic ranking."}
              </p>
              {usableCount < quoteTarget && continuousOn && (
                <p className="text-xs font-semibold text-emerald-800 pt-1">
                  Findor is still looking for more options.
                </p>
              )}
            </div>
            {usableCount < quoteTarget &&
              !continuousOn &&
              onSetContinuousRecovery && (
                <button
                  onClick={() => {
                    setDraftQuoteTarget(quoteTarget);
                    setDraftWindowHours(24);
                    setDraftAutoSearch(true);
                    setIsRecoverySettingsOpen(true);
                  }}
                  disabled={isActionLoading}
                  className="px-4 py-2 bg-white hover:bg-stone-50 text-gray-800 text-xs font-bold rounded-xl border border-gray-300 shadow-sm transition-all shrink-0"
                >
                  Find more options
                </button>
              )}
          </div>

          <div className="grid gap-4">
            {verifiedResponses.map((res) => {
              const cand = candidates.find((c) => c._id === res.providerId);
              const candDisplay = cand ? resolveBusinessDisplay(cand) : null;
              const priceText = res.headlinePrice
                ? res.headlinePrice
                : res.priceMin && res.priceMax
                ? `$${res.priceMin} - $${res.priceMax}`
                : res.priceMin
                ? `From $${res.priceMin}`
                : "Estimate provided";

              return (
                <div
                  key={res._id}
                  className="p-5 sm:p-6 bg-white border border-gray-200 rounded-2xl shadow-sm space-y-4 hover:border-emerald-600/40 transition-all"
                >
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-gray-100 pb-3">
                    <div>
                      <h3 className="text-lg font-bold text-gray-900">
                        {candDisplay?.name || "Local Provider"}
                      </h3>
                      <p className="text-xs text-gray-500">
                        {job.serviceCategory || "Home Service"} · {locationStr}
                      </p>
                    </div>
                    <div className="text-left sm:text-right">
                      <span className="text-lg font-extrabold text-emerald-800 block">
                        {priceText}
                      </span>
                      <span className="text-[11px] text-gray-500">
                        {res.availability || "Flexible availability"}
                      </span>
                    </div>
                  </div>

                  <div className="space-y-2 text-xs text-gray-700">
                    <p className="font-semibold text-gray-900">What they said:</p>
                    <p className="bg-stone-50 p-3 rounded-xl border border-stone-200/80 leading-relaxed text-gray-600">
                      &ldquo;{res.evidenceText || res.summary}&rdquo;
                    </p>
                  </div>

                  {/* Scope Tags */}
                  {res.included && res.included.length > 0 && (
                    <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                      <span className="font-semibold text-gray-600">Included:</span>
                      {res.included.map((inc, i) => (
                        <span key={i} className="px-2 py-0.5 bg-emerald-50 text-emerald-800 rounded font-medium">
                          {inc}
                        </span>
                      ))}
                    </div>
                  )}

                  <div className="flex items-center justify-end gap-3 pt-2 border-t border-gray-50">
                    <button
                      onClick={() => setSelectedResponseModal(res)}
                      className="px-3.5 py-2 text-gray-700 hover:text-gray-900 text-xs font-semibold"
                    >
                      View quote
                    </button>
                    {cand && onSelectProvider && (
                      <button
                        onClick={() => void handleAction(() => onSelectProvider(cand._id))}
                        disabled={isActionLoading}
                        className="px-5 py-2.5 bg-emerald-800 hover:bg-emerald-900 text-white text-xs font-bold rounded-xl shadow-sm transition-all"
                      >
                        Continue with this provider
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* M. PAUSED STATE */}
      {consumerState === "paused" && (
        <div className="rounded-2xl bg-white border border-amber-200 p-6 sm:p-8 shadow-sm space-y-4">
          <div className="space-y-1">
            <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-bold bg-amber-50 text-amber-900 border border-amber-200">
              Project paused
            </span>
            <h2 className="text-xl font-bold text-gray-900">
              Search & outreach are on hold
            </h2>
            <p className="text-xs text-gray-600">
              Automated actions for this project are currently suspended. You can resume at any time.
            </p>
          </div>
          <div className="flex items-center gap-3 pt-2">
            <button
              onClick={() => void handleAction(onResumeJob)}
              disabled={isActionLoading}
              className="px-6 py-3 bg-emerald-800 hover:bg-emerald-900 disabled:bg-gray-200 text-white text-sm font-bold rounded-xl shadow-sm transition-all"
            >
              Resume project
            </button>
            <button
              onClick={() => setShowActivityDrawer(true)}
              className="px-4 py-3 bg-white hover:bg-stone-50 text-gray-700 text-xs font-semibold rounded-xl border border-gray-300 transition-all"
            >
              View activity
            </button>
          </div>
        </div>
      )}

      {/* N. CANCELLED STATE */}
      {consumerState === "cancelled" && (
        <div className="rounded-2xl bg-white border border-gray-200 p-6 sm:p-8 shadow-sm space-y-4">
          <div className="space-y-1">
            <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-bold bg-gray-100 text-gray-700 border border-gray-200">
              Project cancelled
            </span>
            <h2 className="text-xl font-bold text-gray-900">
              This project has been cancelled
            </h2>
            <p className="text-xs text-gray-600">
              No further outreach or automated actions will take place. Project history is preserved.
            </p>
          </div>
          <div className="flex items-center gap-3 pt-2">
            <button
              onClick={onStartNewRequest}
              className="px-5 py-2.5 bg-emerald-800 hover:bg-emerald-900 text-white text-xs font-bold rounded-xl shadow-sm transition-all"
            >
              Start new request
            </button>
            <button
              onClick={onBackToProjects}
              className="px-4 py-2.5 bg-white hover:bg-stone-50 text-gray-700 text-xs font-semibold rounded-xl border border-gray-300 transition-all"
            >
              All projects
            </button>
          </div>
        </div>
      )}

      {/* O. COMPLETED STATE */}
      {consumerState === "completed" && (
        <div className="rounded-2xl bg-white border border-emerald-200 p-6 sm:p-8 shadow-sm space-y-4">
          <div className="space-y-1">
            <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-bold bg-emerald-50 text-emerald-800 border border-emerald-200">
              <span className="inline-flex items-center gap-1"><CheckIcon className="w-3.5 h-3.5" />Project completed</span>
            </span>
            <h2 className="text-xl font-bold text-gray-900">
              Project marked as complete
            </h2>
            <p className="text-xs text-gray-600">
              All quotes, contact details, and conversation summaries remain saved here for your reference.
            </p>
          </div>
          <div className="flex items-center gap-3 pt-2">
            <button
              onClick={onBackToProjects}
              className="px-5 py-2.5 bg-emerald-800 hover:bg-emerald-900 text-white text-xs font-bold rounded-xl shadow-sm transition-all"
            >
              Back to projects
            </button>
            <button
              onClick={onStartNewRequest}
              className="px-4 py-2.5 bg-white hover:bg-stone-50 text-gray-700 text-xs font-semibold rounded-xl border border-gray-300 transition-all"
            >
              Start new request
            </button>
          </div>
        </div>
      )}

      {/* P. UNKNOWN / CORRUPTED FALLBACK STATE (Guarantees no blank page) */}
      {consumerState === "unknown_state" && (
        <div className="rounded-2xl bg-white border border-stone-200 p-6 sm:p-8 shadow-sm space-y-4">
          <div className="space-y-1">
            <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-bold bg-stone-100 text-stone-800 border border-stone-200">
              Project status update
            </span>
            <h2 className="text-xl font-bold text-gray-900">
              Your project is active
            </h2>
            <p className="text-xs text-gray-600">
              Your project record is safely saved. Use the actions below or view project activity.
            </p>
          </div>
          <div className="flex items-center gap-3 pt-2">
            <button
              onClick={() => setShowActivityDrawer(true)}
              className="px-5 py-2.5 bg-emerald-800 hover:bg-emerald-900 text-white text-xs font-bold rounded-xl shadow-sm transition-all"
            >
              View activity
            </button>
            <button
              onClick={onBackToProjects}
              className="px-4 py-2.5 bg-white hover:bg-stone-50 text-gray-700 text-xs font-semibold rounded-xl border border-gray-300 transition-all"
            >
              All projects
            </button>
          </div>
        </div>
      )}

      {/* 4. Collapsed Project Details Section */}
      <section className="border-t border-gray-100 pt-4">
        <button
          onClick={() => setShowDetails(!showDetails)}
          className="w-full flex items-center justify-between py-2 text-left text-xs font-semibold text-gray-600 hover:text-gray-900"
        >
          <span>Project details</span>
          <span className="inline-flex items-center gap-1">
            {showDetails ? <ChevronUpIcon className="w-3.5 h-3.5" /> : <ChevronDownIcon className="w-3.5 h-3.5" />}
            {showDetails ? "Hide" : "Show"}
          </span>
        </button>

        {showDetails && (
          <div className="p-4 rounded-xl bg-stone-50 border border-stone-200 mt-2 space-y-2 text-xs text-gray-700">
            <p><span className="font-bold">Description: </span>{job.naturalLanguageDescription || job.jobTitle}</p>
            <p><span className="font-bold">Location: </span>{locationStr}</p>
            <p><span className="font-bold">Desired Timing: </span>{formatTimingLabel(job.desiredTiming)}</p>
            <p><span className="font-bold">Budget context: </span>{job.budgetOrContext || "Flexible"}</p>
          </div>
        )}
      </section>

      {/* 5. Slide-Over Activity History Drawer */}
      {showActivityDrawer && (
        <div className="fixed inset-0 z-50 overflow-hidden">
          <div
            className="absolute inset-0 bg-black/40 backdrop-blur-sm transition-opacity"
            onClick={() => setShowActivityDrawer(false)}
          />
          <div className="fixed inset-y-0 right-0 max-w-md w-full bg-white shadow-2xl p-6 flex flex-col justify-between overflow-y-auto">
            <div className="space-y-6">
              <div className="flex items-center justify-between border-b pb-4">
                <h3 className="text-lg font-bold text-gray-900">Project history</h3>
                <button
                  onClick={() => setShowActivityDrawer(false)}
                  className="p-1 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100"
                  aria-label="Close project history"
                >
                  <XIcon className="w-4 h-4" />
                </button>
              </div>

              <div className="space-y-3">
                {events.map((e) => {
                  const isCycleCancelled = e.eventType === "cycle_cancelled" || e.message?.toLowerCase().includes("cancelled");
                  const displayMessage = isCycleCancelled
                    ? "Previous attempt · Cancelled before search began"
                    : e.message || "Event recorded";

                  return (
                    <div key={e._id} className="p-3 bg-stone-50 rounded-xl border border-stone-200 text-xs space-y-1">
                      <span className="font-bold text-gray-900 block">{formatEnumLabel(e.eventType)}</span>
                      <p className="text-gray-600">{displayMessage}</p>
                      <span className="text-[10px] text-gray-400 block pt-1">
                        {new Date(e._creationTime).toLocaleString()}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="pt-6 border-t mt-6">
              <button
                onClick={() => setShowActivityDrawer(false)}
                className="w-full py-2.5 bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs font-semibold rounded-xl"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 6. Response Modal */}
      {selectedResponseModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 space-y-4 shadow-xl">
            <div className="flex items-center justify-between border-b pb-3">
              <h3 className="text-lg font-bold text-gray-900">Quote details</h3>
              <button
                onClick={() => setSelectedResponseModal(null)}
                className="p-1 text-gray-400 hover:text-gray-600 rounded-lg"
                aria-label="Close quote details"
              >
                <XIcon className="w-4 h-4" />
              </button>
            </div>
            <div className="space-y-2 text-xs text-gray-700">
              <p><span className="font-bold">Provider summary: </span>{selectedResponseModal.summary || "Estimate provided"}</p>
              <p><span className="font-bold">Earliest availability: </span>{selectedResponseModal.availability || "Flexible"}</p>
              <p><span className="font-bold">Response: </span>&ldquo;{selectedResponseModal.evidenceText}&rdquo;</p>
            </div>
            <div className="pt-3 border-t flex justify-end">
              <button
                onClick={() => setSelectedResponseModal(null)}
                className="px-4 py-2 bg-emerald-800 text-white text-xs font-bold rounded-xl"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 6b. Recovery Settings Modal (explicit opt-in for automatic searching) */}
      {isRecoverySettingsOpen && onSetContinuousRecovery && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 space-y-5 shadow-2xl animate-in fade-in zoom-in-95 duration-150">
            <div className="space-y-1">
              <h3 className="text-xl font-bold text-gray-900">Keep looking for more options</h3>
              <p className="text-xs text-gray-600">
                Findor will contact new verified providers in batches until you have enough quotes or you stop it. Previously contacted providers are never contacted again, and each provider gets at most one follow-up.
              </p>
            </div>

            <RecoveryMandateControls
              quoteTarget={draftQuoteTarget}
              windowHours={draftWindowHours}
              autoSearch={draftAutoSearch}
              disabled={isActionLoading}
              onQuoteTarget={setDraftQuoteTarget}
              onWindowHours={setDraftWindowHours}
              onAutoSearch={setDraftAutoSearch}
            />

            <p className="text-xs text-gray-500">
              Nothing starts until you confirm below. You can stop automatic searching at any time.
            </p>

            <div className="flex items-center justify-end gap-3 pt-2 border-t border-gray-100">
              <button
                type="button"
                onClick={() => setIsRecoverySettingsOpen(false)}
                disabled={isActionLoading}
                className="px-4 py-2.5 bg-white hover:bg-gray-100 text-gray-700 text-xs font-semibold rounded-xl border border-gray-300 transition-all"
              >
                Back
              </button>
              <button
                type="button"
                onClick={() => {
                  void handleAction(async () => {
                    await onSetContinuousRecovery({
                      enabled: draftAutoSearch,
                      quoteTarget: draftQuoteTarget,
                      responseWindowHours: draftWindowHours,
                    });
                    setIsRecoverySettingsOpen(false);
                  });
                }}
                disabled={isActionLoading}
                className="px-5 py-2.5 bg-emerald-800 hover:bg-emerald-900 disabled:bg-gray-300 text-white text-xs font-bold rounded-xl shadow-sm transition-all flex items-center gap-1.5"
              >
                {isActionLoading && (
                  <span className="inline-block w-3.5 h-3.5 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                )}
                <span>{draftAutoSearch ? "Start looking" : "Stop searching"}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 7. Dedicated Try Again / Retry Modal (Local Preparation) */}
      {isRetryModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 space-y-5 shadow-2xl animate-in fade-in zoom-in-95 duration-150">
            <div className="space-y-1">
              <h3 className="text-xl font-bold text-gray-900">Try another search</h3>
              <p className="text-xs text-gray-600">
                Findor will search for more qualified pros in your area.
              </p>
            </div>

            <div className="p-4 rounded-xl bg-stone-50 border border-stone-200 text-xs space-y-2 text-gray-700">
              <p><span className="font-bold text-gray-900">Project: </span>{job.jobTitle}</p>
              <p><span className="font-bold text-gray-900">Location: </span>{locationStr}</p>
              <p><span className="font-bold text-gray-900">Search scope: </span>Up to 3 local providers</p>
            </div>

            <p className="text-xs text-gray-500">
              No new attempt is started until you confirm below. You can discard or back out at any time.
            </p>

            <div className="flex items-center justify-end gap-3 pt-2 border-t border-gray-100">
              <button
                type="button"
                onClick={() => setIsRetryModalOpen(false)}
                disabled={isActionLoading}
                className="px-4 py-2.5 bg-white hover:bg-gray-100 text-gray-700 text-xs font-semibold rounded-xl border border-gray-300 transition-all"
              >
                Back
              </button>
              <button
                type="button"
                onClick={() => {
                  void handleAction(async () => {
                    await onRetryCycle();
                    setIsRetryModalOpen(false);
                  });
                }}
                disabled={isActionLoading}
                className="px-5 py-2.5 bg-emerald-800 hover:bg-emerald-900 disabled:bg-gray-300 text-white text-xs font-bold rounded-xl shadow-sm transition-all flex items-center gap-1.5"
              >
                {isActionLoading && (
                  <span className="inline-block w-3.5 h-3.5 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                )}
                <span>Start new search</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 8. Dedicated Cancel Project Confirmation Modal */}
      {isCancelModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 space-y-5 shadow-2xl animate-in fade-in zoom-in-95 duration-150">
            <div className="space-y-1">
              <h3 className="text-xl font-bold text-gray-900">Cancel this project?</h3>
              <p className="text-xs text-gray-600">
                Findor will stop all future research and outreach for this request.
              </p>
            </div>

            <div className="flex items-center justify-end gap-3 pt-2 border-t border-gray-100">
              <button
                type="button"
                onClick={() => setIsCancelModalOpen(false)}
                disabled={isActionLoading}
                className="px-4 py-2.5 bg-white hover:bg-gray-100 text-gray-700 text-xs font-semibold rounded-xl border border-gray-300 transition-all"
              >
                Keep project
              </button>
              <button
                type="button"
                onClick={() => {
                  void handleAction(async () => {
                    await onCancelJob();
                    setIsCancelModalOpen(false);
                  });
                }}
                disabled={isActionLoading}
                className="px-5 py-2.5 bg-red-700 hover:bg-red-800 disabled:bg-gray-300 text-white text-xs font-bold rounded-xl shadow-sm transition-all flex items-center gap-1.5"
              >
                {isActionLoading && (
                  <span className="inline-block w-3.5 h-3.5 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                )}
                <span>Cancel project</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
