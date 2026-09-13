import {
  Authenticated,
  Unauthenticated,
  useAction,
  useConvexAuth,
  useMutation,
  useQuery,
} from "convex/react";
import { useAuthActions } from "@convex-dev/auth/react";
import type { FormEvent, ReactNode } from "react";
import { useState } from "react";
import { api } from "../convex/_generated/api";
import type { Doc, Id } from "../convex/_generated/dataModel";

type Job = Doc<"jobs">;
type JobEvent = Doc<"jobEvents">;

type IntakeValues = {
  serviceCategory: string;
  jobTitle: string;
  naturalLanguageDescription: string;
  serviceLocation: string;
  desiredTiming: string;
  budgetOrContext: string;
};

const categoryOptions = [
  "Other local service",
  "Moving",
  "Residential cleaning",
  "Roof replacement",
  "Electrical",
  "Plumbing",
  "HVAC",
  "Landscaping",
  "Painting",
  "Handyman",
];

const emptyIntake: IntakeValues = {
  serviceCategory: "Other local service",
  jobTitle: "",
  naturalLanguageDescription: "",
  serviceLocation: "",
  desiredTiming: "",
  budgetOrContext: "",
};

const statusCopy: Record<Job["status"], string> = {
  needs_info: "Needs a few details",
  brief_ready: "Ready for your review",
  brief_approved: "Brief approved",
  researching: "Researching providers",
  providers_ready: "Providers found",
  outreach_approved: "Outreach approved",
  outreach_sent: "Outreach sent",
  reply_received: "Reply received",
  reply_understood: "Reply understood",
  paused: "Paused",
  cancelled: "Cancelled",
  completed: "Completed",
  failed: "Needs attention",
};

export default function App() {
  return (
    <div className="app-shell">
      <SiteHeader />
      <main>
        <Authenticated>
          <Workspace />
        </Authenticated>
        <Unauthenticated>
          <AuthScreen />
        </Unauthenticated>
      </main>
    </div>
  );
}

function SiteHeader() {
  const { isAuthenticated } = useConvexAuth();
  const { signOut } = useAuthActions();

  return (
    <header className="site-header">
      <a className="brand" href="/" aria-label="Findor home">
        <span className="brand-mark">F</span>
        <span>findor</span>
      </a>
      <div className="header-actions">
        <span className="header-tag">Local services</span>
        {isAuthenticated && (
          <button
            className="text-button"
            type="button"
            onClick={() => void signOut()}
          >
            Sign out
          </button>
        )}
      </div>
    </header>
  );
}

function AuthScreen() {
  const { signIn } = useAuthActions();
  const [flow, setFlow] = useState<"signIn" | "signUp">("signUp");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);
    const formData = new FormData(event.currentTarget);
    formData.set("flow", flow);

    try {
      await signIn("password", formData);
    } catch (submissionError) {
      setError(
        submissionError instanceof Error
          ? submissionError.message
          : "We could not complete that request.",
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <section className="auth-layout">
      <div className="auth-story">
        <p className="eyebrow">A clearer way to get local work done</p>
        <h1>Turn an unclear service need into a decision you can trust.</h1>
        <p className="hero-copy">
          Findor helps people describe the job, understand what is still
          unknown, and prepare for comparable options from real local providers.
        </p>
        <div className="story-points">
          <StoryPoint
            number="01"
            title="Make the need clear"
            text="Start with plain language, not provider jargon."
          />
          <StoryPoint
            number="02"
            title="See the brief first"
            text="Review what will be shared before research begins."
          />
          <StoryPoint
            number="03"
            title="Stay in control"
            text="Every external step waits for your approval."
          />
        </div>
      </div>

      <div className="auth-card card">
        <div className="card-heading">
          <p className="eyebrow">
            {flow === "signUp" ? "Get started" : "Welcome back"}
          </p>
          <h2>
            {flow === "signUp"
              ? "Create your Findor account"
              : "Sign in to Findor"}
          </h2>
          <p className="muted">
            {flow === "signUp"
              ? "Your service request stays private to your account."
              : "Pick up where you left off with your local-service request."}
          </p>
        </div>
        <form
          className="stack-form"
          onSubmit={(event) => void handleSubmit(event)}
        >
          <label>
            Email
            <input
              name="email"
              type="email"
              autoComplete="email"
              placeholder="you@example.com"
              required
            />
          </label>
          <label>
            Password
            <input
              name="password"
              type="password"
              autoComplete={
                flow === "signUp" ? "new-password" : "current-password"
              }
              placeholder="At least 8 characters"
              minLength={8}
              required
            />
          </label>
          <button
            className="primary-button"
            type="submit"
            disabled={isSubmitting}
          >
            {isSubmitting
              ? "Working..."
              : flow === "signUp"
                ? "Create account"
                : "Sign in"}
          </button>
          
      {error && <p className="form-error">{error}</p>}
        </form>
        <button
          className="switch-button"
          type="button"
          onClick={() => {
            setError(null);
            setFlow(flow === "signUp" ? "signIn" : "signUp");
          }}
        >
          {flow === "signUp"
            ? "Already have an account? Sign in"
            : "New to Findor? Create an account"}
        </button>
      </div>
    </section>
  );
}

function StoryPoint({
  number,
  title,
  text,
}: {
  number: string;
  title: string;
  text: string;
}) {
  return (
    <div className="story-point">
      <span className="story-number">{number}</span>
      <div>
        <strong>{title}</strong>
        <p>{text}</p>
      </div>
    </div>
  );
}

