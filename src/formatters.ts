import type { Doc } from "../convex/_generated/dataModel";

export interface LocationAllowlist {
  country: string;
  city: string;
  region?: string;
  locality?: string;
  postalCode?: string;
}

export function formatEventTime(timestamp?: number | null) {
  if (!timestamp || typeof timestamp !== "number" || isNaN(timestamp)) {
    return "";
  }
  return new Date(timestamp).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function processingStatusCopy(status?: string | null) {
  if (!status) return "Reply received";
  return status === "understood"
    ? "Understood"
    : status === "understanding"
      ? "Understanding"
      : status === "needs_review"
        ? "Needs review"
        : status === "delivery_failed"
          ? "Delivery failed"
        : status === "unmatched"
          ? "Quarantined"
          : status === "failed"
            ? "Needs review"
            : "Reply received";
}

export function formatEnumLabel(value?: string | null, fallback = "Not stated") {
  if (!value || typeof value !== "string") return fallback;
  const normalized = value.trim();
  if (!normalized) return fallback;
  return normalized.replace(/[_-]+/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

export function formatTimingLabel(value?: string | null) {
  if (!value || typeof value !== "string" || !value.trim()) return "Flexible";
  const normalized = value.trim().toLowerCase();
  const knownLabels: Record<string, string> = {
    asap: "Today / urgently",
    this_week: "This week",
    next_week: "Next week",
    flexible: "Flexible",
    this_month: "This month",
  };
  return knownLabels[normalized] || value.trim();
}

export function responseKindLabel(kind?: string | null) {
  if (!kind) return "Response";
  return kind.replace(/_/g, " ");
}

export function formatList(values?: string[] | null) {
  if (!values || !Array.isArray(values) || values.length === 0) {
    return "Not stated";
  }
  return values.join(", ");
}

export function priceRange(
  response?: Partial<
    Pick<
      Doc<"providerResponses">,
      "priceMin" | "priceMax" | "currency"
    >
  > | null,
) {
  if (!response) return "Not stated";
  if (response.priceMin === undefined && response.priceMax === undefined)
    return "Not stated";
  const currency = response.currency ? response.currency + " " : "";
  if (response.priceMin !== undefined && response.priceMax !== undefined) {
    return currency + response.priceMin + " to " + response.priceMax;
  }
  return currency + (response.priceMin ?? response.priceMax);
}

export function formatBytes(size?: number | null) {
  if (size === undefined || size === null || typeof size !== "number" || isNaN(size)) return "0 B";
  if (size < 1024) return size + " B";
  if (size < 1024 * 1024) return (size / 1024).toFixed(1) + " KB";
  return (size / (1024 * 1024)).toFixed(1) + " MB";
}

export function canonicalizeGeographicSegment(segment: string): string {
  const trimmed = segment.trim().replace(/\s+/g, " ");
  if (!trimmed) return "";
  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    return trimmed;
  }
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

export function formatStructuredLocation(
  structuredLocation?: {
    country?: string;
    countryCode?: string;
    region?: string;
    city?: string;
    locality?: string;
    postalCode?: string;
  } | null,
): string {
  if (!structuredLocation) return "";
  return formatLocationSegments([
    structuredLocation.locality,
    structuredLocation.city,
    structuredLocation.region,
    structuredLocation.country,
  ]);
}
