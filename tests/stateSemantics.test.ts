import { describe, expect, it } from "vitest";
import {
  resolveConsumerProjectState,
  resolveNeedsUserOutcome,
} from "../src/projectState";

const currentCycle = "cycle-current" as any;
const previousCycle = "cycle-previous" as any;

function needsUserJob(overrides: Record<string, unknown> = {}) {
  return {
    status: "needs_user" as const,
    currentCycleId: currentCycle,
    ...overrides,
  } as any;
}

function provider(overrides: Record<string, unknown> = {}) {
  return {
    _id: "provider-1" as any,
    cycleId: currentCycle,
    name: "Example Local Provider",
    entityType: "provider" as const,
    contactability: "website_only" as const,
    ...overrides,
  } as any;
}

describe("cycle-scoped consumer outcome semantics", () => {
  it("treats a website-only provider with no outreach as neutral no-contactable state", () => {
    expect(
      resolveNeedsUserOutcome(needsUserJob(), {
        candidates: [provider()],
        outreachMessages: [],
      }),
    ).toBe("website_only");
  });

  it("keeps a verified-email send failure in the failed-outreach state", () => {
    expect(
      resolveNeedsUserOutcome(needsUserJob(), {
        candidates: [
          provider({
            contactability: "email_found",
            contactEmail: "hello@example.test",
          }),
        ],
        outreachMessages: [
          {
            candidateId: "provider-1" as any,
            cycleId: currentCycle,
            purpose: "initial",
            status: "failed",
            providerResolution: "send_failed",
            sendAttemptCount: 1,
          },
        ],
      }),
    ).toBe("failed_outreach");
  });

  it("does not inherit a previous-cycle failed send into a current website-only cycle", () => {
    expect(
      resolveNeedsUserOutcome(needsUserJob(), {
        candidates: [provider()],
        outreachMessages: [
          {
            candidateId: "old-provider" as any,
            cycleId: previousCycle,
            purpose: "initial",
            status: "failed",
            providerResolution: "send_failed",
            sendAttemptCount: 1,
          },
        ],
      }),
    ).toBe("website_only");
  });

  it("treats a cycle with no candidates as zero results", () => {
    expect(
      resolveNeedsUserOutcome(needsUserJob(), {
        candidates: [],
        outreachMessages: [],
      }),
    ).toBe("zero_results");
  });

  it("keeps successful outreach in the contacted/waiting state", () => {
    expect(
      resolveConsumerProjectState(
        { status: "outreach_sent" } as any,
        {
          candidates: [
            provider({
              contactability: "email_found",
              contactEmail: "hello@example.test",
            }),
          ],
          outreachMessages: [
            {
              candidateId: "provider-1" as any,
              cycleId: currentCycle,
              purpose: "initial",
              status: "sent",
            },
          ],
        },
      ),
    ).toBe("waiting_for_replies");
  });

  it("keeps current-cycle state independent when the current cycle has a verified route but no failure", () => {
    expect(
      resolveNeedsUserOutcome(needsUserJob(), {
        candidates: [
          provider({
            contactability: "email_found",
            contactEmail: "current@example.test",
          }),
        ],
        outreachMessages: [
          {
            candidateId: "old-provider" as any,
            cycleId: previousCycle,
            purpose: "initial",
            status: "failed",
            providerResolution: "send_failed",
            sendAttemptCount: 1,
          },
        ],
      }),
    ).toBe("neutral");
  });
});
