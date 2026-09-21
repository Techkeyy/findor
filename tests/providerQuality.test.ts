/// <reference types="vite/client" />
import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import schema from "../convex/schema";
import { internal } from "../convex/_generated/api";
import {
  canonicalizeCountry,
  canonicalizeGeographicSegment,
  classifyProviderSource,
  deriveProviderCountries,
  effectiveCountryCode,
  extractBusinessLeadsFromDiscoveryText,
  formatExternalServiceArea,
  formatLocationSegments,
  formatLocationText,
  hasSourceBackedPublicBusinessEmail,
  isProviderCountryCompatible,
  isProviderRelevantToJob,
  isProviderEntity,
  mergeProviderEvidence,
  redactExactAddressLikeText,
} from "../convex/providerQuality";
import {
  buildResearchQuery,
  findPublicBusinessEmail,
  selectContactPages,
  shouldContinueProviderDiscovery,
} from "../convex/providerResearch";
import { getProcessRailSteps } from "../src/processRail";

const modules = import.meta.glob("../convex/**/*.*s");

describe("generic provider entity quality", () => {
  it("keeps an official provider and separates marketplace, listicle, and calculator sources", () => {
    expect(
      classifyProviderSource({
        url: "https://cleanly.ng/",
        title: "CLEANLY - Professional Cleaning Services in Lagos, Nigeria",
        description:
          "We provide residential cleaning services and request a quote through our official contact route.",
        markdown: "Our services include recurring home cleaning. Contact us for a quote.",
      }),
    ).toBe("provider");

    expect(
      classifyProviderSource({
        url: "https://viscorner.com/cleaning-services/house-cleaning/oshodi-isolo",
        title: "Find Reliable and Verified House Cleaners in Oshodi - Isolo, Lagos",
        description: "Find verified cleaners and connect with local professionals.",
        markdown: "Compare providers and request multiple quotes.",
      }),
    ).toBe("discovery_source");

    expect(
      classifyProviderSource({
        url: "https://neatflow.ng/best-cleaning-companies-in-ikeja-lagos/",
        title: "List of Cleaning Companies in Ikeja Lagos and their Prices",
        description: "A list of local cleaning companies and prices.",
        markdown: "Best cleaning companies compared in one article.",
      }),
    ).toBe("discovery_source");

    expect(
      classifyProviderSource({
        url: "https://cleaning.example/blog/how-to-choose-a-cleaning-service",
        title: "How to choose a cleaning service",
        description: "An article about comparing cleaning options.",
        markdown: "Read this guide before hiring a cleaning service.",
      }),
    ).toBe("discovery_source");
    expect(
      classifyProviderSource({
        url: "https://trustamai.com/tools/deep-cleaning-cost-calculator",
        title: "Deep Cleaning Prices in Nigeria",
        description: "Use this calculator to estimate costs.",
        markdown: "Cost calculator for cleaning services.",
      }),
    ).toBe("discovery_source");
  });

  it("requires provider-owned evidence for a public email and quarantines legacy discovery hosts", () => {
    expect(
      hasSourceBackedPublicBusinessEmail({
        entityType: "provider",
        name: "CLEANLY",
        url: "https://cleanly.ng/",
        description: "Professional cleaning services.",
        contactability: "email_found",
        contactEmail: "info@cleanly.example.test",
        evidence: [
          {
            sourceUrl: "https://cleanly.ng/",
            claim: "Public business contact info@cleanly.example.test.",
          },
        ],
      }),
    ).toBe(true);

    expect(
      hasSourceBackedPublicBusinessEmail({
        entityType: "discovery_source",
        name: "VisCorner",
        url: "https://viscorner.com/cleaning-services/house-cleaning/oshodi-isolo",
        description: "Marketplace for cleaners.",
        contactability: "email_found",
        contactEmail: "support@viscorner.example.test",
        evidence: [
          {
            sourceUrl: "https://viscorner.com/cleaning-services/house-cleaning/oshodi-isolo",
            claim: "Public business contact support@viscorner.example.test.",
          },
        ],
      }),
    ).toBe(false);

    expect(
      isProviderEntity({
        name: "List of Cleaning Companies",
        url: "https://neatflow.ng/best-cleaning-companies-in-ikeja-lagos/",
        description: "A list of companies.",
      }),
    ).toBe(false);

    expect(
      isProviderEntity({
        name: "Legacy Local Provider",
        url: "https://legacy-provider.example/",
        description: "Synthetic local provider.",
      }),
    ).toBe(true);
  });

  it("rechecks generic service and geography relevance for autonomous callbacks", () => {
    const job = {
      serviceCategory: "Moving",
      serviceLocation: "Austin, Texas, United States",
      naturalLanguageDescription: "Need a two-bedroom apartment move in Austin.",
      structuredLocation: {
        country: "United States",
        countryCode: "US",
        region: "Texas",
        city: "Austin",
      },
    };
    const evidence = [
      {
        sourceUrl: "https://moving.example/contact",
        claim: "Austin moving provider public business contact hello@moving.example.",
      },
    ];
    expect(
      isProviderRelevantToJob(
        {
          entityType: "provider",
          name: "Austin Moving Provider",
          url: "https://moving.example",
          description: "Local moving provider serving Austin, Texas.",
          evidence,
        },
        job,
      ),
    ).toBe(true);
    expect(
      isProviderRelevantToJob(
        {
          entityType: "provider",
          name: "Dallas Roofing Provider",
          url: "https://roofing.example",
          description: "Roof replacement provider serving Dallas, Texas.",
          evidence,
        },
        job,
      ),
    ).toBe(false);
  });

  it("does not fill a provider cap with discovery sources or website-only providers", async () => {
    const t = convexTest(schema, modules);
    const now = 1_700_000_000_000;
    const seeded = await t.run(async (ctx) => {
      const ownerId = await ctx.db.insert("users", {
        email: "quality-owner@example.test",
      });
      const jobId = await ctx.db.insert("jobs", {
        ownerId,
        serviceCategory: "Residential cleaning",
        jobTitle: "Synthetic cleaning request",
        naturalLanguageDescription:
          "Need a residential cleaning provider for a synthetic regression test.",
        serviceLocation: "Lagos, Nigeria",
        desiredTiming: "Next week",
        budgetOrContext: "Written estimate requested.",
        structuredRequirements: {
          rawDetails: "Written estimate requested.",
          keyDetails: [],
        },
        status: "providers_ready",
        missingFields: [],
        autonomy: {
          enabled: true,
          maxProviders: 3,
          allowInitialOutreach: true,
          allowRoutineClarifications: true,
          allowFollowUp: true,
          maxFollowUps: 1,
          preference: "balanced",
          approvedAt: now,
        },
        createdAt: now,
        updatedAt: now,
      });
      const validProviderId = await ctx.db.insert("providerCandidates", {
        jobId,
        ownerId,
        name: "Valid Provider",
        url: "https://valid-provider.example/",
        description: "A synthetic residential cleaning provider serving Lagos, Nigeria.",
        entityType: "provider",
        contactability: "email_found",
        contactEmail: "info@valid-provider.example",
        evidence: [
          {
            sourceUrl: "https://valid-provider.example/contact",
            claim: "Public business contact info@valid-provider.example. Residential cleaning in Lagos, Nigeria.",
          },
        ],
        discoveredAt: now,
      });
      await ctx.db.insert("providerCandidates", {
        jobId,
        ownerId,
        name: "Website Only Provider",
        url: "https://website-only.example/",
        description: "A synthetic provider with a contact form.",
        entityType: "provider",
        contactability: "website_only",
        evidence: [
          {
            sourceUrl: "https://website-only.example/contact",
            claim: "Contact form only; no published email.",
          },
        ],
        discoveredAt: now + 1,
      });
      await ctx.db.insert("providerCandidates", {
        jobId,
        ownerId,
        name: "Marketplace Source",
        url: "https://viscorner.com/cleaning-services/lagos",
        description: "A marketplace source.",
        entityType: "discovery_source",
        contactability: "email_found",
        contactEmail: "support@viscorner.example.test",
        evidence: [
          {
            sourceUrl: "https://viscorner.com/cleaning-services/lagos",
            claim: "Public business contact support@viscorner.example.test.",
          },
        ],
        discoveredAt: now + 2,
      });
      return { ownerId, jobId, validProviderId };
    });

    const result = await t.mutation(
      internal.outreach.queueAutonomousOutreach,
      {
        jobId: seeded.jobId,
        ownerId: seeded.ownerId,
      },
    );

    expect(result).toEqual({ queuedCount: 1, emailFoundCount: 1 });
    const outreach = await t.run(async (ctx) =>
      ctx.db
        .query("outreachMessages")
        .withIndex("by_job_and_createdAt", (q) => q.eq("jobId", seeded.jobId))
        .take(10),
    );
    expect(outreach).toHaveLength(1);
    expect(outreach[0]?.candidateId).toBe(seeded.validProviderId);
  });
});

