import React, { useState } from "react";
import type { Doc, Id } from "../../convex/_generated/dataModel";
import { formatTimingLabel } from "../formatters";
import { resolveConsumerProjectState } from "../projectState";
import { BoltIcon, HammerIcon, PackageIcon, SearchIcon, SnowflakeIcon, SparklesIcon, WrenchIcon } from "./UiIcons";

interface ProjectsHomeProps {
  userEmail?: string;
  jobs: Array<Doc<"jobs">>;
  onSelectJob: (jobId: Id<"jobs">) => void;
  onStartNewRequest: (initialPrompt?: string, category?: string) => void;
}

const CATEGORIES = [
  { id: "electrical", label: "Electrical", icon: BoltIcon, prompt: "Need electrical wiring or fixture repair" },
  { id: "plumbing", label: "Plumbing", icon: WrenchIcon, prompt: "Fix a leaking pipe or install a faucet" },
  { id: "cleaning", label: "Cleaning", icon: SparklesIcon, prompt: "Deep clean a residential apartment" },
  { id: "handyman", label: "Handyman", icon: HammerIcon, prompt: "Mount a TV and assemble furniture" },
  { id: "moving", label: "Moving", icon: PackageIcon, prompt: "Help moving apartment furniture" },
  { id: "hvac", label: "HVAC", icon: SnowflakeIcon, prompt: "Air conditioning repair and servicing" },
];

