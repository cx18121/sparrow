import "dotenv/config";
import axios from "axios";
import * as cheerio from "cheerio";

async function probe(slug: string) {
  const { data: html } = await axios.get<string>(`https://lsvp.com/company/${slug}/`, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; SparrowBot/1.0)" },
    timeout: 30_000,
  });
  const $ = cheerio.load(html);
  console.log(`\n=== ${slug} ===`);

  // Outbound links that aren't lsvp / social
  const seen = new Set<string>();
  $("a[href]").each((_, el) => {
    const href = $(el).attr("href") ?? "";
    if (!href.startsWith("http")) return;
    try {
      const u = new URL(href);
      if (u.hostname.endsWith("lsvp.com") || /twitter|x\.com|linkedin|facebook|instagram|youtube|crunchbase/i.test(u.hostname)) return;
      if (seen.has(u.hostname)) return;
      seen.add(u.hostname);
      const text = $(el).text().trim().slice(0, 50);
      const cls = $(el).attr("class") ?? "(no class)";
      console.log(`  href=${href}`);
      console.log(`    text="${text}" class="${cls}"`);
    } catch {}
  });

  // Common patterns: a "Visit website" button or .website link
  const candidates = $("a.button, a.btn, a.visit-site, a[target='_blank']");
  console.log(`  ${candidates.length} <a> with .button/.btn/.visit-site/target=_blank`);
}

(async () => {
  for (const slug of ["anthropic", "wiz", "rubrik", "1password"]) {
    await probe(slug);
  }
})().catch(err => { console.error(err); process.exit(1); });
