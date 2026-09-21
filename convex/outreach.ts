import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import {
  action,
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  query,
  ActionCtx,
  MutationCtx,
} from "./_generated/server";
import { env } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import {
  FOLLOW_UP_DELAY_MS,
  FOLLOW_UP_RESPONSE_WAIT_MS,
  MAX_RECOVERY_DISCOVERY_CYCLES,
} from "./autonomy";
import {
  formatExternalServiceArea,
  hasSourceBackedPublicBusinessEmail,
  isProviderCountryCompatible,
  isProviderRelevantToJob,
  isProviderEntity,
  providerIdentityKey,
  redactExactAddressLikeText,
} from "./providerQuality";
import {
  decideJobResolution,
  summarizeProviderResolution,
  type RecoveryMessage,
} from "./recovery";

const outreachStatusValidator = v.union(
  v.literal("approved"),
  v.literal("sending"),
  v.literal("sent"),
  v.literal("delivery_failed"),
  v.literal("failed"),
);

const followUpStateValidator = v.union(
  v.literal("scheduling"),
  v.literal("scheduled"),
  v.literal("due"),
  v.literal("skipped"),
  v.literal("cancelled"),
  v.literal("sent"),
  v.literal("failed"),
);

const providerResolutionValidator = v.union(
  v.literal("waiting"),
  v.literal("replied"),
  v.literal("declined"),
  v.literal("delivery_failed"),
  v.literal("no_response"),
  v.literal("send_failed"),
  v.literal("paused"),
  v.literal("cancelled"),
  v.literal("needs_user"),
);

const sendBatchResultValidator = v.object({
  sentCount: v.number(),
  failedSendCount: v.number(),
});

const outreachValidator = v.object({
  _id: v.id("outreachMessages"),
  _creationTime: v.number(),
  jobId: v.id("jobs"),
  ownerId: v.id("users"),
  candidateId: v.id("providerCandidates"),
  cycleId: v.optional(v.id("jobCycles")),
  status: outreachStatusValidator,
  providerEmail: v.string(),
  subject: v.string(),
  body: v.string(),
  purpose: v.optional(
    v.union(
      v.literal("initial"),
      v.literal("routine_clarification"),
      v.literal("follow_up"),
    ),
  ),
  externalMessageId: v.optional(v.string()),
  externalThreadId: v.optional(v.string()),
  failureReason: v.optional(v.string()),
  providerResolution: v.optional(providerResolutionValidator),
  finalResponseCheckAt: v.optional(v.number()),
  finalResponseCheckScheduledFunctionId: v.optional(v.id("_scheduled_functions")),
  followUpCount: v.optional(v.number()),
  nextFollowUpAt: v.optional(v.number()),
  followUpState: v.optional(followUpStateValidator),
  followUpScheduledFunctionId: v.optional(v.id("_scheduled_functions")),
  followUpOutreachId: v.optional(v.id("outreachMessages")),
  followUpFailureReason: v.optional(v.string()),
  parentOutreachId: v.optional(v.id("outreachMessages")),
  clarificationId: v.optional(v.id("clarificationDrafts")),
  sendAttemptCount: v.optional(v.number()),
  lastAttemptAt: v.optional(v.number()),
  createdAt: v.number(),
  updatedAt: v.number(),
});

function buildDraft(job: {
  serviceCategory: string;
  serviceLocation: string;
  structuredLocation?: {
    country?: string;
    countryCode?: string;
    region?: string;
    city?: string;
    locality?: string;
    postalCode?: string;
  } | null;
  desiredTiming: string;
  naturalLanguageDescription: string;
  budgetOrContext: string;
}) {
  const safeLocation = formatExternalServiceArea(
    job.structuredLocation,
    job.serviceLocation,
  );
  const safeDescription = redactExactAddressLikeText(
    job.naturalLanguageDescription,
  );
  const safeContext = job.budgetOrContext
    ? redactExactAddressLikeText(job.budgetOrContext)
    : "None provided yet.";

  return {
    subject: job.serviceCategory + " inquiry",
    body: [
      "Hello,",
      "",
      "I am gathering comparable estimates for a local service request.",
      "",
      "Service requested: " + job.serviceCategory,
      "Service area: " + safeLocation,
      "Desired timing: " + job.desiredTiming,
      "Request details: " + safeDescription,
      "Additional context: " + safeContext,
      "",
      "Would your team service this area and be open to reviewing this request? Please share whether you are accepting projects, what information you would need for a written estimate, and whether an inspection or visit is required.",
      "",
      "This inquiry is exploratory and does not authorize work.",
      "",
      "Thank you,",
      "Sent at the customer's request via Findor",
    ].join("\n"),
  };
}
async function requireUserId(ctx: ActionCtx) {
  const userId = await getAuthUserId(ctx);
  if (!userId) {
    throw new Error("You must be signed in to send outreach.");
  }
  return userId;
}

export const getForJob = query({
  args: { jobId: v.id("jobs") },
  returns: v.union(v.null(), outreachValidator),
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;
    const job = await ctx.db.get("jobs", args.jobId);
    if (!job || job.ownerId !== userId) return null;

    const messages = await ctx.db
      .query("outreachMessages")
      .withIndex("by_job_and_createdAt", (q) => q.eq("jobId", args.jobId))
      .order("desc")
      .take(1);
    return messages[0] ?? null;
  },
});

export const listForJob = query({
  args: { jobId: v.id("jobs") },
  returns: v.array(outreachValidator),
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];
    const job = await ctx.db.get("jobs", args.jobId);
    if (!job || job.ownerId !== userId) return [];
    return await ctx.db
      .query("outreachMessages")
      .withIndex("by_job_and_createdAt", (q) => q.eq("jobId", args.jobId))
      .order("desc")
      .take(100);
  },
});

