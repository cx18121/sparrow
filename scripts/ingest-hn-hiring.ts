import "dotenv/config";
import axios from "axios";
import * as cheerio from "cheerio";
import { pathToFileURL } from "node:url";
import { upsertCompany } from "./_lib/upsert.js";
import { prisma } from "./_lib/prisma.js";
import { buildTags, isFreeHostingDomain } from "./_lib/tags.js";
import { computeQualityScore } from "./_lib/quality-score.js";

// Hacker News "Ask HN: Who is hiring?" — monthly thread scraped via the
// public Firebase REST API. Each top-level comment is a job posting.
// Companies posting here are by definition active and hiring.

const HN_API = "https://hacker-news.firebaseio.com/v0";
const SKIP_DOMAINS = ["ycombinator.com", "linkedin.com", "twitter.com", "x.com", "github.com", "angel.co"];

interface HNItem {
  id: number;
  type: string;
  title?: string;
  text?: string;
  kids?: number[];
  dead?: boolean;
  deleted?: boolean;
}

function extractDomain(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

async function fetchItem(id: number): Promise<HNItem | null> {
  try {
    const { data } = await axios.get(`${HN_API}/item/${id}.json`, { timeout: 10_000 });
    return data ?? null;
  } catch {
    return null;
  }
}

interface ParsedPosting {
  name: string;
  website: string | null;
  oneLiner: string | null;
  location: string | null;
}

function parsePosting(htmlText: string): ParsedPosting | null {
  const $ = cheerio.load(`<div>${htmlText}</div>`);
  const root = $("div").first();

  // Extract header text: everything before the first <p> tag
  let header = "";
  root.contents().each((_, node) => {
    if (node.type === "tag" && (node as cheerio.TagElement).name === "p") return false as any;
    if (node.type === "text") header += (node as cheerio.TextElement).data ?? "";
    if (node.type === "tag") header += $(node).text();
  });
  header = header.trim();

  if (!header || header.length < 3) return null;

  // De-facto format: "Company | Location | Role | ... | https://..."
  const segments = header.split("|").map(s => s.trim()).filter(Boolean);
  if (!segments.length) return null;

  const name = segments[0];
  if (!name || name.length < 2 || name.length > 100) return null;

  // Website: prefer hrefs from <a> tags (skip job boards and social links)
  let website: string | null = null;
  $("a[href]").each((_, el) => {
    if (website) return;
    const href = $(el).attr("href") ?? "";
    if (href.startsWith("http") && !SKIP_DOMAINS.some(d => href.includes(d))) {
      website = href;
    }
  });
  // Fall back to URL-shaped pipe segments
  if (!website) {
    for (const seg of segments.slice(1)) {
      if (seg.startsWith("http")) { website = seg; break; }
    }
  }

  // Location: first non-URL non-role pipe segment after company name
  const roleKeywords = /^(full.?time|part.?time|contract|internship|remote|onsite|hybrid|senior|junior|staff|principal)$/i;
  const location = segments.slice(1).find(s =>
    !s.startsWith("http") && s.length >= 2 && s.length <= 60 && !roleKeywords.test(s)
  ) ?? null;

  // One-liner: first paragraph of the body
  const oneLiner = $("p").first().text().trim().slice(0, 200) || null;

  return { name, website, oneLiner, location };
}

async function findHiringThreads(maxThreads: number): Promise<HNItem[]> {
  let userResp;
  try {
    userResp = await axios.get(`${HN_API}/user/whoishiring.json`, { timeout: 10_000 });
  } catch (err: any) {
    console.error(`[HN] Failed to fetch whoishiring user: ${err.message}`);
    return [];
  }

  const submittedIds: number[] = userResp.data?.submitted ?? [];
  const threads: HNItem[] = [];

  for (const id of submittedIds.slice(0, 30)) {
    if (threads.length >= maxThreads) break;
    const item = await fetchItem(id);
    await new Promise(r => setTimeout(r, 100));
    if (item?.title?.toLowerCase().includes("who is hiring")) {
      threads.push(item);
    }
  }
  return threads;
}

export async function ingestHNHiring(maxThreads = 1): Promise<void> {
  const threads = await findHiringThreads(maxThreads);
  if (!threads.length) {
    console.error("[HN] Could not find Who is Hiring thread");
    return;
  }

  let ingested = 0, skipped = 0;

  for (const thread of threads) {
    const kids = thread.kids ?? [];
    console.log(`[HN] "${thread.title}" — ${kids.length} comments`);
    let processed = 0;

    for (const kidId of kids) {
      const comment = await fetchItem(kidId);
      await new Promise(r => setTimeout(r, 120));
      processed++;
      if (processed % 50 === 0) console.log(`[HN] ${processed}/${kids.length} processed — ${ingested} ingested so far`);

  let ingested = 0;
  let skipped = 0;
  let processed = 0;

  for (const kidId of kids) {
    const comment = await fetchItem(kidId);
    await new Promise(r => setTimeout(r, 120)); // ~8 req/s — polite rate
    processed++;
    if (processed % 50 === 0) {
      console.log(`[HN] ${processed}/${kids.length} processed — ${ingested} ingested so far`);
    }

    if (!comment || comment.dead || comment.deleted || !comment.text) {
      skipped++;
      continue;
    }

    const parsed = parsePosting(comment.text);
    if (!parsed?.website) { skipped++; continue; }

    const domain = extractDomain(parsed.website);
    if (!domain || isFreeHostingDomain(domain)) { skipped++; continue; }

    const tags = buildTags({ signals: ["hn-hiring"] });
    const qualityScore = computeQualityScore({ isHiring: true });

    try {
      await upsertCompany({
        domain,
        name: parsed.name,
        oneLiner: parsed.oneLiner,
        website: parsed.website,
        location: parsed.location,
        isHiring: true,
        source: "hn_hiring",
        sourceId: String(comment.id),
        tags,
        isVerified: false,
        qualityScore,
      });
      ingested++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[HN] Failed "${parsed.name}": ${msg}`);
    }
    }
  }

  console.log(`[HN Hiring] Ingested ${ingested}, skipped ${skipped}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const arg = process.argv.find(a => a.startsWith("--months="));
  const months = arg ? parseInt(arg.slice("--months=".length), 10) : 1;
  ingestHNHiring(months).finally(() => prisma.$disconnect()).catch(console.error);
}
