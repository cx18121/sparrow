import axios from "axios";
import * as cheerio from "cheerio";
import { runIngestor, type CompanyRecord, type IngestorAdapter } from "./ingestor.js";
import type {
  HtmlFieldExtractor,
  HtmlManifest,
  HtmlSkipRule,
  Manifest,
  WpRestFieldExtractor,
  WpRestManifest,
  WpRestSkipRule,
} from "./manifest-types.js";

const USER_AGENT = "Mozilla/5.0 (compatible; SparrowBot/1.0)";

// ── dot-path extraction over arbitrary JSON ────────────────────────────────
// `title.rendered` → obj.title.rendered. Returns null for missing keys so
// callers can treat absence and null identically. Array indices are allowed
// via numeric segments (`investors.0._ref`) for the occasional Sanity-style
// reference list, but we don't need wildcards for the current sources.
function readPath(obj: unknown, path: string): unknown {
  if (obj == null) return null;
  const parts = path.split(".");
  let cur: any = obj;
  for (const p of parts) {
    if (cur == null) return null;
    cur = cur[p];
  }
  return cur ?? null;
}

function coerceString(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === "string") return value.trim() || null;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return null;
}

function hostnameOf(value: string): string | null {
  try { return new URL(value).hostname.toLowerCase(); } catch { return null; }
}

function rejectedByHost(value: string | null, rejectHosts: string[] | undefined): boolean {
  if (!value || !rejectHosts || rejectHosts.length === 0) return false;
  const host = hostnameOf(value);
  if (!host) return false;
  return rejectHosts.some((h) => host === h.toLowerCase() || host.endsWith(`.${h.toLowerCase()}`));
}

// Tries each path in `expr` and returns the first value that is non-empty and
// not rejected by `rejectHosts` (URL-typed fields only). Null when nothing
// qualifies.
function readWpExtractor(record: unknown, expr: WpRestFieldExtractor): string | null {
  if (typeof expr === "string") return coerceString(readPath(record, expr));
  const paths = Array.isArray(expr) ? expr : expr.paths;
  const rejectHosts = Array.isArray(expr) ? undefined : expr.rejectHosts;
  for (const path of paths) {
    const v = coerceString(readPath(record, path));
    if (!v) continue;
    if (rejectedByHost(v, rejectHosts)) continue;
    return v;
  }
  return null;
}

// ── HTML strategy ──────────────────────────────────────────────────────────

function extractFromHtml(
  $el: cheerio.Cheerio<any>,
  $: cheerio.CheerioAPI,
  expr: HtmlFieldExtractor,
): string | null {
  const node = expr.selector === "." ? $el : $el.find(expr.selector).first();
  if (!node.length) return null;
  const attr = expr.attr ?? "text";
  if (attr === "text") return node.text().trim() || null;
  const value = node.attr(attr);
  return value?.trim() || null;
}

function shouldSkipHtml(
  $el: cheerio.Cheerio<any>,
  $: cheerio.CheerioAPI,
  rules: HtmlSkipRule[] | undefined,
): boolean {
  if (!rules || rules.length === 0) return false;
  for (const rule of rules) {
    const node = $el.find(rule.selector).first();
    if (!node.length) continue;
    const text = node.text().trim().toLowerCase();
    if (!rule.contains || rule.contains.length === 0) return true;
    if (rule.contains.some((c) => text.includes(c.toLowerCase()))) return true;
  }
  return false;
}

function buildHtmlAdapter(manifest: HtmlManifest): IngestorAdapter {
  return {
    name: manifest.name,
    source: manifest.source,
    async fetchAndParse(): Promise<CompanyRecord[]> {
      const { data: html } = await axios.get<string>(manifest.fetch.url, {
        headers: { "User-Agent": USER_AGENT },
        timeout: 30_000,
        maxRedirects: 5,
      });
      const $ = cheerio.load(html);
      const items = $(manifest.list.itemSelector);
      console.log(`[${manifest.name}] ${items.length} ${manifest.list.itemSelector} items`);

      const out: CompanyRecord[] = [];
      const isVerified = manifest.isVerified ?? true;
      const signals = manifest.signals ?? ["vc-backed"];

      items.each((_, el) => {
        const $el = $(el);
        if (shouldSkipHtml($el, $, manifest.skip)) return;
        const name = extractFromHtml($el, $, manifest.extract.name);
        const website = extractFromHtml($el, $, manifest.extract.website);
        if (!name || !website) return;
        out.push({
          name,
          website,
          description: manifest.extract.description ? extractFromHtml($el, $, manifest.extract.description) : null,
          oneLiner: manifest.extract.oneLiner ? extractFromHtml($el, $, manifest.extract.oneLiner) : null,
          stage: manifest.extract.stage ? extractFromHtml($el, $, manifest.extract.stage) : null,
          industry: manifest.extract.industry ? extractFromHtml($el, $, manifest.extract.industry) : null,
          location: manifest.extract.location ? extractFromHtml($el, $, manifest.extract.location) : null,
          investors: manifest.investors,
          signals,
          isVerified,
        });
      });
      return out;
    },
  };
}

