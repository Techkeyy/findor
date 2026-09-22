import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import {
  action,
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  query,
  ActionCtx,
  MutationCtx,
  QueryCtx,
} from "./_generated/server";
import { env } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";

async function requireUserId(ctx: QueryCtx | MutationCtx | ActionCtx) {
  const userId = await getAuthUserId(ctx);
  if (!userId) {
    throw new Error("You must be signed in to manage provider research.");
  }
  return userId;
}
import {
  classifyProviderSource,
  effectiveCountryCode,
  extractBusinessLeadsFromDiscoveryText,
  formatExternalServiceArea,
  hasSourceBackedPublicBusinessEmail,
  isProviderEntity,
  mergeProviderEvidence,
  providerIdentityKey,
  type ProviderEntityType,
} from "./providerQuality";
import { MAX_RECOVERY_DISCOVERY_CYCLES } from "./autonomy";

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
const structuredLocationForActionValidator = v.object({
  country: v.string(),
  countryCode: v.string(),
  region: v.optional(v.string()),
  city: v.string(),
  locality: v.optional(v.string()),
  postalCode: v.optional(v.string()),
});
const contactDiscoveryStatusValidator = v.union(
  v.literal("unresolved"),
  v.literal("resolved"),
  v.literal("failed"),
);

const candidateValidator = v.object({
  _id: v.id("providerCandidates"),
  _creationTime: v.number(),
  jobId: v.id("jobs"),
  ownerId: v.id("users"),
  cycleId: v.optional(v.id("jobCycles")),
  name: v.string(),
  url: v.string(),
  description: v.string(),
  entityType: v.optional(
    v.union(v.literal("provider"), v.literal("discovery_source")),
  ),
  contactability: v.union(v.literal("email_found"), v.literal("website_only")),
  contactEmail: v.optional(v.string()),
  contactDiscoveryStatus: v.optional(contactDiscoveryStatusValidator),
  contactDiscoveryCheckedAt: v.optional(v.number()),
  contactDiscoveryError: v.optional(v.string()),
  evidence: v.array(
    v.object({
      sourceUrl: v.string(),
      claim: v.string(),
    }),
  ),
  discoveredAt: v.number(),
});

const candidateInputValidator = v.object({
  name: v.string(),
  url: v.string(),
  description: v.string(),
  entityType: v.optional(
    v.union(v.literal("provider"), v.literal("discovery_source")),
  ),
  contactability: v.union(v.literal("email_found"), v.literal("website_only")),
  contactEmail: v.optional(v.string()),
  evidence: v.array(
    v.object({
      sourceUrl: v.string(),
      claim: v.string(),
    }),
  ),
});

const researchResultValidator = v.object({
  candidateCount: v.number(),
  websiteOnlyCount: v.number(),
});

const contactDiscoveryResultValidator = v.object({
  providerCount: v.number(),
  emailFoundCount: v.number(),
  unresolvedCount: v.number(),
  failedCount: v.number(),
  checkedPageCount: v.number(),
});

// Bounded internal-page traversal per provider domain: homepage plus
// top-scoring internal pages only. Never crawls whole sites.
const MAX_INTERNAL_CONTACT_PAGES = 5;

const autonomyValidator = v.object({
  enabled: v.boolean(),
  maxProviders: v.number(),
  allowInitialOutreach: v.boolean(),
  allowRoutineClarifications: v.boolean(),
  allowFollowUp: v.boolean(),
  maxFollowUps: v.number(),
  preference: v.union(
    v.literal("balanced"),
    v.literal("price"),
    v.literal("earliest_availability"),
    v.literal("complete_quote"),
  ),
  includePreviouslyContacted: v.optional(v.boolean()),
  approvedAt: v.number(),
  quoteTarget: v.optional(v.union(v.literal(1), v.literal(2), v.literal(3))),
  responseWindowHours: v.optional(
    v.union(v.literal(1), v.literal(3), v.literal(6), v.literal(12), v.literal(24)),
  ),
  continuousRecoveryEnabled: v.optional(v.boolean()),
});

const autonomousResultValidator = v.object({
  providerCount: v.number(),
  emailFoundCount: v.number(),
  unresolvedCount: v.number(),
  failedCount: v.number(),
  checkedPageCount: v.number(),
  queuedCount: v.number(),
  sentCount: v.number(),
  failedSendCount: v.number(),
});

const eventMessage = {
  started: "Provider research started with the approved local-service brief.",
  completed:
    "Provider research completed. Each result includes its source evidence and contactability.",
  failed:
    "Provider research could not complete. No provider was presented as verified.",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function textValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export function findPublicBusinessEmail(markdown: string) {
  const matches = markdown.matchAll(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi);
  for (const match of matches) {
    const email = match[0].toLowerCase();
    if (
      email.includes("example.com") ||
      email.includes("sentry.io") ||
      email.startsWith("noreply@") ||
      email.startsWith("no-reply@") ||
      email.startsWith("donotreply@")
    ) {
      continue;
    }

    const localPart = email.split("@", 1)[0];
    const domain = email.split("@")[1] ?? "";
    if (/\.(?:gif|jpe?g|png|svg|webp|ico|css|js)$/i.test(domain)) {
      continue;
    }
    const contextStart = Math.max(0, (match.index ?? 0) - 140);
    const contextEnd = Math.min(
      markdown.length,
      (match.index ?? 0) + email.length + 140,
    );
    const context = markdown.slice(contextStart, contextEnd);
    const genericBusinessMailbox =
      /^(info|contact|office|hello|sales|support|service|estimate|estimates|quote|quotes|team|inquiries|enquiries)$/i.test(
        localPart,
      );
    const explicitBusinessRoute =
      /contact us|general inquiries|business inquiries|email us|request (a )?quote|request an estimate|get (a )?quote|free estimate|office|sales|support|service/i.test(
        context,
      );
    if (genericBusinessMailbox || explicitBusinessRoute) {
      return email;
    }
  }
  return undefined;
}
export function buildResearchQuery(job: {
  serviceCategory: string;
  serviceLocation: string;
  structuredLocation?: {
    country?: string;
    countryCode?: string;
    region?: string;
    city?: string;
    locality?: string;
    postalCode?: string;
  } | null;
  naturalLanguageDescription: string;
}) {
  const safeLocation = formatExternalServiceArea(
    job.structuredLocation,
    job.serviceLocation,
  );
  return `${job.serviceCategory} company in ${safeLocation} official website contact`;
}
function isRelevantSearchResult(
  rawResult: Record<string, unknown>,
  serviceCategory: string,
  serviceLocation: string,
  naturalLanguageDescription: string,
) {
  const corpus = [
    textValue(rawResult.title),
    textValue(rawResult.description),
    textValue(rawResult.markdown),
    textValue(rawResult.url),
  ]
    .join(" ")
    .toLowerCase();
  const stopWords = new Set([
    "about",
    "after",
    "area",
    "and",
    "been",
    "for",
    "from",
    "have",
    "into",
    "near",
    "need",
    "that",
    "the",
    "this",
    "what",
    "with",
  ]);
  const serviceTokens = Array.from(
    new Set(
      (serviceCategory + " " + naturalLanguageDescription)
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((token) => token.length >= 4 && !stopWords.has(token)),
    ),
  );
  const locationTokens = serviceLocation
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 3);
  const serviceMatch =
    serviceTokens.length === 0 ||
    serviceTokens.some((token) => corpus.includes(token));
  const locationMatch =
    locationTokens.length === 0 ||
    locationTokens.some((token) => corpus.includes(token));
  const serviceAreaSignal =
    /service area|areas served|areas we serve|serves the/i.test(corpus);

  return serviceMatch && (locationMatch || serviceAreaSignal);
}