describe("search-quality entity/contactability contract", () => {
  it("keeps homepage, contact-page, and privacy-page emails source-backed", () => {
    const homepage = {
      url: "https://provider.example/",
      title: "Provider Electrical Services",
      description: "Licensed electrical contractor serving Harlem.",
      markdown: "Contact us at hello@provider.example for a quote.",
    };
    expect(classifyProviderSource(homepage)).toBe("provider");
    expect(findPublicBusinessEmail(homepage.markdown)).toBe(
      "hello@provider.example",
    );

    const contactPage = {
      url: "https://provider.example/contact",
      title: "Contact Provider Electrical Services",
      description: "Contact our office for electrical service.",
      markdown: "Email our office at info@provider.example.",
    };
    expect(classifyProviderSource(contactPage)).toBe("provider");
    expect(findPublicBusinessEmail(contactPage.markdown)).toBe(
      "info@provider.example",
    );

    const privacyPage = {
      url: "https://provider.example/privacy-policy",
      title: "Privacy Policy",
      description: "Privacy information for Provider Electrical Services.",
      markdown: "Privacy policy contact: info@provider.example.",
    };
    expect(classifyProviderSource(privacyPage)).toBe("provider");
    expect(findPublicBusinessEmail(privacyPage.markdown)).toBe(
      "info@provider.example",
    );
  });

  it("keeps a real provider website as website_only when no public email exists", () => {
    const homepage = {
      url: "https://website-only.example/",
      title: "Website Only Electrical Services",
      description: "Licensed electrical contractor serving Harlem.",
      markdown:
        "Call our office or use the contact form for a quote. This official business homepage is not a directory.",
    };
    expect(classifyProviderSource(homepage)).toBe("provider");
    expect(findPublicBusinessEmail(homepage.markdown)).toBeUndefined();
    expect(findPublicBusinessEmail("![button@2x.gif](https://example.test/button@2x.gif)")).toBeUndefined();
  });

  it("upgrades stale same-page contact evidence when a bounded retry finds an email", () => {
    const sourceUrl = "https://provider.example/privacy-policy";
    const merged = mergeProviderEvidence(
      [
        {
          sourceUrl,
          claim:
            "Contact discovery checked this public source page; no public business email was present.",
        },
      ],
      [
        {
          sourceUrl,
          claim:
            "Public business contact info@provider.example appears in retrieved Firecrawl Markdown.",
        },
      ],
    );
    expect(merged).toEqual([
      {
        sourceUrl,
        claim:
          "Public business contact info@provider.example appears in retrieved Firecrawl Markdown.",
      },
    ]);
  });

  it("keeps directory/listicle and training/association pages as discovery evidence", () => {
    expect(
      classifyProviderSource({
        url: "https://directory.example/electricians/harlem",
        title: "Best Electrical Contractors in Harlem",
        description: "Compare local contractors and request multiple quotes.",
        markdown: "Directory of local electricians and member listings.",
      }),
    ).toBe("discovery_source");

    expect(
      classifyProviderSource({
        url: "https://association.example/training",
        title: "Electrical Training Program",
        description: "Certification and training program for professionals.",
        markdown: "Association course and member certification information.",
      }),
    ).toBe("discovery_source");

    expect(
      classifyProviderSource({
        url: "https://association.example/nyc-chapter",
        title: "National Electrical Contractors Association, New York City Chapter",
        description: "Association membership and local contractor information.",
        markdown: "Member directory and chapter resources for electrical contractors.",
      }),
    ).toBe("discovery_source");

    expect(
      classifyProviderSource({
        url: "https://association.example/our-history",
        title: "Our History - Electrical Organization",
        description: "Members only resources and chapter history.",
        markdown: "Membership information for local electrical contractors.",
      }),
    ).toBe("discovery_source");

    expect(
      classifyProviderSource({
        url: "https://www.usa.gov/",
        title: "Making government services easier to find",
        description: "Official government services and agency information.",
        markdown: "Contact federal agencies and learn about public programs.",
      }),
    ).toBe("discovery_source");

    expect(
      classifyProviderSource({
        url: "https://provider.example/new-york-electrical-code-basics",
        title: "New York Residential Electrical Code Basics: 2025 Essential Guide",
        description: "An educational guide to electrical standards and terminology.",
        markdown: "Frequently asked questions about code basics.",
      }),
    ).toBe("discovery_source");

    expect(
      classifyProviderSource({
        url: "https://about.example/company-info/contact-example",
        title: "Support: Contact information and product help",
        description: "Contact the company support and press teams.",
        markdown: "Support resources and company information.",
      }),
    ).toBe("discovery_source");
  });

  it("treats a provider-owned blog/listicle page as evidence while retaining the owning homepage", () => {
    expect(
      classifyProviderSource({
        url: "https://provider.example/blog/best-electricians-in-harlem",
        title: "Best Electricians in Harlem",
        description: "A guide comparing electrical contractors.",
        markdown: "Read this article before hiring a local electrician.",
      }),
    ).toBe("discovery_source");
    expect(
      classifyProviderSource({
        url: "https://provider.example/",
        title: "Provider Electrical Services",
        description: "Licensed electrical contractor serving Harlem.",
        markdown: "Top-rated electrical service. Request a quote.",
      }),
    ).toBe("provider");
  });

  it("bounds contact traversal to the homepage plus the highest-signal internal pages", () => {
    const pages = selectContactPages(
      {
        success: true,
        links: [
          {
            url: "https://provider.example/contact",
            title: "Contact",
            description: "Email and office information",
          },
          {
            url: "https://provider.example/privacy-policy",
            title: "Privacy Policy",
            description: "Privacy contact information",
          },
          {
            url: "https://provider.example/gallery",
            title: "Gallery",
            description: "Project photos",
          },
          {
            url: "https://other.example/contact",
            title: "Other domain",
            description: "Must be ignored",
          },
        ],
      },
      "https://provider.example/",
    );
    expect(pages[0]).toBe("https://provider.example/");
    expect(pages).toContain("https://provider.example/contact");
    expect(pages).toContain("https://provider.example/privacy-policy");
    expect(pages).not.toContain("https://other.example/contact");
    expect(pages.length).toBeLessThanOrEqual(5);
  });

  it("continues discovery after one provider until maxProviders is reached", () => {
    expect(shouldContinueProviderDiscovery(1, 3)).toBe(true);
    expect(shouldContinueProviderDiscovery(2, 3)).toBe(true);
    expect(shouldContinueProviderDiscovery(3, 3)).toBe(false);
  });
});

