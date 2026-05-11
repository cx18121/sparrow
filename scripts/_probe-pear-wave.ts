import "dotenv/config";
import axios from "axios";
import * as cheerio from "cheerio";

// Probe Pear VC and Wave Ventures portfolio pages to ground the manifest
// schema design. Outputs: candidate item selector, name/website/industry
// selectors, and whether a detail-page hop is needed.
//
// Run: tsx scripts/_probe-pear-wave.ts

interface ProbeTarget {
  label: string;
  url: string;
  // Candidate selectors to try first; falls through to a generic scan if
  // none match. The scan dumps the most-frequent class patterns so we can
  // pick the right one.
  candidateItemSelectors: string[];
}

const TARGETS: ProbeTarget[] = [
  {
    label: "Pear VC",
    url: "https://pear.vc/companies/",
    candidateItemSelectors: [".company", ".company-card", "[data-company]", "article.company", "li.company"],
  },
  {
    label: "Wave Ventures",
    url: "https://www.wave.ventures/founders",
    candidateItemSelectors: [".sqs-block-image", ".portfolio-item", "a.image-block-outer-wrapper", ".image-block"],
  },
];

function tallyClassPatterns(html: string, limit: number): Map<string, number> {
  const $ = cheerio.load(html);
  const tally = new Map<string, number>();
  $("[class]").each((_, el) => {
    const cls = ($(el).attr("class") ?? "").split(/\s+/).filter(Boolean);
    for (const c of cls) {
      tally.set(c, (tally.get(c) ?? 0) + 1);
    }
  });
  return tally;
}

async function probe(target: ProbeTarget) {
  console.log(`\n=========================================`);
  console.log(`${target.label} — ${target.url}`);
  console.log(`=========================================`);

  let html: string;
  try {
    const res = await axios.get<string>(target.url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; SparrowBot/1.0)" },
      timeout: 30_000,
      maxRedirects: 5,
    });
    html = res.data;
  } catch (err: any) {
    console.error(`Fetch failed: ${err.message}`);
    return;
  }

  console.log(`HTML length: ${html.length}`);

  const $ = cheerio.load(html);

  // 1. Try candidate item selectors.
  console.log(`\n— item-selector candidates:`);
  let bestSelector: string | null = null;
  let bestCount = 0;
  for (const sel of target.candidateItemSelectors) {
    const n = $(sel).length;
    console.log(`  ${sel.padEnd(40)} → ${n} matches`);
    if (n > bestCount && n > 5) { bestSelector = sel; bestCount = n; }
  }

  // 2. If none worked, fall back to tallying most-frequent class names.
  if (!bestSelector) {
    console.log(`\n— no candidate hit. Top 15 class names:`);
    const tally = tallyClassPatterns(html, 15);
    const top = [...tally.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15);
    for (const [c, n] of top) {
      console.log(`  ${c.padEnd(40)} ${n}`);
    }
  }

  // 3. If we have a selector, dump 2 sample items in full.
  if (bestSelector) {
    console.log(`\n— sample items (selector: ${bestSelector}):`);
    $(bestSelector).slice(0, 2).each((i, el) => {
      console.log(`\n  [item ${i}]`);
      const inner = $(el).html() ?? "";
      console.log("  " + inner.replace(/\s+/g, " ").trim().slice(0, 600));
    });
  }

  // 4. Look for outbound links (companies' own websites). If the list page
  // has them, no detail-page hop needed.
  console.log(`\n— outbound links (non-host, non-social, first 10):`);
  const host = new URL(target.url).hostname;
  const seen = new Set<string>();
  $("a[href]").each((_, el) => {
    if (seen.size >= 10) return;
    const href = $(el).attr("href") ?? "";
    if (!href.startsWith("http")) return;
    try {
      const u = new URL(href);
      if (u.hostname === host || u.hostname.endsWith(`.${host}`)) return;
      if (/twitter|x\.com|linkedin|facebook|instagram|youtube|crunchbase/i.test(u.hostname)) return;
      const key = u.hostname;
      if (seen.has(key)) return;
      seen.add(key);
      console.log(`  ${href}`);
    } catch {}
  });
}

(async () => {
  for (const t of TARGETS) await probe(t);
})().catch(err => { console.error(err); process.exit(1); });
