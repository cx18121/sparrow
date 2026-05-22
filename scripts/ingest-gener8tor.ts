import "dotenv/config";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";
import { prisma } from "./_lib/prisma.js";
import { runIngestor, type CompanyRecord, type IngestorAdapter } from "./_lib/ingestor.js";

// Gener8tor accelerator portfolio at https://gener8tor.com/portfolio.
//
// Squarespace page with an embedded Airtable view (~1920 records).
// Airtable's anonymous shared view requires a Bearer token loaded
// dynamically by the page; rather than reverse-engineer it, we open
// the page in Playwright, scroll until the table loads all records,
// and capture every /api.airtable.com/v0/ response. Then parse the
// records server-side.
//
// Per-record fields used: Company Name, Company Website, Description,
// Operating Status, Exited, State, City, Programs.

const PORTFOLIO_URL = "https://gener8tor.com/portfolio";

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

interface AirtableRecord {
  id: string;
  fields: Record<string, any>;
}

function normalizeUrl(raw: string): string | null {
  let s = (raw ?? "").trim();
  if (!s) return null;
  if (!/^https?:\/\//i.test(s)) s = `https://${s}`;
  try { return new URL(s).toString(); } catch { return null; }
}

function isExitedOrClosed(rec: AirtableRecord): boolean {
  const f = rec.fields;
  const ex = f["Exited"];
  if (typeof ex === "boolean" && ex) return true;
  if (typeof ex === "string" && /^(yes|true|exited)$/i.test(ex)) return true;
  const os = String(f["Operating Status"] ?? "").trim().toLowerCase();
  if (/closed|acquired|defunct|inactive/.test(os)) return true;
  return false;
}

export const gener8torAdapter: IngestorAdapter = {
  name: "Gener8tor",
  source: "gener8tor",
  async fetchAndParse(): Promise<CompanyRecord[]> {
    const browser = await chromium.launch({ headless: true });
    try {
      const ctx = await browser.newContext({ userAgent: UA, viewport: { width: 1440, height: 900 } });
      const page = await ctx.newPage();

      const airtableBodies: string[] = [];
      page.on("response", async (resp) => {
        if (!/api\.airtable\.com\/v0\//.test(resp.url())) return;
        try { airtableBodies.push(await resp.text()); } catch {}
      });

      console.log(`[Gener8tor] Playwright ${PORTFOLIO_URL}`);
      await page.goto(PORTFOLIO_URL, { waitUntil: "domcontentloaded", timeout: 60_000 });
      await page.waitForLoadState("networkidle", { timeout: 25_000 }).catch(() => {});

      // Trigger the embedded Airtable view to fetch every page by scrolling
      // for ~40 seconds. The view loads ~100 records per scroll-paginate.
      const totalScrolls = 60;
      let lastTotal = 0;
      for (let i = 0; i < totalScrolls; i++) {
        await page.evaluate(() => window.scrollBy(0, 2000));
        await page.waitForTimeout(700);
        // After every 10 scrolls, check whether more records have loaded.
        if (i > 0 && i % 10 === 0) {
          const cur = airtableBodies.length;
          if (cur === lastTotal && cur > 0) {
            // Plateau — try one more round then bail.
          }
          lastTotal = cur;
          console.log(`[Gener8tor] scroll ${i}/${totalScrolls}, captured responses=${cur}`);
        }
      }
      await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});

      console.log(`[Gener8tor] captured ${airtableBodies.length} airtable responses`);

      // Parse — dedupe by Airtable record id.
      const records = new Map<string, AirtableRecord>();
      for (const body of airtableBodies) {
        try {
          const obj = JSON.parse(body);
          for (const rec of obj.records ?? []) {
            if (rec.id && !records.has(rec.id)) records.set(rec.id, rec);
          }
        } catch {}
      }
      console.log(`[Gener8tor] unique records: ${records.size}`);

      const out: CompanyRecord[] = [];
      let noName = 0;
      let noWebsite = 0;
      let exits = 0;
      const seenDomain = new Set<string>();

      for (const rec of records.values()) {
        const f = rec.fields ?? {};
        const name = (typeof f["Company Name"] === "string" ? f["Company Name"] : "").trim();
        if (!name) { noName++; continue; }
        if (isExitedOrClosed(rec)) { exits++; continue; }

        const website = normalizeUrl(f["Company Website"]);
        if (!website) { noWebsite++; continue; }

        let domain: string;
        try { domain = new URL(website).hostname.replace(/^www\./, ""); }
        catch { noWebsite++; continue; }
        if (seenDomain.has(domain)) continue;
        seenDomain.add(domain);

        const oneLiner = typeof f["Description"] === "string" ? (f["Description"] as string).trim() || null : null;
        const stateLoc = typeof f["State"] === "string" ? (f["State"] as string).trim() : "";
        const cityLoc = typeof f["City"] === "string" ? (f["City"] as string).trim() : "";
        const location = [cityLoc, stateLoc].filter(Boolean).join(", ") || null;
        // Programs may be array or string.
        let batch: string | null = null;
        const programs = f["Programs"];
        if (Array.isArray(programs) && programs.length > 0) batch = String(programs[0]);
        else if (typeof programs === "string") batch = programs;

        out.push({
          name,
          website,
          oneLiner,
          location,
          batch,
          sourceId: rec.id,
          investors: ["gener8tor"],
          signals: ["vc-backed"],
          isVerified: true,
        });
      }

      console.log(`[Gener8tor] fetchAndParse DONE: ${out.length} kept — ${exits} exits, ${noName} no-name, ${noWebsite} no-website`);
      return out;
    } finally {
      await browser.close();
    }
  },
};

export async function ingestGener8tor(): Promise<void> {
  await runIngestor(gener8torAdapter);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  ingestGener8tor().finally(() => prisma.$disconnect()).catch(console.error);
}
