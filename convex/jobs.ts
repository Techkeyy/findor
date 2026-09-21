import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import {
  mutation,
  internalMutation,
  query,
  internalQuery,
  QueryCtx,
  MutationCtx,
} from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { MAX_CONTINUOUS_RECOVERY_ROUNDS } from "./autonomy";
import {
  canonicalizeCountry,
  canonicalizeGeographicSegment,
  formatLocationSegments,
  hasSourceBackedPublicBusinessEmail,
  isInconsistentPlaceForCountry,
  isProviderEntity,
} from "./providerQuality";
import { listRecoveryEligibleCandidates } from "./outreach";
import { classifyAutonomyQuestion, autonomyStopReason } from "./autonomy";

const statusValidator = v.union(
  v.literal("needs_info"),
  v.literal("brief_ready"),
  v.literal("brief_approved"),
  v.literal("researching"),
  v.literal("providers_ready"),
  v.literal("outreach_approved"),
  v.literal("outreach_sent"),
  v.literal("reply_received"),
  v.literal("reply_understood"),
  v.literal("paused"),
  v.literal("cancelled"),
  v.literal("completed"),
  v.literal("failed"),
  v.literal("needs_user"),
);

const executionStatusValidator = v.union(
  v.literal("active"),
  v.literal("paused"),
  v.literal("cancelled"),
  v.literal("completed"),
);

const activeOperationValidator = v.union(
  v.literal("provider_search"),
  v.literal("contact_discovery"),
  v.literal("outreach_send"),
  v.literal("recovery_search"),
);

const structuredLocationValidator = v.object({
  country: v.string(),
  countryCode: v.string(),
  region: v.optional(v.string()),
  city: v.string(),
  locality: v.optional(v.string()),
  postalCode: v.optional(v.string()),
});

const autonomyPreferenceValidator = v.union(
  v.literal("balanced"),
  v.literal("price"),
  v.literal("earliest_availability"),
  v.literal("complete_quote"),
);

const quoteTargetValidator = v.union(v.literal(1), v.literal(2), v.literal(3));

const responseWindowValidator = v.union(
  v.literal(1),
  v.literal(3),
  v.literal(6),
  v.literal(12),
  v.literal(24),
);

export const DEFAULT_QUOTE_TARGET = 3;
export const DEFAULT_RESPONSE_WINDOW_HOURS = 24;

export function normalizeQuoteTarget(value: unknown): 1 | 2 | 3 {
  if (value === 1 || value === 2 || value === 3) return value;
  return DEFAULT_QUOTE_TARGET;
}

export function normalizeResponseWindowHours(value: unknown): 1 | 3 | 6 | 12 | 24 {
  if (value === 1 || value === 3 || value === 6 || value === 12 || value === 24) {
    return value;
  }
  return DEFAULT_RESPONSE_WINDOW_HOURS;
}

const autonomyValidator = v.object({
  enabled: v.boolean(),
  maxProviders: v.number(),
  allowInitialOutreach: v.boolean(),
  allowRoutineClarifications: v.boolean(),
  allowFollowUp: v.boolean(),
  maxFollowUps: v.number(),
  preference: autonomyPreferenceValidator,
  includePreviouslyContacted: v.optional(v.boolean()),
  approvedAt: v.number(),
  quoteTarget: v.optional(quoteTargetValidator),
  responseWindowHours: v.optional(responseWindowValidator),
  continuousRecoveryEnabled: v.optional(v.boolean()),
});

const detailValidator = v.object({
  label: v.string(),
  value: v.string(),
});

const briefValidator = v.object({
  projectSummary: v.string(),
  serviceCategory: v.string(),
  requestedOutcome: v.string(),
  serviceLocation: v.string(),
  structuredLocation: v.optional(structuredLocationValidator),
  desiredTiming: v.string(),
  budgetOrContext: v.string(),
  structuredRequirements: v.array(detailValidator),
  unknowns: v.array(v.string()),
});

const jobValidator = v.object({
  _id: v.id("jobs"),
  _creationTime: v.number(),
  ownerId: v.id("users"),
  serviceCategory: v.string(),
  jobTitle: v.string(),
  naturalLanguageDescription: v.string(),
  serviceLocation: v.string(),
  structuredLocation: v.optional(structuredLocationValidator),
  desiredTiming: v.string(),
  budgetOrContext: v.string(),
  structuredRequirements: v.object({
    rawDetails: v.string(),
    keyDetails: v.array(detailValidator),
  }),
  status: statusValidator,
  executionStatus: v.optional(executionStatusValidator),
  pausedFromStatus: v.optional(statusValidator),
  activeOperation: v.optional(activeOperationValidator),
  missingFields: v.array(v.string()),
  brief: v.optional(briefValidator),
  briefApprovedAt: v.optional(v.number()),
  autonomy: v.optional(autonomyValidator),
  recoveryEnabled: v.optional(v.boolean()),
  recoveryDiscoveryCycles: v.optional(v.number()),
  autonomyStopReason: v.optional(v.string()),
  selectedCandidateId: v.optional(v.id("providerCandidates")),
  continuationMode: v.optional(
    v.union(v.literal("findor_assisted"), v.literal("user_takeover")),
  ),
  clientRequestId: v.optional(v.string()),
  nextRecoveryAt: v.optional(v.number()),
  recoveryGeneration: v.optional(v.number()),
  recoverySchedulerId: v.optional(v.id("_scheduled_functions")),
  currentBriefVersion: v.optional(v.number()),
  currentCycleId: v.optional(v.id("jobCycles")),
  createdAt: v.number(),
  updatedAt: v.number(),
});

const cycleStatusValidator = v.union(
  v.literal("draft"),
  v.literal("awaiting_approval"),
  v.literal("active"),
  v.literal("waiting"),
  v.literal("options_ready"),
  v.literal("exhausted_no_options"),
  v.literal("exhausted_partial"),
  v.literal("cancelled"),
  v.literal("completed"),
);

const cycleValidator = v.object({
  _id: v.id("jobCycles"),
  _creationTime: v.number(),
  ownerId: v.id("users"),
  jobId: v.id("jobs"),
  cycleNumber: v.number(),
  briefVersion: v.number(),
  mandateSnapshot: v.object({
    enabled: v.boolean(),
    maxProviders: v.number(),
    allowInitialOutreach: v.boolean(),
    allowRoutineClarifications: v.boolean(),
    allowFollowUp: v.boolean(),
    maxFollowUps: v.number(),
    preference: autonomyPreferenceValidator,
    includePreviouslyContacted: v.boolean(),
    approvedAt: v.optional(v.number()),
    quoteTarget: v.optional(quoteTargetValidator),
    responseWindowHours: v.optional(responseWindowValidator),
    continuousRecoveryEnabled: v.optional(v.boolean()),
  }),
  maxProviders: v.number(),
  startedAt: v.optional(v.number()),
  endedAt: v.optional(v.number()),
  status: cycleStatusValidator,
  outcomeSummary: v.optional(v.string()),
  recoveryEnabled: v.boolean(),
  recoveryDiscoveryCycles: v.number(),
  createdAt: v.number(),
  updatedAt: v.number(),
});

const briefVersionValidator = v.object({
  _id: v.id("briefVersions"),
  _creationTime: v.number(),
  ownerId: v.id("users"),
  jobId: v.id("jobs"),
  version: v.number(),
  serviceCategory: v.string(),
  jobTitle: v.string(),
  naturalLanguageDescription: v.string(),
  serviceLocation: v.string(),
  structuredLocation: v.optional(structuredLocationValidator),
  desiredTiming: v.string(),
  budgetOrContext: v.string(),
  structuredRequirements: v.object({
    rawDetails: v.string(),
    keyDetails: v.array(detailValidator),
  }),
  brief: briefValidator,
  reason: v.union(v.literal("initial"), v.literal("edit"), v.literal("rerun")),
  createdAt: v.number(),
});

const eventValidator = v.object({
  _id: v.id("jobEvents"),
  _creationTime: v.number(),
  jobId: v.id("jobs"),
  ownerId: v.id("users"),
  eventType: v.union(
    v.literal("job_created"),
    v.literal("intake_updated"),
    v.literal("brief_generated"),
    v.literal("brief_approved"),
    v.literal("autonomy_approved"),
    v.literal("research_started"),
    v.literal("research_completed"),
    v.literal("research_failed"),
    v.literal("contact_discovery_started"),
    v.literal("contact_discovery_completed"),
    v.literal("contact_discovery_failed"),
    v.literal("provider_approved"),
    v.literal("outreach_sent"),
    v.literal("outreach_failed"),
    v.literal("autonomous_action_blocked"),
    v.literal("follow_up_scheduled"),
    v.literal("follow_up_due"),
    v.literal("follow_up_skipped"),
    v.literal("follow_up_failed"),
    v.literal("follow_up_sent"),
    v.literal("routine_clarification_sent"),
    v.literal("routine_question_sent"),
    v.literal("consequential_action_blocked"),
    v.literal("consequential_action_approved"),
    v.literal("provider_selected"),
    v.literal("continuation_selected"),
    v.literal("user_takeover"),
    v.literal("let_findor_help_again"),
    v.literal("job_paused"),
    v.literal("job_resumed"),
    v.literal("job_cancelled"),
    v.literal("job_completed"),
    v.literal("inbound_received"),
    v.literal("delivery_failed"),
    v.literal("provider_no_response"),
    v.literal("recovery_research_started"),
    v.literal("recovery_research_completed"),
    v.literal("recovery_research_failed"),
    v.literal("provider_replacement_queued"),
    v.literal("recovery_enabled"),
    v.literal("recovery_scheduled"),
    v.literal("recovery_stopped"),
    v.literal("recovery_target_reached"),
    v.literal("country_code_repaired"),
    v.literal("inbound_understood"),
    v.literal("inbound_processing_failed"),
    v.literal("brief_version_created"),
    v.literal("cycle_prepared"),
    v.literal("cycle_approved"),
    v.literal("cycle_started"),
    v.literal("cycle_waiting"),
    v.literal("cycle_options_ready"),
    v.literal("cycle_exhausted_no_options"),
    v.literal("cycle_exhausted_partial"),
    v.literal("cycle_cancelled"),
    v.literal("cycle_completed"),
  ),
  message: v.string(),
  cycleId: v.optional(v.id("jobCycles")),
  createdAt: v.number(),
});

const intakeArgs = {
  serviceCategory: v.string(),
  jobTitle: v.string(),
  naturalLanguageDescription: v.string(),
  country: v.string(),
  countryCode: v.string(),
  region: v.string(),
  city: v.string(),
  locality: v.string(),
  postalCode: v.string(),
  desiredTiming: v.string(),
  budgetOrContext: v.string(),
};

type Intake = {
  serviceCategory: string;
  jobTitle: string;
  naturalLanguageDescription: string;
  country: string;
  countryCode: string;
  region: string;
  city: string;
  locality: string;
  postalCode: string;
  desiredTiming: string;
  budgetOrContext: string;
};

