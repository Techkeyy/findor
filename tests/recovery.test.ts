import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import schema from "../convex/schema";
import { internal } from "../convex/_generated/api";
import type { MutationCtx } from "../convex/_generated/server";
import {
  decideJobResolution,
  summarizeProviderResolution,
  type RecoveryMessage,
} from "../convex/recovery";

const modules = import.meta.glob("../convex/**/*.*s");

type RecoveryJobStatus =
  | "outreach_sent"
  | "reply_received"
  | "reply_understood"
  | "paused"
  | "cancelled"
  | "completed"
  | "needs_user";

type RecoveryScenarioOptions = {
  maxProviders: number;
  includeUsableReply?: boolean;
  includeReplacement?: boolean;
  recoveryDiscoveryCycles?: number;
  jobStatus?: RecoveryJobStatus;
  pendingFollowUp?: boolean;
  allowRoutineClarifications?: boolean;
};

async function seedRecoveryScenario(ctx: MutationCtx, options: RecoveryScenarioOptions) {
  const ownerId = await ctx.db.insert("users", {
    email: "decline-recovery-owner@example.test",
  });
  const now = 1_700_000_000_000;
  const jobId = await ctx.db.insert("jobs", {
    ownerId,
    serviceCategory: "Residential Cleaning",
    jobTitle: "Decline recovery fixture",
    naturalLanguageDescription: "Need a local cleaning provider for a test request.",
    serviceLocation: "Austin, Texas, United States",
    structuredLocation: {
      country: "United States",
      countryCode: "US",
      region: "Texas",
      city: "Austin",
    },
    desiredTiming: "Next week",
    budgetOrContext: "Written estimate requested.",
    structuredRequirements: {
      rawDetails: "Written estimate requested.",
      keyDetails: [],
    },
    status: options.jobStatus ?? "reply_understood",
    missingFields: [],
    briefApprovedAt: now,
    recoveryEnabled: true,
    recoveryDiscoveryCycles: options.recoveryDiscoveryCycles ?? 0,
    autonomy: {
      enabled: true,
      maxProviders: options.maxProviders,
      allowInitialOutreach: true,
      allowRoutineClarifications: options.allowRoutineClarifications ?? true,
      allowFollowUp: true,
      maxFollowUps: 1,
      preference: "balanced",
      approvedAt: now,
    },
    createdAt: now,
    updatedAt: now,
  });

  const provider = async (name: string, suffix: string) =>
    ctx.db.insert("providerCandidates", {
      jobId,
      ownerId,
      name,
      url: `https://${suffix}.example.test`,
      description: "A local residential cleaning provider serving Austin, TX.",
      entityType: "provider",
      contactability: "email_found",
      contactEmail: `hello@${suffix}.example.test`,
      evidence: [
        {
          sourceUrl: `https://${suffix}.example.test/contact`,
          claim: `Austin residential cleaning provider with public business contact hello@${suffix}.example.test.`,
        },
      ],
      discoveredAt: now,
    });

  const declinedProviderId = await provider("Declining Cleaning Provider", "declining-cleaner");
  const declinedOutreachId = await ctx.db.insert("outreachMessages", {
    jobId,
    ownerId,
    candidateId: declinedProviderId,
    status: "sent",
    purpose: "initial",
    providerEmail: "hello@declining-cleaner.example.test",
    subject: "Cleaning inquiry",
    body: "Fixture request.",
    externalMessageId: "declined-message",
    externalThreadId: "declined-thread",
    providerResolution: "declined",
    followUpState: options.pendingFollowUp ? "scheduling" : "cancelled",
    createdAt: now,
    updatedAt: now,
  });

  if (options.pendingFollowUp) {
    await ctx.db.insert("inboundMessages", {
      ownerId,
      jobId,
      providerId: declinedProviderId,
      outreachId: declinedOutreachId,
      inboxId: "fixture-inbox",
      svixId: "decline-svix",
      eventId: "decline-event",
      externalMessageId: "decline-message",
      threadId: "declined-thread",
      sender: "hello@declining-cleaner.example.test",
      recipients: ["findor@example.test"],
      subject: "Re: Cleaning inquiry",
      bodyText: "We decline this request.",
      receivedAt: now,
      processingStatus: "understood",
      responseKind: "decline",
      createdAt: now,
      updatedAt: now,
    });
  }

  if (options.includeUsableReply) {
    const repliedProviderId = await provider("Replying Cleaning Provider", "replying-cleaner");
    const repliedOutreachId = await ctx.db.insert("outreachMessages", {
      jobId,
      ownerId,
      candidateId: repliedProviderId,
      status: "sent",
      purpose: "initial",
      providerEmail: "hello@replying-cleaner.example.test",
      subject: "Cleaning inquiry",
      body: "Fixture request.",
      externalMessageId: "replying-message",
      externalThreadId: "replying-thread",
      providerResolution: "replied",
      followUpState: "sent",
      createdAt: now + 1,
      updatedAt: now + 1,
    });
    const inboundMessageId = await ctx.db.insert("inboundMessages", {
      ownerId,
      jobId,
      providerId: repliedProviderId,
      outreachId: repliedOutreachId,
      inboxId: "fixture-inbox",
      svixId: "reply-svix",
      eventId: "reply-event",
      externalMessageId: "reply-message",
      threadId: "replying-thread",
      sender: "hello@replying-cleaner.example.test",
      recipients: ["findor@example.test"],
      subject: "Re: Cleaning inquiry",
      bodyText: "We can provide an estimate.",
      receivedAt: now + 1,
      processingStatus: "understood",
      responseKind: "quote",
      createdAt: now + 1,
      updatedAt: now + 1,
    });
    await ctx.db.insert("providerResponses", {
      ownerId,
      jobId,
      providerId: repliedProviderId,
      outreachId: repliedOutreachId,
      inboundMessageId,
      kind: "quote",
      included: [],
      excluded: [],
      notStated: [],
      unclear: [],
      assumptions: [],
      informationNeeded: [],
      importantNotes: [],
      evidenceText: "We can provide an estimate.",
      summary: "Estimate available.",
      confidence: "high",
      requestedSensitiveInformation: [],
      requestedCommitments: [],
      evidence: [{ field: "summary", excerpt: "We can provide an estimate." }],
      model: "fixture",
      createdAt: now + 1,
      updatedAt: now + 1,
    });
  }

  const replacementCandidateId = options.includeReplacement
    ? await provider("Replacement Cleaning Provider", "replacement-cleaner")
    : null;
  return { jobId, ownerId, declinedOutreachId, replacementCandidateId };
}

