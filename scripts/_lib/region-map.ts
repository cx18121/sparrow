export const REGION_MAP: Record<string, string> = {
  // Bay Area
  "san francisco": "Bay Area",
  sf: "Bay Area",
  "san jose": "Bay Area",
  "palo alto": "Bay Area",
  "mountain view": "Bay Area",
  "menlo park": "Bay Area",
  sunnyvale: "Bay Area",
  oakland: "Bay Area",
  berkeley: "Bay Area",
  "redwood city": "Bay Area",
  // New York Metro
  "new york": "New York Metro",
  nyc: "New York Metro",
  brooklyn: "New York Metro",
  manhattan: "New York Metro",
  // Pacific Northwest
  seattle: "Pacific Northwest",
  bellevue: "Pacific Northwest",
  portland: "Pacific Northwest",
  // Boston / Cambridge
  boston: "Boston / Cambridge",
  cambridge: "Boston / Cambridge",
  // Other US cities
  austin: "Austin",
  "los angeles": "Los Angeles",
  la: "Los Angeles",
  "santa monica": "Los Angeles",
  chicago: "Chicago",
  denver: "Denver / Boulder",
  boulder: "Denver / Boulder",
  // International
  london: "London",
  berlin: "Berlin",
  toronto: "Toronto",
  bangalore: "Bangalore",
  singapore: "Singapore",
  // Remote
  remote: "Remote",
};

/**
 * Normalize a raw location string to a named region.
 * Returns the region name if found, the raw string if unknown, or null if input is null/empty.
 */
export function normalizeRegion(rawLocation: string | null): string | null {
  if (!rawLocation) return null;

  const lower = rawLocation.toLowerCase();

  for (const [key, region] of Object.entries(REGION_MAP)) {
    if (lower.includes(key)) {
      return region;
    }
  }

  // Pass through unknown locations unchanged
  return rawLocation;
}