function normalized(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

function inferCategory(description: string) {
  const lowered = description.toLowerCase();
  const categoryHints = [
    {
      keywords: ["clean", "maid", "janitor", "janitorial", "housekeep", "sweep", "mop", "deep clean", "flat", "apartment"],
      label: "Residential cleaning",
    },
    {
      keywords: ["plumb", "plumber", "pipe", "drain", "faucet", "sink", "toilet", "clog", "tap", "water closet"],
      label: "Plumbing",
    },
    {
      keywords: ["electric", "electrician", "wiring", "outlet", "panel", "breaker", "bulb", "switch", "light", "chandelier"],
      label: "Electrical",
    },
    { keywords: ["move", "moving", "mover", "relocat", "haul"], label: "Moving" },
    { keywords: ["roof", "shingle", "gutter"], label: "Roof replacement" },
    {
      keywords: ["hvac", "air conditioner", "ac", "furnace", "heating", "vent"],
      label: "HVAC",
    },
    { keywords: ["lawn", "landscap", "garden", "yard", "mow", "tree"], label: "Landscaping" },
    { keywords: ["paint", "painting", "painter", "drywall"], label: "Painting" },
    { keywords: ["handyman", "fixture", "mount", "assembly", "carpenter", "repair"], label: "Handyman" },
  ] as const;
  return (
    categoryHints.find((hint) =>
      hint.keywords.some((keyword) => lowered.includes(keyword)),
    )?.label ?? ""
  );
}

function clampProviderCount(value: number | undefined) {
  if (!Number.isFinite(value)) return 3;
  return Math.min(5, Math.max(1, Math.floor(value ?? 3)));
}

/**
 * Placeholder tokens that carry no service meaning on their own.
 * A description composed solely of these (e.g. "please help") cannot
 * form a useful brief. Generic service words like "need" are deliberately
 * excluded: "need AC fix" plus category/location/timing is actionable.
 */
const MEANINGLESS_DESCRIPTION_TOKENS = new Set([
  "test",
  "testing",
  "hi",
  "hello",
  "hey",
  "yo",
  "asdf",
  "qwerty",
  "abc",
  "xyz",
  "please",
  "help",
  "thanks",
  "thank",
]);

/**
 * Determines whether a free-text service description carries enough meaning
 * to form a useful local-service brief. Short but valid requests
 * ("Fix my AC", "Install my sink", "Clean my flat") PASS; unresolved
 * specifics (exact fault, unit count, access) belong in the brief's
 * `unknowns`, not in `missingFields`. Only genuinely unusable input
 * (empty, non-textual, single word, placeholder chatter) FAILS.
 */
export function isMeaningfulServiceDescription(description: string) {
  const text = description.trim().replace(/\s+/g, " ");
  if (text.length === 0) return false;
  // Must contain at least one letter (rejects "123", "???", "---").
  if (!/[A-Za-z]/.test(text)) return false;
  // Reject single repeated characters ("aaa", "???", "111").
  const alnum = text.replace(/[^A-Za-z0-9]/g, "").toLowerCase();
  if (alnum.length > 0 && new Set(alnum).size === 1) return false;
  const words = text.split(" ").filter(Boolean);
  // A useful brief needs at least an action + object (2+ words).
  if (words.length < 2) return false;
  // Letters carry the meaning; require a minimum signal.
  const letters = text.replace(/[^A-Za-z]/g, "");
  if (letters.length < 6) return false;
  if (text.length < 8) return false;
  // Reject placeholder-only chatter ("please help", "test test").
  const meaningfulWords = words.filter(
    (w) => !MEANINGLESS_DESCRIPTION_TOKENS.has(w.toLowerCase()),
  );
  if (meaningfulWords.length === 0) return false;
  return true;
}

function formatLocation(location: {
  country: string;
  region: string;
  city: string;
  locality: string;
}) {
  return formatLocationSegments([
    location.locality,
    location.city,
    location.region,
    location.country,
  ]);
}

function analyzeLocation(intake: Intake) {
  // Authoritative country canonicalization: known names always resolve to
  // their table ISO code (fixes naive derivations like "UN" for the United
  // Kingdom). Unknown names with a well-formed code pass through attested.
  const canonical = canonicalizeCountry(intake.country, intake.countryCode);
  const country = canonical ? canonical.country : "";
  const countryCode = canonical ? canonical.countryCode : "";
  // Region/state/province is optional globally: many places have no
  // US-style state semantics (city-states, emirates, unitary districts).
  const region = canonicalizeGeographicSegment(normalized(intake.region));
  const city = canonicalizeGeographicSegment(normalized(intake.city));
  const locality = canonicalizeGeographicSegment(normalized(intake.locality));
  const postalCode = normalized(intake.postalCode);
  const missingFields: string[] = [];

  if (!canonical) missingFields.push("A supported country");
  if (city.length < 2) missingFields.push("A city or town");
  // Provably inconsistent city and country combinations surface a
  // friendly field error before any search approval. Ambiguous or unknown
  // places never flag — only unambiguous evidence blocks the brief.
  if (
    canonical &&
    [city, locality, region].some(
      (segment) => segment && isInconsistentPlaceForCountry(segment, countryCode),
    )
  ) {
    missingFields.push(
      "That location doesn't look consistent. Check the country, state/region, and city.",
    );
  }

  const valid = missingFields.length === 0 && country.length >= 2 && city.length >= 2;

  const structuredLocation = valid
    ? {
        country,
        countryCode,
        ...(region ? { region } : {}),
        city,
        ...(locality ? { locality } : {}),
        ...(postalCode ? { postalCode } : {}),
      }
    : undefined;

  return {
    missingFields,
    serviceLocation: formatLocation({ country, region, city, locality }),
    structuredLocation,
  };
}

function analyzeIntake(intake: Intake) {
  const naturalLanguageDescription = normalized(
    intake.naturalLanguageDescription,
  );
  const inferred = inferCategory(naturalLanguageDescription);
  const rawCategory = normalized(intake.serviceCategory);
  let serviceCategory = rawCategory;

  if (
    !serviceCategory ||
    serviceCategory.toLowerCase() === "other" ||
    serviceCategory.toLowerCase() === "local service"
  ) {
    serviceCategory = inferred || "Local service";
  } else if (inferred && serviceCategory.toLowerCase() !== inferred.toLowerCase()) {
    const inferredLower = inferred.toLowerCase();
    const rawLower = serviceCategory.toLowerCase();
    if (
      (inferredLower.includes("clean") && !rawLower.includes("clean")) ||
      (inferredLower.includes("plumb") && !rawLower.includes("plumb")) ||
      (inferredLower.includes("electric") && !rawLower.includes("electric"))
    ) {
      serviceCategory = inferred;
    }
  }

  const jobTitle =
    normalized(intake.jobTitle) ||
    (serviceCategory || "Local service") + " request";
  const desiredTiming = normalized(intake.desiredTiming);
  const budgetOrContext = normalized(intake.budgetOrContext);
  const location = analyzeLocation(intake);
  const keyDetails = budgetOrContext
    ? [{ label: "User-provided context", value: budgetOrContext.slice(0, 500) }]
    : [];
  const missingFields: string[] = [];

  if (serviceCategory.length < 2)
    missingFields.push("The type of local service");
  if (!isMeaningfulServiceDescription(naturalLanguageDescription)) {
    missingFields.push("A little more detail about what you need done");
  }
  missingFields.push(...location.missingFields);
  if (desiredTiming.length < 2) missingFields.push("Your timing");

  const cleaned = {
    serviceCategory,
    jobTitle,
    naturalLanguageDescription,
    serviceLocation: location.serviceLocation,
    ...(location.structuredLocation
      ? { structuredLocation: location.structuredLocation }
      : {}),
    desiredTiming,
    budgetOrContext,
    structuredRequirements: {
      rawDetails: budgetOrContext,
      keyDetails,
    },
  };

  if (missingFields.length > 0 || !location.structuredLocation) {
    return { cleaned, missingFields, brief: undefined };
  }

  return {
    cleaned,
    missingFields,
    brief: {
      projectSummary: jobTitle + ": " + naturalLanguageDescription,
      serviceCategory,
      requestedOutcome: naturalLanguageDescription,
      serviceLocation: location.serviceLocation,
      structuredLocation: location.structuredLocation,
      desiredTiming,
      budgetOrContext: budgetOrContext || "No additional context provided yet.",
      structuredRequirements: keyDetails,
      unknowns: [
        "Exact scope, quantities, or measurements",
        "Access, materials, preparation, or disposal requirements",
        "Provider availability and final estimate details",
        "An exact street address is not required for initial provider research",
      ],
    },
  };
}

function stableStringify(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (Array.isArray(value)) {
    return "[" + value.map(stableStringify).join(",") + "]";
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(
      ([a], [b]) => (a < b ? -1 : a > b ? 1 : 0),
    );
    return (
      "{" +
      entries.map(([k, v]) => JSON.stringify(k) + ":" + stableStringify(v)).join(",") +
      "}"
    );
  }
  return JSON.stringify(value) ?? "null";
}

function sameOptionalValue(left: unknown, right: unknown) {
  return stableStringify(left ?? null) === stableStringify(right ?? null);
}

export function briefFieldsChanged(
  job: Doc<"jobs">,
  analysis: ReturnType<typeof analyzeIntake>,
) {
  return (
    job.serviceCategory !== analysis.cleaned.serviceCategory ||
    job.jobTitle !== analysis.cleaned.jobTitle ||
    job.naturalLanguageDescription !==
      analysis.cleaned.naturalLanguageDescription ||
    job.serviceLocation !== analysis.cleaned.serviceLocation ||
    !sameOptionalValue(
      job.structuredLocation,
      analysis.cleaned.structuredLocation,
    ) ||
    job.desiredTiming !== analysis.cleaned.desiredTiming ||
    job.budgetOrContext !== analysis.cleaned.budgetOrContext ||
    !sameOptionalValue(
      job.structuredRequirements,
      analysis.cleaned.structuredRequirements,
    )
  );
}

async function insertBriefVersion(
  ctx: MutationCtx,
  jobId: Doc<"jobs">["_id"],
  ownerId: Doc<"jobs">["ownerId"],
  analysis: ReturnType<typeof analyzeIntake>,
  version: number,
  reason: "initial" | "edit" | "rerun",
  createdAt: number,
) {
  if (!analysis.brief) return;
  await ctx.db.insert("briefVersions", {
    ownerId,
    jobId,
    version,
    serviceCategory: analysis.cleaned.serviceCategory,
    jobTitle: analysis.cleaned.jobTitle,
    naturalLanguageDescription: analysis.cleaned.naturalLanguageDescription,
    serviceLocation: analysis.cleaned.serviceLocation,
    ...(analysis.cleaned.structuredLocation
      ? { structuredLocation: analysis.cleaned.structuredLocation }
      : {}),
    desiredTiming: analysis.cleaned.desiredTiming,
    budgetOrContext: analysis.cleaned.budgetOrContext,
    structuredRequirements: analysis.cleaned.structuredRequirements,
    brief: analysis.brief,
    reason,
    createdAt,
  });
  await ctx.db.insert("jobEvents", {
    jobId,
    ownerId,
    eventType: "brief_version_created",
    message:
      "Brief version " +
      version +
      " was preserved for this request (" +
      reason +
      ").",
    createdAt,
  });
}

export function mandateSnapshot(
  autonomy: {
    enabled: boolean;
    maxProviders: number;
    allowInitialOutreach: boolean;
    allowRoutineClarifications: boolean;
    allowFollowUp: boolean;
    maxFollowUps: number;
    preference: "balanced" | "price" | "earliest_availability" | "complete_quote";
    approvedAt?: number;
    quoteTarget?: number;
    responseWindowHours?: number;
    continuousRecoveryEnabled?: boolean;
  },
  includePreviouslyContacted: boolean,
) {
  return {
    enabled: autonomy.enabled,
    maxProviders: autonomy.maxProviders,
    allowInitialOutreach: autonomy.allowInitialOutreach,
    allowRoutineClarifications: autonomy.allowRoutineClarifications,
    allowFollowUp: autonomy.allowFollowUp,
    maxFollowUps: autonomy.maxFollowUps,
    preference: autonomy.preference,
    includePreviouslyContacted,
    ...(autonomy.approvedAt ? { approvedAt: autonomy.approvedAt } : {}),
    ...(autonomy.quoteTarget != null
      ? { quoteTarget: normalizeQuoteTarget(autonomy.quoteTarget) }
      : {}),
    ...(autonomy.responseWindowHours != null
      ? {
          responseWindowHours: normalizeResponseWindowHours(
            autonomy.responseWindowHours,
          ),
        }
      : {}),
    ...(autonomy.continuousRecoveryEnabled !== undefined
      ? { continuousRecoveryEnabled: autonomy.continuousRecoveryEnabled }
      : {}),
  };
}

async function requireUserId(ctx: QueryCtx | MutationCtx) {
  const userId = await getAuthUserId(ctx);
  if (!userId) {
    throw new Error("You must be signed in to manage a job.");
  }
  return userId;
}

/**
 * Usable-quote rule for the quote target. Counts only structured options
 * with concrete offer content: an extracted quote, or availability/mixed
 * material carrying a price. Never counts acknowledgements, declines,
 * needs_information ("we'll get back to you"), bounces, or unmatched input.
 */
export function isUsableQuoteResponse(response: {
  kind: string;
  headlinePrice?: string;
  priceMin?: number;
  priceMax?: number;
}) {
  if (response.kind === "quote") return true;
  const hasPrice =
    (response.headlinePrice ?? "").trim().length > 0 ||
    response.priceMin != null ||
    response.priceMax != null;
  if (!hasPrice) return false;
  return response.kind === "mixed" || response.kind === "availability";
}

/**
 * Counts usable quotes against the CURRENT brief version only. Late replies
 * from older cycles count when their cycle's brief version matches; replies
 * against a superseded brief stay in history but never count. Responses
 * without resolvable cycle history default to version 1.
 */
export async function countUsableSameBriefQuotes(
  ctx: QueryCtx | MutationCtx,
  job: Doc<"jobs">,
): Promise<{ count: number; responseIds: Doc<"providerResponses">["_id"][] }> {
  const currentVersion = job.currentBriefVersion ?? 1;
  const cycles = await ctx.db
    .query("jobCycles")
    .withIndex("by_job_and_cycleNumber", (q) => q.eq("jobId", job._id))
    .take(20);
  const versionByCycle = new Map(
    cycles.map((cycle) => [String(cycle._id), cycle.briefVersion] as const),
  );
  const responses = await ctx.db
    .query("providerResponses")
    .withIndex("by_jobId_and_createdAt", (q) => q.eq("jobId", job._id))
    .take(50);
  const usable: Doc<"providerResponses">["_id"][] = [];
  for (const response of responses) {
    if (!isUsableQuoteResponse(response)) continue;
    const version = response.briefVersion
      ?? (response.cycleId ? versionByCycle.get(String(response.cycleId)) : undefined)
      ?? (response.cycleId ? undefined : 1);
    if (version === undefined) {
      // Cycle row missing (legacy): fall back to version 1.
      if (currentVersion === 1) usable.push(response._id);
      continue;
    }
    if (version === currentVersion) usable.push(response._id);
  }
  return { count: usable.length, responseIds: usable };
}

export const listMine = query({
  args: {},
  returns: v.array(jobValidator),
  handler: async (ctx) => {
    const userId = await requireUserId(ctx);
    return await ctx.db
      .query("jobs")
      .withIndex("by_owner_and_updatedAt", (q) => q.eq("ownerId", userId))
      .order("desc")
      .take(20);
  },
});

export const get = query({
  args: { jobId: v.id("jobs") },
  returns: v.union(v.null(), jobValidator),
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    const job = await ctx.db.get("jobs", args.jobId);
    if (!job || job.ownerId !== userId) {
      return null;
    }
    return job;
  },
});

