import type { Doc, Id } from "../convex/_generated/dataModel";

export type ConsumerProjectState =
  | "needs_details"
  | "ready_for_review"
  | "ready_to_search"
  | "researching"
  | "providers_ready"
  | "outreach_in_flight"
  | "waiting_for_replies"
  | "needs_decision"
  | "options_ready"
  | "provider_selected"
  | "findor_assisted"
  | "user_takeover"
  | "paused"
  | "cancelled"
  | "completed"
  | "unknown_state";

export interface ConsumerStateContext {
  candidates?: Array<{
    _id: Id<"providerCandidates">;
    cycleId?: Id<"jobCycles">;
    name?: string;
    url?: string;
    description?: string;
    entityType?: "provider" | "discovery_source";
    contactability?: "email_found" | "website_only";
    contactEmail?: string;
  }>;
  responses?: Array<Doc<"providerResponses"> | null | undefined>;
  outreachMessages?: Array<{
    _id?: Id<"outreachMessages">;
    candidateId?: Id<"providerCandidates">;
    cycleId?: Id<"jobCycles">;
    status?: string;
    purpose?: string;
    providerResolution?: string;
    sendAttemptCount?: number;
    lastAttemptAt?: number;
  }>;
}

export type NeedsUserOutcome =
  | "failed_outreach"
  | "website_only"
  | "zero_results"
  | "technical_failure"
  | "neutral";

function isInitialOutreach(message: { purpose?: string }) {
  return !message.purpose || message.purpose === "initial";
}

function isCurrentCycleRecord(
  record: { cycleId?: Id<"jobCycles"> },
  currentCycleId?: Id<"jobCycles">,
) {
  // Once a job has a persisted current cycle, an unscoped historical record
  // must not be allowed to define the current cycle's outcome. Legacy jobs
  // without a current cycle retain their all-history behavior.
  return currentCycleId ? record.cycleId === currentCycleId : true;
}

/**
 * Resolve the consumer-facing needs-user outcome from the active cycle only.
 * The persisted job stop reason is intentionally a fallback: it can describe
 * an older cycle and must not override a current website-only or zero-result
 * outcome.
 */
export function resolveNeedsUserOutcome(
  job: Partial<Doc<"jobs">> | null | undefined,
  context?: Pick<ConsumerStateContext, "candidates" | "outreachMessages">,
): NeedsUserOutcome {
  if (!job || typeof job !== "object") return "neutral";

  const currentCycleId = job.currentCycleId;
  const candidates = (context?.candidates || []).filter((candidate) =>
    isCurrentCycleRecord(candidate, currentCycleId),
  );
  const messages = (context?.outreachMessages || []).filter(
    (message) =>
      isCurrentCycleRecord(message, currentCycleId) &&
      isInitialOutreach(message),
  );

  const hasFailedOutbound = messages.some(
    (message) =>
      message.status === "failed" &&
      (message.providerResolution === "send_failed" ||
        (message.sendAttemptCount ?? 0) > 0 ||
        message.lastAttemptAt != null),
  );
  if (hasFailedOutbound) return "failed_outreach";

  const stopReason = job.autonomyStopReason || "";
  if (
    job.status === "failed" ||
    /could not complete|couldn't finish|technical|search failed/i.test(stopReason)
  ) {
    return "technical_failure";
  }

  const providerCandidates = candidates.filter(
    (candidate) => candidate.entityType !== "discovery_source",
  );
  if (providerCandidates.length > 0) {
    const hasContactableProvider = providerCandidates.some(
      (candidate) =>
        candidate.contactability === "email_found" &&
        Boolean(candidate.contactEmail?.trim()),
    );
    if (!hasContactableProvider) return "website_only";
  } else if (candidates.length === 0) {
    return "zero_results";
  }

  return "neutral";
}

export function resolveConsumerProjectState(
  job: Partial<Doc<"jobs">> | null | undefined,
  context?: ConsumerStateContext,
): ConsumerProjectState {
  if (!job || typeof job !== "object") {
    return "unknown_state";
  }

  const { status, executionStatus, selectedCandidateId, continuationMode, pausedFromStatus } = job;
  const verifiedResponses = (context?.responses || []).filter(
    (r): r is Doc<"providerResponses"> => Boolean(r),
  );
  const hasResponses = verifiedResponses.length > 0;

  // 1. Terminal / Execution Overrides (cancelled, completed, paused)
  if (status === "cancelled" || executionStatus === "cancelled") {
    return "cancelled";
  }

  if (status === "completed" || executionStatus === "completed") {
    return "completed";
  }

  if (executionStatus === "paused" || status === "paused" || Boolean(pausedFromStatus)) {
    return "paused";
  }

  // 2. Post-Quote / Responses Ready
  if (hasResponses || status === "reply_received" || status === "reply_understood") {
    if (selectedCandidateId && continuationMode === "user_takeover") {
      return "user_takeover";
    }
    if (selectedCandidateId && continuationMode === "findor_assisted") {
      return "findor_assisted";
    }
    if (selectedCandidateId) {
      return "provider_selected";
    }
    return "options_ready";
  }

  // 3. User decision / Zero Result / Failure
  if (status === "needs_user" || status === "failed") {
    return "needs_decision";
  }

  // 4. Workflow Stages
  if (status === "researching") {
    return "researching";
  }

  if (status === "outreach_sent") {
    return "waiting_for_replies";
  }

  if (status === "outreach_approved") {
    return "outreach_in_flight";
  }

  if (status === "providers_ready") {
    return "providers_ready";
  }

  if (status === "brief_approved") {
    // Structural invariant: approval UI requires a real persisted brief.
    // A brief_approved record without one is treated as still needing details.
    if (!job.brief) {
      return "needs_details";
    }
    return "ready_to_search";
  }

  if (status === "brief_ready") {
    // Structural invariant: review UI requires a real persisted brief with
    // all required intake fields resolved.
    if (!job.brief || (job.missingFields?.length ?? 0) > 0) {
      return "needs_details";
    }
    return "ready_for_review";
  }

  if (status === "needs_info") {
    return "needs_details";
  }

  // 5. Unknown Fallback
  return "unknown_state";
}
