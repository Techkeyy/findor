const routineAttributes = [
  "availability",
  "available",
  "timing",
  "schedule",
  "start date",
  "duration",
  "materials",
  "material",
  "supplies",
  "cleaning supplies",
  "disposal",
  "included",
  "excluded",
  "warranty",
  "tax",
  "payment terms",
] as const;

const humanBoundaryTerms = [
  "address",
  "location",
  "scope",
  "price",
  "cost",
  "quote",
  "estimate",
  "deposit",
  "payment",
  "contract",
  "hire",
  "book",
  "booking",
  "accept",
  "negotiate",
  "change",
  "cancel",
  "permission",
  "access",
] as const;

function normalize(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

export function classifyAutonomyQuestion(
  attribute: string,
): "routine" | "needs_user" {
  const value = normalize(attribute);
  if (!value) return "needs_user";
  if (humanBoundaryTerms.some((term) => value.includes(term))) {
    return "needs_user";
  }
  return routineAttributes.some(
    (term) => value === term || value.includes(term),
  )
    ? "routine"
    : "needs_user";
}

export function autonomyStopReason(attribute: string) {
  return (
    "Findor stopped before an automated clarification because \"" +
    attribute.trim() +
    "\" may affect a binding, financial, scope, access, or other human decision."
  );
}

// Centrally defined v1 response windows. They are intentionally not user-editable.
export const INITIAL_RESPONSE_WAIT_MS = 24 * 60 * 60 * 1000;
export const FOLLOW_UP_RESPONSE_WAIT_MS = 24 * 60 * 60 * 1000;
export const FOLLOW_UP_DELAY_MS = INITIAL_RESPONSE_WAIT_MS;
export const MAX_RECOVERY_DISCOVERY_CYCLES = 1;
// Configured discovery budget for continuous quote recovery: at most this
// many Firecrawl discovery rounds per job lifetime. Later rounds still poll
// for late replies and contact already-known eligible providers.
export const MAX_CONTINUOUS_RECOVERY_ROUNDS = 10;