export const approveProvider = mutation({
  args: { candidateId: v.id("providerCandidates") },
  returns: v.id("outreachMessages"),
  handler: async (ctx, args) => {
    const ownerId = await getAuthUserId(ctx);
    if (!ownerId) {
      throw new Error("You must be signed in to approve a provider.");
    }

    const candidate = await ctx.db.get("providerCandidates", args.candidateId);
    if (
      !candidate ||
      candidate.ownerId !== ownerId ||
      !hasSourceBackedPublicBusinessEmail(candidate)
    ) {
      throw new Error("This provider does not have a usable published email.");
    }

    const job = await ctx.db.get("jobs", candidate.jobId);
    if (!job || job.ownerId !== ownerId || job.status !== "providers_ready") {
      throw new Error("Provider approval is not available for this job.");
    }

    const previous = await ctx.db
      .query("outreachMessages")
      .withIndex("by_job_and_createdAt", (q) => q.eq("jobId", candidate.jobId))
      .order("desc")
      .take(1);
    const existing = previous[0];
    if (existing) {
      if (existing.candidateId === args.candidateId) {
        return existing._id;
      }
      throw new Error("Approve one provider at a time in this first release.");
    }

    const draft = buildDraft(job);
    const now = Date.now();
    const outreachId = await ctx.db.insert("outreachMessages", {
      jobId: candidate.jobId,
      ownerId,
      candidateId: args.candidateId,
      cycleId: candidate.cycleId ?? job.currentCycleId,
      status: "approved",
      purpose: "initial",
      providerEmail: candidate.contactEmail as string,
      subject: draft.subject,
      body: draft.body,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.patch("jobs", candidate.jobId, {
      status: "outreach_approved",
      updatedAt: now,
    });
    await ctx.db.insert("jobEvents", {
      jobId: candidate.jobId,
      ownerId,
      eventType: "provider_approved",
      message:
        "You approved a provider and a draft outreach message is ready to review.",
      createdAt: now,
    });
    return outreachId;
  },
});


export const queueAutonomousOutreach = internalMutation({
  args: { jobId: v.id("jobs"), ownerId: v.id("users") },
  returns: v.object({
    queuedCount: v.number(),
    emailFoundCount: v.number(),
  }),
  handler: async (ctx, args) => {
    const job = await ctx.db.get("jobs", args.jobId);
    if (
      !job ||
      job.ownerId !== args.ownerId ||
      job.status !== "providers_ready" ||
      !job.autonomy?.enabled ||
      !job.autonomy.allowInitialOutreach
    ) {
      if (job?.ownerId === args.ownerId) {
        await ctx.db.insert("jobEvents", {
          jobId: args.jobId,
          ownerId: args.ownerId,
          eventType: "autonomous_action_blocked",
          message:
            "Autonomous outreach did not start because this request is not in an active, mandate-approved state.",
          createdAt: Date.now(),
        });
      }
      return { queuedCount: 0, emailFoundCount: 0 };
    }

    const candidates = await ctx.db
      .query("providerCandidates")
      .withIndex("by_job_and_discoveredAt", (q) => q.eq("jobId", args.jobId))
      .order("asc")
      .take(20);

    const cycleCandidates = job.currentCycleId
      ? candidates.filter(
          (c) =>
            c.cycleId === job.currentCycleId ||
            (!c.cycleId && !c.cycleId),
        )
      : candidates;

    const priorOutreach = await ctx.db
      .query("outreachMessages")
      .withIndex("by_job_and_createdAt", (q) => q.eq("jobId", args.jobId))
      .take(100);

    const includePreviouslyContacted = Boolean(
      job.autonomy.includePreviouslyContacted,
    );

    const priorContactedEmails = new Set<string>();
    const priorContactedOrigins = new Set<string>();
    const priorContactedNames = new Set<string>();

    if (!includePreviouslyContacted) {
      for (const msg of priorOutreach) {
        if (
          job.currentCycleId &&
          msg.cycleId &&
          msg.cycleId !== job.currentCycleId
        ) {
          priorContactedEmails.add(msg.providerEmail.toLowerCase().trim());
          const cDoc = await ctx.db.get("providerCandidates", msg.candidateId);
          if (cDoc) {
            priorContactedNames.add(cDoc.name.toLowerCase().trim());
            try {
              const origin = new URL(cDoc.url).origin.toLowerCase();
              priorContactedOrigins.add(origin);
            } catch {
              // Ignore invalid candidate URLs
            }
          }
        }
      }
    }

    const existingInitialCandidateIds = new Set(
      priorOutreach
        .filter((message) => {
          const isCurrentCycle =
            !job.currentCycleId ||
            message.cycleId === job.currentCycleId ||
            (!message.cycleId && !job.currentCycleId);
          return (
            isCurrentCycle &&
            (!message.purpose || message.purpose === "initial")
          );
        })
        .map((message) => message.candidateId),
    );

    const eligible = cycleCandidates
      .filter((candidate) => {
        if (
          candidate.ownerId !== args.ownerId ||
          !hasSourceBackedPublicBusinessEmail(candidate)
        ) {
          return false;
        }
        // Hard geographic gate: a provider whose resolved country conflicts
        // with the job country can never qualify, regardless of email.
        if (
          !isProviderCountryCompatible(
            candidate,
            job.structuredLocation,
          )
        ) {
          return false;
        }
        // Service + proximity relevance: the provider must satisfy the
        // job's trade and service area, not just hold an email address.
        if (!isProviderRelevantToJob(candidate, job)) {
          return false;
        }
        if (!includePreviouslyContacted) {
          const email = candidate.contactEmail?.toLowerCase().trim();
          if (email && priorContactedEmails.has(email)) return false;
          const name = candidate.name.toLowerCase().trim();
          if (priorContactedNames.has(name)) return false;
          try {
            const origin = new URL(candidate.url).origin.toLowerCase();
            if (priorContactedOrigins.has(origin)) return false;
          } catch {
            // Ignore invalid candidate URLs
          }
        }
        return true;
      })
      .slice(0, Math.min(5, Math.max(1, Math.floor(job.autonomy.maxProviders))));

    const draft = buildDraft(job);
    let queuedCount = 0;
    for (const candidate of eligible) {
      if (existingInitialCandidateIds.has(candidate._id)) continue;
      const now = Date.now();
      await ctx.db.insert("outreachMessages", {
        jobId: args.jobId,
        ownerId: args.ownerId,
        candidateId: candidate._id,
        cycleId: candidate.cycleId ?? job.currentCycleId,
        status: "approved",
        purpose: "initial",
        providerEmail: candidate.contactEmail as string,
        subject: draft.subject,
        body: draft.body,
        followUpCount: 0,
        createdAt: now,
        updatedAt: now,
      });
      queuedCount += 1;
    }

    if (queuedCount > 0) {
      const now = Date.now();
      if (job.currentCycleId) {
        await ctx.db.patch("jobCycles", job.currentCycleId, {
          status: "active",
          updatedAt: now,
        });
      }
      await ctx.db.patch("jobs", args.jobId, {
        status: "outreach_approved",
        updatedAt: now,
      });
      await ctx.db.insert("jobEvents", {
        jobId: args.jobId,
        ownerId: args.ownerId,
        eventType: "provider_approved",
        message:
          "Findor selected " +
          queuedCount +
          " source-backed contactable provider(s) within the approved mandate: " +
          eligible.map((candidate) => candidate.name).join(", ") +
          ". Outreach is queued.",
        createdAt: now,
      });
    } else if (existingInitialCandidateIds.size === 0) {
      const now = Date.now();
      if (job.currentCycleId) {
        await ctx.db.patch("jobCycles", job.currentCycleId, {
          status: "exhausted_no_options",
          outcomeSummary: "0 contactable providers found",
          endedAt: now,
          updatedAt: now,
        });
      }
      await ctx.db.patch("jobs", args.jobId, {
        status: "needs_user",
        autonomyStopReason:
          "No contactable providers with verified public business email routes were found for this attempt.",
        activeOperation: undefined,
        updatedAt: now,
      });
      await ctx.db.insert("jobEvents", {
        jobId: args.jobId,
        ownerId: args.ownerId,
        cycleId: job.currentCycleId,
        eventType: "cycle_exhausted_no_options",
        message:
          "Provider research completed with 0 contactable providers. Findor did not contact any provider or guess an email address.",
        createdAt: now,
      });
    } else {
      await ctx.db.insert("jobEvents", {
        jobId: args.jobId,
        ownerId: args.ownerId,
        cycleId: job.currentCycleId,
        eventType: "autonomous_action_blocked",
        message:
          "No provider entered automated outreach because no retained candidate had source-backed public business email evidence.",
        createdAt: Date.now(),
      });
    }

    return {
      queuedCount,
      emailFoundCount: eligible.length,
    };
  },
});

/**
 * Recovery-batch eligibility (read-only): retained candidates that have
 * never received an initial inquiry in ANY cycle and pass every
 * qualification gate (provider entity via source-backed email, country,
 * service/area relevance). Previously contacted providers are ALWAYS
 * excluded — a new round never re-sends an initial inquiry. The single
 * permitted follow-up is a separate purpose and never counts here.
 */
export async function listRecoveryEligibleCandidates(
  ctx: MutationCtx,
  job: {
    _id: Doc<"jobs">["_id"];
    ownerId: Doc<"jobs">["ownerId"];
    structuredLocation?: Doc<"jobs">["structuredLocation"];
    serviceCategory: string;
    serviceLocation: string;
    naturalLanguageDescription: string;
  },
  ownerId: Doc<"users">["_id"],
) {
  const candidates = await ctx.db
    .query("providerCandidates")
    .withIndex("by_job_and_discoveredAt", (q) => q.eq("jobId", job._id))
    .order("asc")
    .take(40);
  const priorOutreach = await ctx.db
    .query("outreachMessages")
    .withIndex("by_job_and_createdAt", (q) => q.eq("jobId", job._id))
    .take(100);
  const contactedEmails = new Set<string>();
  const contactedNames = new Set<string>();
  const contactedOrigins = new Set<string>();
  for (const message of priorOutreach) {
    if (message.purpose && message.purpose !== "initial") continue;
    contactedEmails.add(message.providerEmail.toLowerCase().trim());
    const candidateDoc = await ctx.db.get(
      "providerCandidates",
      message.candidateId,
    );
    if (candidateDoc) {
      contactedNames.add(candidateDoc.name.toLowerCase().trim());
      try {
        contactedOrigins.add(new URL(candidateDoc.url).origin.toLowerCase());
      } catch {
        // Ignore invalid candidate URLs.
      }
    }
  }
  return candidates.filter((candidate) => {
    if (candidate.ownerId !== ownerId || candidate.jobId !== job._id) {
      return false;
    }
    if (!hasSourceBackedPublicBusinessEmail(candidate)) return false;
    if (
      !isProviderCountryCompatible(
        candidate,
        job.structuredLocation,
      )
    ) {
      return false;
    }
    if (!isProviderRelevantToJob(candidate, job)) return false;
    const email = candidate.contactEmail?.toLowerCase().trim();
    if (email && contactedEmails.has(email)) return false;
    if (contactedNames.has(candidate.name.toLowerCase().trim())) return false;
    try {
      if (contactedOrigins.has(new URL(candidate.url).origin.toLowerCase())) {
        return false;
      }
    } catch {
      // Ignore invalid candidate URLs.
    }
    return true;
  });
}

/**
 * Queues one bounded recovery batch for the CURRENT cycle: up to
 * maxProviders never-contacted eligible providers. Same gates as initial
 * qualification, same per-batch cap. Follow-ups are untouched.
 */
export const queueRecoveryBatch = internalMutation({
  args: { jobId: v.id("jobs"), ownerId: v.id("users") },
  returns: v.object({ queuedCount: v.number() }),
  handler: async (ctx, args) => {
    const job = await ctx.db.get("jobs", args.jobId);
    if (
      !job ||
      job.ownerId !== args.ownerId ||
      !job.autonomy?.enabled ||
      !job.autonomy.allowInitialOutreach
    ) {
      return { queuedCount: 0 };
    }
    const cap = Math.min(
      5,
      Math.max(1, Math.floor(job.autonomy.maxProviders)),
    );
    const eligible = (
      await listRecoveryEligibleCandidates(ctx, job, args.ownerId)
    ).slice(0, cap);
    const draft = buildDraft(job);
    let queuedCount = 0;
    for (const candidate of eligible) {
      const now = Date.now();
      await ctx.db.insert("outreachMessages", {
        jobId: args.jobId,
        ownerId: args.ownerId,
        candidateId: candidate._id,
        cycleId: job.currentCycleId,
        status: "approved",
        purpose: "initial",
        providerEmail: candidate.contactEmail as string,
        subject: draft.subject,
        body: draft.body,
        followUpCount: 0,
        createdAt: now,
        updatedAt: now,
      });
      queuedCount += 1;
    }
    if (queuedCount > 0) {
      const now = Date.now();
      await ctx.db.patch("jobs", args.jobId, {
        status: "outreach_approved",
        updatedAt: now,
      });
      await ctx.db.insert("jobEvents", {
        jobId: args.jobId,
        ownerId: args.ownerId,
        cycleId: job.currentCycleId,
        eventType: "provider_approved",
        message:
          "Findor selected " +
          queuedCount +
          " new source-backed contactable provider(s) within the approved mandate: " +
          eligible.map((candidate) => candidate.name).join(", ") +
          ". Outreach is queued.",
        createdAt: now,
      });
    }
    return { queuedCount };
  },
});

function isActiveAutonomousStatus(status: string) {
  return (
    status === "outreach_approved" ||
    status === "outreach_sent" ||
    status === "reply_received" ||
    status === "reply_understood"
  );
}

function hasCurrentFollowUpProvider(
  candidate: Doc<"providerCandidates">,
  job: Doc<"jobs">,
) {
  return (
    hasSourceBackedPublicBusinessEmail(candidate) &&
    isProviderCountryCompatible(candidate, job.structuredLocation) &&
    isProviderRelevantToJob(candidate, job)
  );
}

function isBlockedRecoveryJob(job: Doc<"jobs">) {
  return (
    !job.recoveryEnabled ||
    !job.autonomy?.enabled ||
    !job.autonomy.allowInitialOutreach ||
    Boolean(job.selectedCandidateId) ||
    job.continuationMode === "user_takeover" ||
    ["paused", "cancelled", "completed", "needs_user"].includes(job.status)
  );
}

const autonomousSendableValidator = v.object({
  outreachId: v.id("outreachMessages"),
  providerEmail: v.string(),
  subject: v.string(),
  body: v.string(),
});

export const getAutonomousSendables = internalQuery({
  args: { jobId: v.id("jobs"), ownerId: v.id("users") },
  returns: v.array(autonomousSendableValidator),
  handler: async (ctx, args) => {
    const job = await ctx.db.get("jobs", args.jobId);
    if (
      !job ||
      job.ownerId !== args.ownerId ||
      !isActiveAutonomousStatus(job.status) ||
      job.activeOperation ||
      Boolean(job.selectedCandidateId) ||
      job.continuationMode === "user_takeover" ||
      !job.autonomy?.enabled ||
      !job.autonomy.allowInitialOutreach
    ) {
      return [];
    }

    const messages = await ctx.db
      .query("outreachMessages")
      .withIndex("by_job_and_createdAt", (q) => q.eq("jobId", args.jobId))
      .order("asc")
      .take(20);
    const candidates = [];
    for (const message of messages) {
      if (
        message.ownerId !== args.ownerId ||
        message.status !== "approved" ||
        message.purpose !== "initial"
      ) {
        continue;
      }
      const candidate = await ctx.db.get("providerCandidates", message.candidateId);
      if (!candidate || candidate.ownerId !== args.ownerId || candidate.jobId !== args.jobId) {
        continue;
      }
      if (!hasSourceBackedPublicBusinessEmail(candidate)) continue;
      if (
        !isProviderCountryCompatible(
          candidate,
          job.structuredLocation,
        )
      ) {
        continue;
      }
      if (!isProviderRelevantToJob(candidate, job)) continue;
      candidates.push({
        outreachId: message._id,
        providerEmail: message.providerEmail,
        subject: message.subject,
        body: message.body,
      });
      if (candidates.length >= Math.min(5, Math.max(1, Math.floor(job.autonomy.maxProviders)))) {
        break;
      }
    }
    return candidates;
  },
});

const recoveryDecisionValidator = v.union(
  v.literal("wait"),
  v.literal("queued"),
  v.literal("search_scheduled"),
  v.literal("needs_user"),
  v.literal("options_ready"),
  v.literal("blocked"),
  v.literal("already_handled"),
);

export const evaluateRecovery = internalMutation({
  args: { jobId: v.id("jobs"), ownerId: v.id("users") },
  returns: recoveryDecisionValidator,
  handler: async (ctx, args) => {
    const job = await ctx.db.get("jobs", args.jobId);
    if (!job || job.ownerId !== args.ownerId || isBlockedRecoveryJob(job)) {
      return "blocked";
    }
    if (job.activeOperation) return "already_handled";

    const messages = await ctx.db
      .query("outreachMessages")
      .withIndex("by_job_and_createdAt", (q) => q.eq("jobId", args.jobId))
      .order("asc")
      .take(50);
    const initialMessages = messages.filter(
      (message) => !message.purpose || message.purpose === "initial",
    );
    const providerResponses = await ctx.db
      .query("providerResponses")
      .withIndex("by_jobId_and_createdAt", (q) => q.eq("jobId", args.jobId))
      .order("desc")
      .take(50);
    const usableResponseOutreachIds = new Set(
      providerResponses
        .filter((response) => response.kind !== "unclear" && response.kind !== "acknowledgement")
        .map((response) => response.outreachId),
    );
    const recoveryMessages: RecoveryMessage[] = [];
    const candidatesByMessage = new Map<string, Doc<"providerCandidates">>();
    for (const message of initialMessages) {
      const candidate = await ctx.db.get("providerCandidates", message.candidateId);
      if (!candidate) continue;
      candidatesByMessage.set(message._id, candidate);
      recoveryMessages.push({
        providerKey: providerIdentityKey(candidate),
        status: message.status,
        purpose: "initial",
        providerResolution: message.providerResolution,
        usableResponse: usableResponseOutreachIds.has(message._id),
      });
    }

    const counts = summarizeProviderResolution(
      recoveryMessages,
      job.autonomy?.maxProviders ?? 0,
    );
    const hasDeclinedProvider = recoveryMessages.some(
      (message) => message.providerResolution === "declined",
    );
    const decision = decideJobResolution(counts);
    if (decision === "wait") return "wait";
    // A usable response normally completes recovery, but a genuine decline is
    // terminal only for that provider. If capacity remains, continue with the
    // next eligible provider or the single bounded recovery search.
    if (decision === "options_ready" && !hasDeclinedProvider) {
      return "options_ready";
    }
    if (decision === "needs_user" && counts.sendFailedCount > 0) {
      return "needs_user";
    }
    if (counts.remainingProviderCapacity <= 0) {
      const now = Date.now();
      if (job.currentCycleId) {
        const finalStatus =
          usableResponseOutreachIds.size > 0
            ? "exhausted_partial"
            : "exhausted_no_options";
        const finalOutcome =
          usableResponseOutreachIds.size > 0
            ? `${usableResponseOutreachIds.size} option(s) ready (partial)`
            : "0 usable options found";
        await ctx.db.patch("jobCycles", job.currentCycleId, {
          status: finalStatus,
          outcomeSummary: finalOutcome,
          endedAt: now,
          updatedAt: now,
        });
        await ctx.db.insert("jobEvents", {
          jobId: args.jobId,
          ownerId: args.ownerId,
          cycleId: job.currentCycleId,
          eventType:
            finalStatus === "exhausted_partial"
              ? "cycle_exhausted_partial"
              : "cycle_exhausted_no_options",
          message:
            finalStatus === "exhausted_partial"
              ? `Cycle completed with ${usableResponseOutreachIds.size} option(s).`
              : "Cycle exhausted with no usable options.",
          createdAt: now,
        });
      }
      await ctx.db.patch("jobs", args.jobId, {
        status: "needs_user",
        autonomyStopReason:
          "No providers remain within the approved contact limit. Review the available responses before continuing.",
        updatedAt: now,
      });
      await ctx.db.insert("jobEvents", {
        jobId: args.jobId,
        ownerId: args.ownerId,
        eventType: "autonomous_action_blocked",
        message:
          "Findor reached the approved provider-contact limit without a usable response.",
        createdAt: now,
      });
      return "needs_user";
    }

    const contactedKeys = new Set(
      Array.from(candidatesByMessage.values()).map((candidate) =>
        providerIdentityKey(candidate),
      ),
    );
    const candidates = await ctx.db
      .query("providerCandidates")
      .withIndex("by_job_and_discoveredAt", (q) => q.eq("jobId", args.jobId))
      .order("asc")
      .take(40);
    const nextCandidate = candidates.find(
      (candidate) =>
        candidate.ownerId === args.ownerId &&
        isProviderEntity(candidate) &&
        hasSourceBackedPublicBusinessEmail(candidate) &&
        isProviderRelevantToJob(candidate, job) &&
        !contactedKeys.has(providerIdentityKey(candidate)),
    );
    if (nextCandidate) {
      const draft = buildDraft(job);
      const now = Date.now();
      const outreachId = await ctx.db.insert("outreachMessages", {
        jobId: args.jobId,
        ownerId: args.ownerId,
        candidateId: nextCandidate._id,
        cycleId: nextCandidate.cycleId ?? job.currentCycleId,
        status: "approved",
        purpose: "initial",
        providerEmail: nextCandidate.contactEmail as string,
        subject: draft.subject,
        body: draft.body,
        followUpCount: 0,
        createdAt: now,
        updatedAt: now,
      });
      await ctx.db.patch("jobs", args.jobId, {
        status: "outreach_approved",
        updatedAt: now,
      });
      await ctx.db.insert("jobEvents", {
        jobId: args.jobId,
        ownerId: args.ownerId,
        eventType: "provider_replacement_queued",
        message:
          "Findor queued the next eligible source-backed provider within the approved contact limit: " +
          nextCandidate.name +
          ".",
        createdAt: now,
      });
      await ctx.scheduler.runAfter(0, internal.outreach.sendRecoveryProvider, {
        outreachId,
        ownerId: args.ownerId,
      });
      return "queued";
    }

    if ((job.recoveryDiscoveryCycles ?? 0) < MAX_RECOVERY_DISCOVERY_CYCLES) {
      const now = Date.now();
      await ctx.db.patch("jobs", args.jobId, {
        activeOperation: "recovery_search",
        recoveryDiscoveryCycles: (job.recoveryDiscoveryCycles ?? 0) + 1,
        updatedAt: now,
      });
      await ctx.db.insert("jobEvents", {
        jobId: args.jobId,
        ownerId: args.ownerId,
        eventType: "recovery_research_started",
        message: "Looking for another suitable provider.",
        createdAt: now,
      });
      await ctx.scheduler.runAfter(0, internal.providerResearch.runRecoveryDiscovery, args);
      return "search_scheduled";
    }

    const now = Date.now();
    if (job.currentCycleId) {
      const finalStatus =
        usableResponseOutreachIds.size > 0
          ? "exhausted_partial"
          : "exhausted_no_options";
      const finalOutcome =
        usableResponseOutreachIds.size > 0
          ? `${usableResponseOutreachIds.size} option(s) ready (partial)`
          : "0 usable options found";
      await ctx.db.patch("jobCycles", job.currentCycleId, {
        status: finalStatus,
        outcomeSummary: finalOutcome,
        endedAt: now,
        updatedAt: now,
      });
      await ctx.db.insert("jobEvents", {
        jobId: args.jobId,
        ownerId: args.ownerId,
        cycleId: job.currentCycleId,
        eventType:
          finalStatus === "exhausted_partial"
            ? "cycle_exhausted_partial"
            : "cycle_exhausted_no_options",
        message:
          finalStatus === "exhausted_partial"
            ? `Cycle completed with ${usableResponseOutreachIds.size} option(s).`
            : "Cycle exhausted with no usable options.",
        createdAt: now,
      });
    }
    await ctx.db.patch("jobs", args.jobId, {
      status: "needs_user",
      autonomyStopReason:
        "No additional suitable contactable providers were found within your current request.",
      updatedAt: now,
    });
    await ctx.db.insert("jobEvents", {
      jobId: args.jobId,
      ownerId: args.ownerId,
      eventType: "autonomous_action_blocked",
      message:
        "Findor completed its one bounded recovery search and found no additional eligible provider.",
      createdAt: now,
    });
    return "needs_user";
  },
});

export const scheduleRecoveryChecksForJob = internalMutation({
  args: { jobId: v.id("jobs"), ownerId: v.id("users") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const job = await ctx.db.get("jobs", args.jobId);
    if (!job || job.ownerId !== args.ownerId || isBlockedRecoveryJob(job) || job.activeOperation) {
      return null;
    }
    const messages = await ctx.db
      .query("outreachMessages")
      .withIndex("by_job_and_createdAt", (q) => q.eq("jobId", args.jobId))
      .take(50);
    for (const message of messages) {
      if (
        message.purpose !== "initial" ||
        message.providerResolution !== "waiting" ||
        message.finalResponseCheckScheduledFunctionId
      ) {
        continue;
      }
      const child = message.followUpOutreachId
        ? await ctx.db.get("outreachMessages", message.followUpOutreachId)
        : null;
      const followUpComplete = child?.status === "sent" ||
        (!job.autonomy?.allowFollowUp || (job.autonomy?.maxFollowUps ?? 0) <= 0);
      if (!followUpComplete) continue;
      const checkAt = message.finalResponseCheckAt ?? Date.now() + FOLLOW_UP_RESPONSE_WAIT_MS;
      const scheduledFunctionId = await ctx.scheduler.runAt(
        checkAt,
        internal.outreach.resolveFinalResponse,
        { parentOutreachId: message._id, ownerId: args.ownerId },
      );
      await ctx.db.patch("outreachMessages", message._id, {
        finalResponseCheckAt: checkAt,
        finalResponseCheckScheduledFunctionId: scheduledFunctionId,
        updatedAt: Date.now(),
      });
    }
    return null;
  },
});

const finalResponseResultValidator = v.union(
  v.literal("not_due"),
  v.literal("waiting"),
  v.literal("replied"),
  v.literal("no_response"),
  v.literal("delivery_failed"),
  v.literal("blocked"),
  v.literal("already_handled"),
);

export const resolveFinalResponse = internalMutation({
  args: { parentOutreachId: v.id("outreachMessages"), ownerId: v.id("users") },
  returns: finalResponseResultValidator,
  handler: async (ctx, args) => {
    const parent = await ctx.db.get("outreachMessages", args.parentOutreachId);
    const job = parent ? await ctx.db.get("jobs", parent.jobId) : null;
    if (!parent || !job || parent.ownerId !== args.ownerId || job.ownerId !== args.ownerId) {
      return "blocked";
    }
    if (!job.recoveryEnabled) return "blocked";
    if (parent.providerResolution && parent.providerResolution !== "waiting") {
      return "already_handled";
    }
    if (parent.finalResponseCheckAt && parent.finalResponseCheckAt > Date.now()) {
      return "not_due";
    }
    await ctx.db.patch("outreachMessages", parent._id, {
      finalResponseCheckAt: undefined,
      finalResponseCheckScheduledFunctionId: undefined,
      updatedAt: Date.now(),
    });

    const child = parent.followUpOutreachId
      ? await ctx.db.get("outreachMessages", parent.followUpOutreachId)
      : null;
    const relatedThreadIds = [parent.externalThreadId, child?.externalThreadId].filter(
      (threadId): threadId is string => Boolean(threadId),
    );
    let replyFound = false;
    let deliveryFailed = false;
    for (const threadId of relatedThreadIds) {
      const inbound = await ctx.db
        .query("inboundMessages")
        .withIndex("by_threadId_and_createdAt", (q) => q.eq("threadId", threadId))
        .order("desc")
        .take(5);
      for (const message of inbound) {
        if (message.outreachId !== parent._id && message.outreachId !== child?._id) continue;
        if (message.processingStatus === "delivery_failed") {
          deliveryFailed = true;
        } else if (message.processingStatus !== "unmatched") {
          replyFound = true;
        }
      }
    }
    if (replyFound) {
      await ctx.db.patch("outreachMessages", parent._id, {
        providerResolution: "replied",
        updatedAt: Date.now(),
      });
      return "replied";
    }
    if (["paused", "cancelled", "completed", "needs_user"].includes(job.status)) {
      const providerResolution =
        job.status === "paused" ? "paused" : job.status === "cancelled" ? "cancelled" : "needs_user";
      await ctx.db.patch("outreachMessages", parent._id, {
        providerResolution,
        updatedAt: Date.now(),
      });
      return "blocked";
    }
    if (deliveryFailed || child?.status === "delivery_failed") {
      await ctx.db.patch("outreachMessages", parent._id, {
        providerResolution: "delivery_failed",
        updatedAt: Date.now(),
      });
      await ctx.scheduler.runAfter(0, internal.outreach.evaluateRecovery, {
        jobId: job._id,
        ownerId: args.ownerId,
      });
      return "delivery_failed";
    }
    if (child && child.status !== "sent") {
      if (child.status === "failed") {
        await ctx.db.patch("outreachMessages", parent._id, {
          providerResolution: "needs_user",
          updatedAt: Date.now(),
        });
      }
      return "waiting";
    }
    const followUpWasNotRequired =
      !job.autonomy?.allowFollowUp || (job.autonomy?.maxFollowUps ?? 0) <= 0;
    if (!child && !followUpWasNotRequired) return "waiting";

    const candidate = await ctx.db.get("providerCandidates", parent.candidateId);
    const now = Date.now();
    await ctx.db.patch("outreachMessages", parent._id, {
      providerResolution: "no_response",
      updatedAt: now,
    });
    await ctx.db.insert("jobEvents", {
      jobId: job._id,
      ownerId: args.ownerId,
      eventType: "provider_no_response",
      message:
        "No response from " +
        (candidate?.name ?? "the contacted provider") +
        " after the approved outreach and follow-up attempts.",
      createdAt: now,
    });
    await ctx.scheduler.runAfter(0, internal.outreach.evaluateRecovery, {
      jobId: job._id,
      ownerId: args.ownerId,
    });
    return "no_response";
  },
});

export const claimRoutineClarificationForSend = internalMutation({
  args: {
    jobId: v.id("jobs"),
    ownerId: v.id("users"),
    outreachId: v.id("outreachMessages"),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const job = await ctx.db.get("jobs", args.jobId);
    const message = await ctx.db.get("outreachMessages", args.outreachId);
    if (
      !job ||
      job.ownerId !== args.ownerId ||
      !isActiveAutonomousStatus(job.status) ||
      job.activeOperation ||
      job.continuationMode === "user_takeover" ||
      !job.autonomy?.enabled ||
      !job.autonomy.allowRoutineClarifications ||
      !message ||
      message.ownerId !== args.ownerId ||
      message.jobId !== args.jobId ||
      message.purpose !== "routine_clarification" ||
      message.status !== "approved" ||
      (Boolean(job.selectedCandidateId) && message.candidateId !== job.selectedCandidateId)
    ) {
      throw new Error("Routine clarification is no longer sendable.");
    }
    await ctx.db.patch("outreachMessages", args.outreachId, {
      status: "sending",
      sendAttemptCount: (message.sendAttemptCount ?? 0) + 1,
      lastAttemptAt: Date.now(),
      failureReason: undefined,
      updatedAt: Date.now(),
    });
    await ctx.db.patch("jobs", args.jobId, {
      activeOperation: "outreach_send",
      updatedAt: Date.now(),
    });
    return null;
  },
});

export const getRoutineClarificationForAction = internalQuery({
  args: { clarificationId: v.id("clarificationDrafts"), ownerId: v.id("users") },
  returns: v.union(
    v.null(),
    v.object({
      jobId: v.id("jobs"),
      ownerId: v.id("users"),
      outreachId: v.id("outreachMessages"),
      providerEmail: v.string(),
      subject: v.string(),
      body: v.string(),
    }),
  ),
  handler: async (ctx, args) => {
    const clarification = await ctx.db.get("clarificationDrafts", args.clarificationId);
    if (!clarification || clarification.ownerId !== args.ownerId || clarification.status !== "approved") {
      return null;
    }
    const job = await ctx.db.get("jobs", clarification.jobId);
    if (
      !job ||
      job.ownerId !== args.ownerId ||
      !isActiveAutonomousStatus(job.status) ||
      job.continuationMode === "user_takeover" ||
      !job.autonomy?.enabled ||
      !job.autonomy.allowRoutineClarifications
    ) {
      return null;
    }
    const messages = await ctx.db
      .query("outreachMessages")
      .withIndex("by_job_and_createdAt", (q) => q.eq("jobId", clarification.jobId))
      .order("desc")
      .take(20);
    const message = messages.find(
      (item) =>
        item.clarificationId === args.clarificationId &&
        item.purpose === "routine_clarification",
    );
    if (
      !message ||
      message.ownerId !== args.ownerId ||
      message.status !== "approved" ||
      (Boolean(job.selectedCandidateId) && message.candidateId !== job.selectedCandidateId)
    ) {
      return null;
    }
    return {
      jobId: job._id,
      ownerId: args.ownerId,
      outreachId: message._id,
      providerEmail: message.providerEmail,
      subject: message.subject,
      body: message.body,
    };
  },
});

export const markRoutineClarificationSent = internalMutation({
  args: {
    jobId: v.id("jobs"),
    ownerId: v.id("users"),
    outreachId: v.id("outreachMessages"),
    clarificationId: v.id("clarificationDrafts"),
    messageId: v.string(),
    threadId: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const message = await ctx.db.get("outreachMessages", args.outreachId);
    const job = await ctx.db.get("jobs", args.jobId);
    const clarification = await ctx.db.get("clarificationDrafts", args.clarificationId);
    if (
      !message ||
      !job ||
      !clarification ||
      message.ownerId !== args.ownerId ||
      job.ownerId !== args.ownerId ||
      clarification.ownerId !== args.ownerId ||
      message.jobId !== args.jobId ||
      message.clarificationId !== args.clarificationId ||
      message.status !== "sending"
    ) {
      throw new Error("Routine clarification cannot be marked as sent.");
    }
    const now = Date.now();
    await ctx.db.patch("outreachMessages", args.outreachId, {
      status: "sent",
      externalMessageId: args.messageId,
      externalThreadId: args.threadId,
      failureReason: undefined,
      updatedAt: now,
    });
    await ctx.db.patch("clarificationDrafts", args.clarificationId, {
      status: "sent",
      updatedAt: now,
    });
    await ctx.db.patch("jobs", args.jobId, {
      activeOperation: undefined,
      updatedAt: now,
    });
    await ctx.db.insert("jobEvents", {
      jobId: args.jobId,
      ownerId: args.ownerId,
      eventType: "routine_clarification_sent",
      message: "Findor sent one authorized routine clarification and stored the external receipt.",
      createdAt: now,
    });
    return null;
  },
});

export const markRoutineClarificationFailed = internalMutation({
  args: {
    jobId: v.id("jobs"),
    ownerId: v.id("users"),
    outreachId: v.id("outreachMessages"),
    clarificationId: v.id("clarificationDrafts"),
    reason: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const message = await ctx.db.get("outreachMessages", args.outreachId);
    const job = await ctx.db.get("jobs", args.jobId);
    const clarification = await ctx.db.get("clarificationDrafts", args.clarificationId);
    if (!message || !job || !clarification || message.ownerId !== args.ownerId || job.ownerId !== args.ownerId) {
      return null;
    }
    const now = Date.now();
    await ctx.db.patch("outreachMessages", args.outreachId, {
      status: "failed",
      failureReason: args.reason,
      updatedAt: now,
    });
    await ctx.db.patch("clarificationDrafts", args.clarificationId, {
      status: "failed",
      updatedAt: now,
    });
    await ctx.db.patch("jobs", args.jobId, {
      status: "needs_user",
      autonomyStopReason: "Findor could not complete a routine clarification. Review the failed outbound record before continuing.",
      activeOperation: undefined,
      updatedAt: now,
    });
    await ctx.db.insert("jobEvents", {
      jobId: args.jobId,
      ownerId: args.ownerId,
      eventType: "autonomous_action_blocked",
      message: "Routine clarification failed without a successful external receipt; Findor stopped for review.",
      createdAt: now,
    });
    return null;
  },
});

export const sendRoutineClarification = internalAction({
  args: { clarificationId: v.id("clarificationDrafts"), ownerId: v.id("users") },
  returns: v.object({
    status: v.union(v.literal("sent"), v.literal("failed")),
    messageId: v.optional(v.string()),
    threadId: v.optional(v.string()),
  }),
  handler: async (ctx, args) => {
    const draft = await ctx.runQuery(internal.outreach.getRoutineClarificationForAction, args);
    if (!draft) return { status: "failed" as const };
    const apiKey = env.AGENTMAIL_API_KEY;
    const inboxId = env.AGENTMAIL_INBOX_ID;
    if (!apiKey || !inboxId) {
      await ctx.runMutation(internal.outreach.markRoutineClarificationFailed, {
        jobId: draft.jobId,
        ownerId: args.ownerId,
        outreachId: draft.outreachId,
        clarificationId: args.clarificationId,
        reason: "AgentMail is not configured; no external receipt was recorded.",
      });
      return { status: "failed" as const };
    }
    await ctx.runMutation(internal.outreach.claimRoutineClarificationForSend, {
      jobId: draft.jobId,
      ownerId: args.ownerId,
      outreachId: draft.outreachId,
    });
    try {
      const receipt = await sendAgentMail(apiKey, inboxId, draft);
      await ctx.runMutation(internal.outreach.markRoutineClarificationSent, {
        jobId: draft.jobId,
        ownerId: args.ownerId,
        outreachId: draft.outreachId,
        clarificationId: args.clarificationId,
        messageId: receipt.messageId,
        threadId: receipt.threadId,
      });
      return {
        status: "sent" as const,
        messageId: receipt.messageId,
        threadId: receipt.threadId,
      };
    } catch {
      await ctx.runMutation(internal.outreach.markRoutineClarificationFailed, {
        jobId: draft.jobId,
        ownerId: args.ownerId,
        outreachId: draft.outreachId,
        clarificationId: args.clarificationId,
        reason: "AgentMail did not return a successful receipt; Findor stopped for review.",
      });
      return { status: "failed" as const };
    }
  },
});

const followUpCreationValidator = v.object({
  outreachId: v.id("outreachMessages"),
  providerEmail: v.string(),
  subject: v.string(),
  body: v.string(),
});

const followUpScheduleResultValidator = v.union(
  v.literal("scheduled"),
  v.literal("skipped"),
  v.literal("already_handled"),
  v.literal("not_eligible"),
);

function followUpSkipState(jobStatus: string) {
  return ["paused", "cancelled", "completed"].includes(jobStatus)
    ? "cancelled" as const
    : "skipped" as const;
}

export const scheduleFollowUp = internalMutation({
  args: { parentOutreachId: v.id("outreachMessages"), ownerId: v.id("users") },
  returns: followUpScheduleResultValidator,
  handler: async (ctx, args) => {
    const parent = await ctx.db.get("outreachMessages", args.parentOutreachId);
    const job = parent ? await ctx.db.get("jobs", parent.jobId) : null;
    if (
      !parent ||
      !job ||
      parent.ownerId !== args.ownerId ||
      job.ownerId !== args.ownerId ||
      parent.purpose !== "initial" ||
      parent.status !== "sent" ||
      !parent.externalMessageId ||
      !parent.externalThreadId
    ) {
      return "not_eligible";
    }
    if (parent.followUpState && parent.followUpState !== "scheduling") {
      return "already_handled";
    }
    if (!job.autonomy?.enabled) {
      return "not_eligible";
    }

    const candidate = await ctx.db.get("providerCandidates", parent.candidateId);
    const maxFollowUps = Math.min(1, Math.max(0, Math.floor(job.autonomy.maxFollowUps)));
    const threadReplies = await ctx.db
      .query("inboundMessages")
      .withIndex("by_threadId_and_createdAt", (q) =>
        q.eq("threadId", parent.externalThreadId as string),
      )
      .order("desc")
      .take(1);
    const isSelectedEligible =
      !job.selectedCandidateId || parent.candidateId === job.selectedCandidateId;
    // Scheduling invariant: follow-up authorization is recorded at send time
    // (markSent runs inside the approved autonomous flow for an initial send
    // under an enabled mandate). This scheduler-creation gate therefore checks
    // ONLY conditions that are legitimately knowable now and safety-relevant
    // later: mandate caps, supervening replies/bounces, selection, takeover,
    // and candidate quality. Transient lifecycle state (job.status,
    // activeOperation) is deliberately NOT evaluated here — it can only
    // produce race-skips with no recourse. The fire-time markFollowUpDue gate
    // remains the safety authority and re-validates status/operation before
    // any external action, with specific skip reasons.
    const canSchedule =
      Boolean(job.briefApprovedAt) &&
      Boolean(job.autonomy.approvedAt) &&
      Boolean(job.structuredLocation) &&
      job.autonomy.allowFollowUp &&
      maxFollowUps > 0 &&
      (parent.followUpCount ?? 0) < maxFollowUps &&
      threadReplies.length === 0 &&
      job.continuationMode !== "user_takeover" &&
      isSelectedEligible &&
      Boolean(candidate && hasCurrentFollowUpProvider(candidate, job));
    const deliveryFailureInThread = threadReplies.some(
      (message) => message.processingStatus === "delivery_failed",
    );

    if (!canSchedule) {
      const state = followUpSkipState(job.status);
      const now = Date.now();
      await ctx.db.patch("outreachMessages", parent._id, {
        followUpState: state,
        nextFollowUpAt: undefined,
        followUpScheduledFunctionId: undefined,
        followUpFailureReason:
          deliveryFailureInThread
            ? "A delivery failure was recorded for this address/thread; the follow-up was suppressed."
            : threadReplies.length > 0
            ? "A provider reply arrived before the follow-up became due."
            : job.continuationMode === "user_takeover"
            ? "The user took over communication directly; follow-up suppressed."
            : !isSelectedEligible
            ? "An alternative provider was selected; follow-up suppressed."
            : undefined,
        updatedAt: now,
      });
      await ctx.db.insert("jobEvents", {
        jobId: parent.jobId,
        ownerId: args.ownerId,
        eventType: "follow_up_skipped",
        message:
          deliveryFailureInThread
            ? "The planned follow-up was suppressed because a delivery failure was recorded for this address/thread."
            : threadReplies.length > 0
            ? "The planned follow-up was skipped because the provider replied."
            : job.continuationMode === "user_takeover"
            ? "The planned follow-up was skipped because the user took over the project directly."
            : !isSelectedEligible
            ? "The planned follow-up was skipped because an alternative provider was selected."
            : "The planned follow-up was skipped because the request is no longer eligible.",
        createdAt: now,
      });
      return "skipped";
    }

    const dueAt = Date.now() + FOLLOW_UP_DELAY_MS;
    const scheduledFunctionId = await ctx.scheduler.runAt(
      dueAt,
      internal.outreach.sendScheduledFollowUp,
      { parentOutreachId: parent._id, ownerId: args.ownerId },
    );
    const now = Date.now();
    await ctx.db.patch("outreachMessages", parent._id, {
      followUpState: "scheduled",
      nextFollowUpAt: dueAt,
      followUpScheduledFunctionId: scheduledFunctionId,
      followUpFailureReason: undefined,
      updatedAt: now,
    });
      await ctx.db.insert("jobEvents", {
        jobId: parent.jobId,
        ownerId: args.ownerId,
        eventType: "follow_up_scheduled",
        message:
          "Follow-up planned for " +
          (candidate?.name ?? "the selected provider") +
          ".",
        createdAt: now,
      });
    return "scheduled";
  },
});

export const cancelPendingFollowUpsForSafety = internalMutation({
  args: { jobId: v.id("jobs") },
  returns: v.object({ cancelledCount: v.number() }),
  handler: async (ctx, args) => {
    const messages = await ctx.db
      .query("outreachMessages")
      .withIndex("by_job_and_createdAt", (q) => q.eq("jobId", args.jobId))
      .take(20);
    const job = await ctx.db.get("jobs", args.jobId);
    if (!job) return { cancelledCount: 0 };

    let cancelledCount = 0;
    for (const message of messages) {
      if (
        message.ownerId !== job.ownerId ||
        message.purpose !== "initial" ||
        !["scheduling", "scheduled", "due"].includes(message.followUpState ?? "")
      ) {
        continue;
      }
      if (message.followUpScheduledFunctionId) {
        try {
          await ctx.scheduler.cancel(message.followUpScheduledFunctionId);
        } catch {
          // The callback may already be running; callback-time rechecks remain authoritative.
        }
      }
      const now = Date.now();
      await ctx.db.patch("outreachMessages", message._id, {
        followUpState: "cancelled",
        nextFollowUpAt: undefined,
        followUpScheduledFunctionId: undefined,
        followUpFailureReason:
          "Historical owner-UAT campaign stopped after provider-quality safety defect.",
        updatedAt: now,
      });
      await ctx.db.insert("jobEvents", {
        jobId: args.jobId,
        ownerId: job.ownerId,
        eventType: "follow_up_skipped",
        message:
          "Historical owner-UAT campaign stopped after provider-quality safety defect; no follow-up was sent.",
        createdAt: now,
      });
      cancelledCount += 1;
    }
    return { cancelledCount };
  },
});

export const markFollowUpDue = internalMutation({
  args: { parentOutreachId: v.id("outreachMessages"), ownerId: v.id("users") },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const parent = await ctx.db.get("outreachMessages", args.parentOutreachId);
    const job = parent ? await ctx.db.get("jobs", parent.jobId) : null;
    if (
      !parent ||
      !job ||
      parent.ownerId !== args.ownerId ||
      job.ownerId !== args.ownerId ||
      parent.purpose !== "initial" ||
      parent.status !== "sent" ||
      !parent.externalMessageId ||
      !parent.externalThreadId
    ) {
      return false;
    }
    const candidate = await ctx.db.get("providerCandidates", parent.candidateId);
    const isSelectedEligible =
      !job.selectedCandidateId || parent.candidateId === job.selectedCandidateId;
    if (job.continuationMode === "user_takeover" || !isSelectedEligible) {
      const now = Date.now();
      await ctx.db.patch("outreachMessages", parent._id, {
        followUpState: "cancelled",
        nextFollowUpAt: undefined,
        followUpScheduledFunctionId: undefined,
        followUpFailureReason:
          job.continuationMode === "user_takeover"
            ? "The user took over communication directly; follow-up cancelled."
            : "An alternative provider was selected; follow-up cancelled.",
        updatedAt: now,
      });
      await ctx.db.insert("jobEvents", {
        jobId: parent.jobId,
        ownerId: args.ownerId,
        eventType: "follow_up_skipped",
        message:
          job.continuationMode === "user_takeover"
            ? "The follow-up was cancelled because the user took over the project directly."
            : "The follow-up was cancelled because an alternative provider was selected.",
        createdAt: now,
      });
      return false;
    }
    if (!candidate || !hasCurrentFollowUpProvider(candidate, job)) {
      const now = Date.now();
      await ctx.db.patch("outreachMessages", parent._id, {
        followUpState: "cancelled",
        nextFollowUpAt: undefined,
        followUpScheduledFunctionId: undefined,
        followUpFailureReason:
          "Current provider-quality eligibility failed; no follow-up was sent.",
        updatedAt: now,
      });
      await ctx.db.insert("jobEvents", {
        jobId: parent.jobId,
        ownerId: args.ownerId,
        eventType: "follow_up_skipped",
        message:
          "The follow-up was cancelled because the current provider-quality gate no longer passes.",
        createdAt: now,
      });
      return false;
    }

    if (parent.followUpState === "due") return true;
    if (parent.followUpState !== "scheduled") return false;

    const existing = await ctx.db
      .query("outreachMessages")
      .withIndex("by_parentOutreachId", (q) => q.eq("parentOutreachId", parent._id))
      .take(1);
    if (existing[0]) {
      const now = Date.now();
      await ctx.db.patch("outreachMessages", parent._id, {
        followUpState:
          existing[0].status === "sent"
            ? "sent"
            : existing[0].status === "failed"
              ? "failed"
              : "due",
        followUpOutreachId: existing[0]._id,
        updatedAt: now,
      });
      return false;
    }

    const threadReplies = await ctx.db
      .query("inboundMessages")
      .withIndex("by_threadId_and_createdAt", (q) =>
        q.eq("threadId", parent.externalThreadId as string),
      )
      .order("desc")
      .take(1);
    const deliveryFailureInThread = threadReplies.some(
      (message) => message.processingStatus === "delivery_failed",
    );
    const maxFollowUps = job.autonomy
      ? Math.min(1, Math.max(0, Math.floor(job.autonomy.maxFollowUps)))
      : 0;
    const canProceed =
      isActiveAutonomousStatus(job.status) &&
      !job.activeOperation &&
      Boolean(job.autonomy?.enabled) &&
      Boolean(job.briefApprovedAt) &&
      Boolean(job.autonomy?.approvedAt) &&
      Boolean(job.structuredLocation) &&
      Boolean(job.autonomy?.allowFollowUp) &&
      maxFollowUps > 0 &&
      (parent.followUpCount ?? 0) < maxFollowUps &&
      threadReplies.length === 0;
    if (!canProceed) {
      const state = followUpSkipState(job.status);
      const now = Date.now();
      await ctx.db.patch("outreachMessages", parent._id, {
        followUpState: state,
        nextFollowUpAt: undefined,
        followUpFailureReason:
          deliveryFailureInThread
            ? "A delivery failure was recorded for this address/thread; the follow-up was suppressed."
            : threadReplies.length > 0
            ? "A provider reply arrived before the follow-up was sent."
            : undefined,
        updatedAt: now,
      });
      await ctx.db.insert("jobEvents", {
        jobId: parent.jobId,
        ownerId: args.ownerId,
        eventType: "follow_up_skipped",
        message:
          deliveryFailureInThread
            ? "The follow-up was suppressed because a delivery failure was recorded for this address/thread."
            : threadReplies.length > 0
            ? "The follow-up was skipped because the provider replied."
            : "The follow-up was skipped because the request is paused, closed, revoked, or otherwise no longer eligible.",
        createdAt: now,
      });
      return false;
    }

    const now = Date.now();
    await ctx.db.patch("outreachMessages", parent._id, {
      followUpState: "due",
      nextFollowUpAt: undefined,
      updatedAt: now,
    });
    await ctx.db.insert("jobEvents", {
      jobId: parent.jobId,
      ownerId: args.ownerId,
      eventType: "follow_up_due",
      message: "The bounded follow-up is due and is being rechecked before any external action.",
      createdAt: now,
    });
    return true;
  },
});

export const createFollowUp = internalMutation({
  args: { parentOutreachId: v.id("outreachMessages"), ownerId: v.id("users") },
  returns: v.union(v.null(), followUpCreationValidator),
  handler: async (ctx, args) => {
    const parent = await ctx.db.get("outreachMessages", args.parentOutreachId);
    if (
      !parent ||
      parent.ownerId !== args.ownerId ||
      parent.purpose !== "initial" ||
      parent.status !== "sent" ||
      parent.followUpState !== "due" ||
      !parent.externalMessageId ||
      !parent.externalThreadId
    ) {
      return null;
    }
    const job = await ctx.db.get("jobs", parent.jobId);
    const existing = await ctx.db
      .query("outreachMessages")
      .withIndex("by_parentOutreachId", (q) => q.eq("parentOutreachId", args.parentOutreachId))
      .take(1);
    const threadReplies = await ctx.db
      .query("inboundMessages")
      .withIndex("by_threadId_and_createdAt", (q) =>
        q.eq("threadId", parent.externalThreadId as string),
      )
      .order("desc")
      .take(1);
    const maxFollowUps = job?.autonomy
      ? Math.min(1, Math.max(0, Math.floor(job.autonomy.maxFollowUps)))
      : 0;
    const isSelectedEligible =
      !job?.selectedCandidateId || parent.candidateId === job.selectedCandidateId;
    const canCreate =
      Boolean(job) &&
      job?.ownerId === args.ownerId &&
      isActiveAutonomousStatus(job.status) &&
      job.continuationMode !== "user_takeover" &&
      isSelectedEligible &&
      !job.activeOperation &&
      Boolean(job.structuredLocation) &&
      Boolean(job.autonomy?.enabled) &&
      Boolean(job.autonomy?.allowFollowUp) &&
      maxFollowUps > 0 &&
      (parent.followUpCount ?? 0) < maxFollowUps &&
      !existing[0] &&
      threadReplies.length === 0;
    if (!canCreate) {
      const now = Date.now();
      if (existing[0]) {
        await ctx.db.patch("outreachMessages", parent._id, {
          followUpOutreachId: existing[0]._id,
          followUpState:
            existing[0].status === "sent"
              ? "sent"
              : existing[0].status === "failed"
                ? "failed"
                : "due",
          updatedAt: now,
        });
        return null;
      }
      await ctx.db.patch("outreachMessages", parent._id, {
        followUpState: followUpSkipState(job?.status ?? "needs_user"),
        nextFollowUpAt: undefined,
        followUpFailureReason:
          threadReplies.length > 0
            ? "A provider reply arrived before the follow-up was sent."
            : undefined,
        updatedAt: now,
      });
      await ctx.db.insert("jobEvents", {
        jobId: parent.jobId,
        ownerId: args.ownerId,
        eventType: "follow_up_skipped",
        message:
          threadReplies.length > 0
            ? "The follow-up was skipped because the provider replied."
            : "The follow-up was skipped at the final pre-send recheck.",
        createdAt: now,
      });
      return null;
    }

    const location = formatExternalServiceArea(
      job.structuredLocation,
      job.serviceLocation,
    );
    const body = [
      "Hello,",
      "",
      "Following up on our inquiry regarding " +
        job.jobTitle.toLowerCase() +
        " in " +
        location +
        ".",
      "",
      "Could you let us know if you have availability and would be interested in providing a quote?",
      "",
      "This follow-up is an inquiry only. It does not authorize work, accept a quote, create a booking, schedule a visit, or form a binding contract.",
      "",
      "Thank you,",
      "Sent at the customer's request via Findor",
    ].join("\n");
    const subject = parent.subject.toLowerCase().startsWith("re:")
      ? parent.subject
      : "Re: " + parent.subject;
    const now = Date.now();
    const outreachId = await ctx.db.insert("outreachMessages", {
      jobId: parent.jobId,
      ownerId: args.ownerId,
      candidateId: parent.candidateId,
      cycleId: parent.cycleId,
      status: "approved",
      purpose: "follow_up",
      providerEmail: parent.providerEmail,
      subject,
      body,
      parentOutreachId: parent._id,
      sendAttemptCount: 0,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.patch("outreachMessages", parent._id, {
      followUpOutreachId: outreachId,
      updatedAt: now,
    });
    return {
      outreachId,
      providerEmail: parent.providerEmail,
      subject,
      body,
    };
  },
});
export const claimFollowUpForSend = internalMutation({
  args: { jobId: v.id("jobs"), ownerId: v.id("users"), outreachId: v.id("outreachMessages") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const job = await ctx.db.get("jobs", args.jobId);
    const message = await ctx.db.get("outreachMessages", args.outreachId);
    const candidate = message
      ? await ctx.db.get("providerCandidates", message.candidateId)
      : null;
    const parent = message?.parentOutreachId
      ? await ctx.db.get("outreachMessages", message.parentOutreachId)
      : null;
    const threadReplies = parent?.externalThreadId
      ? await ctx.db
          .query("inboundMessages")
          .withIndex("by_threadId_and_createdAt", (q) =>
            q.eq("threadId", parent.externalThreadId as string),
          )
          .order("desc")
          .take(1)
      : [];
    const maxFollowUps = job?.autonomy
      ? Math.min(1, Math.max(0, Math.floor(job.autonomy.maxFollowUps)))
      : 0;
    const isSelectedEligible =
      !job?.selectedCandidateId || message?.candidateId === job.selectedCandidateId;
    if (
      !job ||
      job.ownerId !== args.ownerId ||
      !isActiveAutonomousStatus(job.status) ||
      job.continuationMode === "user_takeover" ||
      !isSelectedEligible ||
      job.activeOperation ||
      !job.autonomy?.enabled ||
      !job.autonomy.allowFollowUp ||
      !job.briefApprovedAt ||
      !job.autonomy.approvedAt ||
      !job.structuredLocation ||
      !message ||
      message.ownerId !== args.ownerId ||
      message.jobId !== args.jobId ||
      message.purpose !== "follow_up" ||
      message.status !== "approved" ||
      !candidate ||
      !hasCurrentFollowUpProvider(candidate, job) ||
      !parent ||
      parent.ownerId !== args.ownerId ||
      parent.jobId !== args.jobId ||
      parent.purpose !== "initial" ||
      parent.status !== "sent" ||
      !parent.externalMessageId ||
      !parent.externalThreadId ||
      parent.followUpState !== "due" ||
      maxFollowUps <= 0 ||
       (parent.followUpCount ?? 0) > maxFollowUps ||
      threadReplies.length > 0
    ) {
      throw new Error("Follow-up is no longer sendable.");
    }
    await ctx.db.patch("outreachMessages", args.outreachId, {
      status: "sending",
      sendAttemptCount: (message.sendAttemptCount ?? 0) + 1,
      lastAttemptAt: Date.now(),
      updatedAt: Date.now(),
    });
    await ctx.db.patch("jobs", args.jobId, {
      activeOperation: "outreach_send",
      updatedAt: Date.now(),
    });
    return null;
  },
});

export const markFollowUpSent = internalMutation({
  args: {
    jobId: v.id("jobs"),
    ownerId: v.id("users"),
    outreachId: v.id("outreachMessages"),
    messageId: v.string(),
    threadId: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const message = await ctx.db.get("outreachMessages", args.outreachId);
    const job = await ctx.db.get("jobs", args.jobId);
    const candidate = message
      ? await ctx.db.get("providerCandidates", message.candidateId)
      : null;
    if (!message || !job || message.status !== "sending" || message.ownerId !== args.ownerId || job.ownerId !== args.ownerId) {
      throw new Error("Follow-up cannot be marked as sent.");
    }
    const now = Date.now();
    await ctx.db.patch("outreachMessages", args.outreachId, {
      status: "sent",
      externalMessageId: args.messageId,
      externalThreadId: args.threadId,
      failureReason: undefined,
      updatedAt: now,
    });
    const parent = message.parentOutreachId
      ? await ctx.db.get("outreachMessages", message.parentOutreachId)
      : null;
    if (parent && parent.ownerId === args.ownerId && parent.jobId === args.jobId) {
      await ctx.db.patch("outreachMessages", parent._id, {
        followUpState: "sent",
        followUpOutreachId: args.outreachId,
        nextFollowUpAt: undefined,
        updatedAt: now,
      });
      if (job.recoveryEnabled && parent.providerResolution === "waiting") {
        const checkAt = now + FOLLOW_UP_RESPONSE_WAIT_MS;
        const scheduledFunctionId = await ctx.scheduler.runAt(
          checkAt,
          internal.outreach.resolveFinalResponse,
          { parentOutreachId: parent._id, ownerId: args.ownerId },
        );
        await ctx.db.patch("outreachMessages", parent._id, {
          finalResponseCheckAt: checkAt,
          finalResponseCheckScheduledFunctionId: scheduledFunctionId,
          updatedAt: Date.now(),
        });
      }
    }
    await ctx.db.patch("jobs", args.jobId, { activeOperation: undefined, updatedAt: now });
    await ctx.db.insert("jobEvents", {
      jobId: args.jobId,
      ownerId: args.ownerId,
      eventType: "follow_up_sent",
      message:
        "AgentMail accepted the bounded follow-up to " +
        (candidate?.name ?? "the selected provider") +
        ".",
      createdAt: now,
    });
    return null;
  },
});

export const markFollowUpFailed = internalMutation({
  args: {
    jobId: v.id("jobs"),
    ownerId: v.id("users"),
    outreachId: v.id("outreachMessages"),
    reason: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const message = await ctx.db.get("outreachMessages", args.outreachId);
    const job = await ctx.db.get("jobs", args.jobId);
    if (!message || !job || message.ownerId !== args.ownerId || job.ownerId !== args.ownerId || message.jobId !== args.jobId || message.purpose !== "follow_up" || message.status !== "sending") return null;
    const now = Date.now();
    await ctx.db.patch("outreachMessages", args.outreachId, {
      status: "failed",
      failureReason: args.reason,
      updatedAt: now,
    });
    await ctx.db.patch("jobs", args.jobId, {
      status: "needs_user",
      autonomyStopReason: "The bounded follow-up did not receive a successful external receipt. Review before any further action.",
      activeOperation: undefined,
      updatedAt: now,
    });
    const parent = message.parentOutreachId
      ? await ctx.db.get("outreachMessages", message.parentOutreachId)
      : null;
    if (parent && parent.ownerId === args.ownerId && parent.jobId === args.jobId) {
      await ctx.db.patch("outreachMessages", parent._id, {
        followUpState: "failed",
        followUpOutreachId: args.outreachId,
        followUpFailureReason: args.reason,
        nextFollowUpAt: undefined,
        ...(job.recoveryEnabled ? { providerResolution: "needs_user" as const } : {}),
        ...(job.recoveryEnabled
          ? {
              finalResponseCheckAt: undefined,
              finalResponseCheckScheduledFunctionId: undefined,
            }
          : {}),
        updatedAt: now,
      });
    }
    await ctx.db.insert("jobEvents", {
      jobId: args.jobId,
      ownerId: args.ownerId,
      eventType: "follow_up_failed",
      message: "Follow-up failed without a successful external receipt; Findor stopped for review.",
      createdAt: now,
    });
    return null;
  },
});

export const markFollowUpSkipped = internalMutation({
  args: {
    jobId: v.id("jobs"),
    ownerId: v.id("users"),
    outreachId: v.id("outreachMessages"),
    reason: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const message = await ctx.db.get("outreachMessages", args.outreachId);
    const job = await ctx.db.get("jobs", args.jobId);
    if (
      !message ||
      !job ||
      message.ownerId !== args.ownerId ||
      job.ownerId !== args.ownerId ||
      message.jobId !== args.jobId ||
      message.purpose !== "follow_up" ||
      message.status !== "approved"
    ) {
      return null;
    }
    const parent = message.parentOutreachId
      ? await ctx.db.get("outreachMessages", message.parentOutreachId)
      : null;
    const now = Date.now();
    await ctx.db.patch("outreachMessages", args.outreachId, {
      status: "failed",
      failureReason: args.reason,
      updatedAt: now,
    });
    if (parent && parent.ownerId === args.ownerId && parent.jobId === args.jobId) {
      await ctx.db.patch("outreachMessages", parent._id, {
        followUpState: followUpSkipState(job.status),
        followUpOutreachId: args.outreachId,
        followUpFailureReason: args.reason,
        nextFollowUpAt: undefined,
        updatedAt: now,
      });
    }
    await ctx.db.insert("jobEvents", {
      jobId: args.jobId,
      ownerId: args.ownerId,
      eventType: "follow_up_skipped",
      message: "The follow-up was skipped before any external send because the request was no longer eligible.",
      createdAt: now,
    });
    return null;
  },
});
async function sendAgentMail(
  apiKey: string,
  inboxId: string,
  draft: { providerEmail: string; subject: string; body: string },
) {
  const response = await fetch(
    "https://api.agentmail.to/v0/inboxes/" + encodeURIComponent(inboxId) + "/messages/send",
    {
      method: "POST",
      headers: {
        Authorization: "Bearer " + apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        to: [draft.providerEmail],
        subject: draft.subject,
        text: draft.body,
      }),
    },
  );
  if (!response.ok) throw new Error("AgentMail request failed.");
  const payload: unknown = await response.json();
  if (
    !isRecord(payload) ||
    typeof payload.message_id !== "string" ||
    typeof payload.thread_id !== "string" ||
    payload.message_id.length === 0 ||
    payload.thread_id.length === 0
  ) {
    throw new Error("AgentMail returned no usable external receipt.");
  }
  return { messageId: payload.message_id, threadId: payload.thread_id };
}

export const sendAutonomousBatch = internalAction({
  args: {
    jobId: v.id("jobs"),
    ownerId: v.id("users"),
    continuousRecoveryCycleId: v.optional(v.id("jobCycles")),
  },
  returns: sendBatchResultValidator,
  handler: async (ctx, args) => {
    let sentCount = 0;
    let failedSendCount = 0;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const sendables = await ctx.runQuery(
        internal.outreach.getAutonomousSendables,
        { jobId: args.jobId, ownerId: args.ownerId },
      );
      const draft = sendables[0];
      if (!draft) break;

      let claimed = false;
      try {
        await ctx.runMutation(internal.outreach.claimForSend, {
          jobId: args.jobId,
          ownerId: args.ownerId,
          outreachId: draft.outreachId,
        });
        claimed = true;
      } catch {
        break;
      }

      try {
        const apiKey = env.AGENTMAIL_API_KEY;
        const inboxId = env.AGENTMAIL_INBOX_ID;
        if (!apiKey || !inboxId) throw new Error("AgentMail is not configured.");
        const receipt = await sendAgentMail(apiKey, inboxId, draft);
        await ctx.runMutation(internal.outreach.markSent, {
          jobId: args.jobId,
          ownerId: args.ownerId,
          outreachId: draft.outreachId,
          messageId: receipt.messageId,
          threadId: receipt.threadId,
        });
        sentCount += 1;
      } catch {
        if (claimed) {
          await ctx.runMutation(internal.outreach.markFailed, {
            jobId: args.jobId,
            ownerId: args.ownerId,
            outreachId: draft.outreachId,
            reason: "AgentMail did not return a successful receipt; no successful send is recorded.",
          });
        }
        failedSendCount += 1;
      }
    }
    if (args.continuousRecoveryCycleId) {
      await ctx.runMutation(internal.jobs.finalizeContinuousRecoveryRound, {
        jobId: args.jobId,
        ownerId: args.ownerId,
        cycleId: args.continuousRecoveryCycleId,
        failedSendCount,
      });
    }
    return { sentCount, failedSendCount };
  },
});
export const sendScheduledFollowUp = internalAction({
  args: { parentOutreachId: v.id("outreachMessages"), ownerId: v.id("users") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const due = await ctx.runMutation(internal.outreach.markFollowUpDue, args);
    if (!due) return null;
    const parent = await ctx.runQuery(internal.outreach.getFollowUpParent, args);
    if (!parent) return null;
    const created = await ctx.runMutation(internal.outreach.createFollowUp, args);
    if (!created) return null;

    let claimed = false;
    try {
      await ctx.runMutation(internal.outreach.claimFollowUpForSend, {
        jobId: parent.jobId,
        ownerId: args.ownerId,
        outreachId: created.outreachId,
      });
      claimed = true;
      const apiKey = env.AGENTMAIL_API_KEY;
      const inboxId = env.AGENTMAIL_INBOX_ID;
      if (!apiKey || !inboxId) throw new Error("AgentMail is not configured.");
      const receipt = await sendAgentMail(apiKey, inboxId, created);
      await ctx.runMutation(internal.outreach.markFollowUpSent, {
        jobId: parent.jobId,
        ownerId: args.ownerId,
        outreachId: created.outreachId,
        messageId: receipt.messageId,
        threadId: receipt.threadId,
      });
    } catch {
      if (claimed) {
        await ctx.runMutation(internal.outreach.markFollowUpFailed, {
          jobId: parent.jobId,
          ownerId: args.ownerId,
          outreachId: created.outreachId,
          reason: "AgentMail did not return a successful receipt; Findor stopped for review.",
        });
      } else {
        await ctx.runMutation(internal.outreach.markFollowUpSkipped, {
          jobId: parent.jobId,
          ownerId: args.ownerId,
          outreachId: created.outreachId,
          reason: "The request changed state before the follow-up could be claimed; no external send was attempted.",
        });
      }
    }
    return null;
  },
});

export const getRecoverySendable = internalQuery({
  args: { outreachId: v.id("outreachMessages"), ownerId: v.id("users") },
  returns: v.union(
    v.null(),
    v.object({
      jobId: v.id("jobs"),
      ownerId: v.id("users"),
      providerEmail: v.string(),
      subject: v.string(),
      body: v.string(),
      status: outreachStatusValidator,
    }),
  ),
  handler: async (ctx, args) => {
    const message = await ctx.db.get("outreachMessages", args.outreachId);
    const job = message ? await ctx.db.get("jobs", message.jobId) : null;
    const candidate = message
      ? await ctx.db.get("providerCandidates", message.candidateId)
      : null;
    if (
      !message ||
      !job ||
      !candidate ||
      message.ownerId !== args.ownerId ||
      job.ownerId !== args.ownerId ||
      message.purpose !== "initial" ||
      message.status !== "approved" ||
      isBlockedRecoveryJob(job) ||
      job.status !== "outreach_approved" ||
      !hasSourceBackedPublicBusinessEmail(candidate) ||
      !isProviderCountryCompatible(candidate, job.structuredLocation) ||
      !isProviderRelevantToJob(candidate, job)
    ) {
      return null;
    }
    return {
      jobId: job._id,
      ownerId: job.ownerId,
      providerEmail: message.providerEmail,
      subject: message.subject,
      body: message.body,
      status: message.status,
    };
  },
});

export const sendRecoveryProvider = internalAction({
  args: { outreachId: v.id("outreachMessages"), ownerId: v.id("users") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const draft = await ctx.runQuery(internal.outreach.getRecoverySendable, args);
    if (!draft) return null;
    let claimed = false;
    try {
      await ctx.runMutation(internal.outreach.claimForSend, {
        jobId: draft.jobId,
        ownerId: args.ownerId,
        outreachId: args.outreachId,
      });
      claimed = true;
      const apiKey = env.AGENTMAIL_API_KEY;
      const inboxId = env.AGENTMAIL_INBOX_ID;
      if (!apiKey || !inboxId) throw new Error("AgentMail is not configured.");
      const receipt = await sendAgentMail(apiKey, inboxId, draft);
      await ctx.runMutation(internal.outreach.markSent, {
        jobId: draft.jobId,
        ownerId: args.ownerId,
        outreachId: args.outreachId,
        messageId: receipt.messageId,
        threadId: receipt.threadId,
      });
    } catch {
      if (claimed) {
        await ctx.runMutation(internal.outreach.markFailed, {
          jobId: draft.jobId,
          ownerId: args.ownerId,
          outreachId: args.outreachId,
          reason: "AgentMail did not return a successful receipt; Findor stopped for review.",
        });
      }
    }
    return null;
  },
});

export const getFollowUpParent = internalQuery({
  args: { parentOutreachId: v.id("outreachMessages"), ownerId: v.id("users") },
  returns: v.union(
    v.null(),
    v.object({
      jobId: v.id("jobs"),
      ownerId: v.id("users"),
    }),
  ),
  handler: async (ctx, args) => {
    const parent = await ctx.db.get("outreachMessages", args.parentOutreachId);
    const job = parent ? await ctx.db.get("jobs", parent.jobId) : null;
    if (!parent || !job || parent.ownerId !== args.ownerId || job.ownerId !== args.ownerId) return null;
    return { jobId: job._id, ownerId: job.ownerId };
  },
});
export const getApprovedForAction = internalQuery({
  args: { jobId: v.id("jobs"), ownerId: v.id("users") },
  returns: v.union(
    v.null(),
    v.object({
      outreachId: v.id("outreachMessages"),
      providerEmail: v.string(),
      subject: v.string(),
      body: v.string(),
      status: outreachStatusValidator,
    }),
  ),
  handler: async (ctx, args) => {
    const job = await ctx.db.get("jobs", args.jobId);
    if (
      !job ||
      job.ownerId !== args.ownerId ||
      job.autonomy?.enabled ||
      Boolean(job.selectedCandidateId) ||
      job.continuationMode === "user_takeover"
    ) {
      return null;
    }

    const messages = await ctx.db
      .query("outreachMessages")
      .withIndex("by_job_and_createdAt", (q) => q.eq("jobId", args.jobId))
      .order("desc")
      .take(1);
    const message = messages[0];
    if (!message || message.ownerId !== args.ownerId || message.purpose === "routine_clarification" || message.purpose === "follow_up") return null;
    return {
      outreachId: message._id,
      providerEmail: message.providerEmail,
      subject: message.subject,
      body: message.body,
      status: message.status,
    };
  },
});

export const claimForSend = internalMutation({
  args: {
    jobId: v.id("jobs"),
    ownerId: v.id("users"),
    outreachId: v.id("outreachMessages"),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const job = await ctx.db.get("jobs", args.jobId);
    const message = await ctx.db.get("outreachMessages", args.outreachId);
    const autonomousInitial =
      message?.purpose === "initial" && Boolean(job?.autonomy?.enabled);
    const allowedJobStatus = autonomousInitial
      ? job?.status === "outreach_approved" || job?.status === "outreach_sent"
      : job?.status === "outreach_approved";
    if (
      !job ||
      job.ownerId !== args.ownerId ||
      !allowedJobStatus ||
      job.activeOperation ||
      Boolean(job.selectedCandidateId) ||
      job.continuationMode === "user_takeover" ||
      !message ||
      message.ownerId !== args.ownerId ||
      message.jobId !== args.jobId ||
      (message.status !== "approved" && (!autonomousInitial && message.status !== "failed")) ||
      (autonomousInitial &&
        (!job.autonomy?.allowInitialOutreach ||
          message.purpose !== "initial" ||
          message.status !== "approved"))
    ) {
      throw new Error(
        "This outreach message is already being sent or is no longer sendable.",
      );
    }

    const now = Date.now();
    // Final geographic choke point: no send of any kind leaves Findor for a
    // provider whose resolved country conflicts with the job country.
    const sendCandidate = message
      ? await ctx.db.get("providerCandidates", message.candidateId)
      : null;
    if (
      sendCandidate &&
      !isProviderCountryCompatible(
        sendCandidate,
        job?.structuredLocation,
      )
    ) {
      throw new Error(
        "This outreach message is already being sent or is no longer sendable.",
      );
    }
    await ctx.db.patch("outreachMessages", args.outreachId, {
      status: "sending",
      sendAttemptCount: (message.sendAttemptCount ?? 0) + 1,
      lastAttemptAt: now,
      failureReason: undefined,
      updatedAt: now,
    });
    await ctx.db.patch("jobs", args.jobId, {
      activeOperation: "outreach_send",
      updatedAt: now,
    });
    return null;
  },
});
export const markSent = internalMutation({
  args: {
    jobId: v.id("jobs"),
    ownerId: v.id("users"),
    outreachId: v.id("outreachMessages"),
    messageId: v.string(),
    threadId: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const job = await ctx.db.get("jobs", args.jobId);
    const message = await ctx.db.get("outreachMessages", args.outreachId);
    const candidate = message
      ? await ctx.db.get("providerCandidates", message.candidateId)
      : null;
    if (!job || !message || job.ownerId !== args.ownerId || message.ownerId !== args.ownerId || message.jobId !== args.jobId) {
      throw new Error("This outreach message cannot be marked as sent.");
    }
    if (message.status === "sent") {
      if (message.externalMessageId === args.messageId && message.externalThreadId === args.threadId) return null;
      throw new Error("This outreach message already has a different external receipt.");
    }
    if (message.status !== "sending") {
      throw new Error("This outreach message cannot be marked as sent.");
    }

    const now = Date.now();
    await ctx.db.patch("outreachMessages", args.outreachId, {
      status: "sent",
      externalMessageId: args.messageId,
      externalThreadId: args.threadId,
      ...(message.purpose === "initial" && job.recoveryEnabled
        ? { providerResolution: "waiting" as const }
        : {}),
      failureReason: undefined,
      updatedAt: now,
    });
    await ctx.db.patch("jobs", args.jobId, {
      status: "outreach_sent",
      activeOperation: undefined,
      updatedAt: now,
    });
    await ctx.db.insert("jobEvents", {
      jobId: args.jobId,
      ownerId: args.ownerId,
      eventType: "outreach_sent",
      message:
        "AgentMail accepted outreach to " +
        (candidate?.name ?? "the selected provider") +
        ".",
      createdAt: now,
    });
    if (message.purpose === "initial" && job.autonomy?.enabled) {
      const maxFollowUps = Math.min(1, Math.max(0, Math.floor(job.autonomy.maxFollowUps)));
      if (job.autonomy.allowFollowUp && maxFollowUps > 0 && job.structuredLocation) {
        const triggerId = await ctx.scheduler.runAfter(
          0,
          internal.outreach.scheduleFollowUp,
          { parentOutreachId: message._id, ownerId: args.ownerId },
        );
        await ctx.db.patch("outreachMessages", message._id, {
          followUpState: "scheduling",
          followUpScheduledFunctionId: triggerId,
          followUpFailureReason: undefined,
          updatedAt: Date.now(),
        });
      } else {
        await ctx.db.patch("outreachMessages", message._id, {
          followUpState: "skipped",
          nextFollowUpAt: undefined,
          followUpFailureReason: "Follow-up permission was not enabled for this mandate.",
          updatedAt: Date.now(),
        });
        await ctx.db.insert("jobEvents", {
          jobId: args.jobId,
          ownerId: args.ownerId,
          eventType: "follow_up_skipped",
          message: "No follow-up was scheduled because the approved mandate did not enable one." ,
          createdAt: Date.now(),
        });
        if (message.purpose === "initial" && job.recoveryEnabled) {
          const checkAt = Date.now() + FOLLOW_UP_RESPONSE_WAIT_MS;
          const scheduledFunctionId = await ctx.scheduler.runAt(
            checkAt,
            internal.outreach.resolveFinalResponse,
            { parentOutreachId: message._id, ownerId: args.ownerId },
          );
          await ctx.db.patch("outreachMessages", message._id, {
            finalResponseCheckAt: checkAt,
            finalResponseCheckScheduledFunctionId: scheduledFunctionId,
            updatedAt: Date.now(),
          });
        }
      }
    }
    return null;
  },
});
export const markFailed = internalMutation({
  args: {
    jobId: v.id("jobs"),
    ownerId: v.id("users"),
    outreachId: v.id("outreachMessages"),
    reason: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const job = await ctx.db.get("jobs", args.jobId);
    const message = await ctx.db.get("outreachMessages", args.outreachId);
    const candidate = message
      ? await ctx.db.get("providerCandidates", message.candidateId)
      : null;
    if (
      !job ||
      job.ownerId !== args.ownerId ||
      !message ||
      message.ownerId !== args.ownerId ||
      message.jobId !== args.jobId
    ) {
      return null;
    }

    const now = Date.now();
    await ctx.db.patch("outreachMessages", args.outreachId, {
      status: "failed",
      ...(job.recoveryEnabled && message.purpose === "initial"
        ? { providerResolution: "send_failed" as const }
        : {}),
      failureReason: args.reason,
      updatedAt: now,
    });
    await ctx.db.patch("jobs", args.jobId, {
      status:
        job.recoveryEnabled && message.purpose === "initial"
          ? "needs_user"
          : "outreach_approved",
      ...(job.recoveryEnabled && message.purpose === "initial"
        ? {
            autonomyStopReason:
              "A recovery provider could not be contacted successfully. Review the failed outbound record before continuing.",
          }
        : {}),
      activeOperation: undefined,
      updatedAt: now,
    });
    await ctx.db.insert("jobEvents", {
      jobId: args.jobId,
      ownerId: args.ownerId,
      eventType: "outreach_failed",
      message:
        "AgentMail did not return an external receipt for " +
        (candidate?.name ?? "the selected provider") +
        ". No successful send is recorded.",
      createdAt: now,
    });
    return null;
  },
});

export const sendApproved = action({
  args: { jobId: v.id("jobs") },
  returns: v.object({
    status: v.literal("sent"),
    messageId: v.string(),
    threadId: v.string(),
  }),
  handler: async (ctx, args) => {
    const ownerId = await requireUserId(ctx);
    const draft = await ctx.runQuery(internal.outreach.getApprovedForAction, {
      jobId: args.jobId,
      ownerId,
    });
    if (!draft || (draft.status !== "approved" && draft.status !== "failed")) {
      throw new Error("Approve a provider before sending outreach.");
    }

    const apiKey = env.AGENTMAIL_API_KEY;
    const inboxId = env.AGENTMAIL_INBOX_ID;
    if (!apiKey || !inboxId) {
      throw new Error("AgentMail is not configured on this Convex deployment.");
    }

    await ctx.runMutation(internal.outreach.claimForSend, {
      jobId: args.jobId,
      ownerId,
      outreachId: draft.outreachId,
    });
    try {
      const response = await fetch(
        `https://api.agentmail.to/v0/inboxes/${encodeURIComponent(inboxId)}/messages/send`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            to: [draft.providerEmail],
            subject: draft.subject,
            text: draft.body,
          }),
        },
      );

      if (!response.ok) {
        throw new Error(
          `AgentMail request failed with status ${response.status}.`,
        );
      }

      const payload: unknown = await response.json();
      if (
        !isRecord(payload) ||
        typeof payload.message_id !== "string" ||
        typeof payload.thread_id !== "string"
      ) {
        throw new Error("AgentMail returned no usable message receipt.");
      }

      await ctx.runMutation(internal.outreach.markSent, {
        jobId: args.jobId,
        ownerId,
        outreachId: draft.outreachId,
        messageId: payload.message_id,
        threadId: payload.thread_id,
      });
      return {
        status: "sent" as const,
        messageId: payload.message_id,
        threadId: payload.thread_id,
      };
    } catch (error) {
      await ctx.runMutation(internal.outreach.markFailed, {
        jobId: args.jobId,
        ownerId,
        outreachId: draft.outreachId,
        reason:
          "AgentMail did not accept the message. No external receipt was recorded.",
      });
      throw error instanceof Error
        ? error
        : new Error("AgentMail could not send the message.");
    }
  },
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
