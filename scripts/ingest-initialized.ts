import "dotenv/config";
import axios from "axios";
import { pathToFileURL } from "node:url";
import { upsertCompany } from "./_lib/upsert.js";
import { prisma } from "./_lib/prisma.js";
import { buildTags, isFreeHostingDomain } from "./_lib/tags.js";
import { computeQualityScore } from "./_lib/quality-score.js";

// Initialized Capital portfolio — 181 companies embedded in __NEXT_DATA__ on
// https://initialized.com/companies. No auth, no pagination, single HTTP fetch.

const BASE_URL = "https://initialized.com/companies";

interface InitializedEntry {
  attributes?: {
    name?: string;
    description?: string;
    websiteUrl?: string;
    isUnicorn?: boolean;
    tags?: {
      data?: Array<{ attributes?: { name?: string } }>;
    };
  };
}

function extractDomain(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

export async function ingestInitialized(): Promise<void> {
  let html: string;

  try {
    const { data } = await axios.get(BASE_URL, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; ColdFlowBot/1.0)" },
      timeout: 20_000,
    });
    html = data as string;
  } catch (err: any) {
    console.error(`[Initialized] Failed to fetch page: ${err.message}`);
    return;
  }

  const match = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
  if (!match) {
    console.error("[Initialized] __NEXT_DATA__ not found — page structure may have changed");
    return;
  }

  let nextData: any;
  try {
    nextData = JSON.parse(match[1]);
  } catch {
    console.error("[Initialized] Failed to parse __NEXT_DATA__");
    return;
  }

  const pageProps = nextData?.props?.pageProps ?? {};
  const entries: InitializedEntry[] =
    pageProps.startups?.data ??
    pageProps.companies?.data ??
    pageProps.portfolio?.data ??
    [];

  if (!entries.length) {
    console.warn("[Initialized] No companies found — available pageProps keys:", Object.keys(pageProps));
    return;
  }

  console.log(`[Initialized] ${entries.length} portfolio companies`);

  let ingested = 0;
  let skipped = 0;

  for (const entry of entries) {
    const a = entry.attributes;
    if (!a?.websiteUrl) { skipped++; continue; }

    const domain = extractDomain(a.websiteUrl);
    if (!domain || isFreeHostingDomain(domain)) { skipped++; continue; }

    const topicNames = (a.tags?.data ?? [])
      .map(t => t.attributes?.name)
      .filter(Boolean) as string[];

    const signals: string[] = ["vc-backed"];
    if (a.isUnicorn) signals.push("unicorn");

    const tags = buildTags({ topics: topicNames, industry: topicNames[0] ?? undefined, investors: ["initialized"], signals });
    const qualityScore = computeQualityScore({
      isVerified: true,
      industry: topicNames[0] ?? null,
    });

    try {
      await upsertCompany({
        domain,
        name: a.name ?? domain,
        description: a.description?.slice(0, 500) ?? null,
        website: a.websiteUrl,
        industry: topicNames[0] ?? null,
        source: "initialized",
        sourceId: domain,
        tags,
        isVerified: true,
        qualityScore,
      });
      ingested++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[Initialized] Failed "${a.name}": ${msg}`);
    }
  }

  console.log(`[Initialized] Ingested ${ingested}, skipped ${skipped}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  ingestInitialized().finally(() => prisma.$disconnect()).catch(console.error);
}
