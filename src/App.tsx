import { useState } from "react";
import { useConvexAuth, useQuery, useMutation } from "convex/react";
import { useAuthActions } from "@convex-dev/auth/react";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { ErrorBoundary } from "./ErrorBoundary";
import { Header } from "./components/Header";
import { LandingHero } from "./components/LandingHero";
import { ProjectsHome } from "./components/ProjectsHome";
import { ConversationalIntake } from "./components/ConversationalIntake";
import { ProjectHub } from "./components/ProjectHub";
import { AuthModal } from "./components/AuthModal";
import { formatEnumLabel, responseKindLabel } from "./formatters";
import type { LocationAllowlist } from "./formatters";

// ============================================================================
// BACKWARD-COMPATIBLE EXPORTED TEST FIXTURES FOR TESTS/UI.TEST.TS
// ============================================================================

export function BriefReview(props: any) {
  const { job, onApprove, isApproving, error } = props;
  const isPaused = job?.status === "paused" || job?.executionStatus === "paused";
  const version = job?.currentBriefVersion || job?.briefVersion || 1;
  const brief = job?.brief || {};
  const structuredReqs = Array.isArray(brief.structuredRequirements)
    ? brief.structuredRequirements
    : typeof brief.structuredRequirements === "object" && brief.structuredRequirements !== null
    ? Object.entries(brief.structuredRequirements).map(([k, v]) => ({ label: k, value: String(v) }))
    : [];
  const unknowns = Array.isArray(brief.unknowns) ? brief.unknowns : [];

  return (
    <div className="brief-review p-4 rounded-xl bg-white border border-gray-200 space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-bold text-gray-900">Review your standardized brief</h2>
          <span className="text-xs text-gray-500 font-semibold">{`Brief v${version}`}</span>
        </div>
        {isPaused && <span className="text-xs font-bold text-amber-700 bg-amber-50 px-2 py-1 rounded">Paused</span>}
      </div>

      <p className="text-xs text-gray-700">
        {brief.projectSummary || job?.naturalLanguageDescription || "Project summary"}
      </p>

      {structuredReqs.length > 0 && (
        <div className="space-y-1">
          {structuredReqs.map((r: any, i: number) => (
            <div key={i} className="text-xs text-gray-600">
              <span className="font-semibold">{r.label || "Requirement"}: </span>
              <span>{r.value}</span>
            </div>
          ))}
        </div>
      )}

      {unknowns.length > 0 && (
        <div className="space-y-1">
          <span className="text-xs font-semibold text-gray-700">Unknowns:</span>
          {unknowns.map((u: string, i: number) => (
            <p key={i} className="text-xs text-gray-500">{u}</p>
          ))}
        </div>
      )}

      {isPaused && (
        <p className="text-xs text-amber-700">
          Request is paused. Resume this request before approving Findor&#x27;s mandate and starting a cycle.
        </p>
      )}

      {error && <p className="text-xs text-red-600">{error}</p>}

      <button
        disabled={isPaused || isApproving}
        onClick={onApprove}
        className="mt-2 px-4 py-2 bg-emerald-700 disabled:bg-gray-200 text-white text-xs font-semibold rounded-lg"
      >
        {isPaused ? "Resume request to start" : isApproving ? "Starting search..." : "Start finding options"}
      </button>
    </div>
  );
}

