import "dotenv/config";
import axios from "axios";
import * as cheerio from "cheerio";

// Probe a Sequoia company detail page for stage markup. The scraper already
// fetches each detail page (for exit detection), so extracting stage is
// essentially free if the markup is consistent across pages.
//
// Run: tsx scripts/_probe-sequoia-detail.ts [slug]
// Defaults to a sample of three slugs spanning stages.

const SAMPLE_SLUGS = process.argv[2]
  ? [process.argv[2]]
  : ["stripe", "klarna", "linear"]; // bigco, mid-stage, growth

const COMPANY_BASE = "https://www.sequoiacap.com/companies";

async function inspect(slug: string) {
  try {
    const { data: html } = await axios.get<string>(`${COMPANY_BASE}/${slug}/`, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; SparrowBot/1.0)" },
      timeout: 15_000,
      maxRedirects: 5,
    });
    const $ = cheerio.load(html);
    const company = $("section.company");
    if (!company.length) {
      console.log(`\n[${slug}] section.company missing`);
      return;
    }

    console.log(`\n=== ${slug} ===`);
    console.log(`name: ${company.find("h1 img[alt]").first().attr("alt")?.trim()}`);

    // The existing scraper uses li.clist__item for exit detection only.
    // Inspect every element in that list to see what stage-ish text is there.
    console.log("\n  clist items:");
    company.find("li.clist__item").each((_, el) => {
      console.log(`    ${$(el).text().trim().slice(0, 100)}`);
    });

    // Hunt for stage in dl / table / dt-dd structures, and any element
    // with "stage" or "series" text content.
    console.log("\n  dt/dd pairs:");
    company.find("dt").each((_, el) => {
      const label = $(el).text().trim();
      const val = $(el).next("dd").text().trim();
      console.log(`    ${label.padEnd(20)} ${val}`);
    });

    console.log("\n  any text containing 'series' or 'stage':");
    company.find("*").each((_, el) => {
      const text = $(el).clone().children().remove().end().text().trim();
      if (text && /\b(series\s+[a-z]|stage|seed|pre-seed)\b/i.test(text) && text.length < 100) {
        console.log(`    [${el.tagName}.${$(el).attr("class") ?? "—"}] ${text}`);
      }
    });
  } catch (err: any) {
    console.log(`\n[${slug}] error: ${err.message}`);
  }
}

(async () => {
  for (const slug of SAMPLE_SLUGS) {
    await inspect(slug);
  }
})().catch((err) => { console.error(err); process.exit(1); });
