import "dotenv/config";
import axios from "axios";
import * as cheerio from "cheerio";
import { pathToFileURL } from "node:url";
import { prisma } from "./_lib/prisma.js";
import { runIngestor, type CompanyRecord, type IngestorAdapter } from "./_lib/ingestor.js";

// gregslist.com — city-by-city directory of local software/SaaS companies.
// Companies live on per-city startup pages, not the homepage.

const CITY_SLUGS = [
  "atlanta",
  "austin",
  "boston",
  "chicago",
  "dallas",
  "denver",
  "houston",
  "phoenix",
  "raleigh-durham",
  "salt-lake-city",
  "san-diego",
  "toronto",
];

const HEADERS = { "User-Agent": "Mozilla/5.0 (compatible; ColdFlowBot/1.0)" };

const gregslistAdapter: IngestorAdapter = {
  name: "Gregslist",
  source: "gregslist",
  async fetchAndParse(): Promise<CompanyRecord[]> {
    const out: CompanyRecord[] = [];
    const seen = new Set<string>();

    for (const city of CITY_SLUGS) {
      const url = `https://gregslist.com/${city}/software-companies-size/startup/`;
      let html: string;
      try {
        const { data } = await axios.get(url, { headers: HEADERS, timeout: 20_000 });
        html = data as string;
      } catch (e) {
        console.warn(`[Gregslist] Failed to fetch ${city}:`, (e as Error).message);
        continue;
      }

      const $ = cheerio.load(html);

      // Each company row has .company-details-column and .company-links-column siblings
      $(".company-details-column").each((_, el) => {
        // Name comes from the preceding sibling column — the internal /company/ anchor
        const nameEl = $(el).prevAll().find("a[href*='/company/']").first();
        const name = nameEl.text().trim();
        if (!name) return;

        // Description is the first .detail span (subsequent ones are people/meta)
        const description = $(el).find("span.detail").first().text().trim();

        // Website is the icon-globe anchor in the sibling .company-links-column
        const linksCol = $(el).nextAll(".company-links-column").first();
        const website = linksCol.find("a[title='View Website']").attr("href")?.trim() ?? "";

        if (!website || seen.has(website)) return;
        seen.add(website);

        out.push({
          name,
          website,
          oneLiner: description || null,
          location: city.replace(/-/g, " "),
          signals: ["curated"],
          isVerified: false,
        });
      });

      // Polite crawl delay between cities
      await new Promise((r) => setTimeout(r, 1_500));
    }

    return out;
  },
};

export async function ingestGregslist(): Promise<void> {
  await runIngestor(gregslistAdapter);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  ingestGregslist().finally(() => prisma.$disconnect()).catch(console.error);
}
