// =============================================================================
// Canonical tag taxonomy — namespaced by category
// =============================================================================
// Tags are stored as "namespace:value" strings on Company.tags. Frontend filter
// UIs split on ":" to render grouped chips per category. The API ANDs across
// categories and ORs within (e.g. ?tags=vertical:fintech,vertical:health,tech:ai
// means (fintech OR health) AND ai).
//
// Categories:
//   model      — how the company sells (saas, b2b, consumer, marketplace)
//   vertical   — industry served (fintech, health, education, …)
//   tech       — technology category (ai, crypto, devtools, …)
//   function   — business function served (sales, marketing, hr, …)
//   media      — media type (video, audio, podcast, …)
//   social     — social/community
//   size       — team-size bucket (solo-founder, small-team, …, mega-team)
//   signal     — ingestor signals (yc-backed, ph-launched, multi-source, …)
//
// NOT encoded as tags (use dedicated columns):
//   source     — Company.source
//   region     — Company.region
//   stage      — Company.stage
//   batch      — Company.batch
//   isHiring   — Company.isHiring
// =============================================================================

const FREE_HOSTING_DOMAINS = new Set([
  "vercel.app", "netlify.app", "github.io", "lovable.app", "lovable.dev",
  "replit.app", "replit.dev", "notion.site", "carrd.co", "framer.website",
  "webflow.io", "wixsite.com", "weebly.com", "squarespace.com", "godaddysites.com",
  "myshopify.com", "shopifyapps.com", "bubbleapps.io", "glideapp.io",
  "ngrok.io", "ngrok.app", "herokuapp.com", "render.com", "fly.dev",
  "pages.dev", "workers.dev", "deno.dev", "surge.sh", "now.sh",
  "google.com", "appspot.com", "firebaseapp.com", "web.app",
]);

// ─── Canonical category dictionaries ─────────────────────────────────────────

const MODEL_DEFINITIONS: Record<string, string[]> = {
  saas: ["saas", "software as a service", "software", "b2b / saas", "b2b/saas", "cloud / saas"],
  b2b: ["b2b", "business", "enterprise", "enterprise software", "vertical software"],
  consumer: [
    "b2c", "consumer", "consumer apps", "consumer software",
    "consumer goods", "consumergoods", "consumer internet media",
  ],
  marketplace: ["marketplace", "marketplaces", "commerce", "marketplace & commerce"],
};

const VERTICAL_DEFINITIONS: Record<string, string[]> = {
  fintech: [
    "fintech", "finance", "finance and accounting", "banking",
    "banking and exchanges", "payments", "lending", "lending and credit",
    "insurance", "asset management", "personal finance", "investing",
    "trading", "wealth management", "accounting", "insurance tech",
  ],
  health: [
    "health", "healthcare", "health and fitness", "health-and-fitness",
    "fitness", "wellness", "mental health", "meditation", "sleep",
    "healthcare it", "health and wellness",
  ],
  biotech: [
    "biotech", "biotechnology", "pharmaceuticals", "pharma",
    "therapeutics and drug discovery", "healthcare and diagnostics",
    "diagnostics", "life sciences", "biotechnology health", "science",
  ],
  education: [
    "education", "edtech", "ed tech", "learning", "online learning",
    "courses", "course creation", "tutoring", "students", "teachers",
    "languages",
  ],
  legal: ["legal", "legaltech", "legal tech", "law", "compliance"],
  realestate: [
    "real estate", "real estate and construction", "realestate",
    "construction", "property", "proptech", "real estate technology",
  ],
  govtech: ["government", "govtech", "civic tech", "public sector"],
  agriculture: ["agriculture", "agritech", "ag tech", "farming"],
  climate: [
    "climate", "climate tech", "sustainability", "carbon",
    "cleantech", "clean tech", "greentech",
  ],
  energy: ["energy", "renewable energy", "solar", "battery", "batteries"],
  industrial: [
    "industrials", "industrial", "manufacturing",
    "manufacturing and robotics",
  ],
  logistics: [
    "logistics", "supply chain", "supply chain and logistics",
    "shipping", "freight",
  ],
  ecommerce: ["ecommerce", "e-commerce", "shopping", "retail"],
  gaming: [
    "gaming", "games", "video games", "esports", "tabletop games",
    "media, entertainment and gaming",
  ],
  sports: ["sports", "outdoor"],
  travel: [
    "travel", "hospitality", "maps", "navigation",
    "travel, leisure and tourism", "tourism",
  ],
  food: [
    "food", "food and drink", "food and beverage", "recipes",
    "restaurants", "cooking", "beverages",
  ],
  fashion: ["fashion", "apparel"],
  beauty: ["beauty", "cosmetics", "skincare"],
  pets: ["pets", "pet care"],
  parenting: ["parenting", "babies", "children", "kids"],
  dating: ["dating", "relationships"],
  automotive: [
    "automotive", "cars", "transportation", "mobility",
    "drones", "aerospace", "aerospace transportation", "defense",
    "aerospace and defense", "maritime",
  ],
};