// ── WP REST strategy ───────────────────────────────────────────────────────

function shouldSkipWpRest(record: unknown, rules: WpRestSkipRule[] | undefined): boolean {
  if (!rules || rules.length === 0) return false;
  for (const rule of rules) {
    const v = readPath(record, rule.path);
    if (v == null) continue;
    const haystack = Array.isArray(v) ? v.map(coerceString) : [coerceString(v)];
    for (const item of haystack) {
      if (!item) continue;
      if (rule.values.some((val) => item.toLowerCase().includes(val.toLowerCase()))) return true;
    }
  }
  return false;
}

function buildWpRestAdapter(manifest: WpRestManifest): IngestorAdapter {
  const perPage = manifest.fetch.perPage ?? 100;
  const delayMs = manifest.fetch.delayMs ?? 300;
  return {
    name: manifest.name,
    source: manifest.source,
    async fetchAndParse(): Promise<CompanyRecord[]> {
      const url = `${manifest.fetch.base.replace(/\/$/, "")}/${manifest.fetch.postType}`;
      const records: any[] = [];
      let page = 1;
      let totalPages = 1;

      while (page <= totalPages) {
        try {
          const { data, headers } = await axios.get(url, {
            params: { per_page: perPage, page, ...(manifest.fetch.fields ? { _fields: manifest.fetch.fields } : {}) },
            headers: { "User-Agent": USER_AGENT },
            timeout: 20_000,
          });
          if (page === 1) {
            totalPages = parseInt(headers["x-wp-totalpages"] ?? "1", 10);
            console.log(`[${manifest.name}] ${headers["x-wp-total"]} records across ${totalPages} pages`);
          }
          records.push(...(data as any[]));
        } catch (err: any) {
          console.error(`[${manifest.name}] page ${page}: ${err.message}`);
          break;
        }
        page++;
        await new Promise((r) => setTimeout(r, delayMs));
      }

      const out: CompanyRecord[] = [];
      const isVerified = manifest.isVerified ?? true;
      const signals = manifest.signals ?? ["vc-backed"];
      const stripHtml = (s: string | null): string | null =>
        s == null ? null : s.replace(/<[^>]+>/g, "").trim() || null;

      for (const r of records) {
        if (shouldSkipWpRest(r, manifest.skip)) continue;
        const name = stripHtml(readWpExtractor(r, manifest.extract.name));
        const website = readWpExtractor(r, manifest.extract.website);
        if (!name || !website) continue;
        out.push({
          name,
          website,
          description: manifest.extract.description ? stripHtml(readWpExtractor(r, manifest.extract.description)) : null,
          oneLiner: manifest.extract.oneLiner ? stripHtml(readWpExtractor(r, manifest.extract.oneLiner)) : null,
          stage: manifest.extract.stage ? readWpExtractor(r, manifest.extract.stage) : null,
          industry: manifest.extract.industry ? readWpExtractor(r, manifest.extract.industry) : null,
          location: manifest.extract.location ? readWpExtractor(r, manifest.extract.location) : null,
          sourceId: manifest.extract.sourceId ? readWpExtractor(r, manifest.extract.sourceId) : coerceString(r.slug) ?? coerceString(r.id),
          investors: manifest.investors,
          signals,
          isVerified,
        });
      }
      return out;
    },
  };
}

// ── public entrypoint ──────────────────────────────────────────────────────

export async function runManifest(manifest: Manifest): Promise<void> {
  const adapter =
    manifest.fetch.type === "wp-rest"
      ? buildWpRestAdapter(manifest as WpRestManifest)
      : buildHtmlAdapter(manifest as HtmlManifest);
  await runIngestor(adapter);
}

// Re-exported for tests so we can unit-test extraction without a network hop.
export const _internal = { readPath, readWpExtractor, extractFromHtml, shouldSkipHtml, shouldSkipWpRest, rejectedByHost };
