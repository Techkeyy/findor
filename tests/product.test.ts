/// <reference types="vite/client" />
import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import schema from "../convex/schema";
import { api, internal } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { classifyAutonomyQuestion } from "../convex/autonomy";
import { friendlyIntakeError } from "../src/formErrors";
import {
  buildOutreachLedgerRows,
  providerEventMessage,
} from "../src/outreachLedger";

const modules = import.meta.glob("../convex/**/*.*s");

describe("global location and mandate boundaries", () => {
  it("keeps intake failures user-friendly", () => {
    expect(
      friendlyIntakeError(new Error("Server Error: jobs:create failed"), "create"),
    ).toBe(
      "We couldn't create your job brief. Please check the highlighted fields and try again.",
    );
    expect(
      friendlyIntakeError(new Error("You must be signed in to manage a job."), "create"),
    ).toBe("Your session may have expired. Please sign in again and try again.");
  });

  it("persists structured global location and formats the discovery value", async () => {
    const t = convexTest(schema, modules);
    const owner = await t.run(async (ctx) =>
      ctx.db.insert("users", { email: "location-owner@example.test" }),
    );

    const jobId = await t.withIdentity({ subject: owner }).mutation(api.jobs.create, {
      serviceCategory: "Residential cleaning",
      jobTitle: "Victoria Island cleaning",
      naturalLanguageDescription:
        "I need a recurring residential cleaning visit for a two-bedroom apartment.",
      country: "Nigeria",
      countryCode: "NG",
      region: "Lagos",
      city: "Lagos",
      locality: "Victoria Island",
      postalCode: "",
      desiredTiming: "Next week",
      budgetOrContext: "Please provide a written estimate.",
    });

    const job = await t.withIdentity({ subject: owner }).query(api.jobs.get, {
      jobId,
    });
    expect(job).toMatchObject({
       serviceLocation: "Victoria Island, Lagos, Nigeria",
      structuredLocation: {
        country: "Nigeria",
        countryCode: "NG",
        region: "Lagos",
        city: "Lagos",
        locality: "Victoria Island",
      },
      status: "brief_ready",
    });
  });

  it("accepts Nigeria, Lagos, and Oshodi with empty optional location fields", async () => {
    const t = convexTest(schema, modules);
    const owner = await t.run(async (ctx) =>
      ctx.db.insert("users", { email: "oshodi-owner@example.test" }),
    );

    const jobId = await t.withIdentity({ subject: owner }).mutation(api.jobs.create, {
      serviceCategory: "Residential cleaning",
      jobTitle: "Oshodi cleaning",
      naturalLanguageDescription:
        "I need a recurring residential cleaning visit for a two-bedroom apartment in Oshodi.",
      country: "Nigeria",
      countryCode: "NG",
      region: "Lagos",
      city: "Lagos",
      locality: "Oshodi",
      postalCode: "",
      desiredTiming: "Next week",
      budgetOrContext: "",
    });

    const job = await t.withIdentity({ subject: owner }).query(api.jobs.get, { jobId });
    expect(job).toMatchObject({
      serviceLocation: "Oshodi, Lagos, Nigeria",
      structuredLocation: {
        country: "Nigeria",
        countryCode: "NG",
        region: "Lagos",
        city: "Lagos",
        locality: "Oshodi",
      },
      status: "brief_ready",
    });
    expect(job?.structuredLocation?.postalCode).toBeUndefined();
  });

  it("collapses case- and whitespace-only duplicate location segments", async () => {
    const t = convexTest(schema, modules);
    const owner = await t.run(async (ctx) =>
      ctx.db.insert("users", { email: "location-normalization@example.test" }),
    );

    const jobId = await t.withIdentity({ subject: owner }).mutation(api.jobs.create, {
      serviceCategory: "Residential cleaning",
      jobTitle: "Oshodi normalization",
      naturalLanguageDescription:
        "I need a recurring residential cleaning visit for a two-bedroom apartment in Oshodi.",
      country: " Nigeria ",
      countryCode: "ng",
      region: " lagos ",
      city: " Lagos ",
      locality: " Oshodi ",
      postalCode: "",
      desiredTiming: "Next week",
      budgetOrContext: "",
    });

    const job = await t.withIdentity({ subject: owner }).query(api.jobs.get, { jobId });
    expect(job?.serviceLocation).toBe("Oshodi, Lagos, Nigeria");
  });

  it("renders one truthful outreach row and event identity per contacted provider", () => {
    const candidates = [
      { _id: "reis", name: "Reis Cleaners" },
      { _id: "cleanly", name: "CLEANLY" },
    ];
    const messages = [
      {
        _id: "cleanly-outreach",
        candidateId: "cleanly",
        providerEmail: "info@cleanly.ng",
        status: "sent",
        purpose: "initial",
        externalMessageId: "cleanly-message",
        externalThreadId: "cleanly-thread",
        followUpState: "scheduled",
        createdAt: 1000,
        updatedAt: 1100,
      },
      {
        _id: "reis-outreach",
        candidateId: "reis",
        providerEmail: "info@reiscleaners.com.ng",
        status: "failed",
        purpose: "initial",
        followUpState: "skipped",
        createdAt: 1000,
        updatedAt: 2100,
      },
    ];

    const rows = buildOutreachLedgerRows(messages, candidates);
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => [row.providerName, row.contactRoute])).toEqual([
      ["CLEANLY", "info@cleanly.ng"],
      ["Reis Cleaners", "info@reiscleaners.com.ng"],
    ]);
    expect(rows.map((row) => [row.sendState, row.followUpState])).toEqual([
      ["Sent", "Planned"],
      ["Failed", "Skipped"],
    ]);

    expect(
      providerEventMessage(
        {
          _id: "sent-event",
          eventType: "outreach_sent",
          message: "generic",
          createdAt: 1090,
        },
        messages,
        candidates,
      ),
    ).toBe("AgentMail accepted outreach to CLEANLY.");
    expect(
      providerEventMessage(
        {
          _id: "follow-up-event",
          eventType: "follow_up_scheduled",
          message: "generic",
          createdAt: 2100,
        },
        messages,
        candidates,
      ),
    ).toBe("Follow-up planned for Reis Cleaners.");
  });

  it("fails cleanly when required geography is ambiguous or missing", async () => {
    const t = convexTest(schema, modules);
    const owner = await t.run(async (ctx) =>
      ctx.db.insert("users", { email: "missing-location@example.test" }),
    );

    const jobId = await t.withIdentity({ subject: owner }).mutation(api.jobs.create, {
      serviceCategory: "Other local service",
      jobTitle: "Ambiguous location fixture",
      naturalLanguageDescription:
        "I need a local service provider for a clearly described household job.",
      country: "Other",
      countryCode: "",
      region: "",
      city: "Lagos",
      locality: "",
      postalCode: "",
      desiredTiming: "Next week",
      budgetOrContext: "",
    });

    const job = await t.withIdentity({ subject: owner }).query(api.jobs.get, {
      jobId,
    });
    expect(job?.status).toBe("needs_info");
    expect(job?.missingFields).toContain("A supported country");
    expect(job?.structuredLocation).toBeUndefined();
  });

  it("accepts region-free service areas globally (no US-style state required)", async () => {
    const t = convexTest(schema, modules);
    const owner = await t.run(async (ctx) =>
      ctx.db.insert("users", { email: "region-free@example.test" }),
    );

    const jobId = await t.withIdentity({ subject: owner }).mutation(api.jobs.create, {
      serviceCategory: "Cleaning",
      jobTitle: "Downtown apartment clean",
      naturalLanguageDescription: "I need a deep clean for my downtown Toronto apartment.",
      country: "Canada",
      countryCode: "",
      region: "",
      city: "Toronto",
      locality: "Downtown Toronto",
      postalCode: "",
      desiredTiming: "Next week",
      budgetOrContext: "",
    });

    const job = await t.withIdentity({ subject: owner }).query(api.jobs.get, {
      jobId,
    });
    expect(job?.status).toBe("brief_ready");
    expect(job?.structuredLocation).toMatchObject({
      country: "Canada",
      countryCode: "CA",
      city: "Toronto",
    });
  });

  it("stores one job mandate with a bounded provider cap and safe defaults", async () => {
    const t = convexTest(schema, modules);
    const owner = await t.run(async (ctx) =>
      ctx.db.insert("users", { email: "mandate-owner@example.test" }),
    );

    const jobId = await t.withIdentity({ subject: owner }).mutation(api.jobs.create, {
      serviceCategory: "Moving",
      jobTitle: "Apartment move",
      naturalLanguageDescription:
        "I need movers for a two-bedroom apartment move next week.",
      country: "United States",
      countryCode: "US",
      region: "Texas",
      city: "Austin",
      locality: "",
      postalCode: "",
      desiredTiming: "Next week",
      budgetOrContext: "Please provide a written estimate.",
    });
    await t.withIdentity({ subject: owner }).mutation(api.jobs.approveBrief, {
      jobId,
      maxProviders: 99,
      preference: "complete_quote",
    });

    const job = await t.withIdentity({ subject: owner }).query(api.jobs.get, {
      jobId,
    });
    expect(job).toMatchObject({
      status: "brief_approved",
      autonomy: {
        enabled: true,
        maxProviders: 5,
        allowInitialOutreach: true,
        allowRoutineClarifications: true,
        allowFollowUp: true,
        maxFollowUps: 1,
        preference: "complete_quote",
      },
    });
  });

  it("queues only source-backed email providers within the approved cap", async () => {
    const t = convexTest(schema, modules);
    const seed = await t.run(async (ctx) => {
      const owner = await ctx.db.insert("users", {
        email: "queue-owner@example.test",
      });
      const now = 1_700_000_000_000;
      const jobId = await ctx.db.insert("jobs", {
        ownerId: owner,
        serviceCategory: "Moving",
        jobTitle: "Bounded provider queue",
        naturalLanguageDescription:
          "Need a written estimate for a two-bedroom move.",
        serviceLocation: "Austin, Texas, United States",
        structuredLocation: {
          country: "United States",
          countryCode: "US",
          region: "Texas",
          city: "Austin",
        },
        desiredTiming: "Next week",
        budgetOrContext: "",
        structuredRequirements: { rawDetails: "", keyDetails: [] },
        status: "providers_ready",
        autonomy: {
          enabled: true,
          maxProviders: 2,
          allowInitialOutreach: true,
          allowRoutineClarifications: true,
          allowFollowUp: true,
          maxFollowUps: 1,
          preference: "balanced",
          approvedAt: now,
        },
        briefApprovedAt: now,
        missingFields: [],
        createdAt: now,
        updatedAt: now,
      });
      const emailCandidate = async (
        name: string,
        email: string,
        claim: string,
      ) =>
        ctx.db.insert("providerCandidates", {
          jobId,
          ownerId: owner,
          name,
          url: "https://" + name.toLowerCase().replace(/ /g, "") + ".example",
          description: "Relevant local moving provider serving Austin, Texas.",
          contactability: "email_found",
          contactEmail: email,
          contactDiscoveryStatus: "resolved",
          contactDiscoveryCheckedAt: now,
          evidence: [
            {
              sourceUrl: "https://provider.example/contact",
              claim,
            },
          ],
          discoveredAt: now,
        });
      await emailCandidate(
        "First Moving",
        "info@firstmoving.example",
        "Public business contact info@firstmoving.example appears on the Austin, Texas contact page.",
      );
      await emailCandidate(
        "Second Moving",
        "quotes@secondmoving.example",
        "Public business contact quotes@secondmoving.example appears on the Austin, Texas quote page.",
      );
      await emailCandidate(
        "Third Moving",
        "third@thirdmoving.example",
        "The provider page mentions a team but does not publish this address.",
      );
      await ctx.db.insert("providerCandidates", {
        jobId,
        ownerId: owner,
        name: "Website Only Moving",
        url: "https://website-only.example",
        description: "Relevant local moving provider.",
        contactability: "website_only",
        evidence: [
          {
            sourceUrl: "https://website-only.example",
            claim: "Website and form only; no published email.",
          },
        ],
        discoveredAt: now,
      });
      return { owner, jobId };
    });

    const queued = await t.mutation(
      internal.outreach.queueAutonomousOutreach,
      { jobId: seed.jobId, ownerId: seed.owner },
    );
    expect(queued).toEqual({ queuedCount: 2, emailFoundCount: 2 });

    const messages = await t.run(async (ctx) =>
      ctx.db
        .query("outreachMessages")
        .withIndex("by_job_and_createdAt", (q) => q.eq("jobId", seed.jobId))
        .take(10),
    );
    expect(messages).toHaveLength(2);
    expect(messages.every((message) => message.purpose === "initial")).toBe(true);
    expect(messages.every((message) => message.status === "approved")).toBe(true);

    const secondQueue = await t.mutation(
      internal.outreach.queueAutonomousOutreach,
      { jobId: seed.jobId, ownerId: seed.owner },
    );
    expect(secondQueue).toEqual({ queuedCount: 0, emailFoundCount: 0 });

    const otherOwner = await t.run(async (ctx) =>
      ctx.db.insert("users", { email: "other-owner@example.test" }),
    );
    const crossTenantQueue = await t.mutation(
      internal.outreach.queueAutonomousOutreach,
      { jobId: seed.jobId, ownerId: otherOwner },
    );
    expect(crossTenantQueue).toEqual({ queuedCount: 0, emailFoundCount: 0 });

    const firstMessage = messages[0];
    await t.mutation(internal.outreach.claimForSend, {
      jobId: seed.jobId,
      ownerId: seed.owner,
      outreachId: firstMessage._id,
    });
    await t.mutation(internal.outreach.markSent, {
      jobId: seed.jobId,
      ownerId: seed.owner,
      outreachId: firstMessage._id,
      messageId: "synthetic-message-id",
      threadId: "synthetic-thread-id",
    });
    await t.mutation(internal.outreach.markSent, {
      jobId: seed.jobId,
      ownerId: seed.owner,
      outreachId: firstMessage._id,
      messageId: "synthetic-message-id",
      threadId: "synthetic-thread-id",
    });
    await expect(
      t.mutation(internal.outreach.markSent, {
        jobId: seed.jobId,
        ownerId: seed.owner,
        outreachId: firstMessage._id,
        messageId: "different-message-id",
        threadId: "different-thread-id",
      }),
    ).rejects.toThrow("different external receipt");
  });

  it("does not queue autonomous work for a paused job", async () => {
    const t = convexTest(schema, modules);
    const seed = await t.run(async (ctx) => {
      const owner = await ctx.db.insert("users", {
        email: "paused-autonomy@example.test",
      });
      const now = 1_700_000_000_000;
      const jobId = await ctx.db.insert("jobs", {
        ownerId: owner,
        serviceCategory: "Painting",
        jobTitle: "Paused request",
        naturalLanguageDescription: "Need a local room painted.",
        serviceLocation: "Toronto, Ontario, Canada",
        structuredLocation: {
          country: "Canada",
          countryCode: "CA",
          region: "Ontario",
          city: "Toronto",
        },
        desiredTiming: "This month",
        budgetOrContext: "",
        structuredRequirements: { rawDetails: "", keyDetails: [] },
        status: "paused",
        pausedFromStatus: "providers_ready",
        autonomy: {
          enabled: true,
          maxProviders: 3,
          allowInitialOutreach: true,
          allowRoutineClarifications: true,
          allowFollowUp: true,
          maxFollowUps: 1,
          preference: "balanced",
          approvedAt: now,
        },
        missingFields: [],
        createdAt: now,
        updatedAt: now,
      });
      const candidateId = await ctx.db.insert("providerCandidates", {
        jobId,
        ownerId: owner,
        name: "Paused Provider",
        url: "https://paused-provider.example",
        description: "Synthetic local provider.",
        contactability: "email_found",
        contactEmail: "paused@paused-provider.example",
        evidence: [
          {
            sourceUrl: "https://paused-provider.example/contact",
            claim: "Public business contact paused@paused-provider.example.",
          },
        ],
        discoveredAt: now,
      });
      const outreachId = await ctx.db.insert("outreachMessages", {
        jobId,
        ownerId: owner,
        candidateId,
        status: "approved",
        purpose: "initial",
        providerEmail: "paused@paused-provider.example",
        subject: "Painting inquiry",
        body: "Synthetic body",
        createdAt: now,
        updatedAt: now,
      });
      return { owner, jobId, outreachId };
    });

    const result = await t.mutation(
      internal.outreach.queueAutonomousOutreach,
      { jobId: seed.jobId, ownerId: seed.owner },
    );
    expect(result).toEqual({ queuedCount: 0, emailFoundCount: 0 });
    await expect(
      t.mutation(internal.outreach.claimForSend, {
        jobId: seed.jobId,
        ownerId: seed.owner,
        outreachId: seed.outreachId,
      }),
    ).rejects.toThrow("no longer sendable");
  });

  it("caps follow-up creation at one and keeps it tenant scoped", async () => {
    const t = convexTest(schema, modules);
    const seed = await t.run(async (ctx) => {
      const owner = await ctx.db.insert("users", {
        email: "followup-owner@example.test",
      });
      const now = 1_700_000_000_000;
      const jobId = await ctx.db.insert("jobs", {
        ownerId: owner,
        serviceCategory: "Moving",
        jobTitle: "Follow-up cap",
        naturalLanguageDescription: "Need a bounded follow-up for a local move.",
        serviceLocation: "Austin, Texas, United States",
        structuredLocation: {
          country: "United States",
          countryCode: "US",
          region: "Texas",
          city: "Austin",
        },
        desiredTiming: "Next week",
        budgetOrContext: "",
        structuredRequirements: { rawDetails: "", keyDetails: [] },
        status: "outreach_sent",
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
        briefApprovedAt: now,
        missingFields: [],
        createdAt: now,
        updatedAt: now,
      });
      const candidateId = await ctx.db.insert("providerCandidates", {
        jobId,
        ownerId: owner,
        name: "Follow-up Provider",
        url: "https://followup-provider.example",
        description: "Synthetic local provider.",
        contactability: "email_found",
        contactEmail: "hello@followup-provider.example",
        evidence: [
          {
            sourceUrl: "https://followup-provider.example/contact",
            claim: "Public business contact hello@followup-provider.example.",
          },
        ],
        discoveredAt: now,
      });
      const parentOutreachId = await ctx.db.insert("outreachMessages", {
        jobId,
        ownerId: owner,
        candidateId,
        status: "sent",
        purpose: "initial",
        providerEmail: "hello@followup-provider.example",
        subject: "Moving inquiry",
        body: "Synthetic body",
        externalMessageId: "synthetic-parent-message",
        externalThreadId: "synthetic-parent-thread",
        followUpCount: 0,
        followUpState: "due",
        createdAt: now,
        updatedAt: now,
      });
      return { owner, jobId, parentOutreachId };
    });

    const first = await t.mutation(internal.outreach.createFollowUp, {
      parentOutreachId: seed.parentOutreachId,
      ownerId: seed.owner,
    });
    expect(first?.outreachId).toBeDefined();
    const second = await t.mutation(internal.outreach.createFollowUp, {
      parentOutreachId: seed.parentOutreachId,
      ownerId: seed.owner,
    });
    expect(second).toBeNull();
  });

  it("deduplicates a routine clarification record before any send", async () => {
    const t = convexTest(schema, modules);
    const seed = await t.run(async (ctx) => {
      const owner = await ctx.db.insert("users", {
        email: "clarification-owner@example.test",
      });
      const now = 1_700_000_000_000;
      const jobId = await ctx.db.insert("jobs", {
        ownerId: owner,
        serviceCategory: "Moving",
        jobTitle: "Clarification dedupe",
        naturalLanguageDescription: "Need a written estimate for a local move.",
        serviceLocation: "Austin, Texas, United States",
        structuredLocation: {
          country: "United States",
          countryCode: "US",
          region: "Texas",
          city: "Austin",
        },
        desiredTiming: "Next week",
        budgetOrContext: "",
        structuredRequirements: { rawDetails: "", keyDetails: [] },
        status: "reply_understood",
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
        missingFields: [],
        createdAt: now,
        updatedAt: now,
      });
      const sourceProviderId = await ctx.db.insert("providerCandidates", {
        jobId,
        ownerId: owner,
        name: "Source Provider",
        url: "https://source-provider.example",
        description: "Synthetic local provider.",
        contactability: "email_found",
        contactEmail: "source@source-provider.example",
        evidence: [
          {
            sourceUrl: "https://source-provider.example/contact",
            claim: "Public business contact source@source-provider.example.",
          },
        ],
        discoveredAt: now,
      });
      const targetProviderId = await ctx.db.insert("providerCandidates", {
        jobId,
        ownerId: owner,
        name: "Target Provider",
        url: "https://target-provider.example",
        description: "Synthetic local provider.",
        contactability: "email_found",
        contactEmail: "target@target-provider.example",
        evidence: [
          {
            sourceUrl: "https://target-provider.example/contact",
            claim: "Public business contact target@target-provider.example.",
          },
        ],
        discoveredAt: now,
      });
      const sourceOutreachId = await ctx.db.insert("outreachMessages", {
        jobId,
        ownerId: owner,
        candidateId: sourceProviderId,
        status: "sent",
        purpose: "initial",
        providerEmail: "source@source-provider.example",
        subject: "Moving inquiry",
        body: "Synthetic body",
        externalMessageId: "source-message",
        externalThreadId: "source-thread",
        createdAt: now,
        updatedAt: now,
      });
      const targetOutreachId = await ctx.db.insert("outreachMessages", {
        jobId,
        ownerId: owner,
        candidateId: targetProviderId,
        status: "sent",
        purpose: "initial",
        providerEmail: "target@target-provider.example",
        subject: "Moving inquiry",
        body: "Synthetic body",
        externalMessageId: "target-message",
        externalThreadId: "target-thread",
        createdAt: now + 1,
        updatedAt: now + 1,
      });
      const sourceInboundId = await ctx.db.insert("inboundMessages", {
        ownerId: owner,
        jobId,
        providerId: sourceProviderId,
        outreachId: sourceOutreachId,
        inboxId: "synthetic-inbox",
        svixId: "source-svix",
        eventId: "source-event",
        externalMessageId: "source-inbound",
        threadId: "source-thread",
        sender: "source@source-provider.example",
        recipients: ["findor@synthetic.example"],
        subject: "Re: Moving inquiry",
        bodyText: "Synthetic source reply",
        receivedAt: now,
        processingStatus: "understood",
        responseKind: "quote",
        createdAt: now,
        updatedAt: now,
      });
      const targetInboundId = await ctx.db.insert("inboundMessages", {
        ownerId: owner,
        jobId,
        providerId: targetProviderId,
        outreachId: targetOutreachId,
        inboxId: "synthetic-inbox",
        svixId: "target-svix",
        eventId: "target-event",
        externalMessageId: "target-inbound",
        threadId: "target-thread",
        sender: "target@target-provider.example",
        recipients: ["findor@synthetic.example"],
        subject: "Re: Moving inquiry",
        bodyText: "Synthetic target reply",
        receivedAt: now + 1,
        processingStatus: "understood",
        responseKind: "quote",
        createdAt: now + 1,
        updatedAt: now + 1,
      });
      const sourceResponseId = await ctx.db.insert("providerResponses", {
        ownerId: owner,
        jobId,
        providerId: sourceProviderId,
        outreachId: sourceOutreachId,
        inboundMessageId: sourceInboundId,
        kind: "quote",
        included: ["packing materials"],
        excluded: [],
        notStated: [],
        unclear: [],
        assumptions: [],
        informationNeeded: [],
        importantNotes: [],
        evidenceText: "Synthetic source evidence",
        model: "synthetic",
        createdAt: now,
        updatedAt: now,
      });
      await ctx.db.insert("providerResponses", {
        ownerId: owner,
        jobId,
        providerId: targetProviderId,
        outreachId: targetOutreachId,
        inboundMessageId: targetInboundId,
        kind: "quote",
        included: [],
        excluded: [],
        notStated: ["packing materials"],
        unclear: [],
        assumptions: [],
        informationNeeded: [],
        importantNotes: [],
        evidenceText: "Synthetic target evidence",
        model: "synthetic",
        createdAt: now + 1,
        updatedAt: now + 1,
      });
      return { owner, sourceResponseId, jobId };
    });

    const first = await t.mutation(internal.inbound.createAutonomousClarification, {
      responseId: seed.sourceResponseId,
    });
    expect(first?.outreachId).toBeDefined();
    const second = await t.mutation(internal.inbound.createAutonomousClarification, {
      responseId: seed.sourceResponseId,
    });
    expect(second).toBeNull();
  });

  it("schedules one follow-up only after a confirmed initial receipt", async () => {
    const t = convexTest(schema, modules);
    const seed = await t.run(async (ctx) => {
      const owner = await ctx.db.insert("users", { email: "scheduler-owner@example.test" });
      const now = 1_700_000_000_000;
      const jobId = await ctx.db.insert("jobs", {
        ownerId: owner,
        serviceCategory: "Moving",
        jobTitle: "Scheduler proof",
        naturalLanguageDescription: "Need a bounded local moving estimate.",
        serviceLocation: "Austin, Texas, United States",
        structuredLocation: {
          country: "United States",
          countryCode: "US",
          region: "Texas",
          city: "Austin",
        },
        desiredTiming: "Next week",
        budgetOrContext: "",
        structuredRequirements: { rawDetails: "", keyDetails: [] },
         status: "outreach_approved",
         briefApprovedAt: now,
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
        missingFields: [],
        createdAt: now,
        updatedAt: now,
      });
      const candidateId = await ctx.db.insert("providerCandidates", {
        jobId,
        ownerId: owner,
        name: "Scheduler Provider",
        url: "https://scheduler-provider.example",
        description: "Synthetic local moving provider serving Austin, Texas.",
        contactability: "email_found",
        contactEmail: "hello@scheduler-provider.example",
        evidence: [
          {
            sourceUrl: "https://scheduler-provider.example/contact",
            claim: "Public business contact hello@scheduler-provider.example.",
          },
        ],
        discoveredAt: now,
      });
      const outreachId = await ctx.db.insert("outreachMessages", {
        jobId,
        ownerId: owner,
        candidateId,
        status: "sending",
        purpose: "initial",
        providerEmail: "hello@scheduler-provider.example",
        subject: "Moving inquiry",
        body: "Synthetic approved request",
        followUpCount: 0,
        createdAt: now,
        updatedAt: now,
      });
      return { owner, jobId, outreachId };
    });

    await t.mutation(internal.outreach.markSent, {
      jobId: seed.jobId,
      ownerId: seed.owner,
      outreachId: seed.outreachId,
      messageId: "confirmed-initial-message",
      threadId: "confirmed-initial-thread",
    });
    const firstSchedule = await t.mutation(internal.outreach.scheduleFollowUp, {
      parentOutreachId: seed.outreachId,
      ownerId: seed.owner,
    });
    expect(["scheduled", "already_handled"]).toContain(firstSchedule);

    const scheduledParent = await t.run(async (ctx) =>
      ctx.db.get("outreachMessages", seed.outreachId),
    );
    expect(scheduledParent).toMatchObject({
      status: "sent",
      externalMessageId: "confirmed-initial-message",
      externalThreadId: "confirmed-initial-thread",
      followUpState: "scheduled",
    });
    expect(scheduledParent?.nextFollowUpAt).toBeGreaterThan(Date.now());
    expect(scheduledParent?.followUpScheduledFunctionId).toBeDefined();

    const schedules = await t.run(async (ctx) =>
      ctx.db.system.query("_scheduled_functions").take(20),
    );
    expect(
      schedules.filter((item) => item.name.includes("sendScheduledFollowUp")),
    ).toHaveLength(1);

    const duplicateSchedule = await t.mutation(internal.outreach.scheduleFollowUp, {
      parentOutreachId: seed.outreachId,
      ownerId: seed.owner,
    });
    expect(duplicateSchedule).toBe("already_handled");

    expect(
      await t.mutation(internal.outreach.markFollowUpDue, {
        parentOutreachId: seed.outreachId,
        ownerId: seed.owner,
      }),
    ).toBe(true);
    const created = await t.mutation(internal.outreach.createFollowUp, {
      parentOutreachId: seed.outreachId,
      ownerId: seed.owner,
    });
    expect(created?.outreachId).toBeDefined();
    expect(
      await t.mutation(internal.outreach.markFollowUpDue, {
        parentOutreachId: seed.outreachId,
        ownerId: seed.owner,
      }),
    ).toBe(true);
    expect(
      await t.mutation(internal.outreach.createFollowUp, {
        parentOutreachId: seed.outreachId,
        ownerId: seed.owner,
      }),
    ).toBeNull();
    await t.mutation(internal.outreach.claimFollowUpForSend, {
      jobId: seed.jobId,
      ownerId: seed.owner,
      outreachId: created!.outreachId,
    });
    await t.mutation(internal.outreach.markFollowUpFailed, {
      jobId: seed.jobId,
      ownerId: seed.owner,
      outreachId: created!.outreachId,
      reason: "Synthetic follow-up failure proof.",
    });
    const records = await t.run(async (ctx) =>
      ctx.db
        .query("outreachMessages")
        .withIndex("by_job_and_createdAt", (q) => q.eq("jobId", seed.jobId))
        .take(10),
    );
    expect(records.filter((item) => item.purpose === "follow_up")).toHaveLength(1);
    expect(records.find((item) => item.purpose === "follow_up")?.status).toBe("failed");
    expect(records.find((item) => item.purpose === "initial")?.followUpState).toBe("failed");
  });
  it("skips failed, revoked, replied, paused, closed, and legacy follow-ups", async () => {
    const t = convexTest(schema, modules);
    const seed = await t.run(async (ctx) => {
      const owner = await ctx.db.insert("users", { email: "gate-owner@example.test" });
      const otherOwner = await ctx.db.insert("users", { email: "other-gate-owner@example.test" });
      const now = 1_700_000_000_000;
      const make = async (
        label: string,
        status:
          | "outreach_approved"
          | "outreach_sent"
          | "reply_received"
          | "paused"
          | "cancelled"
          | "completed",
        options: {
          messageStatus: "sending" | "sent";
          autonomy: "enabled" | "revoked" | "legacy";
          allowFollowUp?: boolean;
          maxFollowUps?: number;
          followUpState?: "scheduled";
          ownerId?: typeof owner;
          withReply?: boolean;
        },
      ) => {
        const jobOwner = options.ownerId ?? owner;
        const baseJob = {
          ownerId: jobOwner,
          serviceCategory: "Moving",
          jobTitle: label,
          naturalLanguageDescription: "Need a bounded local moving estimate.",
          serviceLocation: "Austin, Texas, United States",
          structuredLocation: {
            country: "United States",
            countryCode: "US",
            region: "Texas",
            city: "Austin",
          },
          desiredTiming: "Next week",
          budgetOrContext: "",
           structuredRequirements: { rawDetails: "", keyDetails: [] },
           status,
           briefApprovedAt: now,
           missingFields: [],
          createdAt: now,
          updatedAt: now,
        };
        const jobId = await ctx.db.insert(
          "jobs",
          options.autonomy === "legacy"
            ? baseJob
            : {
                ...baseJob,
                autonomy: {
                  enabled: options.autonomy === "enabled",
                  maxProviders: 1,
                  allowInitialOutreach: true,
                  allowRoutineClarifications: true,
                  allowFollowUp: options.allowFollowUp ?? true,
                  maxFollowUps: options.maxFollowUps ?? 1,
                  preference: "balanced" as const,
                  approvedAt: now,
                },
              },
        );
        const candidateId = await ctx.db.insert("providerCandidates", {
          jobId,
          ownerId: jobOwner,
          name: label + " Provider",
          url: "https://" + label.toLowerCase() + ".example",
          description: "Synthetic local moving provider serving Austin, Texas.",
          contactability: "email_found",
          contactEmail: "hello@" + label.toLowerCase() + ".example",
          evidence: [
            {
              sourceUrl: "https://" + label.toLowerCase() + ".example/contact",
              claim: "Public business contact hello@" + label.toLowerCase() + ".example.",
            },
          ],
          discoveredAt: now,
        });
        const outreachId = await ctx.db.insert("outreachMessages", {
          jobId,
          ownerId: jobOwner,
          candidateId,
          status: options.messageStatus,
          purpose: "initial",
          providerEmail: "hello@" + label.toLowerCase() + ".example",
          subject: "Moving inquiry",
          body: "Synthetic approved request",
          externalMessageId: options.messageStatus === "sent" ? label + "-message" : undefined,
          externalThreadId: options.messageStatus === "sent" ? label + "-thread" : undefined,
          followUpCount: 0,
          followUpState: options.followUpState,
          createdAt: now,
          updatedAt: now,
        });
        if (options.withReply) {
          await ctx.db.insert("inboundMessages", {
            ownerId: jobOwner,
            jobId,
            providerId: candidateId,
            outreachId,
            inboxId: "synthetic-inbox",
            svixId: label + "-svix",
            eventId: label + "-event",
            externalMessageId: label + "-inbound",
            threadId: label + "-thread",
            sender: "reply@" + label.toLowerCase() + ".example",
            recipients: ["findor@synthetic.example"],
            subject: "Re: Moving inquiry",
            bodyText: "Synthetic provider reply",
            receivedAt: now,
            processingStatus: "received",
            createdAt: now,
            updatedAt: now,
          });
        }
        return { jobId, outreachId };
      };
      const failed = await make("failed", "outreach_approved", {
        messageStatus: "sending",
        autonomy: "enabled",
      });
      const noPermission = await make("nopermission", "outreach_approved", {
        messageStatus: "sending",
        autonomy: "enabled",
        allowFollowUp: false,
      });
      const zeroCap = await make("zerocap", "outreach_approved", {
        messageStatus: "sending",
        autonomy: "enabled",
        maxFollowUps: 0,
      });
      const legacy = await make("legacy", "outreach_approved", {
        messageStatus: "sending",
        autonomy: "legacy",
      });
      const replied = await make("replied", "reply_received", {
        messageStatus: "sent",
        autonomy: "enabled",
        followUpState: "scheduled",
        withReply: true,
      });
      const activeAfterOtherProviderReply = await make("otheractive", "reply_received", {
        messageStatus: "sent",
        autonomy: "enabled",
        followUpState: "scheduled",
      });
      const paused = await make("paused", "paused", {
        messageStatus: "sent",
        autonomy: "enabled",
        followUpState: "scheduled",
      });
      const cancelled = await make("cancelled", "cancelled", {
        messageStatus: "sent",
        autonomy: "enabled",
        followUpState: "scheduled",
      });
      const completed = await make("completed", "completed", {
        messageStatus: "sent",
        autonomy: "enabled",
        followUpState: "scheduled",
      });
      const revoked = await make("revoked", "outreach_sent", {
        messageStatus: "sent",
        autonomy: "revoked",
        followUpState: "scheduled",
      });
      const crossTenant = await make("crosstenant", "paused", {
        messageStatus: "sent",
        autonomy: "enabled",
        followUpState: "scheduled",
      });
      return { owner, otherOwner, failed, noPermission, zeroCap, legacy, replied, activeAfterOtherProviderReply, paused, cancelled, completed, revoked, crossTenant };
    });

    await t.mutation(internal.outreach.markFailed, {
      jobId: seed.failed.jobId,
      ownerId: seed.owner,
      outreachId: seed.failed.outreachId,
      reason: "Synthetic failed-send proof.",
    });
    await t.mutation(internal.outreach.markSent, {
      jobId: seed.noPermission.jobId,
      ownerId: seed.owner,
      outreachId: seed.noPermission.outreachId,
      messageId: "nopermission-message",
      threadId: "nopermission-thread",
    });
    await t.mutation(internal.outreach.markSent, {
      jobId: seed.zeroCap.jobId,
      ownerId: seed.owner,
      outreachId: seed.zeroCap.outreachId,
      messageId: "zerocap-message",
      threadId: "zerocap-thread",
    });
    await t.mutation(internal.outreach.markSent, {
      jobId: seed.legacy.jobId,
      ownerId: seed.owner,
      outreachId: seed.legacy.outreachId,
      messageId: "legacy-message",
      threadId: "legacy-thread",
    });

    expect(
      await t.mutation(internal.outreach.markFollowUpDue, {
        parentOutreachId: seed.replied.outreachId,
        ownerId: seed.owner,
      }),
    ).toBe(false);
    expect(
      await t.mutation(internal.outreach.markFollowUpDue, {
        parentOutreachId: seed.activeAfterOtherProviderReply.outreachId,
        ownerId: seed.owner,
      }),
    ).toBe(true);
    const otherProviderFollowUp = await t.mutation(internal.outreach.createFollowUp, {
      parentOutreachId: seed.activeAfterOtherProviderReply.outreachId,
      ownerId: seed.owner,
    });
    expect(otherProviderFollowUp?.outreachId).toBeDefined();
    expect(
      await t.mutation(internal.outreach.markFollowUpDue, {
        parentOutreachId: seed.paused.outreachId,
        ownerId: seed.owner,
      }),
    ).toBe(false);
    expect(
      await t.mutation(internal.outreach.markFollowUpDue, {
        parentOutreachId: seed.cancelled.outreachId,
        ownerId: seed.owner,
      }),
    ).toBe(false);
    expect(
      await t.mutation(internal.outreach.markFollowUpDue, {
        parentOutreachId: seed.completed.outreachId,
        ownerId: seed.owner,
      }),
    ).toBe(false);
    expect(
      await t.mutation(internal.outreach.markFollowUpDue, {
        parentOutreachId: seed.revoked.outreachId,
        ownerId: seed.owner,
      }),
    ).toBe(false);
    expect(
      await t.mutation(internal.outreach.markFollowUpDue, {
        parentOutreachId: seed.crossTenant.outreachId,
        ownerId: seed.otherOwner,
      }),
    ).toBe(false);

    const records = await t.run(async (ctx) =>
      Promise.all([
        ctx.db.get("outreachMessages", seed.failed.outreachId),
        ctx.db.get("outreachMessages", seed.noPermission.outreachId),
        ctx.db.get("outreachMessages", seed.zeroCap.outreachId),
        ctx.db.get("outreachMessages", seed.legacy.outreachId),
        ctx.db.get("outreachMessages", seed.replied.outreachId),
        ctx.db.get("outreachMessages", seed.paused.outreachId),
        ctx.db.get("outreachMessages", seed.cancelled.outreachId),
        ctx.db.get("outreachMessages", seed.completed.outreachId),
        ctx.db.get("outreachMessages", seed.revoked.outreachId),
        ctx.db.get("outreachMessages", seed.crossTenant.outreachId),
      ]),
    );
    expect(records[0]).toMatchObject({ status: "failed" });
    expect(records[0]?.followUpState).toBeUndefined();
    expect(records[1]?.followUpState).toBe("skipped");
    expect(records[2]?.followUpState).toBe("skipped");
    expect(records[3]?.followUpState).toBeUndefined();
    expect(records[4]?.followUpState).toBe("skipped");
    expect(records[5]?.followUpState).toBe("cancelled");
    expect(records[6]?.followUpState).toBe("cancelled");
    expect(records[7]?.followUpState).toBe("cancelled");
    expect(records[8]?.followUpState).toBe("skipped");
    expect(records[9]?.followUpState).toBe("scheduled");

    const schedules = await t.run(async (ctx) =>
      ctx.db.system.query("_scheduled_functions").take(30),
    );
    expect(
      schedules.filter((item) => item.name.includes("sendScheduledFollowUp")),
    ).toHaveLength(0);
  });

  it("schedules exactly one follow-up per eligible initial send, even across transient job states", async () => {
    const t = convexTest(schema, modules);
    const seed = await t.run(async (ctx) => {
      const owner = await ctx.db.insert("users", { email: "batch-invariant@example.test" });
      const now = 1_700_000_000_000;
      const baseJob = {
        ownerId: owner,
        serviceCategory: "Moving",
        jobTitle: "Batch invariant proof",
        naturalLanguageDescription: "Need a bounded local moving estimate.",
        serviceLocation: "Austin, Texas, United States",
        structuredLocation: {
          country: "United States",
          countryCode: "US",
          region: "Texas",
          city: "Austin",
        },
        desiredTiming: "Next week",
        budgetOrContext: "",
        structuredRequirements: { rawDetails: "", keyDetails: [] },
        status: "outreach_sent" as const,
        briefApprovedAt: now,
        autonomy: {
          enabled: true,
          maxProviders: 3,
          allowInitialOutreach: true,
          allowRoutineClarifications: true,
          allowFollowUp: true,
          maxFollowUps: 1,
          preference: "balanced" as const,
          approvedAt: now,
        },
        missingFields: [],
        createdAt: now,
        updatedAt: now,
      };
      const jobId = await ctx.db.insert("jobs", baseJob);
      const parents: Array<{ outreachId: Id<"outreachMessages"> }> = [];
      for (const label of ["alpha", "bravo", "charlie"]) {
        const candidateId = await ctx.db.insert("providerCandidates", {
          jobId,
          ownerId: owner,
          name: label + " Movers",
          url: "https://" + label + ".example",
          description: "Synthetic local moving provider serving Austin, Texas.",
          contactability: "email_found",
          contactEmail: "hello@" + label + ".example",
          evidence: [
            {
              sourceUrl: "https://" + label + ".example/contact",
              claim: "Public business contact hello@" + label + ".example.",
            },
          ],
          discoveredAt: now,
        });
        const outreachId = await ctx.db.insert("outreachMessages", {
          jobId,
          ownerId: owner,
          candidateId,
          status: "sent",
          purpose: "initial",
          providerEmail: "hello@" + label + ".example",
          subject: "Moving inquiry",
          body: "Synthetic approved request",
          externalMessageId: label + "-message",
          externalThreadId: label + "-thread",
          followUpCount: 0,
          followUpState: "scheduling",
          createdAt: now,
          updatedAt: now,
        });
        parents.push({ outreachId });
      }
      return { owner, jobId, parents };
    });

    // 3 eligible providers -> 3 follow-up schedules, one scheduler each.
    for (const parent of seed.parents) {
      await expect(
        t.mutation(internal.outreach.scheduleFollowUp, {
          parentOutreachId: parent.outreachId,
          ownerId: seed.owner,
        }),
      ).resolves.toBe("scheduled");
    }
    const states = await t.run(async (ctx) =>
      Promise.all(
        seed.parents.map((p) => ctx.db.get("outreachMessages", p.outreachId)),
      ),
    );
    expect(states.map((m) => m?.followUpState)).toEqual([
      "scheduled",
      "scheduled",
      "scheduled",
    ]);
    const schedules = await t.run(async (ctx) =>
      ctx.db.system.query("_scheduled_functions").take(30),
    );
    expect(
      schedules.filter((item) => item.name.includes("sendScheduledFollowUp")),
    ).toHaveLength(3);

    // Re-scheduling is idempotent: no duplicate schedulers.
    for (const parent of seed.parents) {
      await expect(
        t.mutation(internal.outreach.scheduleFollowUp, {
          parentOutreachId: parent.outreachId,
          ownerId: seed.owner,
        }),
      ).resolves.toBe("already_handled");
    }

    // Transient job lifecycle state must not veto an authorized follow-up:
    // the fire-time markFollowUpDue gate remains the safety authority.
    await t.run(async (ctx) => {
      const job = await ctx.db.get("jobs", seed.jobId);
      if (job) {
        await ctx.db.patch("jobs", seed.jobId, {
          status: "providers_ready",
          activeOperation: "contact_discovery",
        });
      }
    });
    const transient = await t.run(async (ctx) => {
      const owner = (await ctx.db.get("jobs", seed.jobId))!.ownerId;
      const candidateId = await ctx.db.insert("providerCandidates", {
        jobId: seed.jobId,
        ownerId: owner,
        name: "Delta Movers",
        url: "https://delta.example",
        description: "Synthetic local moving provider serving Austin, Texas.",
        contactability: "email_found",
        contactEmail: "hello@delta.example",
        evidence: [
          {
            sourceUrl: "https://delta.example/contact",
            claim: "Public business contact hello@delta.example.",
          },
        ],
        discoveredAt: Date.now(),
      });
      return await ctx.db.insert("outreachMessages", {
        jobId: seed.jobId,
        ownerId: owner,
        candidateId,
        status: "sent",
        purpose: "initial",
        providerEmail: "hello@delta.example",
        subject: "Moving inquiry",
        body: "Synthetic approved request",
        externalMessageId: "delta-message",
        externalThreadId: "delta-thread",
        followUpCount: 0,
        followUpState: "scheduling",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    });
    await expect(
      t.mutation(internal.outreach.scheduleFollowUp, {
        parentOutreachId: transient,
        ownerId: seed.owner,
      }),
    ).resolves.toBe("scheduled");
  });
  it("rechecks provider quality at callback time and cancels stale schedules safely", async () => {
    const t = convexTest(schema, modules);
    const seed = await t.run(async (ctx) => {
      const owner = await ctx.db.insert("users", { email: "callback-safety@example.test" });
      const now = 1_700_000_000_000;
      const baseJob = {
        ownerId: owner,
        serviceCategory: "Moving",
        jobTitle: "Callback safety proof",
        naturalLanguageDescription: "Need a local moving estimate in Austin.",
        serviceLocation: "Austin, Texas, United States",
        structuredLocation: {
          country: "United States",
          countryCode: "US",
          region: "Texas",
          city: "Austin",
        },
        desiredTiming: "Next week",
        budgetOrContext: "",
        structuredRequirements: { rawDetails: "", keyDetails: [] },
        status: "outreach_sent" as const,
        autonomy: {
          enabled: true,
          maxProviders: 1,
          allowInitialOutreach: true,
          allowRoutineClarifications: true,
          allowFollowUp: true,
          maxFollowUps: 1,
          preference: "balanced" as const,
          approvedAt: now,
        },
        briefApprovedAt: now,
        missingFields: [],
        createdAt: now,
        updatedAt: now,
      };
      const jobId = await ctx.db.insert("jobs", baseJob);
      const invalidProvider = await ctx.db.insert("providerCandidates", {
        jobId,
        ownerId: owner,
        name: "Marketplace listing",
        url: "https://viscorner.com/moving/austin",
        description: "Directory of local moving providers in Austin.",
        entityType: "discovery_source" as const,
        contactability: "email_found" as const,
        contactEmail: "support@viscorner.example",
        evidence: [
          {
            sourceUrl: "https://viscorner.com/moving/austin",
            claim: "Directory listing with public contact support@viscorner.example.",
          },
        ],
        discoveredAt: now,
      });
      const invalidOutreach = await ctx.db.insert("outreachMessages", {
        jobId,
        ownerId: owner,
        candidateId: invalidProvider,
        status: "sent" as const,
        purpose: "initial" as const,
        providerEmail: "support@viscorner.example",
        subject: "Moving inquiry",
        body: "Synthetic historical outreach",
        externalMessageId: "invalid-initial-message",
        externalThreadId: "invalid-initial-thread",
        followUpCount: 0,
        followUpState: "scheduled" as const,
        createdAt: now,
        updatedAt: now,
      });
      const validProvider = await ctx.db.insert("providerCandidates", {
        jobId,
        ownerId: owner,
        name: "Legitimate Austin Movers",
        url: "https://legitimate-moving.example",
        description: "Local moving provider serving Austin, Texas.",
        entityType: "provider" as const,
        contactability: "email_found" as const,
        contactEmail: "hello@legitimate-moving.example",
        evidence: [
          {
            sourceUrl: "https://legitimate-moving.example/contact",
            claim: "Austin moving provider public business contact hello@legitimate-moving.example.",
          },
        ],
        discoveredAt: now,
      });
      const validOutreach = await ctx.db.insert("outreachMessages", {
        jobId,
        ownerId: owner,
        candidateId: validProvider,
        status: "sent" as const,
        purpose: "initial" as const,
        providerEmail: "hello@legitimate-moving.example",
        subject: "Moving inquiry",
        body: "Synthetic valid outreach",
        externalMessageId: "valid-initial-message",
        externalThreadId: "valid-initial-thread",
        followUpCount: 0,
        createdAt: now + 1,
        updatedAt: now + 1,
      });
      const bounceProvider = await ctx.db.insert("providerCandidates", {
        jobId,
        ownerId: owner,
        name: "Bounce-Test Austin Movers",
        url: "https://bounce-test-moving.example",
        description: "Local moving provider serving Austin, Texas.",
        entityType: "provider" as const,
        contactability: "email_found" as const,
        contactEmail: "hello@bounce-test-moving.example",
        evidence: [
          {
            sourceUrl: "https://bounce-test-moving.example/contact",
            claim: "Austin moving provider public business contact hello@bounce-test-moving.example.",
          },
        ],
        discoveredAt: now,
      });
      const bounceOutreach = await ctx.db.insert("outreachMessages", {
        jobId,
        ownerId: owner,
        candidateId: bounceProvider,
        status: "sent" as const,
        purpose: "initial" as const,
        providerEmail: "hello@bounce-test-moving.example",
        subject: "Moving inquiry",
        body: "Synthetic bounce-test outreach",
        externalMessageId: "bounce-test-message",
        externalThreadId: "bounce-test-thread",
        followUpCount: 0,
        followUpState: "scheduled" as const,
        createdAt: now + 2,
        updatedAt: now + 2,
      });
      await ctx.db.insert("inboundMessages", {
        ownerId: owner,
        jobId,
        providerId: bounceProvider,
        outreachId: bounceOutreach,
        inboxId: "synthetic-inbox",
        svixId: "bounce-test-svix",
        eventId: "bounce-test-event",
        externalMessageId: "bounce-test-inbound",
        threadId: "bounce-test-thread",
        sender: "mailer-daemon@example.test",
        recipients: ["findor@synthetic.example"],
        subject: "Mail delivery failed: returning message to sender",
        bodyText: "Delivery failed for the recipient.",
        receivedAt: now + 2,
        processingStatus: "delivery_failed",
        createdAt: now + 2,
        updatedAt: now + 2,
      });
      return { owner, jobId, invalidOutreach, validOutreach, bounceOutreach };
    });

    await expect(
      t.mutation(internal.outreach.markFollowUpDue, {
        parentOutreachId: seed.invalidOutreach,
        ownerId: seed.owner,
      }),
    ).resolves.toBe(false);
    const invalidState = await t.run(async (ctx) =>
      ctx.db.get("outreachMessages", seed.invalidOutreach),
    );
    expect(invalidState).toMatchObject({
      followUpState: "cancelled",
      followUpFailureReason: "Current provider-quality eligibility failed; no follow-up was sent.",
    });

    await expect(
      t.mutation(internal.outreach.markFollowUpDue, {
        parentOutreachId: seed.bounceOutreach,
        ownerId: seed.owner,
      }),
    ).resolves.toBe(false);
    const bounceState = await t.run(async (ctx) =>
      ctx.db.get("outreachMessages", seed.bounceOutreach),
    );
    expect(bounceState).toMatchObject({
      followUpState: "skipped",
      followUpFailureReason:
        "A delivery failure was recorded for this address/thread; the follow-up was suppressed.",
    });

    await expect(
      t.mutation(internal.outreach.scheduleFollowUp, {
        parentOutreachId: seed.validOutreach,
        ownerId: seed.owner,
      }),
    ).resolves.toBe("scheduled");
    await expect(
      t.mutation(internal.outreach.cancelPendingFollowUpsForSafety, {
        jobId: seed.jobId,
      }),
    ).resolves.toMatchObject({ cancelledCount: 1 });
    await expect(
      t.mutation(internal.outreach.cancelPendingFollowUpsForSafety, {
        jobId: seed.jobId,
      }),
    ).resolves.toMatchObject({ cancelledCount: 0 });
    await expect(
      t.mutation(internal.outreach.markFollowUpDue, {
        parentOutreachId: seed.validOutreach,
        ownerId: seed.owner,
      }),
    ).resolves.toBe(false);

    const finalState = await t.run(async (ctx) => {
      const parent = await ctx.db.get("outreachMessages", seed.validOutreach);
      const children = await ctx.db
        .query("outreachMessages")
        .withIndex("by_parentOutreachId", (q) => q.eq("parentOutreachId", seed.validOutreach))
        .take(5);
      const schedules = await ctx.db.system.query("_scheduled_functions").take(30);
      return {
        followUpState: parent?.followUpState,
        childCount: children.length,
        pendingCallbacks: schedules.filter(
          (item) =>
            item.name.includes("sendScheduledFollowUp") &&
            item.state.kind === "pending",
        ).length,
      };
    });
    expect(finalState).toEqual({
      followUpState: "cancelled",
      childCount: 0,
      pendingCallbacks: 0,
    });
  });

  it("stops sensitive autonomous questions at the human boundary", () => {
    expect(classifyAutonomyQuestion("materials")).toBe("routine");
    expect(classifyAutonomyQuestion("availability")).toBe("routine");
    expect(classifyAutonomyQuestion("price")).toBe("needs_user");
    expect(classifyAutonomyQuestion("exact address")).toBe("needs_user");
    expect(classifyAutonomyQuestion("scope change")).toBe("needs_user");
  });
});
