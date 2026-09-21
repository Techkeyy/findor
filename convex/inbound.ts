import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import {
  action,
  httpAction,
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import type { ActionCtx, MutationCtx, QueryCtx } from "./_generated/server";
import { env } from "./_generated/server";
import { internal } from "./_generated/api";
import { autonomyStopReason, classifyAutonomyQuestion } from "./autonomy";
import type { Doc, Id } from "./_generated/dataModel";
import {
  mergeFullMessagePayload,
  parseMessageReceivedPayload,
  isDeliveryFailureMessage,
  verifySvixSignature,
  isRecord,
  parseInReplyTo,
  parseReferences,
} from "./inboundParsing";
import {
  formatExternalServiceArea,
  hasSourceBackedPublicBusinessEmail,
  isProviderRelevantToJob,
} from "./providerQuality";
import {
  countUsableSameBriefQuotes,
  normalizeQuoteTarget,
} from "./jobs";

const responseKindValidator = v.union(
  v.literal("quote"),
  v.literal("needs_information"),
  v.literal("availability"),
  v.literal("decline"),
  v.literal("acknowledgement"),
  v.literal("other"),
  v.literal("mixed"),
  v.literal("unclear"),
);

const processingStatusValidator = v.union(
  v.literal("received"),
  v.literal("understanding"),
  v.literal("understood"),
  v.literal("delivery_failed"),
  v.literal("needs_review"),
  v.literal("unmatched"),
  v.literal("failed"),
);

const inboundMessageValidator = v.object({
  _id: v.id("inboundMessages"),
  _creationTime: v.number(),
  ownerId: v.optional(v.id("users")),
  jobId: v.optional(v.id("jobs")),
  providerId: v.optional(v.id("providerCandidates")),
  outreachId: v.optional(v.id("outreachMessages")),
  cycleId: v.optional(v.id("jobCycles")),
  inboxId: v.string(),
  svixId: v.string(),
  eventId: v.string(),
  externalMessageId: v.string(),
  threadId: v.string(),
  sender: v.string(),
  recipients: v.array(v.string()),
  subject: v.string(),
  bodyText: v.string(),
  bodyHtml: v.optional(v.string()),
  receivedAt: v.number(),
  processingStatus: processingStatusValidator,
  responseKind: v.optional(responseKindValidator),
  inReplyTo: v.optional(v.string()),
  references: v.optional(v.array(v.string())),
  autorespondSubject: v.optional(v.string()),
  isAutoReply: v.optional(v.boolean()),
  lineageProof: v.optional(
    v.union(
      v.literal("tier_1_thread_id"),
      v.literal("tier_2_in_reply_to"),
      v.literal("tier_3_references"),
      v.literal("tier_4_conversation_membership"),
      v.literal("unproven"),
    ),
  ),
  understandingError: v.optional(v.string()),
  createdAt: v.number(),
  updatedAt: v.number(),
});

const attachmentValidator = v.object({
  _id: v.id("inboundAttachments"),
  _creationTime: v.number(),
  ownerId: v.optional(v.id("users")),
  jobId: v.optional(v.id("jobs")),
  providerId: v.optional(v.id("providerCandidates")),
  outreachId: v.optional(v.id("outreachMessages")),
  cycleId: v.optional(v.id("jobCycles")),
  inboundMessageId: v.id("inboundMessages"),
  externalMessageId: v.string(),
  externalAttachmentId: v.string(),
  filename: v.optional(v.string()),
  contentType: v.optional(v.string()),
  size: v.optional(v.number()),
  inline: v.optional(v.boolean()),
  contentDisposition: v.optional(v.string()),
  storageId: v.optional(v.id("_storage")),
  storageStatus: v.union(
    v.literal("metadata_only"),
    v.literal("downloaded"),
    v.literal("failed"),
  ),
  downloadError: v.optional(v.string()),
  createdAt: v.number(),
  updatedAt: v.number(),
});

const responseValidator = v.object({
  _id: v.id("providerResponses"),
  _creationTime: v.number(),
  ownerId: v.id("users"),
  jobId: v.id("jobs"),
  providerId: v.id("providerCandidates"),
  outreachId: v.id("outreachMessages"),
  inboundMessageId: v.id("inboundMessages"),
  cycleId: v.optional(v.id("jobCycles")),
  briefVersion: v.optional(v.number()),
  kind: responseKindValidator,
  headlinePrice: v.optional(v.string()),
  priceMin: v.optional(v.number()),
  priceMax: v.optional(v.number()),
  currency: v.optional(v.string()),
  availability: v.optional(v.string()),
  estimatedTiming: v.optional(v.string()),
  included: v.array(v.string()),
  excluded: v.array(v.string()),
  notStated: v.array(v.string()),
  unclear: v.array(v.string()),
  paymentTerms: v.optional(v.string()),
  warranty: v.optional(v.string()),
  assumptions: v.array(v.string()),
  informationNeeded: v.array(v.string()),
  inspectionRequirement: v.optional(v.string()),
  importantNotes: v.array(v.string()),
  evidenceText: v.string(),
  summary: v.optional(v.string()),
  confidence: v.optional(
    v.union(v.literal("high"), v.literal("medium"), v.literal("low")),
  ),
  requestedSensitiveInformation: v.optional(v.array(v.string())),
  requestedCommitments: v.optional(v.array(v.string())),
  evidence: v.optional(
    v.array(
      v.object({
        field: v.string(),
        excerpt: v.string(),
      }),
    ),
  ),
  model: v.string(),
  createdAt: v.number(),
  updatedAt: v.number(),
});

const conversationItemValidator = v.object({
  message: inboundMessageValidator,
  attachments: v.array(attachmentValidator),
  response: v.union(v.null(), responseValidator),
});

const comparisonValidator = v.object({
  response: responseValidator,
  providerName: v.string(),
  providerUrl: v.string(),
});

const clarificationSuggestionValidator = v.object({
  attribute: v.string(),
  reason: v.string(),
  proposedMessage: v.string(),
  sourceResponseId: v.id("providerResponses"),
  comparisonResponseId: v.id("providerResponses"),
});

const clarificationValidator = v.object({
  _id: v.id("clarificationDrafts"),
  _creationTime: v.number(),
  ownerId: v.id("users"),
  jobId: v.id("jobs"),
  attribute: v.string(),
  reason: v.string(),
  proposedMessage: v.string(),
  sourceResponseId: v.id("providerResponses"),
  comparisonResponseId: v.id("providerResponses"),
  cycleId: v.optional(v.id("jobCycles")),
  status: v.union(
    v.literal("suggested"),
    v.literal("approved"),
    v.literal("cancelled"),
    v.literal("sent"),
    v.literal("failed"),
  ),
  createdAt: v.number(),
  updatedAt: v.number(),
});

const parsedAttachmentValidator = v.object({
  externalAttachmentId: v.string(),
  filename: v.optional(v.string()),
  contentType: v.optional(v.string()),
  size: v.optional(v.number()),
  inline: v.optional(v.boolean()),
  contentDisposition: v.optional(v.string()),
});

const parsedMessageValidator = v.object({
  svixId: v.string(),
  eventId: v.string(),
  inboxId: v.string(),
  externalMessageId: v.string(),
  threadId: v.string(),
  inReplyTo: v.optional(v.string()),
  references: v.optional(v.array(v.string())),
  autorespondSubject: v.optional(v.string()),
  isAutoReply: v.optional(v.boolean()),
  conversationMessageIds: v.optional(v.array(v.string())),
  sender: v.string(),
  recipients: v.array(v.string()),
  subject: v.string(),
  bodyText: v.string(),
  bodyHtml: v.optional(v.string()),
  receivedAt: v.number(),
  attachments: v.array(parsedAttachmentValidator),
});

const ingestResultValidator = v.object({
  inboundMessageId: v.id("inboundMessages"),
  shouldUnderstand: v.boolean(),
  duplicate: v.boolean(),
  unmatched: v.boolean(),
});

const understandingInputValidator = v.object({
  inboundMessageId: v.id("inboundMessages"),
  serviceCategory: v.string(),
  serviceLocation: v.string(),
  requestedOutcome: v.string(),
  desiredTiming: v.string(),
  serviceContext: v.string(),
  providerName: v.string(),
  sender: v.string(),
  subject: v.string(),
  bodyText: v.string(),
  attachments: v.array(
    v.object({
      filename: v.optional(v.string()),
      contentType: v.optional(v.string()),
      size: v.optional(v.number()),
    }),
  ),
});

type AttachmentForAction = {
  inboundMessageId: Id<"inboundMessages">,
  externalMessageId: string,
  externalAttachmentId: string,
  filename?: string,
  storageId?: Id<"_storage">,
} | null;

const structuredUnderstandingValidator = v.object({
  kind: responseKindValidator,
  headlinePrice: v.union(v.string(), v.null()),
  priceQualifier: v.union(
    v.literal("exact"),
    v.literal("estimate"),
    v.literal("starting_from"),
    v.literal("range"),
    v.literal("unknown"),
    v.null(),
  ),
  priceMin: v.union(v.number(), v.null()),
  priceMax: v.union(v.number(), v.null()),
  currency: v.union(v.string(), v.null()),
  availability: v.union(v.string(), v.null()),
  estimatedTiming: v.union(v.string(), v.null()),
  included: v.array(v.string()),
  excluded: v.array(v.string()),
  notStated: v.array(v.string()),
  unclear: v.array(v.string()),
  paymentTerms: v.union(v.string(), v.null()),
  warranty: v.union(v.string(), v.null()),
  assumptions: v.array(v.string()),
  informationNeeded: v.array(v.string()),
  inspectionRequirement: v.union(v.string(), v.null()),
  importantNotes: v.array(v.string()),
  evidenceText: v.string(),
  summary: v.string(),
  confidence: v.union(v.literal("high"), v.literal("medium"), v.literal("low")),
  requestedSensitiveInformation: v.array(v.string()),
  requestedCommitments: v.array(v.string()),
  evidence: v.array(
    v.object({
      field: v.string(),
      excerpt: v.string(),
    }),
  ),
});
 async function requireUserId(ctx: QueryCtx | MutationCtx | ActionCtx) {
  const userId = await getAuthUserId(ctx);
  if (!userId) throw new Error("You must be signed in to view inbound messages.");
  return userId;
}

function normalizeMessageCandidates(id: string | undefined): string[] {
  if (!id || typeof id !== "string") return [];
  const trimmed = id.trim();
  if (!trimmed) return [];
  const stripped = trimmed.replace(/^<|>$/g, "").trim();
  const bracketed = stripped ? `<${stripped}>` : "";
  const set = new Set<string>();
  set.add(trimmed);
  if (stripped) set.add(stripped);
  if (bracketed) set.add(bracketed);
  return Array.from(set);
}

async function findMappedThread(
  ctx: MutationCtx,
  args: {
    threadId?: string;
    inReplyTo?: string;
    references?: string[];
    conversationMessageIds?: string[];
  },
) {
  let outreach: Doc<"outreachMessages"> | null = null;
  let lineageProof:
    | "tier_1_thread_id"
    | "tier_2_in_reply_to"
    | "tier_3_references"
    | "tier_4_conversation_membership"
    | undefined = undefined;

  // Tier 1: Match by exact externalThreadId
  if (args.threadId) {
    const threadMatches = await ctx.db
      .query("outreachMessages")
      .withIndex("by_externalThreadId", (q) => q.eq("externalThreadId", args.threadId))
      .take(2);
    if (threadMatches.length === 1) {
      outreach = threadMatches[0];
      lineageProof = "tier_1_thread_id";
    }
  }

  // Tier 2: Match by inReplyTo matching stored externalMessageId
  if (!outreach && args.inReplyTo) {
    const candidates = normalizeMessageCandidates(args.inReplyTo);
    for (const candidateId of candidates) {
      const replyMatches = await ctx.db
        .query("outreachMessages")
        .withIndex("by_externalMessageId", (q) => q.eq("externalMessageId", candidateId))
        .take(2);
      if (replyMatches.length === 1) {
        outreach = replyMatches[0];
        lineageProof = "tier_2_in_reply_to";
        break;
      }
    }
  }

  // Tier 3: Match by references list containing stored externalMessageId
  if (!outreach && args.references && args.references.length > 0) {
    for (let i = args.references.length - 1; i >= 0; i -= 1) {
      const candidates = normalizeMessageCandidates(args.references[i]);
      for (const candidateId of candidates) {
        const refMatches = await ctx.db
          .query("outreachMessages")
          .withIndex("by_externalMessageId", (q) => q.eq("externalMessageId", candidateId))
          .take(2);
        if (refMatches.length === 1) {
          outreach = refMatches[0];
          lineageProof = "tier_3_references";
          break;
        }
      }
      if (outreach) break;
    }
  }

  // Tier 4: Match by conversation message IDs from authenticated AgentMail conversation query
  if (!outreach && args.conversationMessageIds && args.conversationMessageIds.length > 0) {
    for (const convMsgId of args.conversationMessageIds) {
      const candidates = normalizeMessageCandidates(convMsgId);
      for (const candidateId of candidates) {
        const convMatches = await ctx.db
          .query("outreachMessages")
          .withIndex("by_externalMessageId", (q) => q.eq("externalMessageId", candidateId))
          .take(2);
        if (convMatches.length === 1) {
          outreach = convMatches[0];
          lineageProof = "tier_4_conversation_membership";
          break;
        }
      }
      if (outreach) break;
    }
  }

  if (!outreach || !lineageProof) return null;

  const job = await ctx.db.get("jobs", outreach.jobId);
  const provider = await ctx.db.get("providerCandidates", outreach.candidateId);
  if (
    !job ||
    !provider ||
    outreach.ownerId !== job.ownerId ||
    provider.ownerId !== job.ownerId ||
    provider.jobId !== job._id
  ) {
    return null;
  }
  return { outreach, job, provider, lineageProof };
}

async function hasCurrentWaitingProvider(
  ctx: MutationCtx,
  job: Doc<"jobs">,
  excludedOutreachId: Id<"outreachMessages">,
) {
  const messages = await ctx.db
    .query("outreachMessages")
    .withIndex("by_job_and_createdAt", (q) => q.eq("jobId", job._id))
    .take(20);
  for (const message of messages) {
    if (
      message._id === excludedOutreachId ||
      message.ownerId !== job.ownerId ||
      message.purpose !== "initial" ||
      message.status !== "sent" ||
      !message.externalMessageId ||
      !message.externalThreadId
    ) {
      continue;
    }
    const candidate = await ctx.db.get("providerCandidates", message.candidateId);
    if (
      candidate &&
      candidate.ownerId === job.ownerId &&
      candidate.jobId === job._id &&
      hasSourceBackedPublicBusinessEmail(candidate) &&
      isProviderRelevantToJob(candidate, job)
    ) {
      return true;
    }
  }
  return false;
}

async function getInitialOutreach(
  ctx: MutationCtx,
  outreach: Doc<"outreachMessages">,
) {
  return outreach.parentOutreachId
    ? await ctx.db.get("outreachMessages", outreach.parentOutreachId)
    : outreach;
}

async function cancelPendingRecoveryFollowUp(
  ctx: MutationCtx,
  outreach: Doc<"outreachMessages">,
  reason: string,
) {
  if (
    outreach.purpose !== "initial" ||
    !["scheduling", "scheduled", "due"].includes(outreach.followUpState ?? "")
  ) {
    return;
  }
  if (outreach.followUpScheduledFunctionId) {
    try {
      await ctx.scheduler.cancel(outreach.followUpScheduledFunctionId);
    } catch {
      // A callback may already be running; its callback-time gate remains authoritative.
    }
  }
  await ctx.db.patch("outreachMessages", outreach._id, {
    followUpState: "cancelled",
    nextFollowUpAt: undefined,
    followUpScheduledFunctionId: undefined,
    followUpFailureReason: reason,
    updatedAt: Date.now(),
  });
}

async function applyDeliveryFailure(
  ctx: MutationCtx,
  message: Doc<"inboundMessages">,
  job: Doc<"jobs">,
  provider: Doc<"providerCandidates">,
  outreach: Doc<"outreachMessages">,
) {
  const now = Date.now();
  const failureReason =
    "Delivery failed; this system message is not a provider reply and no follow-up is authorized to this address.";

  if (outreach.followUpScheduledFunctionId) {
    try {
      await ctx.scheduler.cancel(outreach.followUpScheduledFunctionId);
    } catch {
      // A callback may already be running; its callback-time gate is authoritative.
    }
  }

  await ctx.db.patch("inboundMessages", message._id, {
    processingStatus: "delivery_failed",
    responseKind: undefined,
    understandingError: failureReason,
    updatedAt: now,
  });
  await ctx.db.patch("outreachMessages", outreach._id, {
    status: "delivery_failed",
    failureReason,
    ...(outreach.purpose === "initial" &&
    ["scheduling", "scheduled", "due"].includes(outreach.followUpState ?? "")
      ? {
          followUpState: "cancelled" as const,
          nextFollowUpAt: undefined,
          followUpScheduledFunctionId: undefined,
          followUpFailureReason: failureReason,
        }
      : {}),
    updatedAt: now,
  });

  const initialOutreach = await getInitialOutreach(ctx, outreach);
  if (
    job.recoveryEnabled &&
    initialOutreach &&
    initialOutreach.ownerId === job.ownerId &&
    initialOutreach.jobId === job._id
  ) {
    if (initialOutreach.finalResponseCheckScheduledFunctionId) {
      try {
        await ctx.scheduler.cancel(initialOutreach.finalResponseCheckScheduledFunctionId);
      } catch {
        // A callback may already be running; its callback-time gate remains authoritative.
      }
    }
    await ctx.db.patch("outreachMessages", initialOutreach._id, {
      providerResolution: "delivery_failed",
      finalResponseCheckAt: undefined,
      finalResponseCheckScheduledFunctionId: undefined,
      updatedAt: now,
    });
  }

  if (
    job.ownerId !== message.ownerId ||
    provider.ownerId !== message.ownerId ||
    provider.jobId !== job._id ||
    outreach.ownerId !== message.ownerId ||
    outreach.jobId !== job._id ||
    outreach.candidateId !== provider._id
  ) {
    return;
  }

  const waitingProvider = await hasCurrentWaitingProvider(ctx, job, outreach._id);
  const recoveryCanEvaluate =
    Boolean(job.recoveryEnabled && job.autonomy?.enabled) &&
    !["paused", "cancelled", "completed", "needs_user"].includes(job.status);
  if (
    [
      "outreach_approved",
      "outreach_sent",
      "reply_received",
      "reply_understood",
    ].includes(job.status)
  ) {
    await ctx.db.patch("jobs", job._id, {
      status: recoveryCanEvaluate
        ? job.status
        : waitingProvider
          ? "outreach_sent"
          : "needs_user",
      autonomyStopReason: recoveryCanEvaluate
        ? undefined
        : waitingProvider
        ? undefined
        : "A provider delivery failed and no other current eligible provider outreach remains.",
      updatedAt: now,
    });
  }
  await ctx.db.insert("jobEvents", {
    jobId: job._id,
    ownerId: job.ownerId,
    eventType: "delivery_failed",
    message:
      "AgentMail reported a delivery failure for this outreach. No provider reply or follow-up send was recorded.",
    createdAt: now,
  });
  if (
    job.recoveryEnabled &&
    !["paused", "cancelled", "completed", "needs_user"].includes(job.status)
  ) {
    await ctx.scheduler.runAfter(0, internal.outreach.evaluateRecovery, {
      jobId: job._id,
      ownerId: job.ownerId,
    });
  }
}

export const ingestVerifiedEvent = internalMutation({
  args: parsedMessageValidator.fields,
  returns: ingestResultValidator,
  handler: async (ctx, args) => {
    const duplicateBySvix = await ctx.db
      .query("inboundMessages")
      .withIndex("by_svixId", (q) => q.eq("svixId", args.svixId))
      .take(1);
    if (duplicateBySvix[0]) {
      return {
        inboundMessageId: duplicateBySvix[0]._id,
        shouldUnderstand: false,
        duplicate: true,
        unmatched: !duplicateBySvix[0].jobId,
      };
    }

    const duplicateByMessage = await ctx.db
      .query("inboundMessages")
      .withIndex("by_externalMessageId", (q) => q.eq("externalMessageId", args.externalMessageId))
      .take(1);
    if (duplicateByMessage[0]) {
      return {
        inboundMessageId: duplicateByMessage[0]._id,
        shouldUnderstand: false,
        duplicate: true,
        unmatched: !duplicateByMessage[0].jobId,
      };
    }

    const mapping = await findMappedThread(ctx, {
      threadId: args.threadId,
      inReplyTo: args.inReplyTo,
      references: args.references,
      conversationMessageIds: args.conversationMessageIds,
    });
    const deliveryFailure = isDeliveryFailureMessage(args);
    const now = Date.now();
    const inboundMessageId = await ctx.db.insert("inboundMessages", {
      ...(mapping
        ? {
            ownerId: mapping.job.ownerId,
            jobId: mapping.job._id,
            providerId: mapping.provider._id,
            outreachId: mapping.outreach._id,
            cycleId: mapping.outreach.cycleId,
          }
        : {}),
      inboxId: args.inboxId,
      svixId: args.svixId,
      eventId: args.eventId,
      externalMessageId: args.externalMessageId,
      threadId: args.threadId,
      ...(args.inReplyTo ? { inReplyTo: args.inReplyTo } : {}),
      ...(args.references && args.references.length > 0
        ? { references: args.references }
        : {}),
      ...(args.autorespondSubject
        ? { autorespondSubject: args.autorespondSubject }
        : {}),
      ...(args.isAutoReply !== undefined ? { isAutoReply: args.isAutoReply } : {}),
      lineageProof: mapping ? mapping.lineageProof : "unproven",
      sender: args.sender,
      recipients: args.recipients,
      subject: args.subject,
      bodyText: args.bodyText,
      ...(args.bodyHtml ? { bodyHtml: args.bodyHtml } : {}),
      receivedAt: args.receivedAt,
      processingStatus: deliveryFailure
        ? "delivery_failed"
        : mapping
          ? "received"
          : "unmatched",
      createdAt: now,
      updatedAt: now,
    });

    for (const attachment of args.attachments) {
      await ctx.db.insert("inboundAttachments", {
        ...(mapping
          ? {
              ownerId: mapping.job.ownerId,
              jobId: mapping.job._id,
              providerId: mapping.provider._id,
              outreachId: mapping.outreach._id,
              cycleId: mapping.outreach.cycleId,
            }
          : {}),
        inboundMessageId,
        externalMessageId: args.externalMessageId,
        externalAttachmentId: attachment.externalAttachmentId,
        ...(attachment.filename ? { filename: attachment.filename } : {}),
        ...(attachment.contentType ? { contentType: attachment.contentType } : {}),
        ...(attachment.size !== undefined ? { size: attachment.size } : {}),
        ...(attachment.inline !== undefined ? { inline: attachment.inline } : {}),
        ...(attachment.contentDisposition
          ? { contentDisposition: attachment.contentDisposition }
          : {}),
        storageStatus: "metadata_only",
        createdAt: now,
        updatedAt: now,
      });
    }

    if (mapping && deliveryFailure) {
      const message = await ctx.db.get("inboundMessages", inboundMessageId);
      if (message) {
        await applyDeliveryFailure(
          ctx,
          message,
          mapping.job,
          mapping.provider,
          mapping.outreach,
        );
      }
    } else if (mapping) {
      if (
        mapping.job.status === "outreach_sent" ||
        mapping.job.status === "reply_received" ||
        mapping.job.status === "reply_understood"
      ) {
        await ctx.db.patch("jobs", mapping.job._id, {
          status: "reply_received",
          updatedAt: now,
        });
      }
      const initialOutreach = await getInitialOutreach(ctx, mapping.outreach);
      if (
        initialOutreach &&
        initialOutreach.ownerId === mapping.job.ownerId &&
        initialOutreach.jobId === mapping.job._id
      ) {
        await cancelPendingRecoveryFollowUp(
          ctx,
          initialOutreach,
          "A provider reply arrived; no follow-up was sent.",
        );
        if (["scheduling", "scheduled", "due"].includes(initialOutreach.followUpState ?? "")) {
          await ctx.db.patch("outreachMessages", initialOutreach._id, {
            followUpState: "skipped",
            nextFollowUpAt: undefined,
            followUpScheduledFunctionId: undefined,
            followUpFailureReason: "A provider reply arrived before the follow-up became due.",
            updatedAt: now,
          });
          await ctx.db.insert("jobEvents", {
            jobId: mapping.job._id,
            ownerId: mapping.job.ownerId,
            eventType: "follow_up_skipped",
            message: "The planned follow-up was skipped because the provider replied.",
            createdAt: now,
          });
        }
        if (mapping.job.recoveryEnabled) {
          if (initialOutreach.finalResponseCheckScheduledFunctionId) {
            try {
              await ctx.scheduler.cancel(initialOutreach.finalResponseCheckScheduledFunctionId);
            } catch {
              // A callback may already be running; the callback rechecks inbound state.
            }
          }
          await ctx.db.patch("outreachMessages", initialOutreach._id, {
            providerResolution: "replied",
            finalResponseCheckAt: undefined,
            finalResponseCheckScheduledFunctionId: undefined,
            updatedAt: now,
          });
        }
      }
      await ctx.db.insert("jobEvents", {
        jobId: mapping.job._id,
        ownerId: mapping.job.ownerId,
        eventType: "inbound_received",
        message: "A provider reply was received and mapped to this job by verified thread lineage.",
        createdAt: now,
      });
    }

    return {
      inboundMessageId,
      shouldUnderstand: Boolean(mapping) && !deliveryFailure,
      duplicate: false,
      unmatched: !mapping,
    };
  },
});

export const getInboundMessageForAction = internalQuery({
  args: { inboundMessageId: v.id("inboundMessages") },
  returns: v.union(v.null(), inboundMessageValidator),
  handler: async (ctx, args) => {
    return await ctx.db.get("inboundMessages", args.inboundMessageId);
  },
});

export const recorrelateQuarantinedInbound = internalMutation({
  args: {
    inboundMessageId: v.id("inboundMessages"),
    inReplyTo: v.optional(v.string()),
    references: v.optional(v.array(v.string())),
    conversationMessageIds: v.optional(v.array(v.string())),
  },
  returns: v.object({
    matched: v.boolean(),
    jobId: v.optional(v.id("jobs")),
    providerId: v.optional(v.id("providerCandidates")),
    outreachId: v.optional(v.id("outreachMessages")),
    lineageProof: v.optional(
      v.union(
        v.literal("tier_1_thread_id"),
        v.literal("tier_2_in_reply_to"),
        v.literal("tier_3_references"),
        v.literal("tier_4_conversation_membership"),
        v.literal("unproven"),
      ),
    ),
  }),
  handler: async (ctx, args) => {
    const message = await ctx.db.get("inboundMessages", args.inboundMessageId);
    if (!message) return { matched: false };
    if (message.jobId && message.processingStatus !== "unmatched") {
      return {
        matched: true,
        jobId: message.jobId,
        providerId: message.providerId,
        outreachId: message.outreachId,
        lineageProof: message.lineageProof,
      };
    }

    const inReplyTo = args.inReplyTo ?? message.inReplyTo;
    const references = args.references ?? message.references;
    const mapping = await findMappedThread(ctx, {
      threadId: message.threadId,
      inReplyTo,
      references,
      conversationMessageIds: args.conversationMessageIds,
    });

    if (!mapping) return { matched: false };

    const now = Date.now();
    await ctx.db.patch("inboundMessages", message._id, {
      ownerId: mapping.job.ownerId,
      jobId: mapping.job._id,
      providerId: mapping.provider._id,
      outreachId: mapping.outreach._id,
      ...(mapping.outreach.cycleId ? { cycleId: mapping.outreach.cycleId } : {}),
      ...(inReplyTo ? { inReplyTo } : {}),
      ...(references && references.length > 0 ? { references } : {}),
      lineageProof: mapping.lineageProof,
      processingStatus: "received",
      updatedAt: now,
    });

    if (
      mapping.job.status === "outreach_sent" ||
      mapping.job.status === "reply_received" ||
      mapping.job.status === "reply_understood"
    ) {
      await ctx.db.patch("jobs", mapping.job._id, {
        status: "reply_received",
        updatedAt: now,
      });
    }

    const initialOutreach = await getInitialOutreach(ctx, mapping.outreach);
    if (
      initialOutreach &&
      initialOutreach.ownerId === mapping.job.ownerId &&
      initialOutreach.jobId === mapping.job._id
    ) {
      await cancelPendingRecoveryFollowUp(
        ctx,
        initialOutreach,
        "A provider reply arrived; no follow-up was sent.",
      );
      if (["scheduling", "scheduled", "due"].includes(initialOutreach.followUpState ?? "")) {
        await ctx.db.patch("outreachMessages", initialOutreach._id, {
          followUpState: "skipped",
          nextFollowUpAt: undefined,
          followUpScheduledFunctionId: undefined,
          followUpFailureReason: "A provider reply arrived before the follow-up became due.",
          updatedAt: now,
        });
        await ctx.db.insert("jobEvents", {
          jobId: mapping.job._id,
          ownerId: mapping.job.ownerId,
          eventType: "follow_up_skipped",
          message: "The planned follow-up was skipped because the provider replied.",
          createdAt: now,
        });
      }
      if (mapping.job.recoveryEnabled) {
        if (initialOutreach.finalResponseCheckScheduledFunctionId) {
          try {
            await ctx.scheduler.cancel(initialOutreach.finalResponseCheckScheduledFunctionId);
          } catch {
            // A callback may already be running
          }
        }
        await ctx.db.patch("outreachMessages", initialOutreach._id, {
          providerResolution: "replied",
          finalResponseCheckAt: undefined,
          finalResponseCheckScheduledFunctionId: undefined,
          updatedAt: now,
        });
      }
    }

    await ctx.db.insert("jobEvents", {
      jobId: mapping.job._id,
      ownerId: mapping.job.ownerId,
      eventType: "inbound_received",
      message: "A provider reply was received and mapped to this job by verified thread lineage.",
      createdAt: now,
    });

    await ctx.scheduler.runAfter(0, internal.inbound.processUnderstanding, {
      inboundMessageId: message._id,
    });

    return {
      matched: true,
      jobId: mapping.job._id,
      providerId: mapping.provider._id,
      outreachId: mapping.outreach._id,
      lineageProof: mapping.lineageProof,
    };
  },
});

export const recorrelateQuarantinedInboundAction = internalAction({
  args: { inboundMessageId: v.id("inboundMessages") },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const message: Doc<"inboundMessages"> | null = await ctx.runQuery(
      internal.inbound.getInboundMessageForAction,
      { inboundMessageId: args.inboundMessageId },
    );
    if (!message) return false;

    let inReplyTo = message.inReplyTo;
    let references = message.references;
    const conversationMessageIds: string[] = [];

    const apiKey = env.AGENTMAIL_API_KEY;
    const inboxId = message.inboxId || env.AGENTMAIL_INBOX_ID;
    if (apiKey && inboxId && (!inReplyTo || !references || references.length === 0)) {
      const candidatesToTry: string[] = [];
      if (message.externalMessageId) {
        candidatesToTry.push(message.externalMessageId);
        const stripped = message.externalMessageId.replace(/^<|>$/g, "").trim();
        if (stripped && stripped !== message.externalMessageId) {
          candidatesToTry.push(stripped);
        }
      }

      for (const msgId of candidatesToTry) {
        if (inReplyTo && references && references.length > 0) break;
        try {
          const response = await fetch(
            "https://api.agentmail.to/v0/inboxes/" +
              encodeURIComponent(inboxId) +
              "/messages/" +
              encodeURIComponent(msgId),
            {
              headers: { Authorization: "Bearer " + apiKey },
            },
          );
          if (response.ok) {
            const payload: unknown = await response.json();
            if (isRecord(payload)) {
              const msgObj = isRecord(payload.message) ? payload.message : payload;
              const extInReplyTo = parseInReplyTo(msgObj);
              const extReferences = parseReferences(msgObj);
              if (extInReplyTo && !inReplyTo) inReplyTo = extInReplyTo;
              if (extReferences && extReferences.length > 0 && (!references || references.length === 0)) {
                references = extReferences;
              }
            }
          }
        } catch {
          // Fall back
        }
      }

      if (message.threadId) {
        try {
          const threadResponse = await fetch(
            "https://api.agentmail.to/v0/inboxes/" +
              encodeURIComponent(inboxId) +
              "/threads/" +
              encodeURIComponent(message.threadId),
            {
              headers: { Authorization: "Bearer " + apiKey },
            },
          );
          if (threadResponse.ok) {
            const threadPayload: unknown = await threadResponse.json();
            if (isRecord(threadPayload) && Array.isArray(threadPayload.messages)) {
              for (const m of threadPayload.messages) {
                if (isRecord(m)) {
                  if (typeof m.message_id === "string" && m.message_id) {
                    conversationMessageIds.push(m.message_id);
                  }
                  if (typeof m.id === "string" && m.id) {
                    conversationMessageIds.push(m.id);
                  }
                  const extInReplyTo = parseInReplyTo(m);
                  const extReferences = parseReferences(m);
                  if (extInReplyTo && !inReplyTo) inReplyTo = extInReplyTo;
                  if (extReferences && extReferences.length > 0 && (!references || references.length === 0)) {
                    references = extReferences;
                  }
                }
              }
            }
          }
        } catch {
          // Fall back
        }
      }
    }

    const result: {
      matched: boolean;
      jobId?: Id<"jobs">;
      providerId?: Id<"providerCandidates">;
      outreachId?: Id<"outreachMessages">;
      lineageProof?: Doc<"inboundMessages">["lineageProof"];
    } = await ctx.runMutation(
      internal.inbound.recorrelateQuarantinedInbound,
      {
        inboundMessageId: args.inboundMessageId,
        inReplyTo,
        references,
        conversationMessageIds: conversationMessageIds.length > 0 ? conversationMessageIds : undefined,
      },
    );

    if (result.matched) {
      await ctx.runAction(internal.inbound.processUnderstanding, {
        inboundMessageId: args.inboundMessageId,
      });
    }

    return result.matched;
  },
});


