// Smoke test for the Insight Partners REST extraction path used by
// ingest-insight.ts. Hits the WP list endpoint for one page and the custom
// content endpoint for a small mixed sample of slugs (some Current Investment,
// some known exits). Prints status + extracted website for each, without
// touching the DB. Run once before the full ingest, then again any time the
// REST shape might have drifted.
//
//   tsx scripts/_probe-insight-rest.ts

import "dotenv/config";
import axios from "axios";
import * as cheerio from "cheerio";

const LIST_URL = "https://www.insightpartners.com/wp-json/wp/v2/sfcompany";
const CONTENT_URL = "https://www.insightpartners.com/wp-json/insight/v1/get-company-content";
const SLUG_TO_ID_URL = "https://www.insightpartners.com/wp-json/insight/v1/get-company-id-by-slug";
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

function decodeWpJson<T = unknown>(raw: string): T {
  const first = JSON.parse(raw) as unknown;
  if (typeof first === "string") return JSON.parse(first) as T;
  return first as T;
}

async function resolveSlug(slug: string): Promise<number | null> {
  const { data: raw } = await axios.get<string>(SLUG_TO_ID_URL, {
    params: { slug },
    headers: { "User-Agent": UA },
    responseType: "text",
    transformResponse: [(d) => d],
    timeout: 15_000,
  });
  const decoded = decodeWpJson<{ id?: number | false }>(raw);
  const id = decoded.id;
  return typeof id === "number" ? id : null;
}

async function fetchDetail(id: number): Promise<{ status: string | null; website: string | null }> {
  const { data: raw } = await axios.get<string>(CONTENT_URL, {
    params: { id },
    headers: { "User-Agent": UA },
    responseType: "text",
    transformResponse: [(d) => d],
    timeout: 15_000,
  });
  const decoded = decodeWpJson<{ content?: string }>(raw);
  const html = decoded.content ?? "";
  const $ = cheerio.load(html);

  let status: string | null = null;
  $("span.font-semibold").each((_, el) => {
    if (status) return;
    if ($(el).text().trim() === "Status") {
      const sibling = $(el).nextAll("span").first().text().trim();
      if (sibling) status = sibling;
    }
  });

  let website: string | null = null;
  $("a").each((_, el) => {
    if (website) return;
    if ($(el).find("svg.svg-icon__new-window").length > 0) {
      const href = $(el).attr("href")?.trim();
      if (href && /^https?:\/\//i.test(href)) website = href;
    }
  });

  return { status, website };
}

async function main() {
  console.log("=== list page 1 ===");
  const { data: page1, headers } = await axios.get<unknown[]>(LIST_URL, {
    params: { per_page: 5, page: 1, _fields: "id,slug,title,link" },
    headers: { "User-Agent": UA },
    timeout: 30_000,
  });
  console.log(`x-wp-total: ${headers["x-wp-total"]}`);
  console.log(`x-wp-totalpages: ${headers["x-wp-totalpages"]}`);
  console.log(`page1 sample (${page1.length}):`);
  for (const it of page1 as any[]) {
    console.log(`  id=${it.id} slug=${it.slug} title=${it.title?.rendered}`);
  }

  console.log("\n=== mixed-status sample ===");
  // Mix: known active (bitrise, flutterwave, linx, writer) and known exits
  // (hellofresh — acquired/IPO, shopify — IPO).
  const samples = ["bitrise", "flutterwave", "linx", "writer", "hellofresh", "shopify"];
  for (const slug of samples) {
    const id = await resolveSlug(slug);
    if (id == null) {
      console.log(`  ${slug.padEnd(20)} — NOT IN PORTFOLIO`);
      continue;
    }
    const { status, website } = await fetchDetail(id);
    console.log(`  ${slug.padEnd(20)} id=${id} status=${(status ?? "<none>").padEnd(18)} website=${website ?? "<none>"}`);
    await new Promise((r) => setTimeout(r, 400));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
