import { callClaude } from './anthropic.js'
import { tavilySearch, type TavilyResult } from './tavily-search.js'

// Structured snapshot of a company, produced once via search + LLM synthesis
// and reused across users + drafts. The per-recipient personalization
// (featureLine + fitAngle) is computed on top of this dossier without search
// — see pickFitAngle.
export interface CompanyDossier {
  summary: string
  surfaces: string[]
  recentLaunches: string[]
  technicalAreas: string[]
}

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
  // Tavily key is the search provider. When null, research is disabled and the
  // dossier is empty — email still drafts without personalization.
  tavilyApiKey: string | null
  // Optional: 'basic' (cheaper, snippets) or 'advanced' (richer extracts).
  // Defaults to advanced because product-detail synthesis benefits from
  // longer page content.
  searchDepth?: 'basic' | 'advanced'
}

export interface PickFitAngleInput {
  dossier: CompanyDossier
  resumeText: string | null
  apiKey: string
}

export interface FitAngleResult {
  featureLine: string | null
  fitAngle: string | null
}

const SYNTH_MODEL = 'claude-haiku-4-5-20251001'

const SYNTH_SYSTEM = `You distill raw web search results about a company into a structured dossier for cold-email research.

Inputs:
- The company's name and any context the caller already knows
- A list of search results (title, URL, content snippet)

Output ONLY valid JSON with this exact shape (no prose, no code fences):
{
  "summary": "<one-sentence factual summary of what the company makes>",
  "surfaces": ["<3-7 specific product surfaces, features, or tools — short noun phrases, lowercase, no period>"],
  "recentLaunches": ["<0-5 launches or announcements in the last ~12 months — short noun phrases>"],
  "technicalAreas": ["<2-5 technical areas the company works on — short noun phrases>"]
}

Be specific. "the agent eval harness" is good. "their AI features" is bad. Never name the entire company in a list item. If the search results don't reveal concrete product detail, return empty arrays and an empty summary.`

const PICK_SYSTEM = `You pick the single best company surface and resume project for a cold-email candidate.

Inputs:
- A research dossier (the company's product surfaces, recent launches, technical areas)
- The candidate's resume

Choose:
- ONE surface from the dossier the candidate is BEST positioned to contribute to, given the resume
- ONE specific resume project (by topic, not title) that opens the conversation for THIS company

Output EXACTLY two lines, nothing else:
FEATURE: <a short noun phrase from or grounded in the dossier surfaces, lowercase, no period>
FIT: <"my X project" — a specific resume project, concrete, not generic>

Output FEATURE: NONE only if no dossier surface plausibly matches the resume. Output FIT: NONE only if the resume has no relevant project.`

function buildSearchQuery(input: ResearchCompanyInput): string {
  const parts = [input.company.name]
  if (input.company.domain) parts.push(input.company.domain)
  parts.push('product features recent launches')
  return parts.join(' ')
}

function buildSynthesisPrompt(input: ResearchCompanyInput, results: TavilyResult[]): string {
  const ctx = [
    `Company name: ${input.company.name}`,
    input.company.domain ? `Website: ${input.company.domain}` : null,
    input.company.oneLiner ? `One-liner: ${input.company.oneLiner}` : null,
    input.company.description ? `Description: ${input.company.description}` : null,
    input.company.stage ? `Stage: ${input.company.stage}` : null,
    input.company.industry ? `Industry: ${input.company.industry}` : null,
  ]
    .filter(Boolean)
    .join('\n')

  const resultsBlock = results
    .map((r, i) => `[${i + 1}] ${r.title}\n${r.url}\n${r.content}`)
    .join('\n\n')

  return [ctx, '', 'Search results:', resultsBlock].join('\n')
}

function buildPickPrompt(input: PickFitAngleInput): string {
  const d = input.dossier
  const lines = [
    'Dossier:',
    d.summary ? `Summary: ${d.summary}` : null,
    d.surfaces.length ? `Surfaces: ${d.surfaces.join('; ')}` : null,
    d.recentLaunches.length ? `Recent launches: ${d.recentLaunches.join('; ')}` : null,
    d.technicalAreas.length ? `Technical areas: ${d.technicalAreas.join('; ')}` : null,
    '',
    'Candidate resume (full):',
    input.resumeText ?? '(no resume provided)',
  ].filter(line => line !== null)
  return lines.join('\n')
}

// Tavily content is generally clean, but we strip a few known artifacts that
// occasionally leak through (HTML tags from poorly-cleaned scrapes).
function stripCitations(s: string): string {
  return s
    .replace(/<cite\b[^>]*>/gi, '')
    .replace(/<\/cite>/gi, '')
    .trim()
}