export const hardenInboundLineage = internalMutation({
  args: {
    inboundMessageId: v.id("inboundMessages"),
    processingStatus: processingStatusValidator,
    lineageProof: v.union(
      v.literal("tier_1_thread_id"),
      v.literal("tier_2_in_reply_to"),
      v.literal("tier_3_references"),
      v.literal("tier_4_conversation_membership"),
      v.literal("unproven"),
    ),
    isAutoReply: v.optional(v.boolean()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.patch("inboundMessages", args.inboundMessageId, {
      processingStatus: args.processingStatus,
      lineageProof: args.lineageProof,
      ...(args.isAutoReply !== undefined ? { isAutoReply: args.isAutoReply } : {}),
      updatedAt: Date.now(),
    });
    return null;
  },
});

export const reclassifyDeliveryFailure = internalMutation({
  args: { inboundMessageId: v.id("inboundMessages") },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const message = await ctx.db.get("inboundMessages", args.inboundMessageId);
    if (
      !message ||
      !message.ownerId ||
      !message.jobId ||
      !message.providerId ||
      !message.outreachId ||
      !isDeliveryFailureMessage(message)
    ) {
      return false;
    }
    const job = await ctx.db.get("jobs", message.jobId);
    const provider = await ctx.db.get("providerCandidates", message.providerId);
    const outreach = await ctx.db.get("outreachMessages", message.outreachId);
    if (!job || !provider || !outreach) return false;
    await applyDeliveryFailure(ctx, message, job, provider, outreach);
    return true;
  },
});

