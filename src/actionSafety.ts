export const INTAKE_SAVE_TIMEOUT_MS = 15_000;

export const INTAKE_SAVE_TIMEOUT_MESSAGE =
  "We couldn't confirm that your changes were saved. Refresh the project before trying again.";

export class ActionTimeoutError extends Error {
  constructor() {
    super("Action confirmation timed out.");
    this.name = "ActionTimeoutError";
  }
}

/**
 * Bounds the time the UI waits for a mutation result without cancelling the
 * underlying request. The original promise remains observed so a late
 * success/failure cannot become an unhandled rejection or trigger a retry.
 */
export function withActionTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      settled = true;
      reject(new ActionTimeoutError());
    }, timeoutMs);

    promise.then(
      (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}
