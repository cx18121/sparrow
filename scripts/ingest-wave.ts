import "dotenv/config";
import axios from "axios";
import * as cheerio from "cheerio";
import { pathToFileURL } from "node:url";
import { prisma } from "./_lib/prisma.js";
import { runIngestor, type CompanyRecord, type IngestorAdapter } from "./_lib/ingestor.js";

// Wave Ventures (Helsinki) — Squarespace static page. Each portfolio
// company is an .sqs-block-image whose <a> wraps the company logo and
// links directly to the company's own website; the <img>'s alt text is
// the company name. No stage / sector data on the page.

const BASE_URL = "https://www.wave.ventures/founders";

const waveAdapter: IngestorAdapter = {
  name: "Wave",
  source: "wave",
  async fetchAndParse(): Promise<CompanyRecord[]> {
    const { data: html } = await axios.get<string>(BASE_URL, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; SparrowBot/1.0)" },
      timeout: 30_000,
      maxRedirects: 5,
    });
    const $ = cheerio.load(html);

    const out: CompanyRecord[] = [];
    $(".sqs-block-image").each((_, el) => {
      const $el = $(el);
      const name = $el.find("img").first().attr("alt")?.trim();
      const website = $el.find("a").first().attr("href")?.trim();
      if (!name || !website) return;
      out.push({
        name,
        website,
        investors: ["wave"],
        signals: ["vc-backed"],
        isVerified: true,
      });
    });
    console.log(`[Wave] ${out.length} companies extracted`);
    return out;
  },
};

export async function ingestWave(): Promise<void> {
  await runIngestor(waveAdapter);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  ingestWave().finally(() => prisma.$disconnect()).catch(console.error);
}