export const listForJob = query({
  args: { jobId: v.id("jobs") },
  returns: v.array(conversationItemValidator),
  handler: async (ctx, args) => {
    const ownerId = await requireUserId(ctx);
    const job = await ctx.db.get("jobs", args.jobId);
    if (!job || job.ownerId !== ownerId) return [];

    const messages = await ctx.db
      .query("inboundMessages")
      .withIndex("by_jobId_and_createdAt", (q) => q.eq("jobId", args.jobId))
      .order("desc")
      .take(20);

    const items = [];
    for (const message of messages) {
      const attachments = await ctx.db
        .query("inboundAttachments")
        .withIndex("by_inboundMessageId_and_createdAt", (q) =>
          q.eq("inboundMessageId", message._id),
        )
        .order("asc")
        .take(20);
      const responses = await ctx.db
        .query("providerResponses")
        .withIndex("by_inboundMessageId", (q) => q.eq("inboundMessageId", message._id))
        .take(1);
      items.push({
        message,
        attachments,
        response: responses[0] ?? null,
      });
    }
    return items;
  },
});

export const listComparisons = query({
  args: { jobId: v.id("jobs") },
  returns: v.array(comparisonValidator),
  handler: async (ctx, args) => {
    const ownerId = await requireUserId(ctx);
    const job = await ctx.db.get("jobs", args.jobId);
    if (!job || job.ownerId !== ownerId) return [];

    const responses = await ctx.db
      .query("providerResponses")
      .withIndex("by_jobId_and_createdAt", (q) => q.eq("jobId", args.jobId))
      .order("desc")
      .take(20);

    const comparisons = [];
    for (const response of responses) {
      const provider = await ctx.db.get("providerCandidates", response.providerId);
      if (provider && provider.ownerId === ownerId && provider.jobId === args.jobId) {
        comparisons.push({
          response,
          providerName: provider.name,
          providerUrl: provider.url,
        });
      }
    }
    return comparisons;
  },
});

