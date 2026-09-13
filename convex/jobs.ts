import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { mutation, query, QueryCtx, MutationCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";

const statusValidator = v.union(
  v.literal("needs_info"),
  v.literal("brief_ready"),
  v.literal("brief_approved"),
  v.literal("researching"),
  v.literal("providers_ready"),
  v.literal("outreach_approved"),
  v.literal("outreach_sent"),
  v.literal("reply_received"),
  v.literal("reply_understood"),
  v.literal("paused"),
  v.literal("cancelled"),
  v.literal("completed"),
  v.literal("failed"),
);

const activeOperationValidator = v.union(
  v.literal("provider_search"),
  v.literal("contact_discovery"),
  v.literal("outreach_send"),
);
const detailValidator = v.object({
  label: v.string(),
  value: v.string(),
});

const briefValidator = v.object({
  projectSummary: v.string(),
  serviceCategory: v.string(),
  requestedOutcome: v.string(),
  serviceLocation: v.string(),
  desiredTiming: v.string(),
  budgetOrContext: v.string(),
  structuredRequirements: v.array(detailValidator),
  unknowns: v.array(v.string()),
});

const jobValidator = v.object({
  _id: v.id("jobs"),
  _creationTime: v.number(),
  ownerId: v.id("users"),
  serviceCategory: v.string(),
  jobTitle: v.string(),
  naturalLanguageDescription: v.string(),
  serviceLocation: v.string(),
  desiredTiming: v.string(),
  budgetOrContext: v.string(),
  structuredRequirements: v.object({
    rawDetails: v.string(),
    keyDetails: v.array(detailValidator),
  }),
  status: statusValidator,
  pausedFromStatus: v.optional(statusValidator),
  activeOperation: v.optional(activeOperationValidator),
  missingFields: v.array(v.string()),
  brief: v.optional(briefValidator),
  briefApprovedAt: v.optional(v.number()),
  createdAt: v.number(),
  updatedAt: v.number(),
});

const eventValidator = v.object({
  _id: v.id("jobEvents"),
  _creationTime: v.number(),
  jobId: v.id("jobs"),
  ownerId: v.id("users"),
  eventType: v.union(
    v.literal("job_created"),
    v.literal("intake_updated"),
    v.literal("brief_generated"),
    v.literal("brief_approved"),
    v.literal("research_started"),
    v.literal("research_completed"),
    v.literal("research_failed"),
    v.literal("contact_discovery_started"),
    v.literal("contact_discovery_completed"),
    v.literal("contact_discovery_failed"),
    v.literal("provider_approved"),
    v.literal("outreach_sent"),
    v.literal("outreach_failed"),
    v.literal("job_paused"),
    v.literal("job_resumed"),
    v.literal("job_cancelled"),
    v.literal("job_completed"),
    v.literal("inbound_received"),
    v.literal("inbound_understood"),
    v.literal("inbound_processing_failed"),
  ),
  message: v.string(),
  createdAt: v.number(),
});

const intakeArgs = {
  serviceCategory: v.string(),
  jobTitle: v.string(),
  naturalLanguageDescription: v.string(),
  serviceLocation: v.string(),
  desiredTiming: v.string(),
  budgetOrContext: v.string(),
};

type Intake = {
  serviceCategory: string;
  jobTitle: string;
  naturalLanguageDescription: string;
  serviceLocation: string;
  desiredTiming: string;
  budgetOrContext: string;
};

const categoryHints = [
  { keywords: ["move", "moving", "mover", "relocat"], label: "Moving" },
  { keywords: ["clean", "maid", "janitorial"], label: "Residential cleaning" },
  { keywords: ["roof", "shingle", "gutter"], label: "Roof replacement" },
  { keywords: ["electric", "wiring", "outlet", "panel"], label: "Electrical" },
  { keywords: ["plumb", "pipe", "drain", "faucet"], label: "Plumbing" },
  {
    keywords: ["hvac", "air conditioner", "furnace", "heating"],
    label: "HVAC",
  },
  { keywords: ["lawn", "landscap", "garden", "yard"], label: "Landscaping" },
  { keywords: ["paint", "painting"], label: "Painting" },
  { keywords: ["handyman", "fixture", "mount", "assembly"], label: "Handyman" },
] as const;

function normalized(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

function inferCategory(description: string) {
  const lowered = description.toLowerCase();
  return (
    categoryHints.find((hint) =>
      hint.keywords.some((keyword) => lowered.includes(keyword)),
    )?.label ?? ""
  );
}

function analyzeIntake(intake: Intake) {
  const naturalLanguageDescription = normalized(
    intake.naturalLanguageDescription,
  );
  const serviceCategory =
    normalized(intake.serviceCategory) ||
    inferCategory(naturalLanguageDescription);
  const jobTitle =
    normalized(intake.jobTitle) ||
    (serviceCategory || "Local service") + " request";
  const serviceLocation = normalized(intake.serviceLocation);
  const desiredTiming = normalized(intake.desiredTiming);
  const budgetOrContext = normalized(intake.budgetOrContext);
  const keyDetails = budgetOrContext
    ? [{ label: "User-provided context", value: budgetOrContext.slice(0, 500) }]
    : [];
  const missingFields: string[] = [];

  if (serviceCategory.length < 2)
    missingFields.push("The type of local service");
  if (naturalLanguageDescription.length < 20) {
    missingFields.push("A little more detail about what you need done");
  }
  if (serviceLocation.length < 2)
    missingFields.push("Where the service should happen");
  if (desiredTiming.length < 2) missingFields.push("Your timing");

  const cleaned = {
    serviceCategory,
    jobTitle,
    naturalLanguageDescription,
    serviceLocation,
    desiredTiming,
    budgetOrContext,
    structuredRequirements: {
      rawDetails: budgetOrContext,
      keyDetails,
    },
  };

  if (missingFields.length > 0) {
    return { cleaned, missingFields, brief: undefined };
  }

  return {
    cleaned,
    missingFields,
    brief: {
      projectSummary: jobTitle + ": " + naturalLanguageDescription,
      serviceCategory,
      requestedOutcome: naturalLanguageDescription,
      serviceLocation,
      desiredTiming,
      budgetOrContext: budgetOrContext || "No additional context provided yet.",
      structuredRequirements: keyDetails,
      unknowns: [
        "Exact scope, quantities, or measurements",
        "Access, materials, preparation, or disposal requirements",
        "Provider availability and final estimate details",
      ],
    },
  };
}

async function requireUserId(ctx: QueryCtx | MutationCtx) {
  const userId = await getAuthUserId(ctx);
  if (!userId) {
    throw new Error("You must be signed in to manage a job.");
  }
  return userId;
}

export const listMine = query({
  args: {},
  returns: v.array(jobValidator),
  handler: async (ctx) => {
    const userId = await requireUserId(ctx);
    return await ctx.db
      .query("jobs")
      .withIndex("by_owner_and_updatedAt", (q) => q.eq("ownerId", userId))
      .order("desc")
      .take(20);
  },
});

export const get = query({
  args: { jobId: v.id("jobs") },
  returns: v.union(v.null(), jobValidator),
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    const job = await ctx.db.get("jobs", args.jobId);
    if (!job || job.ownerId !== userId) {
      return null;
    }
    return job;
  },
});

export const listEvents = query({
  args: { jobId: v.id("jobs") },
  returns: v.array(eventValidator),
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    const job = await ctx.db.get("jobs", args.jobId);
    if (!job || job.ownerId !== userId) {
      return [];
    }
    return await ctx.db
      .query("jobEvents")
      .withIndex("by_job_and_createdAt", (q) => q.eq("jobId", args.jobId))
      .order("desc")
      .take(20);
  },
});

