import "dotenv/config";
import axios from "axios";
import * as cheerio from "cheerio";
import { pathToFileURL } from "node:url";
import { prisma } from "./_lib/prisma.js";
import { runIngestor, type CompanyRecord, type IngestorAdapter } from "./_lib/ingestor.js";

// Bessemer Venture Partners — companies embedded in SSR HTML.
// Each card has data-name, a Visit Website link, description, and sector.

const BASE_URL = "https://www.bvp.com/portfolio";

const bessemerAdapter: IngestorAdapter = {
  name: "Bessemer",
  source: "bessemer",
  async fetchAndParse(): Promise<CompanyRecord[]> {
    const { data: html } = await axios.get(BASE_URL, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; ColdFlowBot/1.0)" },
      timeout: 30_000,
    });

    const $ = cheerio.load(html as string);
    const seenNames = new Set<string>();
    const out: CompanyRecord[] = [];

    $("[data-name]").each((_, el) => {
      const name = $(el).attr("data-name")?.trim();
      if (!name || seenNames.has(name)) return;
      seenNames.add(name);

      let websiteHref: string | null = null;
      $(el)
        .find("a[href]")
        .each((_, a) => {
          if (websiteHref) return;
          const href = $(a).attr("href") ?? "";
          if (href.startsWith("http") && !href.includes("bvp.com")) websiteHref = href;
        });
      if (!websiteHref) return;

      const description = $(el).find("p").first().text().trim() || null;
      const sector = $(el).find("[class*='roadmap']").first().text().trim() || null;

      out.push({
        name,
        website: websiteHref,
        description,
        industry: sector,
        topics: sector ? [sector] : undefined,
        investors: ["bessemer"],
        signals: ["vc-backed"],
        isVerified: true,
      });
    });

    return out;
  },
};

export async function ingestBessemer(): Promise<void> {
  await runIngestor(bessemerAdapter);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  ingestBessemer().finally(() => prisma.$disconnect()).catch(console.error);
}