export const listEvents = query({
  args: { jobId: v.id("jobs") },
  returns: v.array(eventValidator),
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    const job = await ctx.db.get("jobs", args.jobId);
    if (!job || job.ownerId !== userId) {
      return [];
    }
    return await ctx.db
      .query("jobEvents")
      .withIndex("by_job_and_createdAt", (q) => q.eq("jobId", args.jobId))
      .order("desc")
      .take(20);
  },
});

export const listCycles = query({
  args: { jobId: v.id("jobs") },
  returns: v.array(cycleValidator),
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    const job = await ctx.db.get("jobs", args.jobId);
    if (!job || job.ownerId !== userId) return [];
    return await ctx.db
      .query("jobCycles")
      .withIndex("by_job_and_cycleNumber", (q) => q.eq("jobId", args.jobId))
      .order("desc")
      .take(20);
  },
});

export const listBriefVersions = query({
  args: { jobId: v.id("jobs") },
  returns: v.array(briefVersionValidator),
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    const job = await ctx.db.get("jobs", args.jobId);
    if (!job || job.ownerId !== userId) return [];
    return await ctx.db
      .query("briefVersions")
      .withIndex("by_job_and_version", (q) => q.eq("jobId", args.jobId))
      .order("desc")
      .take(20);
  },
});

export const create = mutation({
  args: { ...intakeArgs, clientRequestId: v.optional(v.string()) },
  returns: v.id("jobs"),
  handler: async (ctx, args) => {
    const ownerId = await requireUserId(ctx);
    const now = Date.now();
    // Server-side intake idempotency: a retried/double-clicked submission
    // carrying the same client key reuses the original job instead of
    // creating a duplicate row.
    if (args.clientRequestId) {
      const recent = await ctx.db
        .query("jobs")
        .withIndex("by_owner_and_updatedAt", (q) => q.eq("ownerId", ownerId))
        .order("desc")
        .take(10);
      const duplicate = recent.find(
        (j) => j.clientRequestId === args.clientRequestId,
      );
      if (duplicate) return duplicate._id;
    }
    const analysis = analyzeIntake(args);
    const status = analysis.brief ? "brief_ready" : "needs_info";
    const jobId = await ctx.db.insert("jobs", {
      ownerId,
      ...analysis.cleaned,
      status,
      executionStatus: "active",
      missingFields: analysis.missingFields,
      brief: analysis.brief,
      ...(analysis.brief ? { currentBriefVersion: 1 } : {}),
      ...(args.clientRequestId
        ? { clientRequestId: args.clientRequestId }
        : {}),
      createdAt: now,
      updatedAt: now,
    });

    await ctx.db.insert("jobEvents", {
      jobId,
      ownerId,
      eventType: "job_created",
      message: analysis.brief
        ? "Local-service intake saved and a reviewable brief was prepared."
        : "Local-service intake saved. A few details are needed before the brief can be reviewed.",
      createdAt: now,
    });

    if (analysis.brief) {
      await insertBriefVersion(
        ctx,
        jobId,
        ownerId,
        analysis,
        1,
        "initial",
        now + 1,
      );
      await ctx.db.insert("jobEvents", {
        jobId,
        ownerId,
        eventType: "brief_generated",
        message: "A structured local-service brief is ready for your review.",
        createdAt: now + 2,
      });
    }

    return jobId;
  },
});

export const updateIntake = mutation({
  args: { jobId: v.id("jobs"), ...intakeArgs },
  returns: v.null(),
  handler: async (ctx, args) => {
    const ownerId = await requireUserId(ctx);
    const job = await ctx.db.get("jobs", args.jobId);
    if (!job || job.ownerId !== ownerId) {
      throw new Error("Job not found.");
    }
    // Editable states: intake drafting (needs_info/brief_ready) plus stopped
    // jobs awaiting a human decision (needs_user, e.g. zero-result rounds).
    // A malformed historical location must never block its own correction:
    // only the NEW submitted geo is validated. Live flows (researching,
    // outreach, replies, paused/cancelled/completed) stay protected.
    if (
      job.status !== "needs_info" &&
      job.status !== "brief_ready" &&
      job.status !== "needs_user"
    ) {
      throw new Error(
        "An approved brief cannot be changed in this first release.",
      );
    }

    const now = Date.now();
    const analysis = analyzeIntake(args);
    const nextStatus = analysis.brief ? "brief_ready" : "needs_info";
    // Idempotency: an identical retried update is a no-op (no duplicate events).
    if (!briefFieldsChanged(job, analysis) && job.status === nextStatus) {
      return null;
    }
    // First completion of the brief on this job preserves v1 history,
    // mirroring `create` (which stores v1 when the intake already qualifies).
    // Legacy jobs may carry a version number with no stored history rows;
    // an empty history table always gets its v1 preserved here.
    let nextBriefVersion = job.currentBriefVersion;
    if (analysis.brief) {
      const existingVersions = await ctx.db
        .query("briefVersions")
        .withIndex("by_job_and_version", (q) => q.eq("jobId", args.jobId))
        .take(1);
      if (
        existingVersions.length === 0 &&
        (nextBriefVersion ?? 0) <= 1
      ) {
        await insertBriefVersion(
          ctx,
          args.jobId,
          ownerId,
          analysis,
          1,
          "initial",
          now + 1,
        );
        nextBriefVersion = 1;
      }
    }
    // Repairing a stopped job restarts review: prior approval/stop context
    // is cleared so search/outreach can only run after fresh approval.
    // History (cycles, outreach, events) is preserved, never rewritten.
    // Stale structured data is explicitly cleared when the new analysis
    // yields none, so a malformed historical location cannot linger beside
    // corrected free text.
    const repairingStopped = job.status === "needs_user";
    await ctx.db.patch("jobs", args.jobId, {
      ...analysis.cleaned,
      status: nextStatus,
      missingFields: analysis.missingFields,
      brief: analysis.brief,
      ...(analysis.cleaned.structuredLocation
        ? { structuredLocation: analysis.cleaned.structuredLocation }
        : { structuredLocation: undefined }),
      ...(nextBriefVersion ? { currentBriefVersion: nextBriefVersion } : {}),
      ...(repairingStopped
        ? { briefApprovedAt: undefined, autonomyStopReason: undefined }
        : {}),
      updatedAt: now,
    });
    await ctx.db.insert("jobEvents", {
      jobId: args.jobId,
      ownerId,
      eventType: "intake_updated",
      message: analysis.brief
        ? "Intake updated and the structured brief is ready to review."
        : "Intake updated. More information is still needed.",
      createdAt: now,
    });
    return null;
  },
});

