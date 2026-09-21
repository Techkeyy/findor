/**
 * Non-destructive provider business-identity resolution for display.
 *
 * A provider-owned article/listicle page (e.g. `/list-of-...`) must never be
 * presented as the provider identity merely because its domain belongs to a
 * real company. Where the stored evidence supports it (same-domain brand
 * marks such as logo image alts), the UI displays the resolved actual
 * business (name + homepage). Otherwise the stored record is shown
 * unchanged, never fabricated.
 */

export interface DisplayCandidate {
  name: string;
  url: string;
  description?: string;
  evidence?: Array<{ sourceUrl: string; claim: string }>;
}

export interface BusinessDisplay {
  name: string;
  url: string;
  /** True when the identity was derived from evidence (not the stored row). */
  derived: boolean;
}

const ARTICLE_PATH =
  /\/(list-of-|listicle|blogs?\/|articles?\/)/i;

const ARTICLE_TITLE_SHAPE =
  /^(list of|top\s+\d+|best\s+(?:of\b|\d+))/i;

const IMAGE_ALT_BRAND =
  /!\[([^\]\n]{3,80})\]\((https?:\/\/[^)\s]+)\)/g;

const BUSINESS_SUFFIX =
  /\b(limited|ltd|llc|inc|incorporated|company|services|engineering|group|enterprises|solutions|contractors?|associates|partners)\b/i;

function hostnameOf(value: string): string {
  try {
    return new URL(value).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

function isArticleShapedIdentity(name: string, url: string): boolean {
  if (ARTICLE_TITLE_SHAPE.test(name.trim())) return true;
  try {
    if (ARTICLE_PATH.test(new URL(url).pathname)) return true;
  } catch {
    return false;
  }
  return false;
}

function brandFromEvidence(candidate: DisplayCandidate): string | null {
  const host = hostnameOf(candidate.url);
  if (!host) return null;
  const texts: string[] = [];
  if (candidate.description) texts.push(candidate.description);
  for (const item of candidate.evidence ?? []) {
    if (item?.claim) texts.push(item.claim);
  }
  for (const text of texts) {
    for (const match of text.matchAll(IMAGE_ALT_BRAND)) {
      const alt = (match[1] ?? "").trim();
      const src = match[2] ?? "";
      if (alt.length < 3) continue;
      if (hostnameOf(src) !== host) continue;
      if (ARTICLE_TITLE_SHAPE.test(alt)) continue;
      if (!BUSINESS_SUFFIX.test(alt) && !/logo|brand/i.test(src)) continue;
      return alt;
    }
  }
  return null;
}

/**
 * Resolves the truthful business display identity for a candidate row.
 * Historical outreach/email records are never rewritten; callers use this
 * for rendering only.
 */
export function resolveBusinessDisplay(
  candidate: DisplayCandidate,
): BusinessDisplay {
  if (!isArticleShapedIdentity(candidate.name, candidate.url)) {
    return { name: candidate.name, url: candidate.url, derived: false };
  }
  const brand = brandFromEvidence(candidate);
  if (!brand) {
    return { name: candidate.name, url: candidate.url, derived: false };
  }
  let homepage = candidate.url;
  try {
    homepage = new URL(candidate.url).origin + "/";
  } catch {
    // Keep the stored URL when it cannot be parsed.
  }
  return { name: brand, url: homepage, derived: true };
}
