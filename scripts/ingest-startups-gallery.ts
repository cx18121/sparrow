import "dotenv/config";
import axios from "axios";
import * as cheerio from "cheerio";
import { pathToFileURL } from "node:url";
import { prisma } from "./_lib/prisma.js";
import { runIngestor, type CompanyRecord, type IngestorAdapter } from "./_lib/ingestor.js";

// startups.gallery — curated list of notable startups, scraped from static HTML.

const BASE_URL = "https://startups.gallery";

function resolveUrl(href: string | undefined): string | null {
  if (!href) return null;
  try {
    return new URL(href, BASE_URL).href;
  } catch {
    return null;
  }
}

const startupsGalleryAdapter: IngestorAdapter = {
  name: "StartupsGallery",
  source: "startups_gallery",
  async fetchAndParse(): Promise<CompanyRecord[]> {
    const { data } = await axios.get(BASE_URL, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; SparrowBot/1.0)" },
      timeout: 20_000,
    });

    const $ = cheerio.load(data as string);
    const out: CompanyRecord[] = [];

    // Strategy A — cards with data-website / data-url attributes
    $("[data-website],[data-url]").each((_, el) => {
      const rawUrl = $(el).attr("data-website") ?? $(el).attr("data-url") ?? "";
      const website = resolveUrl(rawUrl) ?? rawUrl;
      // Skip self-references that resolved relative to startups.gallery
      if (website.includes("startups.gallery")) return;
      const name =
        $(el).find("h2,h3,[class*='name'],[class*='title']").first().text().trim() ||
        $(el).attr("data-name") ||
        "";
      const description = $(el).find("p,[class*='desc']").first().text().trim();
      if (website && name) {
        out.push({
          name,
          website,
          oneLiner: description || null,
          signals: ["curated"],
          isVerified: false,
        });
      }
    });

    // Strategy B — anchor tags that look like company homepages
    if (out.length === 0) {
      $("a[href^='http']").each((_, el) => {
        const href = $(el).attr("href") ?? "";
        if (!href || href.includes("startups.gallery")) return;
        const name =
          $(el).find("h2,h3,[class*='name']").first().text().trim() ||
          $(el).text().trim();
        const description = $(el)
          .closest("[class*='card'],[class*='item']")
          .find("p")
          .first()
          .text()
          .trim();
        if (name && name.length > 1 && name.length < 80) {
          out.push({
            name,
            website: href,
            oneLiner: description || null,
            signals: ["curated"],
            isVerified: false,
          });
        }
      });
    }

    return out;
  },
};

export async function ingestStartupsGallery(): Promise<void> {
  await runIngestor(startupsGalleryAdapter);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  ingestStartupsGallery().finally(() => prisma.$disconnect()).catch(console.error);
}