const TECH_DEFINITIONS: Record<string, string[]> = {
  ai: [
    "ai", "a.i.", "artificial intelligence", "artificial-intelligence",
    "machine learning", "ml", "llm", "llms", "gpt", "deep learning",
    "generative ai", "neural networks", "computer vision", "nlp",
    "natural language processing", "chatbots", "ai assistants", "ai & ml",
    "advanced machines intelligence", "deep tech", "frontier tech",
    "intelligent apps",
  ],
  crypto: [
    "crypto", "cryptocurrency", "blockchain", "web3", "defi",
    "nft", "nfts", "bitcoin", "ethereum",
  ],
  devtools: [
    "developer tools", "developer-tools", "dev tools", "ides", "ide",
    "code editors", "programming", "developer experience",
    "frameworks", "libraries", "sdks", "engineering, product and design",
    "documentation", "code", "developer",
  ],
  devops: ["devops", "ci/cd", "deployment", "monitoring", "observability"],
  infrastructure: [
    "infrastructure", "cloud", "cloud computing", "hosting", "servers",
    "database", "databases", "storage", "cdn", "networking", "it",
    "itsoftware",
  ],
  security: [
    "security", "cybersecurity", "privacy", "encryption", "auth",
    "authentication", "authorization", "identity", "vpn",
    "cryptography", "network security",
  ],
  data: [
    "data", "data science", "data engineering", "big data",
    "data analytics", "data infrastructure", "etl",
  ],
  analytics: ["analytics", "analytics software", "business intelligence", "bi"],
  nocode: ["no-code", "no code", "low-code", "low code", "nocode"],
  api: ["api", "apis", "api tools", "integrations", "webhooks", "plugins"],
  web: ["web", "web app", "web apps", "websites", "web development"],
  mobile: [
    "mobile", "mobile app", "mobile apps", "ios", "android",
    "ios apps", "android apps",
  ],
  opensource: ["open source", "open-source", "opensource", "github"],
  automation: ["automation", "workflow automation", "rpa"],
  iot: ["iot", "internet of things", "smart home", "smart devices"],
  xr: ["ar", "vr", "ar/vr", "augmented reality", "virtual reality", "xr"],
  hardware: ["hardware", "hardtech"],
  robotics: ["robotics"],
};

const FUNCTION_DEFINITIONS: Record<string, string[]> = {
  marketing: [
    "marketing", "sales and marketing", "seo", "content marketing",
    "marketing automation", "email marketing", "growth marketing",
  ],
  adtech: ["advertising", "ads", "ad tech", "adtech"],
  sales: ["sales", "crm", "customer relationship management", "gtm", "go-to-market"],
  hr: [
    "hr", "human resources", "recruiting", "hiring", "jobs",
    "career", "careers", "talent", "hr tech",
  ],
  "customer-support": [
    "customer service", "customer support", "help desk", "helpdesk",
    "live chat", "customer communication",
  ],
  productivity: [
    "productivity", "notes", "note-taking", "task management",
    "project management", "time tracking", "calendar", "calendars",
    "scheduling", "meetings", "video conferencing", "collaboration",
    "wikis", "knowledge bases", "knowledge management",
    "documents", "spreadsheets", "office management", "operations",
  ],
  design: [
    "design", "design tools", "design-tools", "graphic design",
    "ui design", "ux design",
  ],
  content: [
    "content", "blogging", "newsletters", "writing", "writing tools",
    "books", "reading",
  ],
  communication: ["communication", "chat", "messaging", "email", "sms", "service", "services"],
  search: ["search", "search engines"],
};