function cleanList(arr: unknown): string[] {
  if (!Array.isArray(arr)) return []
  return arr
    .filter((x): x is string => typeof x === 'string')
    .map(stripCitations)
    .filter(s => s.length > 0)
}

function parseDossier(raw: string): CompanyDossier {
  const empty: CompanyDossier = { summary: '', surfaces: [], recentLaunches: [], technicalAreas: [] }
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start < 0 || end <= start) {
    if (raw.trim().length > 0) {
      // Model emitted prose but no JSON — usually means it hit a refusal or
      // ignored the format instruction. Log so we can see it in prod.
      console.warn('Dossier synthesis: no JSON object found in response. Sample:', raw.slice(0, 200))
    }
    return empty
  }
  try {
    const parsed = JSON.parse(raw.slice(start, end + 1)) as Partial<CompanyDossier>
    return {
      summary: typeof parsed.summary === 'string' ? stripCitations(parsed.summary) : '',
      surfaces: cleanList(parsed.surfaces),
      recentLaunches: cleanList(parsed.recentLaunches),
      technicalAreas: cleanList(parsed.technicalAreas),
    }
  } catch (err) {
    // JSON.parse failure usually means truncation (max_tokens too low) or the
    // model emitted invalid syntax. Log so we can spot recurring issues.
    console.warn('Dossier synthesis: JSON parse failed (likely truncated). Sample:', raw.slice(-200), err)
    return empty
  }
}

function parseLine(raw: string, label: 'FEATURE' | 'FIT'): string | null {
  const re = new RegExp(`^${label}:\\s*(.+)$`, 'm')
  const match = raw.match(re)
  if (!match) return null
  const value = match[1].trim()
  if (value.length === 0) return null
  if (value.toUpperCase() === 'NONE') return null
  return value
}

function emptyDossier(): CompanyDossier {
  return { summary: '', surfaces: [], recentLaunches: [], technicalAreas: [] }
}

function isEmptyDossier(d: CompanyDossier): boolean {
  return (
    d.surfaces.length === 0 &&
    d.recentLaunches.length === 0 &&
    d.technicalAreas.length === 0
  )
}

// Runtime validation for values pulled from Company.researchDossier (Json
// column → Prisma typed as `unknown`). Returns null on shape failure so
// callers can treat it as a cache miss instead of flowing garbage through.
export function parseCachedDossier(value: unknown): CompanyDossier | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const v = value as Record<string, unknown>
  if (typeof v.summary !== 'string') return null
  if (!Array.isArray(v.surfaces) || !v.surfaces.every(s => typeof s === 'string')) return null
  if (!Array.isArray(v.recentLaunches) || !v.recentLaunches.every(s => typeof s === 'string')) return null
  if (!Array.isArray(v.technicalAreas) || !v.technicalAreas.every(s => typeof s === 'string')) return null
  return {
    summary: v.summary,
    surfaces: v.surfaces as string[],
    recentLaunches: v.recentLaunches as string[],
    technicalAreas: v.technicalAreas as string[],
  }
}

// Cacheable per-company research: Tavily search → Claude synthesis. Returns
// an empty dossier when Tavily is disabled or returns no usable results.
export async function researchCompanyDossier(
  input: ResearchCompanyInput
): Promise<CompanyDossier> {
  if (!input.tavilyApiKey) return emptyDossier()

  const search = await tavilySearch({
    query: buildSearchQuery(input),
    apiKey: input.tavilyApiKey,
    maxResults: 5,
    searchDepth: input.searchDepth,
  })
  if (search.results.length === 0) return emptyDossier()

  const text = await callClaude({
    apiKey: input.apiKey,
    model: SYNTH_MODEL,
    system: SYNTH_SYSTEM,
    userContent: buildSynthesisPrompt(input, search.results),
    // 2048 is comfortable for summary + ~7 surfaces + ~5 launches + ~5 areas.
    // Lower (1024) was observed to truncate JSON mid-array.
    maxTokens: 2048,
  })

  return parseDossier(text)
}

// Per-recipient personalization. Token-only — no search.
export async function pickFitAngle(input: PickFitAngleInput): Promise<FitAngleResult> {
  if (isEmptyDossier(input.dossier)) {
    return { featureLine: null, fitAngle: null }
  }

  const text = await callClaude({
    apiKey: input.apiKey,
    model: SYNTH_MODEL,
    system: PICK_SYSTEM,
    userContent: buildPickPrompt(input),
    maxTokens: 256,
  })

  return {
    featureLine: parseLine(text, 'FEATURE'),
    fitAngle: parseLine(text, 'FIT'),
  }
}