export const create = mutation({
  args: intakeArgs,
  returns: v.id("jobs"),
  handler: async (ctx, args) => {
    const ownerId = await requireUserId(ctx);
    const now = Date.now();
    const analysis = analyzeIntake(args);
    const status = analysis.brief ? "brief_ready" : "needs_info";
    const jobId = await ctx.db.insert("jobs", {
      ownerId,
      ...analysis.cleaned,
      status,
      missingFields: analysis.missingFields,
      brief: analysis.brief,
      createdAt: now,
      updatedAt: now,
    });

    await ctx.db.insert("jobEvents", {
      jobId,
      ownerId,
      eventType: "job_created",
      message: analysis.brief
        ? "Local-service intake saved and a reviewable brief was prepared."
        : "Local-service intake saved. A few details are needed before the brief can be reviewed.",
      createdAt: now,
    });

    if (analysis.brief) {
      await ctx.db.insert("jobEvents", {
        jobId,
        ownerId,
        eventType: "brief_generated",
        message: "A structured local-service brief is ready for your review.",
        createdAt: now + 1,
      });
    }

    return jobId;
  },
});

export const updateIntake = mutation({
  args: { jobId: v.id("jobs"), ...intakeArgs },
  returns: v.null(),
  handler: async (ctx, args) => {
    const ownerId = await requireUserId(ctx);
    const job = await ctx.db.get("jobs", args.jobId);
    if (!job || job.ownerId !== ownerId) {
      throw new Error("Job not found.");
    }
    if (job.status !== "needs_info" && job.status !== "brief_ready") {
      throw new Error(
        "An approved brief cannot be changed in this first release.",
      );
    }

    const now = Date.now();
    const analysis = analyzeIntake(args);
    await ctx.db.patch("jobs", args.jobId, {
      ...analysis.cleaned,
      status: analysis.brief ? "brief_ready" : "needs_info",
      missingFields: analysis.missingFields,
      brief: analysis.brief,
      updatedAt: now,
    });
    await ctx.db.insert("jobEvents", {
      jobId: args.jobId,
      ownerId,
      eventType: "intake_updated",
      message: analysis.brief
        ? "Intake updated and the structured brief is ready to review."
        : "Intake updated. More information is still needed.",
      createdAt: now,
    });
    return null;
  },
});

