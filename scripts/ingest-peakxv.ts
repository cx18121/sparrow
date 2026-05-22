import "dotenv/config";
import axios from "axios";
import * as cheerio from "cheerio";
import { pathToFileURL } from "node:url";
import { prisma } from "./_lib/prisma.js";
import { runIngestor, type CompanyRecord, type IngestorAdapter } from "./_lib/ingestor.js";

// Peak XV (formerly Sequoia Capital India / SEA) portfolio at
// https://www.peakxv.com/companies. WordPress site exposing the full
// portfolio via /wp-json/wp/v2/company (305 entries as of probe), but the
// REST payload does NOT include the company's homepage URL — `acf: []`.
//
// Two-step fetch:
//   1. /wp-json/wp/v2/company?per_page=100&page=N
//      → list of {id, slug, title.rendered, link, class_list (tags)}
//   2. /companies/<slug>/ for each entry
//      → static HTML where the company's external homepage URL is the
//        only non-PeakXV external href (probe-confirmed on /dashverse/).
//
// Cost: 305 detail fetches at concurrency 8 ≈ 1-2 minutes wall time.
//
// Per-detail-page HTML: PeakXV pages are sparse — the external company URL
// is the first http href that isn't a PeakXV property, social network, or
// CDN asset. We use the same filtering pattern as USV/Greycroft.
//
// Tag normalization: class_list carries tag-ai, tag-fintech, etc. — extract
// each `tag-<slug>` as a topic so buildTags can route into vertical:* /
// industry: namespaces.

const LIST_URL = "https://www.peakxv.com/wp-json/wp/v2/company";
const DETAIL_BASE = "https://www.peakxv.com/companies/";

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const NON_COMPANY_HOST_PATTERNS = [
  /(?:^|\.)peakxv\.com$/i,
  /(?:^|\.)sequoiacap\.com$/i,
  /(?:^|\.)sequoiacapital\.com$/i,
  /(?:^|\.)twitter\.com$/i,
  /(?:^|\.)x\.com$/i,
  /(?:^|\.)linkedin\.com$/i,
  /(?:^|\.)facebook\.com$/i,
  /(?:^|\.)instagram\.com$/i,
  /(?:^|\.)youtube\.com$/i,
  /(?:^|\.)w3\.org$/i,
  /(?:^|\.)onetrust\.com$/i,
];

function isCompanyUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return !NON_COMPANY_HOST_PATTERNS.some((p) => p.test(host));
  } catch {
    return false;
  }
}

interface CompanyListEntry {
  id: number;
  slug: string;
  title: { rendered: string };
  class_list?: string[];
  yoast_head_json?: { description?: string };
}

const DETAIL_CONCURRENCY = 8;

async function fetchDetailWebsite(slug: string): Promise<string | null> {
  try {
    const { data: html } = await axios.get<string>(`${DETAIL_BASE}${slug}/`, {
      headers: { "User-Agent": UA },
      timeout: 20_000,
      maxRedirects: 5,
    });
    const $ = cheerio.load(html);
    // First external href that's not a PeakXV property / social / CDN.
    let found: string | null = null;
    $("a[href^='http']").each((_, a) => {
      if (found) return;
      const href = $(a).attr("href")?.trim();
      if (!href) return;
      try {
        const host = new URL(href).hostname.toLowerCase();
        // Skip explicit CDN/asset hosts and font providers.
        if (/cdn-|\.cdn\.|fonts\.|gstatic|gravatar|googletagmanager|googleads/.test(host)) return;
      } catch { return; }
      if (!isCompanyUrl(href)) return;
      found = href;
    });
    return found;
  } catch {
    return null;
  }
}

export const peakXvAdapter: IngestorAdapter = {
  name: "PeakXV",
  source: "peak-xv",
  async fetchAndParse(): Promise<CompanyRecord[]> {
    console.log(`[PeakXV] paginating ${LIST_URL}`);

    // Step 1 — paginate wp-json list endpoint.
    const entries: CompanyListEntry[] = [];
    let page = 1;
    const perPage = 100;
    while (true) {
      const { data, headers, status } = await axios.get<CompanyListEntry[]>(LIST_URL, {
        params: { per_page: perPage, page },
        headers: { "User-Agent": UA },
        timeout: 20_000,
        validateStatus: () => true,
      });
      if (status === 400 || status === 404 || !Array.isArray(data) || data.length === 0) break;
      entries.push(...data);
      const totalPages = parseInt(String(headers["x-wp-totalpages"] ?? "0"), 10);
      if (!totalPages || page >= totalPages) break;
      page++;
    }
    console.log(`[PeakXV] ${entries.length} entries from wp-json`);

    // Step 2 — fetch detail pages in parallel for the external website link.
    const out: CompanyRecord[] = [];
    const seen = new Set<string>();
    let cursor = 0;
    let noWebsite = 0;
    let noName = 0;
    let dupe = 0;
    let processed = 0;
    const startedAt = Date.now();

    const worker = async (): Promise<void> => {
      while (true) {
        const i = cursor++;
        if (i >= entries.length) return;
        const e = entries[i];
        const name = (e.title?.rendered ?? "").replace(/&amp;/g, "&").trim();
        if (!name) {
          noName++;
          continue;
        }
        const website = await fetchDetailWebsite(e.slug);
        processed++;
        if ((processed % 50) === 0) {
          const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
          console.log(`[PeakXV] detail ${processed}/${entries.length} (${elapsed}s)`);
        }
        if (!website) {
          noWebsite++;
          continue;
        }
        const key = website.replace(/\/+$/, "").toLowerCase();
        if (seen.has(key)) {
          dupe++;
          continue;
        }
        seen.add(key);

        // Topics from class_list tag-* entries.
        const topics: string[] = [];
        for (const c of e.class_list ?? []) {
          const m = c.match(/^tag-(.+)$/);
          if (m) topics.push(m[1].toLowerCase());
        }

        out.push({
          name,
          website,
          oneLiner: e.yoast_head_json?.description ?? null,
          topics,
          investors: ["peak-xv"],
          signals: ["vc-backed"],
          isVerified: true,
        });
      }
    };

    await Promise.all(
      Array.from({ length: DETAIL_CONCURRENCY }, () => worker())
    );

    console.log(
      `[PeakXV] fetchAndParse DONE: ${out.length} kept — ` +
        `${dupe} dupe, ${noName} no-name, ${noWebsite} no-website`
    );
    return out;
  },
};

export async function ingestPeakXv(): Promise<void> {
  await runIngestor(peakXvAdapter);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  ingestPeakXv().finally(() => prisma.$disconnect()).catch(console.error);
}