describe("process rail approval state", () => {
  it("marks the mandate complete as soon as persisted approval exists", () => {
    const beforeResearch = getProcessRailSteps({
      status: "brief_approved",
      briefApprovedAt: 1,
      autonomy: { approvedAt: 1 },
    });
    expect(beforeResearch).toHaveLength(5);
    expect(beforeResearch[2]).toMatchObject({
      label: "Approve Findor's mandate",
      complete: true,
    });
    expect(beforeResearch[3]?.complete).toBe(false);

    const afterReply = getProcessRailSteps({
      status: "reply_received",
      briefApprovedAt: 1,
      autonomy: { approvedAt: 1 },
    });
    expect(afterReply.every((step) => step.complete)).toBe(true);
  });
});

describe("generic private location redaction and structured service area formatting", () => {
  it("suppresses diverse exact street addresses, building numbers, and unit designations without location-specific hardcoding", () => {
    expect(redactExactAddressLikeText("14 Adeola Street")).toBe("[exact address withheld]");
    expect(redactExactAddressLikeText("22 Greenfield Road")).toBe("[exact address withheld]");
    expect(redactExactAddressLikeText("No 4 Palm Close")).toBe("[exact address withheld]");
    expect(redactExactAddressLikeText("Flat 3, 10 Market Avenue")).toBe("[private unit withheld], [exact address withheld]");
    expect(redactExactAddressLikeText("Unit 5, Cedar Estate")).toBe("[private unit withheld], [exact address withheld]");
    expect(redactExactAddressLikeText("Plot 8 Sunrise Crescent")).toBe("[exact address withheld]");
    expect(redactExactAddressLikeText("6 Julius Showumi, Lagos")).toBe("[exact address withheld], Lagos");
  });

  it("preserves broad localities and legitimate neighborhood names including those with phase/area numbers", () => {
    expect(redactExactAddressLikeText("Oshodi")).toBe("Oshodi");
    expect(redactExactAddressLikeText("Ikeja")).toBe("Ikeja");
    expect(redactExactAddressLikeText("Lekki Phase 1")).toBe("Lekki Phase 1");
    expect(redactExactAddressLikeText("Yaba")).toBe("Yaba");
    expect(redactExactAddressLikeText("Manchester")).toBe("Manchester");
    expect(redactExactAddressLikeText("Brooklyn")).toBe("Brooklyn");
  });

  it("formats external service area using structured location allowlist with case-insensitive deduplication and filters out street-level locality entries", () => {
    // Clean structured location with duplicate city/region
    expect(
      formatExternalServiceArea({
        country: "Nigeria",
        region: "Lagos",
        city: "Lagos",
        locality: "Oshodi",
      }),
    ).toBe("Oshodi, Lagos, Nigeria");

    // Case- and whitespace-insensitive deduplication
    expect(
      formatExternalServiceArea({
        country: "Nigeria",
        region: " Lagos ",
        city: "lagos",
        locality: "Oshodi",
      }),
    ).toBe("Oshodi, Lagos, Nigeria");

    // Structured location where locality contains an exact street
    expect(
      formatExternalServiceArea({
        country: "Nigeria",
        region: "Lagos",
        city: "Lagos",
        locality: "14 Adeola Street",
      }),
    ).toBe("Lagos, Nigeria");

    // Structured location where locality contains a house number and name
    expect(
      formatExternalServiceArea({
        country: "Nigeria",
        region: "Lagos",
        city: "Lagos",
        locality: "6 Julius Showumi",
      }),
    ).toBe("Lagos, Nigeria");

    // Legacy fallback string
    expect(
      formatExternalServiceArea(
        null,
        "Oshodi, 6 Julius Showumi, Lagos, Nigeria",
      ),
    ).toBe("Oshodi, [exact address withheld], Lagos, Nigeria");
  });

  it("normalizes and deduplicates geographic segments cleanly across various structures", () => {
    // region Lagos + city lagos + locality Oshodi
    expect(
      formatLocationSegments(["Oshodi", "lagos", "Lagos", "Nigeria"]),
    ).toBe("Oshodi, Lagos, Nigeria");

    // region " Lagos " + city "lagos"
    expect(
      formatLocationSegments(["Oshodi", "lagos", " Lagos ", "Nigeria"]),
    ).toBe("Oshodi, Lagos, Nigeria");

    // unrelated city/region values remain distinct
    expect(
      formatLocationSegments(["Austin", "Texas", "United States"]),
    ).toBe("Austin, Texas, United States");

    expect(
      formatLocationSegments(["London", "Greater London", "United Kingdom"]),
    ).toBe("London, Greater London, United Kingdom");

    // broad locality with numeric name remains intact
    expect(
      formatLocationSegments(["Lekki Phase 1", "lagos", "Lagos", "Nigeria"]),
    ).toBe("Lekki Phase 1, Lagos, Nigeria");

    // all lowercase input
    expect(
      formatLocationSegments(["new york", "new york", "united states"]),
    ).toBe("New York, United States");

    // canonicalizeGeographicSegment helper
    expect(canonicalizeGeographicSegment("lagos")).toBe("Lagos");
    expect(canonicalizeGeographicSegment("  Lagos  ")).toBe("Lagos");
    expect(canonicalizeGeographicSegment("Lekki Phase 1")).toBe("Lekki Phase 1");
    expect(canonicalizeGeographicSegment("greater london")).toBe("Greater London");

    // formatLocationText fallback helper
    expect(formatLocationText("Oshodi, lagos, Nigeria")).toBe("Oshodi, Lagos, Nigeria");
    expect(
      formatLocationText("Oshodi, lagos, Nigeria", {
        locality: "Oshodi",
        city: "lagos",
        region: "Lagos",
        country: "Nigeria",
      }),
    ).toBe("Oshodi, Lagos, Nigeria");
  });

  it("classifies social media group posts, forum threads, user videos, and classifieds as discovery_source", () => {
    // Facebook group post snippet with service keywords
    expect(
      classifyProviderSource({
        url: "https://www.facebook.com/groups/211709264448575/posts/1179763630976462/",
        title: "Deep cleaning services in Lagos - Facebook",
        description: "Book an appointment with us today We are into Deep cleaning Fumigation Rug vacuuming",
        markdown: "Deep cleaning services in Lagos. Contact 09165656623 via whatsapp.",
      }),
    ).toBe("discovery_source");

    // Instagram post / reel
    expect(
      classifyProviderSource({
        url: "https://www.instagram.com/p/DUood2Rj5wI/?hl=en",
        title: "MPH CLEANERS – PREMIUM PRICE LIST (LAGOS) Serving - Instagram",
        description: "2 Bedroom Deep Clean ₦50,000. Book your cleaning today.",
        markdown: "Price list for cleaning in Lagos.",
      }),
    ).toBe("discovery_source");

    // YouTube video / short
    expect(
      classifyProviderSource({
        url: "https://www.youtube.com/watch?v=sample123",
        title: "Lagos Nigeria Price Of Plumbing Pipes For Kitchen Sinks - YouTube",
        description: "Plumbing services and materials in Lagos State.",
        markdown: "Subscribe for more plumbing videos in Nigeria.",
      }),
    ).toBe("discovery_source");

    // Quora discussion
    expect(
      classifyProviderSource({
        url: "https://www.quora.com/Where-can-I-buy-plumbing-materials-in-Lagos-State",
        title: "Where can I buy plumbing materials in Lagos State? - Quora",
        description: "Answers about buying plumbing materials.",
        markdown: "Discussion thread on Quora.",
      }),
    ).toBe("discovery_source");

    // isProviderEntity rejects social discovery records
    expect(
      isProviderEntity({
        entityType: "discovery_source",
        name: "Deep cleaning services in Lagos - Facebook",
        url: "https://www.facebook.com/groups/211709264448575/posts/1179763630976462/",
      }),
    ).toBe(false);
  });
});