export const listClarifications = query({
  args: { jobId: v.id("jobs") },
  returns: v.array(clarificationValidator),
  handler: async (ctx, args) => {
    const ownerId = await requireUserId(ctx);
    const job = await ctx.db.get("jobs", args.jobId);
    if (!job || job.ownerId !== ownerId) return [];
    return await ctx.db
      .query("clarificationDrafts")
      .withIndex("by_jobId_and_createdAt", (q) => q.eq("jobId", args.jobId))
      .order("desc")
      .take(20);
  },
});

type ResponseDoc = Doc<"providerResponses">;

function normalizedAttribute(value: string) {
  return value.trim().toLowerCase();
}

function makeGap(responses: ResponseDoc[]) {
  for (const includedResponse of responses) {
    for (const included of includedResponse.included) {
      const includedKey = normalizedAttribute(included);
      if (!includedKey) continue;
      for (const comparisonResponse of responses) {
        if (comparisonResponse._id === includedResponse._id) continue;
        const hasNotStated = comparisonResponse.notStated.some(
          (item) => normalizedAttribute(item) === includedKey,
        );
        const hasUnclear = comparisonResponse.unclear.some(
          (item) => normalizedAttribute(item) === includedKey,
        );
        if (hasNotStated || hasUnclear) {
          const reason = hasUnclear
            ? "One provider included " + included + " while another provider marked it unclear."
            : "One provider included " + included + " while another provider did not state it.";
          return {
            attribute: included,
            reason,
            proposedMessage: "Could you confirm whether " + included + " is included in your estimate?",
            sourceResponseId: includedResponse._id,
            comparisonResponseId: comparisonResponse._id,
          };
        }
      }
    }
  }
  return null;
}

