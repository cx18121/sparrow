import "dotenv/config";
import { pathToFileURL } from "node:url";
import { chromium, type Page } from "playwright";
import { prisma } from "./_lib/prisma.js";
import { runIngestor, type CompanyRecord, type IngestorAdapter } from "./_lib/ingestor.js";

// Atomico portfolio at https://www.atomico.com/partners.
//
// Atomico is a Next.js SSG app behind aggressive bot protection (429 on
// plain curl). Their /partners route lists 127 "partners" (Atomico's name
// for portfolio companies), with rich detail-page metadata exposed via
// Next.js's /_next/data/<build-id>/ JSON endpoints.
//
// Strategy:
//   1. Open a real Playwright browser session against atomico.com so cookies
//      / edge clearance are accepted.
//   2. Use page.evaluate(fetch(...)) to retrieve /partners.json?page=N — this
//      reuses the session and bypasses the rate limit that hits curl. The
//      pageSize is 40 but the endpoint returns cumulative results, so
//      page=4 yields all 127 in one call.
//   3. For each partner slug, fetch /partners/<slug>.json — extract
//      sidebar.socials.website.url, sidebar.items (stage, status, year,
//      location, areas-of-interest).
//   4. Filter status != "Current" (exits drop out).
//   5. Upsert.
//
// The build-id (LHl8PzlwdfJfuBfu18PmZ at probe time) is part of every URL.
// Atomico cycles it on each redeploy. The bootstrap step (step 1) reads
// __NEXT_DATA__ from the landing-page HTML to find the live build-id, so
// the adapter is self-updating.
//
// Cost: free. ~1 minute total for 127 detail fetches at concurrency 8.

const BASE = "https://www.atomico.com";
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

interface CliArgs {
  limit: number | null;
  concurrency: number;
}

function parseArgs(): CliArgs {
  const argv = process.argv.slice(2);
  let limit: number | null = null;
  let concurrency = 8;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--limit") limit = parseInt(argv[++i], 10);
    else if (a === "--concurrency") concurrency = parseInt(argv[++i], 10);
  }
  return { limit, concurrency };
}

