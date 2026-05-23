import type { ExaResult } from '../exa-search.js'

// Shared infrastructure across the eng / gtm / ops dossier pipelines.
// Each role pipeline (../eng.ts, ../gtm.ts, ../ops.ts) reuses the
// constants, types, and helpers exported here so the role-specific
// files stay focused on their prompt + retrieval shape.

// Claude model used for synthesis + picker calls across all three roles.
// Haiku 4.5 hits the right cost/latency point for both — synthesis is
// JSON-shaped output of ~1-2 KB; picker output is one or two lines.
export const SYNTH_MODEL = 'claude-haiku-4-5-20251001'

// Common input shape for every role's research entry point. Each role has
// its own *Hybrid input that extends this with role-specific knobs
// (recencyDays defaults, GTM include domains, ops's no-recency contract).
export interface ResearchCompanyInput {
  company: {
    name: string
    description: string | null
    oneLiner: string | null
    stage: string | null
    industry: string | null
    isHiring: boolean
    domain?: string | null
  }
  apiKey: string
  // Tavily key is the search provider for the eng pipeline. When null,
  // research is disabled and the dossier is empty — email still drafts
  // without personalization.
  tavilyApiKey: string | null
  // Optional: 'basic' (cheaper, snippets) or 'advanced' (richer extracts).
  // Defaults to advanced because product-detail synthesis benefits from
  // longer page content.
  searchDepth?: 'basic' | 'advanced'
}

// Tavily content is generally clean, but we strip a few known artifacts
// that occasionally leak through (HTML tags from poorly-cleaned scrapes).
// Used by every dossier hydrator on the `summary` field — array fields
// already get cleanList which calls stripCitations on each element.
export function stripCitations(s: string): string {
  return s
    .replace(/<cite\b[^>]*>/gi, '')
    .replace(/<\/cite>/gi, '')
    .trim()
}

export function cleanList(arr: unknown): string[] {
  if (!Array.isArray(arr)) return []
  return arr
    .filter((x): x is string => typeof x === 'string')
    .map(stripCitations)
    .filter(s => s.length > 0)
}

// Picker output format: each picker emits "<LABEL>: <value>" lines.
// parseLine extracts the value for a given label, returning null on
// missing line, empty value, or the sentinel "NONE".
export function parseLine(
  raw: string,
  label: 'FEATURE' | 'FIT' | 'TRIGGER' | 'PROOF' | 'INFLECTION' | 'SYSTEM',
): string | null {
  const re = new RegExp(`^${label}:\\s*(.+)$`, 'm')
  const match = raw.match(re)
  if (!match) return null
  const value = match[1].trim()
  if (value.length === 0) return null
  if (value.toUpperCase() === 'NONE') return null
  return value
}

// Shared JSON-parsing shell for the per-role synthesize* functions.
// Locates the first JSON object in the model's output, parses it, and
// runs `hydrate` to map the validated fields onto the role's dossier
// shape. Returns the per-role empty value on parse failure with a
// labeled console.warn so prod regressions surface.
//
// Collapses three near-identical bodies (parseDossier,
// parseGtmDossierFromText, parseOpsDossierFromText) that differed only
// in role-specific field names and the warn-message prefix.
export function parseDossierJson<T>(
  raw: string,
  empty: T,
  hydrate: (parsed: Record<string, unknown>) => T,
  label: string,
): T {
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start < 0 || end <= start) {
    if (raw.trim().length > 0) {
      // Model emitted prose but no JSON — usually means it hit a refusal
      // or ignored the format instruction. Log so prod regressions are
      // visible.
      console.warn(`${label}: no JSON object found in response. Sample:`, raw.slice(0, 200))
    }
    return empty
  }
  try {
    const parsed = JSON.parse(raw.slice(start, end + 1)) as Record<string, unknown>
    return hydrate(parsed)
  } catch (err) {
    // JSON.parse failure usually means truncation (max_tokens too low)
    // or invalid syntax. Log so we can spot recurring issues.
    console.warn(`${label}: JSON parse failed (likely truncated). Sample:`, raw.slice(-200), err)
    return empty
  }
}

// Dedupe by canonical URL. Trailing slash + case-insensitive host so
// "https://acme.com/" and "https://Acme.com" collapse. First occurrence
// wins — callers control ordering by which list they pass first.
// Shared by the eng + gtm hybrid pipelines that merge /search and
// /contents results.
export function dedupeByUrl(items: ExaResult[]): ExaResult[] {
  const seen = new Set<string>()
  const out: ExaResult[] = []
  for (const r of items) {
    const key = r.url.toLowerCase().replace(/\/+$/, '')
    if (seen.has(key)) continue
    seen.add(key)
    out.push(r)
  }
  return out
}
