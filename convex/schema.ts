import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { authTables } from "@convex-dev/auth/server";

const responseKindValidator = v.union(
  v.literal("quote"),
  v.literal("needs_information"),
  v.literal("availability"),
  v.literal("decline"),
  v.literal("acknowledgement"),
  v.literal("other"),
);

const jobStatusValidator = v.union(
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

const resumableJobStatusValidator = v.union(
  v.literal("needs_info"),
  v.literal("brief_ready"),
  v.literal("brief_approved"),
  v.literal("researching"),
  v.literal("providers_ready"),
  v.literal("outreach_approved"),
  v.literal("outreach_sent"),
  v.literal("reply_received"),
  v.literal("reply_understood"),
  v.literal("failed"),
);

const activeOperationValidator = v.union(
  v.literal("provider_search"),
  v.literal("contact_discovery"),
  v.literal("outreach_send"),
);
export default defineSchema({
  ...authTables,
  jobs: defineTable({
    ownerId: v.id("users"),
    serviceCategory: v.string(),
    jobTitle: v.string(),
    naturalLanguageDescription: v.string(),
    serviceLocation: v.string(),
    desiredTiming: v.string(),
    budgetOrContext: v.string(),
    structuredRequirements: v.object({
      rawDetails: v.string(),
      keyDetails: v.array(
        v.object({
          label: v.string(),
          value: v.string(),
        }),
      ),
    }),
    status: jobStatusValidator,
    pausedFromStatus: v.optional(resumableJobStatusValidator),
    activeOperation: v.optional(activeOperationValidator),
    missingFields: v.array(v.string()),
    brief: v.optional(
      v.object({
        projectSummary: v.string(),
        serviceCategory: v.string(),
        requestedOutcome: v.string(),
        serviceLocation: v.string(),
        desiredTiming: v.string(),
        budgetOrContext: v.string(),
        structuredRequirements: v.array(
          v.object({
            label: v.string(),
            value: v.string(),
          }),
        ),
        unknowns: v.array(v.string()),
      }),
    ),
    briefApprovedAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_owner", ["ownerId"])
    .index("by_owner_and_updatedAt", ["ownerId", "updatedAt"]),
  jobEvents: defineTable({
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
  }).index("by_job_and_createdAt", ["jobId", "createdAt"]),
  providerCandidates: defineTable({
    jobId: v.id("jobs"),
    ownerId: v.id("users"),
    name: v.string(),
    url: v.string(),
    description: v.string(),
    contactability: v.union(
      v.literal("email_found"),
      v.literal("website_only"),
    ),
    contactEmail: v.optional(v.string()),
    contactDiscoveryStatus: v.optional(
      v.union(
        v.literal("unresolved"),
        v.literal("resolved"),
        v.literal("failed"),
      ),
    ),
    contactDiscoveryCheckedAt: v.optional(v.number()),
    contactDiscoveryError: v.optional(v.string()),
    evidence: v.array(
      v.object({
        sourceUrl: v.string(),
        claim: v.string(),
      }),
    ),
    discoveredAt: v.number(),
  }).index("by_job_and_discoveredAt", ["jobId", "discoveredAt"]),
  outreachMessages: defineTable({
    jobId: v.id("jobs"),
    ownerId: v.id("users"),
    candidateId: v.id("providerCandidates"),
    status: v.union(
      v.literal("approved"),
      v.literal("sending"),
      v.literal("sent"),
      v.literal("failed"),
    ),
    providerEmail: v.string(),
    subject: v.string(),
    body: v.string(),
    externalMessageId: v.optional(v.string()),
    externalThreadId: v.optional(v.string()),
    failureReason: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_job_and_createdAt", ["jobId", "createdAt"])
    .index("by_externalThreadId", ["externalThreadId"])
    .index("by_externalMessageId", ["externalMessageId"]),
  inboundMessages: defineTable({
    ownerId: v.optional(v.id("users")),
    jobId: v.optional(v.id("jobs")),
    providerId: v.optional(v.id("providerCandidates")),
    outreachId: v.optional(v.id("outreachMessages")),
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
    processingStatus: v.union(
      v.literal("received"),
      v.literal("understanding"),
      v.literal("understood"),
      v.literal("needs_review"),
      v.literal("unmatched"),
      v.literal("failed"),
    ),
    responseKind: v.optional(responseKindValidator),
    understandingError: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_svixId", ["svixId"])
    .index("by_externalMessageId", ["externalMessageId"])
    .index("by_threadId_and_createdAt", ["threadId", "createdAt"])
    .index("by_jobId_and_createdAt", ["jobId", "createdAt"]),
  inboundAttachments: defineTable({
    ownerId: v.optional(v.id("users")),
    jobId: v.optional(v.id("jobs")),
    providerId: v.optional(v.id("providerCandidates")),
    outreachId: v.optional(v.id("outreachMessages")),
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
  }).index("by_inboundMessageId_and_createdAt", [
    "inboundMessageId",
    "createdAt",
  ]),
  providerResponses: defineTable({
    ownerId: v.id("users"),
    jobId: v.id("jobs"),
    providerId: v.id("providerCandidates"),
    outreachId: v.id("outreachMessages"),
    inboundMessageId: v.id("inboundMessages"),
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
    model: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_inboundMessageId", ["inboundMessageId"])
    .index("by_jobId_and_createdAt", ["jobId", "createdAt"]),
  clarificationDrafts: defineTable({
    ownerId: v.id("users"),
    jobId: v.id("jobs"),
    attribute: v.string(),
    reason: v.string(),
    proposedMessage: v.string(),
    sourceResponseId: v.id("providerResponses"),
    comparisonResponseId: v.id("providerResponses"),
    status: v.union(
      v.literal("suggested"),
      v.literal("approved"),
      v.literal("cancelled"),
    ),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_jobId_and_createdAt", ["jobId", "createdAt"])
    .index("by_jobId_and_attribute", ["jobId", "attribute"]),
});