async function discoverBuildId(page: Page): Promise<string> {
  await page.goto(`${BASE}/partners`, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForTimeout(2_000);
  // __NEXT_DATA__ JSON is rendered into a <script id="__NEXT_DATA__"> tag.
  const buildId = await page.evaluate(() => {
    const tag = document.getElementById("__NEXT_DATA__");
    if (!tag) return null;
    try {
      const obj = JSON.parse(tag.textContent ?? "{}");
      return obj.buildId ?? null;
    } catch {
      return null;
    }
  });
  if (!buildId) throw new Error("Failed to discover atomico Next.js buildId");
  return buildId;
}

interface PartnerCard {
  slug: string;
  name: string;
  status: string; // "current" | other slugs
}

async function fetchPartnerList(page: Page, buildId: string): Promise<PartnerCard[]> {
  const json = await page.evaluate(async (url) => {
    const r = await fetch(url, { credentials: "include" });
    return { status: r.status, text: await r.text() };
  }, `/_next/data/${buildId}/partners.json?page=4`);

  if (json.status !== 200) throw new Error(`partners.json status ${json.status}`);
  const data = JSON.parse(json.text);
  const fc = data?.pageProps?.filteredContent ?? {};
  const merged: PartnerCard[] = [];
  const seen = new Set<string>();
  const intake = (arr: Array<{ slug?: string; name?: string; status?: { slug?: string } }>) => {
    for (const c of arr ?? []) {
      const slug = c.slug;
      const name = c.name;
      const status = c.status?.slug ?? "";
      if (!slug || !name || seen.has(slug)) continue;
      seen.add(slug);
      merged.push({ slug, name, status });
    }
  };
  intake(fc.prioData ?? []);
  intake(fc.data ?? []);
  return merged;
}

interface DetailFields {
  website: string | null;
  stage: string | null;
  status: string | null;
  location: string | null;
  areaOfInterest: string | null;
  oneLiner: string | null;
}

async function fetchPartnerDetail(page: Page, buildId: string, slug: string): Promise<DetailFields> {
  const json = await page.evaluate(
    async ([url]) => {
      const r = await fetch(url, { credentials: "include" });
      return { status: r.status, text: await r.text() };
    },
    [`/_next/data/${buildId}/partners/${slug}.json?slug=${slug}`]
  );
  if (json.status !== 200) return empty();

  let data: any;
  try {
    data = JSON.parse(json.text);
  } catch {
    return empty();
  }
  const pp = data?.pageProps ?? {};
  const sidebar = pp.sidebar ?? {};
  const socials = sidebar.socials ?? {};
  const website = socials.website?.url ?? null;

  // Sidebar.items is an array of { title, type, content }. Pull stage,
  // status, location, areas-of-interest by title match.
  let stage: string | null = null;
  let status: string | null = null;
  let location: string | null = null;
  let area: string | null = null;
  for (const it of sidebar.items ?? []) {
    const title = String(it?.title ?? "").toLowerCase();
    const labelOf = (c: any): string | null => {
      if (!c) return null;
      if (typeof c === "string") return c;
      if (c.label) return c.label;
      if (Array.isArray(c)) return c.map((x) => x?.label).filter(Boolean).join(", ");
      return null;
    };
    const v = labelOf(it.content);
    if (!v) continue;
    if (title.includes("stage")) stage = v;
    else if (title.includes("status")) status = v;
    else if (title.includes("location")) location = v;
    else if (title.includes("areas") || title.includes("interest")) area = v;
  }

  // First text block in pageContent has a description.
  let oneLiner: string | null = null;
  for (const block of pp.pageContent ?? []) {
    if (block?.type === "Text") {
      // Block content is rich-text JSON — flatten into plain text.
      const collect = (node: any): string => {
        if (!node) return "";
        if (typeof node === "string") return node;
        if (typeof node.text === "string") return node.text;
        if (Array.isArray(node.children)) return node.children.map(collect).join(" ");
        if (Array.isArray(node)) return node.map(collect).join(" ");
        return "";
      };
      const text = collect(block.content).replace(/\s+/g, " ").trim();
      if (text) {
        oneLiner = text.length > 280 ? text.slice(0, 277) + "..." : text;
        break;
      }
    }
  }

  return { website, stage, status, location, areaOfInterest: area, oneLiner };
}

function empty(): DetailFields {
  return { website: null, stage: null, status: null, location: null, areaOfInterest: null, oneLiner: null };
}

function normalizeStage(s: string | null): string | null {
  if (!s) return null;
  // Atomico tags Venture / Growth — pass through; downstream
  // normalization is in `expandStageFilter`.
  return s.trim();
}

async function mapConcurrent<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: concurrency }, async () => {
    while (true) {
      const i = cursor++;
      if (i >= items.length) return;
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}

export const atomicoAdapter: IngestorAdapter = {
  name: "Atomico",
  source: "atomico",
  async fetchAndParse(): Promise<CompanyRecord[]> {
    const { limit, concurrency } = parseArgs();

    const browser = await chromium.launch({ headless: true });
    try {
      const ctx = await browser.newContext({ userAgent: UA, viewport: { width: 1440, height: 900 } });
      const page = await ctx.newPage();

      console.log(`[Atomico] bootstrap: discovering buildId`);
      const buildId = await discoverBuildId(page);
      console.log(`[Atomico] buildId = ${buildId}`);

      const partners = await fetchPartnerList(page, buildId);
      console.log(`[Atomico] partner list: ${partners.length}`);

      // Drop non-current statuses at the index level when present.
      const work = partners.filter((p) => !p.status || p.status === "current");
      console.log(`[Atomico] Current: ${work.length}, filtered: ${partners.length - work.length}`);

      const slice = limit ? work.slice(0, limit) : work;

      let progressDone = 0;
      const startedAt = Date.now();

      const details = await mapConcurrent(slice, concurrency, async (p) => {
        const d = await fetchPartnerDetail(page, buildId, p.slug);
        progressDone++;
        if (progressDone % 25 === 0 || progressDone === slice.length) {
          const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
          console.log(`[Atomico] details ${progressDone}/${slice.length} (${elapsed}s)`);
        }
        return d;
      });

      const out: CompanyRecord[] = [];
      let noWebsite = 0;
      let nonCurrent = 0;
      for (let i = 0; i < slice.length; i++) {
        const p = slice[i];
        const d = details[i];
        if (d.status && d.status.toLowerCase() !== "current") {
          nonCurrent++;
          continue;
        }
        if (!d.website) {
          noWebsite++;
          continue;
        }
        out.push({
          name: p.name,
          website: d.website,
          oneLiner: d.oneLiner,
          stage: normalizeStage(d.stage),
          industry: d.areaOfInterest,
          location: d.location,
          sourceId: p.slug,
          investors: ["atomico"],
          signals: ["vc-backed"],
          isVerified: true,
        });
      }
      console.log(`[Atomico] fetchAndParse DONE: ${out.length} kept — ${nonCurrent} non-current, ${noWebsite} no-website`);
      return out;
    } finally {
      await browser.close();
    }
  },
};

export async function ingestAtomico(): Promise<void> {
  await runIngestor(atomicoAdapter);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  ingestAtomico().finally(() => prisma.$disconnect()).catch(console.error);
}
