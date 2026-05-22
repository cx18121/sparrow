import "dotenv/config";
import axios from "axios";
import * as cheerio from "cheerio";
import { pathToFileURL } from "node:url";
import { prisma } from "./_lib/prisma.js";
import { runIngestor, type CompanyRecord, type IngestorAdapter } from "./_lib/ingestor.js";

// Matrix Partners portfolio at https://www.matrixpartners.com/portfolio. The
// page is organized by partner — each partner card has a `.projects-rt`
// rich-text block listing the companies they led, with each company name as
// an inline anchor pointing to the company's homepage.
//
// Per-partner markup (the "All" view):
//   <div class="team-item-details">
//     <div class="margin-bottom margin-xxsmall">Dana Stalder</div>
//     <div class="text-color-grey margin-bottom margin-small min-2lines">FinTech, B2B</div>
//     <div class="projects-rt w-richtext">
//       <p>
//         <a href="https://www.apartmentlist.com/">ApartmentList</a>,
//         <a href="https://www.baselane.com/">Baselane</a>,
//         <a href="http://www.earnin.com/">EarnIn</a>, …
//       </p>
//     </div>
//   </div>
//
// We harvest every external <a href="..."> with the visible link text as the
// company name. No discriminator for exits — Matrix mixes active/exited.
// cross-source dedupe absorbs the IPO/acquired overlap.

const PORTFOLIO_URL = "https://www.matrixpartners.com/portfolio";

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const NON_COMPANY_HOSTS = [
  /(?:^|\.)matrix(partners)?\.(com|vc)$/i,
  /(?:^|\.)twitter\.com$/i,
  /(?:^|\.)x\.com$/i,
  /(?:^|\.)linkedin\.com$/i,
  /(?:^|\.)facebook\.com$/i,
  /(?:^|\.)instagram\.com$/i,
  /(?:^|\.)youtube\.com$/i,
  /(?:^|\.)website-files\.com$/i,
];

function isCompanyUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return !NON_COMPANY_HOSTS.some((p) => p.test(host));
  } catch {
    return false;
  }
}

// Clean trailing punctuation from link text (e.g. "Lightmatter," → "Lightmatter").
function cleanName(text: string): string {
  return text.trim().replace(/[,;:.]+$/, "").trim();
}

export const matrixPartnersAdapter: IngestorAdapter = {
  name: "MatrixPartners",
  source: "matrix-partners",
  async fetchAndParse(): Promise<CompanyRecord[]> {
    console.log(`[Matrix] GET ${PORTFOLIO_URL}`);
    const { data: html } = await axios.get<string>(PORTFOLIO_URL, {
      headers: { "User-Agent": UA },
      timeout: 30_000,
      maxRedirects: 5,
    });

    const $ = cheerio.load(html);
    const out: CompanyRecord[] = [];
    const seen = new Set<string>();

    let noName = 0;
    let noWebsite = 0;
    let dupe = 0;

    // Scope to the projects-rt rich-text blocks so we don't pick up nav
    // links or partner social profiles.
    $(".projects-rt a[href^='http']").each((_, a) => {
      const $a = $(a);
      const website = $a.attr("href")?.trim();
      const name = cleanName($a.text());

      if (!website || !/^https?:\/\//i.test(website) || !isCompanyUrl(website)) {
        noWebsite++;
        return;
      }
      if (!name || name.length < 2) {
        noName++;
        return;
      }

      // Dedupe by hostname (companies appear under multiple partners).
      let host: string;
      try {
        host = new URL(website).hostname.toLowerCase().replace(/^www\./, "");
      } catch {
        noWebsite++;
        return;
      }
      if (seen.has(host)) {
        dupe++;
        return;
      }
      seen.add(host);

      out.push({
        name,
        website,
        investors: ["matrix-partners"],
        signals: ["vc-backed"],
        isVerified: true,
      });
    });

    console.log(
      `[Matrix] fetchAndParse DONE: ${out.length} kept — ` +
        `${dupe} cross-partner dupe, ${noName} no-name, ${noWebsite} no-website`
    );
    return out;
  },
};

export async function ingestMatrixPartners(): Promise<void> {
  await runIngestor(matrixPartnersAdapter);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  ingestMatrixPartners().finally(() => prisma.$disconnect()).catch(console.error);
}