export const getClarificationSuggestions = query({
  args: { jobId: v.id("jobs") },
  returns: v.array(clarificationSuggestionValidator),
  handler: async (ctx, args) => {
    const ownerId = await requireUserId(ctx);
    const job = await ctx.db.get("jobs", args.jobId);
    if (!job || job.ownerId !== ownerId) return [];

    const responses = await ctx.db
      .query("providerResponses")
      .withIndex("by_jobId_and_createdAt", (q) => q.eq("jobId", args.jobId))
      .order("desc")
      .take(20);
    const suggestions = [];
    const seen = new Set<string>();
    for (const includedResponse of responses) {
      for (const included of includedResponse.included) {
        const includedKey = normalizedAttribute(included);
        for (const comparisonResponse of responses) {
          if (comparisonResponse._id === includedResponse._id) continue;
          const hasNotStated = comparisonResponse.notStated.some(
            (item) => normalizedAttribute(item) === includedKey,
          );
          const hasUnclear = comparisonResponse.unclear.some(
            (item) => normalizedAttribute(item) === includedKey,
          );
          if (!hasNotStated && !hasUnclear) continue;
          const key = includedKey + ":" + includedResponse._id + ":" + comparisonResponse._id;
          if (seen.has(key)) continue;
          seen.add(key);
          suggestions.push({
            attribute: included,
            reason: hasUnclear
              ? "One provider included " + included + " while another provider marked it unclear."
              : "One provider included " + included + " while another provider did not state it.",
            proposedMessage: "Could you confirm whether " + included + " is included in your estimate?",
            sourceResponseId: includedResponse._id,
            comparisonResponseId: comparisonResponse._id,
          });
        }
      }
    }
    return suggestions.slice(0, 10);
  },
});

export const prepareClarification = mutation({
  args: { jobId: v.id("jobs"), attribute: v.string() },
  returns: v.id("clarificationDrafts"),
  handler: async (ctx, args) => {
    const ownerId = await requireUserId(ctx);
    const job = await ctx.db.get("jobs", args.jobId);
    if (!job || job.ownerId !== ownerId) throw new Error("Job not found.");

    const existing = await ctx.db
      .query("clarificationDrafts")
      .withIndex("by_jobId_and_attribute", (q) =>
        q.eq("jobId", args.jobId).eq("attribute", args.attribute),
      )
      .take(1);
    if (existing[0]) return existing[0]._id;

    const responses = await ctx.db
      .query("providerResponses")
      .withIndex("by_jobId_and_createdAt", (q) => q.eq("jobId", args.jobId))
      .order("desc")
      .take(20);
    const gap = makeGap(responses.filter((response) => response.ownerId === ownerId));
    if (!gap || normalizedAttribute(gap.attribute) !== normalizedAttribute(args.attribute)) {
      throw new Error("No material comparison gap is currently available for that clarification.");
    }

    const now = Date.now();
    return await ctx.db.insert("clarificationDrafts", {
      ownerId,
      jobId: args.jobId,
      attribute: gap.attribute,
      reason: gap.reason,
      proposedMessage: gap.proposedMessage,
      sourceResponseId: gap.sourceResponseId,
      comparisonResponseId: gap.comparisonResponseId,
      status: "suggested",
      createdAt: now,
      updatedAt: now,
    });
  },
});
const autonomousClarificationValidator = v.union(
  v.null(),
  v.object({
    clarificationId: v.id("clarificationDrafts"),
    outreachId: v.id("outreachMessages"),
    ownerId: v.id("users"),
  }),
);