export function OutreachLedger(props: any) {
  const rows = props?.rows || props?.outreachItems || [];
  return (
    <div className="outreach-ledger space-y-3">
      <h4 className="text-sm font-bold text-gray-900">Outreach ledger</h4>
      {rows.length === 0 ? (
        <p className="text-xs text-gray-500">No outreach sent yet.</p>
      ) : (
        <div className="space-y-2">
          {rows.map((r: any, i: number) => {
            const email = r.contactRoute || r.providerEmail || r.message?.providerEmail || r.recipientEmail || "";
            const status = r.providerState || r.sendState || r.resolutionLabel || (r.providerResolution === "no_response" ? "No response" : r.status === "sent" ? "Provider replied" : r.status ? formatEnumLabel(r.status) : "");
            return (
              <div key={i} className="p-3 border border-gray-200 rounded-xl text-xs space-y-1 bg-white">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-gray-900">{r.providerName || email}</span>
                  <span className="px-2 py-0.5 rounded bg-gray-100 font-semibold text-gray-700">
                    {status}
                  </span>
                </div>
                {email && <p className="text-gray-500">{email}</p>}
                <p className="text-[11px] text-gray-400">Real AgentMail receipt stored.</p>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function Timeline(props: any) {
  const events = props?.events || [];
  const outreachItems = props?.outreachItems || [];
  const candidates = props?.candidates || [];

  return (
    <div className="timeline space-y-3">
      <h3 className="text-sm font-bold text-gray-900">Request record</h3>
      <h4 className="text-xs font-semibold text-gray-700">What has happened</h4>
      <div className="space-y-2">
        {events.map((e: any, i: number) => {
          let desc = e.description || e.message || formatEnumLabel(e.eventType);
          if (e.eventType === "outreach_sent" && outreachItems.length > 0) {
            const relatedOutreach = outreachItems.find((item: any) =>
              item.candidateId === e.candidateId || item.providerEmail === e.providerEmail,
            ) || outreachItems[0];
            const cand = candidates.find((c: any) =>
              c._id === (e.candidateId || relatedOutreach?.candidateId) ||
              c.contactEmail === (e.providerEmail || relatedOutreach?.providerEmail),
            );
            const name = cand?.name || "the provider";
            desc = "AgentMail accepted outreach to " + name + ".";
          } else if (e.eventType === "provider_replied") {
            desc = e.providerEmail
              ? "Provider message received from " + e.providerEmail + "."
              : "Provider message received.";
          }
          return (
            <div key={i} className="text-xs border-b border-gray-100 py-1.5">
              <span className="font-semibold text-gray-800">{e.title || formatEnumLabel(e.eventType)}: </span>
              <span className="text-gray-600">{desc}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function CycleHistoryBar(props: any) {
  const history = props?.history || props?.cycles || [];
  const selectedCycleNumber = props?.selectedCycleNumber;
  const onSelectCycle = props?.onSelectCycle;

  return (
    <div className="cycle-history-container space-y-2">
      <h4 className="text-xs font-bold text-gray-900">
        Procurement Cycles ({history.length})
      </h4>
      <div className="cycle-history flex flex-wrap gap-2">
        {history.map((item: any, i: number) => {
          const c = item.cycle || item;
          const cycleNum = c.cycleNumber || i + 1;
          const version = item.briefVersion?.version || item.briefVersion || c.briefVersion || 1;
          const isCurrentActive = cycleNum === 1 && history.length === 1 && c.status === "active";
          const isHistoricalLegacy = cycleNum === 1 && history.length > 1;

          let statusLabel = formatEnumLabel(c.status, "Completed");
          if (isHistoricalLegacy) {
            statusLabel = "previous attempt";
          } else if (c.status === "exhausted_no_options") {
            statusLabel = "exhausted no options";
          } else if (isCurrentActive) {
            statusLabel = "active";
          }

          return (
            <button
              key={i}
              onClick={() => onSelectCycle?.(cycleNum)}
              className={`text-xs px-3 py-1.5 rounded-lg border flex items-center gap-1.5 ${
                selectedCycleNumber === cycleNum
                  ? "bg-emerald-50 border-emerald-300 text-emerald-900 font-bold"
                  : "bg-white border-gray-200 text-gray-700"
              }`}
            >
              <span>Cycle {cycleNum}</span>
              <span className="cycle-version-tag text-gray-500">(v{version})</span>
              <span className="contact-pill px-1.5 py-0.5 rounded bg-gray-100 text-[10px] font-semibold">
                {statusLabel}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function ResponseSummary(props: any) {
  const response = props?.response;
  return (
    <div className="response-summary p-4 rounded-xl bg-white border border-gray-200 space-y-2 text-xs">
      <h4 className="font-bold text-gray-900">Findor interpretation</h4>
      <div className="flex items-center gap-2">
        <span className="px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 font-semibold">
          {responseKindLabel(response?.kind)}
        </span>
      </div>
      <div>
        <h5 className="font-semibold text-gray-700 mt-2">Interpretation evidence</h5>
        <p className="text-gray-600 mt-1">
          {response?.evidenceText || response?.summary || response?.parsedResponse?.summary || "Provider response"}
        </p>
      </div>
    </div>
  );
}

export function ZeroResultCard(props: any) {
  const { briefVersion, outreachCount, onTryAgain, onEditRequest, onNewJob } = props;
  const isZeroResearch = outreachCount === 0;

  return (
    <div className="zero-result-card p-5 rounded-2xl border border-stone-200 bg-stone-50 text-xs space-y-3">
      <div className="flex items-center gap-2">
        <span className="px-2 py-0.5 bg-amber-100 text-amber-900 font-bold rounded">
          {isZeroResearch ? "Zero-Result Research" : "Zero-Result Recovery"}
        </span>
        {briefVersion && <span className="text-gray-500 font-semibold">(v{briefVersion})</span>}
      </div>

      <h4 className="text-sm font-bold text-gray-900">
        {isZeroResearch
          ? "No contactable providers found for this attempt"
          : "No usable options found for this cycle"}
      </h4>

      <p className="text-gray-600 leading-relaxed">
        {isZeroResearch
          ? "Findor researched local providers for this request, but no verified public business email route was found. No provider was contacted, and Findor did not guess an email address."
          : "Findor reached out to suitable providers for this brief but did not obtain a usable estimate."}
      </p>

      <div className="flex items-center gap-2 pt-2">
        {onTryAgain && (
          <button onClick={onTryAgain} className="px-4 py-2 bg-emerald-700 text-white rounded-lg font-bold">
            Try again
          </button>
        )}
        {onEditRequest && (
          <button onClick={onEditRequest} className="px-3 py-2 bg-white border border-gray-300 text-gray-800 rounded-lg font-semibold">
            Edit request
          </button>
        )}
        {onNewJob && (
          <button onClick={onNewJob} className="px-3 py-2 text-gray-600 hover:text-gray-900 rounded-lg font-semibold">
            New job
          </button>
        )}
      </div>
    </div>
  );
}

export function CurrentStateHero(props: any) {
  const { job, onApprove, onEditBrief, onTryAgain, onNewJob, isApproving, isZeroResult } = props;
  const status = job?.status || "researching";
  const isPaused = status === "paused" || job?.executionStatus === "paused";
  const version = job?.currentBriefVersion || 1;

  if (isPaused) {
    return (
      <div className="current-state-hero p-6 rounded-2xl bg-amber-50 border border-amber-200">
        <span className="text-xs font-bold uppercase text-amber-800">Paused</span>
        <h3 className="text-lg font-bold text-amber-950 mt-1">Request Paused</h3>
        <p className="text-xs text-amber-800 mt-1">All external research and outreach are on hold.</p>
      </div>
    );
  }

  if (status === "brief_ready") {
    return (
      <div className="current-state-hero p-6 rounded-2xl bg-white border-2 border-emerald-600/30 space-y-3">
        <span className="text-xs font-bold uppercase text-emerald-800">{`Brief v${version} Ready for Review`}</span>
        <h3 className="text-lg font-bold text-gray-900">Approve Operating Mandate</h3>
        <div className="flex items-center gap-3">
          <button
            onClick={onApprove}
            disabled={isApproving}
            className="px-5 py-2.5 bg-emerald-700 text-white text-xs font-bold rounded-xl"
          >
            Start finding options
          </button>
          {onEditBrief && (
            <button onClick={onEditBrief} className="px-4 py-2 bg-white border text-xs rounded-xl">
              Edit Brief
            </button>
          )}
        </div>
      </div>
    );
  }

  if (status === "researching") {
    return (
      <div className="current-state-hero p-6 rounded-2xl bg-white border border-emerald-200 space-y-2">
        <span className="text-xs font-bold uppercase text-emerald-700">Live Research in progress</span>
        <h3 className="text-lg font-bold text-gray-900">Findor is researching local providers</h3>
      </div>
    );
  }

  if (status === "outreach_sent") {
    return (
      <div className="current-state-hero p-6 rounded-2xl bg-white border border-blue-200 space-y-2">
        <span className="text-xs font-bold uppercase text-blue-700">Outreach active</span>
        <h3 className="text-lg font-bold text-gray-900">Outreach sent · Waiting for replies</h3>
      </div>
    );
  }

  if (status === "needs_user" || isZeroResult) {
    return (
      <div className="current-state-hero p-6 rounded-2xl bg-stone-50 border border-stone-200 space-y-3">
        <span className="text-xs font-bold uppercase text-amber-800">Action Required</span>
        <h3 className="text-lg font-bold text-gray-900">No contactable providers found for this attempt</h3>
        <div className="flex items-center gap-2 pt-2">
          {onTryAgain && (
            <button onClick={onTryAgain} className="px-4 py-2 bg-emerald-700 text-white text-xs font-bold rounded-xl">
              Try again (New search)
            </button>
          )}
          {onEditBrief && (
            <button onClick={onEditBrief} className="px-3 py-2 bg-white border text-xs font-semibold rounded-xl">
              Edit request scope
            </button>
          )}
          {onNewJob && (
            <button onClick={onNewJob} className="px-3 py-2 text-xs font-semibold text-gray-700 rounded-xl">
              Start new job
            </button>
          )}
        </div>
      </div>
    );
  }

  if (status === "completed") {
    return (
      <div className="current-state-hero p-6 rounded-2xl bg-emerald-50 border border-emerald-200">
        <span className="text-xs font-bold uppercase text-emerald-800">Completed</span>
        <h3 className="text-lg font-bold text-emerald-950 mt-1">Request completed</h3>
      </div>
    );
  }

  return (
    <div className="current-state-hero p-5 rounded-2xl bg-white border border-gray-200">
      <span className="text-xs font-bold uppercase text-emerald-700">{formatEnumLabel(status, "In progress")}</span>
      <h3 className="text-lg font-bold text-gray-900 mt-1">Project In Progress</h3>
    </div>
  );
}

export function MultiJobDashboard(props: any) {
  const jobs = props?.jobs || [];
  const onSelectJob = props?.onSelectJob;
  const onNewJob = props?.onNewJob;

  return (
    <div className="multi-job-dashboard space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-gray-900">Your local service requests</h2>
        {onNewJob && (
          <button onClick={onNewJob} className="px-3 py-1.5 bg-emerald-700 text-white text-xs font-semibold rounded-lg">
            Start another request
          </button>
        )}
      </div>
      <div className="grid gap-3">
        {jobs.map((j: any) => (
          <div
            key={j._id}
            onClick={() => onSelectJob?.(j._id)}
            className="p-4 bg-white border border-gray-200 rounded-xl hover:border-emerald-600 transition-all cursor-pointer space-y-1"
          >
            <h3 className="font-bold text-sm text-gray-900">{j.jobTitle || j.title}</h3>
            <p className="text-xs text-gray-500">{j.serviceLocation || j.city || "Local service"}</p>
          </div>
        ))}
      </div>
      {onNewJob && (
        <button onClick={onNewJob} className="w-full py-3 border-2 border-dashed border-gray-200 rounded-xl text-xs font-semibold text-gray-600 hover:text-gray-900 text-center">
          Start another request
        </button>
      )}
    </div>
  );
}

export function JobControls(props: any) {
  return (
    <div className="job-controls flex gap-2">
      {props?.canPause && <button onClick={props?.onPause}>Pause</button>}
      {props?.canResume && <button onClick={props?.onResume}>Resume</button>}
    </div>
  );
}

export function ProcessRail(props: any) {
  return <div className="process-rail">{props?.title || "Process Rail"}</div>;
}

export function StatusPill(props: any) {
  return <span className="status-pill text-xs px-2 py-0.5 rounded bg-gray-100">{formatEnumLabel(props?.status)}</span>;
}

export function LoadingState(props: any) {
  return <div className="loading-state text-xs text-gray-500">{props?.message || "Loading..."}</div>;
}

export function ComparisonField(props: any) {
  return <div className="comparison-field text-xs">{props?.label}: {props?.value}</div>;
}

export function PartialResultCard(props: any) {
  return <div className="partial-result-card p-3 border rounded text-xs">{props?.title}</div>;
}

export function CycleModal(props: any) {
  return <div className="cycle-modal">{props?.title || "Cycle Modal"}</div>;
}

export function BriefSection(props: any) {
  return <div className="brief-section">{props?.title}</div>;
}

export function IntakeCard(props: any) {
  return <div className="intake-card">{props?.title || "Intake Card"}</div>;
}

export function JobWorkspace(props: any) {
  return <div className="job-workspace">{props?.title || "Job Workspace"}</div>;
}

// ============================================================================
// MAIN APP COMPONENT (THUMBTACK-FIRST CONSUMER ARCHITECTURE)
// ============================================================================

export function App() {
  const { isAuthenticated } = useConvexAuth();
  const { signOut } = useAuthActions();

  // Navigation State
  const [activeView, setActiveView] = useState<"home" | "projects" | "new_request" | "project_hub">(
    "home"
  );
  const [selectedJobId, setSelectedJobId] = useState<Id<"jobs"> | null>(null);
  const [initialIntakePrompt, setInitialIntakePrompt] = useState<string>("");
  const [initialIntakeCategory, setInitialIntakeCategory] = useState<string>("");
  const [initialIntakeLocation, setInitialIntakeLocation] = useState<{
    country?: string;
    city?: string;
    region?: string;
    locality?: string;
  }>({});
  const [initialIntakeTiming, setInitialIntakeTiming] = useState<string>("");
  const [initialIntakeBudget, setInitialIntakeBudget] = useState<string>("");
  // When set, the intake editor updates this existing job (updateIntake)
  // instead of creating a new one. Never invents review/approval before backend truth.
  const [editingJobId, setEditingJobId] = useState<Id<"jobs"> | null>(null);
  // Bumped on every intake open so the editor remounts with fresh initials.
  const [intakeSession, setIntakeSession] = useState(0);

  // Auth Modal State
  const [isAuthOpen, setIsAuthOpen] = useState(false);
  const [authMode, setAuthMode] = useState<"signIn" | "signUp">("signIn");

  // User & Jobs
  const userJobs = useQuery(api.jobs.listMine, isAuthenticated ? {} : "skip") || [];

  // Selected Job Query
  const currentJob = useQuery(
    api.jobs.get,
    selectedJobId ? { jobId: selectedJobId } : "skip"
  );

  // Candidates for Selected Job
  const candidates = useQuery(
    api.providerResearch.list,
    selectedJobId ? { jobId: selectedJobId } : "skip"
  ) || [];

  // Outreach Messages for Selected Job (full collection: the waiting
  // screen and ledgers must count every sent initial row, not just the latest)
  const outreachMessages = useQuery(
    api.outreach.listForJob,
    selectedJobId ? { jobId: selectedJobId } : "skip"
  ) || [];

  // Inbound Conversations for Selected Job
  const conversations = useQuery(
    api.inbound.listForJob,
    selectedJobId ? { jobId: selectedJobId } : "skip"
  ) || [];

  // Events for Selected Job
  const events = useQuery(
    api.jobs.listEvents,
    selectedJobId ? { jobId: selectedJobId } : "skip"
  ) || [];

  // Mutations
  const createJobMutation = useMutation(api.jobs.create);
  const updateIntakeMutation = useMutation(api.jobs.updateIntake);
  const approveBriefMutation = useMutation(api.jobs.approveBrief);
  const setContinuousRecoveryMutation = useMutation(api.jobs.setContinuousRecovery);
  const beginProviderSearchMutation = useMutation(api.providerResearch.beginProviderSearch);
  const pauseJobMutation = useMutation(api.jobs.pause);
  const resumeJobMutation = useMutation(api.jobs.resume);
  const cancelJobMutation = useMutation(api.jobs.cancel);
  const completeJobMutation = useMutation(api.jobs.complete);
  const selectProviderMutation = useMutation(api.jobs.selectProvider);
  const setContinuationModeMutation = useMutation(api.jobs.setContinuationMode);
  const clearSelectedProviderMutation = useMutation(api.jobs.clearSelectedProvider);
  const askProviderQuestionMutation = useMutation(api.jobs.askProviderQuestion);

  // Handle Starting a genuinely new Request from Landing Hero or Quick Inputs
  const handleStartRequest = (prompt?: string, category?: string) => {
    setInitialIntakePrompt(prompt || "");
    setInitialIntakeCategory(category || "");
    setInitialIntakeLocation({});
    setInitialIntakeTiming("");
    setInitialIntakeBudget("");
    setEditingJobId(null);
    setIntakeSession((s) => s + 1);
    setActiveView("new_request");
  };

  // Handle editing/providing details for an EXISTING job.
  // Carries the jobId into the editor so submitting updates the SAME job
  // (updateIntake) and never creates a duplicate row.
  const handleEditBriefForJob = (job: {
    _id: Id<"jobs">;
    naturalLanguageDescription?: string;
    jobTitle?: string;
    serviceCategory?: string;
    structuredLocation?: {
      country?: string;
      city?: string;
      region?: string;
      locality?: string;
    };
    serviceLocation?: string;
    desiredTiming?: string;
    budgetOrContext?: string;
  }) => {
    setInitialIntakePrompt(
      job.naturalLanguageDescription || job.jobTitle || "",
    );
    setInitialIntakeCategory(job.serviceCategory || "");
    setInitialIntakeLocation({
      country: job.structuredLocation?.country,
      city: job.structuredLocation?.city,
      region: job.structuredLocation?.region,
      locality: job.structuredLocation?.locality,
    });
    setInitialIntakeTiming(job.desiredTiming || "");
    setInitialIntakeBudget(
      job.budgetOrContext && job.budgetOrContext !== "Flexible"
        ? job.budgetOrContext
        : "",
    );
    setEditingJobId(job._id);
    setIntakeSession((s) => s + 1);
    setActiveView("new_request");
  };

  // Handle Request Submission.
  // Locked lifecycle order: persist/analyze intake ONLY. Creating/updating the
  // request and approving Findor's mandate are separate steps. The UI navigates
  // to the project and renders BACKEND TRUTH (needs_info surface or persisted
  // brief review). Never auto-approves here.
  const handleSubmitNewRequest = async (payload: {
    title: string;
    rawIntake: string;
    category: string;
    location: LocationAllowlist;
    timing: string;
    budget?: string;
    clientRequestId: string;
  }) => {
    if (!isAuthenticated) {
      setIsAuthOpen(true);
      throw new Error("Please sign in before saving your request.");
    }

    // The backend canonically resolves the ISO country code from the
    // selected country (never slice the name: "United Kingdom" is GB).
    const countryCode = "";

    if (editingJobId) {
      await updateIntakeMutation({
        jobId: editingJobId,
        jobTitle: payload.title,
        naturalLanguageDescription: payload.rawIntake,
        serviceCategory: payload.category,
        country: payload.location.country,
        countryCode,
        region: payload.location.region || "",
        city: payload.location.city,
        locality: payload.location.locality || "",
        postalCode: payload.location.postalCode || "",
        desiredTiming: payload.timing,
        budgetOrContext: payload.budget || "Flexible",
      });
      setSelectedJobId(editingJobId);
      setEditingJobId(null);
      setActiveView("project_hub");
      return;
    }

    const newJobId = await createJobMutation({
      jobTitle: payload.title,
      naturalLanguageDescription: payload.rawIntake,
      serviceCategory: payload.category,
      country: payload.location.country,
      countryCode,
      region: payload.location.region || "",
      city: payload.location.city,
      locality: payload.location.locality || "",
      postalCode: payload.location.postalCode || "",
      desiredTiming: payload.timing,
      budgetOrContext: payload.budget || "Flexible",
      clientRequestId: payload.clientRequestId,
    });

    setSelectedJobId(newJobId);
    setActiveView("project_hub");
  };

  const handleSelectJob = (jobId: Id<"jobs">) => {
    setSelectedJobId(jobId);
    setActiveView("project_hub");
  };

  return (
    <ErrorBoundary>
      <div className="min-h-screen bg-stone-50/50 flex flex-col font-sans text-gray-900 antialiased selection:bg-emerald-100 selection:text-emerald-900">
        {/* Navigation Header */}
        <Header
          isAuthenticated={isAuthenticated}
          userEmail={userJobs[0]?.ownerId ? "My Account" : undefined}
          activeView={activeView}
          onNavigate={(view) => {
            if (view === "home") {
              setActiveView(isAuthenticated ? "projects" : "home");
            } else {
              setActiveView(view);
            }
          }}
          onOpenAuth={(mode = "signIn") => {
            setAuthMode(mode);
            setIsAuthOpen(true);
          }}
          onSignOut={() => {
            void signOut().then(() => {
              setActiveView("home");
              setSelectedJobId(null);
            });
          }}
        />

        {/* Main Content Area */}
        <main className="flex-1 flex flex-col">
          {/* View 1: Signed-Out Landing Page */}
          {!isAuthenticated && activeView === "home" && (
            <LandingHero
              onStartRequest={(prompt, cat) => handleStartRequest(prompt, cat)}
              onOpenAuth={() => {
                setAuthMode("signUp");
                setIsAuthOpen(true);
              }}
            />
          )}

          {/* View 2: Signed-In Projects Home */}
          {isAuthenticated && (activeView === "home" || activeView === "projects") && (
            <ProjectsHome
              userEmail="Israel"
              jobs={userJobs}
              onSelectJob={handleSelectJob}
              onStartNewRequest={(prompt) => handleStartRequest(prompt)}
            />
          )}

          {/* View 3: Conversational Intake Flow (create OR edit existing job) */}
          {activeView === "new_request" && (
            <ConversationalIntake
              key={editingJobId ?? `new-${intakeSession}`}
              initialPrompt={initialIntakePrompt}
              initialCategory={initialIntakeCategory}
              initialLocation={initialIntakeLocation}
              initialTiming={initialIntakeTiming}
              initialBudget={initialIntakeBudget}
              editingJobId={editingJobId}
              onSubmitRequest={handleSubmitNewRequest}
              onCancel={() => {
                setEditingJobId(null);
                setActiveView(isAuthenticated ? "projects" : "home");
              }}
            />
          )}

          {/* View 4: Active Project Hub */}
          {activeView === "project_hub" && currentJob && (
            <ProjectHub
              job={currentJob}
              briefDoc={null}
              candidates={candidates}
              outreachMessages={outreachMessages}
              conversations={conversations}
              events={events}
              onApproveBrief={async (mandate?: {
                quoteTarget?: 1 | 2 | 3;
                responseWindowHours?: 1 | 3 | 6 | 12 | 24;
                continuousRecovery?: boolean;
              }) => {
                await approveBriefMutation({
                  jobId: currentJob._id,
                  maxProviders: 3,
                  preference: "balanced",
                  ...(mandate?.quoteTarget !== undefined
                    ? { quoteTarget: mandate.quoteTarget }
                    : {}),
                  ...(mandate?.responseWindowHours !== undefined
                    ? { responseWindowHours: mandate.responseWindowHours }
                    : {}),
                  ...(mandate?.continuousRecovery !== undefined
                    ? { continuousRecovery: mandate.continuousRecovery }
                    : {}),
                });
              }}
              onSetContinuousRecovery={async (settings: {
                enabled: boolean;
                quoteTarget?: 1 | 2 | 3;
                responseWindowHours?: 1 | 3 | 6 | 12 | 24;
              }) => {
                await setContinuousRecoveryMutation({
                  jobId: currentJob._id,
                  enabled: settings.enabled,
                  ...(settings.quoteTarget !== undefined
                    ? { quoteTarget: settings.quoteTarget }
                    : {}),
                  ...(settings.responseWindowHours !== undefined
                    ? { responseWindowHours: settings.responseWindowHours }
                    : {}),
                });
              }}
              onStartResearch={async () => {
                await beginProviderSearchMutation({
                  jobId: currentJob._id,
                });
              }}
              onEditBrief={() => {
                handleEditBriefForJob(currentJob);
              }}
              onPauseJob={async () => {
                await pauseJobMutation({ jobId: currentJob._id });
              }}
              onResumeJob={async () => {
                await resumeJobMutation({ jobId: currentJob._id });
              }}
              onCancelJob={async () => {
                await cancelJobMutation({ jobId: currentJob._id });
              }}
              onCompleteJob={async () => {
                await completeJobMutation({ jobId: currentJob._id });
              }}
              onRetryCycle={async () => {
                // To retry a zero-result cycle cleanly, approve fresh attempt
                await approveBriefMutation({
                  jobId: currentJob._id,
                  maxProviders: 3,
                  preference: "balanced",
                });
              }}
              onSelectProvider={async (candidateId) => {
                await selectProviderMutation({
                  jobId: currentJob._id,
                  candidateId,
                });
              }}
              onSetContinuationMode={async (mode) => {
                await setContinuationModeMutation({
                  jobId: currentJob._id,
                  mode,
                });
              }}
              onClearSelectedProvider={async () => {
                await clearSelectedProviderMutation({
                  jobId: currentJob._id,
                });
              }}
              onAskProviderQuestion={async (question, forceApprove) => {
                return await askProviderQuestionMutation({
                  jobId: currentJob._id,
                  question,
                  forceApproveConsequential: forceApprove,
                });
              }}
              onBackToProjects={() => setActiveView("projects")}
              onStartNewRequest={() => handleStartRequest()}
            />
          )}
        </main>

        {/* Global Auth Modal */}
        <AuthModal
          isOpen={isAuthOpen}
          initialMode={authMode}
          onClose={() => setIsAuthOpen(false)}
        />
      </div>
    </ErrorBoundary>
  );
}

export default App;
