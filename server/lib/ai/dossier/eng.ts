import { callClaude } from '../anthropic.js'
import { tavilySearch, type TavilyResult } from '../tavily-search.js'
import { exaSearch, exaContents, type ExaResult } from '../exa-search.js'
import {
  SYNTH_MODEL,
  cleanList,
  dedupeByUrl,
  parseDossierJson,
  parseLine,
  stripCitations,
  type ResearchCompanyInput,
} from './shared.js'

// Engineering / product / null-role pipeline. Product shares the eng
// pipeline by design (ADR-0005) — same dossier shape, same retrieval
// shape, same picker. The null-role default (when no role is resolved
// at draft-generation time) also routes here.

// Structured snapshot of a company, produced once via search + LLM
// synthesis and reused across users + drafts. The per-recipient
// personalization (featureLine + fitAngle) is computed on top of this
// dossier without search — see pickFitAngle.
export interface CompanyDossier {
  summary: string
  surfaces: string[]
  recentLaunches: string[]
  technicalAreas: string[]
}

export interface PickFitAngleInput {
  dossier: CompanyDossier
  resumeText: string | null
  apiKey: string
  // When set, the model is asked to pick only FIT against this fixed
  // FEATURE. Used by the draft "change angle" flow so the chosen surface
  // is preserved verbatim while the fit phrasing is rederived for it.
  forceFeatureLine?: string | null
  // The role family the candidate is targeting (engineering / product /
  // gtm / operations). Steers the model toward surfaces relevant to that
  // function — designers should bridge to design surfaces, GTM applicants
  // should bridge to growth/revenue surfaces, etc. Optional — when absent
  // the model falls back to whichever surface the resume best supports
  // regardless of function. Kept minimal per "(a) tight" — no per-role
  // prompt branching, just one extra line of context in the prompt.
  targetRole?: 'engineering' | 'product' | 'gtm' | 'operations' | null
}

export interface FitAngleResult {
  featureLine: string | null
  fitAngle: string | null
}

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

Be specific. "the agent eval harness" is good. "their AI features" is bad. Never name the entire company in a list item. If the search results don't reveal concrete product detail, return empty arrays and an empty summary.

IMPORTANT — keep surfaces and recentLaunches strictly separate:
- surfaces: the company's stable, established core product capabilities that have existed for months or years. Do NOT include anything that also appears in recentLaunches.
- recentLaunches: only things announced or shipped in the last ~12 months. If a feature is both recent and core, put it in recentLaunches only — not both.`

const PICK_SYSTEM = `You pick the single best (feature, fit) PAIR for a cold-email candidate.

