export type ProviderEntityType = "provider" | "discovery_source";

type ProviderEvidence = { sourceUrl: string; claim: string };

type ProviderJobContext = {
  serviceCategory: string;
  serviceLocation: string;
  naturalLanguageDescription: string;
  structuredLocation?: {
    country: string;
    countryCode: string;
    region?: string;
    city: string;
    locality?: string;
    postalCode?: string;
  };
};

export type StructuredCountryInput = {
  country?: string;
  countryCode?: string;
};

type ProviderForJob = {
  entityType?: ProviderEntityType;
  name?: string;
  url?: string;
  description?: string;
  evidence: ProviderEvidence[];
};

type ProviderSourceInput = {
  url: string;
  title: string;
  description: string;
  markdown: string;
};

/**
 * Declarative, country-agnostic geography knowledge used UNIFORMLY for every
 * job: derive a provider's country from evidence text, then compare ISO codes
 * against the job's canonical country. This is data, not behavioral branching:
 * no `if country X do Y` paths exist anywhere in the pipeline.
 */
type CountrySignal = {
  code: string;
  names: string[];
  callingCodes: string[];
  regions: string[];
};

const COUNTRY_SIGNALS: CountrySignal[] = [
  {
    code: "US",
    names: ["united states", "united states of america", "usa", "u.s.", "u.s.a."],
    callingCodes: ["+1"],
    regions: [
      "alabama", "alaska", "arizona", "arkansas", "california", "colorado",
      "connecticut", "delaware", "florida", "georgia", "hawaii", "idaho",
      "illinois", "indiana", "iowa", "kansas", "kentucky", "louisiana",
      "maine", "maryland", "massachusetts", "michigan", "minnesota",
      "mississippi", "missouri", "montana", "nebraska", "nevada",
      "new hampshire", "new jersey", "new mexico", "new york", "north carolina",
      "north dakota", "ohio", "oklahoma", "oregon", "pennsylvania",
      "rhode island", "south carolina", "south dakota", "tennessee", "texas",
      "utah", "vermont", "virginia", "washington", "west virginia",
      "wisconsin", "wyoming", "district of columbia", "washington dc",
      "new york city", "nyc", "manhattan", "harlem", "brooklyn", "queens",
      "bronx", "staten island", "los angeles", "chicago", "houston", "austin",
    ],
  },
  {
    code: "GB",
    names: ["united kingdom", "uk", "u.k.", "great britain", "britain", "england", "scotland", "wales", "northern ireland"],
    callingCodes: ["+44"],
    regions: [
      "greater london", "london", "camden", "westminster", "manchester",
      "birmingham", "leeds", "liverpool", "bristol", "sheffield", "edinburgh",
      "glasgow", "cardiff", "belfast",
    ],
  },
  {
    code: "CA",
    names: ["canada"],
    callingCodes: ["+1"],
    regions: [
      "ontario", "quebec", "british columbia", "alberta", "manitoba",
      "saskatchewan", "nova scotia", "toronto", "ottawa", "vancouver",
      "montreal", "calgary", "downtown toronto",
    ],
  },
  {
    code: "NG",
    names: ["nigeria"],
    callingCodes: ["+234"],
    regions: [
      "lagos", "lagos state", "oshodi", "ikeja", "lekki", "victoria island",
      "abuja", "fct", "kano", "rivers", "port harcourt", "oyo", "ibadan",
    ],
  },
  {
    code: "DE",
    names: ["germany", "deutschland"],
    callingCodes: ["+49"],
    regions: ["berlin", "bavaria", "hamburg", "munich", "cologne", "frankfurt", "münchen", "muenchen"],
  },
  {
    code: "AE",
    names: ["united arab emirates", "uae"],
    callingCodes: ["+971"],
    regions: ["dubai", "abu dhabi", "abudhabi", "sharjah", "ajman"],
  },
  {
    code: "ZA",
    names: ["south africa"],
    callingCodes: ["+27"],
    regions: ["gauteng", "johannesburg", "joburg", "cape town", "kaapstad", "durban", "pretoria", "kwazulu-natal"],
  },
  {
    code: "IN",
    names: ["india", "bharat"],
    callingCodes: ["+91"],
    regions: ["maharashtra", "mumbai", "bombay", "delhi", "new delhi", "karnataka", "bangalore", "bengaluru", "tamil nadu", "chennai"],
  },
  {
    code: "GH",
    names: ["ghana"],
    callingCodes: ["+233"],
    regions: ["accra", "kumasi", "greater accra"],
  },
  {
    code: "KE",
    names: ["kenya"],
    callingCodes: ["+254"],
    regions: ["nairobi", "mombasa", "kisumu"],
  },
  {
    code: "FR",
    names: ["france"],
    callingCodes: ["+33"],
    regions: ["paris", "lyon", "marseille", "île-de-france"],
  },
  {
    code: "AU",
    names: ["australia"],
    callingCodes: ["+61"],
    regions: ["sydney", "melbourne", "brisbane", "perth", "new south wales", "victoria", "queensland"],
  },
];

