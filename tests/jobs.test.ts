import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import schema from "../convex/schema";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";

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