export const createAutonomousClarification = internalMutation({
  args: { responseId: v.id("providerResponses") },
  returns: autonomousClarificationValidator,
  handler: async (ctx, args) => {
    const response = await ctx.db.get("providerResponses", args.responseId);
    if (!response) return null;
    const job = await ctx.db.get("jobs", response.jobId);
    if (
      !job ||
      job.ownerId !== response.ownerId ||
      !job.autonomy?.enabled ||
      !job.autonomy.allowRoutineClarifications ||
      job.continuationMode === "user_takeover" ||
      !["outreach_sent", "reply_received", "reply_understood"].includes(job.status) ||
      job.status === "paused" ||
      job.status === "cancelled" ||
      job.status === "completed" ||
      job.status === "needs_user"
    ) {
      return null;
    }

    const responses = await ctx.db
      .query("providerResponses")
      .withIndex("by_jobId_and_createdAt", (q) => q.eq("jobId", job._id))
      .order("desc")
      .take(20);
    const gap = makeGap(responses.filter((item) => item.ownerId === response.ownerId));
    if (!gap) return null;
    if (classifyAutonomyQuestion(gap.attribute) !== "routine") {
      const reason = autonomyStopReason(gap.attribute);
      const now = Date.now();
      await ctx.db.patch("jobs", job._id, {
        status: "needs_user",
        autonomyStopReason: reason,
        updatedAt: now,
      });
      await ctx.db.insert("jobEvents", {
        jobId: job._id,
        ownerId: job.ownerId,
        eventType: "autonomous_action_blocked",
        message: reason,
        createdAt: now,
      });
      return null;
    }

    const existing = await ctx.db
      .query("clarificationDrafts")
      .withIndex("by_jobId_and_attribute", (q) =>
        q.eq("jobId", job._id).eq("attribute", gap.attribute),
      )
      .take(1);
    if (existing[0]) return null;

    const targetResponse = await ctx.db.get("providerResponses", gap.comparisonResponseId);
    const targetOutreach = targetResponse
      ? await ctx.db.get("outreachMessages", targetResponse.outreachId)
      : null;
    const targetProvider = targetOutreach
      ? await ctx.db.get("providerCandidates", targetOutreach.candidateId)
      : null;
    if (
      !targetResponse ||
      !targetOutreach ||
      !targetProvider ||
      targetResponse.ownerId !== job.ownerId ||
      targetOutreach.ownerId !== job.ownerId ||
      targetProvider.ownerId !== job.ownerId ||
      targetOutreach.status !== "sent" ||
      !targetOutreach.externalThreadId ||
      (Boolean(job.selectedCandidateId) && targetOutreach.candidateId !== job.selectedCandidateId)
    ) {
      return null;
    }

    const now = Date.now();
    const clarificationId = await ctx.db.insert("clarificationDrafts", {
      ownerId: job.ownerId,
      jobId: job._id,
      attribute: gap.attribute,
      reason: gap.reason,
      proposedMessage: gap.proposedMessage,
      sourceResponseId: gap.sourceResponseId,
      comparisonResponseId: gap.comparisonResponseId,
      status: "approved",
      createdAt: now,
      updatedAt: now,
    });
    const subject = targetOutreach.subject.toLowerCase().startsWith("re:")
      ? targetOutreach.subject
      : "Re: " + targetOutreach.subject;
    const body = [
      "Hello,",
      "",
      "Could you confirm whether " + gap.attribute + " is included in your estimate?",
      "",
      "This is a routine clarification within the approved Findor mandate. It does not authorize work, a quote acceptance, booking, payment, or a contract.",
      "",
      "Thank you,",
      "Sent at the customer's request via Findor",
    ].join("\n");
    const outreachId = await ctx.db.insert("outreachMessages", {
      jobId: job._id,
      ownerId: job.ownerId,
      candidateId: targetOutreach.candidateId,
      status: "approved",
      purpose: "routine_clarification",
      clarificationId,
      providerEmail: targetOutreach.providerEmail,
      subject,
      body,
      sendAttemptCount: 0,
      createdAt: now,
      updatedAt: now,
    });
    return { clarificationId, outreachId, ownerId: job.ownerId };
  },
});

export const maybeStartAutonomousClarification = internalAction({
  args: { responseId: v.id("providerResponses") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const created = await ctx.runMutation(
      internal.inbound.createAutonomousClarification,
      { responseId: args.responseId },
    );
    if (!created) return null;
    await ctx.runAction(internal.outreach.sendRoutineClarification, {
      clarificationId: created.clarificationId,
      ownerId: created.ownerId,
    });
    return null;
  },
});
function modelSafeLocation(job: Doc<"jobs">) {
  return formatExternalServiceArea(job.structuredLocation, job.serviceLocation);
}

export const getUnderstandingInput = internalQuery({
  args: { inboundMessageId: v.id("inboundMessages") },
  returns: v.union(v.null(), understandingInputValidator),
  handler: async (ctx, args) => {
    const message = await ctx.db.get("inboundMessages", args.inboundMessageId);
    if (
      !message ||
      !message.ownerId ||
      !message.jobId ||
      !message.providerId ||
      !message.outreachId ||
      message.processingStatus === "unmatched"
    ) {
      return null;
    }

    const job = await ctx.db.get("jobs", message.jobId);
    const provider = await ctx.db.get("providerCandidates", message.providerId);
    const outreach = await ctx.db.get("outreachMessages", message.outreachId);
    if (
      !job ||
      !provider ||
      !outreach ||
      job.ownerId !== message.ownerId ||
      provider.ownerId !== message.ownerId ||
      provider.jobId !== job._id ||
      outreach.ownerId !== message.ownerId ||
      outreach.jobId !== job._id ||
      outreach.candidateId !== provider._id
    ) {
      return null;
    }

    const attachments = await ctx.db
      .query("inboundAttachments")
      .withIndex("by_inboundMessageId_and_createdAt", (q) =>
        q.eq("inboundMessageId", message._id),
      )
      .order("asc")
      .take(20);

    return {
      inboundMessageId: message._id,
      serviceCategory: job.serviceCategory,
      serviceLocation: modelSafeLocation(job),
      requestedOutcome: job.brief?.requestedOutcome ?? job.naturalLanguageDescription,
      desiredTiming: job.desiredTiming,
      serviceContext: job.brief?.budgetOrContext ?? job.budgetOrContext,
      providerName: provider.name,
      sender: message.sender,
      subject: message.subject,
      bodyText: message.bodyText,
      attachments: attachments.map((attachment) => ({
        ...(attachment.filename ? { filename: attachment.filename } : {}),
        ...(attachment.contentType ? { contentType: attachment.contentType } : {}),
        ...(attachment.size !== undefined ? { size: attachment.size } : {}),
      })),
    };
  },
});
export const markUnderstandingStarted = internalMutation({
  args: { inboundMessageId: v.id("inboundMessages") },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const message = await ctx.db.get("inboundMessages", args.inboundMessageId);
    if (
      !message ||
      !message.jobId ||
      message.processingStatus !== "received"
    ) {
      return false;
    }
    await ctx.db.patch("inboundMessages", args.inboundMessageId, {
      processingStatus: "understanding",
      understandingError: undefined,
      updatedAt: Date.now(),
    });
    return true;
  },
});

export const markUnderstandingUnavailable = internalMutation({
  args: { inboundMessageId: v.id("inboundMessages"), reason: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const message = await ctx.db.get("inboundMessages", args.inboundMessageId);
    if (!message || !message.jobId || !message.ownerId) return null;
    await ctx.db.patch("inboundMessages", args.inboundMessageId, {
      processingStatus: "needs_review",
      understandingError: args.reason,
      updatedAt: Date.now(),
    });
    return null;
  },
});