/** Canonical supported-country table: free-text country -> {country, code}. */
const CANONICAL_COUNTRIES: Array<{ country: string; code: string; aliases: string[] }> =
  COUNTRY_SIGNALS.map((entry) => ({
    country: entry.code === "US" ? "United States"
      : entry.code === "GB" ? "United Kingdom"
      : entry.code === "CA" ? "Canada"
      : entry.code === "NG" ? "Nigeria"
      : entry.code === "DE" ? "Germany"
      : entry.code === "AE" ? "United Arab Emirates"
      : entry.code === "ZA" ? "South Africa"
      : entry.code === "IN" ? "India"
      : entry.code === "GH" ? "Ghana"
      : entry.code === "KE" ? "Kenya"
      : entry.code === "FR" ? "France"
      : "Australia",
    code: entry.code,
    aliases: entry.names,
  }));

/**
 * Canonicalizes a user-supplied country + code pair to the supported table.
 * Fixes naive derivations (e.g. "United Kingdom" sliced to "UN") by always
 * returning the table ISO code for known names. Returns null when neither a
 * known country nor a well-formed ISO code is present.
 */
export function canonicalizeCountry(
  country: string,
  countryCode: string,
): { country: string; countryCode: string } | null {
  const nameKey = country.trim().toLowerCase().replace(/\s+/g, " ");
  const codeKey = countryCode.trim().toUpperCase();
  if (nameKey) {
    const hit = CANONICAL_COUNTRIES.find(
      (entry) =>
        entry.country.toLowerCase() === nameKey ||
        entry.aliases.some((alias) => alias.toLowerCase() === nameKey),
    );
    if (hit) return { country: hit.country, countryCode: hit.code };
  }
  if (/^[A-Z]{2}$/.test(codeKey) && nameKey.length >= 2) {
    return {
      country: canonicalizeGeographicSegment(country),
      countryCode: codeKey,
    };
  }
  return null;
}

/** Returns the canonical country code used by all geo-sensitive gates. */
export function effectiveCountryCode(
  locationOrCountryCode?: string | StructuredCountryInput | null,
): string | undefined {
  if (typeof locationOrCountryCode === "string") {
    const code = locationOrCountryCode.trim().toUpperCase();
    return /^[A-Z]{2}$/.test(code) ? code : undefined;
  }
  if (!locationOrCountryCode) return undefined;
  const canonical = canonicalizeCountry(
    locationOrCountryCode.country ?? "",
    locationOrCountryCode.countryCode ?? "",
  );
  if (canonical) return canonical.countryCode;
  const code = (locationOrCountryCode.countryCode ?? "").trim().toUpperCase();
  return /^[A-Z]{2}$/.test(code) ? code : undefined;
}

/**
 * Derives the set of probable ISO country codes for a provider candidate
 * from evidence text (names, addresses, calling codes, region mentions).
 * Returns an empty set when geography is unknown — callers must not treat
 * unknown as a match, but unknown alone never vetoes either.
 */