describe("controlled discovery across 5 distinct service categories (zero hardcoding)", () => {
  it("Category 1: Cleaning — extracts leads, classifies sources, verifies email on provider domain, checks relevance", () => {
    const discoveryMarkdown = `
# Best Cleaning Companies in Lagos
Here is a comprehensive list of top cleaning agencies:
1. Reis Cleaners Ltd - Residential and commercial deep cleaning specialists.
2. Cleanly Services Nigeria - House cleaning and janitorial services.
3. Spotless Prime Cleaners - Move-in deep cleaning.
### Frequently Asked Questions
- What is the price of deep cleaning?
- How to book a cleaner?
    `;
    const leads = extractBusinessLeadsFromDiscoveryText(discoveryMarkdown, "Residential cleaning");
    expect(leads).toContain("Reis Cleaners Ltd");
    expect(leads).toContain("Cleanly Services Nigeria");
    expect(leads).toContain("Spotless Prime Cleaners");
    expect(leads).not.toContain("Frequently Asked Questions");
    expect(leads).not.toContain("What is the price of deep cleaning");

    // Classification
    expect(
      classifyProviderSource({
        url: "https://reiscleaners.example.test/",
        title: "Reis Cleaners Ltd - Deep Cleaning Specialists in Lagos",
        description: "We provide comprehensive residential cleaning services across Lagos.",
        markdown: "Contact us for a quote or book an appointment with our team.",
      }),
    ).toBe("provider");

    // Email verification
    expect(
      hasSourceBackedPublicBusinessEmail({
        entityType: "provider",
        name: "Reis Cleaners Ltd",
        url: "https://reiscleaners.example.test/",
        contactability: "email_found",
        contactEmail: "info@reiscleaners.example.test",
        evidence: [
          {
            sourceUrl: "https://reiscleaners.example.test/contact",
            claim: "Public business contact info@reiscleaners.example.test",
          },
        ],
      }),
    ).toBe(true);

    // Relevance
    const job = {
      serviceCategory: "Residential cleaning",
      serviceLocation: "Oshodi, Lagos, Nigeria",
      naturalLanguageDescription: "I need a 2 bedroom apartment deep cleaned",
    };
    expect(
      isProviderRelevantToJob(
        {
          entityType: "provider",
          name: "Reis Cleaners Ltd",
          url: "https://reiscleaners.example.test",
          description: "Professional cleaning services in Lagos",
          evidence: [{ sourceUrl: "https://reiscleaners.example.test", claim: "Cleaning in Lagos" }],
        },
        job,
      ),
    ).toBe(true);
  });

  it("Category 2: Plumbing — extracts leads, classifies sources, verifies email on provider domain, checks relevance", () => {
    const discoveryMarkdown = `
## Top Plumbers in Lagos
Find verified plumbing contractors:
- AquaFlow Plumbing & Piping Ltd: Emergency sink leak repair and pipe installation.
- DrainMaster Pro Solutions - Commercial & residential drain unblocking.
- Apex Plumbing Works: Bathroom fitting specialists.
## Cost of Plumbing Repairs
- Average plumbing cost in Nigeria
    `;
    const leads = extractBusinessLeadsFromDiscoveryText(discoveryMarkdown, "Plumbing");
    expect(leads).toContain("AquaFlow Plumbing & Piping Ltd");
    expect(leads).toContain("DrainMaster Pro Solutions");
    expect(leads).toContain("Apex Plumbing Works");
    expect(leads).not.toContain("Cost of Plumbing Repairs");
    expect(leads).not.toContain("Average plumbing cost in Nigeria");

    // Classification
    expect(
      classifyProviderSource({
        url: "https://aquaflowplumbing.example.test/",
        title: "AquaFlow Plumbing & Piping - Emergency Plumber Lagos",
        description: "We offer emergency leak repairs and pipe installation services.",
        markdown: "Our team serves the entire Lagos metropolis. Request a quote.",
      }),
    ).toBe("provider");

    // Email verification
    expect(
      hasSourceBackedPublicBusinessEmail({
        entityType: "provider",
        name: "AquaFlow Plumbing & Piping Ltd",
        url: "https://aquaflowplumbing.example.test/",
        contactability: "email_found",
        contactEmail: "service@aquaflowplumbing.example.test",
        evidence: [
          {
            sourceUrl: "https://aquaflowplumbing.example.test/contact-us",
            claim: "Email us at service@aquaflowplumbing.example.test for urgent repairs.",
          },
        ],
      }),
    ).toBe(true);

    // Relevance
    const job = {
      serviceCategory: "Plumbing",
      serviceLocation: "Oshodi, Lagos, Nigeria",
      naturalLanguageDescription: "Kitchen sink pipe leak needs urgent fix",
    };
    expect(
      isProviderRelevantToJob(
        {
          entityType: "provider",
          name: "AquaFlow Plumbing & Piping Ltd",
          url: "https://aquaflowplumbing.example.test",
          description: "Plumbing contractor serving Lagos",
          evidence: [{ sourceUrl: "https://aquaflowplumbing.example.test", claim: "Plumbing repairs in Lagos" }],
        },
        job,
      ),
    ).toBe(true);
  });

  it("Category 3: HVAC — extracts leads, classifies sources, verifies email on provider domain, checks relevance", () => {
    const discoveryMarkdown = `
# HVAC and Air Conditioning Contractors
1. ArcticBreeze Air Systems - AC repair and central HVAC servicing.
2. CoolAir Engineering Ltd - Residential AC installation and duct cleaning.
3. ThermalGuard Climate Control - Inverter AC diagnostics.
### Price Guide for AC Servicing
- Cost of AC gas refilling
    `;
    const leads = extractBusinessLeadsFromDiscoveryText(discoveryMarkdown, "HVAC");
    expect(leads).toContain("ArcticBreeze Air Systems");
    expect(leads).toContain("CoolAir Engineering Ltd");
    expect(leads).toContain("ThermalGuard Climate Control");
    expect(leads).not.toContain("Price Guide for AC Servicing");

    // Classification
    expect(
      classifyProviderSource({
        url: "https://arcticbreeze.example.test/",
        title: "ArcticBreeze Air Systems - AC Installation & Repair",
        description: "We provide HVAC maintenance and AC installation services in Lagos.",
        markdown: "Contact us today to schedule your AC maintenance.",
      }),
    ).toBe("provider");

    // Email verification
    expect(
      hasSourceBackedPublicBusinessEmail({
        entityType: "provider",
        name: "ArcticBreeze Air Systems",
        url: "https://arcticbreeze.example.test/",
        contactability: "email_found",
        contactEmail: "hello@arcticbreeze.example.test",
        evidence: [
          {
            sourceUrl: "https://arcticbreeze.example.test/contact",
            claim: "Reach out via hello@arcticbreeze.example.test",
          },
        ],
      }),
    ).toBe(true);

    // Relevance (and cross-category negative test)
    const hvacJob = {
      serviceCategory: "HVAC",
      serviceLocation: "Ikeja, Lagos, Nigeria",
      naturalLanguageDescription: "Split unit AC not cooling, needs compressor check",
    };
    expect(
      isProviderRelevantToJob(
        {
          entityType: "provider",
          name: "ArcticBreeze Air Systems",
          url: "https://arcticbreeze.example.test",
          description: "HVAC and AC repair services in Lagos",
          evidence: [{ sourceUrl: "https://arcticbreeze.example.test", claim: "HVAC repairs in Lagos" }],
        },
        hvacJob,
      ),
    ).toBe(true);

    // Moving provider should fail HVAC relevance
    expect(
      isProviderRelevantToJob(
        {
          entityType: "provider",
          name: "SwiftMove Relocations",
          url: "https://swiftmove.example.test",
          description: "Moving and packing company",
          evidence: [{ sourceUrl: "https://swiftmove.example.test", claim: "Moving in Lagos" }],
        },
        hvacJob,
      ),
    ).toBe(false);
  });

  it("Category 4: Electrical — extracts leads, classifies sources, verifies email on provider domain, checks relevance", () => {
    const discoveryMarkdown = `
## Best Electrical Contractors in Lagos
- VoltMaster Electrical Works: Commercial & domestic wiring and breaker repair.
- PowerGrid Engineering Ltd - Solar inverter and DB panel installations.
- SparkSafe Electricians: 24/7 electrical troubleshooting.
## Electrical Safety Tips
- How to prevent electrical fires
    `;
    const leads = extractBusinessLeadsFromDiscoveryText(discoveryMarkdown, "Electrical");
    expect(leads).toContain("VoltMaster Electrical Works");
    expect(leads).toContain("PowerGrid Engineering Ltd");
    expect(leads).toContain("SparkSafe Electricians");
    expect(leads).not.toContain("Electrical Safety Tips");

    // Classification
    expect(
      classifyProviderSource({
        url: "https://voltmaster.example.test/",
        title: "VoltMaster Electrical Works - Certified Electricians",
        description: "We provide complete electrical wiring and breaker panel services.",
        markdown: "Our team serves residential and commercial clients across Lagos. Get a quote.",
      }),
    ).toBe("provider");

    // Email verification
    expect(
      hasSourceBackedPublicBusinessEmail({
        entityType: "provider",
        name: "VoltMaster Electrical Works",
        url: "https://voltmaster.example.test/",
        contactability: "email_found",
        contactEmail: "quotes@voltmaster.example.test",
        evidence: [
          {
            sourceUrl: "https://voltmaster.example.test/quote",
            claim: "For inquiries email quotes@voltmaster.example.test directly.",
          },
        ],
      }),
    ).toBe(true);

    // Relevance
    const elecJob = {
      serviceCategory: "Electrical",
      serviceLocation: "Oshodi, Lagos, Nigeria",
      naturalLanguageDescription: "Circuit breaker keeps tripping, need DB panel inspected",
    };
    expect(
      isProviderRelevantToJob(
        {
          entityType: "provider",
          name: "VoltMaster Electrical Works",
          url: "https://voltmaster.example.test",
          description: "Certified electrical contractor in Lagos",
          evidence: [{ sourceUrl: "https://voltmaster.example.test", claim: "Electrical repairs in Lagos" }],
        },
        elecJob,
      ),
    ).toBe(true);
  });

  it("Category 5: Moving — extracts leads, classifies sources, verifies email on provider domain, checks relevance", () => {
    const discoveryMarkdown = `
# Top Relocation and Moving Companies
1. SwiftRelo Logistics Ltd - Residential moving and packing services.
2. PrimeMovers Nigeria - Interstate haulage and office relocation.
3. CityShifter Express - Apartment moving specialists.
### Moving Price Calculator
- Estimate moving costs
    `;
    const leads = extractBusinessLeadsFromDiscoveryText(discoveryMarkdown, "Moving");
    expect(leads).toContain("SwiftRelo Logistics Ltd");
    expect(leads).toContain("PrimeMovers Nigeria");
    expect(leads).toContain("CityShifter Express");
    expect(leads).not.toContain("Moving Price Calculator");

    // Classification
    expect(
      classifyProviderSource({
        url: "https://swiftrelo.example.test/",
        title: "SwiftRelo Logistics - Moving & Relocation Services",
        description: "We offer professional home and office moving services in Lagos.",
        markdown: "Contact us today for a free moving estimate.",
      }),
    ).toBe("provider");

    // Email verification
    expect(
      hasSourceBackedPublicBusinessEmail({
        entityType: "provider",
        name: "SwiftRelo Logistics Ltd",
        url: "https://swiftrelo.example.test/",
        contactability: "email_found",
        contactEmail: "dispatch@swiftrelo.example.test",
        evidence: [
          {
            sourceUrl: "https://swiftrelo.example.test/contact",
            claim: "Email dispatch@swiftrelo.example.test for bookings.",
          },
        ],
      }),
    ).toBe(true);

    // Relevance
    const movingJob = {
      serviceCategory: "Moving",
      serviceLocation: "Lagos, Nigeria",
      naturalLanguageDescription: "Moving 2 bedroom flat from Oshodi to Lekki",
    };
    expect(
      isProviderRelevantToJob(
        {
          entityType: "provider",
          name: "SwiftRelo Logistics Ltd",
          url: "https://swiftrelo.example.test",
          description: "Residential moving and packing services in Lagos",
          evidence: [{ sourceUrl: "https://swiftrelo.example.test", claim: "Moving in Lagos" }],
        },
        movingJob,
      ),
    ).toBe(true);

    // Plumbing provider should fail Moving relevance
    expect(
      isProviderRelevantToJob(
        {
          entityType: "provider",
          name: "AquaFlow Plumbing",
          url: "https://aquaflow.example.test",
          description: "Plumbing services",
          evidence: [{ sourceUrl: "https://aquaflow.example.test", claim: "Plumbing in Lagos" }],
        },
        movingJob,
      ),
    ).toBe(false);
  });

  describe("global geography: canonical countries and cross-border gates", () => {
    it("canonicalizes supported countries and repairs naive code derivations", () => {
      // The screenshot defect: "United Kingdom" sliced to "UN".
      expect(canonicalizeCountry("United Kingdom", "UN")).toEqual({
        country: "United Kingdom",
        countryCode: "GB",
      });
      expect(canonicalizeCountry("united kingdom", "")).toEqual({
        country: "United Kingdom",
        countryCode: "GB",
      });
      expect(canonicalizeCountry("USA", "")).toEqual({
        country: "United States",
        countryCode: "US",
      });
      expect(canonicalizeCountry("UAE", "")).toEqual({
        country: "United Arab Emirates",
        countryCode: "AE",
      });
      expect(canonicalizeCountry("Nigeria", "")).toEqual({
        country: "Nigeria",
        countryCode: "NG",
      });
      expect(canonicalizeCountry("Nigeria", "NI")).toEqual({
        country: "Nigeria",
        countryCode: "NG",
      });
      expect(canonicalizeCountry("United States", "UN")).toEqual({
        country: "United States",
        countryCode: "US",
      });
      expect(canonicalizeCountry("United States", "US")).toEqual({
        country: "United States",
        countryCode: "US",
      });
      expect(
        effectiveCountryCode({ country: "Nigeria", countryCode: "NI" }),
      ).toBe("NG");
      expect(
        isProviderCountryCompatible(
          {
            name: "Lagos HVAC Provider",
            url: "https://lagos-hvac.example.test",
            description: "HVAC services in Lagos, Nigeria. Call +234 803 000 0000.",
            evidence: [],
          },
          { country: "Nigeria", countryCode: "NI" },
        ),
      ).toBe(true);
      // Unknown names with a well-formed code pass through attested.
      expect(canonicalizeCountry("Freedonia", "FD")).toEqual({
        country: "Freedonia",
        countryCode: "FD",
      });
      // Unknown names without a code cannot form a canonical area.
      expect(canonicalizeCountry("Other", "")).toBeNull();
      expect(canonicalizeCountry("", "")).toBeNull();
    });

    it("derives provider countries from evidence without hardcoding jobs", () => {
      const manhattan = {
        name: "D & A Electric, Inc. - Electrical Contractor in Manhattan, NY",
        url: "https://www.example-electric.test/services/manhattan-ny",
        description: "Electrical contractor serving Manhattan, New York. Call (212) 555-0100.",
        evidence: [],
      };
      expect(deriveProviderCountries(manhattan)).toContain("US");
      expect(deriveProviderCountries(manhattan)).not.toContain("GB");

      const lagos = {
        name: "Example HVAC Limited",
        url: "https://www.example-hvac.test/",
        description: "Air conditioning services in Ikeja, Lagos. Call +234 803 000 0000.",
        evidence: [],
      };
      expect(deriveProviderCountries(lagos)).toEqual(["NG"]);

      // Ambiguous single tokens stay silent instead of risking a false veto.
      expect(
        deriveProviderCountries({
          name: "Victoria Repair Co",
          url: "https://victoria-repair.example/",
          description: "Local repair services.",
          evidence: [],
        }),
      ).toEqual([]);
    });

    it("rejects cross-country providers and keeps same-country ones (both directions)", () => {
      const manhattanUS = {
        name: "D & A Electric, Inc. - Electrical Contractor in Manhattan, NY",
        url: "https://www.example-electric.test/services/manhattan-ny",
        description: "Electrical contractor serving Manhattan, New York.",
        evidence: [],
      };
      const londonUK = {
        name: "Camden Electric Ltd",
        url: "https://camden-electric.example/",
        description: "Electricians in Camden, London, United Kingdom. Call +44 20 7946 0018.",
        evidence: [],
      };
      // Job A (US): Manhattan may qualify, London is rejected.
      expect(isProviderCountryCompatible(manhattanUS, "US")).toBe(true);
      expect(isProviderCountryCompatible(londonUK, "US")).toBe(false);
      // Job B (UK): London may qualify, Manhattan is rejected.
      expect(isProviderCountryCompatible(londonUK, "GB")).toBe(true);
      expect(isProviderCountryCompatible(manhattanUS, "GB")).toBe(false);
      // Unknown provider geography never vetoes on its own.
      expect(
        isProviderCountryCompatible(
          { name: "Mystery Fixers", url: "https://mystery.example/", description: "We fix things." },
          "US",
        ),
      ).toBe(true);
      // Unknown job geography never vetoes either.
      expect(isProviderCountryCompatible(manhattanUS, undefined)).toBe(true);
      expect(isProviderCountryCompatible(manhattanUS, "")).toBe(true);
    });

    it("generates country-aware queries from the job's own structured geography", () => {
      const cases = [
        {
          serviceCategory: "Electrical",
          serviceLocation: "Harlem, New York, New York, United States",
          structuredLocation: {
            country: "United States",
            countryCode: "US",
            region: "New York",
            city: "New York",
            locality: "Harlem",
          },
          naturalLanguageDescription: "I need my bulbs changed",
          expectTokens: ["Harlem", "New York", "United States"],
        },
        {
          serviceCategory: "Cleaning",
          serviceLocation: "Oshodi, Lagos, Lagos State, Nigeria",
          structuredLocation: {
            country: "Nigeria",
            countryCode: "NG",
            region: "Lagos State",
            city: "Lagos",
            locality: "Oshodi",
          },
          naturalLanguageDescription: "Deep clean my flat",
          expectTokens: ["Oshodi", "Lagos", "Nigeria"],
        },
        {
          serviceCategory: "Plumbing",
          serviceLocation: "Camden, London, England, United Kingdom",
          structuredLocation: {
            country: "United Kingdom",
            countryCode: "GB",
            region: "England",
            city: "London",
            locality: "Camden",
          },
          naturalLanguageDescription: "Fix my leaking tap",
          expectTokens: ["Camden", "London", "United Kingdom"],
        },
        {
          serviceCategory: "HVAC",
          serviceLocation: "Downtown Toronto, Toronto, Ontario, Canada",
          structuredLocation: {
            country: "Canada",
            countryCode: "CA",
            city: "Toronto",
            locality: "Downtown Toronto",
          },
          naturalLanguageDescription: "Fix my AC",
          expectTokens: ["Toronto", "Canada"],
        },
      ];
      for (const job of cases) {
        const query = buildResearchQuery(job);
        expect(query).toContain(job.serviceCategory);
        for (const token of job.expectTokens) {
          expect(query).toContain(token);
        }
      }
      // Region-free areas still produce a usable country-anchored query.
      const regionFree = buildResearchQuery(cases[3]);
      expect(regionFree).toContain("Canada");
      expect(regionFree).not.toContain("undefined");
    });

    it("formats canonical service areas without impossible combinations", () => {
      expect(
        formatLocationText("Harlem, Newyork, United Kingdom", {
          country: "United Kingdom",
          countryCode: "GB",
          city: "Newyork",
          locality: "Harlem",
        }),
      ).toBe("Harlem, Newyork, United Kingdom");
      expect(
        formatLocationText(undefined, {
          country: "United States",
          countryCode: "US",
          region: "New York",
          city: "New York",
          locality: "Harlem",
        }),
      ).toBe("Harlem, New York, United States");
      expect(
        formatLocationText(undefined, {
          country: "Canada",
          countryCode: "CA",
          city: "Toronto",
          locality: "Downtown Toronto",
        }),
      ).toBe("Downtown Toronto, Toronto, Canada");
    });
  });

  it("demotes provider-owned article/listicle pages to discovery evidence, never provider identity", () => {
    // Generic shape (no business-specific hardcoding): article slug + article
    // title on a real company domain with provider-flavored site chrome.
    const articleInput = {
      url: "https://example-hvac.test/list-of-hvac-companies-in-lagos",
      title: "List of HVAC Companies in Lagos And Their Address",
      description:
        "HVAC is a term that means heating, ventilation, and air conditioning. Our company offers installation services. Contact us for a quote.",
      markdown:
        "List of HVAC Companies in Lagos. We offer installation services across Lagos. Contact us for a free quote.",
    };
    expect(classifyProviderSource(articleInput)).toBe("discovery_source");
    expect(
      isProviderEntity({
        name: articleInput.title,
        url: articleInput.url,
        description: articleInput.description,
      }),
    ).toBe(false);

    // Plural / slug variants stay evidence too.
    expect(
      classifyProviderSource({
        url: "https://example-hvac.test/blogs/best-ac-repair-tips",
        title: "How to choose an AC technician",
        description: "An article comparing local AC repair options.",
        markdown: "Read this guide before hiring.",
      }),
    ).toBe("discovery_source");

    // The owning business homepage itself remains a resolvable provider lead.
    expect(
      classifyProviderSource({
        url: "https://example-hvac.test/",
        title: "Example HVAC Ltd - Air Conditioning Services in Lagos",
        description:
          "We provide AC installation and repair services across Lagos. Contact us for a free quote.",
        markdown: "Our team serves residential customers. Request an estimate today.",
      }),
    ).toBe("provider");
  });
});