function normalizedEvidence(value: string) {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function humanStopReason(response: {
  requestedSensitiveInformation: string[];
  requestedCommitments: string[];
  informationNeeded: string[];
}) {
  const sensitive = [
    ...response.requestedSensitiveInformation,
    ...response.requestedCommitments,
  ].filter((item) => item.trim());
  if (sensitive.length > 0) {
    return "Findor stopped before any automated action because the provider requested information or a commitment that needs your decision.";
  }
  for (const question of response.informationNeeded) {
    if (classifyAutonomyQuestion(question) === "needs_user") {
      return autonomyStopReason(question);
    }
  }
  return null;
}

function hasGroundedEvidence(
  response: { evidence: Array<{ excerpt: string }> },
  sourceText: string,
) {
  const source = normalizedEvidence(sourceText);
  return response.evidence.some((item) => {
    const excerpt = normalizedEvidence(item.excerpt);
    return excerpt.length > 0 && source.includes(excerpt);
  });
}

export const persistUnderstanding = internalMutation({
  args: {
    inboundMessageId: v.id("inboundMessages"),
    model: v.string(),
    response: structuredUnderstandingValidator,
  },
  returns: v.id("providerResponses"),
  handler: async (ctx, args) => {
    const message = await ctx.db.get("inboundMessages", args.inboundMessageId);
    if (
      !message ||
      !message.ownerId ||
      !message.jobId ||
      !message.providerId ||
      !message.outreachId
    ) {
      throw new Error("Inbound message is not safely mapped to a Findor job.");
    }

    const job = await ctx.db.get("jobs", message.jobId);
    const provider = await ctx.db.get("providerCandidates", message.providerId);
    const outreach = await ctx.db.get("outreachMessages", message.outreachId);
    if (
      !job ||
      !provider ||
      !outreach ||
      job.ownerId !== message.ownerId ||
      provider.ownerId !== message.ownerId ||
      provider.jobId !== job._id ||
      outreach.ownerId !== message.ownerId ||
      outreach.jobId !== job._id ||
      outreach.candidateId !== provider._id
    ) {
      throw new Error("Inbound message ownership could not be verified.");
    }
    const initialOutreach = await getInitialOutreach(ctx, outreach);
    if (!hasGroundedEvidence(args.response, message.bodyText)) {
      throw new Error("Model evidence was not grounded in the original provider message.");
    }

    const existing = await ctx.db
      .query("providerResponses")
      .withIndex("by_inboundMessageId", (q) => q.eq("inboundMessageId", message._id))
      .take(1);
    const now = Date.now();
    const responseCycleId = message.cycleId ?? outreach.cycleId;
    let responseBriefVersion: number | undefined = undefined;
    if (responseCycleId) {
      const responseCycle = await ctx.db.get("jobCycles", responseCycleId);
      if (responseCycle) responseBriefVersion = responseCycle.briefVersion;
    }
    const responseData = {
      ownerId: message.ownerId,
      jobId: message.jobId,
      providerId: message.providerId,
      outreachId: message.outreachId,
      inboundMessageId: message._id,
      ...(responseCycleId ? { cycleId: responseCycleId } : {}),
      ...(responseBriefVersion !== undefined
        ? { briefVersion: responseBriefVersion }
        : {}),
      kind: args.response.kind,
      ...(args.response.headlinePrice !== null
        ? { headlinePrice: args.response.headlinePrice }
        : {}),
      ...(args.response.priceQualifier !== null
        ? { priceQualifier: args.response.priceQualifier }
        : {}),
      ...(args.response.priceMin !== null ? { priceMin: args.response.priceMin } : {}),
      ...(args.response.priceMax !== null ? { priceMax: args.response.priceMax } : {}),
      ...(args.response.currency !== null ? { currency: args.response.currency } : {}),
      ...(args.response.availability !== null ? { availability: args.response.availability } : {}),
      ...(args.response.estimatedTiming !== null
        ? { estimatedTiming: args.response.estimatedTiming }
        : {}),
      included: args.response.included,
      excluded: args.response.excluded,
      notStated: args.response.notStated,
      unclear: args.response.unclear,
      ...(args.response.paymentTerms !== null
        ? { paymentTerms: args.response.paymentTerms }
        : {}),
      ...(args.response.warranty !== null ? { warranty: args.response.warranty } : {}),
      assumptions: args.response.assumptions,
      informationNeeded: args.response.informationNeeded,
      ...(args.response.inspectionRequirement !== null
        ? { inspectionRequirement: args.response.inspectionRequirement }
        : {}),
      importantNotes: args.response.importantNotes,
      evidenceText: args.response.evidenceText,
      summary: args.response.summary,
      confidence: args.response.confidence,
      requestedSensitiveInformation: args.response.requestedSensitiveInformation,
      requestedCommitments: args.response.requestedCommitments,
      evidence: args.response.evidence,
      model: args.model,
      createdAt: existing[0]?.createdAt ?? now,
      updatedAt: now,
    };

    let responseId: Id<"providerResponses">;
    if (existing[0]) {
      await ctx.db.replace("providerResponses", existing[0]._id, responseData);
      responseId = existing[0]._id;
    } else {
      responseId = await ctx.db.insert("providerResponses", responseData);
      await ctx.db.insert("jobEvents", {
        jobId: message.jobId,
        ownerId: message.ownerId,
        ...(responseCycleId ? { cycleId: responseCycleId } : {}),
        eventType: "inbound_understood",
        message: "Findor produced a structured, source-linked understanding of the provider reply.",
        createdAt: now,
      });
    }

    // Continuous recovery: a newly usable same-brief quote may complete the
    // target immediately. Late replies from superseded briefs stay in history
    // but never count. Never schedules anything here — only stops.
    if (job.autonomy?.enabled && job.autonomy.continuousRecoveryEnabled) {
      const usable = await countUsableSameBriefQuotes(ctx, job);
      const target = normalizeQuoteTarget(job.autonomy.quoteTarget);
      if (usable.count >= target) {
        await ctx.db.patch("jobs", job._id, {
          autonomy: { ...job.autonomy, continuousRecoveryEnabled: false },
          nextRecoveryAt: undefined,
          recoverySchedulerId: undefined,
          recoveryGeneration: (job.recoveryGeneration ?? 0) + 1,
          updatedAt: now,
        });
        if (job.recoverySchedulerId) {
          try {
            await ctx.scheduler.cancel(job.recoverySchedulerId);
          } catch {
            // A callback may already be running; it rechecks durable state.
          }
        }
        await ctx.db.insert("jobEvents", {
          jobId: job._id,
          ownerId: job.ownerId,
          eventType: "recovery_target_reached",
          message:
            "Quote target reached: " + usable.count + " usable quotes ready to compare.",
          createdAt: now,
        });
      }
    }

    if (
      responseCycleId &&
      (args.response.kind === "quote" || args.response.kind === "availability")
    ) {
      const cycle = await ctx.db.get("jobCycles", responseCycleId);
      if (cycle && cycle.status !== "options_ready") {
        await ctx.db.patch("jobCycles", responseCycleId, {
          status: "options_ready",
          outcomeSummary: "Option ready",
          endedAt: now,
          updatedAt: now,
        });
        await ctx.db.insert("jobEvents", {
          jobId: message.jobId,
          ownerId: message.ownerId,
          cycleId: responseCycleId,
          eventType: "cycle_options_ready",
          message: "Cycle options are ready for review.",
          createdAt: now,
        });
      }
    }

    const stopReason = humanStopReason(args.response);
    await ctx.db.patch("inboundMessages", message._id, {
      processingStatus: "understood",
      responseKind: args.response.kind,
      understandingError: undefined,
      updatedAt: now,
    });

    if (
      job.recoveryEnabled &&
      initialOutreach &&
      initialOutreach.ownerId === job.ownerId &&
      initialOutreach.jobId === job._id
    ) {
      await cancelPendingRecoveryFollowUp(
        ctx,
        initialOutreach,
        "A provider reply arrived; no follow-up was sent.",
      );
      if (initialOutreach.finalResponseCheckScheduledFunctionId) {
        try {
          await ctx.scheduler.cancel(initialOutreach.finalResponseCheckScheduledFunctionId);
        } catch {
          // A callback may already be running; the callback rechecks the durable message.
        }
      }
      await ctx.db.patch("outreachMessages", initialOutreach._id, {
        providerResolution:
          args.response.kind === "decline" ? "declined" : "replied",
        finalResponseCheckAt: undefined,
        finalResponseCheckScheduledFunctionId: undefined,
        updatedAt: now,
      });
    }

    if (job.autonomy?.enabled && stopReason) {
      if (job.status !== "needs_user") {
        await ctx.db.insert("jobEvents", {
          jobId: job._id,
          ownerId: job.ownerId,
          eventType: "autonomous_action_blocked",
          message: "Findor stopped because the provider reply requires a human decision.",
          createdAt: now,
        });
      }
      await ctx.db.patch("jobs", job._id, {
        status: "needs_user",
        autonomyStopReason: stopReason,
        updatedAt: now,
      });
    } else if (!stopReason && job.status === "reply_received") {
      await ctx.db.patch("jobs", job._id, {
        status: "reply_understood",
        updatedAt: now,
      });
    }

    if (
      !existing[0] &&
      args.response.kind === "decline" &&
      !stopReason &&
      job.recoveryEnabled &&
      job.autonomy?.enabled &&
      initialOutreach &&
      initialOutreach.ownerId === job.ownerId &&
      initialOutreach.jobId === job._id &&
      !["paused", "cancelled", "completed", "needs_user"].includes(job.status)
    ) {
      await ctx.scheduler.runAfter(0, internal.outreach.evaluateRecovery, {
        jobId: job._id,
        ownerId: job.ownerId,
      });
    }

    if (
      !existing[0] &&
      !stopReason &&
      job.autonomy?.enabled &&
      job.autonomy.allowRoutineClarifications
    ) {
      await ctx.scheduler.runAfter(0, internal.inbound.maybeStartAutonomousClarification, {
        responseId,
      });
    }
    return responseId;
  },
});
export const markUnderstandingFailed = internalMutation({
  args: { inboundMessageId: v.id("inboundMessages"), reason: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const message = await ctx.db.get("inboundMessages", args.inboundMessageId);
    if (!message || !message.jobId || !message.ownerId) return null;
    await ctx.db.patch("inboundMessages", args.inboundMessageId, {
      processingStatus: "needs_review",
      understandingError: args.reason,
      updatedAt: Date.now(),
    });
    await ctx.db.insert("jobEvents", {
      jobId: message.jobId,
      ownerId: message.ownerId,
      eventType: "inbound_processing_failed",
      message: "Findor could not structure this provider reply; the original message remains available for review.",
      createdAt: Date.now(),
    });
    return null;
  },
});

export const processUnderstanding = internalAction({
  args: { inboundMessageId: v.id("inboundMessages") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const started = await ctx.runMutation(internal.inbound.markUnderstandingStarted, {
      inboundMessageId: args.inboundMessageId,
    });
    if (!started) return null;

    const input = await ctx.runQuery(internal.inbound.getUnderstandingInput, {
      inboundMessageId: args.inboundMessageId,
    });
    if (!input) {
      await ctx.runMutation(internal.inbound.markUnderstandingFailed, {
        inboundMessageId: args.inboundMessageId,
        reason: "Findor could not verify the provider thread ownership for interpretation.",
      });
      return null;
    }

    try {
      const result = await ctx.runAction(internal.openaiProviderReply.interpret, {
        input: {
          serviceCategory: input.serviceCategory,
          serviceLocation: input.serviceLocation,
          requestedOutcome: input.requestedOutcome,
          desiredTiming: input.desiredTiming,
          serviceContext: input.serviceContext,
          providerName: input.providerName,
          sender: input.sender,
          subject: input.subject,
          bodyText: input.bodyText,
          attachments: input.attachments,
        },
      });
      if (result.status === "unavailable") {
        await ctx.runMutation(internal.inbound.markUnderstandingUnavailable, {
          inboundMessageId: args.inboundMessageId,
          reason: "Structured understanding is waiting for a configured interpretation provider.",
        });
      } else if (result.status !== "ok" || !result.model || !result.response) {
        await ctx.runMutation(internal.inbound.markUnderstandingFailed, {
          inboundMessageId: args.inboundMessageId,
          reason: "Findor could not complete structured understanding. The original message remains available for review.",
        });
      } else {
        await ctx.runMutation(internal.inbound.persistUnderstanding, {
          inboundMessageId: args.inboundMessageId,
          model: result.model,
          response: result.response,
        });
      }
    } catch {
      await ctx.runMutation(internal.inbound.markUnderstandingFailed, {
        inboundMessageId: args.inboundMessageId,
        reason: "Findor could not complete structured understanding. The original message remains available for review.",
      });
    }
    return null;
  },
});
export const getAttachmentForAction = internalQuery({
  args: { attachmentId: v.id("inboundAttachments"), ownerId: v.id("users") },
  returns: v.union(
    v.null(),
    v.object({
      inboundMessageId: v.id("inboundMessages"),
      externalMessageId: v.string(),
      externalAttachmentId: v.string(),
      filename: v.optional(v.string()),
      storageId: v.optional(v.id("_storage")),
    }),
  ),
  handler: async (ctx, args) => {
    const attachment = await ctx.db.get("inboundAttachments", args.attachmentId);
    if (!attachment || attachment.ownerId !== args.ownerId) return null;
    const message = await ctx.db.get("inboundMessages", attachment.inboundMessageId);
    if (!message || message.ownerId !== args.ownerId || !message.jobId) return null;
    return {
      inboundMessageId: message._id,
      externalMessageId: attachment.externalMessageId,
      externalAttachmentId: attachment.externalAttachmentId,
      ...(attachment.filename ? { filename: attachment.filename } : {}),
      ...(attachment.storageId ? { storageId: attachment.storageId } : {}),
    };
  },
});

export const markAttachmentStored = internalMutation({
  args: {
    attachmentId: v.id("inboundAttachments"),
    ownerId: v.id("users"),
    storageId: v.id("_storage"),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const attachment = await ctx.db.get("inboundAttachments", args.attachmentId);
    if (!attachment || attachment.ownerId !== args.ownerId) throw new Error("Attachment not found.");
    await ctx.db.patch("inboundAttachments", args.attachmentId, {
      storageId: args.storageId,
      storageStatus: "downloaded",
      downloadError: undefined,
      updatedAt: Date.now(),
    });
    return null;
  },
});

export const markAttachmentFailed = internalMutation({
  args: {
    attachmentId: v.id("inboundAttachments"),
    ownerId: v.id("users"),
    reason: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const attachment = await ctx.db.get("inboundAttachments", args.attachmentId);
    if (!attachment || attachment.ownerId !== args.ownerId) return null;
    await ctx.db.patch("inboundAttachments", args.attachmentId, {
      storageStatus: "failed",
      downloadError: args.reason,
      updatedAt: Date.now(),
    });
    return null;
  },
});

export const downloadAttachment = action({
  args: { attachmentId: v.id("inboundAttachments") },
  returns: v.object({ url: v.string(), filename: v.string() }),
  handler: async (ctx, args): Promise<{ url: string; filename: string }> => {
    const ownerId = await requireUserId(ctx);
    const attachment: AttachmentForAction = await ctx.runQuery(internal.inbound.getAttachmentForAction, {
      attachmentId: args.attachmentId,
      ownerId,
    });
    if (!attachment) throw new Error("Attachment not found.");

    if (attachment.storageId) {
      const url: string | null = await ctx.storage.getUrl(attachment.storageId);
      if (!url) throw new Error("Stored attachment is no longer available.");
      return { url, filename: attachment.filename ?? "attachment" };
    }

    const apiKey = env.AGENTMAIL_API_KEY;
    const inboxId = env.AGENTMAIL_INBOX_ID;
    if (!apiKey || !inboxId) throw new Error("AgentMail is not configured on this Convex deployment.");

    try {
      const response = await fetch(
        "https://api.agentmail.to/v0/inboxes/" +
          encodeURIComponent(inboxId) +
          "/messages/" +
          encodeURIComponent(attachment.externalMessageId) +
          "/attachments/" +
          encodeURIComponent(attachment.externalAttachmentId),
        {
          headers: { Authorization: "Bearer " + apiKey },
        },
      );
      if (!response.ok) throw new Error("AgentMail attachment metadata could not be retrieved.");
      const payload: unknown = await response.json();
      if (
        typeof payload !== "object" ||
        payload === null ||
        typeof (payload as { download_url?: unknown }).download_url !== "string"
      ) {
        throw new Error("AgentMail returned no attachment download URL.");
      }

      const download = await fetch((payload as { download_url: string }).download_url);
      if (!download.ok) throw new Error("Attachment download failed.");
      const blob = await download.blob();
      if (blob.size > 20_000_000) throw new Error("Attachment is larger than Findor's safe storage limit.");

      const storageId = await ctx.storage.store(blob);
      await ctx.runMutation(internal.inbound.markAttachmentStored, {
        attachmentId: args.attachmentId,
        ownerId,
        storageId,
      });
      const url: string | null = await ctx.storage.getUrl(storageId);
      if (!url) throw new Error("Stored attachment URL could not be created.");
      return { url, filename: attachment.filename ?? "attachment" };
    } catch (error) {
      await ctx.runMutation(internal.inbound.markAttachmentFailed, {
        attachmentId: args.attachmentId,
        ownerId,
        reason: "Findor could not safely retrieve this attachment.",
      });
      throw error instanceof Error ? error : new Error("Attachment retrieval failed.");
    }
  },
});

export const agentMailWebhook = httpAction(async (ctx, request) => {
  const rawBody = await request.text();
  const secret = env.AGENTMAIL_WEBHOOK_SECRET;
  if (!secret) return new Response("Webhook is not configured.", { status: 503 });

  const verified = await verifySvixSignature(rawBody, request.headers, secret);
  if (!verified) return new Response("Invalid webhook signature.", { status: 401 });

  const svixId = request.headers.get("svix-id");
  if (!svixId) return new Response("Missing webhook identifier.", { status: 400 });

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody) as unknown;
  } catch {
    return new Response("Malformed JSON.", { status: 400 });
  }

  const parsed = parseMessageReceivedPayload(payload, svixId);
  if (parsed.kind === "unsupported") return new Response(null, { status: 204 });
  if (parsed.kind === "malformed") return new Response(parsed.reason, { status: 400 });

  const inboxId = env.AGENTMAIL_INBOX_ID;
  if (!inboxId) return new Response("Webhook inbox is not configured.", { status: 503 });
  if (parsed.event.inboxId !== inboxId) return new Response("Webhook inbox mismatch.", { status: 403 });

  const apiKey = env.AGENTMAIL_API_KEY;
  if (!apiKey) return new Response("AgentMail is not configured.", { status: 503 });

  let enrichedEvent = parsed.event;
  try {
    const fullMessageResponse = await fetch(
      "https://api.agentmail.to/v0/inboxes/" +
        encodeURIComponent(inboxId) +
        "/messages/" +
        encodeURIComponent(parsed.event.externalMessageId),
      {
        headers: { Authorization: "Bearer " + apiKey },
      },
    );
    if (!fullMessageResponse.ok) {
      return new Response("AgentMail message retrieval failed.", { status: 502 });
    }
    const fullMessagePayload: unknown = await fullMessageResponse.json();
    const merged = mergeFullMessagePayload(parsed.event, fullMessagePayload);
    if (!merged) return new Response("AgentMail message identity mismatch.", { status: 502 });
    enrichedEvent = merged;
  } catch {
    return new Response("AgentMail message retrieval failed.", { status: 502 });
  }

  const result = await ctx.runMutation(internal.inbound.ingestVerifiedEvent, enrichedEvent);
  if (result.shouldUnderstand) {
    await ctx.scheduler.runAfter(0, internal.inbound.processUnderstanding, {
      inboundMessageId: result.inboundMessageId,
    });
  }
  return new Response(null, { status: 204 });
});