function classifySearchResult(
  rawResult: Record<string, unknown>,
  url: string,
): ProviderEntityType {
  return classifyProviderSource({
    url,
    title: textValue(rawResult.title),
    description: textValue(rawResult.description),
    markdown: textValue(rawResult.markdown),
  });
}

function evidenceClaim(
  description: string,
  markdown: string,
  contactEmail?: string,
) {
  if (!contactEmail) return description.slice(0, 320);

  const emailIndex = markdown.toLowerCase().indexOf(contactEmail.toLowerCase());
  if (emailIndex < 0) return description.slice(0, 320);

  const excerptStart = Math.max(0, emailIndex - 120);
  const excerptEnd = Math.min(
    markdown.length,
    emailIndex + contactEmail.length + 120,
  );
  const excerpt = markdown
    .slice(excerptStart, excerptEnd)
    .replace(/\s+/g, " ")
    .trim();
  return `${description.slice(0, 220)} Public contact evidence: ${excerpt}`.slice(
    0,
    520,
  );
}

function parseCandidates(
  payload: unknown,
  job: {
    serviceCategory: string;
    serviceLocation: string;
    naturalLanguageDescription: string;
  },
) {
  if (
    !isRecord(payload) ||
    !isRecord(payload.data) ||
    !Array.isArray(payload.data.web)
  ) {
    return [];
  }

  const candidates: Array<{
    name: string;
    url: string;
    description: string;
    entityType: ProviderEntityType;
    contactability: "email_found" | "website_only";
    contactEmail?: string;
    evidence: Array<{ sourceUrl: string; claim: string }>;
  }> = [];
  const seenUrls = new Set<string>();

  for (const rawResult of payload.data.web) {
    if (!isRecord(rawResult)) continue;
    const url = textValue(rawResult.url);
    if (!/^https?:\/\//i.test(url) || seenUrls.has(url)) continue;
    if (
      !isRelevantSearchResult(
        rawResult,
        job.serviceCategory,
        job.serviceLocation,
        job.naturalLanguageDescription,
      )
    )
      continue;
    const entityType = classifySearchResult(rawResult, url);
    seenUrls.add(url);

    let hostname = "public provider page";
    try {
      hostname = new URL(url).hostname;
    } catch {
      continue;
    }
    const name = textValue(rawResult.title) || hostname;
    const description =
      textValue(rawResult.description) ||
      textValue(rawResult.markdown).replace(/\s+/g, " ").slice(0, 320) ||
      "Firecrawl returned this page for the local-service search.";
    const markdown = textValue(rawResult.markdown);
    const contactEmail =
      entityType === "provider" ? findPublicBusinessEmail(markdown) : undefined;
    candidates.push({
      name: name.slice(0, 160),
      url,
      description: description.slice(0, 420),
      entityType,
      contactability: contactEmail ? "email_found" : "website_only",
      ...(contactEmail ? { contactEmail } : {}),
      evidence: [
        {
          sourceUrl: url,
          claim: evidenceClaim(description, markdown, contactEmail),
        },
      ],
    });

    if (candidates.length >= 8) break;
  }

  return candidates;
}



type MappedContactLink = {
  url: string;
  title: string;
  description: string;
};

function canonicalOrigin(rawUrl: string) {
  try {
    return new URL(rawUrl).origin;
  } catch {
    return null;
  }
}

function parseMapLinks(payload: unknown, origin: string) {
  if (!isRecord(payload) || !Array.isArray(payload.links)) return [];

  const links: MappedContactLink[] = [];
  for (const rawLink of payload.links) {
    if (!isRecord(rawLink)) continue;
    const url = textValue(rawLink.url);
    if (!/^https?:\/\//i.test(url)) continue;
    try {
      const parsed = new URL(url);
      if (parsed.origin !== origin) continue;
      if (/\.(pdf|jpg|jpeg|png|gif|webp|svg|xml|zip)$/i.test(parsed.pathname))
        continue;
      links.push({
        url,
        title: textValue(rawLink.title),
        description: textValue(rawLink.description),
      });
    } catch {
      continue;
    }
  }
  return links;
}

function contactLinkScore(link: MappedContactLink) {
  const pathAndText = (
    link.url +
    " " +
    link.title +
    " " +
    link.description
  ).toLowerCase();
  let score = 0;
  if (/\/contact(?:-us)?\/?(?:$|[?#])/i.test(link.url)) score += 120;
  if (/\/(?:about|about-us|team)\/?(?:$|[?#])/i.test(link.url)) score += 90;
  if (/\/(?:estimate|quote|get-started|request)\/?(?:$|[?#])/i.test(link.url))
    score += 85;
  if (
    /\/(?:company|locations?|service-area|areas-served|privacy-policy|privacy)\/?(?:$|[?#])/i.test(
      link.url,
    )
  )
    score += 60;
  if (
    /contact|email|quote|estimate|about|team|office|service area|company|service|location|privacy/i.test(
      pathAndText,
    )
  )
    score += 35;
  return score;
}

export function selectContactPages(payload: unknown, candidateUrl: string) {
  const origin = canonicalOrigin(candidateUrl);
  if (!origin) return [];

  const mapped = parseMapLinks(payload, origin)
    .map((link) => ({ link, score: contactLinkScore(link) }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score)
    .map((entry) => entry.link.url);

  // Bounded traversal: homepage plus top-scoring internal pages only.
  const urls = [origin + "/", ...mapped];
  return Array.from(new Set(urls)).slice(0, MAX_INTERNAL_CONTACT_PAGES);
}

async function firecrawlJson(
  endpoint: string,
  firecrawlKey: string,
  body: Record<string, unknown>,
) {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: "Bearer " + firecrawlKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(
      "Firecrawl request failed with status " + response.status + ".",
    );
  }
  return payload;
}

function contactEvidenceClaim(markdown: string, email: string) {
  const emailIndex = markdown.toLowerCase().indexOf(email.toLowerCase());
  const excerptStart = Math.max(0, emailIndex - 160);
  const excerptEnd = Math.min(markdown.length, emailIndex + email.length + 160);
  const excerpt = markdown
    .slice(excerptStart, excerptEnd)
    .replace(/\s+/g, " ")
    .trim();
  return (
    "Public business contact " +
    email +
    " appears in retrieved Firecrawl Markdown: " +
    excerpt
  ).slice(0, 620);
}

function noEmailEvidenceClaim() {
  return "Contact discovery checked this public source page; no public business email was present in the retrieved Firecrawl Markdown.";
}

type ContactLookupResult = {
  contactability: "email_found" | "website_only";
  contactEmail?: string;
  status: "resolved" | "unresolved" | "failed";
  checkedAt: number;
  checkedPageCount: number;
  evidence: Array<{ sourceUrl: string; claim: string }>;
  error?: string;
};

async function investigateContactUrl(
  candidateUrl: string,
  firecrawlKey: string,
  countryCode?: string,
): Promise<ContactLookupResult> {
  const origin = canonicalOrigin(candidateUrl);
  if (!origin) {
    return {
      contactability: "website_only" as const,
      status: "failed" as const,
      checkedAt: Date.now(),
      checkedPageCount: 0,
      evidence: [],
      error: "The provider source URL was malformed.",
    };
  }
  // Country-agnostic crawl locale: the job's own country when known,
  // otherwise Firecrawl's default (never a hardcoded foreign country).
  const crawlLocation =
    countryCode && /^[A-Z]{2}$/.test(countryCode)
      ? { country: countryCode }
      : undefined;

  try {
    const mapPayload = await firecrawlJson(
      "https://api.firecrawl.dev/v2/map",
      firecrawlKey,
      {
        url: origin + "/",
        search: "contact email estimate quote about privacy company location",
        sitemap: "include",
        includeSubdomains: false,
        ignoreQueryParameters: true,
        limit: 20,
        ...(crawlLocation ? { location: crawlLocation } : {}),
        timeout: 60000,
      },
    );
    const pages = selectContactPages(mapPayload, candidateUrl);
    const evidence: Array<{ sourceUrl: string; claim: string }> = [];
    let checkedPageCount = 0;

    for (const pageUrl of pages) {
      try {
        const scrapePayload = await firecrawlJson(
          "https://api.firecrawl.dev/v2/scrape",
          firecrawlKey,
          {
            url: pageUrl,
            formats: ["markdown"],
            onlyMainContent: false,
            ...(crawlLocation ? { location: crawlLocation } : {}),
            timeout: 60000,
          },
        );
        checkedPageCount += 1;
        const markdown =
          isRecord(scrapePayload) &&
          isRecord(scrapePayload.data) &&
          typeof scrapePayload.data.markdown === "string"
            ? scrapePayload.data.markdown
            : "";
        const email = findPublicBusinessEmail(markdown);
        if (email) {
          return {
            contactability: "email_found" as const,
            contactEmail: email,
            status: "resolved" as const,
            checkedAt: Date.now(),
            checkedPageCount,
            evidence: [
              {
                sourceUrl: pageUrl,
                claim: contactEvidenceClaim(markdown, email),
              },
            ],
          };
        }
        evidence.push({ sourceUrl: pageUrl, claim: noEmailEvidenceClaim() });
      } catch {
        evidence.push({
          sourceUrl: pageUrl,
          claim:
            "Contact discovery could not retrieve this public source page; no contactability claim was made.",
        });
      }
    }

    return {
      contactability: "website_only" as const,
      status: "unresolved" as const,
      checkedAt: Date.now(),
      checkedPageCount,
      evidence,
    };
  } catch {
    return {
      contactability: "website_only" as const,
      status: "failed" as const,
      checkedAt: Date.now(),
      checkedPageCount: 0,
      evidence: [],
      error:
        "Provider contact discovery failed before a source-backed contact route was found.",
    };
  }
}

async function investigateContactCandidate(
  candidate: Pick<Doc<"providerCandidates">, "_id" | "url">,
  firecrawlKey: string,
  countryCode?: string,
) {
  return {
    candidateId: candidate._id,
    ...(await investigateContactUrl(candidate.url, firecrawlKey, countryCode)),
  };
}

const contactUpdateValidator = v.object({
  candidateId: v.id("providerCandidates"),
  contactability: v.union(v.literal("email_found"), v.literal("website_only")),
  contactEmail: v.optional(v.string()),
  status: contactDiscoveryStatusValidator,
  checkedAt: v.number(),
  checkedPageCount: v.number(),
  evidence: v.array(
    v.object({
      sourceUrl: v.string(),
      claim: v.string(),
    }),
  ),
  error: v.optional(v.string()),
});

export const listWebsiteOnlyCandidates = internalQuery({
  args: { jobId: v.id("jobs"), ownerId: v.id("users") },
  returns: v.array(candidateValidator),
  handler: async (ctx, args) => {
    const job = await ctx.db.get("jobs", args.jobId);
    if (
      !job ||
      job.ownerId !== args.ownerId ||
      job.status !== "providers_ready"
    )
      return [];

    const candidates = await ctx.db
      .query("providerCandidates")
      .withIndex("by_job_and_discoveredAt", (q) => q.eq("jobId", args.jobId))
      .order("desc")
      .take(10);
    return candidates.filter(
      (candidate) =>
        isProviderEntity(candidate) &&
        (candidate.contactability === "website_only" ||
          !hasSourceBackedPublicBusinessEmail(candidate)),
    );
  },
});

export const markContactDiscoveryStarted = internalMutation({
  args: { jobId: v.id("jobs"), ownerId: v.id("users") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const job = await ctx.db.get("jobs", args.jobId);
    if (
      !job ||
      job.ownerId !== args.ownerId ||
      job.status !== "providers_ready" ||
      job.activeOperation
    ) {
      throw new Error("Provider contact discovery is not ready for this job.");
    }
    await ctx.db.patch("jobs", args.jobId, {
      activeOperation: "contact_discovery",
      updatedAt: Date.now(),
    });
    await ctx.db.insert("jobEvents", {
      jobId: args.jobId,
      ownerId: args.ownerId,
      eventType: "contact_discovery_started",
      message:
        "Bounded public contact discovery started for website-only providers.",
      createdAt: Date.now(),
    });
    return null;
  },
});

export const saveContactDiscovery = internalMutation({
  args: {
    jobId: v.id("jobs"),
    ownerId: v.id("users"),
    updates: v.array(contactUpdateValidator),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const job = await ctx.db.get("jobs", args.jobId);
    if (
      !job ||
      job.ownerId !== args.ownerId ||
      job.status !== "providers_ready" ||
      job.activeOperation !== "contact_discovery"
    ) {
      throw new Error(
        "Provider contact discovery is no longer active for this job.",
      );
    }

    let emailFoundCount = 0;
    let unresolvedCount = 0;
    let failedCount = 0;
    for (const update of args.updates) {
      const candidate = await ctx.db.get(
        "providerCandidates",
        update.candidateId,
      );
      if (
        !candidate ||
        candidate.jobId !== args.jobId ||
        candidate.ownerId !== args.ownerId
      ) {
        continue;
      }

      if (update.contactability === "email_found") emailFoundCount += 1;
      if (update.status === "unresolved") unresolvedCount += 1;
      if (update.status === "failed") failedCount += 1;

      const mergedEvidence = mergeProviderEvidence(
        candidate.evidence,
        update.evidence,
        12,
      );
      const evidenceChanged =
        mergedEvidence.length !== candidate.evidence.length ||
        mergedEvidence.some(
          (item, index) =>
            item.sourceUrl !== candidate.evidence[index]?.sourceUrl ||
            item.claim !== candidate.evidence[index]?.claim,
        );
      const patch: {
        contactability: "email_found" | "website_only";
        contactDiscoveryStatus: "unresolved" | "resolved" | "failed";
        contactDiscoveryCheckedAt: number;
        evidence?: Array<{ sourceUrl: string; claim: string }>;
        contactEmail?: string;
        contactDiscoveryError?: string;
      } = {
        contactability: update.contactability,
        contactDiscoveryStatus: update.status,
        contactDiscoveryCheckedAt: update.checkedAt,
      };
      if (evidenceChanged) {
        patch.evidence = mergedEvidence;
      }
      if (update.contactEmail) patch.contactEmail = update.contactEmail;
      if (update.error) patch.contactDiscoveryError = update.error;
      await ctx.db.patch("providerCandidates", candidate._id, patch);
    }

    await ctx.db.patch("jobs", args.jobId, {
      activeOperation: undefined,
      updatedAt: Date.now(),
    });
    await ctx.db.insert("jobEvents", {
      jobId: args.jobId,
      ownerId: args.ownerId,
      eventType: "contact_discovery_completed",
      message:
        "Bounded contact discovery completed: " +
        emailFoundCount +
        " public email route(s), " +
        unresolvedCount +
        " unresolved provider(s), " +
        failedCount +
        " failed provider check(s).",
      createdAt: Date.now(),
    });
    return null;
  },
});

export const markContactDiscoveryFailed = internalMutation({
  args: { jobId: v.id("jobs"), ownerId: v.id("users") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const job = await ctx.db.get("jobs", args.jobId);
    if (
      !job ||
      job.ownerId !== args.ownerId ||
      job.activeOperation !== "contact_discovery"
    )
      return null;
    const now = Date.now();
    await ctx.db.patch("jobs", args.jobId, {
      activeOperation: undefined,
      updatedAt: now,
    });
    await ctx.db.insert("jobEvents", {
      jobId: args.jobId,
      ownerId: args.ownerId,
      eventType: "contact_discovery_failed",
      message:
        "Public contact discovery failed. No contactability claim was made.",
      createdAt: now,
    });
    return null;
  },
});
export const list = query({
  args: { jobId: v.id("jobs") },
  returns: v.array(candidateValidator),
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];
    const job = await ctx.db.get("jobs", args.jobId);
    if (!job || job.ownerId !== userId) return [];

    const candidates = await ctx.db
      .query("providerCandidates")
      .withIndex("by_job_and_discoveredAt", (q) => q.eq("jobId", args.jobId))
      .order("desc")
      .take(50);

    if (job.currentCycleId) {
      const cycleFiltered = candidates.filter((c) => c.cycleId === job.currentCycleId);
      if (cycleFiltered.length > 0) {
        return cycleFiltered.slice(0, 10);
      }
    }
    return candidates.slice(0, 10);
  },
});

export const getJobForAction = internalQuery({
  args: { jobId: v.id("jobs"), ownerId: v.id("users") },
  returns: v.union(
    v.null(),
    v.object({
      ownerId: v.id("users"),
      serviceCategory: v.string(),
      serviceLocation: v.string(),
      naturalLanguageDescription: v.string(),
      structuredLocation: v.optional(structuredLocationForActionValidator),
      status: statusValidator,
      currentBriefVersion: v.optional(v.number()),
      currentCycleId: v.optional(v.id("jobCycles")),
      activeOperation: v.optional(v.string()),
      autonomy: v.optional(autonomyValidator),
    }),
  ),
  handler: async (ctx, args) => {
    const job = await ctx.db.get("jobs", args.jobId);
    if (!job || job.ownerId !== args.ownerId) return null;
    return {
      ownerId: job.ownerId,
      serviceCategory: job.serviceCategory,
      serviceLocation: job.serviceLocation,
      naturalLanguageDescription: job.naturalLanguageDescription,
      ...(job.structuredLocation
        ? { structuredLocation: job.structuredLocation }
        : {}),
      status: job.status,
      currentBriefVersion: job.currentBriefVersion,
      currentCycleId: job.currentCycleId,
      activeOperation: job.activeOperation,
      ...(job.autonomy ? { autonomy: job.autonomy } : {}),
    };
  },
});

export const getIdempotentCycleSummary = internalQuery({
  args: { jobId: v.id("jobs"), ownerId: v.id("users") },
  returns: autonomousResultValidator,
  handler: async (ctx, args) => {
    const job = await ctx.db.get("jobs", args.jobId);
    if (!job || job.ownerId !== args.ownerId) {
      return {
        providerCount: 0,
        emailFoundCount: 0,
        unresolvedCount: 0,
        failedCount: 0,
        checkedPageCount: 0,
        queuedCount: 0,
        sentCount: 0,
        failedSendCount: 0,
      };
    }
    const candidates = await ctx.db
      .query("providerCandidates")
      .withIndex("by_job_and_discoveredAt", (q) => q.eq("jobId", args.jobId))
      .take(50);
    const cycleCandidates = job.currentCycleId
      ? candidates.filter((c) => c.cycleId === job.currentCycleId)
      : candidates;
    const outreach = await ctx.db
      .query("outreachMessages")
      .withIndex("by_job_and_createdAt", (q) => q.eq("jobId", args.jobId))
      .take(50);
    const cycleOutreach = job.currentCycleId
      ? outreach.filter((m) => m.cycleId === job.currentCycleId)
      : outreach;
    const initialOutreach = cycleOutreach.filter(
      (m) => !m.purpose || m.purpose === "initial",
    );
    const sentCount = initialOutreach.filter((m) => m.status === "sent").length;
    const failedSendCount = initialOutreach.filter(
      (m) => m.status === "failed" || m.status === "delivery_failed",
    ).length;
    const emailFoundCount = cycleCandidates.filter(
      (c) => isProviderEntity(c) && c.contactability === "email_found",
    ).length;
    const unresolvedCount = cycleCandidates.filter(
      (c) => c.contactDiscoveryStatus === "unresolved",
    ).length;
    const failedCount = cycleCandidates.filter(
      (c) => c.contactDiscoveryStatus === "failed",
    ).length;

    return {
      providerCount: cycleCandidates.length,
      emailFoundCount,
      unresolvedCount,
      failedCount,
      checkedPageCount: cycleCandidates.filter((c) => Boolean(c.contactDiscoveryCheckedAt)).length,
      queuedCount: initialOutreach.length,
      sentCount,
      failedSendCount,
    };
  },
});

export const markResearching = internalMutation({
  args: { jobId: v.id("jobs"), ownerId: v.id("users") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const job = await ctx.db.get("jobs", args.jobId);
    if (!job || job.ownerId !== args.ownerId) {
      throw new Error("Job not found.");
    }
    if (job.status === "researching") {
      return null;
    }
    if (job.status !== "brief_approved") {
      throw new Error("This job is not ready for provider research.");
    }

    const now = Date.now();
    await ctx.db.patch("jobs", args.jobId, {
      status: "researching",
      activeOperation: "provider_search",
      updatedAt: now,
    });
    await ctx.db.insert("jobEvents", {
      jobId: args.jobId,
      ownerId: args.ownerId,
      cycleId: job.currentCycleId,
      eventType: "research_started",
      message: eventMessage.started,
      createdAt: now,
    });
    return null;
  },
});

export const saveResults = internalMutation({
  args: {
    jobId: v.id("jobs"),
    ownerId: v.id("users"),
    candidates: v.array(candidateInputValidator),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const job = await ctx.db.get("jobs", args.jobId);
    if (!job || job.ownerId !== args.ownerId || job.status !== "researching") {
      throw new Error("Provider research is no longer active for this job.");
    }

    const previous = await ctx.db
      .query("providerCandidates")
      .withIndex("by_job_and_discoveredAt", (q) => q.eq("jobId", args.jobId))
      .take(50);
    for (const candidate of previous) {
      if (
        (job.currentCycleId && candidate.cycleId === job.currentCycleId) ||
        (!job.currentCycleId && !candidate.cycleId)
      ) {
        await ctx.db.delete("providerCandidates", candidate._id);
      }
    }

    const discoveredAt = Date.now();
    for (const candidate of args.candidates) {
      await ctx.db.insert("providerCandidates", {
        ...candidate,
        jobId: args.jobId,
        ownerId: args.ownerId,
        ...(job.currentCycleId ? { cycleId: job.currentCycleId } : {}),
        discoveredAt,
      });
    }

    await ctx.db.patch("jobs", args.jobId, {
      status: "providers_ready",
      activeOperation: undefined,
      updatedAt: discoveredAt,
    });
    await ctx.db.insert("jobEvents", {
      jobId: args.jobId,
      ownerId: args.ownerId,
      cycleId: job.currentCycleId,
      eventType: "research_completed",
      message:
        args.candidates.length > 0
          ? eventMessage.completed
          : "Provider research completed, but no source-backed candidates were found for this area.",
      createdAt: discoveredAt,
    });
    return null;
  },
});

export const markResearchFailed = internalMutation({
  args: { jobId: v.id("jobs"), ownerId: v.id("users") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const job = await ctx.db.get("jobs", args.jobId);
    if (!job || job.ownerId !== args.ownerId) {
      return null;
    }
    if (job.status !== "researching" && job.status !== "providers_ready") {
      return null;
    }

    const now = Date.now();
    await ctx.db.patch("jobs", args.jobId, {
      status: "needs_user",
      activeOperation: undefined,
      autonomyStopReason:
        "We couldn't finish searching for providers right now. Your request is safe, and you can try again.",
      updatedAt: now,
    });
    await ctx.db.insert("jobEvents", {
      jobId: args.jobId,
      ownerId: args.ownerId,
      cycleId: job.currentCycleId,
      eventType: "research_failed",
      message:
        "Provider research could not be completed. Your request is safe and you can try again.",
      createdAt: now,
    });
    return null;
  },
});

const recoveryJobValidator = v.object({
  jobId: v.id("jobs"),
  ownerId: v.id("users"),
  serviceCategory: v.string(),
  serviceLocation: v.string(),
  naturalLanguageDescription: v.string(),
  structuredLocation: v.optional(structuredLocationForActionValidator),
  currentCycleId: v.optional(v.id("jobCycles")),
});

const recoverySaveResultValidator = v.object({
  newCandidateCount: v.number(),
  updatedCandidateCount: v.number(),
});

/**
 * Job fetch for continuous-recovery rounds. Unlike the single-shot gate,
 * rounds may legitimately start from waiting states such as needs_user
 * (a prior round exhausted without contactable providers while the owner
 * keeps watching). Only ownership, mandate, and the expected operation
 * are required; the deadline callback owns all other state decisions.
 */
export const getContinuousJobForAction = internalQuery({
  args: { jobId: v.id("jobs"), ownerId: v.id("users") },
  returns: v.union(v.null(), recoveryJobValidator),
  handler: async (ctx, args) => {
    const job = await ctx.db.get("jobs", args.jobId);
    if (
      !job ||
      job.ownerId !== args.ownerId ||
      !job.recoveryEnabled ||
      !job.autonomy?.enabled ||
      job.activeOperation !== "recovery_search" ||
      ["paused", "cancelled", "completed"].includes(job.status)
    ) {
      return null;
    }
    return {
      jobId: job._id,
      ownerId: job.ownerId,
      serviceCategory: job.serviceCategory,
      serviceLocation: job.serviceLocation,
      naturalLanguageDescription: job.naturalLanguageDescription,
      ...(job.structuredLocation
        ? { structuredLocation: job.structuredLocation }
        : {}),
      ...(job.currentCycleId ? { currentCycleId: job.currentCycleId } : {}),
    };
  },
});

export const getRecoveryJobForAction = internalQuery({
  args: { jobId: v.id("jobs"), ownerId: v.id("users") },
  returns: v.union(v.null(), recoveryJobValidator),
  handler: async (ctx, args) => {
    const job = await ctx.db.get("jobs", args.jobId);
    if (
      !job ||
      job.ownerId !== args.ownerId ||
      !job.recoveryEnabled ||
      !job.autonomy?.enabled ||
      job.activeOperation !== "recovery_search" ||
      ["paused", "cancelled", "completed", "needs_user"].includes(job.status)
    ) {
      return null;
    }
    return {
      jobId: job._id,
      ownerId: job.ownerId,
      serviceCategory: job.serviceCategory,
      serviceLocation: job.serviceLocation,
      naturalLanguageDescription: job.naturalLanguageDescription,
      ...(job.structuredLocation
        ? { structuredLocation: job.structuredLocation }
        : {}),
      ...(job.currentCycleId ? { currentCycleId: job.currentCycleId } : {}),
    };
  },
});

export const markRecoverySearchStarted = internalMutation({
  args: { jobId: v.id("jobs"), ownerId: v.id("users") },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const job = await ctx.db.get("jobs", args.jobId);
    if (
      !job ||
      job.ownerId !== args.ownerId ||
      !job.recoveryEnabled ||
      !job.autonomy?.enabled ||
      job.activeOperation ||
      ["paused", "cancelled", "completed", "needs_user"].includes(job.status) ||
      (job.recoveryDiscoveryCycles ?? 0) >= MAX_RECOVERY_DISCOVERY_CYCLES
    ) {
      return false;
    }
    const now = Date.now();
    await ctx.db.patch("jobs", args.jobId, {
      activeOperation: "recovery_search",
      recoveryDiscoveryCycles: (job.recoveryDiscoveryCycles ?? 0) + 1,
      updatedAt: now,
    });
    await ctx.db.insert("jobEvents", {
      jobId: args.jobId,
      ownerId: args.ownerId,
      eventType: "recovery_research_started",
      message: "Looking for another suitable provider.",
      createdAt: now,
    });
    return true;
  },
});

export const saveRecoveryResults = internalMutation({
  args: {
    jobId: v.id("jobs"),
    ownerId: v.id("users"),
    candidates: v.array(candidateInputValidator),
  },
  returns: recoverySaveResultValidator,
  handler: async (ctx, args) => {
    const job = await ctx.db.get("jobs", args.jobId);
    if (
      !job ||
      job.ownerId !== args.ownerId ||
      job.activeOperation !== "recovery_search"
    ) {
      throw new Error("Recovery provider research is no longer active.");
    }

    const existing = await ctx.db
      .query("providerCandidates")
      .withIndex("by_job_and_discoveredAt", (q) => q.eq("jobId", args.jobId))
      .take(40);
    const byIdentity = new Map(
      existing.map((candidate) => [providerIdentityKey(candidate), candidate]),
    );
    let newCandidateCount = 0;
    let updatedCandidateCount = 0;

    for (const candidate of args.candidates) {
      const key = providerIdentityKey(candidate);
      const prior = byIdentity.get(key);
      if (prior) {
        const addedEvidence = candidate.evidence.filter(
          (item) => !prior.evidence.some((existingItem) => existingItem.sourceUrl === item.sourceUrl),
        );
        const upgradesContactability =
          prior.contactability !== "email_found" &&
          candidate.contactability === "email_found" &&
          candidate.contactEmail &&
          candidate.entityType === "provider";
        if (upgradesContactability || addedEvidence.length > 0) {
          await ctx.db.patch("providerCandidates", prior._id, {
            ...(upgradesContactability
              ? {
                  entityType: candidate.entityType,
                  contactability: "email_found" as const,
                  contactEmail: candidate.contactEmail,
                }
              : {}),
            ...(addedEvidence.length > 0
              ? { evidence: prior.evidence.concat(addedEvidence).slice(0, 12) }
              : {}),
          });
          updatedCandidateCount += 1;
        }
        continue;
      }

      const candidateId = await ctx.db.insert("providerCandidates", {
        ...candidate,
        jobId: args.jobId,
        ownerId: args.ownerId,
        discoveredAt: Date.now(),
      });
      byIdentity.set(key, { ...candidate, _id: candidateId } as Doc<"providerCandidates">);
      newCandidateCount += 1;
    }

    const now = Date.now();
    await ctx.db.patch("jobs", args.jobId, {
      activeOperation: undefined,
      updatedAt: now,
    });
    await ctx.db.insert("jobEvents", {
      jobId: args.jobId,
      ownerId: args.ownerId,
      eventType: "recovery_research_completed",
      message:
        newCandidateCount +
        " additional provider candidate(s) found. Findor will use only those that pass the approved provider gate.",
      createdAt: now,
    });
    return { newCandidateCount, updatedCandidateCount };
  },
});

export const markRecoverySearchFailed = internalMutation({
  args: { jobId: v.id("jobs"), ownerId: v.id("users") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const job = await ctx.db.get("jobs", args.jobId);
    if (
      !job ||
      job.ownerId !== args.ownerId ||
      job.activeOperation !== "recovery_search"
    ) {
      return null;
    }
    const now = Date.now();
    await ctx.db.patch("jobs", args.jobId, {
      status: "needs_user",
      activeOperation: undefined,
      autonomyStopReason:
        "Findor could not complete the one bounded recovery search. Review the request before authorizing another search.",
      updatedAt: now,
    });
    await ctx.db.insert("jobEvents", {
      jobId: args.jobId,
      ownerId: args.ownerId,
      eventType: "recovery_research_failed",
      message:
        "The bounded recovery search could not complete. No additional provider was contacted.",
      createdAt: now,
    });
    return null;
  },
});

export const runRecoveryDiscovery = internalAction({
  args: { jobId: v.id("jobs"), ownerId: v.id("users") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const job = await ctx.runQuery(internal.providerResearch.getRecoveryJobForAction, args);
    if (!job) return null;

    const firecrawlKey = env.FIRECRAWL_API_KEY;
    if (!firecrawlKey) {
      await ctx.runMutation(internal.providerResearch.markRecoverySearchFailed, args);
      return null;
    }

    try {
      const payload = await firecrawlJson(
        "https://api.firecrawl.dev/v2/search",
        firecrawlKey,
        {
          query: buildResearchQuery(job),
          limit: 8,
          sources: ["web"],
          location: job.serviceLocation,
          scrapeOptions: { formats: [{ type: "markdown" }] },
        },
      );
      const discovered = parseCandidates(payload, job);
      const candidates = [];
      for (const candidate of discovered) {
        if (candidate.entityType !== "provider") {
          candidates.push(candidate);
          continue;
        }
        const lookup = await investigateContactUrl(
          candidate.url,
          firecrawlKey,
          effectiveCountryCode(job.structuredLocation),
        );
        const contactEvidence = lookup.evidence.slice(0, 5);
        const verifiedByLookup = lookup.contactability === "email_found" && lookup.contactEmail;
        candidates.push({
          ...candidate,
          ...(verifiedByLookup
            ? { contactability: "email_found" as const, contactEmail: lookup.contactEmail }
            : {}),
          evidence: candidate.evidence.concat(contactEvidence).slice(0, 12),
        });
      }

      await ctx.runMutation(internal.providerResearch.saveRecoveryResults, {
        jobId: args.jobId,
        ownerId: args.ownerId,
        candidates,
      });
      await ctx.runMutation(internal.outreach.evaluateRecovery, args);
    } catch {
      await ctx.runMutation(internal.providerResearch.markRecoverySearchFailed, args);
    }
    return null;
  },
});

export const runContinuousDiscovery = internalAction({
  args: { jobId: v.id("jobs"), ownerId: v.id("users") },
  returns: v.null(),
  handler: async (ctx, args) => {
    // One bounded discovery round for continuous quote recovery: same
    // search + contact-verification pipeline as single-shot recovery, but the
    // round tail queues only never-contacted providers (per-cycle cap) and
    // never touches the single-shot recovery accounting.
    const job = await ctx.runQuery(internal.providerResearch.getContinuousJobForAction, args);
    if (!job) return null;
    if (!job.currentCycleId) return null;
    const cycleId = job.currentCycleId;

    const firecrawlKey = env.FIRECRAWL_API_KEY;
    if (!firecrawlKey) {
      await ctx.runMutation(internal.jobs.failContinuousRecoveryRound, {
        jobId: args.jobId,
        ownerId: args.ownerId,
        cycleId,
      });
      return null;
    }

    try {
      const payload = await firecrawlJson(
        "https://api.firecrawl.dev/v2/search",
        firecrawlKey,
        {
          query: buildResearchQuery(job),
          limit: 8,
          sources: ["web"],
          location: job.serviceLocation,
          scrapeOptions: { formats: [{ type: "markdown" }] },
        },
      );
      const discovered = parseCandidates(payload, job);
      const candidates = [];
      for (const candidate of discovered) {
        if (candidate.entityType !== "provider") {
          candidates.push(candidate);
          continue;
        }
        const lookup = await investigateContactUrl(
          candidate.url,
          firecrawlKey,
          effectiveCountryCode(job.structuredLocation),
        );
        const contactEvidence = lookup.evidence.slice(0, 5);
        const verifiedByLookup = lookup.contactability === "email_found" && lookup.contactEmail;
        candidates.push({
          ...candidate,
          ...(verifiedByLookup
            ? { contactability: "email_found" as const, contactEmail: lookup.contactEmail }
            : {}),
          evidence: candidate.evidence.concat(contactEvidence).slice(0, 12),
        });
      }

      await ctx.runMutation(internal.providerResearch.saveRecoveryResults, {
        jobId: args.jobId,
        ownerId: args.ownerId,
        candidates,
      });
      const queued: { queuedCount: number } = await ctx.runMutation(
        internal.outreach.queueRecoveryBatch,
        { jobId: args.jobId, ownerId: args.ownerId },
      );
      if (queued.queuedCount > 0) {
        const sendResult: { sentCount: number; failedSendCount: number } =
          await ctx.runAction(internal.outreach.sendAutonomousBatch, {
          jobId: args.jobId,
          ownerId: args.ownerId,
          });
        await ctx.runMutation(internal.jobs.finalizeContinuousRecoveryRound, {
          jobId: args.jobId,
          ownerId: args.ownerId,
          cycleId,
          failedSendCount: sendResult.failedSendCount,
        });
      } else {
        // Round found nothing new: restore the waiting truth instead of
        // leaving the job in a research state with no sends.
        await ctx.runMutation(internal.providerResearch.restoreWaitingAfterEmptyRound, {
          jobId: args.jobId,
          ownerId: args.ownerId,
        });
        await ctx.runMutation(internal.jobs.finalizeContinuousRecoveryRound, {
          jobId: args.jobId,
          ownerId: args.ownerId,
          cycleId,
        });
      }
    } catch {
      await ctx.runMutation(internal.jobs.failContinuousRecoveryRound, {
        jobId: args.jobId,
        ownerId: args.ownerId,
        cycleId,
      });
    }
    return null;
  },
});

export const restoreWaitingAfterEmptyRound = internalMutation({
  args: { jobId: v.id("jobs"), ownerId: v.id("users") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const job = await ctx.db.get("jobs", args.jobId);
    if (!job || job.ownerId !== args.ownerId) return null;
    const sentInitials = await ctx.db
      .query("outreachMessages")
      .withIndex("by_job_and_createdAt", (q) => q.eq("jobId", args.jobId))
      .take(50);
    const hasSent = sentInitials.some(
      (message) =>
        (!message.purpose || message.purpose === "initial") &&
        message.status === "sent",
    );
    const now = Date.now();
    if (hasSent && job.status !== "outreach_sent") {
      await ctx.db.patch("jobs", args.jobId, {
        status: "outreach_sent",
        activeOperation: undefined,
        autonomyStopReason: undefined,
        updatedAt: now,
      });
    } else if (job.status !== "brief_approved") {
      const neutralReason =
        "This recovery round found no additional contactable providers. Findor keeps watching for replies.";
      const shouldRecordEvent = job.status !== "needs_user";
      await ctx.db.patch("jobs", args.jobId, {
        status: "needs_user",
        activeOperation: undefined,
        autonomyStopReason: neutralReason,
        updatedAt: now,
      });
      if (shouldRecordEvent) {
        await ctx.db.insert("jobEvents", {
          jobId: args.jobId,
          ownerId: args.ownerId,
          cycleId: job.currentCycleId,
          eventType: "cycle_exhausted_no_options",
          message:
            "Recovery round completed with no additional contactable providers. Findor keeps watching for replies.",
          createdAt: now,
        });
      }
    } else if (job.activeOperation) {
      await ctx.db.patch("jobs", args.jobId, {
        activeOperation: undefined,
        updatedAt: now,
      });
    }
    return null;
  },
});

export const beginProviderSearch = mutation({
  args: { jobId: v.id("jobs") },
  returns: v.object({
    started: v.boolean(),
    status: statusValidator,
  }),
  handler: async (ctx, args) => {
    const ownerId = await requireUserId(ctx);
    const job = await ctx.db.get("jobs", args.jobId);
    if (!job || job.ownerId !== ownerId) {
      throw new Error("Job not found.");
    }

    if (
      job.executionStatus === "paused" ||
      job.status === "paused" ||
      Boolean(job.pausedFromStatus)
    ) {
      throw new Error(
        "This request is currently paused. Resume before finding providers.",
      );
    }

    if (job.executionStatus === "cancelled" || job.status === "cancelled") {
      throw new Error("This request has been cancelled.");
    }

    if (job.executionStatus === "completed" || job.status === "completed") {
      throw new Error("This request has already been completed.");
    }

    if (
      !job.brief ||
      !job.autonomy?.enabled ||
      !job.autonomy?.allowInitialOutreach
    ) {
      throw new Error(
        "Approve the project brief and operating mandate before finding providers.",
      );
    }

    // Idempotency: If already researching or running provider search, return safely
    if (job.status === "researching" || job.activeOperation === "provider_search") {
      return { started: true, status: "researching" as const };
    }

    // Idempotency: If search has already finished or progressed past researching
    if (
      [
        "providers_ready",
        "outreach_approved",
        "outreach_sent",
        "reply_received",
        "reply_understood",
        "needs_user",
      ].includes(job.status)
    ) {
      return { started: false, status: job.status as any };
    }

    if (job.status !== "brief_approved") {
      throw new Error("Project must be approved before finding providers.");
    }

    const now = Date.now();
    await ctx.db.patch("jobs", args.jobId, {
      status: "researching",
      activeOperation: "provider_search",
      updatedAt: now,
    });

    const locationStr = formatExternalServiceArea(
      job.structuredLocation,
      job.serviceLocation,
    );

    await ctx.db.insert("jobEvents", {
      jobId: args.jobId,
      ownerId,
      cycleId: job.currentCycleId,
      eventType: "research_started",
      message: `Findor started researching local providers in ${locationStr}.`,
      createdAt: now,
    });

    // Durable Convex scheduler boundary: server continues autonomously even if browser closes
    await ctx.scheduler.runAfter(
      0,
      internal.providerResearch.runAutonomousFinding,
      {
        jobId: args.jobId,
        ownerId,
      },
    );

    return { started: true, status: "researching" as const };
  },
});

export const runAutonomousFinding = internalAction({
  args: { jobId: v.id("jobs"), ownerId: v.id("users") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const job = await ctx.runQuery(internal.providerResearch.getJobForAction, {
      jobId: args.jobId,
      ownerId: args.ownerId,
    });
    if (!job) return null;

    if (
      job.status !== "researching" &&
      job.status !== "brief_approved"
    ) {
      return null;
    }

    const firecrawlKey = env.FIRECRAWL_API_KEY;
    if (!firecrawlKey) {
      await ctx.runMutation(internal.providerResearch.markResearchFailed, {
        jobId: args.jobId,
        ownerId: args.ownerId,
      });
      return null;
    }

    try {
      // 1. Search candidates via Firecrawl
      await ctx.runAction(internal.providerResearch.searchInternal, {
        jobId: args.jobId,
        ownerId: args.ownerId,
      });

      // 2. Discover contacts on public website pages
      await ctx.runAction(
        internal.providerResearch.discoverContactsInternal,
        {
          jobId: args.jobId,
          ownerId: args.ownerId,
        },
      );

      // 3. Queue autonomous outreach (handles maxProviders cap, provider gating, & zero-result resolution)
      const queued: { queuedCount: number; emailFoundCount: number } =
        await ctx.runMutation(
          internal.outreach.queueAutonomousOutreach,
          {
            jobId: args.jobId,
            ownerId: args.ownerId,
          },
        );

      // 4. Dispatch initial exploratory outreach if eligible contactable providers exist
      if (queued.queuedCount > 0) {
        await ctx.runAction(internal.outreach.sendAutonomousBatch, {
          jobId: args.jobId,
          ownerId: args.ownerId,
        });
      }
    } catch (error) {
      console.error("Autonomous provider search failed:", error);
      await ctx.runMutation(internal.providerResearch.markResearchFailed, {
        jobId: args.jobId,
        ownerId: args.ownerId,
      });
    }

    return null;
  },
});

async function resolveBusinessLead(
  leadName: string,
  job: {
    serviceCategory: string;
    serviceLocation: string;
    structuredLocation?: {
      country?: string;
      countryCode?: string;
      region?: string;
      city?: string;
      locality?: string;
      postalCode?: string;
    } | null;
    naturalLanguageDescription: string;
  },
  firecrawlKey: string,
) {
  const loc = job.structuredLocation;
  const city = loc?.city || "";
  const country = loc?.country || "";
  const query = `"${leadName}" ${city} ${country} official website contact`.trim();

  try {
    const response = await fetch("https://api.firecrawl.dev/v2/search", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${firecrawlKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query,
        limit: 3,
        sources: ["web"],
        location: job.serviceLocation,
        scrapeOptions: {
          formats: [{ type: "markdown" }],
        },
      }),
    });

    if (!response.ok) return null;
    const payload: unknown = await response.json().catch(() => null);
    if (
      !isRecord(payload) ||
      !isRecord(payload.data) ||
      !Array.isArray(payload.data.web)
    ) {
      return null;
    }

    for (const rawResult of payload.data.web) {
      if (!isRecord(rawResult)) continue;
      const url = textValue(rawResult.url);
      if (!/^https?:\/\//i.test(url)) continue;

      const entityType = classifySearchResult(rawResult, url);
      // Only accept resolved official provider entities (not discovery sources, aggregators, or social links)
      if (entityType !== "provider") continue;

      const markdown = textValue(rawResult.markdown);
      const contactEmail = findPublicBusinessEmail(markdown);
      const title = textValue(rawResult.title) || leadName;
      const description =
        textValue(rawResult.description) ||
        `Official website for ${leadName}.`;

      return {
        name: title.slice(0, 160),
        url,
        description: description.slice(0, 420),
        entityType: "provider" as const,
        contactability: contactEmail
          ? ("email_found" as const)
          : ("website_only" as const),
        ...(contactEmail ? { contactEmail } : {}),
        evidence: [
          {
            sourceUrl: url,
            claim: evidenceClaim(description, markdown, contactEmail),
          },
        ],
      };
    }
    return null;
  } catch {
    return null;
  }
}

export function shouldContinueProviderDiscovery(
  providerCount: number,
  targetCap: number,
) {
  return providerCount < targetCap;
}

export const searchInternal = internalAction({
  args: { jobId: v.id("jobs"), ownerId: v.id("users") },
  returns: researchResultValidator,
  handler: async (ctx, args) => {
    const job = await ctx.runQuery(internal.providerResearch.getJobForAction, {
      jobId: args.jobId,
      ownerId: args.ownerId,
    });
    if (!job || (job.status !== "brief_approved" && job.status !== "researching")) {
      throw new Error("Approve the job brief before researching providers.");
    }

    const firecrawlKey = env.FIRECRAWL_API_KEY;
    if (!firecrawlKey) {
      throw new Error("Firecrawl is not configured on this Convex deployment.");
    }

    if (job.status === "brief_approved") {
      await ctx.runMutation(internal.providerResearch.markResearching, {
        jobId: args.jobId,
        ownerId: args.ownerId,
      });
    }

    try {
      // Stage 1: High-intent commercial provider search
      const response = await fetch("https://api.firecrawl.dev/v2/search", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${firecrawlKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          query: buildResearchQuery(job),
          limit: 8,
          sources: ["web"],
          location: job.serviceLocation,
          scrapeOptions: {
            formats: [{ type: "markdown" }],
          },
        }),
      });

      if (!response.ok) {
        throw new Error(
          `Firecrawl request failed with status ${response.status}.`,
        );
      }

      const payload: unknown = await response.json();
      const candidates = parseCandidates(payload, job);
      const directProviders = candidates.filter((c) => isProviderEntity(c));

      // Stage 2 & 3: Multi-Stage lead resolution until the approved cap is met.
      // Bounded discovery continues until maxProviders eligible providers are
      // found or the lead-resolution budget (below) is exhausted — finding the
      // first provider must never terminate the loop early.
      const targetCap = Math.min(
        5,
        Math.max(1, Math.floor(job.autonomy?.maxProviders ?? 3)),
      );
      if (shouldContinueProviderDiscovery(directProviders.length, targetCap)) {
        const discoveryCandidates = candidates.filter(
          (c) => c.entityType === "discovery_source",
        );
        const extractedLeadNames: string[] = [];

        for (const disc of discoveryCandidates) {
          const leadsFromDoc = extractBusinessLeadsFromDiscoveryText(
            disc.description + "\n" + (disc.evidence[0]?.claim || ""),
            job.serviceCategory,
          );
          for (const lead of leadsFromDoc) {
            if (
              !extractedLeadNames.includes(lead) &&
              !candidates.some((c) =>
                c.name.toLowerCase().includes(lead.toLowerCase()),
              )
            ) {
              extractedLeadNames.push(lead);
            }
          }
          if (extractedLeadNames.length >= 4) break;
        }

        for (const leadName of extractedLeadNames.slice(0, 4)) {
          const resolvedProvider = await resolveBusinessLead(
            leadName,
            job,
            firecrawlKey,
          );
          if (resolvedProvider) {
            if (!candidates.some((c) => c.url === resolvedProvider.url)) {
              candidates.push(resolvedProvider);
            }
            if (
              !shouldContinueProviderDiscovery(
                candidates.filter((c) => isProviderEntity(c)).length,
                targetCap,
              )
            ) {
              break;
            }
          }
        }
      }

      await ctx.runMutation(internal.providerResearch.saveResults, {
        jobId: args.jobId,
        ownerId: args.ownerId,
        candidates,
      });

      return {
        candidateCount: candidates.length,
        websiteOnlyCount: candidates.filter(
          (candidate) =>
            isProviderEntity(candidate) &&
            candidate.contactability === "website_only",
        ).length,
      };
    } catch (error) {
      await ctx.runMutation(internal.providerResearch.markResearchFailed, {
        jobId: args.jobId,
        ownerId: args.ownerId,
      });
      throw error;
    }
  },
});

export const search = action({
  args: { jobId: v.id("jobs") },
  returns: researchResultValidator,
  handler: async (
    ctx,
    args
  ): Promise<{ candidateCount: number; websiteOnlyCount: number }> => {
    const ownerId = await requireUserId(ctx);
    return await ctx.runAction(internal.providerResearch.searchInternal, {
      jobId: args.jobId,
      ownerId,
    });
  },
});

export const startFindingOptions = action({
  args: { jobId: v.id("jobs") },
  returns: autonomousResultValidator,
  handler: async (ctx, args): Promise<{
    providerCount: number;
    emailFoundCount: number;
    unresolvedCount: number;
    failedCount: number;
    checkedPageCount: number;
    queuedCount: number;
    sentCount: number;
    failedSendCount: number;
  }> => {
    const ownerId = await requireUserId(ctx);
    const job = await ctx.runQuery(internal.providerResearch.getJobForAction, {
      jobId: args.jobId,
      ownerId,
    });
    if (!job) {
      throw new Error("Job not found.");
    }
    if (
      !job.autonomy?.enabled ||
      !job.autonomy.allowInitialOutreach
    ) {
      throw new Error(
        "Approve the Job Brief and operating mandate before finding options.",
      );
    }
    if (job.status !== "brief_approved" && job.status !== "researching") {
      // Idempotency: If this job has already progressed past brief_approved (e.g. researching, providers_ready, outreach_sent, needs_user, completed),
      // return the existing cycle summary without rerunning Firecrawl or creating duplicate events.
      if (
        [
          "providers_ready",
          "outreach_approved",
          "outreach_sent",
          "reply_received",
          "reply_understood",
          "needs_user",
          "completed",
        ].includes(job.status) ||
        Boolean(job.activeOperation)
      ) {
        return await ctx.runQuery(
          internal.providerResearch.getIdempotentCycleSummary,
          { jobId: args.jobId, ownerId },
        );
      }
      throw new Error(
        "Approve the Job Brief and operating mandate before finding options.",
      );
    }

    const searchResult: { candidateCount: number; websiteOnlyCount: number } =
      await ctx.runAction(internal.providerResearch.searchInternal, {
        jobId: args.jobId,
        ownerId,
      });
    const contactResult: {
      providerCount: number;
      emailFoundCount: number;
      unresolvedCount: number;
      failedCount: number;
      checkedPageCount: number;
    } = await ctx.runAction(
      internal.providerResearch.discoverContactsInternal,
      { jobId: args.jobId, ownerId },
    );
    const queued: { queuedCount: number; emailFoundCount: number } =
      await ctx.runMutation(
        internal.outreach.queueAutonomousOutreach,
        {
          jobId: args.jobId,
          ownerId,
        },
      );

    const sendResult: { sentCount: number; failedSendCount: number } =
      await ctx.runAction(internal.outreach.sendAutonomousBatch, {
        jobId: args.jobId,
        ownerId,
      });
    return {
      providerCount: searchResult.candidateCount,
      emailFoundCount: queued.emailFoundCount,
      unresolvedCount: contactResult.unresolvedCount,
      failedCount: contactResult.failedCount,
      checkedPageCount: contactResult.checkedPageCount,
      queuedCount: queued.queuedCount,
      sentCount: sendResult.sentCount,
      failedSendCount: sendResult.failedSendCount,
    };
  },
});

type ContactDiscoverySummary = {
  providerCount: number;
  emailFoundCount: number;
  unresolvedCount: number;
  failedCount: number;
  checkedPageCount: number;
};

export const discoverContactsInternal = internalAction({
  args: { jobId: v.id("jobs"), ownerId: v.id("users") },
  returns: contactDiscoveryResultValidator,
  handler: async (ctx, args): Promise<ContactDiscoverySummary> => {
    const job = await ctx.runQuery(internal.providerResearch.getJobForAction, {
      jobId: args.jobId,
      ownerId: args.ownerId,
    });
    if (!job || job.status !== "providers_ready") {
      throw new Error(
        "Provider discovery must finish before checking public contact pages.",
      );
    }

    const firecrawlKey = env.FIRECRAWL_API_KEY;
    if (!firecrawlKey) {
      throw new Error("Firecrawl is not configured on this Convex deployment.");
    }

    const candidates: Array<Doc<"providerCandidates">> = await ctx.runQuery(
      internal.providerResearch.listWebsiteOnlyCandidates,
      {
        jobId: args.jobId,
        ownerId: args.ownerId,
      },
    );
    await ctx.runMutation(
      internal.providerResearch.markContactDiscoveryStarted,
      {
        jobId: args.jobId,
        ownerId: args.ownerId,
      },
    );

    const updates = [];
    let checkedPageCount = 0;
    try {
      for (const candidate of candidates) {
        const update = await investigateContactCandidate(
          candidate,
          firecrawlKey,
          effectiveCountryCode(job.structuredLocation),
        );
        updates.push(update);
        checkedPageCount += update.checkedPageCount;
      }

      await ctx.runMutation(internal.providerResearch.saveContactDiscovery, {
        jobId: args.jobId,
        ownerId: args.ownerId,
        updates,
      });
    } catch (error) {
      await ctx.runMutation(
        internal.providerResearch.markContactDiscoveryFailed,
        {
          jobId: args.jobId,
          ownerId: args.ownerId,
        },
      );
      throw error;
    }

    return {
      providerCount: candidates.length,
      emailFoundCount: updates.filter(
        (update) => update.contactability === "email_found",
      ).length,
      unresolvedCount: updates.filter(
        (update) => update.status === "unresolved",
      ).length,
      failedCount: updates.filter((update) => update.status === "failed")
        .length,
      checkedPageCount,
    };
  },
});

export const discoverContacts = action({
  args: { jobId: v.id("jobs") },
  returns: contactDiscoveryResultValidator,
  handler: async (ctx, args): Promise<ContactDiscoverySummary> => {
    const ownerId = await requireUserId(ctx);
    return await ctx.runAction(
      internal.providerResearch.discoverContactsInternal,
      {
        jobId: args.jobId,
        ownerId,
      },
    );
  },
});