describe("bounded non-response recovery decisions", () => {
  it("waits while any contacted provider is still awaiting a reply", () => {
    const messages: RecoveryMessage[] = [
      {
        providerKey: "domain:first.example",
        status: "sent",
        purpose: "initial",
        providerResolution: "waiting",
      },
      {
        providerKey: "domain:second.example",
        status: "sent",
        purpose: "initial",
        providerResolution: "no_response",
      },
    ];

    const counts = summarizeProviderResolution(messages, 3);
    expect(counts).toMatchObject({
      contactedCount: 2,
      waitingCount: 1,
      remainingProviderCapacity: 1,
    });
    expect(decideJobResolution(counts)).toBe("wait");
  });

  it("allows one replacement or one bounded search after no response", () => {
    const messages: RecoveryMessage[] = [
      {
        providerKey: "domain:first.example",
        status: "sent",
        purpose: "initial",
        providerResolution: "no_response",
      },
    ];

    const counts = summarizeProviderResolution(messages, 2);
    expect(counts.remainingProviderCapacity).toBe(1);
    expect(decideJobResolution(counts)).toBe("continue_autonomy");
  });

  it("stops at the approved provider limit when no usable response exists", () => {
    const messages: RecoveryMessage[] = [
      {
        providerKey: "domain:first.example",
        status: "delivery_failed",
        purpose: "initial",
        providerResolution: "delivery_failed",
      },
      {
        providerKey: "domain:second.example",
        status: "sent",
        purpose: "initial",
        providerResolution: "no_response",
      },
    ];

    const counts = summarizeProviderResolution(messages, 2);
    expect(counts.remainingProviderCapacity).toBe(0);
    expect(decideJobResolution(counts)).toBe("needs_user");
  });

  it("never treats a usable response as a reason to recover", () => {
    const messages: RecoveryMessage[] = [
      {
        providerKey: "domain:first.example",
        status: "sent",
        purpose: "initial",
        providerResolution: "replied",
        usableResponse: true,
      },
      {
        providerKey: "domain:second.example",
        status: "sent",
        purpose: "initial",
        providerResolution: "no_response",
      },
    ];

    const counts = summarizeProviderResolution(messages, 3);
    expect(counts.usableResponseCount).toBe(1);
    expect(decideJobResolution(counts)).toBe("options_ready");
  });

  it("counts a genuine decline as contacted while leaving capacity available", () => {
    const messages: RecoveryMessage[] = [
      {
        providerKey: "domain:declining.example",
        status: "sent",
        purpose: "initial",
        providerResolution: "declined",
      },
      {
        providerKey: "domain:replying.example",
        status: "sent",
        purpose: "initial",
        providerResolution: "replied",
        usableResponse: true,
      },
    ];

    const counts = summarizeProviderResolution(messages, 3);
    expect(counts).toMatchObject({
      contactedCount: 2,
      declinedCount: 1,
      remainingProviderCapacity: 1,
    });
  });

  it("deduplicates repeated decline rows for the same provider", () => {
    const counts = summarizeProviderResolution(
      [
        {
          providerKey: "domain:declining.example",
          status: "sent",
          purpose: "initial",
          providerResolution: "declined",
        },
        {
          providerKey: "domain:declining.example",
          status: "sent",
          purpose: "initial",
          providerResolution: "declined",
        },
      ],
      2,
    );

    expect(counts).toMatchObject({ contactedCount: 1, declinedCount: 1, remainingProviderCapacity: 1 });
  });

  it("persists a genuine decline and schedules recovery only once for a duplicate interpretation", async () => {
    const t = convexTest(schema, modules);
    const seeded = await t.run((ctx) =>
      seedRecoveryScenario(ctx, {
        maxProviders: 2,
        pendingFollowUp: true,
        allowRoutineClarifications: false,
      }),
    );
    const response = {
      kind: "decline" as const,
      headlinePrice: null,
      priceQualifier: null,
      priceMin: null,
      priceMax: null,
      currency: null,
      availability: null,
      estimatedTiming: null,
      included: [],
      excluded: [],
      notStated: [],
      unclear: [],
      paymentTerms: null,
      warranty: null,
      assumptions: [],
      informationNeeded: [],
      inspectionRequirement: null,
      importantNotes: [],
      evidenceText: "We decline this request.",
      summary: "The provider declined the request.",
      confidence: "high" as const,
      requestedSensitiveInformation: [],
      requestedCommitments: [],
      evidence: [{ field: "response", excerpt: "We decline this request." }],
    };
    const inboundMessageId = await t.run(async (ctx) => {
      const messages = await ctx.db
        .query("inboundMessages")
        .withIndex("by_threadId_and_createdAt", (q) => q.eq("threadId", "declined-thread"))
        .take(1);
      return messages[0]._id;
    });
    const first = await t.mutation(internal.inbound.persistUnderstanding, {
      inboundMessageId,
      model: "fixture",
      response,
    });
    const second = await t.mutation(internal.inbound.persistUnderstanding, {
      inboundMessageId,
      model: "fixture",
      response,
    });
    expect(second).toBe(first);
    const result = await t.run(async (ctx) => {
      const outreach = await ctx.db.get("outreachMessages", seeded.declinedOutreachId);
      const responses = await ctx.db
        .query("providerResponses")
        .withIndex("by_inboundMessageId", (q) => q.eq("inboundMessageId", inboundMessageId))
        .take(5);
      const schedules = await ctx.db.system.query("_scheduled_functions").take(20);
      return {
        providerResolution: outreach?.providerResolution,
        responseCount: responses.length,
        recoverySchedules: schedules.filter((item) => item.name.includes("evaluateRecovery")).length,
      };
    });
    expect(result).toEqual({
      providerResolution: "declined",
      responseCount: 1,
      recoverySchedules: 1,
    });
  });

  it("stops a recovery-enabled job after its single discovery cycle", async () => {
    const t = convexTest(schema, modules);
    const seeded = await t.run(async (ctx) => {
      const ownerId = await ctx.db.insert("users", {
        email: "recovery-owner@example.test",
      });
      const now = 1_700_000_000_000;
      const jobId = await ctx.db.insert("jobs", {
        ownerId,
        serviceCategory: "Moving",
        jobTitle: "Bounded recovery fixture",
        naturalLanguageDescription: "Need a local moving provider for a test request.",
        serviceLocation: "Austin, Texas, United States",
        structuredLocation: {
          country: "United States",
          countryCode: "US",
          region: "Texas",
          city: "Austin",
        },
        desiredTiming: "Next week",
        budgetOrContext: "Written estimate requested.",
        structuredRequirements: {
          rawDetails: "Written estimate requested.",
          keyDetails: [],
        },
        status: "outreach_sent",
        missingFields: [],
        recoveryEnabled: true,
        recoveryDiscoveryCycles: 1,
        autonomy: {
          enabled: true,
          maxProviders: 1,
          allowInitialOutreach: true,
          allowRoutineClarifications: true,
          allowFollowUp: true,
          maxFollowUps: 1,
          preference: "balanced",
          approvedAt: now,
        },
        createdAt: now,
        updatedAt: now,
      });
      const candidateId = await ctx.db.insert("providerCandidates", {
        jobId,
        ownerId,
        name: "Fixture Moving Provider",
        url: "https://fixture-moving.example/",
        description: "Local moving provider serving Austin.",
        entityType: "provider",
        contactability: "email_found",
        contactEmail: "hello@fixture-moving.example",
        evidence: [
          {
            sourceUrl: "https://fixture-moving.example/contact",
            claim: "Public business contact hello@fixture-moving.example.",
          },
        ],
        discoveredAt: now,
      });
      await ctx.db.insert("outreachMessages", {
        jobId,
        ownerId,
        candidateId,
        status: "sent",
        purpose: "initial",
        providerEmail: "hello@fixture-moving.example",
        subject: "Moving inquiry",
        body: "Fixture request.",
        providerResolution: "no_response",
        externalMessageId: "fixture-message",
        externalThreadId: "fixture-thread",
        followUpState: "sent",
        createdAt: now,
        updatedAt: now,
      });
      return { jobId, ownerId };
    });

    const decision = await t.mutation(internal.outreach.evaluateRecovery, seeded);
    expect(decision).toBe("needs_user");
    const result = await t.run(async (ctx) => {
      const job = await ctx.db.get("jobs", seeded.jobId);
      const events = await ctx.db
        .query("jobEvents")
        .withIndex("by_job_and_createdAt", (q) => q.eq("jobId", seeded.jobId))
        .take(20);
      return { status: job?.status, eventTypes: events.map((event) => event.eventType) };
    });
    expect(result.status).toBe("needs_user");
    expect(result.eventTypes).toContain("autonomous_action_blocked");
  });

  it("continues after a decline to an existing eligible provider despite another usable reply", async () => {
    const t = convexTest(schema, modules);
    const seeded = await t.run((ctx) =>
      seedRecoveryScenario(ctx, {
        maxProviders: 3,
        includeUsableReply: true,
        includeReplacement: true,
      }),
    );

    const decision = await t.mutation(internal.outreach.evaluateRecovery, {
      jobId: seeded.jobId,
      ownerId: seeded.ownerId,
    });
    expect(decision).toBe("queued");
    const result = await t.run(async (ctx) => {
      const messages = await ctx.db
        .query("outreachMessages")
        .withIndex("by_job_and_createdAt", (q) => q.eq("jobId", seeded.jobId))
        .take(10);
      const events = await ctx.db
        .query("jobEvents")
        .withIndex("by_job_and_createdAt", (q) => q.eq("jobId", seeded.jobId))
        .take(20);
      return {
        messageCount: messages.length,
        replacementQueued: events.filter((event) => event.eventType === "provider_replacement_queued").length,
        queuedCandidateId: messages.find((message) => message.status === "approved")?.candidateId,
      };
    });
    expect(result).toMatchObject({
      messageCount: 3,
      replacementQueued: 1,
      queuedCandidateId: seeded.replacementCandidateId,
    });
  });

  it("schedules one bounded recovery search after a decline when no eligible provider remains", async () => {
    const t = convexTest(schema, modules);
    const seeded = await t.run((ctx) =>
      seedRecoveryScenario(ctx, { maxProviders: 2 }),
    );

    await expect(
      t.mutation(internal.outreach.evaluateRecovery, {
        jobId: seeded.jobId,
        ownerId: seeded.ownerId,
      }),
    ).resolves.toBe("search_scheduled");
    await expect(
      t.mutation(internal.outreach.evaluateRecovery, {
        jobId: seeded.jobId,
        ownerId: seeded.ownerId,
      }),
    ).resolves.toBe("already_handled");
    const result = await t.run(async (ctx) => {
      const job = await ctx.db.get("jobs", seeded.jobId);
      const events = await ctx.db
        .query("jobEvents")
        .withIndex("by_job_and_createdAt", (q) => q.eq("jobId", seeded.jobId))
        .take(20);
      return {
        activeOperation: job?.activeOperation,
        recoveryDiscoveryCycles: job?.recoveryDiscoveryCycles,
        searchEvents: events.filter((event) => event.eventType === "recovery_research_started").length,
      };
    });
    expect(result).toEqual({
      activeOperation: "recovery_search",
      recoveryDiscoveryCycles: 1,
      searchEvents: 1,
    });
  });

  it("does not recover after a decline when the approved provider cap is exhausted", async () => {
    const t = convexTest(schema, modules);
    const seeded = await t.run((ctx) =>
      seedRecoveryScenario(ctx, { maxProviders: 1, includeReplacement: true }),
    );

    await expect(
      t.mutation(internal.outreach.evaluateRecovery, {
        jobId: seeded.jobId,
        ownerId: seeded.ownerId,
      }),
    ).resolves.toBe("needs_user");
    const result = await t.run(async (ctx) => {
      const job = await ctx.db.get("jobs", seeded.jobId);
      const messages = await ctx.db
        .query("outreachMessages")
        .withIndex("by_job_and_createdAt", (q) => q.eq("jobId", seeded.jobId))
        .take(10);
      return { status: job?.status, messageCount: messages.length };
    });
    expect(result).toEqual({ status: "needs_user", messageCount: 1 });
  });

  it("never schedules a follow-up after a decline reply", async () => {
    const t = convexTest(schema, modules);
    const seeded = await t.run((ctx) =>
      seedRecoveryScenario(ctx, { maxProviders: 2, pendingFollowUp: true }),
    );

    await expect(
      t.mutation(internal.outreach.scheduleFollowUp, {
        parentOutreachId: seeded.declinedOutreachId,
        ownerId: seeded.ownerId,
      }),
    ).resolves.toBe("skipped");
    const result = await t.run(async (ctx) => {
      const parent = await ctx.db.get("outreachMessages", seeded.declinedOutreachId);
      const children = await ctx.db
        .query("outreachMessages")
        .withIndex("by_parentOutreachId", (q) => q.eq("parentOutreachId", seeded.declinedOutreachId))
        .take(10);
      return { followUpState: parent?.followUpState, childCount: children.length };
    });
    expect(result).toEqual({ followUpState: "skipped", childCount: 0 });
  });

  it("blocks decline recovery for paused, cancelled, completed, and needs-user jobs", async () => {
    for (const jobStatus of ["paused", "cancelled", "completed", "needs_user"] as const) {
      const t = convexTest(schema, modules);
      const seeded = await t.run((ctx) =>
        seedRecoveryScenario(ctx, {
          maxProviders: 2,
          includeReplacement: true,
          jobStatus,
        }),
      );
      await expect(
        t.mutation(internal.outreach.evaluateRecovery, {
          jobId: seeded.jobId,
          ownerId: seeded.ownerId,
        }),
      ).resolves.toBe("blocked");
      const messageCount = await t.run(async (ctx) =>
        (await ctx.db
          .query("outreachMessages")
          .withIndex("by_job_and_createdAt", (q) => q.eq("jobId", seeded.jobId))
          .take(10)).length,
      );
      expect(messageCount).toBe(1);
    }
  });
});