const MEDIA_DEFINITIONS: Record<string, string[]> = {
  video: ["video", "photo & video", "streaming", "entertainment", "media"],
  audio: ["audio"],
  music: ["music"],
  podcast: ["podcast", "podcasts", "podcasting"],
  photo: ["photo", "photography", "photos"],
};

const SOCIAL_DEFINITIONS: Record<string, string[]> = {
  social: ["social", "social media", "social-media"],
  community: ["community", "communities", "forums"],
};

// ─── Lookup map: alias → "namespace:canonical" ───────────────────────────────

const TOPIC_TO_NS_TAG: Record<string, string> = (() => {
  const out: Record<string, string> = {};
  const namespaces: Array<[string, Record<string, string[]>]> = [
    ["model", MODEL_DEFINITIONS],
    ["vertical", VERTICAL_DEFINITIONS],
    ["tech", TECH_DEFINITIONS],
    ["function", FUNCTION_DEFINITIONS],
    ["media", MEDIA_DEFINITIONS],
    ["social", SOCIAL_DEFINITIONS],
  ];
  for (const [ns, defs] of namespaces) {
    for (const [tag, aliases] of Object.entries(defs)) {
      for (const alias of aliases) {
        out[alias.toLowerCase().trim()] = `${ns}:${tag}`;
      }
    }
  }
  return out;
})();

