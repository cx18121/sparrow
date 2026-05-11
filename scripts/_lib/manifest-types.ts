// Manifest schema for VC portfolio scrapers. One JSON file per source; the
// runner (manifest-ingestor.ts) dispatches on `fetch.type` and produces
// CompanyRecord[] that flows through the same runIngestor pipeline the
// hand-coded adapters use. New sources of a shape that fits one of these
// strategies become a JSON edit rather than a new TypeScript file.
//
// Two strategies in scope today:
//   - "wp-rest": consumes a WordPress REST API endpoint (Pear, KP-shape sources)
//   - "html":    fetches a single page and runs cheerio selectors (Wave-shape)
//
// Future strategies (deferred until a real source needs them):
//   - "html-paginated": load-more / numbered pages
//   - "playwright":     JS-rendered SPAs (Insight, GC, Coatue)
//   - "json-api":       arbitrary JSON endpoint with JSONPath-ish projections
//
// Whichever strategy is in play, the manifest declares which target fields
// it can populate and the extractor expression for each. Unset fields stay
// undefined and runIngestor handles the rest.

// WP REST attaches taxonomy fields to a post as arrays of term IDs
// (e.g. `current_stage: [665, 667]`). Resolving those IDs to labels needs a
// one-time fetch against the taxonomy endpoint. Declare the taxonomies a
// post type uses here; the runner builds an id→label map per taxonomy and
// applies it during extraction whenever a field's path matches a
// registered taxonomy name. `labelField` picks between the term's `name`
// (human-readable, e.g. "Series A") and `slug` (URL-safe, e.g. "series-a").
export interface WpTaxonomyConfig {
  endpoint: string;            // path under base, e.g. "current_stage"
  labelField?: "name" | "slug"; // default "name"
}

export type ManifestFetch =
  | {
      type: "wp-rest";
      base: string;
      postType: string;
      perPage?: number;
      delayMs?: number;
      fields?: string;
      taxonomies?: Record<string, WpTaxonomyConfig>;
    }
  | { type: "html"; url: string };

// For wp-rest, extractors are dot-paths into the WP record:
//   "title.rendered"        → record.title.rendered
//   "meta.website_url"      → record.meta.website_url
// A list-form extractor tries each path in order; first non-empty wins.
// The richer object form supports rejecting self-host URLs — Pear's `link`
// field, for instance, occasionally points back at a pear.vc announcement
// post, and we want to fall through to meta.website_url in that case.
//
// For html, extractors are { selector, attr? }:
//   { selector: "img",  attr: "alt" }     → text of alt attribute
//   { selector: ".tag", attr: "text" }    → element textContent (default)
//   { selector: "a",    attr: "href" }    → href attribute
export type HtmlFieldExtractor = { selector: string; attr?: string };
export type WpRestFieldExtractor =
  | string
  | string[]
  | { paths: string[]; rejectHosts?: string[] };

// Filters applied after extraction. Field references are extractor expressions
// of the same shape used in `extract`, so the manifest stays consistent.
export interface WpRestSkipRule {
  // Skip if the value at `path` (lower-cased) is in `values`.
  // Common usage: skip exited companies via company_group taxonomy.
  path: string;
  values: string[];
}

export interface HtmlSkipRule {
  // Skip if the selector matches and its text contains any of `contains`.
  selector: string;
  contains?: string[];
}

export interface ManifestBase {
  source: string;         // canonical source slug stored on Company.source
  name: string;           // human-readable label for log namespace
  investors: string[];    // values pushed into the investor tag namespace
  isVerified?: boolean;   // defaults to true
  signals?: string[];     // defaults to ["vc-backed"]
}

export interface WpRestManifest extends ManifestBase {
  fetch: Extract<ManifestFetch, { type: "wp-rest" }>;
  extract: {
    name: WpRestFieldExtractor;
    website: WpRestFieldExtractor;
    stage?: WpRestFieldExtractor;
    industry?: WpRestFieldExtractor;
    description?: WpRestFieldExtractor;
    oneLiner?: WpRestFieldExtractor;
    location?: WpRestFieldExtractor;
    sourceId?: WpRestFieldExtractor;
    // Multi-value field for non-primary tags. When taxonomy resolution
    // applies, all resolved labels are returned (not just the first).
    topics?: WpRestFieldExtractor;
  };
  // Skip rules accept both raw values and resolved-taxonomy labels.
  // A taxonomy-typed field's value is checked both as the raw IDs and as
  // each resolved label, so a rule like
  // `{ path: "current_stage", values: ["acquired", "ipo"] }` works even
  // though current_stage stores IDs.
  skip?: WpRestSkipRule[];
}

export interface HtmlManifest extends ManifestBase {
  fetch: Extract<ManifestFetch, { type: "html" }>;
  list: { itemSelector: string };
  extract: {
    name: HtmlFieldExtractor;
    website: HtmlFieldExtractor;
    stage?: HtmlFieldExtractor;
    industry?: HtmlFieldExtractor;
    description?: HtmlFieldExtractor;
    oneLiner?: HtmlFieldExtractor;
    location?: HtmlFieldExtractor;
  };
  skip?: HtmlSkipRule[];
}

export type Manifest = WpRestManifest | HtmlManifest;