Inputs:
- A research dossier (the company's product surfaces, recent launches, technical areas)
- The candidate's resume

This is ONE coupled decision, not two independent ones. Search the cross-product of dossier surfaces × resume projects and return the strongest matching pair:
- FIT is the specific named project from the resume that opens the conversation
- FEATURE is the dossier surface that THAT project most directly bridges to — i.e. the surface where this specific project is the strongest credential, not the most prominent surface overall

Prefer FEATURE from surfaces (core product) over recentLaunches. A candidate cannot credibly claim experience with something that just launched — so a stable core surface is almost always a stronger bridge than a recent one. Only pick from recentLaunches when no surfaces or technicalAreas are a plausible match for the chosen FIT.

If two surfaces tie, prefer the one that is more specific to the chosen project. A resume project about LLM training should pair with a model/research surface, not a generic "code" surface — even if both are plausible. A resume project about UI work should pair with a design/frontend surface. A resume project about agent infrastructure should pair with an agentic/tooling surface. Only fall back to a generic surface like "code" or "developer tools" when the chosen project genuinely has no more specific match.

Grounding rules for FIT — keep it grounded in the resume, but use whatever concrete element the resume actually has:
- Must anchor on something concrete that appears in the resume: a named project, role, internship, course, research focus, paper, hackathon, club, or specific tool/stack/topic the resume lists. Use the resume's own words where natural.
- Do NOT invent topics the resume doesn't mention. If the resume only lists "Software Engineer at Acme working on backend services," "my backend work at Acme" is fine — the role and area are both concrete. But "my distributed systems research" would be forbidden when "distributed systems" isn't in the resume.
- Avoid pure stand-ins like "my recent project" or "my background" — anchor on a specific element from the resume even when that's a role or course rather than a flagship project.
- Output FIT: NONE only when the resume is genuinely empty or has no concrete element to anchor on (rare). A weak-but-grounded fit is better than NONE.

Output EXACTLY two lines, nothing else:
FEATURE: <a short noun phrase from or grounded in the dossier surfaces, lowercase, no period>
FIT: <must start with "my " and read as a noun phrase>

Format examples for FIT:
  "my RAG eval pipeline project"             // named project
  "my multi-agent eval harness"              // named project
  "my backend internship at Acme"            // named role
  "my research on agent benchmarks at MIT"   // named focus area
  "my CS 6741 LLM systems coursework"        // named course
The fit phrase has to grammatically slot into "For context, <FIT> feels like a natural stepping stone toward what your team is building." If "For context, [your phrasing] feels like..." doesn't read as a complete English sentence, rewrite.

Output FEATURE: NONE only if no dossier surface plausibly fits.
Output FIT: NONE only when the resume has no concrete element to anchor on — when FIT is NONE, still pick the most relevant FEATURE based on the resume's broad area (e.g. an engineering resume → a code/tooling surface). The opener still works without a fit angle.`

function buildSearchQuery(company: ResearchCompanyInput['company']): string {
  const parts = [company.name]
  if (company.domain) parts.push(company.domain)
  parts.push('product features recent launches')
  return parts.join(' ')
}

function buildSynthesisPrompt(company: ResearchCompanyInput['company'], results: TavilyResult[]): string {
  const ctx = [
    `Company name: ${company.name}`,
    company.domain ? `Website: ${company.domain}` : null,
    company.oneLiner ? `One-liner: ${company.oneLiner}` : null,
    company.description ? `Description: ${company.description}` : null,
    company.stage ? `Stage: ${company.stage}` : null,
    company.industry ? `Industry: ${company.industry}` : null,
  ]
    .filter(Boolean)
    .join('\n')

  const resultsBlock = results
    .map((r, i) => `[${i + 1}] ${r.title}\n${r.url}\n${r.content}`)
    .join('\n\n')

  return [ctx, '', 'Search results:', resultsBlock].join('\n')
}

// Role family → one-line steer for the picker. Keeps the prompt change
// surface-level — the picker still reasons over the same cross-product
// of dossier × resume — but tilts the tiebreaker toward function-
// relevant surfaces. Avoids hard rules ("MUST pick a sales surface")
// because the model otherwise picks bad fits when no sales-shaped
// surface exists.
const ROLE_HINTS: Record<string, string> = {
  engineering: "Candidate is targeting engineering roles — prefer technical, infrastructure, code, model, or developer-tooling surfaces when they plausibly match.",
  product: "Candidate is targeting product / design roles — prefer product, UX, design system, or end-user-facing surfaces when they plausibly match.",
  gtm: "Candidate is targeting GTM roles (sales, marketing, growth) — prefer revenue, growth-loop, distribution, or customer-facing surfaces when they plausibly match.",
  operations: "Candidate is targeting operations / finance / people roles — prefer scale, process, hiring, or org-infrastructure surfaces when they plausibly match.",
}

function buildPickPrompt(input: PickFitAngleInput): string {
  const d = input.dossier
  const forced = input.forceFeatureLine?.trim() || null
  const roleHint = input.targetRole ? ROLE_HINTS[input.targetRole] : null
  const lines = [
    'Dossier:',
    d.summary ? `Summary: ${d.summary}` : null,
    d.surfaces.length ? `Surfaces: ${d.surfaces.join('; ')}` : null,
    d.recentLaunches.length ? `Recent launches: ${d.recentLaunches.join('; ')}` : null,
    d.technicalAreas.length ? `Technical areas: ${d.technicalAreas.join('; ')}` : null,
    '',
    'Candidate resume (full):',
    input.resumeText ?? '(no resume provided)',
    roleHint ? '' : null,
    roleHint,
    forced ? '' : null,
    // The user has explicitly chosen FEATURE in the UI. Echo it back
    // verbatim and pick only FIT to bridge to it. This keeps the chosen
    // surface stable while letting the model re-anchor the resume hook.
    forced ? `FEATURE is fixed: "${forced}". Output FEATURE: "${forced}" exactly, then pick FIT that bridges most directly to that surface.` : null,
  ].filter(line => line !== null)
  return lines.join('\n')
}

function emptyDossier(): CompanyDossier {
  return { summary: '', surfaces: [], recentLaunches: [], technicalAreas: [] }
}

export function isEmptyDossier(d: CompanyDossier): boolean {
  return (
    d.surfaces.length === 0 &&
    d.recentLaunches.length === 0 &&
    d.technicalAreas.length === 0
  )
}

function parseDossier(raw: string): CompanyDossier {
  return parseDossierJson(
    raw,
    emptyDossier(),
    parsed => ({
      summary: typeof parsed.summary === 'string' ? stripCitations(parsed.summary) : '',
      surfaces: cleanList(parsed.surfaces),
      recentLaunches: cleanList(parsed.recentLaunches),
      technicalAreas: cleanList(parsed.technicalAreas),
    }),
    'Dossier synthesis',
  )
}

// Runtime validation for values pulled from Company.researchDossier
// (Json column → Prisma typed as `unknown`). Returns null on shape
// failure so callers can treat it as a cache miss instead of flowing
// garbage through. Reused by envelope.ts for the legacy-flat-row path
// and the engineering-slot validator.
export function parseFlatDossier(value: unknown): CompanyDossier | null {
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

// Synthesis step shared by every retrieval provider. The dossier shape
// is the contract; the choice of search vendor is invisible past this
// boundary. Exported so eval harnesses can run synthesis over arbitrary
// result sets.
export async function synthesizeDossier(
  company: ResearchCompanyInput['company'],
  results: TavilyResult[],
  apiKey: string,
): Promise<CompanyDossier> {
  if (results.length === 0) return emptyDossier()
  const text = await callClaude({
    apiKey,
    model: SYNTH_MODEL,
    system: SYNTH_SYSTEM,
    userContent: buildSynthesisPrompt(company, results),
    // 2048 is comfortable for summary + ~7 surfaces + ~5 launches + ~5
    // areas. Lower (1024) was observed to truncate JSON mid-array.
    maxTokens: 2048,
  })
  return parseDossier(text)
}

// Cacheable per-company research: Tavily search → Claude synthesis.
// Returns an empty dossier when Tavily is disabled or returns no usable
// results.
export async function researchCompanyDossier(
  input: ResearchCompanyInput,
): Promise<CompanyDossier> {
  if (!input.tavilyApiKey) return emptyDossier()

  const search = await tavilySearch({
    query: buildSearchQuery(input.company),
    apiKey: input.tavilyApiKey,
    maxResults: 5,
    searchDepth: input.searchDepth,
  })
  return synthesizeDossier(input.company, search.results, input.apiKey)
}

export interface ResearchCompanyExaInput {
  company: ResearchCompanyInput['company']
  apiKey: string
  exaApiKey: string | null
  // Days back from now to constrain results. Default 180 — tight enough
  // to privilege recent launches, loose enough that small companies
  // still surface.
  recencyDays?: number
  // Override Exa's per-query routing classifier. Default 'auto'.
  type?: 'neural' | 'keyword' | 'auto'
}

// Exa-backed sibling of researchCompanyDossier. Identical contract:
// returns the same CompanyDossier shape, fails closed to an empty
// dossier on missing key or empty results. The synthesis prompt is
// shared, so Tavily vs Exa is a pure retrieval-quality A/B with no
// downstream confounds.
export async function researchCompanyDossierExa(
  input: ResearchCompanyExaInput,
): Promise<CompanyDossier> {
  if (!input.exaApiKey) return emptyDossier()

  const recencyDays = input.recencyDays ?? 180
  const startDate = new Date(Date.now() - recencyDays * 24 * 60 * 60 * 1000).toISOString()

  const search = await exaSearch({
    query: buildSearchQuery(input.company),
    apiKey: input.exaApiKey,
    numResults: 5,
    type: input.type ?? 'auto',
    startPublishedDate: startDate,
    textMaxCharacters: 2000,
  })

  // ExaResult is a structural superset of TavilyResult ({ title, url,
  // content } shared, plus optional metadata). The synthesis prompt
  // only reads the shared fields, so the cast is safe and avoids a
  // redundant remap.
  return synthesizeDossier(input.company, search.results, input.apiKey)
}

export interface ResearchCompanyHybridInput {
  company: ResearchCompanyInput['company']
  apiKey: string
  // Both keys are nullable — caller passes whatever's in env. Behavior:
  //   both set    → Exa first, Tavily fallback on 0-result whiff
  //   only Exa    → Exa-only (same as researchCompanyDossierExa)
  //   only Tavily → Tavily-only (same as researchCompanyDossier)
  //   neither     → empty dossier (email drafts without personalization)
  exaApiKey: string | null
  tavilyApiKey: string | null
  recencyDays?: number
  type?: 'neural' | 'keyword' | 'auto'
  // Tavily depth when falling back. Defaults to 'advanced' (richer
  // extracts matter more on the long tail where each result is precious).
  tavilySearchDepth?: 'basic' | 'advanced'
}

// Hybrid retrieval. The Exa layer is itself two-arm:
//   1. /search — third-party coverage, news, launches; brings recency
//      hooks
//   2. /contents — the company's own homepage + /about /team /careers
//                  /blog /product subpages; resolves entity-name
//                  collisions where /search returns competitors
//                  (Consus vs Consensus, Multi vs Microsoft Multi-app,
//                  etc.) and grounds the dossier in the company's
//                  actual product description.
// Both run in parallel; results merge with /contents first (so the
// company's own positioning anchors the synthesizer's input). Per the
// side-by-side at .scratch/exa-arms-eval.md, layered recovers dossiers
// /search alone gets wrong (entity collisions) and retains the news
// that /contents alone misses.
//
// Tavily stays as the final rescue branch: only fires when BOTH Exa
// calls return zero results (long-tail entities the neural index
// hasn't seen, or dead sites). Cost: layered Exa is 2 retrieval calls
// per first-research, but the result caches indefinitely on
// Company.researchDossier — paid once per company, never again unless
// someone wires a manual refresh path.
export async function researchCompanyDossierHybrid(
  input: ResearchCompanyHybridInput,
): Promise<CompanyDossier> {
  const { company, apiKey, exaApiKey, tavilyApiKey } = input
  const recencyDays = input.recencyDays ?? 180

  if (exaApiKey) {
    const startDate = new Date(Date.now() - recencyDays * 24 * 60 * 60 * 1000).toISOString()
    const url = company.domain
      ? (company.domain.startsWith('http') ? company.domain : `https://${company.domain}`)
      : null

    const [searchResp, contentsResp] = await Promise.all([
      exaSearch({
        query: buildSearchQuery(company),
        apiKey: exaApiKey,
        numResults: 5,
        type: input.type ?? 'auto',
        startPublishedDate: startDate,
        textMaxCharacters: 2000,
      }),
      url
        ? exaContents({
            urls: [url],
            apiKey: exaApiKey,
            subpageTarget: ['about', 'team', 'careers', 'blog', 'product'],
            subpages: 5,
            livecrawl: 'auto',
            textMaxCharacters: 2000,
          })
        : Promise.resolve({ results: [] as ExaResult[] }),
    ])

    const merged = dedupeByUrl([...contentsResp.results, ...searchResp.results])
    if (merged.length > 0) {
      return synthesizeDossier(company, merged, apiKey)
    }
    // Both Exa calls whiffed. Fall through to Tavily — its
    // keyword-matched Google index has wider raw coverage on obscure /
    // dead-site companies.
    console.info(`hybrid retrieval: Exa search+contents returned 0 results for "${company.name}", falling back to Tavily`)
  }

  if (!tavilyApiKey) return emptyDossier()

  const tavilyResults = await tavilySearch({
    query: buildSearchQuery(company),
    apiKey: tavilyApiKey,
    maxResults: 5,
    searchDepth: input.tavilySearchDepth ?? 'advanced',
  })
  return synthesizeDossier(company, tavilyResults.results, apiKey)
}

// Per-recipient personalization. Token-only — no search.
export async function pickFitAngle(input: PickFitAngleInput): Promise<FitAngleResult> {
  if (isEmptyDossier(input.dossier)) {
    return { featureLine: input.forceFeatureLine?.trim() || null, fitAngle: null }
  }

  const text = await callClaude({
    apiKey: input.apiKey,
    model: SYNTH_MODEL,
    system: PICK_SYSTEM,
    userContent: buildPickPrompt(input),
    maxTokens: 256,
  })

  console.log('[pickFitAngle] raw output:', text)
  const forced = input.forceFeatureLine?.trim() || null
  return {
    // When the caller forced a FEATURE, trust the user's choice over the
    // model's echo: if the model drifts (rephrases, adds punctuation),
    // we still emit the exact user-selected string for clean merge-tag
    // substitution downstream.
    featureLine: forced ?? parseLine(text, 'FEATURE'),
    fitAngle: parseLine(text, 'FIT'),
  }
}
