import "dotenv/config";
import axios from "axios";
import { pathToFileURL } from "node:url";
import { upsertCompany } from "./_lib/upsert.js";
import { prisma } from "./_lib/prisma.js";

const CB_SEARCH_URL =
  "https://api.crunchbase.com/api/v4/searches/organizations";

const MAX_PAGES = 10;

interface CBIdentifier {
  value: string;
  permalink: string;
}

interface CBLocationIdentifier {
  value: string;
  location_type: string;
}

interface CBCategory {
  value: string;
}

interface CBOrg {
  identifier: CBIdentifier;
  short_description: string | null;
  website_url: string | null;
  location_identifiers: CBLocationIdentifier[] | null;
  num_employees_enum: string | null;
  funding_stage: string | null;
  categories: CBCategory[] | null;
  is_hiring: boolean | null;
}

interface CBResponse {
  entities: Array<{ properties: CBOrg }>;
  count: number;
  after_id: string | null;
}

function extractDomain(url: string): string | null {
  try {
    const hostname = new URL(url).hostname;
    return hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

function mapHeadcount(enum_val: string | null): number | null {
  const map: Record<string, number> = {
    c_00001_00010: 5,
    c_00011_00050: 30,
    c_00051_00100: 75,
    c_00101_00250: 175,
    c_00251_00500: 375,
    c_00501_01000: 750,
    c_01001_05000: 3000,
    c_05001_10000: 7500,
    c_10001_max: 15000,
  };
  return enum_val ? (map[enum_val] ?? null) : null;
}

function mapFundingStage(stage: string | null): string | null {
  const map: Record<string, string> = {
    seed: "Seed",
    angel: "Angel",
    early_stage_venture: "Series A",
    late_stage_venture: "Series C+",
    private_equity: "PE",
    ipo: "Public",
  };
  return stage ? (map[stage] ?? stage) : null;
}

export async function ingestCrunchbase(): Promise<void> {
  const apiKey = process.argv[2] ?? process.env.CRUNCHBASE_API_KEY;
  if (!apiKey) {
    throw new Error(
      "CRUNCHBASE_API_KEY required. Get one at https://data.crunchbase.com/docs — requires a paid Crunchbase Pro subscription."
    );
  }

  let afterId: string | null = null;
  let page = 0;
  let count = 0;

  while (page < MAX_PAGES) {
    const body: Record<string, unknown> = {
      field_ids: [
        "identifier",
        "short_description",
        "website_url",
        "location_identifiers",
        "num_employees_enum",
        "funding_stage",
        "categories",
        "is_hiring",
      ],
      query: [
        {
          type: "predicate",
          field_id: "facet_ids",
          operator_id: "includes",
          values: ["company"],
        },
        {
          type: "predicate",
          field_id: "funding_stage",
          operator_id: "includes",
          values: ["seed", "early_stage_venture", "late_stage_venture", "angel"],
        },
      ],
      limit: 25,
    };

    if (afterId) body.after_id = afterId;

    const response = await axios.post<CBResponse>(CB_SEARCH_URL, body, {
      params: { user_key: apiKey },
      headers: { "Content-Type": "application/json" },
    });

    const { entities, after_id } = response.data;

    if (!entities || entities.length === 0) break;

    for (const { properties: org } of entities) {
      const website = org.website_url;
      if (!website) continue;

      const domain = extractDomain(website);
      if (!domain) continue;

      const city = org.location_identifiers?.find(
        (l) => l.location_type === "city"
      )?.value ?? org.location_identifiers?.[0]?.value ?? null;

      try {
        await upsertCompany({
          domain,
          name: org.identifier.value,
          oneLiner: org.short_description,
          website,
          stage: mapFundingStage(org.funding_stage),
          industry: org.categories?.[0]?.value ?? null,
          location: city,
          headcount: mapHeadcount(org.num_employees_enum),
          isHiring: org.is_hiring ?? false,
          source: "crunchbase",
          sourceId: org.identifier.permalink,
        });
        count++;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`Failed to upsert ${org.identifier.value}: ${msg}`);
      }
    }

    page++;
    afterId = after_id;
    if (!afterId) break;
  }

  console.log(`Ingested ${count} Crunchbase companies`);
  await prisma.$disconnect();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  ingestCrunchbase().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
