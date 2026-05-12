import "dotenv/config";
import axios from "axios";
import * as cheerio from "cheerio";
import { pathToFileURL } from "node:url";
import { prisma } from "./_lib/prisma.js";
import { runIngestor, type CompanyRecord, type IngestorAdapter } from "./_lib/ingestor.js";

// Sapphire Ventures portfolio at https://sapphireventures.com/companies/.
// WordPress + Yoast SEO; the entire portfolio renders statically as a single
// FacetWP-filtered grid. One HTTP fetch yields every card whether or not the
// JS-driven facet UI has surfaced it — no pagination, no detail-page hop, no
// JS execution required.
//
// Per-card markup (each card is one `<li>` with FacetWP filter classes):
//
//   <li class="filter__... filter__private filter__... ">
//     <div class="companies-v2-list-items-front"> ...logo + optional <span>IPO</span> badge... </div>
//     <div class="companies-v2-list-items-back">
//       <a href="https://www.feedzai.com/" target="_blank"></a>
//       <div class="companies-v2-list-items-title"><h3>Feedzai</h3></div>
//       <div class="companies-v2-list-items-text">AI, coding the future of commerce...</div>
//     </div>
//   </li>
//
// Extraction:
//   - href on the empty anchor inside `.companies-v2-list-items-back` → website
//   - `<h3>` text under `.companies-v2-list-items-title`               → name
//   - `.companies-v2-list-items-text` text                             → tagline (oneLiner)
//
// Exit filter: the `<li>` carries one of three status filter classes —
// `filter__private` (active, keep), `filter__ipo` (public, skip),
// `filter__ma` (acquired, skip). A small number of cards carry both
// `filter__ipo` and `filter__ma` (e.g. acquired post-IPO) — also skip. The
// status filters are part of Sapphire's own FacetWP setup so they are
// authoritative; no skiplist needed.
//
// Sapphire is SaaS-focused and the active set skews growth-stage. No stage
// data on the page, so every surviving row ingests with stage=null — same
// shape as IVP/Insight/Khosla/Wave.

const PORTFOLIO_URL = "https://sapphireventures.com/companies/";
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

export const sapphireAdapter: IngestorAdapter = {
  name: "Sapphire",
  source: "sapphire",
  async fetchAndParse(): Promise<CompanyRecord[]> {
    console.log(`[Sapphire] GET ${PORTFOLIO_URL}`);
    const { data: html } = await axios.get<string>(PORTFOLIO_URL, {
      headers: { "User-Agent": UA },
      timeout: 30_000,
      maxRedirects: 5,
    });
    const $ = cheerio.load(html);

    const out: CompanyRecord[] = [];
    let skippedExit = 0;
    let skippedNoUrl = 0;
    let skippedNoName = 0;
    let skippedNoStatus = 0;

    $("li").each((_, el) => {
      const $li = $(el);
      const cls = $li.attr("class") ?? "";
      // Cheap pre-filter: only consider `<li>` elements that carry the FacetWP
      // `filter__` prefix. Everything else (nav menus, intro blocks) lacks it.
      if (!/\bfilter__/.test(cls)) return;

      const isPrivate = /\bfilter__private\b/.test(cls);
      const isIpo = /\bfilter__ipo\b/.test(cls);
      const isMa = /\bfilter__ma\b/.test(cls);
      if (isIpo || isMa) {
        skippedExit++;
        return;
      }
      if (!isPrivate) {
        // Card lacks any of the three known status filters — likely a
        // structural `<li>` we accidentally matched. Be conservative.
        skippedNoStatus++;
        return;
      }

      const $back = $li.find(".companies-v2-list-items-back").first();
      const href = $back.find("a[href^='http']").first().attr("href")?.trim();
      const name = $back.find(".companies-v2-list-items-title h3").first().text().trim();
      const tagline = $back.find(".companies-v2-list-items-text").first().text().trim() || null;

      if (!href) { skippedNoUrl++; return; }
      if (!name) { skippedNoName++; return; }

      out.push({
        name,
        website: href,
        oneLiner: tagline,
        investors: ["sapphire"],
        signals: ["vc-backed"],
        isVerified: true,
      });
    });

    console.log(
      `[Sapphire] fetchAndParse DONE: ${out.length} kept — ` +
        `${skippedExit} exits (ipo/ma), ${skippedNoStatus} no-status, ${skippedNoUrl} no-url, ${skippedNoName} no-name`
    );
    return out;
  },
};

export async function ingestSapphire(): Promise<void> {
  await runIngestor(sapphireAdapter);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  ingestSapphire().finally(() => prisma.$disconnect()).catch(console.error);
}
