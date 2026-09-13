import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import {
  action,
  internalMutation,
  internalQuery,
  query,
  ActionCtx,
} from "./_generated/server";
import { env } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";

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
);
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
  name: v.string(),
  url: v.string(),
  description: v.string(),
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

function findPublicBusinessEmail(markdown: string) {
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

function isLikelyProviderResult(
  rawResult: Record<string, unknown>,
  url: string,
) {
  let hostname = "";
  try {
    hostname = new URL(url).hostname.toLowerCase();
  } catch {
    return false;
  }

  const nonProviderHosts = [
    "youtube.com",
    "youtu.be",
    "reddit.com",
    "yelp.com",
    "yellowpages.com",
    "angi.com",
    "homeadvisor.com",
    "thumbtack.com",
    "mapquest.com",
    "facebook.com",
    "instagram.com",
    "nextdoor.com",
    "bbb.org",
    // Publisher and comparison-marketplace pages are discovery sources,
    // not the local businesses the user can approve for outreach.
    "forbes.com",
    "hireahelper.com",
  ];
  if (
    nonProviderHosts.some(
      (host) => hostname === host || hostname.endsWith("." + host),
    )
  ) {
    return false;
  }

  const title = textValue(rawResult.title);
  const corpus = [
    title,
    textValue(rawResult.description),
    textValue(rawResult.markdown),
  ].join(" ");
  if (
    /\b(cost|price|pricing|review|reviews|news|versus|vs\.?|how much|which one|what are)\b/i.test(
      title,
    )
  ) {
    return false;
  }

  return /\b(services?|service area|request a quote|get a quote|free estimate|contact us|book an appointment|locally owned|we provide|our team|we serve|serving)\b/i.test(
    corpus,
  );
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
    if (!isLikelyProviderResult(rawResult, url)) continue;
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
    const contactEmail = findPublicBusinessEmail(markdown);
    candidates.push({
      name: name.slice(0, 160),
      url,
      description: description.slice(0, 420),
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

async function requireUserId(ctx: ActionCtx) {
  const userId = await getAuthUserId(ctx);
  if (!userId) {
    throw new Error("You must be signed in to research providers.");
  }
  return userId;
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
    /contact|email|quote|estimate|about|team|office|service area/i.test(
      pathAndText,
    )
  )
    score += 35;
  if (/\/(?:blog|news|article|privacy|terms|careers)\/?/i.test(link.url))
    score -= 100;
  return score;
}

function selectContactPages(payload: unknown, candidateUrl: string) {
  const origin = canonicalOrigin(candidateUrl);
  if (!origin) return [];

  const mapped = parseMapLinks(payload, origin)
    .map((link) => ({ link, score: contactLinkScore(link) }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score)
    .map((entry) => entry.link.url);

  const urls = [origin + "/", ...mapped];
  return Array.from(new Set(urls)).slice(0, 5);
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

async function investigateContactCandidate(
  candidate: Pick<Doc<"providerCandidates">, "_id" | "url">,
  firecrawlKey: string,
) {
  const origin = canonicalOrigin(candidate.url);
  if (!origin) {
    return {
      candidateId: candidate._id,
      contactability: "website_only" as const,
      status: "failed" as const,
      checkedAt: Date.now(),
      checkedPageCount: 0,
      evidence: [],
      error: "The provider source URL was malformed.",
    };
  }

  try {
    const mapPayload = await firecrawlJson(
      "https://api.firecrawl.dev/v2/map",
      firecrawlKey,
      {
        url: origin + "/",
        search: "contact email estimate quote about",
        sitemap: "include",
        includeSubdomains: false,
        ignoreQueryParameters: true,
        limit: 20,
        location: { country: "US", languages: ["en-US"] },
        timeout: 60000,
      },
    );
    const pages = selectContactPages(mapPayload, candidate.url);
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
            location: { country: "US", languages: ["en-US"] },
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
            candidateId: candidate._id,
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
      candidateId: candidate._id,
      contactability: "website_only" as const,
      status: "unresolved" as const,
      checkedAt: Date.now(),
      checkedPageCount,
      evidence,
    };
  } catch {
    return {
      candidateId: candidate._id,
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
      (candidate) => candidate.contactability === "website_only",
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

      const existingSources = new Set(
        candidate.evidence.map((item) => item.sourceUrl),
      );
      const addedEvidence = update.evidence.filter(
        (item) => !existingSources.has(item.sourceUrl),
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
      if (addedEvidence.length > 0) {
        patch.evidence = candidate.evidence.concat(addedEvidence).slice(0, 12);
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

    return await ctx.db
      .query("providerCandidates")
      .withIndex("by_job_and_discoveredAt", (q) => q.eq("jobId", args.jobId))
      .order("desc")
      .take(10);
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
      status: statusValidator,
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
      status: job.status,
    };
  },
});

export const markResearching = internalMutation({
  args: { jobId: v.id("jobs"), ownerId: v.id("users") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const job = await ctx.db.get("jobs", args.jobId);
    if (
      !job ||
      job.ownerId !== args.ownerId ||
      job.status !== "brief_approved"
    ) {
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
      .take(30);
    for (const candidate of previous) {
      await ctx.db.delete("providerCandidates", candidate._id);
    }

    const discoveredAt = Date.now();
    for (const candidate of args.candidates) {
      await ctx.db.insert("providerCandidates", {
        ...candidate,
        jobId: args.jobId,
        ownerId: args.ownerId,
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
    if (!job || job.ownerId !== args.ownerId || job.status !== "researching") {
      return null;
    }

    const now = Date.now();
    await ctx.db.patch("jobs", args.jobId, {
      status: "brief_approved",
      activeOperation: undefined,
      updatedAt: now,
    });
    await ctx.db.insert("jobEvents", {
      jobId: args.jobId,
      ownerId: args.ownerId,
      eventType: "research_failed",
      message: eventMessage.failed,
      createdAt: now,
    });
    return null;
  },
});

export const search = action({
  args: { jobId: v.id("jobs") },
  returns: researchResultValidator,
  handler: async (ctx, args) => {
    const ownerId = await requireUserId(ctx);
    const job = await ctx.runQuery(internal.providerResearch.getJobForAction, {
      jobId: args.jobId,
      ownerId,
    });
    if (!job || job.status !== "brief_approved") {
      throw new Error("Approve the job brief before researching providers.");
    }

    const firecrawlKey = env.FIRECRAWL_API_KEY;
    if (!firecrawlKey) {
      throw new Error("Firecrawl is not configured on this Convex deployment.");
    }

    await ctx.runMutation(internal.providerResearch.markResearching, {
      jobId: args.jobId,
      ownerId,
    });

    try {
      const response = await fetch("https://api.firecrawl.dev/v2/search", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${firecrawlKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          query: `local ${job.serviceCategory} providers near ${job.serviceLocation} for ${job.naturalLanguageDescription}`,
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
      await ctx.runMutation(internal.providerResearch.saveResults, {
        jobId: args.jobId,
        ownerId,
        candidates,
      });

      return {
        candidateCount: candidates.length,
        websiteOnlyCount: candidates.filter(
          (candidate) => candidate.contactability === "website_only",
        ).length,
      };
    } catch (error) {
      await ctx.runMutation(internal.providerResearch.markResearchFailed, {
        jobId: args.jobId,
        ownerId,
      });
      throw error;
    }
  },
});
type ContactDiscoverySummary = {
  providerCount: number;
  emailFoundCount: number;
  unresolvedCount: number;
  failedCount: number;
  checkedPageCount: number;
};

export const discoverContacts = action({
  args: { jobId: v.id("jobs") },
  returns: contactDiscoveryResultValidator,
  handler: async (ctx, args): Promise<ContactDiscoverySummary> => {
    const ownerId = await requireUserId(ctx);
    const job = await ctx.runQuery(internal.providerResearch.getJobForAction, {
      jobId: args.jobId,
      ownerId,
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
        ownerId,
      },
    );
    await ctx.runMutation(
      internal.providerResearch.markContactDiscoveryStarted,
      {
        jobId: args.jobId,
        ownerId,
      },
    );

    const updates = [];
    let checkedPageCount = 0;
    try {
      for (const candidate of candidates) {
        const update = await investigateContactCandidate(
          candidate,
          firecrawlKey,
        );
        updates.push(update);
        checkedPageCount += update.checkedPageCount;
      }

      await ctx.runMutation(internal.providerResearch.saveContactDiscovery, {
        jobId: args.jobId,
        ownerId,
        updates,
      });
    } catch (error) {
      await ctx.runMutation(
        internal.providerResearch.markContactDiscoveryFailed,
        {
          jobId: args.jobId,
          ownerId,
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
