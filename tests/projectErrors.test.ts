import { describe, expect, it } from "vitest";
import {
  isSafeConsumerString,
  normalizeProjectError,
} from "../src/projectErrors";

const RAW_APPROVE_FAILURE =
  "[CONVEX M(jobs:approveBrief)] [Request ID: be13694e4f23d58a] Server Error: Uncaught Error: Complete the missing intake details before approving the brief.\n    at handler (../convex/jobs.ts:768:8)\n    Called by client";

describe("normalizeProjectError - general project-action layer", () => {
  it("maps the needs_info approval guard to calm consumer copy with a neutral ref", () => {
    const err = normalizeProjectError(new Error(RAW_APPROVE_FAILURE), "approve");
    expect(err.message).toBe(
      "A few more project details are needed before Findor can start.",
    );
    expect(err.referenceId).toBe("BE13694E");
    expect(isSafeConsumerString(err.message)).toBe(true);
  });

  it("maps paused, stale-state, already-started, missing-job, and session failures", () => {
    expect(
      normalizeProjectError(
        new Error("This request is currently paused. Resume before finding providers."),
        "search",
      ).message,
    ).toBe("Resume this project before starting another search.");

    expect(
      normalizeProjectError(
        new Error("An approved brief cannot be changed in this first release."),
        "save",
      ).message,
    ).toBe(
      "This project has already started. You can't edit the details at this stage.",
    );

    expect(
      normalizeProjectError(new Error("Findor has already started this search."), "search")
        .message,
    ).toBe("Findor has already started this search.");

    expect(
      normalizeProjectError(new Error("Job not found."), "pause").message,
    ).toContain("refresh");

    expect(
      normalizeProjectError(new Error("You must be signed in to manage a job."), "approve")
        .message,
    ).toContain("sign in");
  });

  it("falls back to a safe generic message for unknown failures", () => {
    const err = normalizeProjectError(new Error("Something totally unexpected"), "cancel");
    expect(err.message).toBe(
      "We couldn't complete that action. Your project is safe. Please try again.",
    );
    expect(isSafeConsumerString(err.message)).toBe(true);
  });

  it("never leaks raw backend tokens in any normalized message", () => {
    const raws = [
      RAW_APPROVE_FAILURE,
      "[CONVEX M(providerResearch:beginProviderSearch)] [Request ID: abc123] Server Error Called by client",
      "Uncaught Error: Job not found.\n    at handler (../convex/jobs.ts:100:3)",
      "Error: kd7dz13e4hgw449838s9bec5gh8em5zz failed in convex/jobs.ts",
    ];
    for (const raw of raws) {
      const err = normalizeProjectError(new Error(raw), "save");
      expect(isSafeConsumerString(err.message)).toBe(true);
      expect(err.message).not.toContain("CONVEX");
      expect(err.message).not.toContain("Request ID");
      expect(err.message).not.toContain("Called by client");
      expect(err.message).not.toContain("convex/");
      expect(err.message).not.toContain("\n    at ");
    }
  });

  it("maps location validation failures to a friendly consistency message", () => {
    const err = normalizeProjectError(
      new Error("Uncaught Error: That location doesn't look consistent."),
      "save",
    );
    expect(err.message).toBe(
      "That location doesn't look consistent. Check the country, state/region, and city.",
    );
    expect(isSafeConsumerString(err.message)).toBe(true);
  });

  it("maps locked mid-flow edits without leaking backend wording", () => {
    const err = normalizeProjectError(
      new Error(
        "[CONVEX M(jobs:updateIntake)] [Request ID: 2728d4cc0fc6d01f] Server Error: Uncaught Error: An approved brief cannot be changed in this first release.\n    at handler (../convex/jobs.ts:100:3)\nCalled by client",
      ),
      "save",
    );
    expect(err.message).toBe(
      "This project has already started. You can't edit the details at this stage.",
    );
    expect(err.referenceId).toBe("2728D4CC");
    expect(isSafeConsumerString(err.message)).toBe(true);
  });

  it("flags unsafe consumer strings containing backend tokens", () => {
    expect(isSafeConsumerString("We couldn't complete that action.")).toBe(true);
    expect(isSafeConsumerString("[CONVEX M(jobs:approveBrief)] Server Error")).toBe(false);
    expect(isSafeConsumerString("Failed [Request ID: xyz]")).toBe(false);
    expect(isSafeConsumerString("Error in jobs:approveBrief")).toBe(false);
    expect(isSafeConsumerString("Something broke\n    at handler (x.ts:1:1)")).toBe(false);
  });
});