export function ProjectsHome({
  jobs,
  onSelectJob,
  onStartNewRequest,
}: ProjectsHomeProps) {
  const [quickPrompt, setQuickPrompt] = useState("");

  const handleQuickSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!quickPrompt.trim()) return;
    onStartNewRequest(quickPrompt);
  };

  const getConsumerProjectState = (job: Doc<"jobs">) => {
    const state = resolveConsumerProjectState(job);

    switch (state) {
      case "needs_decision":
        return {
          statusTitle: "No contactable providers found",
          statusDetail:
            job.autonomyStopReason ||
            "Findor searched local sources, but no verified business email was found. No one was contacted.",
          badgeColor: "bg-stone-100 text-stone-800 border-stone-200",
          actionLabel: "View project",
        };
      case "cancelled":
        return {
          statusTitle: "Project cancelled",
          statusDetail: "This request was closed.",
          badgeColor: "bg-gray-100 text-gray-700 border-gray-200",
          actionLabel: "View project",
        };
      case "completed":
        return {
          statusTitle: "Completed",
          statusDetail: "Project finished.",
          badgeColor: "bg-emerald-100 text-emerald-800 border-emerald-200",
          actionLabel: "View summary",
        };
      case "paused":
        return {
          statusTitle: "Paused",
          statusDetail: "Project search is on hold.",
          badgeColor: "bg-amber-100 text-amber-800 border-amber-200",
          actionLabel: "Resume project",
        };
      case "user_takeover":
        return {
          statusTitle: "Direct handoff active",
          statusDetail: "Provider details and quote unlocked.",
          badgeColor: "bg-emerald-100 text-emerald-800 border-emerald-200",
          actionLabel: "View handoff",
        };
      case "findor_assisted":
        return {
          statusTitle: "Findor assisting",
          statusDetail: "Continuing with selected provider.",
          badgeColor: "bg-emerald-100 text-emerald-800 border-emerald-200",
          actionLabel: "View communication",
        };
      case "provider_selected":
        return {
          statusTitle: "Provider selected",
          statusDetail: "Choose how you would like to proceed.",
          badgeColor: "bg-emerald-100 text-emerald-800 border-emerald-200",
          actionLabel: "Continue",
        };
      case "options_ready":
        return {
          statusTitle: "Quotes ready to review",
          statusDetail: "Local providers responded with verified estimates.",
          badgeColor: "bg-emerald-100 text-emerald-800 border-emerald-200",
          actionLabel: "Review quotes",
        };
      case "waiting_for_replies":
        return {
          statusTitle: "Waiting for replies",
          statusDetail: "Inquiries sent to verified local providers.",
          badgeColor: "bg-blue-100 text-blue-800 border-blue-200",
          actionLabel: "View status",
        };
      case "outreach_in_flight":
        return {
          statusTitle: "Sending inquiries",
          statusDetail: "Outreach approved and currently dispatching.",
          badgeColor: "bg-blue-100 text-blue-800 border-blue-200",
          actionLabel: "View status",
        };
      case "providers_ready":
        return {
          statusTitle: "Providers found",
          statusDetail: "Preparing outreach inquiries.",
          badgeColor: "bg-emerald-100 text-emerald-800 border-emerald-200",
          actionLabel: "View providers",
        };
      case "researching":
        return {
          statusTitle: "Finding providers",
          statusDetail: "Findor is checking local provider contacts.",
          badgeColor: "bg-emerald-100 text-emerald-800 border-emerald-200",
          actionLabel: "View progress",
        };
      case "ready_to_search":
        return {
          statusTitle: "Ready to find providers",
          statusDetail: "Request confirmed. Ready to begin provider search.",
          badgeColor: "bg-emerald-50 text-emerald-800 border-emerald-200",
          actionLabel: "Start finding providers",
        };
      case "ready_for_review":
        return {
          statusTitle: "Ready for your review",
          statusDetail: "Confirm project details to start finding providers.",
          badgeColor: "bg-emerald-100 text-emerald-800 border-emerald-200",
          actionLabel: "Review & start",
        };
      case "needs_details":
        return {
          statusTitle: "A few details needed",
          statusDetail: "Provide additional project details to prepare brief.",
          badgeColor: "bg-amber-100 text-amber-900 border-amber-200",
          actionLabel: "Provide details",
        };
      case "unknown_state":
      default:
        return {
          statusTitle: "Active",
          statusDetail: "Project saved.",
          badgeColor: "bg-stone-100 text-stone-800 border-stone-200",
          actionLabel: "View project",
        };
    }
  };

  return (
    <div className="w-full max-w-5xl mx-auto px-4 sm:px-6 py-8 sm:py-10 space-y-10">
      {/* 1. Header & Intake Section */}
      <div className="space-y-4">
        <h1 className="text-2xl sm:text-3xl font-extrabold text-gray-900 tracking-tight">
          What do you need help with?
        </h1>

        {/* Search / Intake Bar */}
        <form
          onSubmit={handleQuickSubmit}
          className="rounded-2xl bg-white p-2.5 sm:p-3 shadow-md shadow-gray-200/60 border border-gray-200 focus-within:border-emerald-600 focus-within:ring-4 focus-within:ring-emerald-100 transition-all flex flex-col sm:flex-row items-stretch sm:items-center gap-2"
        >
          <div className="flex items-center gap-3 px-3 py-1.5 flex-1">
            <SearchIcon className="w-5 h-5 text-gray-400 flex-shrink-0" />
            <input
              type="text"
              value={quickPrompt}
              onChange={(e) => setQuickPrompt(e.target.value)}
              placeholder="Describe a project (e.g. Replace bathroom light fixtures this week)..."
              className="w-full border-none p-0 text-sm sm:text-base text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-0 bg-transparent"
            />
          </div>
          <button
            type="submit"
            disabled={!quickPrompt.trim()}
            className="px-6 py-2.5 bg-emerald-700 hover:bg-emerald-800 disabled:bg-gray-100 disabled:text-gray-400 text-white text-sm font-bold rounded-xl shadow-sm transition-all"
          >
            Start
          </button>
        </form>

        {/* Category Shortcuts */}
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider mr-1">
            Popular:
          </span>
          {CATEGORIES.map((cat) => (
            <button
              key={cat.id}
              onClick={() => onStartNewRequest(cat.prompt, cat.id)}
              className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-white hover:bg-stone-50 border border-gray-200 text-xs font-semibold text-gray-700 shadow-sm transition-all"
            >
              <cat.icon className="w-4 h-4" />
              <span>{cat.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* 2. Your Projects Section */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg sm:text-xl font-bold text-gray-900 tracking-tight">
            Your projects
          </h2>
          <span className="text-xs font-medium text-gray-600">
            {jobs.length} {jobs.length === 1 ? "project" : "projects"}
          </span>
        </div>

        {jobs.length === 0 ? (
          <div className="text-center py-12 px-4 rounded-2xl bg-stone-50 border border-dashed border-gray-200 space-y-3">
            <h3 className="text-base font-semibold text-gray-900">No active projects</h3>
            <p className="text-xs text-gray-500 max-w-sm mx-auto">
              Describe a project above to have Findor discover and contact local verified providers.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4">
            {jobs.map((job) => {
              const state = getConsumerProjectState(job);
              const loc = job.structuredLocation;
              const locationStr =
                loc?.city && loc?.country
                  ? `${loc.locality ? loc.locality + ", " : ""}${loc.city}, ${loc.country}`
                  : job.serviceLocation || "Location unspecified";

              return (
                <div
                  key={job._id}
                  onClick={() => onSelectJob(job._id)}
                  className="p-5 sm:p-6 bg-white border border-gray-200 hover:border-emerald-600 rounded-2xl shadow-sm hover:shadow-md transition-all cursor-pointer flex flex-col sm:flex-row sm:items-center justify-between gap-4 group"
                >
                  <div className="space-y-2 flex-1">
                    <div className="flex items-center gap-2.5 flex-wrap">
                      <h3 className="text-base sm:text-lg font-bold text-gray-900 group-hover:text-emerald-800 transition-colors">
                        {job.jobTitle || "Home Service Request"}
                      </h3>
                      <span className={`text-[11px] font-bold px-2.5 py-0.5 rounded-full border ${state.badgeColor}`}>
                        {state.statusTitle}
                      </span>
                    </div>

                    <p className="text-xs text-gray-500">
                      {locationStr} · {formatTimingLabel(job.desiredTiming)}
                    </p>

                    <p className="text-xs text-gray-600 leading-relaxed max-w-2xl">
                      {state.statusDetail}
                    </p>
                  </div>

                  <div className="flex sm:flex-col items-center sm:items-end justify-between sm:justify-center gap-2 pt-2 sm:pt-0 border-t sm:border-t-0 border-gray-100">
                    <button className="px-4 py-2 bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-bold rounded-xl shadow-sm transition-all">
                      {state.actionLabel}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