export const approveBrief = mutation({
  args: { jobId: v.id("jobs") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const ownerId = await requireUserId(ctx);
    const job = await ctx.db.get("jobs", args.jobId);
    if (!job || job.ownerId !== ownerId) {
      throw new Error("Job not found.");
    }
    if (job.status !== "brief_ready" || !job.brief) {
      throw new Error(
        "Complete the missing intake details before approving the brief.",
      );
    }

    const now = Date.now();
    await ctx.db.patch("jobs", args.jobId, {
      status: "brief_approved",
      briefApprovedAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("jobEvents", {
      jobId: args.jobId,
      ownerId,
      eventType: "brief_approved",
      message:
        "You approved the brief. Provider research can now be requested.",
      createdAt: now,
    });
    return null;
  },
});
function controlEventMessage(status: string) {
  return status === "paused"
    ? "This request is paused. No new external action will start until you resume it."
    : status === "cancelled"
      ? "This request was cancelled. No further external action will start."
      : status === "completed"
        ? "This request was marked complete by you."
        : "This request is active.";
}

function assertControlAvailable(job: Doc<"jobs"> | null) {
  if (!job) throw new Error("Job not found.");
  if (job.activeOperation) {
    throw new Error(
      "This step is still in progress. Wait for it to finish before changing the job.",
    );
  }
}

export const pause = mutation({
  args: { jobId: v.id("jobs") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const ownerId = await requireUserId(ctx);
    const job = await ctx.db.get("jobs", args.jobId);
    if (!job || job.ownerId !== ownerId) throw new Error("Job not found.");
    if (job.status === "paused") return null;
    if (job.status === "cancelled" || job.status === "completed") {
      throw new Error("This request is already closed.");
    }
    assertControlAvailable(job);
    const now = Date.now();
    await ctx.db.patch("jobs", args.jobId, {
      status: "paused",
      pausedFromStatus: job.status,
      updatedAt: now,
    });
    await ctx.db.insert("jobEvents", {
      jobId: args.jobId,
      ownerId,
      eventType: "job_paused",
      message: controlEventMessage("paused"),
      createdAt: now,
    });
    return null;
  },
});

export const resume = mutation({
  args: { jobId: v.id("jobs") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const ownerId = await requireUserId(ctx);
    const job = await ctx.db.get("jobs", args.jobId);
    if (!job || job.ownerId !== ownerId) throw new Error("Job not found.");
    if (job.status !== "paused")
      throw new Error("Only a paused request can be resumed.");
    const restoredStatus =
      job.pausedFromStatus === "researching"
        ? "brief_approved"
        : (job.pausedFromStatus ?? "brief_ready");
    const now = Date.now();
    await ctx.db.patch("jobs", args.jobId, {
      status: restoredStatus,
      pausedFromStatus: undefined,
      updatedAt: now,
    });
    await ctx.db.insert("jobEvents", {
      jobId: args.jobId,
      ownerId,
      eventType: "job_resumed",
      message:
        "You resumed this request. Findor will wait for your next explicit step.",
      createdAt: now,
    });
    return null;
  },
});

export const cancel = mutation({
  args: { jobId: v.id("jobs") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const ownerId = await requireUserId(ctx);
    const job = await ctx.db.get("jobs", args.jobId);
    if (!job || job.ownerId !== ownerId) throw new Error("Job not found.");
    if (job.status === "cancelled") return null;
    if (job.status === "completed")
      throw new Error("A completed request cannot be cancelled.");
    assertControlAvailable(job);
    const now = Date.now();
    await ctx.db.patch("jobs", args.jobId, {
      status: "cancelled",
      pausedFromStatus: undefined,
      updatedAt: now,
    });
    await ctx.db.insert("jobEvents", {
      jobId: args.jobId,
      ownerId,
      eventType: "job_cancelled",
      message: controlEventMessage("cancelled"),
      createdAt: now,
    });
    return null;
  },
});

export const complete = mutation({
  args: { jobId: v.id("jobs") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const ownerId = await requireUserId(ctx);
    const job = await ctx.db.get("jobs", args.jobId);
    if (!job || job.ownerId !== ownerId) throw new Error("Job not found.");
    if (job.status === "completed") return null;
    if (job.status !== "reply_understood") {
      throw new Error(
        "Review the understood provider reply before marking this request complete.",
      );
    }
    assertControlAvailable(job);
    const now = Date.now();
    await ctx.db.patch("jobs", args.jobId, {
      status: "completed",
      pausedFromStatus: undefined,
      updatedAt: now,
    });
    await ctx.db.insert("jobEvents", {
      jobId: args.jobId,
      ownerId,
      eventType: "job_completed",
      message: controlEventMessage("completed"),
      createdAt: now,
    });
    return null;
  },
});