function normalizeTopicName(name: string): string {
  return name
    .toLowerCase()
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function splitCompoundTopic(name: string): string[] {
  return normalizeTopicName(name)
    .split(/\s*(?:,|&|\/|\+)\s*/g)
    .map(part => part.trim())
    .filter(Boolean);
}

// ─── Public API ──────────────────────────────────────────────────────────────

const STAGE_TAG_MAP: Record<string, string> = {
  "pre-seed": "stage:pre-seed", "preseed": "stage:pre-seed",
  "seed": "stage:seed",
  "series a": "stage:series-a",
  "series b": "stage:series-b",
  "series c": "stage:series-c-plus", "series c+": "stage:series-c-plus",
  "series d": "stage:series-c-plus", "series e": "stage:series-c-plus",
  "growth": "stage:growth", "late": "stage:growth", "late stage": "stage:growth",
};

const STAGE_TAGS = ["pre-seed", "seed", "series-a", "series-b", "series-c-plus", "growth"] as const;
const INVESTOR_TAGS = ["accel", "kleinerperkins", "firstround", "initialized", "a16z", "gv", "bessemer", "greylock", "foundersfund"] as const;
const SIZE_TAGS = ["solo-founder", "small-team", "mid-team", "big-team", "mega-team"] as const;
const SIGNAL_TAGS = ["multi-source", "yc-backed", "ph-launched", "curated", "hn-hiring", "vc-backed", "unicorn"] as const;

// All canonical tags grouped by namespace — for rendering filter UIs.
export const CANONICAL_TAG_GROUPS = {
  model: Object.keys(MODEL_DEFINITIONS),
  vertical: Object.keys(VERTICAL_DEFINITIONS),
  tech: Object.keys(TECH_DEFINITIONS),
  function: Object.keys(FUNCTION_DEFINITIONS),
  media: Object.keys(MEDIA_DEFINITIONS),
  social: Object.keys(SOCIAL_DEFINITIONS),
  stage: [...STAGE_TAGS],
  investor: [...INVESTOR_TAGS],
  size: [...SIZE_TAGS],
  signal: [...SIGNAL_TAGS],
} as const;

export const TAG_NAMESPACES = Object.keys(CANONICAL_TAG_GROUPS) as Array<
  keyof typeof CANONICAL_TAG_GROUPS
>;

// Returns a namespaced canonical tag (e.g. "vertical:fintech") or null if
// the topic doesn't match any alias. Add aliases to the relevant DEFINITIONS
// dict above when sources produce topics that should normalize.
export function tagFromTopic(name: string): string | null {
  const key = normalizeTopicName(name);
  return TOPIC_TO_NS_TAG[key] ?? null;
}

export function tagsFromTopics(names: string[]): string[] {
  const out = new Set<string>();
  for (const n of names) {
    const t = tagFromTopic(n);
    if (t) {
      out.add(t);
      continue;
    }
    for (const part of splitCompoundTopic(n)) {
      const partTag = tagFromTopic(part);
      if (partTag) out.add(partTag);
    }
  }
  return [...out];
}

// Team-size bucket as a "size:..." tag.
export function tagFromHeadcount(headcount: number | null | undefined): string | null {
  if (headcount == null) return null;
  let bucket: string;
  if (headcount <= 2) bucket = "solo-founder";
  else if (headcount <= 10) bucket = "small-team";
  else if (headcount <= 50) bucket = "mid-team";
  else if (headcount <= 200) bucket = "big-team";
  else bucket = "mega-team";
  return `size:${bucket}`;
}

export function isFreeHostingDomain(domain: string): boolean {
  const d = domain.toLowerCase().replace(/^www\./, "");
  for (const suffix of FREE_HOSTING_DOMAINS) {
    if (d === suffix || d.endsWith(`.${suffix}`)) return true;
  }
  return false;
}

export interface BuildTagsInput {
  topics?: string[];          // category labels — normalized via tagFromTopic
  industry?: string | null;   // primary industry — also normalized
  stage?: string | null;      // funding stage — produces stage:* tag
  investors?: string[];       // VC firm names — auto-prefixed as "investor:..."
  headcount?: number | null;  // produces size:* tag
  signals?: string[];         // ingestor signals — auto-prefixed as "signal:..."
}

// Compose tags for a Company. Pulls canonical tags from topics/industry,
// adds the size bucket, and tags any caller-provided signals.
export function buildTags(input: BuildTagsInput): string[] {
  const tags = new Set<string>();

  if (input.topics) for (const t of tagsFromTopics(input.topics)) tags.add(t);
  if (input.industry) {
    const t = tagFromTopic(input.industry);
    if (t) tags.add(t);
  }

  if (input.stage) {
    const stageTag = STAGE_TAG_MAP[input.stage.toLowerCase().trim()];
    if (stageTag) tags.add(stageTag);
  }

  if (input.investors) {
    for (const v of input.investors) {
      if (!v || v.length < 2 || v.length > 60) continue;
      tags.add(`investor:${v}`);
    }
  }

  const sizeTag = tagFromHeadcount(input.headcount ?? null);
  if (sizeTag) tags.add(sizeTag);

  if (input.signals) {
    for (const s of input.signals) {
      if (!s || s.length < 2 || s.length > 60) continue;
      const tag = s.startsWith("signal:") ? s : `signal:${s}`;
      tags.add(tag);
    }
  }

  return [...tags];
}

// Merge two tag arrays, dedupe, drop empty.
export function mergeTags(a: string[] | null | undefined, b: string[] | null | undefined): string[] {
  const set = new Set<string>();
  for (const t of a ?? []) if (t?.trim()) set.add(t.trim());
  for (const t of b ?? []) if (t?.trim()) set.add(t.trim());
  return [...set];
}

// Group a flat tag list by namespace prefix. Tags without a namespace go
// under the "_" key. Useful for the API tag filter parser.
export function groupTagsByNamespace(tags: string[]): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const t of tags) {
    const idx = t.indexOf(":");
    const ns = idx > 0 ? t.slice(0, idx) : "_";
    (out[ns] ??= []).push(t);
  }
  return out;
}
