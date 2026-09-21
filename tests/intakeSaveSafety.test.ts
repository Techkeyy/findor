import { describe, expect, it, vi } from "vitest";
import {
  ActionTimeoutError,
  INTAKE_SAVE_TIMEOUT_MESSAGE,
  withActionTimeout,
} from "../src/actionSafety";
import { isSafeConsumerString, normalizeProjectError } from "../src/projectErrors";

describe("request-save safety", () => {
  it("waits for a successful mutation and preserves the single invocation", async () => {
    const save = vi.fn(async () => "job_123");

    await expect(withActionTimeout(save(), 100)).resolves.toBe("job_123");
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("clears the waiting boundary on a rejected mutation with safe consumer copy", async () => {
    await expect(
      withActionTimeout(Promise.reject(new Error("That location doesn't look consistent.")), 100),
    ).rejects.toThrow("doesn't look consistent");

    const normalized = normalizeProjectError(
      new Error("That location doesn't look consistent."),
      "save",
    );
    expect(normalized.message).toBe(
      "That location doesn't look consistent. Check the country, state/region, and city.",
    );
    expect(isSafeConsumerString(normalized.message)).toBe(true);
  });

  it("bounds a hung mutation without retrying or creating a second request", async () => {
    vi.useFakeTimers();
    try {
      let resolveSave!: () => void;
      const save = vi.fn(
        () =>
          new Promise<void>((resolve) => {
            resolveSave = resolve;
          }),
      );
      const guarded = withActionTimeout(save(), 25);
      const timeoutAssertion = expect(guarded).rejects.toBeInstanceOf(ActionTimeoutError);

      await vi.advanceTimersByTimeAsync(25);
      await timeoutAssertion;
      expect(save).toHaveBeenCalledTimes(1);

      // A late backend completion is observed but cannot cause a retry or a
      // second mutation call.
      resolveSave();
      await Promise.resolve();
      expect(save).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("uses reconciliation copy for timeout failures without exposing internals", () => {
    expect(INTAKE_SAVE_TIMEOUT_MESSAGE).toBe(
      "We couldn't confirm that your changes were saved. Refresh the project before trying again.",
    );
    expect(isSafeConsumerString(INTAKE_SAVE_TIMEOUT_MESSAGE)).toBe(true);
  });
});
