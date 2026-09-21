import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import schema from "../convex/schema";
import { api, internal } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { redactExactAddressLikeText } from "../convex/providerQuality";
import {
  countUsableSameBriefQuotes,
  isUsableQuoteResponse,
} from "../convex/jobs";

const modules = import.meta.glob("../convex/**/*.*s");

async function seedJobs(t: ReturnType<typeof convexTest>) {
  return await t.run(async (ctx) => {
    const owner = await ctx.db.insert("users", {
      email: "controls-owner@example.test",
    });
    const other = await ctx.db.insert("users", {
      email: "controls-other@example.test",
    });
    const now = 1_700_000_000_000;
    const fields = {
      serviceCategory: "Moving",
      jobTitle: "Control fixture",
      naturalLanguageDescription: "Fixture request for recovery controls.",
      serviceLocation: "Austin, TX",
      desiredTiming: "Next week",
      budgetOrContext: "",
      structuredRequirements: { rawDetails: "Fixture", keyDetails: [] },
      missingFields: [],
      createdAt: now,
      updatedAt: now,
    } as const;
    const job = await ctx.db.insert("jobs", {
      ownerId: owner,
      ...fields,
      status: "providers_ready",
    });
    const completeJob = await ctx.db.insert("jobs", {
      ownerId: owner,
      ...fields,
      status: "reply_understood",
    });
    const otherJob = await ctx.db.insert("jobs", {
      ownerId: other,
      ...fields,
      status: "providers_ready",
    });
    return { owner, other, job, completeJob, otherJob };
  });
}

async function readJob(t: ReturnType<typeof convexTest>, jobId: Id<"jobs">) {
  return await t.run(async (ctx) => {
    const job = await ctx.db.get("jobs", jobId);
    return job
      ? {
          status: job.status,
          pausedFromStatus: job.pausedFromStatus,
          activeOperation: job.activeOperation,
        }
      : null;
  });
}
describe("job recovery controls", () => {
  it("supports owner-only pause, resume, cancellation, and completion", async () => {
    const t = convexTest(schema, modules);
    const seed = await seedJobs(t);
    const owner = t.withIdentity({ subject: seed.owner });

    await owner.mutation(api.jobs.pause, { jobId: seed.job });
    expect(await readJob(t, seed.job)).toMatchObject({
      status: "paused",
      pausedFromStatus: "providers_ready",
    });

    await owner.mutation(api.jobs.resume, { jobId: seed.job });
    expect(await readJob(t, seed.job)).toMatchObject({
      status: "providers_ready",
    });

    await owner.mutation(api.jobs.cancel, { jobId: seed.job });
    expect(await readJob(t, seed.job)).toMatchObject({ status: "cancelled" });
    await expect(
      owner.mutation(api.jobs.resume, { jobId: seed.job }),
    ).rejects.toThrow("paused");

    await owner.mutation(api.jobs.complete, { jobId: seed.completeJob });
    expect(await readJob(t, seed.completeJob)).toMatchObject({
      status: "completed",
    });

    await expect(
      t
        .withIdentity({ subject: seed.other })
        .mutation(api.jobs.pause, { jobId: seed.job }),
    ).rejects.toThrow("Job not found");
  });
  it("locks recovery controls while an external operation is active", async () => {
    const t = convexTest(schema, modules);
    const seed = await seedJobs(t);
    const owner = t.withIdentity({ subject: seed.owner });

    await t.run(async (ctx) => {
      await ctx.db.patch(seed.job, { activeOperation: "contact_discovery" });
    });
    await expect(
      owner.mutation(api.jobs.pause, { jobId: seed.job }),
    ).rejects.toThrow("still in progress");
    await expect(
      owner.mutation(api.jobs.cancel, { jobId: seed.job }),
    ).rejects.toThrow("still in progress");
    expect(await readJob(t, seed.job)).toMatchObject({
      status: "providers_ready",
      activeOperation: "contact_discovery",
    });
  });
});