export const approveBrief = mutation({
  args: {
    jobId: v.id("jobs"),
    maxProviders: v.optional(v.number()),
    preference: v.optional(autonomyPreferenceValidator),
    quoteTarget: v.optional(quoteTargetValidator),
    responseWindowHours: v.optional(responseWindowValidator),
    continuousRecovery: v.optional(v.boolean()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const ownerId = await requireUserId(ctx);
    const job = await ctx.db.get("jobs", args.jobId);
    if (!job || job.ownerId !== ownerId) {
      throw new Error("Job not found.");
    }
    const isPaused =
      job.executionStatus === "paused" ||
      job.status === "paused" ||
      Boolean(job.pausedFromStatus);

    if (isPaused) {
      throw new Error(
        "This request is currently paused. Please resume the request before approving the brief and starting a cycle.",
      );
    }

    if (
      (job.status !== "brief_ready" &&
        job.status !== "brief_approved" &&
        job.status !== "needs_user") ||
      !job.brief
    ) {
      throw new Error(
        "Complete the missing intake details before approving the brief.",
      );
    }

    const now = Date.now();
    // Continuous quote recovery is explicit owner authorization only: it is
    // enabled solely when the caller passes continuousRecovery: true.
    // Historical jobs without these fields stay single-shot.
    const autonomy = {
      enabled: true,
      maxProviders: clampProviderCount(args.maxProviders),
      allowInitialOutreach: true,
      allowRoutineClarifications: true,
      allowFollowUp: true,
      maxFollowUps: 1,
      preference: args.preference ?? "balanced",
      approvedAt: now,
      quoteTarget: normalizeQuoteTarget(
        args.quoteTarget ?? job.autonomy?.quoteTarget,
      ),
      responseWindowHours: normalizeResponseWindowHours(
        args.responseWindowHours ?? job.autonomy?.responseWindowHours,
      ),
      continuousRecoveryEnabled:
        args.continuousRecovery ??
        job.autonomy?.continuousRecoveryEnabled ??
        false,
    };

    const currentBriefVersion = job.currentBriefVersion ?? 1;

    // Idempotency: Check if a cycle for this briefVersion already exists
    let currentCycleId: Id<"jobCycles"> | undefined = job.currentCycleId;
    let reusedCycle = false;

    if (currentCycleId) {
      const existingCycle = await ctx.db.get("jobCycles", currentCycleId);
      if (
        existingCycle &&
        existingCycle.briefVersion === currentBriefVersion &&
        existingCycle.ownerId === ownerId &&
        (existingCycle.status === "draft" ||
          existingCycle.status === "awaiting_approval" ||
          existingCycle.status === "active")
      ) {
        reusedCycle = true;
      }
    }

    if (!reusedCycle) {
      const existingCyclesForJob = await ctx.db
        .query("jobCycles")
        .withIndex("by_job_and_cycleNumber", (q) => q.eq("jobId", args.jobId))
        .take(20);
      const existingCycleForVersion = existingCyclesForJob.find(
        (c) =>
          c.briefVersion === currentBriefVersion &&
          (c.status === "draft" ||
            c.status === "awaiting_approval" ||
            c.status === "active"),
      );

      if (existingCycleForVersion) {
        currentCycleId = existingCycleForVersion._id;
        reusedCycle = true;
      }
    }

    if (reusedCycle && currentCycleId) {
      if (job.status === "brief_approved") {
        await ctx.db.patch("jobs", args.jobId, {
          autonomy,
          updatedAt: now,
        });
        await ctx.db.patch("jobCycles", currentCycleId, {
          mandateSnapshot: {
            ...autonomy,
            includePreviouslyContacted: false,
          },
          maxProviders: autonomy.maxProviders,
          updatedAt: now,
        });
        await ctx.runMutation(internal.jobs.syncRecoverySchedule, {
          jobId: args.jobId,
          ownerId,
        });
        return null;
      }
      await ctx.db.patch("jobCycles", currentCycleId, {
        status: "active",
        maxProviders: autonomy.maxProviders,
        mandateSnapshot: {
          ...autonomy,
          includePreviouslyContacted: false,
        },
        updatedAt: now,
      });
      await ctx.db.patch("jobs", args.jobId, {
        status: "brief_approved",
        executionStatus: "active",
        briefApprovedAt: now,
        currentCycleId,
        currentBriefVersion,
        autonomy,
        recoveryEnabled: true,
        recoveryDiscoveryCycles: 0,
        pausedFromStatus: undefined,
        updatedAt: now,
      });
      await ctx.runMutation(internal.jobs.syncRecoverySchedule, {
        jobId: args.jobId,
        ownerId,
      });
      return null;
    }

    const existingCycles = await ctx.db
      .query("jobCycles")
      .withIndex("by_job_and_cycleNumber", (q) => q.eq("jobId", args.jobId))
      .order("desc")
      .take(1);

    const lastCycle = existingCycles[0];
    if (
      lastCycle &&
      lastCycle.status === "active" &&
      lastCycle.briefVersion === currentBriefVersion &&
      now - lastCycle.createdAt < 60_000
    ) {
      // Idempotency: reuse recently approved active cycle without creating duplicate rows
      currentCycleId = lastCycle._id;
      await ctx.db.patch("jobCycles", currentCycleId, {
        mandateSnapshot: {
          ...autonomy,
          includePreviouslyContacted: false,
        },
        maxProviders: autonomy.maxProviders,
        updatedAt: now,
      });
      await ctx.db.patch("jobs", args.jobId, {
        status: "brief_approved",
        executionStatus: "active",
        briefApprovedAt: now,
        currentCycleId,
        currentBriefVersion,
        autonomy,
        recoveryEnabled: true,
        recoveryDiscoveryCycles: 0,
        pausedFromStatus: undefined,
        updatedAt: now,
      });
      await ctx.runMutation(internal.jobs.syncRecoverySchedule, {
        jobId: args.jobId,
        ownerId,
      });
      return null;
    }

    const hasPriorLegacyActivity =
      Boolean(job.briefApprovedAt) ||
      (job.currentBriefVersion ?? 1) > 1;

    const nextCycleNumber =
      existingCycles.length > 0
        ? existingCycles[0].cycleNumber + 1
        : hasPriorLegacyActivity
          ? 2
          : 1;

    currentCycleId = await ctx.db.insert("jobCycles", {
      ownerId,
      jobId: args.jobId,
      cycleNumber: nextCycleNumber,
      briefVersion: currentBriefVersion,
      mandateSnapshot: {
        ...autonomy,
        includePreviouslyContacted: false,
      },
      maxProviders: autonomy.maxProviders,
      startedAt: now,
      status: "active",
      recoveryEnabled: true,
      recoveryDiscoveryCycles: 0,
      createdAt: now,
      updatedAt: now,
    });

    await ctx.db.insert("jobEvents", {
      jobId: args.jobId,
      ownerId,
      cycleId: currentCycleId,
      eventType: "cycle_started",
      message: `Cycle ${nextCycleNumber} started finding options.`,
      createdAt: now + 2,
    });

    await ctx.db.patch("jobs", args.jobId, {
      status: "brief_approved",
      executionStatus: "active",
      briefApprovedAt: now,
      currentCycleId,
      currentBriefVersion,
      autonomy,
      recoveryEnabled: true,
      recoveryDiscoveryCycles: 0,
      pausedFromStatus: undefined,
      updatedAt: now,
    });
    await ctx.db.insert("jobEvents", {
      jobId: args.jobId,
      ownerId,
      cycleId: currentCycleId,
      eventType: "brief_approved",
      message:
        "You approved the Job Brief and reviewed Findor's operating mandate.",
      createdAt: now,
    });
    await ctx.db.insert("jobEvents", {
      jobId: args.jobId,
      ownerId,
      cycleId: currentCycleId,
      eventType: "autonomy_approved",
      message:
        "Findor may research real providers, check public contact routes, contact up to " +
        autonomy.maxProviders +
        " suitable providers, ask routine non-binding questions, and follow up once when authorized.",
      createdAt: now + 1,
    });
    await ctx.runMutation(internal.jobs.syncRecoverySchedule, {
      jobId: args.jobId,
      ownerId,
    });
    return null;
  },
});

export const enableRecovery = mutation({
  args: { jobId: v.id("jobs") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const ownerId = await requireUserId(ctx);
    const job = await ctx.db.get("jobs", args.jobId);
    if (!job || job.ownerId !== ownerId) throw new Error("Job not found.");
    if (!job.autonomy?.enabled || !job.autonomy.allowInitialOutreach) {
      throw new Error("Approve the operating mandate before enabling recovery.");
    }
    if (["paused", "cancelled", "completed", "needs_user"].includes(job.status)) {
      throw new Error("Recovery is not available while this request is stopped.");
    }
    if (job.recoveryEnabled) return null;

    const now = Date.now();
    await ctx.db.patch("jobs", args.jobId, {
      recoveryEnabled: true,
      recoveryDiscoveryCycles: job.recoveryDiscoveryCycles ?? 0,
      updatedAt: now,
    });
    await ctx.db.insert("jobEvents", {
      jobId: args.jobId,
      ownerId,
      eventType: "recovery_enabled",
      message:
        "You enabled one bounded recovery search if an approved provider does not respond.",
      createdAt: now,
    });
    await ctx.scheduler.runAfter(0, internal.outreach.scheduleRecoveryChecksForJob, {
      jobId: args.jobId,
      ownerId,
    });
    await ctx.scheduler.runAfter(0, internal.outreach.evaluateRecovery, {
      jobId: args.jobId,
      ownerId,
    });
    return null;
  },
});

// ============================================================================
// Continuous quote recovery: deadline-driven bounded new-provider search.
// Reuses the proven discovery/queue/send pipeline. Authorization is explicit:
// historical jobs never auto-enable (continuousRecoveryEnabled defaults off).
// ============================================================================

function recoveryWindowMs(job: Doc<"jobs">) {
  return (
    normalizeResponseWindowHours(job.autonomy?.responseWindowHours) *
    3600_000
  );
}

function continuousRecoveryTarget(job: Doc<"jobs">) {
  return normalizeQuoteTarget(job.autonomy?.quoteTarget);
}

function continuousRecoveryOn(job: Doc<"jobs">) {
  return (
    job.autonomy?.enabled === true &&
    job.autonomy.continuousRecoveryEnabled === true
  );
}

function recoveryHalted(job: Doc<"jobs">) {
  if (
    job.executionStatus === "paused" ||
    job.executionStatus === "cancelled" ||
    job.executionStatus === "completed"
  ) {
    return true;
  }
  if (
    job.status === "paused" ||
    job.status === "cancelled" ||
    job.status === "completed"
  ) {
    return true;
  }
  if (job.selectedCandidateId) return true;
  if (job.continuationMode === "user_takeover") return true;
  if (!job.autonomy?.enabled) return true;
  return false;
}

function recoveryHaltReason(job: Doc<"jobs">) {
  if (
    job.executionStatus === "paused" ||
    job.status === "paused" ||
    Boolean(job.pausedFromStatus)
  ) {
    return "This project is paused. Resume it to restart automatic searching.";
  }
  if (
    job.executionStatus === "cancelled" ||
    job.status === "cancelled"
  ) {
    return "This project was cancelled. Automatic searching stopped.";
  }
  if (
    job.executionStatus === "completed" ||
    job.status === "completed"
  ) {
    return "This project was marked complete. Automatic searching stopped.";
  }
  if (job.selectedCandidateId || job.continuationMode === "user_takeover") {
    return "A provider decision was made. Automatic searching stopped.";
  }
  return "Automatic searching stopped.";
}

async function cancelRecoveryScheduler(
  ctx: MutationCtx,
  job: Doc<"jobs">,
) {
  if (job.recoverySchedulerId) {
    try {
      await ctx.scheduler.cancel(job.recoverySchedulerId);
    } catch {
      // A callback may already be running; it rechecks durable state.
    }
  }
}

/** Arms exactly one future recovery deadline (cancelling any stale one). */
export const armRecoverySchedule = internalMutation({
  args: { jobId: v.id("jobs"), ownerId: v.id("users") },
  returns: v.object({ deadline: v.number() }),
  handler: async (ctx, args) => {
    const job = await ctx.db.get("jobs", args.jobId);
    if (!job || job.ownerId !== args.ownerId) {
      throw new Error("Job not found.");
    }
    await cancelRecoveryScheduler(ctx, job);
    const now = Date.now();
    const deadline = now + recoveryWindowMs(job);
    const target = continuousRecoveryTarget(job);
    const schedulerId = await ctx.scheduler.runAt(
      deadline,
      internal.jobs.evaluateContinuousRecovery,
      {
        jobId: args.jobId,
        ownerId: args.ownerId,
        expectedGeneration: job.recoveryGeneration ?? 0,
        expectedDeadline: deadline,
      },
    );
    await ctx.db.patch("jobs", args.jobId, {
      nextRecoveryAt: deadline,
      recoverySchedulerId: schedulerId,
      updatedAt: now,
    });
    await ctx.db.insert("jobEvents", {
      jobId: args.jobId,
      ownerId: args.ownerId,
      eventType: "recovery_scheduled",
      message:
        "Automatic searching continues: Findor will look for another batch of providers after " +
        new Date(deadline).toUTCString() +
        " unless " +
        target +
        " quotes arrive first.",
      createdAt: now,
    });
    return { deadline };
  },
});

/** Clears any pending recovery deadline. Bumps the generation to invalidate
 *  in-flight callbacks when requested (explicit stops). */
export const stopRecoverySchedule = internalMutation({
  args: {
    jobId: v.id("jobs"),
    ownerId: v.id("users"),
    bumpGeneration: v.optional(v.boolean()),
    message: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const job = await ctx.db.get("jobs", args.jobId);
    if (!job || job.ownerId !== args.ownerId) return null;
    const hadPending =
      job.nextRecoveryAt != null || job.recoverySchedulerId != null;
    await cancelRecoveryScheduler(ctx, job);
    const now = Date.now();
    await ctx.db.patch("jobs", args.jobId, {
      nextRecoveryAt: undefined,
      recoverySchedulerId: undefined,
      ...(args.bumpGeneration
        ? { recoveryGeneration: (job.recoveryGeneration ?? 0) + 1 }
        : {}),
      updatedAt: now,
    });
    if (args.message && (hadPending || args.bumpGeneration)) {
      await ctx.db.insert("jobEvents", {
        jobId: args.jobId,
        ownerId: args.ownerId,
        eventType: "recovery_stopped",
        message: args.message,
        createdAt: now,
      });
    }
    return null;
  },
});

/** Ensures scheduler state matches intent: exactly one deadline while an
 *  enabled, runnable, target-open job waits; none otherwise. Never flips the
 *  owner's enabled flag and never bumps the generation. */
export const syncRecoverySchedule = internalMutation({
  args: { jobId: v.id("jobs"), ownerId: v.id("users") },
  returns: v.string(),
  handler: async (ctx, args) => {
    const job = await ctx.db.get("jobs", args.jobId);
    if (!job || job.ownerId !== args.ownerId) return "unchanged";
    if (!continuousRecoveryOn(job) || recoveryHalted(job)) {
      if (job.nextRecoveryAt != null || job.recoverySchedulerId != null) {
        await ctx.runMutation(internal.jobs.stopRecoverySchedule, {
          jobId: args.jobId,
          ownerId: args.ownerId,
          bumpGeneration: false,
          message: recoveryHaltReason(job),
        });
        return "cleared";
      }
      return "unchanged";
    }
    const { count } = await countUsableSameBriefQuotes(ctx, job);
    if (count >= continuousRecoveryTarget(job)) {
      if (job.nextRecoveryAt != null || job.recoverySchedulerId != null) {
        await ctx.runMutation(internal.jobs.stopRecoverySchedule, {
          jobId: args.jobId,
          ownerId: args.ownerId,
          bumpGeneration: false,
          message:
            "Quote target reached: " +
            count +
            " usable quotes ready to compare.",
        });
        return "cleared";
      }
      return "unchanged";
    }
    if (
      job.nextRecoveryAt != null &&
      job.nextRecoveryAt > Date.now() &&
      job.recoverySchedulerId != null
    ) {
      return "already_armed";
    }
    await ctx.runMutation(internal.jobs.armRecoverySchedule, {
      jobId: args.jobId,
      ownerId: args.ownerId,
    });
    return "armed";
  },
});

/**
 * Deadline callback: read FRESH state, stop on every listed condition,
 * otherwise run exactly ONE recovery round (new cycle, same brief). The next
 * deadline is armed only by the successful round finalizer. Duplicate/retried callbacks collapse via the
 * generation + deadline compare-and-set guard.
 */
export const evaluateContinuousRecovery = internalMutation({
  args: {
    jobId: v.id("jobs"),
    ownerId: v.id("users"),
    expectedGeneration: v.number(),
    expectedDeadline: v.number(),
  },
  returns: v.string(),
  handler: async (ctx, args) => {
    const job = await ctx.db.get("jobs", args.jobId);
    if (!job || job.ownerId !== args.ownerId) return "stopped";
    if ((job.recoveryGeneration ?? 0) !== args.expectedGeneration) {
      return "stale";
    }
    if (job.nextRecoveryAt !== args.expectedDeadline) return "stale";
    if (!continuousRecoveryOn(job)) {
      await ctx.runMutation(internal.jobs.stopRecoverySchedule, {
        jobId: args.jobId,
        ownerId: args.ownerId,
        bumpGeneration: false,
        message: "Automatic searching is off. No new batch started.",
      });
      return "disabled";
    }
    if (recoveryHalted(job)) {
      await ctx.runMutation(internal.jobs.stopRecoverySchedule, {
        jobId: args.jobId,
        ownerId: args.ownerId,
        bumpGeneration: false,
        message: recoveryHaltReason(job),
      });
      return "halted";
    }
    const { count } = await countUsableSameBriefQuotes(ctx, job);
    const target = continuousRecoveryTarget(job);
    const now = Date.now();
    if (count >= target) {
      await ctx.db.patch("jobs", args.jobId, {
        autonomy: job.autonomy
          ? { ...job.autonomy, continuousRecoveryEnabled: false }
          : job.autonomy,
        updatedAt: now,
      });
      await ctx.runMutation(internal.jobs.stopRecoverySchedule, {
        jobId: args.jobId,
        ownerId: args.ownerId,
        bumpGeneration: true,
        message:
          "Quote target reached: " + count + " usable quotes ready to compare.",
      });
      // Emit the target event under its own type for the results UI.
      await ctx.db.insert("jobEvents", {
        jobId: args.jobId,
        ownerId: args.ownerId,
        eventType: "recovery_target_reached",
        message:
          "Quote target reached: " + count + " usable quotes ready to compare.",
        createdAt: now,
      });
      return "target_reached";
    }
    // Never stack rounds: a still-running search extends the wait instead.
    if (job.status === "researching" || job.activeOperation) {
      await ctx.runMutation(internal.jobs.armRecoverySchedule, {
        jobId: args.jobId,
        ownerId: args.ownerId,
      });
      return "extended";
    }
    const eligible = await listRecoveryEligibleCandidates(
      ctx,
      job,
      args.ownerId,
    );
    const budgetLeft =
      (job.recoveryDiscoveryCycles ?? 0) < MAX_CONTINUOUS_RECOVERY_ROUNDS;
    if (eligible.length === 0 && !budgetLeft) {
      // Discovery budget spent and nothing known: recount-only watch.
      await ctx.runMutation(internal.jobs.armRecoverySchedule, {
        jobId: args.jobId,
        ownerId: args.ownerId,
      });
      return "watching";
    }
    // Exactly one new recovery cycle for this round, same brief version.
    const autonomy = job.autonomy;
    if (!autonomy) return "stopped";
    // Consume the current deadline before starting work. A discovery or
    // outreach failure must not leave the old deadline looking successful.
    await ctx.runMutation(internal.jobs.stopRecoverySchedule, {
      jobId: args.jobId,
      ownerId: args.ownerId,
      bumpGeneration: false,
    });
    const priorCycles = await ctx.db
      .query("jobCycles")
      .withIndex("by_job_and_cycleNumber", (q) => q.eq("jobId", args.jobId))
      .order("desc")
      .take(1);
    const nextCycleNumber =
      priorCycles.length > 0 ? priorCycles[0].cycleNumber + 1 : 1;
    const currentBriefVersion = job.currentBriefVersion ?? 1;
    const cycleId = await ctx.db.insert("jobCycles", {
      ownerId: args.ownerId,
      jobId: args.jobId,
      cycleNumber: nextCycleNumber,
      briefVersion: currentBriefVersion,
      mandateSnapshot: mandateSnapshot(autonomy, false),
      maxProviders: autonomy.maxProviders,
      startedAt: now,
      status: "active",
      recoveryEnabled: true,
      recoveryDiscoveryCycles: 0,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.patch("jobs", args.jobId, {
      currentCycleId: cycleId,
      updatedAt: now,
    });
    await ctx.db.insert("jobEvents", {
      jobId: args.jobId,
      ownerId: args.ownerId,
      cycleId,
      eventType: "cycle_started",
      message: `Cycle ${nextCycleNumber} started looking for more options (recovery batch).`,
      createdAt: now + 2,
    });
    if (eligible.length > 0) {
      const queued = await ctx.runMutation(
        internal.outreach.queueRecoveryBatch,
        { jobId: args.jobId, ownerId: args.ownerId },
      );
      if (queued.queuedCount > 0) {
        await ctx.scheduler.runAfter(0, internal.outreach.sendAutonomousBatch, {
          jobId: args.jobId,
          ownerId: args.ownerId,
          continuousRecoveryCycleId: cycleId,
        });
        return "round_queued";
      }
    }
    if (budgetLeft) {
      await ctx.db.patch("jobs", args.jobId, {
        activeOperation: "recovery_search",
        recoveryDiscoveryCycles: (job.recoveryDiscoveryCycles ?? 0) + 1,
        updatedAt: now,
      });
      await ctx.db.insert("jobEvents", {
        jobId: args.jobId,
        ownerId: args.ownerId,
        cycleId,
        eventType: "recovery_research_started",
        message: "Looking for another batch of suitable providers.",
        createdAt: now,
      });
      await ctx.scheduler.runAfter(
        0,
        internal.providerResearch.runContinuousDiscovery,
        { jobId: args.jobId, ownerId: args.ownerId },
      );
    }
    return budgetLeft ? "round_searching" : "watching";
  },
});

/**
 * Records a technical failure for a continuous round and invalidates its
 * scheduler. This is deliberately separate from the normal recovery failure
 * path so a failed autonomous attempt cannot look successful because a new
 * deadline was written.
 */
export const failContinuousRecoveryRound = internalMutation({
  args: {
    jobId: v.id("jobs"),
    ownerId: v.id("users"),
    cycleId: v.id("jobCycles"),
  },
  returns: v.string(),
  handler: async (ctx, args) => {
    const job = await ctx.db.get("jobs", args.jobId);
    if (
      !job ||
      job.ownerId !== args.ownerId ||
      job.currentCycleId !== args.cycleId
    ) {
      return "stale";
    }
    if (!job.autonomy?.continuousRecoveryEnabled) return "stopped";
    const now = Date.now();
    const message =
      "The recovery search could not complete. Automatic searching stopped; review the request before trying again.";
    await ctx.db.patch("jobs", args.jobId, {
      status: "needs_user",
      activeOperation: undefined,
      autonomy: {
        ...job.autonomy,
        continuousRecoveryEnabled: false,
      },
      autonomyStopReason: message,
      updatedAt: now,
    });
    await ctx.runMutation(internal.jobs.stopRecoverySchedule, {
      jobId: args.jobId,
      ownerId: args.ownerId,
      bumpGeneration: true,
      message,
    });
    await ctx.db.insert("jobEvents", {
      jobId: args.jobId,
      ownerId: args.ownerId,
      cycleId: args.cycleId,
      eventType: "recovery_research_failed",
      message: message + " No additional provider was contacted.",
      createdAt: now,
    });
    return "failed";
  },
});

/**
 * Completes one continuous round. A future deadline exists only after the
 * discovery/outreach action has persisted its result and all sends finish.
 * Empty-candidate discovery is a successful round and remains watchable.
 */
export const finalizeContinuousRecoveryRound = internalMutation({
  args: {
    jobId: v.id("jobs"),
    ownerId: v.id("users"),
    cycleId: v.id("jobCycles"),
    failedSendCount: v.optional(v.number()),
  },
  returns: v.string(),
  handler: async (ctx, args) => {
    const job = await ctx.db.get("jobs", args.jobId);
    if (
      !job ||
      job.ownerId !== args.ownerId ||
      job.currentCycleId !== args.cycleId
    ) {
      return "stale";
    }
    if ((args.failedSendCount ?? 0) > 0) {
      const now = Date.now();
      const message =
        "The recovery outreach could not complete. Automatic searching stopped; review the request before trying again.";
      await ctx.db.patch("jobs", args.jobId, {
        status: "needs_user",
        activeOperation: undefined,
        autonomy: job.autonomy
          ? { ...job.autonomy, continuousRecoveryEnabled: false }
          : job.autonomy,
        autonomyStopReason: message,
        updatedAt: now,
      });
      await ctx.runMutation(internal.jobs.stopRecoverySchedule, {
        jobId: args.jobId,
        ownerId: args.ownerId,
        bumpGeneration: true,
        message,
      });
      await ctx.db.insert("jobEvents", {
        jobId: args.jobId,
        ownerId: args.ownerId,
        cycleId: args.cycleId,
        eventType: "recovery_research_failed",
        message: message + " No additional provider was contacted.",
        createdAt: now,
      });
      return "failed";
    }
    const { count } = await countUsableSameBriefQuotes(ctx, job);
    const target = continuousRecoveryTarget(job);
    if (count >= target) {
      const now = Date.now();
      await ctx.db.patch("jobs", args.jobId, {
        autonomy: job.autonomy
          ? { ...job.autonomy, continuousRecoveryEnabled: false }
          : job.autonomy,
        updatedAt: now,
      });
      await ctx.runMutation(internal.jobs.stopRecoverySchedule, {
        jobId: args.jobId,
        ownerId: args.ownerId,
        bumpGeneration: true,
        message: "Quote target reached: " + count + " usable quotes ready to compare.",
      });
      await ctx.db.insert("jobEvents", {
        jobId: args.jobId,
        ownerId: args.ownerId,
        cycleId: args.cycleId,
        eventType: "recovery_target_reached",
        message: "Quote target reached: " + count + " usable quotes ready to compare.",
        createdAt: now,
      });
      return "target_reached";
    }
    if (!continuousRecoveryOn(job) || recoveryHalted(job)) {
      await ctx.runMutation(internal.jobs.stopRecoverySchedule, {
        jobId: args.jobId,
        ownerId: args.ownerId,
        bumpGeneration: false,
        message: recoveryHaltReason(job),
      });
      return "stopped";
    }
    if (job.activeOperation) return "pending";
    await ctx.runMutation(internal.jobs.armRecoverySchedule, {
      jobId: args.jobId,
      ownerId: args.ownerId,
    });
    return "scheduled";
  },
});

/** Repairs only active jobs whose stored structured country code is stale. */
export const repairLegacyCountryCode = internalMutation({
  args: { jobId: v.id("jobs") },
  returns: v.object({
    changed: v.boolean(),
    before: v.string(),
    after: v.string(),
  }),
  handler: async (ctx, args) => {
    const job = await ctx.db.get("jobs", args.jobId);
    const location = job?.structuredLocation;
    const before = location?.countryCode ?? "";
    if (
      !job ||
      !location ||
      job.status === "cancelled" ||
      job.status === "completed" ||
      (job.executionStatus && job.executionStatus !== "active")
    ) {
      return { changed: false, before, after: before };
    }
    const canonical = canonicalizeCountry(location.country, location.countryCode);
    if (!canonical) return { changed: false, before, after: before };
    const nextLocation = {
      ...location,
      country: canonical.country,
      countryCode: canonical.countryCode,
    };
    const nextBrief = job.brief?.structuredLocation
      ? {
          ...job.brief,
          structuredLocation: {
            ...job.brief.structuredLocation,
            country: canonical.country,
            countryCode: canonical.countryCode,
          },
        }
      : job.brief;
    const briefChanged =
      job.brief?.structuredLocation?.countryCode !== canonical.countryCode ||
      job.brief?.structuredLocation?.country !== canonical.country;
    if (
      location.countryCode === canonical.countryCode &&
      location.country === canonical.country &&
      !briefChanged
    ) {
      return {
        changed: false,
        before,
        after: canonical.countryCode,
      };
    }
    const now = Date.now();
    await ctx.db.patch("jobs", args.jobId, {
      structuredLocation: nextLocation,
      ...(nextBrief ? { brief: nextBrief } : {}),
      updatedAt: now,
    });
    await ctx.db.insert("jobEvents", {
      jobId: args.jobId,
      ownerId: job.ownerId,
      cycleId: job.currentCycleId,
      eventType: "country_code_repaired",
      message:
        "Normalized the stored country code from " +
        before +
        " to " +
        canonical.countryCode +
        " using the country name " +
        canonical.country +
        ".",
      createdAt: now,
    });
    return {
      changed: true,
      before,
      after: canonical.countryCode,
    };
  },
});

/**
 * Owner control for continuous quote recovery: enable (opt-in with explicit
 * settings), disable, or change the wait window. Enabling requires an
 * approved mandate; terminal decisions (select/takeover/cancel/complete)
 * and pauses are handled by their own mutations via syncRecoverySchedule.
 */
export const setContinuousRecovery = mutation({
  args: {
    jobId: v.id("jobs"),
    enabled: v.boolean(),
    quoteTarget: v.optional(quoteTargetValidator),
    responseWindowHours: v.optional(responseWindowValidator),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const ownerId = await requireUserId(ctx);
    const job = await ctx.db.get("jobs", args.jobId);
    if (!job || job.ownerId !== ownerId) {
      throw new Error("Job not found.");
    }
    if (args.enabled) {
      if (!job.brief || !job.autonomy?.enabled) {
        throw new Error(
          "Approve the project brief and operating mandate before enabling automatic searching.",
        );
      }
      if (
        job.executionStatus === "paused" ||
        job.status === "paused" ||
        Boolean(job.pausedFromStatus)
      ) {
        throw new Error(
          "Resume this project before enabling automatic searching.",
        );
      }
      if (job.executionStatus === "cancelled" || job.status === "cancelled") {
        throw new Error("This request has been cancelled.");
      }
      if (job.executionStatus === "completed" || job.status === "completed") {
        throw new Error("This request has already been completed.");
      }
      if (job.selectedCandidateId || job.continuationMode === "user_takeover") {
        throw new Error(
          "A provider decision is already active for this request.",
        );
      }
      const now = Date.now();
      await ctx.db.patch("jobs", args.jobId, {
        autonomy: {
          ...job.autonomy,
          quoteTarget: normalizeQuoteTarget(
            args.quoteTarget ?? job.autonomy.quoteTarget,
          ),
          responseWindowHours: normalizeResponseWindowHours(
            args.responseWindowHours ?? job.autonomy.responseWindowHours,
          ),
          continuousRecoveryEnabled: true,
        },
        recoveryEnabled: true,
        updatedAt: now,
      });
      // Invalidate any stale callbacks, then arm exactly one deadline.
      await ctx.runMutation(internal.jobs.stopRecoverySchedule, {
        jobId: args.jobId,
        ownerId,
        bumpGeneration: true,
      });
      const target = normalizeQuoteTarget(
        args.quoteTarget ?? job.autonomy.quoteTarget,
      );
      await ctx.runMutation(internal.jobs.armRecoverySchedule, {
        jobId: args.jobId,
        ownerId,
      });
      await ctx.db.insert("jobEvents", {
        jobId: args.jobId,
        ownerId,
        eventType: "recovery_enabled",
        message:
          "Automatic searching is on: Findor will keep looking for new providers until " +
          target +
          " quotes arrive or you stop it.",
        createdAt: now,
      });
      return null;
    }
    const now = Date.now();
    await ctx.db.patch("jobs", args.jobId, {
      autonomy: job.autonomy
        ? {
            ...job.autonomy,
            quoteTarget: normalizeQuoteTarget(
              args.quoteTarget ?? job.autonomy.quoteTarget,
            ),
            responseWindowHours: normalizeResponseWindowHours(
              args.responseWindowHours ?? job.autonomy.responseWindowHours,
            ),
            continuousRecoveryEnabled: false,
          }
        : job.autonomy,
      updatedAt: now,
    });
    await ctx.runMutation(internal.jobs.stopRecoverySchedule, {
      jobId: args.jobId,
      ownerId,
      bumpGeneration: true,
      message:
        "Automatic searching stopped. Already-contacted providers may still reply; no new providers will be contacted.",
    });
    return null;
  },
});

function controlEventMessage(status: string) {
  return status === "paused"
    ? "This request is paused. No new external action will start until you resume it."
    : status === "cancelled"
      ? "This request was cancelled. No further external action will start."
      : status === "completed"
        ? "This request was marked complete by you."
        : status === "needs_user"
          ? "Findor stopped at a human decision boundary. Review the request before continuing."
          : "This request is active.";
}

function assertControlAvailable(job: Doc<"jobs"> | null) {
  if (!job) throw new Error("Job not found.");
  if (job.activeOperation) {
    throw new Error(
      "This step is still in progress. Wait for it to finish before changing the job.",
    );
  }
}

async function cancelPendingFollowUps(
  ctx: MutationCtx,
  jobId: Doc<"jobs">["_id"],
  ownerId: Doc<"jobs">["ownerId"],
  excludeCandidateId?: Doc<"providerCandidates">["_id"],
  reason: string = "The request was closed before the planned follow-up.",
) {
  const messages = await ctx.db
    .query("outreachMessages")
    .withIndex("by_job_and_createdAt", (q) => q.eq("jobId", jobId))
    .take(50);
  for (const message of messages) {
    if (
      message.ownerId !== ownerId ||
      message.purpose !== "initial" ||
      !["scheduling", "scheduled", "due"].includes(message.followUpState ?? "") ||
      (excludeCandidateId && message.candidateId === excludeCandidateId)
    ) {
      continue;
    }
    if (message.followUpScheduledFunctionId) {
      try {
        await ctx.scheduler.cancel(message.followUpScheduledFunctionId);
      } catch {
        // The callback may already be running; its own authoritative recheck remains required.
      }
    }
    await ctx.db.patch("outreachMessages", message._id, {
      followUpState: "cancelled",
      nextFollowUpAt: undefined,
      followUpScheduledFunctionId: undefined,
      followUpFailureReason: reason,
      updatedAt: Date.now(),
    });
  }
}
/** Terminal owner decisions end continuous recovery explicitly: the flag is
 *  cleared so no future deadline can arm, and any pending deadline is
 *  cancelled. In-flight follow-ups already sent under policy are preserved. */
async function stopContinuousForTerminalDecision(
  ctx: MutationCtx,
  job: Doc<"jobs">,
  ownerId: Doc<"users">["_id"],
  message: string,
) {
  const now = Date.now();
  if (job.autonomy) {
    await ctx.db.patch("jobs", job._id, {
      autonomy: { ...job.autonomy, continuousRecoveryEnabled: false },
      updatedAt: now,
    });
  }
  const fresh = await ctx.db.get("jobs", job._id);
  if (fresh) {
    await cancelRecoveryScheduler(ctx, fresh);
    await ctx.db.patch("jobs", job._id, {
      nextRecoveryAt: undefined,
      recoverySchedulerId: undefined,
      recoveryGeneration: (fresh.recoveryGeneration ?? 0) + 1,
      updatedAt: now,
    });
    if (fresh.nextRecoveryAt != null || fresh.recoverySchedulerId != null) {
      await ctx.db.insert("jobEvents", {
        jobId: job._id,
        ownerId,
        eventType: "recovery_stopped",
        message,
        createdAt: now,
      });
    }
  }
}

export const pause = mutation({
  args: { jobId: v.id("jobs") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const ownerId = await requireUserId(ctx);
    const job = await ctx.db.get("jobs", args.jobId);
    if (!job || job.ownerId !== ownerId) throw new Error("Job not found.");
    const isPaused = job.executionStatus === "paused" || job.status === "paused";
    if (isPaused) return null;
    if (
      job.executionStatus === "cancelled" ||
      job.status === "cancelled" ||
      job.executionStatus === "completed" ||
      job.status === "completed"
    ) {
      throw new Error("This request is already closed.");
    }
    assertControlAvailable(job);
    const now = Date.now();
    await ctx.db.patch("jobs", args.jobId, {
      status: "paused",
      executionStatus: "paused",
      pausedFromStatus: job.status === "paused" ? (job.pausedFromStatus ?? "brief_ready") : job.status,
      updatedAt: now,
    });
    await ctx.db.insert("jobEvents", {
      jobId: args.jobId,
      ownerId,
      eventType: "job_paused",
      message: controlEventMessage("paused"),
      createdAt: now,
    });
    await ctx.runMutation(internal.jobs.syncRecoverySchedule, {
      jobId: args.jobId,
      ownerId,
    });
    return null;
  },
});

export const resume = mutation({
  args: { jobId: v.id("jobs") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const ownerId = await requireUserId(ctx);
    const job = await ctx.db.get("jobs", args.jobId);
    if (!job || job.ownerId !== ownerId) throw new Error("Job not found.");
    const isPaused =
      job.executionStatus === "paused" ||
      job.status === "paused" ||
      Boolean(job.pausedFromStatus);
    if (!isPaused)
      throw new Error("Only a paused request can be resumed.");
    const restoredStatus =
      job.pausedFromStatus === "researching"
        ? "brief_approved"
        : (job.pausedFromStatus ?? "brief_ready");
    const now = Date.now();
    await ctx.db.patch("jobs", args.jobId, {
      status: restoredStatus,
      executionStatus: "active",
      pausedFromStatus: undefined,
      updatedAt: now,
    });
    await ctx.db.insert("jobEvents", {
      jobId: args.jobId,
      ownerId,
      eventType: "job_resumed",
      message:
        "You resumed this request. Findor will wait for your next explicit step.",
      createdAt: now,
    });
    if (job.recoveryEnabled && !["needs_info", "brief_ready"].includes(restoredStatus)) {
      await ctx.scheduler.runAfter(0, internal.outreach.scheduleRecoveryChecksForJob, {
        jobId: args.jobId,
        ownerId,
      });
    }
    await ctx.runMutation(internal.jobs.syncRecoverySchedule, {
      jobId: args.jobId,
      ownerId,
    });
    return null;
  },
});

export const cancel = mutation({
  args: { jobId: v.id("jobs") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const ownerId = await requireUserId(ctx);
    const job = await ctx.db.get("jobs", args.jobId);
    if (!job || job.ownerId !== ownerId) throw new Error("Job not found.");
    if (job.executionStatus === "cancelled" || job.status === "cancelled") return null;
    if (job.executionStatus === "completed" || job.status === "completed")
      throw new Error("A completed request cannot be cancelled.");
    assertControlAvailable(job);
    const now = Date.now();
    await ctx.db.patch("jobs", args.jobId, {
      status: "cancelled",
      executionStatus: "cancelled",
      pausedFromStatus: undefined,
      updatedAt: now,
    });
    if (job.currentCycleId) {
      await ctx.db.patch("jobCycles", job.currentCycleId, {
        status: "cancelled",
        endedAt: now,
        updatedAt: now,
      });
      await ctx.db.insert("jobEvents", {
        jobId: args.jobId,
        ownerId,
        cycleId: job.currentCycleId,
        eventType: "cycle_cancelled",
        message: "Cycle cancelled.",
        createdAt: now,
      });
    }
    await cancelPendingFollowUps(ctx, args.jobId, ownerId);
    await stopContinuousForTerminalDecision(
      ctx,
      job,
      ownerId,
      "This project was cancelled. Automatic searching stopped.",
    );
    await ctx.db.insert("jobEvents", {
      jobId: args.jobId,
      ownerId,
      eventType: "job_cancelled",
      message: controlEventMessage("cancelled"),
      createdAt: now,
    });
    return null;
  },
});

export const complete = mutation({
  args: { jobId: v.id("jobs") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const ownerId = await requireUserId(ctx);
    const job = await ctx.db.get("jobs", args.jobId);
    if (!job || job.ownerId !== ownerId) throw new Error("Job not found.");
    if (job.executionStatus === "completed" || job.status === "completed") return null;
    if (job.status !== "reply_understood") {
      throw new Error(
        "Review the understood provider reply before marking this request complete.",
      );
    }
    assertControlAvailable(job);
    const now = Date.now();
    await ctx.db.patch("jobs", args.jobId, {
      status: "completed",
      executionStatus: "completed",
      pausedFromStatus: undefined,
      updatedAt: now,
    });
    if (job.currentCycleId) {
      await ctx.db.patch("jobCycles", job.currentCycleId, {
        status: "completed",
        endedAt: now,
        updatedAt: now,
      });
      await ctx.db.insert("jobEvents", {
        jobId: args.jobId,
        ownerId,
        cycleId: job.currentCycleId,
        eventType: "cycle_completed",
        message: "Cycle marked complete.",
        createdAt: now,
      });
    }
    await cancelPendingFollowUps(ctx, args.jobId, ownerId);
    await stopContinuousForTerminalDecision(
      ctx,
      job,
      ownerId,
      "This project was marked complete. Automatic searching stopped.",
    );
    await ctx.db.insert("jobEvents", {
      jobId: args.jobId,
      ownerId,
      eventType: "job_completed",
      message: controlEventMessage("completed"),
      createdAt: now,
    });
    return null;
  },
});

export const prepareCycle = mutation({
  args: {
    jobId: v.id("jobs"),
    briefVersion: v.optional(v.number()),
    maxProviders: v.optional(v.number()),
  },
  returns: v.id("jobCycles"),
  handler: async (ctx, args) => {
    const ownerId = await requireUserId(ctx);
    const job = await ctx.db.get("jobs", args.jobId);
    if (!job || job.ownerId !== ownerId) throw new Error("Job not found.");
    assertControlAvailable(job);

    const targetBriefVersion = args.briefVersion ?? job.currentBriefVersion ?? 1;
    const briefDoc = await ctx.db
      .query("briefVersions")
      .withIndex("by_job_and_version", (q) =>
        q.eq("jobId", args.jobId).eq("version", targetBriefVersion),
      )
      .unique();

    if (!briefDoc && !job.brief) {
      throw new Error("Cannot prepare cycle without a valid brief.");
    }

    const existingCycles = await ctx.db
      .query("jobCycles")
      .withIndex("by_job_and_cycleNumber", (q) => q.eq("jobId", args.jobId))
      .order("desc")
      .take(1);

    const hasPriorLegacyActivity =
      Boolean(job.briefApprovedAt) ||
      (job.currentBriefVersion ?? 1) > 1;

    const nextCycleNumber =
      existingCycles.length > 0
        ? existingCycles[0].cycleNumber + 1
        : hasPriorLegacyActivity
          ? 2
          : 1;

    const maxProviders = clampProviderCount(
      args.maxProviders ?? job.autonomy?.maxProviders,
    );
    const now = Date.now();

    const cycleId = await ctx.db.insert("jobCycles", {
      ownerId,
      jobId: args.jobId,
      cycleNumber: nextCycleNumber,
      briefVersion: targetBriefVersion,
      mandateSnapshot: mandateSnapshot(
        job.autonomy ?? {
          enabled: true,
          maxProviders,
          allowInitialOutreach: true,
          allowRoutineClarifications: true,
          allowFollowUp: true,
          maxFollowUps: 1,
          preference: "balanced",
        },
        false,
      ),
      maxProviders,
      status: "draft",
      recoveryEnabled: job.recoveryEnabled ?? true,
      recoveryDiscoveryCycles: 0,
      createdAt: now,
      updatedAt: now,
    });

    await ctx.db.insert("jobEvents", {
      jobId: args.jobId,
      ownerId,
      cycleId,
      eventType: "cycle_prepared",
      message: `Cycle ${nextCycleNumber} draft prepared (brief v${targetBriefVersion}, up to ${maxProviders} providers).`,
      createdAt: now,
    });

    return cycleId;
  },
});

export const approveCycle = mutation({
  args: {
    jobId: v.id("jobs"),
    cycleId: v.id("jobCycles"),
    maxProviders: v.optional(v.number()),
    preference: v.optional(autonomyPreferenceValidator),
    includePreviouslyContacted: v.optional(v.boolean()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const ownerId = await requireUserId(ctx);
    const job = await ctx.db.get("jobs", args.jobId);
    if (!job || job.ownerId !== ownerId) throw new Error("Job not found.");
    assertControlAvailable(job);

    const cycle = await ctx.db.get("jobCycles", args.cycleId);
    if (!cycle || cycle.ownerId !== ownerId || cycle.jobId !== args.jobId) {
      throw new Error("Cycle not found.");
    }
    if (cycle.status !== "draft" && cycle.status !== "awaiting_approval") {
      throw new Error("Cycle is already active or finished.");
    }

    const maxProviders = clampProviderCount(
      args.maxProviders ?? cycle.maxProviders,
    );
    const preference =
      args.preference ?? cycle.mandateSnapshot.preference ?? "balanced";
    const includePreviouslyContacted =
      args.includePreviouslyContacted ?? false;
    const now = Date.now();

    const autonomy = {
      enabled: true,
      maxProviders,
      allowInitialOutreach: true,
      allowRoutineClarifications: true,
      allowFollowUp: true,
      maxFollowUps: 1,
      preference,
      includePreviouslyContacted,
      approvedAt: now,
    };

    await ctx.db.patch("jobCycles", cycle._id, {
      status: "active",
      maxProviders,
      startedAt: now,
      mandateSnapshot: autonomy,
      updatedAt: now,
    });

    await ctx.db.patch("jobs", args.jobId, {
      currentCycleId: cycle._id,
      currentBriefVersion: cycle.briefVersion,
      status: "brief_approved",
      autonomy,
      briefApprovedAt: now,
      recoveryEnabled: true,
      recoveryDiscoveryCycles: 0,
      pausedFromStatus: undefined,
      updatedAt: now,
    });

    await ctx.db.insert("jobEvents", {
      jobId: args.jobId,
      ownerId,
      cycleId: cycle._id,
      eventType: "cycle_approved",
      message: `You approved Cycle ${cycle.cycleNumber} (brief v${cycle.briefVersion}, max ${maxProviders} providers, include previously contacted: ${includePreviouslyContacted ? "yes" : "no"}).`,
      createdAt: now,
    });

    await ctx.db.insert("jobEvents", {
      jobId: args.jobId,
      ownerId,
      cycleId: cycle._id,
      eventType: "cycle_started",
      message: `Cycle ${cycle.cycleNumber} started finding options.`,
      createdAt: now + 1,
    });

    return null;
  },
});

export const editBriefVersion = mutation({
  args: {
    jobId: v.id("jobs"),
    ...intakeArgs,
    reason: v.optional(v.union(v.literal("edit"), v.literal("rerun"))),
  },
  returns: v.number(),
  handler: async (ctx, args) => {
    const ownerId = await requireUserId(ctx);
    const job = await ctx.db.get("jobs", args.jobId);
    if (!job || job.ownerId !== ownerId) throw new Error("Job not found.");
    assertControlAvailable(job);

    const now = Date.now();
    const analysis = analyzeIntake(args);
    if (!analysis.brief) {
      throw new Error(
        "Cannot create a brief version with missing required fields.",
      );
    }

    const existingVersions = await ctx.db
      .query("briefVersions")
      .withIndex("by_job_and_version", (q) => q.eq("jobId", args.jobId))
      .order("desc")
      .take(1);

    const newVersion =
      (existingVersions[0]?.version ?? job.currentBriefVersion ?? 1) + 1;
    const reason = args.reason ?? "edit";

    await insertBriefVersion(
      ctx,
      args.jobId,
      ownerId,
      analysis,
      newVersion,
      reason,
      now,
    );

    const isPaused =
      job.executionStatus === "paused" ||
      job.status === "paused" ||
      Boolean(job.pausedFromStatus);
    const nextStatus = isPaused ? "paused" : "brief_ready";
    const nextPausedFromStatus = isPaused ? "brief_ready" : undefined;

    await ctx.db.patch("jobs", args.jobId, {
      ...analysis.cleaned,
      status: nextStatus,
      executionStatus: isPaused ? "paused" : (job.executionStatus ?? "active"),
      ...(isPaused
        ? { pausedFromStatus: nextPausedFromStatus }
        : { pausedFromStatus: undefined }),
      missingFields: analysis.missingFields,
      brief: analysis.brief,
      currentBriefVersion: newVersion,
      briefApprovedAt: undefined,
      updatedAt: now,
    });

    return newVersion;
  },
});

export const getCycleHistory = query({
  args: { jobId: v.id("jobs") },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    const job = await ctx.db.get("jobs", args.jobId);
    if (!job || job.ownerId !== userId) return [];

    const isJobPaused =
      job.executionStatus === "paused" ||
      job.status === "paused" ||
      Boolean(job.pausedFromStatus);

    const cycles = await ctx.db
      .query("jobCycles")
      .withIndex("by_job_and_cycleNumber", (q) => q.eq("jobId", args.jobId))
      .order("asc")
      .take(50);

    const briefVersions = await ctx.db
      .query("briefVersions")
      .withIndex("by_job_and_version", (q) => q.eq("jobId", args.jobId))
      .take(50);

    const briefVersionMap = new Map(briefVersions.map((b) => [b.version, b]));

    const candidates = await ctx.db
      .query("providerCandidates")
      .withIndex("by_job_and_discoveredAt", (q) => q.eq("jobId", args.jobId))
      .take(100);

    const outreachMessages = await ctx.db
      .query("outreachMessages")
      .withIndex("by_job_and_createdAt", (q) => q.eq("jobId", args.jobId))
      .take(100);

    const responses = await ctx.db
      .query("providerResponses")
      .withIndex("by_jobId_and_createdAt", (q) => q.eq("jobId", args.jobId))
      .take(100);

    const result: Array<{
      cycle: any;
      briefVersion: Doc<"briefVersions"> | null;
      candidateCount: number;
      outreachCount: number;
      responseCount: number;
      responses: Doc<"providerResponses">[];
    }> = [];

    const hasCycle1 = cycles.some((c) => c.cycleNumber === 1);
    if (!hasCycle1) {
      const briefDoc = briefVersionMap.get(1) ?? null;
      const cycle1Candidates = candidates.filter(
        (c) => !c.cycleId,
      );
      const cycle1Outreach = outreachMessages.filter(
        (o) => !o.cycleId,
      );
      const cycle1Responses = responses.filter(
        (r) => !r.cycleId,
      );

      result.push({
        cycle: {
          _id: null,
          _creationTime: job.createdAt,
          ownerId: job.ownerId,
          jobId: job._id,
          cycleNumber: 1,
          briefVersion: 1,
          mandateSnapshot: mandateSnapshot(
            job.autonomy ?? {
              enabled: true,
              maxProviders: 3,
              allowInitialOutreach: true,
              allowRoutineClarifications: true,
              allowFollowUp: true,
              maxFollowUps: 1,
              preference: "balanced",
            },
            false,
          ),
          maxProviders: job.autonomy?.maxProviders ?? 3,
          startedAt: job.briefApprovedAt ?? job.createdAt,
          endedAt:
            ["completed", "cancelled"].includes(job.status) ||
            job.executionStatus === "cancelled" ||
            job.executionStatus === "completed"
              ? job.updatedAt
              : undefined,
          status: isJobPaused
            ? ("paused" as const)
            : ["completed", "cancelled"].includes(job.status) ||
                job.executionStatus === "cancelled" ||
                job.executionStatus === "completed"
              ? ((job.executionStatus ?? job.status) as "completed" | "cancelled")
              : cycle1Responses.length > 0
                ? ("options_ready" as const)
                : cycles.length > 0
                  ? ("completed" as const)
                  : ("active" as const),
          outcomeSummary:
            cycle1Responses.length > 0
              ? `${cycle1Responses.length} option(s) ready`
              : undefined,
          recoveryEnabled: job.recoveryEnabled ?? true,
          recoveryDiscoveryCycles: job.recoveryDiscoveryCycles ?? 0,
          createdAt: job.createdAt,
          updatedAt: job.updatedAt,
        },
        briefVersion: briefDoc,
        candidateCount: cycle1Candidates.length,
        outreachCount: cycle1Outreach.length,
        responseCount: cycle1Responses.length,
        responses: cycle1Responses,
      });
    }

    for (const cycle of cycles) {
      const cycleCandidates = candidates.filter(
        (c) => c.cycleId === cycle._id || (!c.cycleId && cycle.cycleNumber === 1),
      );
      const cycleOutreach = outreachMessages.filter(
        (o) => o.cycleId === cycle._id || (!o.cycleId && cycle.cycleNumber === 1),
      );
      const cycleResponses = responses.filter(
        (r) => r.cycleId === cycle._id || (!r.cycleId && cycle.cycleNumber === 1),
      );
      const isCycleActive = !cycle.endedAt && (cycle.status === "active" || !cycle.status);
      const effectiveCycle =
        isJobPaused && isCycleActive
          ? { ...cycle, status: "paused" as const }
          : cycle;
      result.push({
        cycle: effectiveCycle,
        briefVersion: briefVersionMap.get(cycle.briefVersion) ?? null,
        candidateCount: cycleCandidates.length,
        outreachCount: cycleOutreach.length,
        responseCount: cycleResponses.length,
        responses: cycleResponses,
      });
    }

    return result;
  },
});

export const repairZeroContactableCycles = mutation({
  args: { jobId: v.id("jobs") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const ownerId = await requireUserId(ctx);
    const job = await ctx.db.get("jobs", args.jobId);
    if (!job || job.ownerId !== ownerId) throw new Error("Job not found.");
    if (job.status !== "providers_ready") return null;

    const candidates = await ctx.db
      .query("providerCandidates")
      .withIndex("by_job_and_discoveredAt", (q) => q.eq("jobId", args.jobId))
      .take(50);
    const cycleCandidates = job.currentCycleId
      ? candidates.filter((c) => c.cycleId === job.currentCycleId)
      : candidates;
    const contactable = cycleCandidates.filter(
      (c) => isProviderEntity(c) && hasSourceBackedPublicBusinessEmail(c),
    );

    if (contactable.length === 0) {
      const now = Date.now();
      if (job.currentCycleId) {
        await ctx.db.patch("jobCycles", job.currentCycleId, {
          status: "exhausted_no_options",
          outcomeSummary: "0 contactable providers found",
          endedAt: now,
          updatedAt: now,
        });
      }
      await ctx.db.patch("jobs", args.jobId, {
        status: "needs_user",
        autonomyStopReason:
          "No contactable providers with verified public business email routes were found for this attempt.",
        activeOperation: undefined,
        updatedAt: now,
      });
      await ctx.db.insert("jobEvents", {
        jobId: args.jobId,
        ownerId,
        cycleId: job.currentCycleId,
        eventType: "cycle_exhausted_no_options",
        message:
          "Provider research completed with 0 contactable providers. Findor did not contact any provider or guess an email address.",
        createdAt: now,
      });
    }
    return null;
  },
});

export const internalRepairZeroContactableCycles = internalMutation({
  args: { jobId: v.id("jobs") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const job = await ctx.db.get("jobs", args.jobId);
    if (!job) throw new Error("Job not found.");
    if (job.status !== "providers_ready") return null;

    const candidates = await ctx.db
      .query("providerCandidates")
      .withIndex("by_job_and_discoveredAt", (q) => q.eq("jobId", args.jobId))
      .take(50);
    const cycleCandidates = job.currentCycleId
      ? candidates.filter((c) => c.cycleId === job.currentCycleId)
      : candidates;
    const contactable = cycleCandidates.filter(
      (c) => isProviderEntity(c) && hasSourceBackedPublicBusinessEmail(c),
    );

    if (contactable.length === 0) {
      const now = Date.now();
      if (job.currentCycleId) {
        await ctx.db.patch("jobCycles", job.currentCycleId, {
          status: "exhausted_no_options",
          outcomeSummary: "0 contactable providers found",
          endedAt: now,
          updatedAt: now,
        });
      }
      await ctx.db.patch("jobs", args.jobId, {
        status: "needs_user",
        autonomyStopReason:
          "No contactable providers with verified public business email routes were found for this attempt.",
        activeOperation: undefined,
        updatedAt: now,
      });
      await ctx.db.insert("jobEvents", {
        jobId: args.jobId,
        ownerId: job.ownerId,
        cycleId: job.currentCycleId,
        eventType: "cycle_exhausted_no_options",
        message:
          "Provider research completed with 0 contactable providers. Findor did not contact any provider or guess an email address.",
        createdAt: now,
      });
    }
    return null;
  },
});

export const internalAuditJob = internalQuery({
  args: { jobId: v.id("jobs") },
  returns: v.any(),
  handler: async (ctx, args) => {
    const job = await ctx.db.get("jobs", args.jobId);
    if (!job) return null;

    const cycles = await ctx.db
      .query("jobCycles")
      .withIndex("by_job_and_cycleNumber", (q) => q.eq("jobId", args.jobId))
      .collect();

    const candidates = await ctx.db
      .query("providerCandidates")
      .withIndex("by_job_and_discoveredAt", (q) => q.eq("jobId", args.jobId))
      .collect();

    const messages = await ctx.db
      .query("outreachMessages")
      .withIndex("by_job_and_createdAt", (q) => q.eq("jobId", args.jobId))
      .collect();

    const events = await ctx.db
      .query("jobEvents")
      .withIndex("by_job_and_createdAt", (q) => q.eq("jobId", args.jobId))
      .order("desc")
      .take(10);

    return {
      job: {
        id: job._id,
        jobTitle: job.jobTitle,
        status: job.status,
        executionStatus: job.executionStatus,
        autonomyStopReason: job.autonomyStopReason,
        currentBriefVersion: job.currentBriefVersion,
        currentCycleId: job.currentCycleId,
        activeOperation: job.activeOperation,
      },
      cyclesCount: cycles.length,
      cycles: cycles.map((c) => ({
        id: c._id,
        cycleNumber: c.cycleNumber,
        briefVersion: c.briefVersion,
        status: c.status,
        outcomeSummary: c.outcomeSummary,
        maxProviders: c.maxProviders,
      })),
      candidatesCount: candidates.length,
      candidates: candidates.map((c) => ({
        id: c._id,
        name: c.name,
        contactEmail: c.contactEmail,
        isEntity: isProviderEntity(c),
        cycleId: c.cycleId,
      })),
      messagesCount: messages.length,
      recentEvents: events.map((e) => ({
        eventType: e.eventType,
        message: e.message,
      })),
    };
  },
});

export const selectProvider = mutation({
  args: {
    jobId: v.id("jobs"),
    candidateId: v.id("providerCandidates"),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const ownerId = await requireUserId(ctx);
    const job = await ctx.db.get("jobs", args.jobId);
    if (!job || job.ownerId !== ownerId) throw new Error("Job not found.");
    if (job.executionStatus === "cancelled" || job.executionStatus === "completed") {
      throw new Error("Cannot select provider on a closed request.");
    }
    const candidate = await ctx.db.get("providerCandidates", args.candidateId);
    if (!candidate || candidate.jobId !== args.jobId || candidate.ownerId !== ownerId) {
      throw new Error("Provider candidate not found.");
    }

    const now = Date.now();
    // Cancel/pause pending automated follow-ups for ALL non-selected providers in this job/cycle
    await cancelPendingFollowUps(
      ctx,
      args.jobId,
      ownerId,
      args.candidateId,
      `Provider ${candidate.name} was selected; alternative follow-up cancelled.`,
    );

    await ctx.db.patch("jobs", args.jobId, {
      selectedCandidateId: args.candidateId,
      continuationMode: undefined,
      updatedAt: now,
    });

    await ctx.db.insert("jobEvents", {
      jobId: args.jobId,
      ownerId,
      cycleId: job.currentCycleId,
      eventType: "provider_selected",
      message: `You selected ${candidate.name} to continue. Follow-ups for alternative providers stopped.`,
      createdAt: now,
    });
    await stopContinuousForTerminalDecision(
      ctx,
      job,
      ownerId,
      "A provider was selected. Automatic searching stopped.",
    );

    return null;
  },
});

export const setContinuationMode = mutation({
  args: {
    jobId: v.id("jobs"),
    mode: v.union(v.literal("findor_assisted"), v.literal("user_takeover")),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const ownerId = await requireUserId(ctx);
    const job = await ctx.db.get("jobs", args.jobId);
    if (!job || job.ownerId !== ownerId) throw new Error("Job not found.");
    if (job.executionStatus === "cancelled" || job.executionStatus === "completed") {
      throw new Error("Cannot update continuation on a closed request.");
    }
    if (!job.selectedCandidateId) {
      throw new Error("Select a provider before choosing how to continue.");
    }
    const candidate = await ctx.db.get("providerCandidates", job.selectedCandidateId);
    const providerName = candidate?.name || "the provider";

    const now = Date.now();
    if (args.mode === "user_takeover") {
      await cancelPendingFollowUps(
        ctx,
        args.jobId,
        ownerId,
        undefined,
        "You took over the project directly; all Findor follow-ups stopped.",
      );
      await ctx.db.patch("jobs", args.jobId, {
        continuationMode: "user_takeover",
        updatedAt: now,
      });
      await ctx.db.insert("jobEvents", {
        jobId: args.jobId,
        ownerId,
        cycleId: job.currentCycleId,
        eventType: "user_takeover",
        message: `You chose to take over directly with ${providerName}. Autonomous follow-ups stopped.`,
        createdAt: now,
      });
      await stopContinuousForTerminalDecision(
        ctx,
        job,
        ownerId,
        "You took over the project directly. Automatic searching stopped.",
      );
    } else {
      await cancelPendingFollowUps(
        ctx,
        args.jobId,
        ownerId,
        job.selectedCandidateId,
        `Continuing with ${providerName}; alternative follow-up cancelled.`,
      );
      await ctx.db.patch("jobs", args.jobId, {
        continuationMode: "findor_assisted",
        updatedAt: now,
      });
      await ctx.db.insert("jobEvents", {
        jobId: args.jobId,
        ownerId,
        cycleId: job.currentCycleId,
        eventType:
          job.continuationMode === "user_takeover"
            ? "let_findor_help_again"
            : "continuation_selected",
        message:
          job.continuationMode === "user_takeover"
            ? `You re-enabled Findor assistance for ${providerName}.`
            : `You chose to continue with Findor assisting routine communication with ${providerName}.`,
        createdAt: now,
      });
    }

    return null;
  },
});

export const clearSelectedProvider = mutation({
  args: { jobId: v.id("jobs") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const ownerId = await requireUserId(ctx);
    const job = await ctx.db.get("jobs", args.jobId);
    if (!job || job.ownerId !== ownerId) throw new Error("Job not found.");

    const now = Date.now();
    await ctx.db.patch("jobs", args.jobId, {
      selectedCandidateId: undefined,
      continuationMode: undefined,
      updatedAt: now,
    });

    await ctx.db.insert("jobEvents", {
      jobId: args.jobId,
      ownerId,
      cycleId: job.currentCycleId,
      eventType: "let_findor_help_again",
      message: "You returned to the provider comparison.",
      createdAt: now,
    });

    return null;
  },
});

export const askProviderQuestion = mutation({
  args: {
    jobId: v.id("jobs"),
    question: v.string(),
    forceApproveConsequential: v.optional(v.boolean()),
  },
  returns: v.object({
    status: v.union(v.literal("sent"), v.literal("needs_approval")),
    reason: v.optional(v.string()),
    question: v.string(),
  }),
  handler: async (ctx, args) => {
    const ownerId = await requireUserId(ctx);
    const job = await ctx.db.get("jobs", args.jobId);
    if (!job || job.ownerId !== ownerId) throw new Error("Job not found.");
    if (job.executionStatus === "paused" || job.status === "paused") {
      throw new Error("This request is currently paused. Resume it before sending questions.");
    }
    if (job.executionStatus === "cancelled" || job.executionStatus === "completed") {
      throw new Error("This request is already closed.");
    }
    if (job.continuationMode === "user_takeover") {
      throw new Error(
        "Findor communication is stopped while you manage the provider directly. Click 'Let Findor help again' to resume Findor assistance.",
      );
    }
    if (!job.selectedCandidateId) {
      throw new Error("Select a provider before asking questions.");
    }

    const candidate = await ctx.db.get("providerCandidates", job.selectedCandidateId);
    if (!candidate || candidate.jobId !== args.jobId || candidate.ownerId !== ownerId) {
      throw new Error("Provider candidate not found.");
    }

    const trimmedQuestion = args.question.trim();
    if (!trimmedQuestion) {
      throw new Error("Question cannot be empty.");
    }

    const category = classifyAutonomyQuestion(trimmedQuestion);
    const now = Date.now();

    if (category === "needs_user" && !args.forceApproveConsequential) {
      const stopReason = autonomyStopReason(trimmedQuestion);
      await ctx.db.insert("jobEvents", {
        jobId: args.jobId,
        ownerId,
        cycleId: job.currentCycleId,
        eventType: "consequential_action_blocked",
        message: stopReason,
        createdAt: now,
      });
      return {
        status: "needs_approval" as const,
        reason: stopReason,
        question: trimmedQuestion,
      };
    }

    const outreachList = await ctx.db
      .query("outreachMessages")
      .withIndex("by_job_and_createdAt", (q) => q.eq("jobId", args.jobId))
      .order("desc")
      .take(20);
    const candidateOutreach = outreachList.find(
      (m) => m.candidateId === candidate._id,
    );

    const responses = await ctx.db
      .query("providerResponses")
      .withIndex("by_jobId_and_createdAt", (q) => q.eq("jobId", args.jobId))
      .take(20);
    const candidateResponse = responses.find(
      (r) => r.providerId === candidate._id,
    );

    const targetEmail = candidate.contactEmail || candidateOutreach?.providerEmail;
    if (!targetEmail) {
      throw new Error(
        "This provider does not have a verified public business email route for questions.",
      );
    }

    const baseSubject = candidateOutreach?.subject || `Inquiry: ${job.jobTitle}`;
    const subject = baseSubject.toLowerCase().startsWith("re:")
      ? baseSubject
      : "Re: " + baseSubject;

    const body = [
      "Hello,",
      "",
      trimmedQuestion,
      "",
      "This is an inquiry sent at the customer's request via Findor. It does not authorize work, a quote acceptance, booking, payment, or a contract without subsequent explicit confirmation.",
      "",
      "Thank you,",
      "Sent via Findor",
    ].join("\n");

    const clarificationId = await ctx.db.insert("clarificationDrafts", {
      ownerId,
      jobId: args.jobId,
      attribute: trimmedQuestion.slice(0, 80),
      reason: args.forceApproveConsequential
        ? "Explicitly approved inquiry"
        : "Routine inquiry",
      proposedMessage: trimmedQuestion,
      sourceResponseId: candidateResponse?._id ?? (candidate._id as any),
      comparisonResponseId: candidateResponse?._id ?? (candidate._id as any),
      cycleId: job.currentCycleId,
      status: "approved",
      createdAt: now,
      updatedAt: now,
    });

    await ctx.db.insert("outreachMessages", {
      jobId: args.jobId,
      ownerId,
      candidateId: candidate._id,
      cycleId: job.currentCycleId,
      status: "approved",
      purpose: "routine_clarification",
      clarificationId,
      providerEmail: targetEmail,
      subject,
      body,
      sendAttemptCount: 0,
      createdAt: now,
      updatedAt: now,
    });

    await ctx.db.insert("jobEvents", {
      jobId: args.jobId,
      ownerId,
      cycleId: job.currentCycleId,
      eventType: args.forceApproveConsequential
        ? "consequential_action_approved"
        : "routine_question_sent",
      message: args.forceApproveConsequential
        ? `Explicitly approved question sent to ${candidate.name}: "${trimmedQuestion}"`
        : `Routine question sent to ${candidate.name}: "${trimmedQuestion}"`,
      createdAt: now,
    });

    await ctx.scheduler.runAfter(0, internal.outreach.sendRoutineClarification, {
      clarificationId,
      ownerId,
    });

    return {
      status: "sent" as const,
      question: trimmedQuestion,
    };
  },
});
