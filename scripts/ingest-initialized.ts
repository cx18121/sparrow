import "dotenv/config";
import axios from "axios";
import * as cheerio from "cheerio";
import { pathToFileURL } from "node:url";
import { prisma } from "./_lib/prisma.js";
import { runIngestor, type CompanyRecord, type IngestorAdapter } from "./_lib/ingestor.js";

// Initialized Capital portfolio at https://www.initialized.com/companies.
// Next.js page; the full company list ships inside the SSR'd `__NEXT_DATA__`
// script tag under `props.pageProps.startups.data[*].attributes`. One HTTP
// fetch reveals all 181 startups with the cleanest metadata of any source so
// far — `{name, description, websiteUrl, isUnicorn, tags}` is structured JSON
// rather than scraped HTML.
//
// Initialized exposes NO status field on this page — their roster is
// seed-stage focused and they don't publish exit markers here. Cross-source
// dedupe in runIngestor will absorb overlap with sources that DO mark exits
// (a16z, IVP, Coatue, Sapphire, Spark, etc.). Adding a status-tracking
// surface would require parsing each company's individual `/companies/<slug>`
// page, which is out of scope until exit noise materially hurts a campaign.
//
// The `isUnicorn` boolean is appended to `signals` when true — this is the
// only stage-adjacent signal Initialized publishes, and it's useful for
// filtering down to growth-stage rows in the wizard even though `stage` itself
// remains null.

const PORTFOLIO_URL = "https://www.initialized.com/companies";
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

interface InitializedAttributes {
  name?: string;
  description?: string | null;
  websiteUrl?: string;
  isUnicorn?: boolean;
  tags?: { data?: Array<{ attributes?: { name?: string } }> };
}

interface InitializedItem {
  attributes?: InitializedAttributes;
}

export const initializedAdapter: IngestorAdapter = {
  name: "Initialized",
  source: "initialized",
  async fetchAndParse(): Promise<CompanyRecord[]> {
    console.log(`[Initialized] GET ${PORTFOLIO_URL}`);
    const { data: html } = await axios.get<string>(PORTFOLIO_URL, {
      headers: { "User-Agent": UA },
      timeout: 30_000,
      maxRedirects: 5,
    });
    const $ = cheerio.load(html);
    const raw = $("#__NEXT_DATA__").first().html();
    if (!raw) {
      console.warn(`[Initialized] no __NEXT_DATA__ script — skipping`);
      return [];
    }

    let data: { props?: { pageProps?: { startups?: { data?: InitializedItem[] } } } };
    try {
      data = JSON.parse(raw);
    } catch (err: any) {
      console.warn(`[Initialized] JSON.parse failed: ${err.message}`);
      return [];
    }

    const items = data?.props?.pageProps?.startups?.data ?? [];
    console.log(`[Initialized] ${items.length} startups in __NEXT_DATA__`);

    const out: CompanyRecord[] = [];
    let missingName = 0;
    let missingUrl = 0;
    for (const it of items) {
      const a = it.attributes;
      if (!a) continue;
      const name = a.name?.trim();
      const website = a.websiteUrl?.trim();
      if (!name) { missingName++; continue; }
      if (!website || !/^https?:\/\//i.test(website)) { missingUrl++; continue; }

      const signals = ["vc-backed"];
      if (a.isUnicorn) signals.push("unicorn");
      const topics =
        a.tags?.data
          ?.map((t) => t.attributes?.name)
          .filter((n): n is string => !!n && n.length > 0) ?? [];

      out.push({
        name,
        website,
        description: a.description ?? null,
        oneLiner: a.description ?? null,
        investors: ["initialized"],
        signals,
        topics,
        isVerified: true,
      });
    }

    console.log(
      `[Initialized] fetchAndParse DONE: ${out.length} kept — ` +
        `${missingName} no-name, ${missingUrl} no-url`
    );
    return out;
  },
};

export async function ingestInitialized(): Promise<void> {
  await runIngestor(initializedAdapter);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  ingestInitialized().finally(() => prisma.$disconnect()).catch(console.error);
}