export function deriveProviderCountries(candidate: {
  name?: string;
  url?: string;
  description?: string;
  evidence?: Array<{ sourceUrl: string; claim: string }>;
}): string[] {
  const corpus = [
    candidate.name ?? "",
    candidate.url ?? "",
    candidate.description ?? "",
    ...(candidate.evidence ?? []).flatMap((item) => [
      item.sourceUrl ?? "",
      item.claim ?? "",
    ]),
  ]
    .join(" ")
    .replace(/\s+/g, " ")
    .toLowerCase();
  const found = new Set<string>();
  const explicit = new Set<string>();
  const hitRegion = (region: string) =>
    new RegExp(`\\b${escapeRegExp(region)}\\b`).test(corpus);
  for (const entry of COUNTRY_SIGNALS) {
    if (entry.names.some((name) => new RegExp(`\\b${escapeRegExp(name)}\\b`).test(corpus))) {
      found.add(entry.code);
      explicit.add(entry.code);
      continue;
    }
    // Multi-word regions (states, provinces, metros) are strong standalone
    // signals. Single-word regions only corroborate: on their own they stay
    // silent (e.g. "Victoria" exists in several countries) instead of
    // risking a false country veto.
    const strong = entry.regions.filter((region) => region.includes(" "));
    const weak = entry.regions.filter((region) => !region.includes(" "));
    if (strong.some(hitRegion)) {
      found.add(entry.code);
      explicit.add(entry.code);
      continue;
    }
    if (
      weak.some(hitRegion) &&
      (entry.callingCodes.some((prefix) =>
        new RegExp(`(^|[^0-9])${escapeRegExp(prefix)}[\\s\\-.()]*[0-9]`).test(corpus),
      ) ||
        entry.names.some((name) => new RegExp(`\\b${escapeRegExp(name)}\\b`).test(corpus)))
    ) {
      found.add(entry.code);
      explicit.add(entry.code);
    }
  }
  for (const entry of COUNTRY_SIGNALS) {
    const owners = COUNTRY_SIGNALS.filter((other) =>
      other.callingCodes.some((prefix) => entry.callingCodes.includes(prefix)),
    ).map((other) => other.code);
    const shared = owners.length > 1;
    const matched = entry.callingCodes.some((prefix) =>
      new RegExp(`(^|[^0-9])${escapeRegExp(prefix)}[\\s\\-.()]*[0-9]`).test(corpus),
    );
    if (!matched) continue;
    if (!shared) {
      found.add(entry.code);
      continue;
    }
    // Ambiguous shared calling code (e.g. NANP +1 serves US and CA): only
    // corroborate countries already evidenced by names/regions, otherwise
    // keep every owner (unknown-leaning, never a false veto).
    if (explicit.size > 0) {
      for (const code of owners) {
        if (explicit.has(code)) found.add(code);
      }
    } else {
      for (const code of owners) found.add(code);
    }
  }
  return Array.from(found);
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Unambiguous city/district -> ISO country map for intake consistency.
 * Every entry is a place name that overwhelmingly identifies one country
 * (ambiguous names such as Lagos, London, Paris, Toronto, Victoria, or
 * single-word US states are deliberately excluded). Used ONLY to flag
 * provably inconsistent city and country combinations with a
 * friendly field error — never to auto-correct user input.
 */
const UNAMBIGUOUS_PLACE_COUNTRY: Array<[place: string, code: string]> = [
  ["manhattan", "US"],
  ["harlem", "US"],
  ["brooklyn", "US"],
  ["queens", "US"],
  ["bronx", "US"],
  ["staten island", "US"],
  ["new york city", "US"],
  ["nyc", "US"],
  ["oshodi", "NG"],
  ["ikeja", "NG"],
  ["lekki", "NG"],
  ["victoria island", "NG"],
  ["abuja", "NG"],
  ["ibadan", "NG"],
  ["port harcourt", "NG"],
  ["kano", "NG"],
  ["sandton", "ZA"],
  ["johannesburg", "ZA"],
  ["joburg", "ZA"],
  ["soweto", "ZA"],
  ["pretoria", "ZA"],
  ["durban", "ZA"],
  ["andheri", "IN"],
  ["bandra", "IN"],
  ["new delhi", "IN"],
  ["bengaluru", "IN"],
  ["chennai", "IN"],
  ["berlin", "DE"],
  ["kreuzberg", "DE"],
  ["munich", "DE"],
  ["muenchen", "DE"],
  ["münchen", "DE"],
  ["hamburg", "DE"],
  ["dubai", "AE"],
  ["sharjah", "AE"],
  ["abu dhabi", "AE"],
  ["abudhabi", "AE"],
  ["accra", "GH"],
  ["kumasi", "GH"],
  ["nairobi", "KE"],
  ["mombasa", "KE"],
  ["lyon", "FR"],
  ["marseille", "FR"],
  ["sydney", "AU"],
  ["melbourne", "AU"],
  ["camden town", "GB"],
  ["westminster", "GB"],
  ["manchester", "GB"],
  ["downtown toronto", "CA"],
  ["ottawa", "CA"],
  ["vancouver", "CA"],
  ["montreal", "CA"],
  ["calgary", "CA"],
];

/**
 * Returns true when a city/locality/region segment provably belongs to a
 * different country than the selected canonical country code. Unknown or
 * ambiguous places never flag (no worldwide geocoder is assumed).
 */
export function isInconsistentPlaceForCountry(
  segment: string,
  countryCode: string,
): boolean {
  const key = segment.trim().toLowerCase().replace(/\s+/g, " ");
  if (!key || !/^[A-Z]{2}$/.test(countryCode)) return false;
  const hit = UNAMBIGUOUS_PLACE_COUNTRY.find(([place]) => place === key);
  if (!hit) return false;
  return hit[1] !== countryCode;
}

/**
 * Hard geographic compatibility gate: a provider whose resolved country
 * conflicts with the job country can never qualify. Unknown provider
 * geography does not veto (evidence resolution continues), and never
 * counts as a match. No fuzzy matching overrides a country mismatch.
 */
export function isProviderCountryCompatible(
  candidate: {
    name?: string;
    url?: string;
    description?: string;
    evidence?: Array<{ sourceUrl: string; claim: string }>;
  },
  jobCountryCode: string | StructuredCountryInput | undefined | null,
): boolean {
  const jobCode = effectiveCountryCode(jobCountryCode);
  if (!jobCode) return true;
  const derived = deriveProviderCountries(candidate);
  if (derived.length === 0) return true;
  return derived.includes(jobCode);
}

const knownDiscoveryHosts = [
  "angi.com",
  "bbb.org",
  "care.com",
  "craigslist.org",
  "facebook.com",
  "forbes.com",
  "gumtree.com",
  "hireahelper.com",
  "homeadvisor.com",
  "instagram.com",
  "jiji.ng",
  "linkedin.com",
  "mapquest.com",
  "medium.com",
  "nextdoor.com",
  "pinterest.com",
  "quora.com",
  "reddit.com",
  "thumbtack.com",
  "tiktok.com",
  "trustamai.com",
  "trustpilot.com",
  "twitter.com",
  "x.com",
  "yellowpages.com",
  "yelp.com",
  "youtube.com",
];

const discoverySignals = [
  /\b(?:find|hire|connect with)\b.*\b(?:verified|trusted|local)\b.*\b(?:providers?|professionals?|cleaners?|movers?|contractors?)\b/i,
  /\b(?:compare|connect)\b.*\b(?:providers?|professionals?|quotes?)\b/i,
  /\bmultiple quotes\b/i,
  /\bregister as a professional\b/i,
  /\b(?:cost|price)\s+calculator\b/i,
];

// These markers describe the page/entity type itself. They must win over
// provider marketing copy so a directory, association, training program, or
// explicit listicle cannot become an outreach target merely because it also
// mentions a trade and a service area.
const hardDiscoverySignals = [
  /\b(?:directory|directories|marketplace|aggregator|review portal|listicle|publisher)\b/i,
  /\b(?:training program|association|institute|certification program|trade school|academy)\b/i,
  /\b(?:government|attorney general|department of|municipal|official website of the)\b/i,
  /\b(?:members?\s+only|membership|chapter)\b/i,
  /\b(?:article|guide|how to|tips|explainer|code basics|news release)\b/i,
  /\b(?:list of)\b.+?\b(?:companies|providers?|services?|contractors?|businesses)\b.+\b(?:address|addresses|phone|contact|location|locations)\b/i,
  // Member-listing structure inside page content (directory profile links).
  /\bhttps?:\/\/[^\s"'<>)]*\/(?:listing|listings|members?|directory)\//i,
];

// Marketing superlatives are common on legitimate provider homepages (for
// example, "top-rated electrical contractor"). Keep them as discovery
// evidence only when the page otherwise looks like a comparison/listicle.
const listicleSignals = [
  /\b(?:list of|top|best)\s+(?:\d*\s*)?(?:local\s+)?(?:[a-z]+\s+){0,4}(?:companies|providers?|services?|cleaners?|movers?|contractors?)\b/i,
  /\b(?:companies|providers?|contractors?)\b.{0,80}\b(?:compared|comparison|ranked|prices?|addresses?|directory)\b/i,
];

const discoveryPathSignals =
  /\/(?:list-of-|(?:tools?|calculators?|directory|directories|marketplace|category|categories|search|results|blog|blogs|news|articles?|guides?|lists?|listicle|groups?|posts?|reels?|p|shorts?|watch|questions?|topic|discuss|forum|thread|community|channel|user|status|support|press|company-info|our-history)(?:\/|$|\?))/i;

const providerSignals = [
  /\b(?:we|our)\s+(?:provide|offer|serve|specialize|cover|help)\b/i,
  /\b(?:service area|areas served|areas we serve|serving)\b/i,
  /\b(?:electricians?|electrical|plumbers?|plumbing|hvac|contractors?|technicians?|cleaners?|cleaning|movers?|moving|painters?|painting|handyman|roofers?|roofing)\b[\w\s,&-]{0,45}\b(?:service|services|contractor|contractors)\b/i,
  /\b(?:service|services|serves|serving)\b[\w\s,&-]{0,45}\b(?:electricians?|electrical|plumbers?|plumbing|hvac|contractors?|technicians?|cleaners?|cleaning|movers?|moving|painters?|painting|handyman|roofers?|roofing)\b/i,
  /\b(?:request|get|free)\s+(?:a\s+)?(?:quote|estimate)\b/i,
  /\b(?:contact us|book an appointment|locally owned|our team)\b/i,
  /\b(?:company|business)\b.*\bservices?\b/i,
  // Trade-homepage language: licensed trade + nearby trade noun, or an
  // explicit residential/commercial trade section. Official provider-owned
  // homepages must not become discovery_source merely for marketing copy.
  /\b(?:licensed|certified|insured|bonded)\b[\w\s,&-]{0,40}?\b(?:electricians?|electrical|plumbers?|plumbing|hvac|contractors?|technicians?|cleaners?|cleaning|movers?|moving|painters?|painting|handyman|roofers?|roofing)\b/i,
  /\b(?:residential|commercial)\s+(?:electricians?|electrical|plumbers?|plumbing|hvac|contractors?|technicians?|cleaners?|cleaning|movers?|moving|painters?|painting)\b/i,
];

const relevanceStopWords = new Set([
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

function isKnownDiscoveryHost(url: string) {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    return knownDiscoveryHosts.some(
      (host) => hostname === host || hostname.endsWith("." + host),
    );
  } catch {
    return true;
  }
}

function hasAnySignal(value: string, signals: RegExp[]) {
  return signals.some((signal) => signal.test(value));
}

function hasProviderSignal(value: string) {
  return hasAnySignal(value, providerSignals);
}

export function classifyProviderSource(
  input: ProviderSourceInput,
): ProviderEntityType {
  const title = input.title.trim();
  const sourceText = [title, input.description, input.markdown, input.url]
    .join(" ")
    .replace(/\s+/g, " ");
  const identityText = [title, input.description]
    .join(" ")
    .replace(/\s+/g, " ");

  if (isKnownDiscoveryHost(input.url)) return "discovery_source";
  if (discoveryPathSignals.test(input.url)) {
    return "discovery_source";
  }

  // Search descriptions and titles are the reliable page-identity signal.
  // Full Markdown often contains incidental footer copy (for example a
  // provider saying it is not a directory); do not let that demote an
  // otherwise provider-owned homepage. A real member/listing link remains a
  // hard discovery signal wherever it appears.
  if (
    hasAnySignal(identityText, hardDiscoverySignals) ||
    hasAnySignal(identityText, listicleSignals) ||
    /\.gov(?:\/|$)/i.test(input.url) ||
    /\bhttps?:\/\/[^\s"'<>)]*\/(?:listing|listings|members?|directory)\//i.test(
      sourceText,
    )
  ) {
    return "discovery_source";
  }

  // Marketplace and comparison language is a discovery identity signal even
  // when the source host is not in a fixed directory list.
  if (hasAnySignal(sourceText, discoverySignals)) return "discovery_source";

  // Entity identity is the first question. A provider-owned homepage that
  // says "top-rated" or "best" is still a provider when it contains direct
  // service/business evidence. Explicit directory, marketplace, training,
  // or listicle paths were handled above; the remaining content signals are
  // only discovery evidence when provider identity is not established.
  if (hasProviderSignal(sourceText)) return "provider";
  if (hasAnySignal(sourceText, listicleSignals)) return "discovery_source";
  return "discovery_source";
}

function isObviousDiscoverySource(input: ProviderSourceInput) {
  const identityText = [input.title, input.description]
    .join(" ")
    .replace(/\s+/g, " ");
  const sourceText = [input.title, input.description, input.markdown, input.url]
    .join(" ")
    .replace(/\s+/g, " ");
  return (
    isKnownDiscoveryHost(input.url) ||
    hasAnySignal(identityText, hardDiscoverySignals) ||
    hasAnySignal(identityText, listicleSignals) ||
    hasAnySignal(sourceText, discoverySignals) ||
    discoveryPathSignals.test(input.url)
  );
}

export function isProviderEntity(candidate: {
  entityType?: ProviderEntityType;
  name?: string;
  url?: string;
  description?: string;
}) {
  if (candidate.entityType) {
    return candidate.entityType === "provider";
  }

  // Legacy records predate the discriminator. Quarantine only obvious discovery
  // sources at read/send time while preserving legitimate legacy providers.
  return !isObviousDiscoverySource({
    url: candidate.url ?? "",
    title: candidate.name ?? "",
    description: candidate.description ?? "",
    markdown: "",
  });
}

export function mergeProviderEvidence(
  existing: Array<{ sourceUrl: string; claim: string }>,
  additions: Array<{ sourceUrl: string; claim: string }>,
  limit = 12,
) {
  const merged = existing.slice(0, limit);
  for (const addition of additions) {
    const exactMatch = merged.some(
      (item) =>
        item.sourceUrl === addition.sourceUrl && item.claim === addition.claim,
    );
    if (exactMatch) continue;

    const sameSourceIndex = merged.findIndex(
      (item) => item.sourceUrl === addition.sourceUrl,
    );
    const isSourceBackedContactClaim = /public business contact/i.test(
      addition.claim,
    );
    if (sameSourceIndex >= 0 && isSourceBackedContactClaim) {
      merged[sameSourceIndex] = addition;
      continue;
    }
    if (merged.length < limit) merged.push(addition);
  }
  return merged;
}

export function hasSourceBackedPublicBusinessEmail(candidate: {
  entityType?: ProviderEntityType;
  name?: string;
  url?: string;
  description?: string;
  contactability: "email_found" | "website_only";
  contactEmail?: string;
  evidence: Array<{ sourceUrl: string; claim: string }>;
}) {
  if (
    !isProviderEntity(candidate) ||
    candidate.contactability !== "email_found" ||
    !candidate.contactEmail
  ) {
    return false;
  }

  const email = candidate.contactEmail.toLowerCase();
  return candidate.evidence.some(
    (item) =>
      /^https?:\/\//i.test(item.sourceUrl) &&
      item.claim.toLowerCase().includes(email),
  );
}

export function providerIdentityKey(candidate: {
  name?: string;
  url?: string;
  contactEmail?: string;
}) {
  try {
    const hostname = new URL(candidate.url ?? "").hostname
      .toLowerCase()
      .replace(/^www\./, "");
    if (hostname) return "domain:" + hostname;
  } catch {
    // Fall back to durable contact/name identity for malformed legacy URLs.
  }
  const email = candidate.contactEmail?.trim().toLowerCase();
  if (email) return "email:" + email;
  return "name:" + (candidate.name ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

function tokens(value: string, minimumLength: number) {
  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(
      (token) => token.length >= minimumLength && !relevanceStopWords.has(token),
    );
}

/**
 * Re-check the generic service/location relevance gate at the moment an
 * autonomous follow-up would send. Discovery happened earlier, but an old
 * scheduled callback must not retain authority after the candidate rules or
 * job brief have changed.
 */
export function isProviderRelevantToJob(
  candidate: ProviderForJob,
  job: ProviderJobContext,
) {
  const corpus = [
    candidate.name,
    candidate.url,
    candidate.description,
    ...candidate.evidence.flatMap((item) => [item.sourceUrl, item.claim]),
  ]
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .toLowerCase();
  const providerIdentityCorpus = [candidate.name, candidate.url, candidate.description]
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .toLowerCase();

  const serviceTokens = Array.from(
    new Set(
      tokens(job.serviceCategory + " " + job.naturalLanguageDescription, 4),
    ),
  );
  const locationText = [
    job.serviceLocation,
    job.structuredLocation?.country,
    effectiveCountryCode(job.structuredLocation),
    job.structuredLocation?.region,
    job.structuredLocation?.city,
    job.structuredLocation?.locality,
    job.structuredLocation?.postalCode,
  ]
    .filter(Boolean)
    .join(" ");
  const locationTokens = Array.from(new Set(tokens(locationText, 3)));
  const serviceMatch =
    serviceTokens.length === 0 ||
    serviceTokens.some((token) => providerIdentityCorpus.includes(token));
  const locationMatch =
    locationTokens.length === 0 ||
    locationTokens.some((token) => corpus.includes(token));
  const serviceAreaSignal =
    /service area|areas served|areas we serve|serves the/i.test(corpus);

  return serviceMatch && (locationMatch || serviceAreaSignal);
}

export function redactExactAddressLikeText(
  value: string | undefined | null,
): string {
  if (!value) return "";
  return value
    .replace(
      /\b(?:\d+[A-Za-z]?|no\.?\s*\d+|plot\s*\d+|house\s*\d+|block\s*\d+)\s+[A-Za-z0-9.'-]+(?:\s+[A-Za-z0-9.'-]+){0,4}\s+(?:street|st|road|rd|avenue|ave|close|cl|crescent|cres|drive|dr|lane|ln|way|boulevard|blvd|terrace|terr|place|pl|court|ct|highway|hwy|estate|circle|cir|square|sq|alley|walk|grove|mews|row|gate|gardens|gdn|villas|view|hill|rise|vale|park|yard|wharf|quay)\b[^\n,;]*/gi,
      "[exact address withheld]",
    )
    .replace(
      /\b[A-Za-z0-9.'-]+(?:\s+[A-Za-z0-9.'-]+){0,3}\s+(?:street|st|road|rd|avenue|ave|close|cl|crescent|cres|drive|dr|lane|ln|way|boulevard|blvd|terrace|terr|place|pl|court|ct|highway|hwy|estate|circle|cir|square|sq|alley|walk|grove|mews|row|gate|gardens|gdn|villas|view|hill|rise|vale|park|yard|wharf|quay)\b(?=\s*(?:,|$))/gi,
      "[exact address withheld]",
    )
    .replace(
      /(^|,\s*)(?:no\.?\s*\d+|\d+[A-Za-z]?|plot\s*\d+|house\s*\d+|block\s*\d+)\s+[A-Za-z0-9.'-]+(?:\s+[A-Za-z0-9.'-]+){0,3}(?=\s*(?:,|$))/gi,
      "$1[exact address withheld]",
    )
    .replace(
      /\b(?:apartment|apt|unit|flat|suite|room|rm|house|no\.?|plot|block|bldg|building|floor|fl)\s*#?\s*\d+[A-Za-z]?\b/gi,
      "[private unit withheld]",
    )
    .replace(/\[exact address withheld\](?:\s*,\s*\[exact address withheld\])+/g, "[exact address withheld]")
    .replace(/\[private unit withheld\](?:\s*,\s*\[private unit withheld\])+/g, "[private unit withheld]")
    .replace(/\[private unit withheld\]\s+\[exact address withheld\]/g, "[private unit withheld], [exact address withheld]");
}

export function canonicalizeGeographicSegment(segment: string): string {
  const trimmed = segment.trim().replace(/\s+/g, " ");
  if (!trimmed) return "";
  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    return trimmed;
  }
  // If the segment is entirely lowercase, capitalize each word
  if (trimmed === trimmed.toLowerCase()) {
    return trimmed.replace(/\b[a-z]/g, (char) => char.toUpperCase());
  }
  return trimmed;
}

export function formatLocationSegments(
  segments: (string | undefined | null)[],
): string {
  const cleaned: { key: string; original: string; best: string }[] = [];

  for (const raw of segments) {
    if (!raw || typeof raw !== "string") continue;
    const trimmed = raw.trim().replace(/\s+/g, " ");
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    const formatted = canonicalizeGeographicSegment(trimmed);

    const existingIndex = cleaned.findIndex((c) => c.key === key);
    if (existingIndex >= 0) {
      const existing = cleaned[existingIndex];
      const existingIsAllLower =
        existing.original === existing.original.toLowerCase();
      const currentIsAllLower = trimmed === trimmed.toLowerCase();
      if (existingIsAllLower && !currentIsAllLower) {
        existing.best = trimmed;
        existing.original = trimmed;
      }
    } else {
      cleaned.push({
        key,
        original: trimmed,
        best: formatted,
      });
    }
  }

  return cleaned.map((c) => c.best).join(", ");
}

export function formatLocationText(
  rawText?: string | null,
  structuredLocation?: {
    country?: string;
    countryCode?: string;
    region?: string;
    city?: string;
    locality?: string;
    postalCode?: string;
  } | null,
): string {
  if (
    structuredLocation &&
    (structuredLocation.locality ||
      structuredLocation.city ||
      structuredLocation.region ||
      structuredLocation.country)
  ) {
    const formatted = formatLocationSegments([
      structuredLocation.locality,
      structuredLocation.city,
      structuredLocation.region,
      structuredLocation.country,
    ]);
    if (formatted) return formatted;
  }

  if (!rawText || typeof rawText !== "string") return "";
  const parts = rawText.split(",").map((p) => p.trim()).filter(Boolean);
  return formatLocationSegments(parts);
}

export function formatExternalServiceArea(
  structuredLocation?: {
    country?: string;
    countryCode?: string;
    region?: string;
    city?: string;
    locality?: string;
    postalCode?: string;
  } | null,
  rawFallback?: string | null,
): string {
  if (
    structuredLocation &&
    (structuredLocation.city ||
      structuredLocation.region ||
      structuredLocation.country)
  ) {
    const rawLocality = structuredLocation.locality?.trim();
    let safeLocality: string | undefined = undefined;
    if (rawLocality) {
      const redacted = redactExactAddressLikeText(rawLocality);
      if (!redacted.includes("[exact address withheld]")) {
        safeLocality = rawLocality;
      }
    }

    const rawCity = structuredLocation.city?.trim();
    let safeCity: string | undefined = rawCity;
    if (rawCity) {
      const redactedCity = redactExactAddressLikeText(rawCity);
      if (redactedCity.includes("[exact address withheld]")) {
        safeCity = undefined;
      }
    }

    const formatted = formatLocationSegments([
      safeLocality,
      safeCity,
      structuredLocation.region?.trim(),
      structuredLocation.country?.trim(),
    ]);

    if (formatted) {
      return formatted;
    }
  }

  if (rawFallback) {
    const redacted = redactExactAddressLikeText(rawFallback);
    return formatLocationText(redacted);
  }

  return "Local service area";
}

const leadNonBusinessSignals = [
  /\b(?:price|prices|pricing|cost|costs|rate|rates|fee|fees|calculator|estimate|estimates|quote|quotes)\b/i,
  /\b(?:guide|tips?|how to|faq|faqs|frequently asked|questions?|about us|contact us|privacy|terms|overview|summary|conclusion|table of contents)\b/i,
  /\b(?:reviews?|ratings?|top \d+|best \d+|cheap|affordable|safety|checklist|introduction)\b/i,
  /\b(?:step|tip|option|category|service|level|type|phase|item)\s+\d+\b/i,
  /\b(?:residential|commercial|deep|house|office|emergency|interstate)\s+(?:cleaning|plumbing|hvac|electrical|moving)\s+(?:services?|costs?|prices?|rates?|guide)\b/i,
  /\b(?:best|top|list of)\s+(?:local\s+)?(?:cleaning|plumbing|hvac|electrical|moving|relocation|air conditioning)\s+(?:companies|agencies|contractors|services|movers|cleaners|plumbers|electricians)\b/i,
];

function isLegitimateLeadName(name: string): boolean {
  const trimmed = name.trim();
  if (trimmed.length < 3 || trimmed.length > 55) return false;
  if (!/[a-zA-Z]/.test(trimmed)) return false;
  if (leadNonBusinessSignals.some((regex) => regex.test(trimmed))) return false;
  return true;
}

export function extractBusinessLeadsFromDiscoveryText(
  markdown: string,
  _serviceCategory?: string,
): string[] {
  if (!markdown || typeof markdown !== "string") return [];
  const leads: string[] = [];
  const lines = markdown.split(/\r?\n/);

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    let candidate = "";

    // Pattern 1: Numbered or bulleted list items with ordinary provider names.
    const listMatch = trimmed.match(/^(?:(?:\d+[.)]|\*|-)\s+)(.+)$/);
    if (listMatch) {
      const itemText = listMatch[1].replace(/^\*+|\*+$/g, "").trim();
      // Split on standard lead delimiters: " - ", " – ", " — ", ": ", " (", " | "
      const parts = itemText.split(/\s+[-–—:]\s+|\s*[:|]\s+|\s+\(/);
      candidate = parts[0]?.trim().replace(/^\*+|\*+$/g, "").trim() ?? "";
    } else {
      // Pattern 2: Headings (e.g. "## VoltMaster Electrical Works: ...", "### 1. ArcticBreeze Air Systems")
      const headingMatch = trimmed.match(/^#{1,4}\s+(?:(?:\d+[.)]\s+)?)(.+)$/);
      if (headingMatch) {
        const headingText = headingMatch[1].replace(/^\*+|\*+$/g, "").trim();
        const parts = headingText.split(/\s+[-–—:]\s+|\s*[:|]\s+|\s+\(/);
        candidate = parts[0]?.trim().replace(/^\*+|\*+$/g, "").trim() ?? "";
      }
    }

    if (candidate && isLegitimateLeadName(candidate)) {
      leads.push(candidate);
    }
  }

  // Deduplicate preserving order
  const uniqueLeads = Array.from(new Set(leads));
  return uniqueLeads.slice(0, 5);
}