function Workspace() {
  const user = useQuery(api.myFunctions.currentUser);
  const jobs = useQuery(api.jobs.listMine);

  const [creatingNewJob, setCreatingNewJob] = useState(false);

  if (user === undefined || user === null || jobs === undefined) {
    return <LoadingState />;
  }


  const savedJob = jobs[0] ?? null;
  const activeJob = creatingNewJob ? null : savedJob;
  return (
    <section className="workspace">
      <div className="workspace-intro">
        <div>
          <p className="eyebrow">Your local-service workspace</p>
          <h1>
            {activeJob
              ? activeJob.jobTitle
              : "Let’s make your service request clear"}
          </h1>
          <p className="hero-copy">
            {activeJob
              ? "Your brief is the source of truth for the next step."
              : "Tell us what you know. Findor will turn it into a structured brief you can review."}
          </p>
        </div>
        <div className="privacy-note">
          <span className="status-dot" />
          <span>Private to {user.email ?? "your account"}</span>
        </div>
      </div>
      {activeJob ? (
        <>
          <JobWorkspace job={activeJob} />
          {(activeJob.status === "completed" ||
            activeJob.status === "cancelled") && (
            <button
              className="new-request-button"
              type="button"
              onClick={() => setCreatingNewJob(true)}
            >
              Start another request
            </button>
          )}
        </>
      ) : (
        <IntakeCard />
      )}
    </section>
  );
}

function IntakeCard({ job }: { job?: Job }) {
  const createJob = useMutation(api.jobs.create);
  const updateIntake = useMutation(api.jobs.updateIntake);
  const [values, setValues] = useState<IntakeValues>(() =>
    job ? jobToIntake(job) : emptyIntake,
  );
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function updateField(field: keyof IntakeValues, value: string) {
    setValues((current) => ({ ...current, [field]: value }));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsSaving(true);
    try {
      if (job) {
        await updateIntake({ jobId: job._id, ...values });
      } else {
        await createJob(values);
      }
    } catch (submissionError) {
      setError(
        submissionError instanceof Error
          ? submissionError.message
          : "We could not save your request yet.",
      );
    } finally {
      setIsSaving(false);
    }
  }

  const isApproved = job
    ? job.status !== "needs_info" && job.status !== "brief_ready"
    : false;

  return (
    <div className="intake-layout">
      <div className="card intake-card">
        <div className="card-heading split-heading">
          <div>
            <p className="eyebrow">{job ? "Request intake" : "Step one"}</p>
            <h2>
              {job
                ? "Keep the request details accurate"
                : "What do you need done?"}
            </h2>
          </div>
          {job && <StatusPill status={job.status} />}
        </div>
        <p className="muted">
          Start in your own words. Findor will organize the request and ask for
          anything essential before research begins.
        </p>
        <form
          className="stack-form"
          onSubmit={(event) => void handleSubmit(event)}
        >
          <label>
            Service category
            <select
              value={values.serviceCategory}
              onChange={(event) =>
                updateField("serviceCategory", event.target.value)
              }
              disabled={isApproved}
            >
              {categoryOptions.map((category) => (
                <option key={category}>{category}</option>
              ))}
            </select>
            <span className="field-hint">
              Choose the closest category; your description remains the source
              of truth.
            </span>
          </label>
          <label>
            Request name <span className="optional-label">optional</span>
            <input
              value={values.jobTitle}
              onChange={(event) => updateField("jobTitle", event.target.value)}
              placeholder="Move a two-bedroom home"
              disabled={isApproved}
            />
          </label>
          <label>
            What do you need done?
            <textarea
              value={values.naturalLanguageDescription}
              onChange={(event) =>
                updateField("naturalLanguageDescription", event.target.value)
              }
              placeholder="Describe the outcome you want, what is involved, and anything urgent..."
              rows={4}
              disabled={isApproved}
              required
            />
            <span className="field-hint">
              Plain language is best. You can mention quantities, access,
              condition, or constraints.
            </span>
          </label>
          <div className="form-grid">
            <label>
              Where should the work happen?
              <input
                value={values.serviceLocation}
                onChange={(event) =>
                  updateField("serviceLocation", event.target.value)
                }
                placeholder="Austin, TX or a service address"
                disabled={isApproved}
                required
              />
            </label>
            <label>
              When do you need it?
              <input
                value={values.desiredTiming}
                onChange={(event) =>
                  updateField("desiredTiming", event.target.value)
                }
                placeholder="This spring, flexible"
                disabled={isApproved}
                required
              />
            </label>
          </div>
          <label>
            Budget or other context{" "}
            <span className="optional-label">optional</span>
            <textarea
              value={values.budgetOrContext}
              onChange={(event) =>
                updateField("budgetOrContext", event.target.value)
              }
              placeholder="Budget range, access notes, recurring preference, materials, or other context..."
              rows={3}
              disabled={isApproved}
            />
          </label>
          {!isApproved && (
            <button
              className="primary-button"
              type="submit"
              disabled={isSaving}
            >
              {isSaving
                ? "Saving your brief..."
                : job
                  ? "Update and review brief"
                  : "Create my job brief"}
            </button>
          )}
          
      {error && <p className="form-error">{error}</p>}
        </form>
      </div>
      <ProcessRail status={job?.status ?? "needs_info"} />
    </div>
  );
}

