import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import {
  action,
  internalMutation,
  internalQuery,
  mutation,
  query,
  ActionCtx,
} from "./_generated/server";
import { env } from "./_generated/server";
import { internal } from "./_generated/api";

const outreachStatusValidator = v.union(
  v.literal("approved"),
  v.literal("sending"),
  v.literal("sent"),
  v.literal("failed"),
);

const outreachValidator = v.object({
  _id: v.id("outreachMessages"),
  _creationTime: v.number(),
  jobId: v.id("jobs"),
  ownerId: v.id("users"),
  candidateId: v.id("providerCandidates"),
  status: outreachStatusValidator,
  providerEmail: v.string(),
  subject: v.string(),
  body: v.string(),
  externalMessageId: v.optional(v.string()),
  externalThreadId: v.optional(v.string()),
  failureReason: v.optional(v.string()),
  createdAt: v.number(),
  updatedAt: v.number(),
});

function buildDraft(job: {
  serviceCategory: string;
  serviceLocation: string;
  desiredTiming: string;
  naturalLanguageDescription: string;
  budgetOrContext: string;
}) {
  return {
    subject: job.serviceCategory + " inquiry",
    body: [
      "Hello,",
      "",
      "I am gathering comparable estimates for a local service request.",
      "",
      "Service requested: " + job.serviceCategory,
      "Service area: " + job.serviceLocation,
      "Desired timing: " + job.desiredTiming,
      "Request details: " + job.naturalLanguageDescription,
      "Additional context: " + (job.budgetOrContext || "None provided yet."),
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
      !candidate.contactEmail
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
      status: "approved",
      providerEmail: candidate.contactEmail,
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
    if (!job || job.ownerId !== args.ownerId) return null;

    const messages = await ctx.db
      .query("outreachMessages")
      .withIndex("by_job_and_createdAt", (q) => q.eq("jobId", args.jobId))
      .order("desc")
      .take(1);
    const message = messages[0];
    if (!message || message.ownerId !== args.ownerId) return null;
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
    if (
      !job ||
      job.ownerId !== args.ownerId ||
      job.status !== "outreach_approved" ||
      job.activeOperation ||
      !message ||
      message.ownerId !== args.ownerId ||
      message.jobId !== args.jobId ||
      (message.status !== "approved" && message.status !== "failed")
    ) {
      throw new Error(
        "This outreach message is already being sent or is no longer sendable.",
      );
    }

    await ctx.db.patch("outreachMessages", args.outreachId, {
      status: "sending",
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
    if (
      !job ||
      job.ownerId !== args.ownerId ||
      !message ||
      message.ownerId !== args.ownerId ||
      message.jobId !== args.jobId ||
      message.status !== "sending"
    ) {
      throw new Error("This outreach message cannot be marked as sent.");
    }

    const now = Date.now();
    await ctx.db.patch("outreachMessages", args.outreachId, {
      status: "sent",
      externalMessageId: args.messageId,
      externalThreadId: args.threadId,
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
        "AgentMail accepted the outreach and returned a real external message receipt.",
      createdAt: now,
    });
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
      failureReason: args.reason,
      updatedAt: now,
    });
    await ctx.db.patch("jobs", args.jobId, {
      status: "outreach_approved",
      activeOperation: undefined,
      updatedAt: now,
    });
    await ctx.db.insert("jobEvents", {
      jobId: args.jobId,
      ownerId: args.ownerId,
      eventType: "outreach_failed",
      message:
        "AgentMail did not return an external receipt. No successful send is recorded.",
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