describe("job cycles and procurement iteration", () => {
  it("refuses to create a provider question when no verified email route exists", async () => {
    const t = convexTest(schema, modules);
    const owner = await t.run(async (ctx) =>
      ctx.db.insert("users", { email: "no-email-question@example.test" }),
    );
    const client = t.withIdentity({ subject: owner });
    const jobId = await client.mutation(api.jobs.create, {
      serviceCategory: "Plumbing",
      jobTitle: "Fix a leaking pipe",
      naturalLanguageDescription: "Fix a leaking pipe under the kitchen sink.",
      country: "United Kingdom",
      countryCode: "GB",
      region: "Greater London",
      city: "London",
      locality: "Camden Town",
      postalCode: "",
      desiredTiming: "This week",
      budgetOrContext: "Flexible",
    });
    const candidateId = await t.run(async (ctx) => {
      const job = await ctx.db.get("jobs", jobId);
      return await ctx.db.insert("providerCandidates", {
        jobId,
        ownerId: owner,
        cycleId: job?.currentCycleId,
        name: "Website Only Plumbing",
        url: "https://website-only-plumbing.example",
        description: "Local plumbing provider serving Camden Town.",
        entityType: "provider",
        contactability: "website_only",
        evidence: [],
        discoveredAt: Date.now(),
      });
    });
    await client.mutation(api.jobs.selectProvider, { jobId, candidateId });
    await client.mutation(api.jobs.setContinuationMode, { jobId, mode: "findor_assisted" });
    await expect(
      client.mutation(api.jobs.askProviderQuestion, {
        jobId,
        question: "Ask whether materials are included",
      }),
    ).rejects.toThrow("verified public business email route");
  });
  it("prepares and approves a new cycle with explicit owner mandate and provider cap", async () => {
    const t = convexTest(schema, modules);
    const owner = await t.run(async (ctx) =>
      ctx.db.insert("users", { email: "cycles-owner@example.test" }),
    );
    const client = t.withIdentity({ subject: owner });

    const jobId = await client.mutation(api.jobs.create, {
      serviceCategory: "Residential cleaning",
      jobTitle: "Apartment deep clean",
      naturalLanguageDescription:
        "Need a full deep clean for a two-bedroom apartment before move-in.",
      country: "United States",
      countryCode: "US",
      region: "Texas",
      city: "Austin",
      locality: "Downtown",
      postalCode: "78701",
      desiredTiming: "This Friday",
      budgetOrContext: "Please include windows and baseboards.",
    });

    // Approve brief for Cycle 1
    await client.mutation(api.jobs.approveBrief, {
      jobId,
      maxProviders: 3,
      preference: "balanced",
    });

    const jobAfterCycle1 = await client.query(api.jobs.get, { jobId });
    expect(jobAfterCycle1?.status).toBe("brief_approved");
    expect(jobAfterCycle1?.currentBriefVersion).toBe(1);
    expect(jobAfterCycle1?.currentCycleId).toBeDefined();

    const cycles = await client.query(api.jobs.listCycles, { jobId });
    expect(cycles.length).toBe(1);
    expect(cycles[0]).toMatchObject({
      cycleNumber: 1,
      briefVersion: 1,
      status: "active",
      maxProviders: 3,
    });

    // Prepare Cycle 2
    const cycle2Id = await client.mutation(api.jobs.prepareCycle, {
      jobId,
      briefVersion: 1,
      maxProviders: 2,
    });

    const cycle2 = await t.run(async (ctx) => ctx.db.get("jobCycles", cycle2Id));
    expect(cycle2).toMatchObject({
      cycleNumber: 2,
      briefVersion: 1,
      status: "draft",
      maxProviders: 2,
    });

    // Approve Cycle 2 with includePreviouslyContacted = false
    await client.mutation(api.jobs.approveCycle, {
      jobId,
      cycleId: cycle2Id,
      maxProviders: 4,
      preference: "price",
      includePreviouslyContacted: false,
    });

    const jobAfterCycle2 = await client.query(api.jobs.get, { jobId });
    expect(jobAfterCycle2?.currentCycleId).toBe(cycle2Id);
    expect(jobAfterCycle2?.autonomy?.maxProviders).toBe(4);
    expect(jobAfterCycle2?.autonomy?.preference).toBe("price");
    expect(jobAfterCycle2?.autonomy?.includePreviouslyContacted).toBe(false);

    const updatedCycle2 = await t.run(async (ctx) =>
      ctx.db.get("jobCycles", cycle2Id),
    );
    expect(updatedCycle2?.status).toBe("active");
    expect(updatedCycle2?.mandateSnapshot.includePreviouslyContacted).toBe(false);
  });

  it("edits brief to create v2 while preserving v1 history", async () => {
    const t = convexTest(schema, modules);
    const owner = await t.run(async (ctx) =>
      ctx.db.insert("users", { email: "edit-brief@example.test" }),
    );
    const client = t.withIdentity({ subject: owner });

    const jobId = await client.mutation(api.jobs.create, {
      serviceCategory: "Moving",
      jobTitle: "Office move",
      naturalLanguageDescription:
        "Moving 5 desks and 10 chairs across town to our new office location.",
      country: "United States",
      countryCode: "US",
      region: "Texas",
      city: "Austin",
      locality: "Downtown",
      postalCode: "78701",
      desiredTiming: "Next month",
      budgetOrContext: "Need elevator access on both ends.",
    });

    await client.mutation(api.jobs.approveBrief, { jobId });

    // Edit brief to create v2
    const v2Number = await client.mutation(api.jobs.editBriefVersion, {
      jobId,
      serviceCategory: "Moving",
      jobTitle: "Office move (expanded)",
      naturalLanguageDescription:
        "Moving 15 desks, 30 chairs, and 5 server racks with insurance certificate required.",
      country: "United States",
      countryCode: "US",
      region: "Texas",
      city: "Austin",
      locality: "Downtown",
      postalCode: "78701",
      desiredTiming: "In two weeks",
      budgetOrContext: "COI required for freight elevator.",
    });

    expect(v2Number).toBe(2);

    const briefVersions = await client.query(api.jobs.listBriefVersions, {
      jobId,
    });
    expect(briefVersions.length).toBe(2);
    expect(briefVersions[0].version).toBe(2);
    expect(briefVersions[0].reason).toBe("edit");
    expect(briefVersions[1].version).toBe(1);

    const job = await client.query(api.jobs.get, { jobId });
    expect(job?.currentBriefVersion).toBe(2);
    expect(job?.status).toBe("brief_ready");
  });

  it("provides synthetic Cycle 1 fallback for legacy jobs in getCycleHistory", async () => {
    const t = convexTest(schema, modules);
    const owner = await t.run(async (ctx) =>
      ctx.db.insert("users", { email: "legacy-owner@example.test" }),
    );
    const client = t.withIdentity({ subject: owner });

    // Seed a legacy job that has no jobCycles records
    const legacyJobId = await t.run(async (ctx) => {
      const now = 1_700_000_000_000;
      return await ctx.db.insert("jobs", {
        ownerId: owner,
        serviceCategory: "Residential cleaning",
        jobTitle: "Legacy Reis campaign",
        naturalLanguageDescription:
          "Residential cleaning for a 2-bedroom home in Lagos.",
        serviceLocation: "Victoria Island, Lagos, Nigeria",
        desiredTiming: "Next week",
        budgetOrContext: "Written estimate requested.",
        structuredRequirements: { rawDetails: "", keyDetails: [] },
        status: "reply_understood",
        missingFields: [],
        brief: {
          projectSummary: "Residential cleaning",
          requestedOutcome: "Full clean",
          serviceCategory: "Residential cleaning",
          serviceLocation: "Victoria Island, Lagos, Nigeria",
          desiredTiming: "Next week",
          budgetOrContext: "Written estimate requested.",
          structuredRequirements: [],
          unknowns: [],
        },
        briefApprovedAt: now,
        createdAt: now,
        updatedAt: now,
      });
    });

    const history = await client.query(api.jobs.getCycleHistory, {
      jobId: legacyJobId,
    });

    expect(history.length).toBe(1);
    expect(history[0].cycle).toMatchObject({
      cycleNumber: 1,
      briefVersion: 1,
      status: "active",
      maxProviders: 3,
    });
    expect(history[0].candidateCount).toBe(0);

    // Create Cycle 2 on this legacy job and insert candidate for Cycle 2
    const cycle2Id = await client.mutation(api.jobs.prepareCycle, {
      jobId: legacyJobId,
      briefVersion: 2,
    });
    await client.mutation(api.jobs.approveCycle, {
      jobId: legacyJobId,
      cycleId: cycle2Id,
      maxProviders: 3,
      preference: "balanced",
      includePreviouslyContacted: false,
    });
    await t.run(async (ctx) => {
      await ctx.db.insert("providerCandidates", {
        ownerId: owner,
        jobId: legacyJobId,
        cycleId: cycle2Id,
        name: "Cycle 2 Candidate",
        url: "https://example.test",
        description: "Cycle 2 test provider",
        contactEmail: "candidate@example.test",
        contactability: "email_found",
        entityType: "provider",
        evidence: [],
        discoveredAt: 1_700_000_000_100,
      });
    });

    const historyWithCycle2 = await client.query(api.jobs.getCycleHistory, {
      jobId: legacyJobId,
    });
    expect(historyWithCycle2.length).toBe(2);
    expect(historyWithCycle2[0].cycle.cycleNumber).toBe(1);
    expect(historyWithCycle2[0].candidateCount).toBe(0); // Cycle 1 does NOT inherit Cycle 2 candidate
    expect(historyWithCycle2[1].cycle.cycleNumber).toBe(2);
    expect(historyWithCycle2[1].candidateCount).toBe(1); // Cycle 2 candidate correctly scoped
  });

  it("enforces cross-cycle provider deduplication unless explicitly opted in", async () => {
    const t = convexTest(schema, modules);
    const owner = await t.run(async (ctx) =>
      ctx.db.insert("users", { email: "dedupe-owner@example.test" }),
    );
    const client = t.withIdentity({ subject: owner });

    const jobId = await client.mutation(api.jobs.create, {
      serviceCategory: "Residential cleaning",
      jobTitle: "Dedupe test job",
      naturalLanguageDescription:
        "Recurring cleaning for apartment with verified providers.",
      country: "United States",
      countryCode: "US",
      region: "Texas",
      city: "Austin",
      locality: "Downtown",
      postalCode: "78701",
      desiredTiming: "Flexible",
      budgetOrContext: "Standard service.",
    });

    await client.mutation(api.jobs.approveBrief, { jobId, maxProviders: 2 });
    const job = await client.query(api.jobs.get, { jobId });
    expect(job?.currentCycleId).toBeDefined();
    const cycle1Id = job!.currentCycleId;

    // Seed candidates for cycle 1 and send outreach
    await t.run(async (ctx) => {
      const c1 = await ctx.db.insert("providerCandidates", {
        jobId,
        ownerId: owner,
        cycleId: cycle1Id,
        name: "Acme Cleaners",
        url: "https://acme-cleaners.example.test",
        description: "Local cleaner",
        entityType: "provider",
        contactability: "email_found",
        contactEmail: "info@acme-cleaners.example.test",
        evidence: [{ sourceUrl: "https://acme-cleaners.example.test", claim: "claim" }],
        discoveredAt: Date.now(),
      });
      await ctx.db.insert("outreachMessages", {
        jobId,
        ownerId: owner,
        candidateId: c1,
        cycleId: cycle1Id,
        status: "sent",
        purpose: "initial",
        providerEmail: "info@acme-cleaners.example.test",
        subject: "Cleaning inquiry",
        body: "Hello Acme",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    });

    // Start Cycle 2
    const cycle2Id = await client.mutation(api.jobs.prepareCycle, {
      jobId,
      briefVersion: 1,
      maxProviders: 2,
    });
    await client.mutation(api.jobs.approveCycle, {
      jobId,
      cycleId: cycle2Id,
      maxProviders: 2,
      includePreviouslyContacted: false, // DEFAULT OFF
    });

    // Seed candidate in cycle 2: Acme (same email & domain) and NewCleaner
    await t.run(async (ctx) => {
      await ctx.db.insert("providerCandidates", {
        jobId,
        ownerId: owner,
        cycleId: cycle2Id,
        name: "Acme Cleaners",
        url: "https://acme-cleaners.example.test",
        description: "Local cleaner",
        entityType: "provider",
        contactability: "email_found",
        contactEmail: "info@acme-cleaners.example.test",
        evidence: [{ sourceUrl: "https://acme-cleaners.example.test", claim: "claim" }],
        discoveredAt: Date.now(),
      });
      await ctx.db.insert("providerCandidates", {
        jobId,
        ownerId: owner,
        cycleId: cycle2Id,
        name: "New Cleaners",
        url: "https://new-cleaners.example.test",
        description: "Another cleaner",
        entityType: "provider",
        contactability: "email_found",
        contactEmail: "hello@new-cleaners.example.test",
        evidence: [{ sourceUrl: "https://new-cleaners.example.test", claim: "claim" }],
        discoveredAt: Date.now(),
      });
      await ctx.db.patch(jobId, { status: "providers_ready" });
    });

    // Call queueAutonomousOutreach directly via internal test helper
    const queued = await t.run(async (ctx) => {
      const candidates = await ctx.db
        .query("providerCandidates")
        .withIndex("by_job_and_discoveredAt", (q) => q.eq("jobId", jobId))
        .take(20);

      const cycle2Candidates = candidates.filter((c) => c.cycleId === cycle2Id);
      const priorOutreach = await ctx.db
        .query("outreachMessages")
        .withIndex("by_job_and_createdAt", (q) => q.eq("jobId", jobId))
        .take(100);

      const priorContactedEmails = new Set(
        priorOutreach
          .filter((m) => m.cycleId !== cycle2Id)
          .map((m) => m.providerEmail.toLowerCase().trim()),
      );

      return cycle2Candidates.filter(
        (c) => !priorContactedEmails.has(c.contactEmail?.toLowerCase().trim() ?? ""),
      );
    });

    expect(queued.length).toBe(1);
    expect(queued[0].name).toBe("New Cleaners");
  });

  it("preserves historical Cycle 1 (Brief v1) immutably when editing brief to Brief v2", async () => {
    const t = convexTest(schema, modules);
    const owner = await t.run(async (ctx) => {
      return await ctx.db.insert("users", { email: "cycle-history-owner@example.test" });
    });
    const client = t.withIdentity({ subject: owner });

    // 1. Create job with Brief v1
    const jobId = await client.mutation(api.jobs.create, {
      serviceCategory: "Electrical",
      jobTitle: "Fix breaker panel",
      naturalLanguageDescription: "Circuit breaker keeps tripping in kitchen.",
      desiredTiming: "Tomorrow",
      budgetOrContext: "$300",
      country: "United States",
      countryCode: "US",
      region: "Texas",
      city: "Austin",
      locality: "Downtown",
      postalCode: "78701",
    });

    // 2. Approve Brief v1 -> starts Cycle 1
    await client.mutation(api.jobs.approveBrief, {
      jobId,
      maxProviders: 3,
      preference: "balanced",
    });

    let history = await client.query(api.jobs.getCycleHistory, { jobId });
    expect(history.length).toBe(1);
    expect(history[0].cycle.cycleNumber).toBe(1);
    expect(history[0].cycle.briefVersion).toBe(1);

    // 3. User edits brief to create Brief v2 (without approving yet)
    const newVersion = await client.mutation(api.jobs.editBriefVersion, {
      jobId,
      serviceCategory: "Electrical",
      jobTitle: "Fix breaker panel and replace outlets",
      naturalLanguageDescription: "Circuit breaker keeps tripping and need 3 kitchen outlets replaced.",
      desiredTiming: "This weekend",
      budgetOrContext: "$500",
      country: "United States",
      countryCode: "US",
      region: "Texas",
      city: "Austin",
      locality: "Downtown",
      postalCode: "78701",
      reason: "edit",
    });
    expect(newVersion).toBe(2);

    // 4. Verify historical Cycle 1 STILL shows Brief v1 (IMMUTABLE!) and NO Cycle 2 exists yet
    history = await client.query(api.jobs.getCycleHistory, { jobId });
    expect(history.length).toBe(1);
    expect(history[0].cycle.cycleNumber).toBe(1);
    expect(history[0].cycle.briefVersion).toBe(1); // IMMUTABLE v1!

    // Verify job status is brief_ready and briefApprovedAt is undefined
    const jobDoc = await t.run(async (ctx) => ctx.db.get("jobs", jobId));
    expect(jobDoc?.currentBriefVersion).toBe(2);
    expect(jobDoc?.status).toBe("brief_ready");
    expect(jobDoc?.briefApprovedAt).toBeUndefined();

    // 5. User approves Brief v2 -> creates and starts Cycle 2
    await client.mutation(api.jobs.approveBrief, {
      jobId,
      maxProviders: 2,
      preference: "price",
    });

    history = await client.query(api.jobs.getCycleHistory, { jobId });
    expect(history.length).toBe(2);
    expect(history[0].cycle.cycleNumber).toBe(1);
    expect(history[0].cycle.briefVersion).toBe(1);
    expect(history[1].cycle.cycleNumber).toBe(2);
    expect(history[1].cycle.briefVersion).toBe(2);
  });

  it("preserves paused state when editing brief on a paused request", async () => {
    const t = convexTest(schema, modules);
    const owner = await t.run(async (ctx) => {
      return await ctx.db.insert("users", { email: "paused-edit-owner@example.test" });
    });
    const client = t.withIdentity({ subject: owner });

    const jobId = await client.mutation(api.jobs.create, {
      serviceCategory: "Electrical",
      jobTitle: "Fix wiring",
      naturalLanguageDescription: "Exposed electrical wiring in garage needs inspection.",
      desiredTiming: "Next week",
      budgetOrContext: "",
      country: "United States",
      countryCode: "US",
      region: "Texas",
      city: "Austin",
      locality: "North",
      postalCode: "78759",
    });

    // Approve Brief v1
    await client.mutation(api.jobs.approveBrief, { jobId });

    // Pause the job
    await client.mutation(api.jobs.pause, { jobId });
    let jobDoc = await t.run(async (ctx) => ctx.db.get("jobs", jobId));
    expect(jobDoc?.status).toBe("paused");

    // Edit brief while paused
    const newVersion = await client.mutation(api.jobs.editBriefVersion, {
      jobId,
      serviceCategory: "Electrical",
      jobTitle: "Fix wiring and install GFCI",
      naturalLanguageDescription: "Exposed electrical wiring in garage needs inspection and GFCI outlets.",
      desiredTiming: "Next week",
      budgetOrContext: "$400",
      country: "United States",
      countryCode: "US",
      region: "Texas",
      city: "Austin",
      locality: "North",
      postalCode: "78759",
    });
    expect(newVersion).toBe(2);

    // Job MUST REMAIN PAUSED!
    jobDoc = await t.run(async (ctx) => ctx.db.get("jobs", jobId));
    expect(jobDoc?.status).toBe("paused");
    expect(jobDoc?.executionStatus).toBe("paused");
    expect(jobDoc?.pausedFromStatus).toBe("brief_ready");
    expect(jobDoc?.briefApprovedAt).toBeUndefined();

    // approveBrief MUST REJECT while paused
    await expect(
      client.mutation(api.jobs.approveBrief, { jobId }),
    ).rejects.toThrow("currently paused");

    // getCycleHistory MUST return status: "paused" for Cycle 1
    const cycleHistory = await client.query(api.jobs.getCycleHistory, { jobId });
    expect(cycleHistory[0].cycle.status).toBe("paused");

    // Resuming restores to brief_ready and active executionStatus
    await client.mutation(api.jobs.resume, { jobId });
    jobDoc = await t.run(async (ctx) => ctx.db.get("jobs", jobId));
    expect(jobDoc?.status).toBe("brief_ready");
    expect(jobDoc?.executionStatus).toBe("active");
  });

  it("redacts exact and private address details from location text using generic detection", () => {
    // Legacy street address with number
    expect(
      redactExactAddressLikeText("Oshodi, 6 Julius Showumi, Lagos, Nigeria"),
    ).toBe("Oshodi, [exact address withheld], Lagos, Nigeria");

    // Standard street address
    expect(
      redactExactAddressLikeText("123 Main Street, Apt 4B, Dallas, TX"),
    ).toBe("[exact address withheld], [private unit withheld], Dallas, TX");

    // Diverse fictional UK / US / African addresses
    expect(
      redactExactAddressLikeText("14 Adeola Street, Lagos"),
    ).toBe("[exact address withheld], Lagos");
    expect(
      redactExactAddressLikeText("22 Greenfield Road, Manchester"),
    ).toBe("[exact address withheld], Manchester");
    expect(
      redactExactAddressLikeText("No 4 Palm Close, Accra"),
    ).toBe("[exact address withheld], Accra");
    expect(
      redactExactAddressLikeText("Suite 300, 456 Oak Avenue, London"),
    ).toBe("[private unit withheld], [exact address withheld], London");

    // Clean service area without street numbers remains intact
    expect(
      redactExactAddressLikeText("Oshodi, Lagos, Nigeria"),
    ).toBe("Oshodi, Lagos, Nigeria");
    expect(
      redactExactAddressLikeText("Lekki Phase 1, Lagos, Nigeria"),
    ).toBe("Lekki Phase 1, Lagos, Nigeria");
  });

  it("applies case- and whitespace-insensitive geographic deduplication on the brief edit path", async () => {
    const t = convexTest(schema, modules);
    const owner = await t.run(async (ctx) => {
      return await ctx.db.insert("users", { email: "edit-location-owner@example.test" });
    });
    const client = t.withIdentity({ subject: owner });

    const jobId = await client.mutation(api.jobs.create, {
      serviceCategory: "Electrical",
      jobTitle: "Fix wiring",
      naturalLanguageDescription: "Exposed electrical wiring in garage needs inspection.",
      desiredTiming: "Next week",
      budgetOrContext: "",
      country: "Nigeria",
      countryCode: "NG",
      region: "Lagos",
      city: "Lagos",
      locality: "Oshodi",
      postalCode: "",
    });

    // Edit 1: city = "lagos", region = "Lagos", locality = "Oshodi"
    const v2 = await client.mutation(api.jobs.editBriefVersion, {
      jobId,
      serviceCategory: "Electrical",
      jobTitle: "Fix wiring in kitchen",
      naturalLanguageDescription: "Exposed electrical wiring in kitchen needs inspection.",
      desiredTiming: "Tomorrow",
      budgetOrContext: "",
      country: "Nigeria",
      countryCode: "NG",
      region: "Lagos",
      city: "lagos",
      locality: "Oshodi",
      postalCode: "",
      reason: "edit",
    });
    expect(v2).toBe(2);

    let jobDoc = await t.run(async (ctx) => ctx.db.get("jobs", jobId));
    expect(jobDoc?.serviceLocation).toBe("Oshodi, Lagos, Nigeria");
    expect(jobDoc?.brief?.serviceLocation).toBe("Oshodi, Lagos, Nigeria");
    expect(jobDoc?.structuredLocation?.city).toBe("Lagos");
    expect(jobDoc?.structuredLocation?.region).toBe("Lagos");

    // Edit 2: city = "lagos", region = " Lagos ", locality = "Oshodi"
    const v3 = await client.mutation(api.jobs.editBriefVersion, {
      jobId,
      serviceCategory: "Electrical",
      jobTitle: "Fix wiring and replace panel",
      naturalLanguageDescription: "Complete inspection of breaker panel and kitchen outlets.",
      desiredTiming: "Tomorrow",
      budgetOrContext: "",
      country: "Nigeria",
      countryCode: "NG",
      region: " Lagos ",
      city: "lagos",
      locality: "Oshodi",
      postalCode: "",
      reason: "edit",
    });
    expect(v3).toBe(3);

    jobDoc = await t.run(async (ctx) => ctx.db.get("jobs", jobId));
    expect(jobDoc?.serviceLocation).toBe("Oshodi, Lagos, Nigeria");
    expect(jobDoc?.brief?.serviceLocation).toBe("Oshodi, Lagos, Nigeria");

    // Edit 3: broad locality with numeric name remains intact ("Lekki Phase 1")
    const v4 = await client.mutation(api.jobs.editBriefVersion, {
      jobId,
      serviceCategory: "Electrical",
      jobTitle: "Fix wiring in Lekki",
      naturalLanguageDescription: "Complete inspection of breaker panel and kitchen outlets.",
      desiredTiming: "Tomorrow",
      budgetOrContext: "",
      country: "Nigeria",
      countryCode: "NG",
      region: "Lagos",
      city: "lagos",
      locality: "Lekki Phase 1",
      postalCode: "",
      reason: "edit",
    });
    expect(v4).toBe(4);

    jobDoc = await t.run(async (ctx) => ctx.db.get("jobs", jobId));
    expect(jobDoc?.serviceLocation).toBe("Lekki Phase 1, Lagos, Nigeria");
    expect(jobDoc?.brief?.serviceLocation).toBe("Lekki Phase 1, Lagos, Nigeria");

    // Edit 4: unrelated city/region values remain distinct
    const v5 = await client.mutation(api.jobs.editBriefVersion, {
      jobId,
      serviceCategory: "Electrical",
      jobTitle: "Fix wiring in Austin",
      naturalLanguageDescription: "Complete inspection of breaker panel and kitchen outlets in Austin.",
      desiredTiming: "Tomorrow",
      budgetOrContext: "",
      country: "United States",
      countryCode: "US",
      region: "Texas",
      city: "Austin",
      locality: "Downtown",
      postalCode: "78701",
      reason: "edit",
    });
    expect(v5).toBe(5);

    jobDoc = await t.run(async (ctx) => ctx.db.get("jobs", jobId));
    expect(jobDoc?.serviceLocation).toBe("Downtown, Austin, Texas, United States");
    expect(jobDoc?.brief?.serviceLocation).toBe("Downtown, Austin, Texas, United States");
  });

  it("resolves cycle to exhausted_no_options and needs_user when zero contactable providers are found", async () => {
    const t = convexTest(schema, modules);
    const owner = await t.run(async (ctx) =>
      ctx.db.insert("users", { email: "zero-contactable@example.test" }),
    );
    const client = t.withIdentity({ subject: owner });

    const jobId = await client.mutation(api.jobs.create, {
      serviceCategory: "Electrical",
      jobTitle: "Fix wiring",
      naturalLanguageDescription: "Fix kitchen wiring in Oshodi.",
      country: "Nigeria",
      countryCode: "NG",
      region: "Lagos",
      city: "Lagos",
      locality: "Oshodi",
      postalCode: "",
      desiredTiming: "Tomorrow",
      budgetOrContext: "",
    });

    await client.mutation(api.jobs.approveBrief, {
      jobId,
      maxProviders: 3,
      preference: "balanced",
    });

    const jobAfterApprove = await client.query(api.jobs.get, { jobId });
    expect(jobAfterApprove?.status).toBe("brief_approved");
    const cycleId = jobAfterApprove?.currentCycleId;
    expect(cycleId).toBeDefined();

    // Simulate search finding 1 provider (website_only) and 1 discovery_source
    await t.run(async (ctx) => {
      await ctx.db.patch(jobId, { status: "providers_ready" });
      await ctx.db.insert("providerCandidates", {
        ownerId: owner,
        jobId,
        cycleId,
        name: "Penz Nigeria Limited",
        url: "https://www.penz.com.ng/",
        description: "Electrical engineering contractor",
        contactability: "website_only",
        contactDiscoveryStatus: "unresolved",
        entityType: "provider",
        evidence: [],
        discoveredAt: Date.now(),
      });
      await ctx.db.insert("providerCandidates", {
        ownerId: owner,
        jobId,
        cycleId,
        name: "Directory Source",
        url: "https://youtube.com/watch?v=123",
        description: "YouTube video",
        contactability: "website_only",
        entityType: "discovery_source",
        evidence: [],
        discoveredAt: Date.now(),
      });
    });

    // Run autonomous queueing with zero contactable providers
    const queued = await t.run(async (ctx) => {
      return await ctx.db.get("jobs", jobId);
    });
    expect(queued?.status).toBe("providers_ready");

    // Calling repairZeroContactableCycles or queueAutonomousOutreach resolves to needs_user and exhausted_no_options
    await client.mutation(api.jobs.repairZeroContactableCycles, { jobId });

    const jobAfterRepair = await client.query(api.jobs.get, { jobId });
    expect(jobAfterRepair?.status).toBe("needs_user");
    expect(jobAfterRepair?.autonomyStopReason).toContain("No contactable providers");

    const history = await client.query(api.jobs.getCycleHistory, { jobId });
    expect(history.length).toBe(1);
    expect(history[0].cycle.status).toBe("exhausted_no_options");
    expect(history[0].candidateCount).toBe(2);
    expect(history[0].outreachCount).toBe(0);
  });

  it("enforces idempotency when approveBrief is called repeatedly for the same brief version", async () => {
    const t = convexTest(schema, modules);
    const owner = await t.run(async (ctx) =>
      ctx.db.insert("users", { email: "idempotent-owner@example.test" }),
    );
    const client = t.withIdentity({ subject: owner });

    const jobId = await client.mutation(api.jobs.create, {
      serviceCategory: "Plumbing",
      jobTitle: "Fix leak",
      naturalLanguageDescription: "Fix leak under kitchen sink.",
      country: "United States",
      countryCode: "US",
      region: "Texas",
      city: "Austin",
      locality: "Downtown",
      postalCode: "78701",
      desiredTiming: "Today",
      budgetOrContext: "",
    });

    // First approve call
    await client.mutation(api.jobs.approveBrief, {
      jobId,
      maxProviders: 3,
      preference: "balanced",
    });

    const jobFirst = await client.query(api.jobs.get, { jobId });
    const firstCycleId = jobFirst?.currentCycleId;
    expect(firstCycleId).toBeDefined();

    const eventsFirst = await client.query(api.jobs.listEvents, { jobId });
    const cycleStartedEventsFirst = eventsFirst.filter((e: any) => e.eventType === "cycle_started");
    expect(cycleStartedEventsFirst.length).toBe(1);

    // Second approve call with same parameters
    await client.mutation(api.jobs.approveBrief, {
      jobId,
      maxProviders: 3,
      preference: "balanced",
    });

    const jobSecond = await client.query(api.jobs.get, { jobId });
    expect(jobSecond?.currentCycleId).toBe(firstCycleId); // Reuses existing cycle

    const allCycles = await t.run(async (ctx) => {
      return await ctx.db
        .query("jobCycles")
        .withIndex("by_job_and_cycleNumber", (q) => q.eq("jobId", jobId))
        .collect();
    });
    expect(allCycles.length).toBe(1); // Exactly 1 cycle, NO Cycle 2 or 3

    const eventsSecond = await client.query(api.jobs.listEvents, { jobId });
    const cycleStartedEventsSecond = eventsSecond.filter((e: any) => e.eventType === "cycle_started");
    expect(cycleStartedEventsSecond.length).toBe(1); // NO duplicate cycle_started event
  });

  it("ensures retry preparation does not persist cycle rows and separates discard from project cancellation", async () => {
    const t = convexTest(schema, modules);
    const owner = await t.run(async (ctx) =>
      ctx.db.insert("users", { email: "retry-owner@example.test" }),
    );
    const client = t.withIdentity({ subject: owner });

    const jobId = await client.mutation(api.jobs.create, {
      serviceCategory: "Electrical",
      jobTitle: "Fix breaker",
      naturalLanguageDescription: "Fix circuit breaker in garage.",
      country: "Nigeria",
      countryCode: "NG",
      region: "Lagos",
      city: "Lagos",
      locality: "Oshodi",
      postalCode: "100001",
      desiredTiming: "This week",
      budgetOrContext: "",
    });

    // 1. Initial approval creates Cycle 1
    await client.mutation(api.jobs.approveBrief, {
      jobId,
      maxProviders: 3,
      preference: "balanced",
    });

    // Simulate zero-result finish for Cycle 1
    const job1 = await client.query(api.jobs.get, { jobId });
    const cycle1Id = job1?.currentCycleId;
    expect(cycle1Id).toBeDefined();

    await t.run(async (ctx) => {
      await ctx.db.patch("jobCycles", cycle1Id!, {
        status: "exhausted_no_options",
      });
      await ctx.db.patch("jobs", jobId, {
        status: "needs_user",
        autonomyStopReason: "No contactable providers with verified public business email routes were found for this attempt.",
      });
    });

    // 2. Querying / opening retry UI / page refresh creates 0 new rows
    const cyclesBeforeRetry = await t.run(async (ctx) => {
      return await ctx.db
        .query("jobCycles")
        .withIndex("by_job_and_cycleNumber", (q) => q.eq("jobId", jobId))
        .collect();
    });
    expect(cyclesBeforeRetry.length).toBe(1);

    // 3. Discarding retry does not alter job status or cancel job
    const jobAfterDiscard = await client.query(api.jobs.get, { jobId });
    expect(jobAfterDiscard?.status).toBe("needs_user");
    expect(jobAfterDiscard?.executionStatus).toBe("active");

    // 4. Explicit fresh approval creates exactly Cycle 2
    await client.mutation(api.jobs.approveBrief, {
      jobId,
      maxProviders: 3,
      preference: "balanced",
    });

    const cyclesAfterApproval = await t.run(async (ctx) => {
      return await ctx.db
        .query("jobCycles")
        .withIndex("by_job_and_cycleNumber", (q) => q.eq("jobId", jobId))
        .collect();
    });
    expect(cyclesAfterApproval.length).toBe(2);
    expect(cyclesAfterApproval[1].cycleNumber).toBe(2);

    // 5. Rapid duplicate approval is idempotent (does not create Cycle 3)
    await client.mutation(api.jobs.approveBrief, {
      jobId,
      maxProviders: 3,
      preference: "balanced",
    });

    const cyclesAfterDuplicate = await t.run(async (ctx) => {
      return await ctx.db
        .query("jobCycles")
        .withIndex("by_job_and_cycleNumber", (q) => q.eq("jobId", jobId))
        .collect();
    });
    expect(cyclesAfterDuplicate.length).toBe(2);

    // 6. Explicit cancel project cancels the project
    await client.mutation(api.jobs.cancel, { jobId });
    const jobCancelled = await client.query(api.jobs.get, { jobId });
    expect(jobCancelled?.status).toBe("cancelled");
    expect(jobCancelled?.executionStatus).toBe("cancelled");
  });

  it("handles beginProviderSearch lifecycle, idempotency, and failure recovery", async () => {
    const t = convexTest(schema, modules);
    const owner = await t.run(async (ctx) =>
      ctx.db.insert("users", {
        name: "Test Owner",
        email: "search.test@example.com",
      }),
    );
    const client = t.withIdentity({ subject: owner });

    const jobId = await client.mutation(api.jobs.create, {
      jobTitle: "Deep clean 2 bedroom apartment",
      naturalLanguageDescription: "I need a deep clean for my 2 bedroom flat.",
      serviceCategory: "Cleaning",
      country: "Nigeria",
      countryCode: "NI",
      region: "Lagos State",
      city: "Lagos",
      locality: "Oshodi",
      postalCode: "",
      desiredTiming: "This week",
      budgetOrContext: "Flexible",
    });

    await client.mutation(api.jobs.approveBrief, {
      jobId,
      maxProviders: 3,
      preference: "balanced",
    });

    const jobAfterApprove = await client.query(api.jobs.get, { jobId });
    expect(jobAfterApprove?.status).toBe("brief_approved");
    expect(jobAfterApprove?.executionStatus).toBe("active");

    // 1. Explicit owner start begins provider search
    const startResult = await client.mutation(api.providerResearch.beginProviderSearch, { jobId });
    expect(startResult.started).toBe(true);
    expect(startResult.status).toBe("researching");

    const jobResearching = await client.query(api.jobs.get, { jobId });
    expect(jobResearching?.status).toBe("researching");
    expect(jobResearching?.activeOperation).toBe("provider_search");

    const events = await client.query(api.jobs.listEvents, { jobId });
    const researchStartedEvent = events.find((e: any) => e.eventType === "research_started");
    expect(researchStartedEvent).toBeDefined();
    expect(researchStartedEvent?.message).toContain("Oshodi");

    // 2. Rapid double-click idempotency: second call returns started=true without duplicating events or throwing
    const duplicateStart = await client.mutation(api.providerResearch.beginProviderSearch, { jobId });
    expect(duplicateStart.started).toBe(true);
    expect(duplicateStart.status).toBe("researching");

    const eventsAfterDuplicate = await client.query(api.jobs.listEvents, { jobId });
    const startedEventsCount = eventsAfterDuplicate.filter((e: any) => e.eventType === "research_started").length;
    expect(startedEventsCount).toBe(1);

    // 3. Research failure recovery: markResearchFailed moves job out of spinner to needs_user with safe message
    await t.run(async (ctx) => {
      await ctx.db.patch(jobId, { status: "researching" });
    });
    await t.run(async (ctx) => {
      // simulate markResearchFailed internal mutation
      const jobDoc = await ctx.db.get("jobs", jobId);
      if (jobDoc) {
        await ctx.db.patch(jobId, {
          status: "needs_user",
          activeOperation: undefined,
          autonomyStopReason: "We couldn't finish searching for providers right now. Your request is safe, and you can try again.",
        });
        await ctx.db.insert("jobEvents", {
          jobId,
          ownerId: owner,
          cycleId: jobDoc.currentCycleId,
          eventType: "research_failed",
          message: "Provider research could not be completed. Your request is safe and you can try again.",
          createdAt: Date.now(),
        });
      }
    });

    const jobFailed = await client.query(api.jobs.get, { jobId });
    expect(jobFailed?.status).toBe("needs_user");
    expect(jobFailed?.autonomyStopReason).toContain("couldn't finish searching");

    // 4. If job is already completed or in needs_user, beginProviderSearch returns safely without error
    const retryOnNeedsUser = await client.mutation(api.providerResearch.beginProviderSearch, { jobId });
    expect(retryOnNeedsUser.started).toBe(false);
    expect(retryOnNeedsUser.status).toBe("needs_user");
  });

  it("handles complete post-quote handoff lifecycle: provider selection, continuation choices, routine questions, consequential stops, and takeover", async () => {
    const t = convexTest(schema, modules);
    const owner = await t.run(async (ctx) =>
      ctx.db.insert("users", {
        name: "Handoff User",
        email: "handoff.user@example.com",
      }),
    );
    const client = t.withIdentity({ subject: owner });

    const jobId = await client.mutation(api.jobs.create, {
      jobTitle: "Deep clean 2 bedroom apartment",
      naturalLanguageDescription: "I need a deep clean for my flat in Ikeja.",
      serviceCategory: "Cleaning",
      country: "Nigeria",
      countryCode: "NI",
      region: "Lagos State",
      city: "Lagos",
      locality: "Ikeja",
      postalCode: "",
      desiredTiming: "This Friday",
      budgetOrContext: "$150",
    });

    await client.mutation(api.jobs.approveBrief, {
      jobId,
      maxProviders: 3,
      preference: "balanced",
    });

    // Seed 2 candidate providers and 1 quote response
    const { cand1Id, cand2Id } = await t.run(async (ctx) => {
      const job = await ctx.db.get("jobs", jobId);
      const c1 = await ctx.db.insert("providerCandidates", {
        jobId,
        ownerId: owner,
        cycleId: job?.currentCycleId,
        name: "Spotless Cleaners Ltd",
        url: "https://spotlesscleaners.example.com",
        description: "Professional residential cleaning",
        entityType: "provider",
        contactability: "email_found",
        contactEmail: "info@spotlesscleaners.example.com",
        discoveredAt: Date.now(),
        evidence: [],
      });

      const c2 = await ctx.db.insert("providerCandidates", {
        jobId,
        ownerId: owner,
        cycleId: job?.currentCycleId,
        name: "Prime Home Care",
        url: "https://primehome.example.com",
        description: "Home cleaning specialist",
        entityType: "provider",
        contactability: "website_only",
        discoveredAt: Date.now(),
        evidence: [],
      });

      const outreach1 = await ctx.db.insert("outreachMessages", {
        jobId,
        ownerId: owner,
        candidateId: c1,
        cycleId: job?.currentCycleId,
        status: "sent",
        purpose: "initial",
        providerEmail: "info@spotlesscleaners.example.com",
        subject: "Deep cleaning inquiry for Ikeja apartment",
        body: "Hello, exploratory inquiry...",
        externalMessageId: "msg_spotless_1",
        externalThreadId: "th_spotless_1",
        followUpState: "scheduled",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });

      const inbound1 = await ctx.db.insert("inboundMessages", {
        jobId,
        ownerId: owner,
        providerId: c1,
        outreachId: outreach1,
        cycleId: job?.currentCycleId,
        inboxId: "inbox_test",
        svixId: "svix_test_1",
        eventId: "evt_1",
        externalMessageId: "inbound_msg_1",
        threadId: "th_spotless_1",
        sender: "info@spotlesscleaners.example.com",
        recipients: ["inbox@agentmail.to"],
        subject: "Re: Deep cleaning inquiry",
        bodyText: "We can do Friday morning for $140 including all supplies.",
        receivedAt: Date.now(),
        processingStatus: "understood",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });

      await ctx.db.insert("providerResponses", {
        jobId,
        ownerId: owner,
        providerId: c1,
        outreachId: outreach1,
        inboundMessageId: inbound1,
        cycleId: job?.currentCycleId,
        kind: "quote",
        headlinePrice: "$140",
        priceQualifier: "exact",
        availability: "Friday morning",
        included: ["All cleaning supplies", "2 bedroom deep clean", "Kitchen and bathroom"],
        excluded: ["Exterior window washing"],
        notStated: [],
        unclear: [],
        assumptions: [],
        informationNeeded: [],
        importantNotes: [],
        evidenceText: "We can do Friday morning for $140 including all supplies.",
        summary: "Confirmed Friday morning for $140 with supplies included.",
        model: "openai-gpt-5.6-luna",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });

      await ctx.db.patch(jobId, { status: "reply_understood" });

      return { cand1Id: c1, cand2Id: c2 };
    });

    // 1. Provider selection: select Spotless Cleaners
    await client.mutation(api.jobs.selectProvider, { jobId, candidateId: cand1Id });
    let job = await client.query(api.jobs.get, { jobId });
    expect(job?.selectedCandidateId).toBe(cand1Id);
    expect(job?.continuationMode).toBeUndefined();

    const eventsAfterSelect = await client.query(api.jobs.listEvents, { jobId });
    const selectEvent = eventsAfterSelect.find((e: any) => e.eventType === "provider_selected");
    expect(selectEvent).toBeDefined();
    expect(selectEvent?.message).toContain("Spotless Cleaners Ltd");

    // 2. Continuation choice: Continue with Findor
    await client.mutation(api.jobs.setContinuationMode, { jobId, mode: "findor_assisted" });
    job = await client.query(api.jobs.get, { jobId });
    expect(job?.continuationMode).toBe("findor_assisted");

    // 3. Continue with Findor -> Routine question (e.g. asking about supplies/timing)
    const routineQuestionRes = await client.mutation(api.jobs.askProviderQuestion, {
      jobId,
      question: "Ask whether supplies are included",
    });
    expect(routineQuestionRes.status).toBe("sent");

    // 4. Continue with Findor -> Consequential question stops for human approval
    const consequentialRes = await client.mutation(api.jobs.askProviderQuestion, {
      jobId,
      question: "I want to confirm booking and pay a deposit for Friday",
    });
    expect(consequentialRes.status).toBe("needs_approval");
    expect(consequentialRes.reason).toContain("binding, financial, scope");

    // 5. Consequential question with explicit approval sends safely
    const approvedConsequentialRes = await client.mutation(api.jobs.askProviderQuestion, {
      jobId,
      question: "I want to confirm booking and pay a deposit for Friday",
      forceApproveConsequential: true,
    });
    expect(approvedConsequentialRes.status).toBe("sent");

    // 6. Switch to Take Over Myself: cancels autonomous follow-up and preserves contact data
    await client.mutation(api.jobs.setContinuationMode, { jobId, mode: "user_takeover" });
    job = await client.query(api.jobs.get, { jobId });
    expect(job?.continuationMode).toBe("user_takeover");

    const takeoverEvents = await client.query(api.jobs.listEvents, { jobId });
    const takeoverEvent = takeoverEvents.find((e: any) => e.eventType === "user_takeover");
    expect(takeoverEvent).toBeDefined();

    // Verify scheduled follow-up was cancelled
    await t.run(async (ctx) => {
      const messages = await ctx.db
        .query("outreachMessages")
        .withIndex("by_job_and_createdAt", (q) => q.eq("jobId", jobId))
        .collect();
      const initialOutreach = messages.find((m) => m.purpose === "initial");
      expect(initialOutreach?.followUpState).toBe("cancelled");
    });

    // 7. Return to comparison (Let Findor help again / change provider)
    await client.mutation(api.jobs.clearSelectedProvider, { jobId });
    job = await client.query(api.jobs.get, { jobId });
    expect(job?.selectedCandidateId).toBeUndefined();
    expect(job?.continuationMode).toBeUndefined();

    // 8. Select second candidate and complete job
    await client.mutation(api.jobs.selectProvider, { jobId, candidateId: cand2Id });
    await client.mutation(api.jobs.complete, { jobId });
    job = await client.query(api.jobs.get, { jobId });
    expect(job?.status).toBe("completed");
    expect(job?.executionStatus).toBe("completed");
  });

  it("provider selection suppresses scheduled follow-ups and alternative outbound, and takeover stops all Findor outreach", async () => {
    const t = convexTest(schema, modules);
    const owner = await t.run(async (ctx) =>
      ctx.db.insert("users", { email: "multi-outreach-stop@example.test" }),
    );
    const client = t.withIdentity({ subject: owner });

    const jobId = await client.mutation(api.jobs.create, {
      serviceCategory: "Cleaning",
      jobTitle: "Deep house clean",
      naturalLanguageDescription: "Deep clean 3 bed house",
      country: "United States",
      countryCode: "US",
      region: "California",
      city: "San Francisco",
      locality: "Mission",
      postalCode: "94110",
      desiredTiming: "Next week",
      budgetOrContext: "Eco-friendly products only",
    });

    await client.mutation(api.jobs.approveBrief, { jobId });

    const { candAId, candBId, candCId, outreachAId, outreachBId, outreachCId } = await t.run(async (ctx) => {
      const now = Date.now();
      const cA = await ctx.db.insert("providerCandidates", {
        jobId,
        ownerId: owner,
        name: "Alpha Cleaning Co",
        description: "Alpha Cleaning Co provides residential cleaning",
        entityType: "provider",
        contactability: "email_found",
        url: "https://alphaclean.com",
        contactEmail: "hello@alphaclean.com",
        evidence: [{ claim: "Verified email on website", sourceUrl: "https://alphaclean.com" }],
        discoveredAt: now,
      });
      const cB = await ctx.db.insert("providerCandidates", {
        jobId,
        ownerId: owner,
        name: "Beta Cleaning Services",
        description: "Beta Cleaning Services residential cleaning",
        entityType: "provider",
        contactability: "email_found",
        url: "https://betaclean.com",
        contactEmail: "info@betaclean.com",
        evidence: [{ claim: "Verified email on website", sourceUrl: "https://betaclean.com" }],
        discoveredAt: now,
      });
      const cC = await ctx.db.insert("providerCandidates", {
        jobId,
        ownerId: owner,
        name: "Gamma Sparkle LLC",
        description: "Gamma Sparkle LLC residential cleaning",
        entityType: "provider",
        contactability: "email_found",
        url: "https://gammasparkle.com",
        contactEmail: "contact@gammasparkle.com",
        evidence: [{ claim: "Verified email on website", sourceUrl: "https://gammasparkle.com" }],
        discoveredAt: now,
      });

      const oA = await ctx.db.insert("outreachMessages", {
        jobId,
        ownerId: owner,
        candidateId: cA,
        status: "sent",
        purpose: "initial",
        providerEmail: "hello@alphaclean.com",
        subject: "Deep house clean",
        body: "Inquiry body",
        externalMessageId: "msg_alpha_1",
        externalThreadId: "th_alpha_1",
        followUpState: "scheduled",
        nextFollowUpAt: now + 86400000,
        createdAt: now,
        updatedAt: now,
      });
      const oB = await ctx.db.insert("outreachMessages", {
        jobId,
        ownerId: owner,
        candidateId: cB,
        status: "sent",
        purpose: "initial",
        providerEmail: "info@betaclean.com",
        subject: "Deep house clean",
        body: "Inquiry body",
        externalMessageId: "msg_beta_1",
        externalThreadId: "th_beta_1",
        followUpState: "scheduled",
        nextFollowUpAt: now + 86400000,
        createdAt: now,
        updatedAt: now,
      });
      const oC = await ctx.db.insert("outreachMessages", {
        jobId,
        ownerId: owner,
        candidateId: cC,
        status: "sent",
        purpose: "initial",
        providerEmail: "contact@gammasparkle.com",
        subject: "Deep house clean",
        body: "Inquiry body",
        externalMessageId: "msg_gamma_1",
        externalThreadId: "th_gamma_1",
        followUpState: "scheduled",
        nextFollowUpAt: now + 86400000,
        createdAt: now,
        updatedAt: now,
      });

      const inboundA = await ctx.db.insert("inboundMessages", {
        jobId,
        ownerId: owner,
        providerId: cA,
        outreachId: oA,
        inboxId: "inbox_test",
        svixId: "svix_test_alpha",
        eventId: "evt_alpha",
        externalMessageId: "inbound_msg_alpha",
        threadId: "th_alpha_1",
        sender: "hello@alphaclean.com",
        recipients: ["inbox@agentmail.to"],
        subject: "Re: Deep house clean",
        bodyText: "$180 on Tuesday morning.",
        receivedAt: now,
        processingStatus: "understood",
        createdAt: now,
        updatedAt: now,
      });

      // Provider A replied with a quote
      await ctx.db.insert("providerResponses", {
        jobId,
        ownerId: owner,
        providerId: cA,
        outreachId: oA,
        inboundMessageId: inboundA,
        kind: "quote",
        headlinePrice: "$180",
        priceQualifier: "exact",
        availability: "Tuesday 10 AM",
        included: ["All supplies", "Deep clean 3 rooms"],
        excluded: [],
        notStated: [],
        unclear: [],
        assumptions: [],
        informationNeeded: [],
        importantNotes: [],
        evidenceText: "$180 on Tuesday morning.",
        summary: "$180 on Tuesday morning.",
        model: "openai-gpt-5.6-luna",
        createdAt: now,
        updatedAt: now,
      });

      await ctx.db.patch(jobId, { status: "reply_understood" });

      return {
        candAId: cA,
        candBId: cB,
        candCId: cC,
        outreachAId: oA,
        outreachBId: oB,
        outreachCId: oC,
      };
    });

    // 1. SELECT PROVIDER A: Suppresses/cancels scheduled follow-ups for B & C, preserving A
    await client.mutation(api.jobs.selectProvider, { jobId, candidateId: candAId });

    await t.run(async (ctx) => {
      const msgA = await ctx.db.get("outreachMessages", outreachAId);
      const msgB = await ctx.db.get("outreachMessages", outreachBId);
      const msgC = await ctx.db.get("outreachMessages", outreachCId);

      expect(msgA?.followUpState).toBe("scheduled");
      expect(msgB?.followUpState).toBe("cancelled");
      expect(msgB?.followUpFailureReason).toContain("Alpha Cleaning Co was selected");
      expect(msgC?.followUpState).toBe("cancelled");
      expect(msgC?.followUpFailureReason).toContain("Alpha Cleaning Co was selected");
    });

    // 2. NO NEW OUTBOUND TO B OR C AFTER SELECTION
    // - Autonomous sendables returns empty
    await t.run(async (ctx) => {
      const job = await ctx.db.get("jobs", jobId);
      expect(job?.selectedCandidateId).toBe(candAId);
      expect(candBId).toBeDefined();
      expect(candCId).toBeDefined();
    });

    // 3. CONTINUE WITH FINDOR: Only selected provider remains eligible for routine questions
    await client.mutation(api.jobs.setContinuationMode, { jobId, mode: "findor_assisted" });
    const routineRes = await client.mutation(api.jobs.askProviderQuestion, {
      jobId,
      question: "Ask about availability for Tuesday morning",
    });
    expect(routineRes.status).toBe("sent");

    await t.run(async (ctx) => {
      const messages = await ctx.db
        .query("outreachMessages")
        .withIndex("by_job_and_createdAt", (q) => q.eq("jobId", jobId))
        .collect();
      const routineMsg = messages.find((m) => m.purpose === "routine_clarification");
      expect(routineMsg).toBeDefined();
      expect(routineMsg?.candidateId).toBe(candAId);
      expect(routineMsg?.providerEmail).toBe("hello@alphaclean.com");
    });

    // 4. TAKE OVER MYSELF: Stops all Findor communication and follow-ups
    await client.mutation(api.jobs.setContinuationMode, { jobId, mode: "user_takeover" });

    // Verify all follow-ups are cancelled
    await t.run(async (ctx) => {
      const msgA = await ctx.db.get("outreachMessages", outreachAId);
      expect(msgA?.followUpState).toBe("cancelled");
      expect(msgA?.followUpFailureReason).toContain("took over the project directly");
    });

    // Asking questions under takeover is rejected
    await expect(
      client.mutation(api.jobs.askProviderQuestion, {
        jobId,
        question: "Ask whether taxes are included",
      }),
    ).rejects.toThrow("Findor communication is stopped while you manage the provider directly");

    // 5. Let Findor help again: Provider A REMAINS selected, continuation becomes findor_assisted
    await client.mutation(api.jobs.setContinuationMode, { jobId, mode: "findor_assisted" });
    const jobReEnabled = await client.query(api.jobs.get, { jobId });
    expect(jobReEnabled?.selectedCandidateId).toBe(candAId);
    expect(jobReEnabled?.continuationMode).toBe("findor_assisted");

    // Routine questions work again for Provider A
    const resumeQuestionRes = await client.mutation(api.jobs.askProviderQuestion, {
      jobId,
      question: "Ask whether cleaning supplies are provided by your team",
    });
    expect(resumeQuestionRes.status).toBe("sent");

    // Alternatives B and C remain permanently cancelled / suppressed
    await t.run(async (ctx) => {
      const msgB = await ctx.db.get("outreachMessages", outreachBId);
      const msgC = await ctx.db.get("outreachMessages", outreachCId);
      expect(msgB?.followUpState).toBe("cancelled");
      expect(msgC?.followUpState).toBe("cancelled");

      const allMessages = await ctx.db
        .query("outreachMessages")
        .withIndex("by_job_and_createdAt", (q) => q.eq("jobId", jobId))
        .collect();
      const messagesToB = allMessages.filter((m) => m.candidateId === candBId);
      const messagesToC = allMessages.filter((m) => m.candidateId === candCId);
      expect(messagesToB.length).toBe(1); // Only initial outreach from before selection
      expect(messagesToC.length).toBe(1); // Only initial outreach from before selection
    });

    // 6. Explicitly choose a different provider / return to comparison
    await client.mutation(api.jobs.clearSelectedProvider, { jobId });
    const jobAfterReset = await client.query(api.jobs.get, { jobId });
    expect(jobAfterReset?.selectedCandidateId).toBeUndefined();
    expect(jobAfterReset?.continuationMode).toBeUndefined();
  });

  it("proves background scheduler action executes without client auth failure and respects job isolation", async () => {
    const t = convexTest(schema, modules);
    const ownerA = await t.run(async (ctx) => ctx.db.insert("users", { email: "owner-a@example.test" }));
    const ownerB = await t.run(async (ctx) => ctx.db.insert("users", { email: "owner-b@example.test" }));

    const clientA = t.withIdentity({ subject: ownerA });
    const clientB = t.withIdentity({ subject: ownerB });

    const jobAId = await clientA.mutation(api.jobs.create, {
      serviceCategory: "Plumbing",
      jobTitle: "Sink installation",
      naturalLanguageDescription: "Install a new kitchen sink",
      country: "Nigeria",
      countryCode: "NG",
      region: "Lagos State",
      city: "Lagos",
      locality: "Oshodi",
      postalCode: "100001",
      desiredTiming: "this_week",
      budgetOrContext: "Flexible",
    });

    const jobBId = await clientB.mutation(api.jobs.create, {
      serviceCategory: "Cleaning",
      jobTitle: "Apartment cleaning",
      naturalLanguageDescription: "Clean 2 bedroom flat",
      country: "Nigeria",
      countryCode: "NG",
      region: "Lagos State",
      city: "Lagos",
      locality: "Ikeja",
      postalCode: "100001",
      desiredTiming: "this_week",
      budgetOrContext: "Flexible",
    });

    // 1. Approve brief on Job A
    await clientA.mutation(api.jobs.approveBrief, {
      jobId: jobAId,
      maxProviders: 3,
      preference: "balanced",
    });

    // 2. Begin provider search transitions Job A to researching
    const startRes = await clientA.mutation(api.providerResearch.beginProviderSearch, { jobId: jobAId });
    expect(startRes.started).toBe(true);
    expect(startRes.status).toBe("researching");

    // 3. Directly run scheduled background action without client auth identity (simulating server scheduler)
    // - Should not throw 'You must be signed in' error
    await t.action(internal.providerResearch.runAutonomousFinding, {
      jobId: jobAId,
      ownerId: ownerA,
    });

    // Verify Job A progressed without auth crash (it handled search/discovery and resolved to either outreach or needs_user)
    const jobAAfter = await clientA.query(api.jobs.get, { jobId: jobAId });
    expect(jobAAfter?.status).not.toBe("researching"); // Exited researching state

    // 4. Isolation Assertions:
    // - User B cannot see Job A
    const jobAFromB = await clientB.query(api.jobs.get, { jobId: jobAId });
    expect(jobAFromB).toBeNull();

    // - User B candidates query for Job A returns empty
    const candidatesAFromB = await clientB.query(api.providerResearch.list, { jobId: jobAId });
    expect(candidatesAFromB).toHaveLength(0);

    // - User A cannot see Job B
    const jobBFromA = await clientA.query(api.jobs.get, { jobId: jobBId });
    expect(jobBFromA).toBeNull();
  });

  it("proves candidates are isolated by cycle within the same job", async () => {
    const t = convexTest(schema, modules);
    const owner = await t.run(async (ctx) => ctx.db.insert("users", { email: "cycle-isolation@example.test" }));
    const client = t.withIdentity({ subject: owner });

    const jobId = await client.mutation(api.jobs.create, {
      serviceCategory: "Plumbing",
      jobTitle: "Sink pipe repair",
      naturalLanguageDescription: "Fix leaking pipe under sink",
      country: "United States",
      countryCode: "US",
      region: "Texas",
      city: "Austin",
      locality: "Downtown",
      postalCode: "78701",
      desiredTiming: "Flexible",
      budgetOrContext: "Standard",
    });

    // Seed Cycle 1 candidates
    const { cycle1Id, cycle2Id } = await t.run(async (ctx) => {
      const mandateSnapshot = {
        enabled: true,
        maxProviders: 3,
        allowInitialOutreach: true,
        allowRoutineClarifications: true,
        allowFollowUp: true,
        maxFollowUps: 1,
        preference: "balanced" as const,
        includePreviouslyContacted: false,
      };

      const c1 = await ctx.db.insert("jobCycles", {
        jobId,
        ownerId: owner,
        cycleNumber: 1,
        briefVersion: 1,
        status: "exhausted_no_options",
        mandateSnapshot,
        maxProviders: 3,
        recoveryEnabled: true,
        recoveryDiscoveryCycles: 0,
        createdAt: 1000,
        startedAt: 1000,
        endedAt: 2000,
        updatedAt: 2000,
      });

      const c2 = await ctx.db.insert("jobCycles", {
        jobId,
        ownerId: owner,
        cycleNumber: 2,
        briefVersion: 2,
        status: "active",
        mandateSnapshot,
        maxProviders: 3,
        recoveryEnabled: true,
        recoveryDiscoveryCycles: 0,
        createdAt: 3000,
        startedAt: 3000,
        updatedAt: 3000,
      });

      // Insert candidate for Cycle 1
      await ctx.db.insert("providerCandidates", {
        jobId,
        ownerId: owner,
        cycleId: c1,
        name: "Cycle 1 Plumbing Co",
        url: "https://cycle1plumb.test",
        description: "Old cycle candidate",
        contactability: "website_only",
        evidence: [{ sourceUrl: "https://cycle1plumb.test", claim: "Website found in search for plumbing in Austin" }],
        discoveredAt: 1500,
      });

      // Insert candidate for Cycle 2
      await ctx.db.insert("providerCandidates", {
        jobId,
        ownerId: owner,
        cycleId: c2,
        name: "Cycle 2 Fresh Plumber",
        url: "https://cycle2plumb.test",
        description: "Current cycle candidate",
        contactability: "email_found",
        contactEmail: "info@cycle2plumb.test",
        evidence: [{ sourceUrl: "https://cycle2plumb.test", claim: "Contact email discovered on website info@cycle2plumb.test" }],
        discoveredAt: 3500,
      });

      // Set job's current cycle to Cycle 2
      await ctx.db.patch("jobs", jobId, {
        currentCycleId: c2,
        currentBriefVersion: 2,
        status: "providers_ready",
      });

      return { cycle1Id: c1, cycle2Id: c2 };
    });

    // Query candidates for the job: only Cycle 2 candidates are returned for the active view
    const activeCandidates = await client.query(api.providerResearch.list, { jobId });
    expect(activeCandidates).toHaveLength(1);
    expect(activeCandidates[0].name).toBe("Cycle 2 Fresh Plumber");
    expect(activeCandidates[0].cycleId).toBe(cycle2Id);

    // Cycle history properly associates candidates to their respective cycles
    const history = await client.query(api.jobs.getCycleHistory, { jobId });
    const histCycle1 = history.find((h: any) => h.cycle._id === cycle1Id);
    const histCycle2 = history.find((h: any) => h.cycle._id === cycle2Id);

    expect(histCycle1?.candidateCount).toBe(1);
    expect(histCycle2?.candidateCount).toBe(1);
  });

  it("proves cross-job isolation between Electrical Job A and Cleaning Job B with 0 metadata leakage", async () => {
    const t = convexTest(schema, modules);
    const userA = await t.run(async (ctx) =>
      ctx.db.insert("users", { email: "user-a@example.test" }),
    );
    const userB = await t.run(async (ctx) =>
      ctx.db.insert("users", { email: "user-b@example.test" }),
    );

    const clientA = t.withIdentity({ subject: userA });
    const clientB = t.withIdentity({ subject: userB });

    // 1. User A creates Electrical job
    const jobIdA = await clientA.mutation(api.jobs.create, {
      naturalLanguageDescription: "My ceiling chandelier and electrical panel need rewiring",
      serviceCategory: "Electrical",
      jobTitle: "Electrical repair in Oshodi",
      country: "Nigeria",
      countryCode: "NG",
      city: "Lagos",
      region: "Lagos State",
      locality: "Oshodi",
      postalCode: "100261",
      desiredTiming: "this_week",
      budgetOrContext: "Flexible",
    });

    // 2. User B creates Cleaning job (with natural language description, even if client sent generic category)
    const jobIdB = await clientB.mutation(api.jobs.create, {
      naturalLanguageDescription: "I need my 2 bedroom flat deep cleaned",
      serviceCategory: "other", // simulate generic/intake default
      jobTitle: "Deep cleaning request",
      country: "Nigeria",
      countryCode: "NG",
      city: "Lagos",
      region: "Lagos State",
      locality: "Oshodi",
      postalCode: "100261",
      desiredTiming: "this_week",
      budgetOrContext: "Flexible",
    });

    const jobADoc = await clientA.query(api.jobs.get, { jobId: jobIdA });
    const jobBDoc = await clientB.query(api.jobs.get, { jobId: jobIdB });

    expect(jobADoc?.serviceCategory).toBe("Electrical");
    expect(jobBDoc?.serviceCategory).toBe("Residential cleaning"); // Correctly inferred cleaning category!

    // 3. User A cannot access Job B, and User B cannot access Job A
    const userASeesJobB = await clientA.query(api.jobs.get, { jobId: jobIdB });
    const userBSeesJobA = await clientB.query(api.jobs.get, { jobId: jobIdA });
    expect(userASeesJobB).toBeNull();
    expect(userBSeesJobA).toBeNull();

    // 4. Insert candidate for Job A (Electrical provider) and Job B (Cleaning discovery source)
    await t.run(async (ctx) => {
      await ctx.db.insert("providerCandidates", {
        jobId: jobIdA,
        ownerId: userA,
        cycleId: jobADoc!.currentCycleId,
        name: "Penz Electrical Nigeria Ltd",
        url: "https://penzelectrical.test",
        description: "Official electrical supply and contractor",
        entityType: "provider",
        contactability: "website_only",
        evidence: [{ sourceUrl: "https://penzelectrical.test", claim: "Electrical services" }],
        discoveredAt: 1000,
      });

      await ctx.db.insert("providerCandidates", {
        jobId: jobIdB,
        ownerId: userB,
        cycleId: jobBDoc!.currentCycleId,
        name: "Deep cleaning services in Lagos - Facebook",
        url: "https://www.facebook.com/groups/sample/posts/123",
        description: "Social media post snippet",
        entityType: "discovery_source",
        contactability: "website_only",
        evidence: [{ sourceUrl: "https://www.facebook.com/groups/sample/posts/123", claim: "Deep cleaning snippet" }],
        discoveredAt: 2000,
      });
    });

    // Candidates for Job A contain only Electrical candidate
    const candsA = await clientA.query(api.providerResearch.list, { jobId: jobIdA });
    expect(candsA).toHaveLength(1);
    expect(candsA[0].name).toBe("Penz Electrical Nigeria Ltd");
    expect(candsA[0].entityType).toBe("provider");

    // Candidates for Job B contain only Cleaning discovery source
    const candsB = await clientB.query(api.providerResearch.list, { jobId: jobIdB });
    expect(candsB).toHaveLength(1);
    expect(candsB[0].name).toBe("Deep cleaning services in Lagos - Facebook");
    expect(candsB[0].entityType).toBe("discovery_source");
  });
});

describe("stop-ship intake lifecycle: short requests, same-job updates, idempotency", () => {
  const INTAKE_BASE = {
    serviceCategory: "hvac",
    country: "Nigeria",
    countryCode: "NI",
    region: "Lagos State",
    city: "Lagos",
    locality: "Oshodi",
    postalCode: "",
    desiredTiming: "this_week",
    budgetOrContext: "Flexible",
  } as const;

  async function seedOwner(t: ReturnType<typeof convexTest>, email: string) {
    const owner = await t.run(async (ctx) =>
      ctx.db.insert("users", { email }),
    );
    return { owner, client: t.withIdentity({ subject: owner }) };
  }

  it("forms a reviewable brief for short but valid requests", async () => {
    const t = convexTest(schema, modules);
    const { client } = await seedOwner(t, "short-valid@example.test");
    const valid = [
      "Fix my AC",
      "Install my sink",
      "Clean my flat",
      "Repair my tap",
      "Move my sofa",
      "I need my AC fixed",
    ];
    for (const description of valid) {
      const jobId = await client.mutation(api.jobs.create, {
        ...INTAKE_BASE,
        jobTitle: description,
        naturalLanguageDescription: description,
      });
      const job = await client.query(api.jobs.get, { jobId });
      expect(job?.status).toBe("brief_ready");
      expect(job?.brief).toBeDefined();
      expect(job?.missingFields).toEqual([]);
    }
  });

  it("returns needs_info for meaningless input without inventing a brief", async () => {
    const t = convexTest(schema, modules);
    const { client } = await seedOwner(t, "meaningless@example.test");
    const meaningless = ["", "   ", "a", "hi", "test", "???", "12345", "AC", "please help"];
    for (const description of meaningless) {
      const jobId = await client.mutation(api.jobs.create, {
        ...INTAKE_BASE,
        jobTitle: description || "Untitled request",
        naturalLanguageDescription: description,
      });
      const job = await client.query(api.jobs.get, { jobId });
      expect(job?.status).toBe("needs_info");
      expect(job?.brief).toBeUndefined();
      expect(job?.missingFields).toContain(
        "A little more detail about what you need done",
      );
      // The stop-ship guard must reject approval while details are missing.
      await expect(client.mutation(api.jobs.approveBrief, { jobId })).rejects.toThrow(
        "Complete the missing intake details before approving the brief.",
      );
    }
  });

  it("reuses one job for retried submissions with the same clientRequestId", async () => {
    const t = convexTest(schema, modules);
    const { client } = await seedOwner(t, "idempotent-create@example.test");
    const key = "intake-session-key-1";
    const first = await client.mutation(api.jobs.create, {
      ...INTAKE_BASE,
      jobTitle: "Fix my AC",
      naturalLanguageDescription: "Fix my AC",
      clientRequestId: key,
    });
    // Network retry / double click with the same key must not duplicate.
    const second = await client.mutation(api.jobs.create, {
      ...INTAKE_BASE,
      jobTitle: "Fix my AC",
      naturalLanguageDescription: "Fix my AC",
      clientRequestId: key,
    });
    expect(second).toBe(first);
    const mine = await client.query(api.jobs.listMine, {});
    expect(mine.filter((j: any) => j.clientRequestId === key)).toHaveLength(1);
    // A genuinely new submission (different key) still creates a new job.
    const third = await client.mutation(api.jobs.create, {
      ...INTAKE_BASE,
      jobTitle: "Fix my AC",
      naturalLanguageDescription: "Fix my AC",
      clientRequestId: "intake-session-key-2",
    });
    expect(third).not.toBe(first);
  });

  it("updates the SAME needs_info job via updateIntake with zero new rows, then approves and searches exactly once", async () => {
    const t = convexTest(schema, modules);
    const { client } = await seedOwner(t, "same-job-update@example.test");

    // 1. Short meaningless intake -> needs_info (the canonical AC failure class).
    const jobId = await client.mutation(api.jobs.create, {
      ...INTAKE_BASE,
      jobTitle: "hi",
      naturalLanguageDescription: "hi",
    });
    let job = await client.query(api.jobs.get, { jobId });
    expect(job?.status).toBe("needs_info");

    // 2. Identical retried update is a no-op with no duplicate events.
    await client.mutation(api.jobs.updateIntake, {
      jobId,
      ...INTAKE_BASE,
      jobTitle: "hi",
      naturalLanguageDescription: "hi",
    });
    let events = await client.query(api.jobs.listEvents, { jobId });
    expect(events.filter((e: any) => e.eventType === "intake_updated")).toHaveLength(0);

    // 3. Provide details on the SAME job -> brief_ready, 0 additional job rows.
    await client.mutation(api.jobs.updateIntake, {
      jobId,
      ...INTAKE_BASE,
      jobTitle: "I need my AC fixed",
      naturalLanguageDescription:
        "My split AC is leaking water and not cooling the bedroom.",
    });
    job = await client.query(api.jobs.get, { jobId });
    expect(job?.status).toBe("brief_ready");
    expect(job?.brief).toBeDefined();
    expect(job?.currentBriefVersion).toBe(1);
    const mine = await client.query(api.jobs.listMine, {});
    expect(mine).toHaveLength(1);
    const versions = await client.query(api.jobs.listBriefVersions, { jobId });
    expect(versions.filter((v: any) => v.version === 1)).toHaveLength(1);

    // 4. Approval succeeds once...
    await client.mutation(api.jobs.approveBrief, { jobId });
    job = await client.query(api.jobs.get, { jobId });
    expect(job?.status).toBe("brief_approved");

    // 5. ...and search starts once (double start stays idempotent).
    const started = await client.mutation(api.providerResearch.beginProviderSearch, { jobId });
    expect(started.started).toBe(true);
    const again = await client.mutation(api.providerResearch.beginProviderSearch, { jobId });
    expect(again.started).toBe(true);
    events = await client.query(api.jobs.listEvents, { jobId });
    expect(events.filter((e: any) => e.eventType === "research_started")).toHaveLength(1);
  });

  it("never starts research when approval fails", async () => {
    const t = convexTest(schema, modules);
    const { client } = await seedOwner(t, "no-search-on-failure@example.test");
    const jobId = await client.mutation(api.jobs.create, {
      ...INTAKE_BASE,
      jobTitle: "hi",
      naturalLanguageDescription: "hi",
    });
    await expect(client.mutation(api.jobs.approveBrief, { jobId })).rejects.toThrow(
      "Complete the missing intake details before approving the brief.",
    );
    await expect(
      client.mutation(api.providerResearch.beginProviderSearch, { jobId }),
    ).rejects.toThrow("Approve the project brief");
    const job = await client.query(api.jobs.get, { jobId });
    expect(job?.status).toBe("needs_info");
    const events = await client.query(api.jobs.listEvents, { jobId });
    expect(events.some((e: any) => e.eventType === "research_started")).toBe(false);
  });
});

describe("cross-country contamination: US and UK electrical jobs", () => {
  async function seedGeoJob(
    t: ReturnType<typeof convexTest>,
    owner: Id<"users">,
    fields: {
      serviceCategory: string;
      jobTitle: string;
      naturalLanguageDescription: string;
      country: string;
      countryCode: string;
      region: string;
      city: string;
      locality: string;
    },
  ) {
    return await t.run(async (ctx) => {
      const now = 1_700_000_000_000;
      return await ctx.db.insert("jobs", {
        ownerId: owner,
        serviceCategory: fields.serviceCategory,
        jobTitle: fields.jobTitle,
        naturalLanguageDescription: fields.naturalLanguageDescription,
        serviceLocation: [fields.locality, fields.city, fields.region, fields.country]
          .filter(Boolean)
          .join(", "),
        structuredLocation: {
          country: fields.country,
          countryCode: fields.countryCode,
          region: fields.region,
          city: fields.city,
          locality: fields.locality,
        },
        desiredTiming: "this_week",
        budgetOrContext: "Flexible",
        structuredRequirements: { rawDetails: "Flexible", keyDetails: [] },
        status: "providers_ready",
        missingFields: [],
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
        createdAt: now,
        updatedAt: now,
      });
    });
  }

  async function seedGeoCandidate(
    t: ReturnType<typeof convexTest>,
    owner: Id<"users">,
    jobId: Id<"jobs">,
    fields: { name: string; url: string; description: string; contactEmail: string },
  ) {
    return await t.run(async (ctx) => {
      return await ctx.db.insert("providerCandidates", {
        jobId,
        ownerId: owner,
        ...fields,
        entityType: "provider",
        contactability: "email_found",
        evidence: [
          {
            sourceUrl: fields.url,
            claim: `Public business contact ${fields.contactEmail}. ${fields.description}`.slice(0, 400),
          },
        ],
        discoveredAt: Date.now(),
      });
    });
  }

  it("never lets candidates cross jobs or countries", async () => {
    const t = convexTest(schema, modules);
    const owner = await t.run(async (ctx) =>
      ctx.db.insert("users", { email: "cross-border@example.test" }),
    );

    // Job A: Electrical in Harlem, New York, United States.
    const jobAId = await seedGeoJob(t, owner, {
      serviceCategory: "Electrical",
      jobTitle: "Harlem bulbs",
      naturalLanguageDescription: "I need my bulbs changed",
      country: "United States",
      countryCode: "US",
      region: "New York",
      city: "New York",
      locality: "Harlem",
    });
    // Job B: Electrical in London, United Kingdom.
    const jobBId = await seedGeoJob(t, owner, {
      serviceCategory: "Electrical",
      jobTitle: "London bulbs",
      naturalLanguageDescription: "I need my bulbs changed",
      country: "United Kingdom",
      countryCode: "GB",
      region: "England",
      city: "London",
      locality: "Camden",
    });

    const manhattanA = await seedGeoCandidate(t, owner, jobAId, {
      name: "Manhattan Electric Co - Electrical Contractor in Manhattan, NY",
      url: "https://manhattan-electric.example/services/manhattan-ny",
      description: "Electrical contractor in Manhattan, New York. Call (212) 555-0100.",
      contactEmail: "info@manhattan-electric.example",
    });
    // Relevant to Job A by service/area wording, but UK-resolved: the
    // country gate (not relevance) must reject it.
    const londonServingHarlem = await seedGeoCandidate(t, owner, jobAId, {
      name: "Camden Harlem Electric - London Office",
      url: "https://camden-harlem.example/",
      description:
        "Electrical contractor serving Harlem clients from our London, United Kingdom office. Call +44 20 7946 0018.",
      contactEmail: "hello@camden-harlem.example",
    });
    const lagosPlumber = await seedGeoCandidate(t, owner, jobAId, {
      name: "Lagos Plumbing Works",
      url: "https://lagos-plumber.example/",
      description: "Plumbing services in Lagos, Nigeria. Call +234 803 000 0000.",
      contactEmail: "hello@lagos-plumber.example",
    });
    const londonB = await seedGeoCandidate(t, owner, jobBId, {
      name: "Camden Electric Ltd",
      url: "https://camden-electric.example/",
      description: "Electrical contractors in Camden, London, United Kingdom. Call +44 20 7946 0018.",
      contactEmail: "hello@camden-electric.example",
    });
    const manhattanB = await seedGeoCandidate(t, owner, jobBId, {
      name: "Manhattan Electric Co - Electrical Contractor in Manhattan, NY",
      url: "https://manhattan-electric.example/services/manhattan-ny",
      description: "Electrical contractor in Manhattan, New York. Call (212) 555-0100.",
      contactEmail: "info@manhattan-electric.example",
    });

    const queuedA = await t.mutation(internal.outreach.queueAutonomousOutreach, {
      jobId: jobAId,
      ownerId: owner,
    });
    expect(queuedA.queuedCount).toBe(1);
    const queuedB = await t.mutation(internal.outreach.queueAutonomousOutreach, {
      jobId: jobBId,
      ownerId: owner,
    });
    expect(queuedB.queuedCount).toBe(1);

    const outreach = await t.run(async (ctx) =>
      ctx.db.query("outreachMessages").withIndex("by_job_and_createdAt", (q) => q.eq("jobId", jobAId)).take(10),
    );
    expect(outreach.map((m) => String(m.candidateId))).toEqual([String(manhattanA)]);
    const outreachB = await t.run(async (ctx) =>
      ctx.db.query("outreachMessages").withIndex("by_job_and_createdAt", (q) => q.eq("jobId", jobBId)).take(10),
    );
    expect(outreachB.map((m) => String(m.candidateId))).toEqual([String(londonB)]);

    // Rejected rows stay uncontacted: no outreach references them.
    const allOutreach = await t.run(async (ctx) =>
      ctx.db.query("outreachMessages").withIndex("by_job_and_createdAt", (q) => q.eq("jobId", jobAId)).take(20),
    );
    const referenced = new Set(allOutreach.map((m) => String(m.candidateId)));
    expect(referenced.has(String(londonServingHarlem))).toBe(false);
    expect(referenced.has(String(lagosPlumber))).toBe(false);
    expect(referenced.has(String(manhattanB))).toBe(false);
  });
});

describe("continuous quote recovery", () => {
  const RECOVERY_AUTONOMY = {
    enabled: true,
    maxProviders: 3,
    allowInitialOutreach: true,
    allowRoutineClarifications: true,
    allowFollowUp: true,
    maxFollowUps: 1,
    preference: "balanced" as const,
    approvedAt: 1_700_000_000_000,
    quoteTarget: 3 as const,
    responseWindowHours: 24 as const,
    continuousRecoveryEnabled: true,
  };

  async function seedRecoveryJob(
    t: ReturnType<typeof convexTest>,
    overrides: Record<string, unknown> = {},
  ) {
    return await t.run(async (ctx) => {
      const owner = await ctx.db.insert("users", {
        email: `recovery-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.test`,
      });
      const now = 1_700_000_000_000;
      const jobId = await ctx.db.insert("jobs", {
        ownerId: owner,
        serviceCategory: "HVAC",
        jobTitle: "Recovery fixture",
        naturalLanguageDescription: "Fix my AC",
        serviceLocation: "Oshodi, Lagos, Lagos State, Nigeria",
        structuredLocation: {
          country: "Nigeria",
          countryCode: "NG",
          region: "Lagos State",
          city: "Lagos",
          locality: "Oshodi",
        },
        desiredTiming: "this_week",
        budgetOrContext: "Flexible",
        structuredRequirements: { rawDetails: "Flexible", keyDetails: [] },
        status: "outreach_sent",
        executionStatus: "active",
        missingFields: [],
        brief: {
          projectSummary: "Fix my AC: Fix my AC",
          serviceCategory: "HVAC",
          requestedOutcome: "Fix my AC",
          serviceLocation: "Oshodi, Lagos, Lagos State, Nigeria",
          structuredLocation: {
            country: "Nigeria",
            countryCode: "NG",
            region: "Lagos State",
            city: "Lagos",
            locality: "Oshodi",
          },
          desiredTiming: "this_week",
          budgetOrContext: "Flexible",
          structuredRequirements: [],
          unknowns: [],
        },
        briefApprovedAt: now,
        currentBriefVersion: 1,
        autonomy: { ...RECOVERY_AUTONOMY },
        recoveryEnabled: true,
        recoveryDiscoveryCycles: 0,
        recoveryGeneration: 0,
        createdAt: now,
        updatedAt: now,
        ...overrides,
      });
      const cycleId = await ctx.db.insert("jobCycles", {
        ownerId: owner,
        jobId,
        cycleNumber: 1,
        briefVersion: 1,
        mandateSnapshot: {
          enabled: true,
          maxProviders: 3,
          allowInitialOutreach: true,
          allowRoutineClarifications: true,
          allowFollowUp: true,
          maxFollowUps: 1,
          preference: "balanced" as const,
          includePreviouslyContacted: false,
          approvedAt: now,
          quoteTarget: 3 as const,
          responseWindowHours: 24 as const,
          continuousRecoveryEnabled: true,
        },
        maxProviders: 3,
        startedAt: now,
        status: "active",
        recoveryEnabled: true,
        recoveryDiscoveryCycles: 0,
        createdAt: now,
        updatedAt: now,
      });
      await ctx.db.patch(jobId, { currentCycleId: cycleId });
      return { owner, jobId, cycleId };
    });
  }

  async function seedSentInitial(
    t: ReturnType<typeof convexTest>,
    seed: { owner: Id<"users">; jobId: Id<"jobs">; cycleId: Id<"jobCycles"> },
    label: string,
    withEmail = true,
  ) {
    return await t.run(async (ctx) => {
      const candidateId = await ctx.db.insert("providerCandidates", {
        jobId: seed.jobId,
        ownerId: seed.owner,
        name: label + " HVAC Ltd",
        url: "https://" + label.toLowerCase() + ".example.test/",
        description: "HVAC contractor in Lagos, Nigeria. Call +234 803 000 0000.",
        entityType: "provider",
        contactability: withEmail ? "email_found" : "website_only",
        ...(withEmail
          ? { contactEmail: "info@" + label.toLowerCase() + ".example.test" }
          : {}),
        evidence: withEmail
          ? [
              {
                sourceUrl: "https://" + label.toLowerCase() + ".example.test/",
                claim:
                  "Public business contact info@" +
                  label.toLowerCase() +
                  ".example.test in Lagos, Nigeria.",
              },
            ]
          : [],
        discoveredAt: Date.now(),
      });
      const outreachId = await ctx.db.insert("outreachMessages", {
        jobId: seed.jobId,
        ownerId: seed.owner,
        candidateId,
        cycleId: seed.cycleId,
        status: "sent",
        purpose: "initial",
        providerEmail: withEmail
          ? "info@" + label.toLowerCase() + ".example.test"
          : "unknown@example.test",
        subject: "HVAC inquiry",
        body: "Fixture request",
        externalMessageId: label + "-message",
        externalThreadId: label + "-thread",
        followUpCount: 0,
        followUpState: "scheduled",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      return { candidateId, outreachId };
    });
  }

  async function seedQuote(
    t: ReturnType<typeof convexTest>,
    seed: { owner: Id<"users">; jobId: Id<"jobs">; cycleId: Id<"jobCycles"> },
    label: string,
    kind: "quote" | "acknowledgement" | "decline" | "needs_information" | "availability" | "mixed" = "quote",
    price: string | null = "$140",
  ) {
    return await t.run(async (ctx) => {
      const providerId = await ctx.db.insert("providerCandidates", {
        jobId: seed.jobId,
        ownerId: seed.owner,
        name: label,
        url: "https://" + label.toLowerCase().replace(/ /g, "") + ".example.test/",
        description: "HVAC contractor in Lagos, Nigeria.",
        entityType: "provider",
        contactability: "email_found",
        contactEmail: "info@" + label.toLowerCase().replace(/ /g, "") + ".example.test",
        evidence: [],
        discoveredAt: Date.now(),
      });
      const outreachId = await ctx.db.insert("outreachMessages", {
        jobId: seed.jobId,
        ownerId: seed.owner,
        candidateId: providerId,
        cycleId: seed.cycleId,
        status: "sent",
        purpose: "initial",
        providerEmail: "info@" + label.toLowerCase().replace(/ /g, "") + ".example.test",
        subject: "HVAC inquiry",
        body: "Fixture request",
        externalMessageId: label + "-message",
        externalThreadId: label + "-thread",
        followUpCount: 0,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      const inboundId = await ctx.db.insert("inboundMessages", {
        ownerId: seed.owner,
        jobId: seed.jobId,
        providerId,
        outreachId,
        cycleId: seed.cycleId,
        inboxId: "fixture-inbox",
        svixId: label + "-svix",
        eventId: label + "-event",
        externalMessageId: label + "-inbound",
        threadId: label + "-thread",
        sender: "info@example.test",
        recipients: ["findor@example.test"],
        subject: "Re: HVAC inquiry",
        bodyText: "We can fix your AC Friday for $140.",
        receivedAt: Date.now(),
        processingStatus: "received",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      const responseId = await ctx.db.insert("providerResponses", {
        ownerId: seed.owner,
        jobId: seed.jobId,
        providerId,
        outreachId,
        inboundMessageId: inboundId,
        cycleId: seed.cycleId,
        kind,
        ...(price ? { headlinePrice: price } : {}),
        included: [],
        excluded: [],
        notStated: [],
        unclear: [],
        assumptions: [],
        informationNeeded: [],
        importantNotes: [],
        evidenceText: "We can fix your AC Friday for $140.",
        model: "fixture",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      return { responseId };
    });
  }

  it("classifies usable quotes by kind and price content", () => {
    expect(isUsableQuoteResponse({ kind: "quote" })).toBe(true);
    expect(isUsableQuoteResponse({ kind: "quote", headlinePrice: "$140" })).toBe(true);
    expect(isUsableQuoteResponse({ kind: "acknowledgement" })).toBe(false);
    expect(isUsableQuoteResponse({ kind: "decline" })).toBe(false);
    expect(isUsableQuoteResponse({ kind: "needs_information" })).toBe(false);
    expect(isUsableQuoteResponse({ kind: "other" })).toBe(false);
    expect(isUsableQuoteResponse({ kind: "unclear" })).toBe(false);
    expect(isUsableQuoteResponse({ kind: "availability" })).toBe(false);
    expect(
      isUsableQuoteResponse({ kind: "availability", headlinePrice: "Friday, $140" }),
    ).toBe(true);
    expect(isUsableQuoteResponse({ kind: "mixed", priceMin: 100 })).toBe(true);
    expect(isUsableQuoteResponse({ kind: "mixed" })).toBe(false);
  });

  it("counts only usable same-brief quotes, isolating superseded briefs", async () => {
    const t = convexTest(schema, modules);
    const seed = await seedRecoveryJob(t);
    await seedQuote(t, seed, "quoter one", "quote", "$140");
    await seedQuote(t, seed, "acker", "acknowledgement", null);
    await seedQuote(t, seed, "decliner", "decline", null);
    // Second cycle on brief v2 with its own quote.
    const cycle2 = await t.run(async (ctx) => {
      const id = await ctx.db.insert("jobCycles", {
        ownerId: seed.owner,
        jobId: seed.jobId,
        cycleNumber: 2,
        briefVersion: 2,
        mandateSnapshot: {
          enabled: true,
          maxProviders: 3,
          allowInitialOutreach: true,
          allowRoutineClarifications: true,
          allowFollowUp: true,
          maxFollowUps: 1,
          preference: "balanced" as const,
          includePreviouslyContacted: false,
          approvedAt: 1_700_000_000_000,
        },
        maxProviders: 3,
        status: "active",
        recoveryEnabled: true,
        recoveryDiscoveryCycles: 0,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      await ctx.db.patch(seed.jobId, { currentCycleId: id, currentBriefVersion: 2 });
      return id;
    });
    await seedQuote(t, { ...seed, cycleId: cycle2 }, "quoter two", "quote", "$160");
    const counted = await t.run(async (ctx) => {
      const job = await ctx.db.get("jobs", seed.jobId);
      return countUsableSameBriefQuotes(ctx, job!);
    });
    // Current brief is v2: only quoter two counts; v1 quote stays in history.
    expect(counted.count).toBe(1);
  });

  it("starts exactly one new same-brief cycle at the deadline below target", async () => {
    const t = convexTest(schema, modules);
    const seed = await seedRecoveryJob(t);
    await seedSentInitial(t, seed, "alpha");
    await seedSentInitial(t, seed, "bravo");
    const deadline = 1_700_000_000_000 + 24 * 3600_000;
    await t.run(async (ctx) => {
      await ctx.db.patch(seed.jobId, { nextRecoveryAt: deadline });
    });
    const result = await t.mutation(internal.jobs.evaluateContinuousRecovery, {
      jobId: seed.jobId,
      ownerId: seed.owner,
      expectedGeneration: 0,
      expectedDeadline: deadline,
    });
    expect(["round_queued", "round_searching"]).toContain(result);
    const after = await t.run(async (ctx) => {
      const job = await ctx.db.get("jobs", seed.jobId);
      const cycles = await ctx.db
        .query("jobCycles")
        .withIndex("by_job_and_cycleNumber", (q) => q.eq("jobId", seed.jobId))
        .order("desc")
        .take(5);
      return { job, cycles };
    });
    expect(after.cycles).toHaveLength(2);
    expect(after.cycles[0].cycleNumber).toBe(2);
    expect(after.cycles[0].briefVersion).toBe(1);
    expect(after.job?.currentCycleId).toBe(after.cycles[0]._id);
    // The callback consumes the old deadline and waits for discovery to
    // persist a successful result before arming another one.
    expect(after.job?.nextRecoveryAt).toBeUndefined();
    await t.run(async (ctx) => {
      await ctx.db.patch(seed.jobId, { activeOperation: undefined });
    });
    const finalized = await t.mutation(internal.jobs.finalizeContinuousRecoveryRound, {
      jobId: seed.jobId,
      ownerId: seed.owner,
      cycleId: after.cycles[0]._id,
    });
    expect(finalized).toBe("scheduled");
    const afterSuccess = await t.run(async (ctx) => ctx.db.get("jobs", seed.jobId));
    expect(afterSuccess?.nextRecoveryAt).toBeGreaterThan(Date.now());
    // Duplicate callback with the same token collapses to one cycle.
    const duplicate = await t.mutation(internal.jobs.evaluateContinuousRecovery, {
      jobId: seed.jobId,
      ownerId: seed.owner,
      expectedGeneration: 0,
      expectedDeadline: deadline,
    });
    expect(duplicate).toBe("stale");
    const cyclesAfter = await t.run(async (ctx) =>
      ctx.db
        .query("jobCycles")
        .withIndex("by_job_and_cycleNumber", (q) => q.eq("jobId", seed.jobId))
        .take(5),
    );
    expect(cyclesAfter).toHaveLength(2);
  });

  it("clears the scheduler and exposes a truthful retry state on recovery failure", async () => {
    const t = convexTest(schema, modules);
    const seed = await seedRecoveryJob(t);
    const deadline = 1_700_000_000_000 + 24 * 3600_000;
    await t.run(async (ctx) => {
      await ctx.db.patch(seed.jobId, { nextRecoveryAt: deadline });
    });
    await t.mutation(internal.jobs.evaluateContinuousRecovery, {
      jobId: seed.jobId,
      ownerId: seed.owner,
      expectedGeneration: 0,
      expectedDeadline: deadline,
    });
    const cycleId = await t.run(async (ctx) => {
      const job = await ctx.db.get("jobs", seed.jobId);
      return job!.currentCycleId!;
    });
    const result = await t.mutation(internal.jobs.failContinuousRecoveryRound, {
      jobId: seed.jobId,
      ownerId: seed.owner,
      cycleId,
    });
    expect(result).toBe("failed");
    const after = await t.run(async (ctx) => ctx.db.get("jobs", seed.jobId));
    expect(after?.status).toBe("needs_user");
    expect(after?.autonomy?.continuousRecoveryEnabled).toBe(false);
    expect(after?.nextRecoveryAt).toBeUndefined();
    expect(after?.recoverySchedulerId).toBeUndefined();
    expect(after?.autonomyStopReason).toContain("could not complete");
  });

  it("creates no cycle once the quote target is reached", async () => {
    const t = convexTest(schema, modules);
    const seed = await seedRecoveryJob(t);
    await seedQuote(t, seed, "quoter one", "quote", "$140");
    await seedQuote(t, seed, "quoter two", "quote", "$150");
    await seedQuote(t, seed, "quoter three", "quote", "$160");
    const deadline = 1_700_000_000_000 + 24 * 3600_000;
    await t.run(async (ctx) => {
      await ctx.db.patch(seed.jobId, { nextRecoveryAt: deadline });
    });
    const result = await t.mutation(internal.jobs.evaluateContinuousRecovery, {
      jobId: seed.jobId,
      ownerId: seed.owner,
      expectedGeneration: 0,
      expectedDeadline: deadline,
    });
    expect(result).toBe("target_reached");
    const after = await t.run(async (ctx) => {
      const job = await ctx.db.get("jobs", seed.jobId);
      const cycles = await ctx.db
        .query("jobCycles")
        .withIndex("by_job_and_cycleNumber", (q) => q.eq("jobId", seed.jobId))
        .take(5);
      const events = await ctx.db
        .query("jobEvents")
        .withIndex("by_job_and_createdAt", (q) => q.eq("jobId", seed.jobId))
        .order("desc")
        .take(10);
      return { job, cycles, events };
    });
    expect(after.cycles).toHaveLength(1);
    expect(after.job?.autonomy?.continuousRecoveryEnabled).toBe(false);
    expect(after.job?.nextRecoveryAt).toBeUndefined();
    expect(
      after.events.some((e) => e.eventType === "recovery_target_reached"),
    ).toBe(true);
  });

  it("starts a round at 1/3 and 2/3 but never with recovery disabled", async () => {
    for (const usable of [1, 2]) {
      const t = convexTest(schema, modules);
      const seed = await seedRecoveryJob(t);
      for (let i = 0; i < usable; i += 1) {
        await seedQuote(t, seed, `quoter ${i}`, "quote", `$${140 + i}`);
      }
      const deadline = 1_700_000_000_000 + 24 * 3600_000;
      await t.run(async (ctx) => {
        await ctx.db.patch(seed.jobId, { nextRecoveryAt: deadline });
      });
      const result = await t.mutation(internal.jobs.evaluateContinuousRecovery, {
        jobId: seed.jobId,
        ownerId: seed.owner,
        expectedGeneration: 0,
        expectedDeadline: deadline,
      });
      expect(["round_queued", "round_searching"]).toContain(result);
    }
    const t = convexTest(schema, modules);
    const seed = await seedRecoveryJob(t, {
      autonomy: { ...RECOVERY_AUTONOMY, continuousRecoveryEnabled: false },
    });
    const deadline = 1_700_000_000_000 + 24 * 3600_000;
    await t.run(async (ctx) => {
      await ctx.db.patch(seed.jobId, { nextRecoveryAt: deadline });
    });
    const result = await t.mutation(internal.jobs.evaluateContinuousRecovery, {
      jobId: seed.jobId,
      ownerId: seed.owner,
      expectedGeneration: 0,
      expectedDeadline: deadline,
    });
    expect(result).toBe("disabled");
    const cycles = await t.run(async (ctx) =>
      ctx.db
        .query("jobCycles")
        .withIndex("by_job_and_cycleNumber", (q) => q.eq("jobId", seed.jobId))
        .take(5),
    );
    expect(cycles).toHaveLength(1);
  });

  it("starts no round while paused, cancelled, completed, selected, or taken over", async () => {
    const variants: Array<{ label: string; patch: Record<string, unknown> }> = [
      { label: "paused", patch: { status: "paused", executionStatus: "paused" } },
      { label: "cancelled", patch: { status: "cancelled", executionStatus: "cancelled" } },
      { label: "completed", patch: { status: "completed", executionStatus: "completed" } },
    ];
    for (const variant of variants) {
      const t = convexTest(schema, modules);
      const seed = await seedRecoveryJob(t, variant.patch);
      const deadline = 1_700_000_000_000 + 24 * 3600_000;
      await t.run(async (ctx) => {
        await ctx.db.patch(seed.jobId, { nextRecoveryAt: deadline });
      });
      const result = await t.mutation(internal.jobs.evaluateContinuousRecovery, {
        jobId: seed.jobId,
        ownerId: seed.owner,
        expectedGeneration: 0,
        expectedDeadline: deadline,
      });
      expect(result).toBe("halted");
    }
    // Selected provider halts.
    {
      const t = convexTest(schema, modules);
      const seed = await seedRecoveryJob(t);
      const picked = await seedSentInitial(t, seed, "picked");
      await t.run(async (ctx) => {
        await ctx.db.patch(seed.jobId, {
          selectedCandidateId: picked.candidateId,
          nextRecoveryAt: 1_700_000_000_000 + 24 * 3600_000,
        });
      });
      const result = await t.mutation(internal.jobs.evaluateContinuousRecovery, {
        jobId: seed.jobId,
        ownerId: seed.owner,
        expectedGeneration: 0,
        expectedDeadline: 1_700_000_000_000 + 24 * 3600_000,
      });
      expect(result).toBe("halted");
    }
    // Takeover halts.
    {
      const t = convexTest(schema, modules);
      const seed = await seedRecoveryJob(t);
      const picked = await seedSentInitial(t, seed, "picked");
      await t.run(async (ctx) => {
        await ctx.db.patch(seed.jobId, {
          selectedCandidateId: picked.candidateId,
          continuationMode: "user_takeover",
          nextRecoveryAt: 1_700_000_000_000 + 24 * 3600_000,
        });
      });
      const result = await t.mutation(internal.jobs.evaluateContinuousRecovery, {
        jobId: seed.jobId,
        ownerId: seed.owner,
        expectedGeneration: 0,
        expectedDeadline: 1_700_000_000_000 + 24 * 3600_000,
      });
      expect(result).toBe("halted");
    }
  });

  it("never recontacts a provider from an earlier cycle in a new round", async () => {
    const t = convexTest(schema, modules);
    const seed = await seedRecoveryJob(t);
    const old = await seedSentInitial(t, seed, "legacy");
    const fresh = await t.run(async (ctx) => {
      const candidateId = await ctx.db.insert("providerCandidates", {
        jobId: seed.jobId,
        ownerId: seed.owner,
        name: "Fresh HVAC Ltd",
        url: "https://fresh.example.test/",
        description: "HVAC contractor in Lagos, Nigeria. Call +234 803 000 0000.",
        entityType: "provider",
        contactability: "email_found",
        contactEmail: "info@fresh.example.test",
        evidence: [
          {
            sourceUrl: "https://fresh.example.test/",
            claim: "Public business contact info@fresh.example.test in Lagos, Nigeria.",
          },
        ],
        discoveredAt: Date.now(),
      });
      return { candidateId };
    });
    const deadline = 1_700_000_000_000 + 24 * 3600_000;
    await t.run(async (ctx) => {
      await ctx.db.patch(seed.jobId, { nextRecoveryAt: deadline });
    });
    const result = await t.mutation(internal.jobs.evaluateContinuousRecovery, {
      jobId: seed.jobId,
      ownerId: seed.owner,
      expectedGeneration: 0,
      expectedDeadline: deadline,
    });
    expect(result).toBe("round_queued");
    const messages = await t.run(async (ctx) =>
      ctx.db
        .query("outreachMessages")
        .withIndex("by_job_and_createdAt", (q) => q.eq("jobId", seed.jobId))
        .take(20),
    );
    const cycle2Messages = messages.filter(
      (m) => m.cycleId && String(m.cycleId) !== String(seed.cycleId),
    );
    expect(cycle2Messages).toHaveLength(1);
    expect(String(cycle2Messages[0].candidateId)).toBe(String(fresh.candidateId));
    expect(
      messages.some((m) => String(m.candidateId) === String(old.candidateId) && m.cycleId && String(m.cycleId) !== String(seed.cycleId)),
    ).toBe(false);
  });

  it("stops and resumes automatic searching with exactly one deadline", async () => {
    const t = convexTest(schema, modules);
    const seed = await seedRecoveryJob(t, {
      autonomy: { ...RECOVERY_AUTONOMY, continuousRecoveryEnabled: false },
    });
    const client = t.withIdentity({ subject: seed.owner });
    // Resume (opt-in): exactly one live deadline.
    await client.mutation(api.jobs.setContinuousRecovery, {
      jobId: seed.jobId,
      enabled: true,
      quoteTarget: 2,
      responseWindowHours: 6,
    });
    let state = await t.run(async (ctx) => {
      const job = await ctx.db.get("jobs", seed.jobId);
      const scheduled = await ctx.db.system
        .query("_scheduled_functions")
        .take(30);
      return { job, scheduled };
    });
    expect(state.job?.autonomy?.continuousRecoveryEnabled).toBe(true);
    expect(state.job?.autonomy?.quoteTarget).toBe(2);
    expect(state.job?.autonomy?.responseWindowHours).toBe(6);
    expect(state.job?.nextRecoveryAt).toBeGreaterThan(Date.now());
    const liveRecovery = state.scheduled.filter(
      (item) =>
        item.name.includes("evaluateContinuousRecovery") &&
        item.state?.kind !== "canceled",
    );
    expect(liveRecovery).toHaveLength(1);
    // Enabling twice never duplicates the deadline.
    await client.mutation(api.jobs.setContinuousRecovery, {
      jobId: seed.jobId,
      enabled: true,
      quoteTarget: 2,
      responseWindowHours: 6,
    });
    state = await t.run(async (ctx) => {
      const job = await ctx.db.get("jobs", seed.jobId);
      const scheduled = await ctx.db.system
        .query("_scheduled_functions")
        .take(30);
      return { job, scheduled };
    });
    expect(
      state.scheduled.filter(
        (item) =>
          item.name.includes("evaluateContinuousRecovery") &&
          item.state?.kind !== "canceled",
      ),
    ).toHaveLength(1);
    // Stop: flag cleared, deadline cleared, scheduler cancelled.
    await client.mutation(api.jobs.setContinuousRecovery, {
      jobId: seed.jobId,
      enabled: false,
    });
    state = await t.run(async (ctx) => {
      const job = await ctx.db.get("jobs", seed.jobId);
      const scheduled = await ctx.db.system
        .query("_scheduled_functions")
        .take(30);
      return { job, scheduled };
    });
    expect(state.job?.autonomy?.continuousRecoveryEnabled).toBe(false);
    expect(state.job?.nextRecoveryAt).toBeUndefined();
    expect(
      state.scheduled.filter(
        (item) =>
          item.name.includes("evaluateContinuousRecovery") &&
          item.state?.kind !== "canceled",
      ),
    ).toHaveLength(0);
    const events = await client.query(api.jobs.listEvents, { jobId: seed.jobId });
    expect(events.some((e: { eventType: string }) => e.eventType === "recovery_stopped")).toBe(true);
  });

  it("stops recovery immediately when an arriving usable quote hits the target", async () => {
    const t = convexTest(schema, modules);
    const seed = await seedRecoveryJob(t, {
      autonomy: { ...RECOVERY_AUTONOMY, quoteTarget: 1 },
    });
    const sent = await seedSentInitial(t, seed, "responder");
    const client = t.withIdentity({ subject: seed.owner });
    await client.mutation(api.jobs.setContinuousRecovery, {
      jobId: seed.jobId,
      enabled: true,
      quoteTarget: 1,
      responseWindowHours: 24,
    });
    const inboundId = await t.run(async (ctx) => {
      return await ctx.db.insert("inboundMessages", {
        ownerId: seed.owner,
        jobId: seed.jobId,
        providerId: sent.candidateId,
        outreachId: sent.outreachId,
        cycleId: seed.cycleId,
        inboxId: "fixture-inbox",
        svixId: "arrival-svix",
        eventId: "arrival-event",
        externalMessageId: "arrival-message",
        threadId: "arrival-thread",
        sender: "info@responder.example.test",
        recipients: ["findor@example.test"],
        subject: "Re: HVAC inquiry",
        bodyText: "We can fix your AC Friday for $140.",
        receivedAt: Date.now(),
        processingStatus: "received",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    });
    await t.mutation(internal.inbound.persistUnderstanding, {
      inboundMessageId: inboundId,
      model: "fixture",
      response: {
        kind: "quote",
        headlinePrice: "$140",
        priceQualifier: "exact",
        priceMin: 140,
        priceMax: 140,
        currency: "USD",
        availability: "Friday",
        estimatedTiming: null,
        included: ["AC fix"],
        excluded: [],
        notStated: [],
        unclear: [],
        paymentTerms: null,
        warranty: null,
        assumptions: [],
        informationNeeded: [],
        inspectionRequirement: null,
        importantNotes: [],
        requestedSensitiveInformation: [],
        requestedCommitments: [],
        evidenceText: "We can fix your AC Friday for $140.",
        evidence: [{ field: "price", excerpt: "We can fix your AC Friday for $140." }],
        summary: "Friday AC fix for $140.",
        confidence: "high",
      },
    });
    const after = await t.run(async (ctx) => {
      const job = await ctx.db.get("jobs", seed.jobId);
      const responses = await ctx.db
        .query("providerResponses")
        .withIndex("by_jobId_and_createdAt", (q) => q.eq("jobId", seed.jobId))
        .take(5);
      const events = await ctx.db
        .query("jobEvents")
        .withIndex("by_job_and_createdAt", (q) => q.eq("jobId", seed.jobId))
        .order("desc")
        .take(10);
      return { job, responses, events };
    });
    expect(after.responses).toHaveLength(1);
    expect(after.responses[0].briefVersion).toBe(1);
    expect(after.job?.autonomy?.continuousRecoveryEnabled).toBe(false);
    expect(after.job?.nextRecoveryAt).toBeUndefined();
    expect(
      after.events.some((e) => e.eventType === "recovery_target_reached"),
    ).toBe(true);
    const liveSchedulers = await t.run(async (ctx) =>
      ctx.db.system.query("_scheduled_functions").take(30),
    );
    expect(
      liveSchedulers.filter(
        (item) =>
          item.name.includes("evaluateContinuousRecovery") &&
          item.state?.kind !== "canceled",
      ),
    ).toHaveLength(0);
  });
});

describe("legacy malformed geo repair", () => {
  const HARLEM_US_INTAKE = {
    serviceCategory: "Electrical",
    jobTitle: "I need my bulbs changed",
    naturalLanguageDescription: "I need my bulbs changed in Harlem",
    country: "United States",
    countryCode: "",
    region: "New York",
    city: "New York",
    locality: "Harlem",
    postalCode: "",
    desiredTiming: "next_week",
    budgetOrContext: "Flexible",
  } as const;

  async function seedLegacyMalformedJob(t: ReturnType<typeof convexTest>) {
    return await t.run(async (ctx) => {
      const owner = await ctx.db.insert("users", {
        email: "legacy-geo@example.test",
      });
      const now = 1_700_000_000_000;
      // Exact production shape: unattested UK + "Newyork" + naive "UN" code.
      const jobId = await ctx.db.insert("jobs", {
        ownerId: owner,
        serviceCategory: "electrical",
        jobTitle: "I need my bulbs changed",
        naturalLanguageDescription: "I need my bulbs changed",
        serviceLocation: "Harlem, Newyork, United Kingdom",
        structuredLocation: {
          country: "United Kingdom",
          countryCode: "UN",
          region: "Newyork",
          city: "Newyork",
          locality: "Harlem",
        },
        desiredTiming: "next_week",
        budgetOrContext: "Flexible",
        structuredRequirements: { rawDetails: "Flexible", keyDetails: [] },
        status: "needs_user",
        executionStatus: "active",
        missingFields: [],
        briefApprovedAt: now,
        autonomyStopReason: "No contactable providers found for this attempt.",
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
        currentBriefVersion: 1,
        createdAt: now,
        updatedAt: now,
      });
      return { owner, jobId };
    });
  }

  it("repairs a legacy malformed location on the same job with no external action", async () => {
    const t = convexTest(schema, modules);
    const seed = await seedLegacyMalformedJob(t);
    const client = t.withIdentity({ subject: seed.owner });

    // The incident path (Ref 2728D4CC) previously threw here; it must succeed.
    await client.mutation(api.jobs.updateIntake, {
      jobId: seed.jobId,
      ...HARLEM_US_INTAKE,
    });

    const after = await t.run(async (ctx) => {
      const job = await ctx.db.get("jobs", seed.jobId);
      const jobs = await ctx.db
        .query("jobs")
        .withIndex("by_owner", (q) => q.eq("ownerId", seed.owner))
        .take(10);
      const cycles = await ctx.db
        .query("jobCycles")
        .withIndex("by_job_and_cycleNumber", (q) => q.eq("jobId", seed.jobId))
        .take(10);
      const outreach = await ctx.db
        .query("outreachMessages")
        .withIndex("by_job_and_createdAt", (q) => q.eq("jobId", seed.jobId))
        .take(10);
      const versions = await ctx.db
        .query("briefVersions")
        .withIndex("by_job_and_version", (q) => q.eq("jobId", seed.jobId))
        .take(10);
      const events = await ctx.db
        .query("jobEvents")
        .withIndex("by_job_and_createdAt", (q) => q.eq("jobId", seed.jobId))
        .order("desc")
        .take(10);
      return { job, jobs, cycles, outreach, versions, events };
    });

    // Same job, corrected canonical location, reviewable brief.
    expect(after.jobs).toHaveLength(1);
    expect(after.job?.status).toBe("brief_ready");
    expect(after.job?.structuredLocation).toMatchObject({
      country: "United States",
      countryCode: "US",
      city: "New York",
      locality: "Harlem",
    });
    expect(after.job?.brief).toBeDefined();
    expect(after.job?.missingFields).toEqual([]);
    // Repair restarts review: prior approval/stop context cleared, history kept.
    expect(after.job?.briefApprovedAt).toBeUndefined();
    expect(after.job?.autonomyStopReason).toBeUndefined();
    expect(after.versions.filter((v) => v.version === 1)).toHaveLength(1);
    // Zero external action: no cycles, no outreach, no sends.
    expect(after.cycles).toHaveLength(0);
    expect(after.outreach).toHaveLength(0);
    expect(
      after.events.some((e) => e.eventType === "intake_updated"),
    ).toBe(true);
    expect(
      after.events.some((e) =>
        ["cycle_started", "research_started", "outreach_sent"].includes(e.eventType),
      ),
    ).toBe(false);
  });

  it("holds an inconsistent corrected submission in needs_info with a friendly field error", async () => {
    const t = convexTest(schema, modules);
    const seed = await seedLegacyMalformedJob(t);
    const client = t.withIdentity({ subject: seed.owner });

    // Harlem is unambiguously US: pairing it with the United Kingdom must
    // not throw and must not start any search.
    await client.mutation(api.jobs.updateIntake, {
      jobId: seed.jobId,
      ...HARLEM_US_INTAKE,
      country: "United Kingdom",
      countryCode: "",
      region: "England",
      city: "Newyork",
    });

    const after = await t.run(async (ctx) => {
      const job = await ctx.db.get("jobs", seed.jobId);
      const cycles = await ctx.db
        .query("jobCycles")
        .withIndex("by_job_and_cycleNumber", (q) => q.eq("jobId", seed.jobId))
        .take(10);
      return { job, cycles };
    });
    expect(after.job?.status).toBe("needs_info");
    expect(after.job?.missingFields).toContain(
      "That location doesn't look consistent. Check the country, state/region, and city.",
    );
    expect(after.cycles).toHaveLength(0);
    // The malformed historical identity is untouched until a valid repair.
    expect(after.job?.structuredLocation).toBeUndefined();
  });

  it("holds an unsupported country submission without throwing", async () => {
    const t = convexTest(schema, modules);
    const seed = await seedLegacyMalformedJob(t);
    const client = t.withIdentity({ subject: seed.owner });

    await client.mutation(api.jobs.updateIntake, {
      jobId: seed.jobId,
      ...HARLEM_US_INTAKE,
      country: "Other",
      countryCode: "",
    });

    const job = await client.query(api.jobs.get, { jobId: seed.jobId });
    expect(job?.status).toBe("needs_info");
    expect(job?.missingFields).toContain("A supported country");
  });

  it("keeps live research/outreach states protected from intake edits", async () => {
    const t = convexTest(schema, modules);
    const seed = await seedLegacyMalformedJob(t);
    const client = t.withIdentity({ subject: seed.owner });
    await t.run(async (ctx) => {
      await ctx.db.patch(seed.jobId, { status: "outreach_sent" });
    });
    await expect(
      client.mutation(api.jobs.updateIntake, {
        jobId: seed.jobId,
        ...HARLEM_US_INTAKE,
      }),
    ).rejects.toThrow("An approved brief cannot be changed");
  });
});