function JobWorkspace({ job }: { job: Job }) {
  const events = useQuery(api.jobs.listEvents, { jobId: job._id });
  const approveBrief = useMutation(api.jobs.approveBrief);
  const [isApproving, setIsApproving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleApprove() {
    setError(null);
    setIsApproving(true);
    try {
      await approveBrief({ jobId: job._id });
    } catch (approvalError) {
      setError(
        approvalError instanceof Error
          ? approvalError.message
          : "We could not approve the brief yet.",
      );
    } finally {
      setIsApproving(false);
    }
  }

  return (
    <div className="job-layout">
      <div className="job-main">
        <IntakeCard job={job} />
        <JobControls job={job} />
        {job.status === "needs_info" && (
          <div className="card attention-card">
            <span className="attention-icon">!</span>
            <div>
              <h3>A little more context will help</h3>
              <p>
                Once the required details are present, Findor will prepare a
                brief for you to review. Nothing is shared with a provider yet.
              </p>
              <ul>
                {job.missingFields.map((field) => (
                  <li key={field}>{field}</li>
                ))}
              </ul>
            </div>
          </div>
        )}
        {job.brief && (
          <BriefReview
            job={job}
            onApprove={() => void handleApprove()}
            isApproving={isApproving}
            error={error}
          />
        )}
        <ProviderResearch job={job} />
        <InboundConversation job={job} />
      </div>
      <Timeline events={events ?? []} />
    </div>
  );
}

function JobControls({ job }: { job: Job }) {
  const pauseJob = useMutation(api.jobs.pause);
  const resumeJob = useMutation(api.jobs.resume);
  const cancelJob = useMutation(api.jobs.cancel);
  const completeJob = useMutation(api.jobs.complete);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [confirmingCancel, setConfirmingCancel] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const hasActiveOperation = Boolean(job.activeOperation);
  const isClosed = job.status === "cancelled" || job.status === "completed";
  const canPause =
    !hasActiveOperation &&
    !["paused", "cancelled", "completed", "failed"].includes(job.status);
  const canCancel =
    !hasActiveOperation && !["cancelled", "completed"].includes(job.status);

  async function run(action: "pause" | "resume" | "cancel" | "complete") {
    setError(null);
    
    setPendingAction(action);
    try {
      if (action === "pause") await pauseJob({ jobId: job._id });
      if (action === "resume") await resumeJob({ jobId: job._id });
      if (action === "cancel") await cancelJob({ jobId: job._id });
      if (action === "complete") await completeJob({ jobId: job._id });
    } catch (controlError) {
      setError(
        controlError instanceof Error
          ? controlError.message
          : "This request could not be updated.",
      );
    } finally {
      setPendingAction(null);
    }
  }

  return (
    <section className="job-controls" aria-live="polite">
      {" "}
      {job.status === "paused" && (
        <div className="state-notice paused">
          <strong>Request paused</strong>
          <p>No new external work will start until you resume this request.</p>
        </div>
      )}
      {job.status === "cancelled" && (
        <div className="state-notice cancelled">
          <strong>Request cancelled</strong>
          <p>
            This request is closed. Nothing else will be sent or started from
            it.
          </p>
        </div>
      )}
      {job.status === "completed" && (
        <div className="state-notice completed">
          <strong>Request complete</strong>
          <p>
            This request is closed. Your record remains available for review.
          </p>
        </div>
      )}
      {job.status === "failed" && (
        <div className="state-notice cancelled">
          <strong>Needs attention</strong>
          <p>
            The last operation did not complete. Review the request record and
            retry the available step when it is offered.
          </p>
        </div>
      )}
      {hasActiveOperation && (
        <div className="state-notice">
          <strong>Findor is finishing an external step</strong>
          <p>
            Controls are temporarily locked so a retry or cancellation cannot
            interrupt the operation.
          </p>
        </div>
      )}
      <div className="control-actions">
        {" "}
        {job.status === "paused" && (
          <button
            className="secondary-button"
            type="button"
            onClick={() => void run("resume")}
            disabled={pendingAction !== null}
          >
            {pendingAction === "resume" ? "Resuming..." : "Resume request"}
          </button>
        )}
        {canPause && (
          <button
            className="secondary-button"
            type="button"
            onClick={() => void run("pause")}
            disabled={pendingAction !== null}
          >
            {pendingAction === "pause" ? "Pausing..." : "Pause request"}
          </button>
        )}
        {canCancel && (
          <button
            className="danger-button"
            type="button"
            onClick={() => {
              setError(null);
              setConfirmingCancel(true);
            }}
            disabled={pendingAction !== null || confirmingCancel}
          >
            {pendingAction === "cancel" ? "Cancelling..." : "Cancel request"}
          </button>
        )}
        {job.status === "reply_understood" && !hasActiveOperation && (
          <button
            className="primary-button compact-button"
            type="button"
            onClick={() => void run("complete")}
            disabled={pendingAction !== null}
          >
            {pendingAction === "complete"
              ? "Completing..."
              : "Mark request complete"}
          </button>
        )}
      </div>
      
      {confirmingCancel && (
        <div className="state-notice cancelled" role="alertdialog" aria-live="assertive">
          <strong>Cancel this request?</strong>
          <p>Findor will not start any further external work.</p>
          <div className="control-actions">
            <button
              className="secondary-button"
              type="button"
              onClick={() => setConfirmingCancel(false)}
              disabled={pendingAction !== null}
            >
              Keep request
            </button>
            <button
              className="danger-button"
              type="button"
              onClick={() => {
                setConfirmingCancel(false);
                void run("cancel");
              }}
              disabled={pendingAction !== null}
            >
              Confirm cancellation
            </button>
          </div>
        </div>
      )}
      {error && <p className="form-error">{error}</p>}
      {isClosed && (
        <p className="field-hint">
          Start another request whenever you are ready.
        </p>
      )}
    </section>
  );
}

function BriefReview({
  job,
  onApprove,
  isApproving,
  error,
}: {
  job: Job;
  onApprove: () => void;
  isApproving: boolean;
  error: string | null;
}) {
  const brief = job.brief;
  if (!brief) return null;

  return (
    <section className="card brief-card">
      <div className="card-heading split-heading">
        <div>
          <p className="eyebrow">Step two</p>
          <h2>Review your standardized brief</h2>
        </div>
        <StatusPill status={job.status} />
      </div>
      <p className="brief-summary">{brief.projectSummary}</p>
      <div className="brief-sections">
        <BriefSection title="Requested outcome">
          <p>{brief.requestedOutcome}</p>
        </BriefSection>
        <BriefSection title="Service and timing">
          <div className="detail-pairs">
            <span>Category</span>
            <strong>{brief.serviceCategory}</strong>
            <span>Location</span>
            <strong>{brief.serviceLocation}</strong>
            <span>Timing</span>
            <strong>{brief.desiredTiming}</strong>
          </div>
        </BriefSection>
        <BriefSection title="User-provided context">
          {brief.structuredRequirements.length > 0 ? (
            <ul className="clean-list">
              {brief.structuredRequirements.map((detail) => (
                <li key={detail.label}>
                  <strong>{detail.label}:</strong> {detail.value}
                </li>
              ))}
            </ul>
          ) : (
            <p>{brief.budgetOrContext}</p>
          )}
        </BriefSection>
        <BriefSection title="Still to confirm">
          <ul className="clean-list muted-list">
            {brief.unknowns.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </BriefSection>
      </div>
      {job.status === "brief_ready" ? (
        <div className="approval-panel">
          <div>
            <strong>Ready to move forward?</strong>
            <p>
              Approving this brief allows provider research to begin. It does
              not hire anyone or send an email.
            </p>
          </div>
          <button
            className="primary-button compact-button"
            type="button"
            onClick={onApprove}
            disabled={isApproving}
          >
            {isApproving ? "Approving..." : "Approve brief"}
          </button>
        </div>
      ) : (
        <div className="approved-panel">
          <span className="check-mark">✓</span>
          <div>
            <strong>Brief approved</strong>
            <p>
              Provider research is the next step. Findor will ask before any
              external outreach.
            </p>
          </div>
        </div>
      )}
      
      {error && <p className="form-error">{error}</p>}
    </section>
  );
}

function BriefSection({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="brief-section">
      <h3>{title}</h3>
      {children}
    </div>
  );
}

function ProcessRail({ status }: { status: Job["status"] }) {
  const steps = [
    { label: "Describe the service", complete: true },
    { label: "Review the brief", complete: status !== "needs_info" },
    {
      label: "Research providers",
      complete: [
        "providers_ready",
        "outreach_approved",
        "outreach_sent",
        "reply_received",
        "reply_understood",
      ].includes(status),
    },
    {
      label: "Approve outreach",
      complete: [
        "outreach_approved",
        "outreach_sent",
        "reply_received",
        "reply_understood",
      ].includes(status),
    },
    {
      label: "Review provider replies",
      complete: ["reply_received", "reply_understood"].includes(status),
    },
  ];

  return (
    <aside className="process-rail">
      <p className="eyebrow">How Findor works</p>
      <div className="rail-steps">
        {steps.map((step, index) => (
          <div
            className={"rail-step " + (step.complete ? "complete" : "")}
            key={step.label}
          >
            <span className="rail-marker">
              {step.complete ? "✓" : index + 1}
            </span>
            <div>
              <strong>{step.label}</strong>
              <p>
                {index === 0
                  ? "Your words become the starting point."
                  : index === 1
                    ? "You check the facts and unknowns."
                    : index === 2
                      ? "Real research comes after approval."
                      : "Replies stay source-linked and user-controlled."}
              </p>
            </div>
          </div>
        ))}
      </div>
      <div className="guardrail-note">
        <span className="lock-icon">◇</span>
        <p>
          Findor never accepts a quote, hires a provider, signs a contract, or
          spends money for you.
        </p>
      </div>
    </aside>
  );
}

function Timeline({ events }: { events: JobEvent[] }) {
  return (
    <aside className="timeline card">
      <div className="card-heading">
        <p className="eyebrow">Request record</p>
        <h2>What has happened</h2>
      </div>
      <div className="timeline-list">
        {events.length === 0 ? (
          <p className="muted">
            Your request record will appear here as you make decisions.
          </p>
        ) : (
          events.map((event) => (
            <div className="timeline-item" key={event._id}>
              <span className="timeline-dot" />
              <div>
                <strong>{event.message}</strong>
                <time>{formatEventTime(event.createdAt)}</time>
              </div>
            </div>
          ))
        )}
      </div>
      <div className="record-note">
        Every milestone is persisted so you can see exactly what Findor has
        done.
      </div>
    </aside>
  );
}

function StatusPill({ status }: { status: Job["status"] }) {
  return (
    <span className={"status-pill status-" + status}>{statusCopy[status]}</span>
  );
}

function LoadingState() {
  return (
    <section className="loading-state">
      <div className="loading-orb" />
      <p>Loading your private workspace...</p>
    </section>
  );
}

function jobToIntake(job: Job): IntakeValues {
  return {
    serviceCategory: job.serviceCategory,
    jobTitle: job.jobTitle,
    naturalLanguageDescription: job.naturalLanguageDescription,
    serviceLocation: job.serviceLocation,
    desiredTiming: job.desiredTiming,
    budgetOrContext: job.budgetOrContext,
  };
}

function formatEventTime(timestamp: number) {
  return new Date(timestamp).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function ProviderResearch({ job }: { job: Job }) {
  const candidates = useQuery(api.providerResearch.list, { jobId: job._id });
  const outreach = useQuery(api.outreach.getForJob, { jobId: job._id });
  const searchProviders = useAction(api.providerResearch.search);
  const discoverContacts = useAction(api.providerResearch.discoverContacts);
  const approveProvider = useMutation(api.outreach.approveProvider);
  const sendApproved = useAction(api.outreach.sendApproved);
  const [isSearching, setIsSearching] = useState(false);
  const [isDiscoveringContacts, setIsDiscoveringContacts] = useState(false);
  const [contactDiscoverySummary, setContactDiscoverySummary] = useState<{
    providerCount: number;
    emailFoundCount: number;
    unresolvedCount: number;
    failedCount: number;
    checkedPageCount: number;
  } | null>(null);
  const [busyCandidateId, setBusyCandidateId] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (job.status === "needs_info" || job.status === "brief_ready") {
    return null;
  }

  async function handleSearch() {
    setError(null);
    setIsSearching(true);
    try {
      await searchProviders({ jobId: job._id });
    } catch (searchError) {
      setError(
        searchError instanceof Error
          ? searchError.message
          : "Provider research could not complete.",
      );
    } finally {
      setIsSearching(false);
    }
  }

  async function handleDiscoverContacts() {
    setError(null);
    setIsDiscoveringContacts(true);
    try {
      const result = await discoverContacts({ jobId: job._id });
      setContactDiscoverySummary(result);
    } catch (discoveryError) {
      setError(
        discoveryError instanceof Error
          ? discoveryError.message
          : "Public contact discovery could not complete.",
      );
    } finally {
      setIsDiscoveringContacts(false);
    }
  }

  async function handleApprove(candidateId: Id<"providerCandidates">) {
    setError(null);
    setBusyCandidateId(candidateId);
    try {
      await approveProvider({ candidateId });
    } catch (approvalError) {
      setError(
        approvalError instanceof Error
          ? approvalError.message
          : "This provider could not be approved.",
      );
    } finally {
      setBusyCandidateId(null);
    }
  }

  async function handleSend() {
    setError(null);
    setIsSending(true);
    try {
      await sendApproved({ jobId: job._id });
    } catch (sendError) {
      setError(
        sendError instanceof Error
          ? sendError.message
          : "AgentMail could not send the message.",
      );
    } finally {
      setIsSending(false);
    }
  }

  return (
    <section className="card provider-section">
      <div className="card-heading split-heading">
        <div>
          <p className="eyebrow">Step three</p>
          <h2>Research local providers</h2>
        </div>
        <StatusPill status={job.status} />
      </div>
      <p className="muted provider-intro">
        Findor searches public provider pages for this service and keeps the
        source evidence visible. A result is a lead, not a verification or
        recommendation.
      </p>

      {job.status === "brief_approved" && (
        <div className="research-start">
          <div>
            <strong>Ready to search the public web</strong>
            <p>
              We will look for {job.serviceCategory.toLowerCase()} providers
              around {job.serviceLocation}.
            </p>
          </div>
          <button
            className="primary-button compact-button"
            type="button"
            onClick={() => void handleSearch()}
            disabled={isSearching}
          >
            {isSearching ? "Searching..." : "Find local providers"}
          </button>
        </div>
      )}

      {job.status === "researching" && (
        <div className="research-progress">
          <div className="loading-orb small-orb" />
          <div>
            <strong>Searching source pages</strong>
            <p>
              Findor is collecting public evidence. No provider has been
              contacted.
            </p>
          </div>
        </div>
      )}

      {job.status === "providers_ready" && (
        <div className="provider-results">
          {candidates &&
            candidates.some(
              (candidate) => candidate.contactability === "website_only",
            ) && (
              <div className="research-start contact-discovery-start">
                <div>
                  <strong>Check public contact pages</strong>
                  <p>
                    Findor will map each provider domain and scrape only a small
                    set of likely contact or quote pages.
                  </p>
                </div>
                <button
                  className="primary-button compact-button"
                  type="button"
                  onClick={() => void handleDiscoverContacts()}
                  disabled={
                    isDiscoveringContacts || Boolean(job.activeOperation)
                  }
                >
                  {isDiscoveringContacts
                    ? "Checking contact pages..."
                    : "Check contact pages"}
                </button>
              </div>
            )}
          {contactDiscoverySummary && (
            <p className="muted">
              Checked {contactDiscoverySummary.providerCount} provider domain(s)
              across {contactDiscoverySummary.checkedPageCount} public page(s):{" "}
              {contactDiscoverySummary.emailFoundCount} public email route(s)
              found, {contactDiscoverySummary.unresolvedCount} unresolved,{" "}
              {contactDiscoverySummary.failedCount} failed.
            </p>
          )}
          {candidates === undefined ? (
            <p className="muted">Loading source-backed results...</p>
          ) : candidates.length === 0 ? (
            <p className="muted">
              No source-backed candidates were found for this service and
              location yet.
            </p>
          ) : (
            candidates.map((candidate) => (
              <article className="provider-card" key={candidate._id}>
                <div className="provider-topline">
                  <div>
                    <h3>{candidate.name}</h3>
                    <p>{candidate.description}</p>
                  </div>
                  <span
                    className={
                      candidate.contactEmail
                        ? "contact-pill contact-email"
                        : "contact-pill"
                    }
                  >
                    {candidate.contactEmail ? "Email found" : "Website only"}
                  </span>
                </div>
                <div className="provider-meta">
                  <a href={candidate.url} target="_blank" rel="noreferrer">
                    View source evidence
                  </a>
                  <span>
                    {candidate.contactEmail
                      ? "Published contact: " + candidate.contactEmail
                      : candidate.contactDiscoveryStatus === "failed"
                        ? "Contact-page check failed; no contactability claim was made."
                        : candidate.contactDiscoveryStatus === "unresolved"
                          ? "No public business email was found on the checked contact pages."
                          : "No published email was found on the source page."}
                  </span>
                </div>
                <div className="provider-evidence">
                  {candidate.evidence.map((item) => (
                    <div key={item.sourceUrl}>
                      <a href={item.sourceUrl} target="_blank" rel="noreferrer">
                        Source: {item.sourceUrl}
                      </a>
                      <p>{item.claim}</p>
                    </div>
                  ))}
                </div>
                {candidate.contactDiscoveryCheckedAt && (
                  <p className="muted">
                    Contact pages checked:{" "}
                    {new Date(
                      candidate.contactDiscoveryCheckedAt,
                    ).toLocaleString()}
                  </p>
                )}
                {candidate.contactEmail ? (
                  <button
                    className="secondary-button"
                    type="button"
                    onClick={() => void handleApprove(candidate._id)}
                    disabled={busyCandidateId === candidate._id}
                  >
                    {busyCandidateId === candidate._id
                      ? "Preparing draft..."
                      : "Approve provider and prepare email"}
                  </button>
                ) : (
                  <p className="provider-boundary">
                    {candidate.contactDiscoveryStatus === "failed"
                      ? "Findor could not complete this contact-page check and made no contactability claim."
                      : "Findor will not guess a contact address. This source can be reviewed manually."}
                  </p>
                )}
              </article>
            ))
          )}
        </div>
      )}

      {outreach && (
        <div className="outreach-draft">
          <div className="draft-heading">
            <div>
              <p className="eyebrow">Step four</p>
              <h3>Review the outreach draft</h3>
            </div>
            <span
              className={
                outreach.status === "sent"
                  ? "contact-pill contact-email"
                  : outreach.status === "failed"
                    ? "contact-pill contact-failed"
                    : "contact-pill"
              }
            >
              {outreach.status === "sent"
                ? "Sent"
                : outreach.status === "failed"
                  ? "Send failed"
                  : outreach.status === "sending"
                    ? "Sending"
                    : "Awaiting send"}
            </span>
          </div>
          <div className="draft-details">
            <span>To</span>
            <strong>{outreach.providerEmail}</strong>
            <span>Subject</span>
            <strong>{outreach.subject}</strong>
          </div>
          <p className="draft-body">{outreach.body}</p>
          {outreach.status === "sent" ? (
            <div className="approved-panel">
              <span className="check-mark">✓</span>
              <div>
                <strong>External email accepted</strong>
                <p>
                  AgentMail returned a real message receipt:{" "}
                  {outreach.externalMessageId ?? "recorded"}
                  {outreach.externalThreadId
                    ? " in thread " + outreach.externalThreadId
                    : ""}
                  .
                </p>
              </div>
            </div>
          ) : outreach.status === "sending" ? (
            <div className="research-progress">
              <div className="loading-orb small-orb" />
              <div>
                <strong>Sending through AgentMail</strong>
                <p>
                  Findor is waiting for the external receipt. Do not refresh to
                  retry.
                </p>
              </div>
            </div>
          ) : (
            <div className="approval-panel">
              <div>
                <strong>
                  {outreach.status === "failed"
                    ? "Try sending again"
                    : "Send only when you are ready"}
                </strong>
                <p>
                  {outreach.status === "failed"
                    ? outreach.failureReason
                    : "This message is exploratory. It does not hire a provider or authorize work."}
                </p>
              </div>
              <button
                className="primary-button compact-button"
                type="button"
                onClick={() => void handleSend()}
                disabled={
                  isSending ||
                  job.status !== "outreach_approved" ||
                  Boolean(job.activeOperation)
                }
              >
                {isSending
                  ? "Sending..."
                  : job.status !== "outreach_approved"
                    ? "Sending unavailable"
                    : outreach.status === "failed"
                      ? "Retry send"
                      : "Send this email"}
              </button>
            </div>
          )}
        </div>
      )}

      
      {error && <p className="form-error">{error}</p>}
    </section>
  );
}

function InboundConversation({ job }: { job: Job }) {
  const items = useQuery(api.inbound.listForJob, { jobId: job._id });
  const comparisons = useQuery(api.inbound.listComparisons, { jobId: job._id });
  const suggestions = useQuery(api.inbound.getClarificationSuggestions, {
    jobId: job._id,
  });
  const clarifications = useQuery(api.inbound.listClarifications, {
    jobId: job._id,
  });
  const prepareClarification = useMutation(api.inbound.prepareClarification);
  const downloadAttachment = useAction(api.inbound.downloadAttachment);
  const [busyAttachmentId, setBusyAttachmentId] =
    useState<Id<"inboundAttachments"> | null>(null);
  const [busyClarification, setBusyClarification] = useState<string | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);

  const shouldShow =
    (items?.length ?? 0) > 0 ||
    [
      "outreach_sent",
      "reply_received",
      "reply_understood",
      "completed",
    ].includes(job.status);
  if (!shouldShow) return null;

  async function handleDownload(attachmentId: Id<"inboundAttachments">) {
    setError(null);
    setBusyAttachmentId(attachmentId);
    try {
      const result = await downloadAttachment({ attachmentId });
      window.open(result.url, "_blank", "noopener,noreferrer");
    } catch (downloadError) {
      setError(
        downloadError instanceof Error
          ? downloadError.message
          : "Attachment could not be retrieved.",
      );
    } finally {
      setBusyAttachmentId(null);
    }
  }

  async function handlePrepareClarification(attribute: string) {
    setError(null);
    setBusyClarification(attribute);
    try {
      await prepareClarification({ jobId: job._id, attribute });
    } catch (clarificationError) {
      setError(
        clarificationError instanceof Error
          ? clarificationError.message
          : "Clarification draft could not be prepared.",
      );
    } finally {
      setBusyClarification(null);
    }
  }

  return (
    <section className="card conversation-section">
      <div className="card-heading split-heading">
        <div>
          <p className="eyebrow">Step five</p>
          <h2>Provider replies and comparison</h2>
        </div>
        <span
          className={
            job.status === "reply_understood"
              ? "contact-pill contact-email"
              : job.status === "reply_received"
                ? "contact-pill contact-email"
                : "contact-pill"
          }
        >
          {job.status === "reply_understood"
            ? "Reply understood"
            : job.status === "reply_received"
              ? "Reply received"
              : "Waiting for reply"}
        </span>
      </div>
      <p className="muted">
        Findor listens for replies on the approved AgentMail thread. The
        original provider message stays visible; any structured understanding is
        an interpretation layer, not a replacement for it.
      </p>

      {items === undefined ? (
        <p className="muted">Listening for provider replies...</p>
      ) : items.length === 0 ? (
        <div className="waiting-panel">
          <strong>Waiting for a provider reply</strong>
          <p>
            No reply has arrived on this outreach thread yet. Findor will update
            this view in real time when one does.
          </p>
        </div>
      ) : (
        <div className="conversation-list">
          {items.map((item) => (
            <article
              className="inbound-message"
              id={"inbound-" + item.message._id}
              key={item.message._id}
            >
              <div className="inbound-topline">
                <div>
                  <p className="eyebrow">Provider message</p>
                  <h3>{item.message.subject}</h3>
                  <p className="muted">From {item.message.sender}</p>
                </div>
                <span
                  className={
                    item.message.processingStatus === "understood"
                      ? "contact-pill contact-email"
                      : item.message.processingStatus === "failed"
                        ? "contact-pill contact-failed"
                        : "contact-pill"
                  }
                >
                  {processingStatusCopy(item.message.processingStatus)}
                </span>
              </div>
              <time className="inbound-time">
                {new Date(item.message.receivedAt).toLocaleString()}
              </time>
              <pre className="inbound-body">
                {item.message.bodyText || "No plain-text body was included."}
              </pre>

              {item.attachments.length > 0 && (
                <div className="attachment-list">
                  <strong>Attachments</strong>
                  {item.attachments.map((attachment) => (
                    <div className="attachment-row" key={attachment._id}>
                      <span>
                        {attachment.filename ?? "Unnamed attachment"}
                        {attachment.contentType
                          ? " · " + attachment.contentType
                          : ""}
                        {attachment.size !== undefined
                          ? " · " + formatBytes(attachment.size)
                          : ""}
                      </span>
                      <button
                        className="text-button"
                        type="button"
                        onClick={() => void handleDownload(attachment._id)}
                        disabled={busyAttachmentId === attachment._id}
                      >
                        {busyAttachmentId === attachment._id
                          ? "Retrieving..."
                          : attachment.storageStatus === "downloaded"
                            ? "Open stored copy"
                            : "Retrieve safely"}
                      </button>
                    </div>
                  ))}
                  <p className="field-hint">
                    Attachments are treated as untrusted files and are never
                    executed by Findor.
                  </p>
                </div>
              )}

              {item.message.processingStatus === "unmatched" ? (
                <div className="guardrail-note">
                  <span className="lock-icon">◇</span>
                  <p>
                    This message could not be safely mapped to an existing
                    Findor thread, so it was quarantined without attaching it to
                    a user's job.
                  </p>
                </div>
              ) : item.response ? (
                <ResponseSummary response={item.response} />
              ) : item.message.processingStatus === "needs_review" ? (
                <div className="waiting-panel">
                  <strong>Understanding needs review</strong>
                  <p>
                    {item.message.understandingError ??
                      "The original message is available, but no structured interpretation is recorded."}
                  </p>
                </div>
              ) : item.message.processingStatus === "failed" ? (
                <div className="waiting-panel">
                  <strong>Original message preserved</strong>
                  <p>
                    {item.message.understandingError ??
                      "Findor could not structure this reply."}
                  </p>
                </div>
              ) : (
                <div className="research-progress">
                  <div className="loading-orb small-orb" />
                  <div>
                    <strong>Understanding reply</strong>
                    <p>
                      Findor is preparing a source-linked interpretation. No
                      external action will be taken.
                    </p>
                  </div>
                </div>
              )}
            </article>
          ))}
        </div>
      )}

      {comparisons && comparisons.length > 0 && (
        <section className="comparison-section">
          <div className="card-heading">
            <p className="eyebrow">Apples to apples</p>
            <h3>Offers and responses</h3>
            <p className="muted">
              A provider is not ranked as best merely because its stated price
              is lower. Unmentioned details remain not stated.
            </p>
          </div>
          <div className="comparison-list">
            {comparisons.map((comparison) => (
              <article
                className="comparison-card"
                key={comparison.response._id}
              >
                <div className="comparison-title">
                  <div>
                    <h3>{comparison.providerName}</h3>
                    <a
                      href={comparison.providerUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Provider source
                    </a>
                  </div>
                  <span className="contact-pill">
                    {responseKindLabel(comparison.response.kind)}
                  </span>
                </div>
                <div className="comparison-fields">
                  <ComparisonField
                    label="Price"
                    value={
                      comparison.response.headlinePrice ??
                      priceRange(comparison.response)
                    }
                  />
                  <ComparisonField
                    label="Availability"
                    value={comparison.response.availability}
                  />
                  <ComparisonField
                    label="Timing"
                    value={comparison.response.estimatedTiming}
                  />
                  <ComparisonField
                    label="Included"
                    value={formatList(comparison.response.included)}
                  />
                  <ComparisonField
                    label="Excluded"
                    value={formatList(comparison.response.excluded)}
                  />
                  <ComparisonField
                    label="Not stated"
                    value={formatList(comparison.response.notStated)}
                  />
                  <ComparisonField
                    label="Unclear"
                    value={formatList(comparison.response.unclear)}
                  />
                  <ComparisonField
                    label="Payment terms"
                    value={comparison.response.paymentTerms}
                  />
                  <ComparisonField
                    label="Warranty"
                    value={comparison.response.warranty}
                  />
                  <ComparisonField
                    label="Provider questions"
                    value={formatList(comparison.response.informationNeeded)}
                  />
                </div>
                <p className="evidence-quote">
                  Source evidence: {comparison.response.evidenceText}
                </p>
                <a
                  className="source-message-link"
                  href={"#inbound-" + comparison.response.inboundMessageId}
                >
                  View original provider message
                </a>
              </article>
            ))}
          </div>
        </section>
      )}

      {suggestions && suggestions.length > 0 && (
        <section className="clarification-section">
          <div className="card-heading">
            <p className="eyebrow">Approval boundary</p>
            <h3>Clarification suggested</h3>
            <p className="muted">
              Findor may prepare a clarification when providers describe the
              same scope differently. It never sends this message automatically.
            </p>
          </div>
          {suggestions.map((suggestion) => (
            <div
              className="clarification-card"
              key={
                suggestion.attribute +
                suggestion.sourceResponseId +
                suggestion.comparisonResponseId
              }
            >
              <strong>{suggestion.reason}</strong>
              <p className="proposed-message">“{suggestion.proposedMessage}”</p>
              <button
                className="secondary-button"
                type="button"
                onClick={() =>
                  void handlePrepareClarification(suggestion.attribute)
                }
                disabled={busyClarification === suggestion.attribute}
              >
                {busyClarification === suggestion.attribute
                  ? "Preparing..."
                  : "Prepare clarification draft"}
              </button>
            </div>
          ))}
        </section>
      )}

      {clarifications && clarifications.length > 0 && (
        <section className="clarification-section">
          <div className="card-heading">
            <p className="eyebrow">Draft record</p>
            <h3>Prepared clarifications</h3>
          </div>
          {clarifications.map((clarification) => (
            <div className="clarification-card" key={clarification._id}>
              <strong>{clarification.attribute}</strong>
              <p>{clarification.proposedMessage}</p>
              <span className="muted">
                Status: {clarification.status}. Explicit approval is required
                before any outbound message, and no send action is implemented
                here.
              </span>
            </div>
          ))}
        </section>
      )}

      
      {error && <p className="form-error">{error}</p>}
    </section>
  );
}

function ResponseSummary({ response }: { response: Doc<"providerResponses"> }) {
  return (
    <div className="response-summary">
      <div className="response-heading">
        <div>
          <p className="eyebrow">Findor interpretation</p>
          <h3>{responseKindLabel(response.kind)}</h3>
        </div>
        <span className="muted">Source-linked; model: {response.model}</span>
      </div>
      <div className="response-fields">
        <ComparisonField
          label="Price"
          value={response.headlinePrice ?? priceRange(response)}
        />
        <ComparisonField label="Currency" value={response.currency} />
        <ComparisonField label="Availability" value={response.availability} />
        <ComparisonField
          label="Estimated timing"
          value={response.estimatedTiming}
        />
        <ComparisonField
          label="Included"
          value={formatList(response.included)}
        />
        <ComparisonField
          label="Excluded"
          value={formatList(response.excluded)}
        />
        <ComparisonField
          label="Not stated"
          value={formatList(response.notStated)}
        />
        <ComparisonField label="Unclear" value={formatList(response.unclear)} />
        <ComparisonField label="Payment terms" value={response.paymentTerms} />
        <ComparisonField label="Warranty" value={response.warranty} />
        <ComparisonField
          label="Inspection / site visit"
          value={response.inspectionRequirement}
        />
        <ComparisonField
          label="Information needed"
          value={formatList(response.informationNeeded)}
        />
      </div>
      <p className="evidence-quote">
        Interpretation evidence: {response.evidenceText}
      </p>
    </div>
  );
}

function ComparisonField({
  label,
  value,
}: {
  label: string;
  value: string | null | undefined;
}) {
  return (
    <div className="comparison-field">
      <span>{label}</span>
      <strong>{value || "Not stated"}</strong>
    </div>
  );
}

function processingStatusCopy(status: string) {
  return status === "understood"
    ? "Understood"
    : status === "understanding"
      ? "Understanding"
      : status === "needs_review"
        ? "Needs review"
        : status === "unmatched"
          ? "Quarantined"
          : status === "failed"
            ? "Needs review"
            : "Reply received";
}

function responseKindLabel(kind: string) {
  return kind.replace("_", " ");
}

function formatList(values: string[]) {
  return values.length > 0 ? values.join(", ") : "Not stated";
}

function priceRange(
  response: Pick<
    Doc<"providerResponses">,
    "priceMin" | "priceMax" | "currency"
  >,
) {
  if (response.priceMin === undefined && response.priceMax === undefined)
    return "Not stated";
  const currency = response.currency ? response.currency + " " : "";
  if (response.priceMin !== undefined && response.priceMax !== undefined) {
    return currency + response.priceMin + "–" + response.priceMax;
  }
  return currency + (response.priceMin ?? response.priceMax);
}

function formatBytes(size: number) {
  if (size < 1024) return size + " B";
  if (size < 1024 * 1024) return (size / 1024).toFixed(1) + " KB";
  return (size / (1024 * 1024)).toFixed(1) + " MB";
}
