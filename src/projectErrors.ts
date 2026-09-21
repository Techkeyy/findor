/**
 * Central project-action error normalization layer.
 *
 * Mirrors the auth-only `normalizeAuthError` pattern for every
 * user-triggered project operation (intake, approval, search, controls,
 * provider selection, questions). Converts raw Convex/backend exceptions
 * into calm consumer copy while strictly hiding implementation details.
 *
 * INVARIANT: normalized messages never contain raw backend tokens
 * ([CONVEX ...], Request ID, Server Error, Called by client, function
 * paths, stack frames, or internal database IDs).
 */

export type ProjectAction =
  | "save"
  | "approve"
  | "search"
  | "pause"
  | "resume"
  | "retry"
  | "cancel"
  | "complete"
  | "select"
  | "mode"
  | "question";

export interface NormalizedProjectError {
  message: string;
  referenceId?: string;
}

/**
 * Extracts a neutral support reference from a raw backend message
 * (e.g. Convex Request ID) without leaking server paths or frames.
 */
function extractProjectReferenceId(raw: string): string | undefined {
  const match = /\[Request ID:\s*([a-zA-Z0-9_-]+)\]/i.exec(raw);
  if (match?.[1]) {
    return match[1].slice(0, 8).toUpperCase();
  }
  return undefined;
}

function readRawMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (error && typeof error === "object") {
    const data =
      "data" in error && typeof error.data === "string" ? ` ${error.data}` : "";
    if ("message" in error && typeof error.message === "string") {
      return `${error.message}${data}`;
    }
    try {
      return `${JSON.stringify(error)}${data}`;
    } catch {
      return "";
    }
  }
  return "";
}

/**
 * Normalizes any project-action failure into safe consumer copy.
 * The raw backend message is only used for classification and is never
 * returned to the UI.
 */
export function normalizeProjectError(
  error: unknown,
  _action: ProjectAction = "save",
): NormalizedProjectError {
  const raw = readRawMessage(error);
  const referenceId = extractProjectReferenceId(raw);
  const cleaned = raw.toLowerCase();

  // Session / auth failures.
  if (
    cleaned.includes("signed in") ||
    cleaned.includes("sign in") ||
    cleaned.includes("session") ||
    cleaned.includes("unauthorized") ||
    cleaned.includes("unauthenticated")
  ) {
    return {
      message: "Your session may have expired. Please sign in again and try again.",
      referenceId,
    };
  }

  // Missing intake details / needs_info guard.
  if (
    cleaned.includes("missing intake") ||
    cleaned.includes("missing details") ||
    cleaned.includes("more detail about what you need") ||
    cleaned.includes("missing required fields") ||
    cleaned.includes("needs_info")
  ) {
    return {
      message:
        "A few more project details are needed before Findor can start.",
      referenceId,
    };
  }

  // Paused guard.
  if (
    cleaned.includes("paused") ||
    cleaned.includes("on hold") ||
    cleaned.includes("resume")
  ) {
    return {
      message: "Resume this project before starting another search.",
      referenceId,
    };
  }

  // Stale / changed state (e.g. brief edited while viewing, version drift).
  // Lifecycle locks ("cannot be changed") have their own bucket below.
  if (
    cleaned.includes("changed while") ||
    cleaned.includes("stale") ||
    cleaned.includes("refresh") ||
    cleaned.includes("version")
  ) {
    return {
      message:
        "This project changed while you were viewing it. Refresh and try again.",
      referenceId,
    };
  }

  // Already started / duplicate in-flight work.
  if (
    cleaned.includes("already started") ||
    cleaned.includes("already in progress") ||
    cleaned.includes("still in progress") ||
    cleaned.includes("already been")
  ) {
    return {
      message: "Findor has already started this search.",
      referenceId,
    };
  }

  // Missing / inaccessible project.
  if (
    cleaned.includes("job not found") ||
    cleaned.includes("not found") ||
    cleaned.includes("no longer") ||
    cleaned.includes("removed")
  ) {
    return {
      message:
        "We couldn't find that project. It may have been removed. Please refresh and try again.",
      referenceId,
    };
  }

  // Mandate / approval preconditions (brief review, permissions, decisions).
  if (
    cleaned.includes("mandate") ||
    cleaned.includes("operating mandate") ||
    cleaned.includes("decision is already active") ||
    cleaned.includes("already active")
  ) {
    return {
      message:
        "Review your project brief and permissions, then try again.",
      referenceId,
    };
  }

  // Live projects whose details are locked mid-flow.
  if (cleaned.includes("cannot be changed")) {
    return {
      message:
        "This project has already started. You can't edit the details at this stage.",
      referenceId,
    };
  }

  // Location validation: inconsistent or unsupported service areas.
  if (
    cleaned.includes("supported country") ||
    cleaned.includes("doesn't look consistent") ||
    cleaned.includes("does not look consistent") ||
    cleaned.includes("location consistency")
  ) {
    return {
      message:
        "That location doesn't look consistent. Check the country, state/region, and city.",
      referenceId,
    };
  }

  // Network / transport failures.
  if (
    cleaned.includes("failed to fetch") ||
    cleaned.includes("networkerror") ||
    cleaned.includes("network request failed") ||
    cleaned.includes("load failed") ||
    cleaned.includes("timeout") ||
    cleaned.includes("offline")
  ) {
    return {
      message: "We couldn't reach Findor. Check your connection and try again.",
      referenceId,
    };
  }

  return {
    message:
      "We couldn't complete that action. Your project is safe. Please try again.",
    referenceId,
  };
}

/**
 * Regression invariant: consumer-visible strings must never leak raw
 * backend tokens. Returns true when the string is safe to render.
 */
export function isSafeConsumerString(value: string): boolean {
  const lowered = value.toLowerCase();
  const banned = [
    "[convex",
    "request id",
    "server error",
    "called by client",
    "jobs:",
    "convex/",
    "node_modules",
  ];
  if (banned.some((token) => lowered.includes(token))) return false;
  // JS stack-frame lines ("\n    at ...").
  if (/^\s*at\s+.*$/m.test(value)) return false;
  return true;
}
