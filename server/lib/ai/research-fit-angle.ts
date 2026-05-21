import { callClaude } from './anthropic.js'
import { tavilySearch, type TavilyResult } from './tavily-search.js'
import { exaSearch, exaContents, type ExaResult } from './exa-search.js'

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

// Role family → one-line steer for the picker. Keeps the prompt change
// surface-level — the picker still reasons over the same cross-product of
// dossier × resume — but tilts the tiebreaker toward function-relevant
// surfaces. Avoids hard rules ("MUST pick a sales surface") because the
// model otherwise picks bad fits when no sales-shaped surface exists.
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

function parseLine(raw: string, label: 'FEATURE' | 'FIT' | 'TRIGGER' | 'PROOF' | 'INFLECTION' | 'SYSTEM'): string | null {
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

export function isEmptyDossier(d: CompanyDossier): boolean {
  return (
    d.surfaces.length === 0 &&
    d.recentLaunches.length === 0 &&
    d.technicalAreas.length === 0
  )
}

// Runtime validation for values pulled from Company.researchDossier (Json
// column → Prisma typed as `unknown`). Returns null on shape failure so
// callers can treat it as a cache miss instead of flowing garbage through.
//
// Used as a leaf parser by parseCachedDossierEnvelope below for the
// legacy-flat-row path. Exported because the per-slot validator inside
// the envelope reuses the same shape contract.
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

// Per-slot cached dossier — the per-role research output plus when it was
// produced. Lives inside the DossierEnvelope below. researchedAt is stored
// as ISO 8601 in JSON; we parse it back to Date at read time.
//
// Generic over the dossier type so engineering (CompanyDossier) and GTM
// (GtmDossier) slots can coexist in one envelope per ADR-0005. Defaults
// to CompanyDossier for back-compat with callers that don't parameterize.
export interface CachedRoleSlot<TDossier = CompanyDossier> {
  dossier: TDossier
  researchedAt: Date
}

// Envelope shape stored in Company.researchDossier per ADR-0005. Each
// role family owns its own slot, and each slot carries its role-shaped
// dossier type. Product reads from `engineering` — they share a pipeline
// (see slotForRole below).
//
// Legacy flat rows (pre-ADR-0005) upgrade in-memory only — see
// parseCachedDossierEnvelope. There is no DB migration; the upgrade
// persists naturally the next time research re-runs and writes the
// envelope back.
export interface DossierEnvelope {
  engineering: CachedRoleSlot<CompanyDossier> | null
  gtm: CachedRoleSlot<GtmDossier> | null
  operations: CachedRoleSlot<OpsDossier> | null
}

const EMPTY_ENVELOPE: DossierEnvelope = Object.freeze({
  engineering: null,
  gtm: null,
  operations: null,
}) as DossierEnvelope

function parseEngSlot(value: unknown): CachedRoleSlot<CompanyDossier> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const v = value as Record<string, unknown>
  const dossier = parseFlatDossier(v.dossier)
  if (!dossier) return null
  const at = typeof v.researchedAt === 'string' ? new Date(v.researchedAt) : null
  if (!at || Number.isNaN(at.getTime())) return null
  return { dossier, researchedAt: at }
}

function parseGtmSlot(value: unknown): CachedRoleSlot<GtmDossier> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const v = value as Record<string, unknown>
  const dossier = parseGtmDossier(v.dossier)
  if (!dossier) return null
  const at = typeof v.researchedAt === 'string' ? new Date(v.researchedAt) : null
  if (!at || Number.isNaN(at.getTime())) return null
  return { dossier, researchedAt: at }
}

function parseOpsSlot(value: unknown): CachedRoleSlot<OpsDossier> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const v = value as Record<string, unknown>
  const dossier = parseOpsDossier(v.dossier)
  if (!dossier) return null
  const at = typeof v.researchedAt === 'string' ? new Date(v.researchedAt) : null
  if (!at || Number.isNaN(at.getTime())) return null
  return { dossier, researchedAt: at }
}

// Parses Company.researchDossier into an envelope, handling two shapes:
//   - Envelope (post-ADR-0005): { engineering, gtm, operations } JSON
//   - Legacy flat (pre-ADR-0005): the raw eng dossier JSON written directly
// Legacy rows fold into the `engineering` slot with `legacyAt` (which the
// caller passes as Company.researchedAt — the column that recorded when
// the flat dossier was last written). Invalid or missing values produce
// an empty envelope so callers can treat shape failures the same as a
// cache miss.
export function parseCachedDossierEnvelope(
  value: unknown,
  legacyAt: Date | null,
): DossierEnvelope {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { ...EMPTY_ENVELOPE }
  }
  const v = value as Record<string, unknown>

  // Discriminator: prefer legacy when the JSON positively looks like a
  // flat dossier (has `summary` as string AND `surfaces` as array). This
  // is stronger than just checking absence of envelope keys — a malformed
  // legacy row with an incidental `engineering` field would otherwise
  // be misclassified as an envelope and silently produce a cache miss.
  // The two shapes are structurally exclusive in normal use: legacy rows
  // came from parseFlatDossier-conformant writes (no envelope keys);
  // envelope rows came from setDossierSlot writes (no flat keys).
  const looksLikeLegacy =
    typeof v.summary === 'string' && Array.isArray(v.surfaces)
  if (looksLikeLegacy) {
    const legacy = parseFlatDossier(value)
    if (!legacy) return { ...EMPTY_ENVELOPE }
    return {
      engineering: { dossier: legacy, researchedAt: legacyAt ?? new Date(0) },
      gtm: null,
      operations: null,
    }
  }

  return {
    engineering: parseEngSlot(v.engineering),
    gtm: parseGtmSlot(v.gtm),
    operations: parseOpsSlot(v.operations),
  }
}

// Role → slot mapping per ADR-0005. Product shares the engineering slot
// because they share the pipeline; null (no role resolved) also reads
// engineering by default.
type SlotRole = 'engineering' | 'gtm' | 'operations'
function slotForRole(role: 'engineering' | 'product' | 'gtm' | 'operations' | null): SlotRole {
  if (role === 'gtm') return 'gtm'
  if (role === 'operations') return 'operations'
  // engineering, product, null all read the eng slot
  return 'engineering'
}

// Overloaded so TS narrows the return type to the right dossier shape:
// engineering / product / null → CompanyDossier; gtm → GtmDossier;
// operations → OpsDossier (per slice 3).
export function getDossierSlot(
  envelope: DossierEnvelope,
  role: 'engineering' | 'product' | null,
): CachedRoleSlot<CompanyDossier> | null
export function getDossierSlot(
  envelope: DossierEnvelope,
  role: 'gtm',
): CachedRoleSlot<GtmDossier> | null
export function getDossierSlot(
  envelope: DossierEnvelope,
  role: 'operations',
): CachedRoleSlot<OpsDossier> | null
export function getDossierSlot(
  envelope: DossierEnvelope,
  role: 'engineering' | 'product' | 'gtm' | 'operations' | null,
): CachedRoleSlot<CompanyDossier> | CachedRoleSlot<GtmDossier> | CachedRoleSlot<OpsDossier> | null {
  return envelope[slotForRole(role)]
}

// Returns a new envelope with the target slot replaced. Pure — the input
// envelope is untouched. Used by the cache-write path so concurrent
// research for different roles can't wipe each other's slots.
//
// Overloaded so callers pass the right dossier shape for each role.
export function setDossierSlot(
  envelope: DossierEnvelope,
  role: 'engineering' | 'product' | null,
  slot: CachedRoleSlot<CompanyDossier>,
): DossierEnvelope
export function setDossierSlot(
  envelope: DossierEnvelope,
  role: 'gtm',
  slot: CachedRoleSlot<GtmDossier>,
): DossierEnvelope
export function setDossierSlot(
  envelope: DossierEnvelope,
  role: 'operations',
  slot: CachedRoleSlot<OpsDossier>,
): DossierEnvelope
export function setDossierSlot(
  envelope: DossierEnvelope,
  role: 'engineering' | 'product' | 'gtm' | 'operations' | null,
  slot: CachedRoleSlot<CompanyDossier> | CachedRoleSlot<GtmDossier> | CachedRoleSlot<OpsDossier>,
): DossierEnvelope {
  const key = slotForRole(role)
  return { ...envelope, [key]: slot }
}


// Synthesis step shared by every retrieval provider. The dossier shape is
// the contract; the choice of search vendor is invisible past this boundary.
// Exported so eval harnesses can run synthesis over arbitrary result sets.
export async function synthesizeDossier(
  company: ResearchCompanyInput['company'],
  results: TavilyResult[],
  apiKey: string
): Promise<CompanyDossier> {
  if (results.length === 0) return emptyDossier()
  const text = await callClaude({
    apiKey,
    model: SYNTH_MODEL,
    system: SYNTH_SYSTEM,
    // buildSynthesisPrompt only reads input.company, so a partial input shape
    // is fine — keeps both Tavily and Exa callers out of each other's typing.
    userContent: buildSynthesisPrompt({ company } as ResearchCompanyInput, results),
    // 2048 is comfortable for summary + ~7 surfaces + ~5 launches + ~5 areas.
    // Lower (1024) was observed to truncate JSON mid-array.
    maxTokens: 2048,
  })
  return parseDossier(text)
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
  return synthesizeDossier(input.company, search.results, input.apiKey)
}

export interface ResearchCompanyExaInput {
  company: ResearchCompanyInput['company']
  apiKey: string
  exaApiKey: string | null
  // Days back from now to constrain results. Default 180 — tight enough to
  // privilege recent launches, loose enough that small companies still surface.
  recencyDays?: number
  // Override Exa's per-query routing classifier. Default 'auto'.
  type?: 'neural' | 'keyword' | 'auto'
}

// Exa-backed sibling of researchCompanyDossier. Identical contract: returns
// the same CompanyDossier shape, fails closed to an empty dossier on missing
// key or empty results. The synthesis prompt is shared, so Tavily vs Exa is
// a pure retrieval-quality A/B with no downstream confounds.
export async function researchCompanyDossierExa(
  input: ResearchCompanyExaInput
): Promise<CompanyDossier> {
  if (!input.exaApiKey) return emptyDossier()

  const recencyDays = input.recencyDays ?? 180
  const startDate = new Date(Date.now() - recencyDays * 24 * 60 * 60 * 1000).toISOString()

  const search = await exaSearch({
    query: buildSearchQuery({ company: input.company } as ResearchCompanyInput),
    apiKey: input.exaApiKey,
    numResults: 5,
    type: input.type ?? 'auto',
    startPublishedDate: startDate,
    textMaxCharacters: 2000,
  })

  // ExaResult is a structural superset of TavilyResult ({ title, url, content }
  // shared, plus optional metadata). The synthesis prompt only reads the
  // shared fields, so the cast is safe and avoids a redundant remap.
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
  // Tavily depth when falling back. Defaults to 'advanced' (richer extracts
  // matter more on the long tail where each result is precious).
  tavilySearchDepth?: 'basic' | 'advanced'
}

// Dedupe by canonical URL. Trailing slash + case-insensitive host so
// "https://acme.com/" and "https://Acme.com" collapse. First occurrence wins
// — callers control ordering by which list they pass first.
function dedupeByUrl(items: ExaResult[]): ExaResult[] {
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

// Hybrid retrieval. The Exa layer is itself two-arm:
//   1. /search — third-party coverage, news, launches; brings recency hooks
//   2. /contents — the company's own homepage + /about /team /careers /blog
//                  /product subpages; resolves entity-name collisions where
//                  /search returns competitors (Consus vs Consensus, Multi vs
//                  Microsoft Multi-app, etc.) and grounds the dossier in the
//                  company's actual product description.
// Both run in parallel; results merge with /contents first (so the company's
// own positioning anchors the synthesizer's input). Per the side-by-side at
// .scratch/exa-arms-eval.md, layered recovers dossiers /search alone gets
// wrong (entity collisions) and retains the news that /contents alone misses.
//
// Tavily stays as the final rescue branch: only fires when BOTH Exa calls
// return zero results (long-tail entities the neural index hasn't seen, or
// dead sites). Cost: layered Exa is 2 retrieval calls per first-research,
// but the result caches indefinitely on Company.researchDossier — paid once
// per company, never again unless someone wires a manual refresh path.
export async function researchCompanyDossierHybrid(
  input: ResearchCompanyHybridInput
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
        query: buildSearchQuery({ company } as ResearchCompanyInput),
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
    // Both Exa calls whiffed. Fall through to Tavily — its keyword-matched
    // Google index has wider raw coverage on obscure / dead-site companies.
    console.info(`hybrid retrieval: Exa search+contents returned 0 results for "${company.name}", falling back to Tavily`)
  }

  if (!tavilyApiKey) return emptyDossier()

  const tavilyResults = await tavilySearch({
    query: buildSearchQuery({ company } as ResearchCompanyInput),
    apiKey: tavilyApiKey,
    maxResults: 5,
    searchDepth: input.tavilySearchDepth ?? 'advanced',
  })
  return synthesizeDossier(company, tavilyResults.results, apiKey)
}

// =============================================================================
// GTM pipeline (ADR-0005 slice 2)
// =============================================================================
// GTM cold outreach is structurally different from engineering: hooks are
// "triggers" (recent events that signal motion — funding, exec hires, market
// moves) rather than product surfaces, and the candidate pitch is "proof of
// motion" (deals closed, growth experiments, customer wins) rather than a
// project bridging to a feature. This pipeline therefore has its own dossier
// shape, retrieval targets (press domains instead of company website), and
// picker. See docs/adr/0005-role-shaped-outreach-pipelines.md.

// GTM dossier — what a GTM candidate references when writing cold outreach.
// triggers and recentMoves are kept separate the same way surfaces and
// recentLaunches are in CompanyDossier: triggers are stable signals (Series
// B in the last 6 months, new VP Sales) that establish stage and momentum;
// recentMoves are concrete events to namecheck ("launched RevenueOS",
// "expanded to EMEA"). marketSignals captures industry context the
// candidate can position against (sector growth, competitor activity).
export interface GtmDossier {
  summary: string
  triggers: string[]
  recentMoves: string[]
  marketSignals: string[]
}

function emptyGtmDossier(): GtmDossier {
  return { summary: '', triggers: [], recentMoves: [], marketSignals: [] }
}

export function isEmptyGtmDossier(d: GtmDossier): boolean {
  return (
    d.triggers.length === 0 &&
    d.recentMoves.length === 0 &&
    d.marketSignals.length === 0
  )
}

// Runtime validation for the gtm slot's dossier payload. Mirrors
// parseFlatDossier's contract: returns null on shape failure so callers
// treat as cache miss rather than flowing garbage through.
export function parseGtmDossier(value: unknown): GtmDossier | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const v = value as Record<string, unknown>
  if (typeof v.summary !== 'string') return null
  if (!Array.isArray(v.triggers) || !v.triggers.every(s => typeof s === 'string')) return null
  if (!Array.isArray(v.recentMoves) || !v.recentMoves.every(s => typeof s === 'string')) return null
  if (!Array.isArray(v.marketSignals) || !v.marketSignals.every(s => typeof s === 'string')) return null
  return {
    summary: v.summary,
    triggers: v.triggers as string[],
    recentMoves: v.recentMoves as string[],
    marketSignals: v.marketSignals as string[],
  }
}

// Press allowlist for GTM-shaped retrieval. Small set of high-signal
// business-news domains so Exa lands on press coverage of company events
// (funding rounds, hires, launches with GTM angle) rather than on the
// company's own product pages — which are eng-shaped material. Per
// ADR-0005 decision 3: "press is a small allowlist of high-signal sites
// for the specific question GTM cold outreach is asking."
const GTM_INCLUDE_DOMAINS = [
  'techcrunch.com',
  'businesswire.com',
  'prnewswire.com',
  'venturebeat.com',
  'forbes.com',
  'reuters.com',
  'bloomberg.com',
] as const

function buildGtmSearchQuery(company: ResearchCompanyInput['company']): string {
  // Query format mirrors the eng pattern (name + domain + keyword stem)
  // but trades "product features" for the events-shaped signal list. Exa
  // is keyword-leaning when given concrete event nouns; this gets us
  // press coverage of the specific company.
  const parts = [company.name]
  if (company.domain) parts.push(company.domain)
  parts.push('funding hire market expansion partnership launch')
  return parts.join(' ')
}

const GTM_SYNTH_SYSTEM = `You distill press articles about a company into a structured dossier for GTM cold-email research.

Inputs:
- The company's name and any context the caller already knows
- A list of press articles and news results (title, URL, content snippet)

Output ONLY valid JSON with this exact shape (no prose, no code fences):
{
  "summary": "<one-sentence factual summary of where the company is in its GTM motion (stage, traction, momentum)>",
  "triggers": ["<2-6 recent events that signal motion — funding rounds, exec hires, market expansion, headcount jumps. Short noun phrases, lowercase, no period>"],
  "recentMoves": ["<0-5 concrete strategic moves in the last ~12 months — partnerships, product launches with GTM angle, geographic or segment expansion>"],
  "marketSignals": ["<0-4 industry-level signals the candidate could position against — sector growth, competitor activity, regulatory shifts, category emergence>"]
}

Be specific and dated where possible. "Series B led by Accel in March 2026" is good. "growing fast" is bad. Never name the entire company in a list item.

IMPORTANT — keep triggers and recentMoves strictly separate:
- triggers: stage-defining events that explain *why* the company needs GTM help right now (just raised, just hired VP Sales, just entered new market). The "why now."
- recentMoves: things the company actively shipped or announced (a partnership, a new product line, a geo expansion). The "what they're doing."
If an item is both a trigger and a move, put it in triggers only — not both.

If the search results don't reveal concrete event detail, return empty arrays and an empty summary.`

function buildGtmSynthesisPrompt(
  company: ResearchCompanyInput['company'],
  results: TavilyResult[],
): string {
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

  return [ctx, '', 'Press / news results:', resultsBlock].join('\n')
}

function parseGtmDossierFromText(raw: string): GtmDossier {
  const empty = emptyGtmDossier()
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start < 0 || end <= start) {
    if (raw.trim().length > 0) {
      console.warn('GTM dossier synthesis: no JSON object found in response. Sample:', raw.slice(0, 200))
    }
    return empty
  }
  try {
    const parsed = JSON.parse(raw.slice(start, end + 1)) as Partial<GtmDossier>
    return {
      summary: typeof parsed.summary === 'string' ? stripCitations(parsed.summary) : '',
      triggers: cleanList(parsed.triggers),
      recentMoves: cleanList(parsed.recentMoves),
      marketSignals: cleanList(parsed.marketSignals),
    }
  } catch (err) {
    console.warn('GTM dossier synthesis: JSON parse failed (likely truncated). Sample:', raw.slice(-200), err)
    return empty
  }
}

export async function synthesizeGtmDossier(
  company: ResearchCompanyInput['company'],
  results: TavilyResult[],
  apiKey: string,
): Promise<GtmDossier> {
  if (results.length === 0) return emptyGtmDossier()
  const text = await callClaude({
    apiKey,
    model: SYNTH_MODEL,
    system: GTM_SYNTH_SYSTEM,
    userContent: buildGtmSynthesisPrompt(company, results),
    maxTokens: 2048,
  })
  return parseGtmDossierFromText(text)
}

export interface ResearchCompanyGtmHybridInput {
  company: ResearchCompanyInput['company']
  apiKey: string
  exaApiKey: string | null
  tavilyApiKey: string | null
  recencyDays?: number
  tavilySearchDepth?: 'basic' | 'advanced'
}

// GTM-shaped retrieval. Same hybrid pattern as researchCompanyDossierHybrid
// (Exa first, Tavily fallback on 0 results) but with:
//   - GTM-specific query (events, not product features)
//   - includeDomains restricted to a press allowlist so results are press
//     coverage of company events rather than the company's own pages
// Two arms run in parallel and merge before synthesis:
//   1. /search — press coverage (TechCrunch, BusinessWire, etc.) for funding,
//      hires, market moves. The "external view" of the company.
//   2. /contents — the company's own /blog, /news, /careers subpages.
//      Captures companies whose news lives on their own site rather than
//      in press (Linear's "how we hire" blog, OSS launches without
//      press coverage). Closes the slice-2 LinkedIn-deferral gap by
//      routing the same retrieval shape the ops pipeline uses for
//      org-structure signals.
// Merged with /search first so press takes precedence when both fire —
// press is the higher-signal source for stage and motion. Tavily stays
// as the final rescue branch when both Exa arms whiff.
//
// Tighter recencyDays default (90 days) than the eng pipeline (180 days)
// because GTM triggers decay faster — a Series B announcement is great
// signal at 30 days, stale at 18 months.
export async function researchCompanyDossierGtmHybrid(
  input: ResearchCompanyGtmHybridInput,
): Promise<GtmDossier> {
  const { company, apiKey, exaApiKey, tavilyApiKey } = input
  const recencyDays = input.recencyDays ?? 90

  if (exaApiKey) {
    const startDate = new Date(Date.now() - recencyDays * 24 * 60 * 60 * 1000).toISOString()
    const url = company.domain
      ? (company.domain.startsWith('http') ? company.domain : `https://${company.domain}`)
      : null

    const [searchResp, contentsResp] = await Promise.all([
      exaSearch({
        query: buildGtmSearchQuery(company),
        apiKey: exaApiKey,
        numResults: 5,
        type: 'auto',
        startPublishedDate: startDate,
        textMaxCharacters: 2000,
        includeDomains: [...GTM_INCLUDE_DOMAINS],
      }),
      url
        ? exaContents({
            urls: [url],
            apiKey: exaApiKey,
            subpageTarget: ['blog', 'news', 'careers', 'press'],
            subpages: 5,
            livecrawl: 'auto',
            textMaxCharacters: 2000,
          })
        : Promise.resolve({ results: [] as ExaResult[] }),
    ])

    const merged = dedupeByUrl([...searchResp.results, ...contentsResp.results])
    if (merged.length > 0) {
      return synthesizeGtmDossier(company, merged, apiKey)
    }
    console.info(
      `GTM hybrid retrieval: Exa search+contents returned 0 results for "${company.name}", falling back to Tavily`,
    )
  }

  if (!tavilyApiKey) return emptyGtmDossier()

  // Tavily fallback — no domain filter (Tavily doesn't restrict as cleanly)
  // but the GTM-shaped query alone usually surfaces relevant material on the
  // long-tail companies Exa missed.
  const tavilyResults = await tavilySearch({
    query: buildGtmSearchQuery(company),
    apiKey: tavilyApiKey,
    maxResults: 5,
    searchDepth: input.tavilySearchDepth ?? 'advanced',
  })
  return synthesizeGtmDossier(company, tavilyResults.results, apiKey)
}

export interface PickGtmAngleInput {
  dossier: GtmDossier
  resumeText: string | null
  apiKey: string
}

export interface GtmAngleResult {
  triggerLine: string | null
  proofOfMotion: string | null
}

const GTM_PICK_SYSTEM = `You pick the single best (trigger, proof-of-motion) PAIR for a GTM cold-email candidate.

Inputs:
- A GTM research dossier (the company's recent triggers, strategic moves, and market signals)
- The candidate's resume

This is ONE coupled decision, not two independent ones. Search the cross-product of dossier triggers × resume GTM credentials and return the strongest matching pair:
- PROOF is the specific GTM credential from the resume that establishes the candidate's relevance
- TRIGGER is the dossier event that THIS proof-of-motion most directly speaks to

Prefer TRIGGER from triggers (stage-defining events) over recentMoves (active shipping). A trigger explains why the company needs the candidate's kind of help right now; a recent move just tells them what the company is doing. Only fall back to recentMoves when no trigger plausibly matches the chosen PROOF.

Grounding rules for PROOF — keep it grounded in the resume, but use what the resume actually has:
- Must anchor on something concrete: a named deal, customer segment sold to, growth metric, campaign, partnership, role at a company at a comparable stage, or GTM function owned. Use the resume's own words where natural.
- Do NOT invent traction the resume doesn't mention. If the resume only lists "Account Executive at Acme covering mid-market SaaS," "my mid-market AE work at Acme" is fine. "$10M in pipeline" would be forbidden if "$10M" isn't on the resume.
- Avoid pure stand-ins like "my sales background" or "my GTM experience" — anchor on a specific element from the resume even when that's a role or segment rather than a flagship deal.
- Output PROOF: NONE only when the resume genuinely has no GTM-shaped element to anchor on. A weak-but-grounded proof is better than NONE.

Output EXACTLY two lines, nothing else:
TRIGGER: <a short noun phrase from or grounded in the dossier triggers, lowercase, no period>
PROOF: <must start with "my " and read as a noun phrase>

Format examples for PROOF:
  "my mid-market AE work at Acme"                        // named role + segment
  "my pipeline build at the YC fintech"                  // named work + stage match
  "my outbound campaigns that drove $240k ARR in Q1"     // grounded number from resume
  "my partner-channel motion at Stripe"                  // named channel + company
The proof phrase has to grammatically slot into "For context, <PROOF> is the closest analog to what your team is building toward." If "For context, [your phrasing] is the closest analog..." doesn't read as a complete English sentence, rewrite.

Output TRIGGER: NONE only if no dossier trigger plausibly fits the chosen PROOF.
Output PROOF: NONE only when the resume has no concrete GTM element to anchor on — when PROOF is NONE, still pick the most relevant TRIGGER if one exists. The opener can stand alone.`

function buildGtmPickPrompt(input: PickGtmAngleInput): string {
  const d = input.dossier
  const lines = [
    'GTM dossier:',
    d.summary ? `Summary: ${d.summary}` : null,
    d.triggers.length ? `Triggers: ${d.triggers.join('; ')}` : null,
    d.recentMoves.length ? `Recent moves: ${d.recentMoves.join('; ')}` : null,
    d.marketSignals.length ? `Market signals: ${d.marketSignals.join('; ')}` : null,
    '',
    'Candidate resume (full):',
    input.resumeText ?? '(no resume provided)',
  ].filter(line => line !== null)
  return lines.join('\n')
}

// Per-recipient personalization for GTM drafts. Token-only — no search.
export async function pickGtmAngle(input: PickGtmAngleInput): Promise<GtmAngleResult> {
  if (isEmptyGtmDossier(input.dossier)) {
    return { triggerLine: null, proofOfMotion: null }
  }

  const text = await callClaude({
    apiKey: input.apiKey,
    model: SYNTH_MODEL,
    system: GTM_PICK_SYSTEM,
    userContent: buildGtmPickPrompt(input),
    maxTokens: 256,
  })

  console.log('[pickGtmAngle] raw output:', text)
  return {
    triggerLine: parseLine(text, 'TRIGGER'),
    proofOfMotion: parseLine(text, 'PROOF'),
  }
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
    // model's echo: if the model drifts (rephrases, adds punctuation), we
    // still emit the exact user-selected string for clean merge-tag
    // substitution downstream.
    featureLine: forced ?? parseLine(text, 'FEATURE'),
    fitAngle: parseLine(text, 'FIT'),
  }
}

// =============================================================================
// Operations pipeline (ADR-0005 slice 3)
// =============================================================================
// Ops cold outreach is shaped around the company's org inflection rather
// than its product surfaces or GTM motion. Hook is an "operational
// inflection" (team-size jump, hiring pace, recent funding without an
// ops hire, role/title gap inferred from /team or /careers). Pitch is a
// "relevant system built" (scaled team from N to M, stood up the first
// hiring pipeline, ran the close, owned the org rollout). The bridge is
// a stage match — "you're at the inflection where this becomes critical,
// and I built the system that handles it." See ADR-0005 decision 1.
//
// Retrieval shape differs from both eng (Exa /search + /contents on
// company subpages) and GTM (Exa /search with press includeDomains):
// ops is best read from the company's own /careers, /team, /about,
// /jobs subpages — that's where org structure and hiring posture live.
// Single /contents call, Tavily fallback.

export interface OpsDossier {
  summary: string
  // Stage-defining org events / signals — funding rounds, headcount
  // jumps inferred from team page count or open-role pace, missing
  // functions visible in the org chart.
  inflections: string[]
  // Notable leadership / key hires visible on /team or in press.
  recentHires: string[]
  // Currently-open roles that signal where the org is scaling.
  openRoles: string[]
}

function emptyOpsDossier(): OpsDossier {
  return { summary: '', inflections: [], recentHires: [], openRoles: [] }
}

export function isEmptyOpsDossier(d: OpsDossier): boolean {
  return (
    d.inflections.length === 0 &&
    d.recentHires.length === 0 &&
    d.openRoles.length === 0
  )
}

export function parseOpsDossier(value: unknown): OpsDossier | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const v = value as Record<string, unknown>
  if (typeof v.summary !== 'string') return null
  if (!Array.isArray(v.inflections) || !v.inflections.every(s => typeof s === 'string')) return null
  if (!Array.isArray(v.recentHires) || !v.recentHires.every(s => typeof s === 'string')) return null
  if (!Array.isArray(v.openRoles) || !v.openRoles.every(s => typeof s === 'string')) return null
  return {
    summary: v.summary,
    inflections: v.inflections as string[],
    recentHires: v.recentHires as string[],
    openRoles: v.openRoles as string[],
  }
}

const OPS_SYNTH_SYSTEM = `You distill a company's /careers, /team, /about, and /jobs pages into a structured dossier for operations cold-email research.

Inputs:
- The company's name and any context the caller already knows
- A list of subpages (title, URL, content snippet) drawn from the company's own /careers, /team, /about, and /jobs

Output ONLY valid JSON with this exact shape (no prose, no code fences):
{
  "summary": "<one-sentence factual snapshot of where the company is in its org build (stage, team size if visible, hiring posture)>",
  "inflections": ["<2-5 operational inflection signals — funding round at a no-ops stage, visible team-size jump, missing function (no head of X visible), hiring pace observation. Short noun phrases, lowercase, no period>"],
  "recentHires": ["<0-5 notable leadership or key hires visible on /team or in press — name + title format, e.g. 'Jane Doe as VP Engineering'>"],
  "openRoles": ["<0-7 currently-open roles that signal where the org is scaling. Title only, no salary or location. Prefer roles that hint at function gaps (e.g. 'Head of People', 'first Finance hire', 'Chief of Staff')>"]
}

Be specific. "Hiring 5 engineers and a first Head of People — no current finance leader visible" is good. "Growing fast" is bad. Never name the entire company in a list item.

IMPORTANT — keep inflections distinct from openRoles:
- inflections: the why-now (stage, scale, gap). The model's interpretation of what the company's hiring posture signals about its current operational state.
- openRoles: the literal job posts. Concrete listings the candidate could anchor a pitch to.

If the search results don't reveal concrete org detail, return empty arrays and an empty summary.`

function buildOpsSynthesisPrompt(
  company: ResearchCompanyInput['company'],
  results: TavilyResult[],
): string {
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

  return [ctx, '', 'Company subpages (/careers, /team, /about, /jobs):', resultsBlock].join('\n')
}

function parseOpsDossierFromText(raw: string): OpsDossier {
  const empty = emptyOpsDossier()
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start < 0 || end <= start) {
    if (raw.trim().length > 0) {
      console.warn('Ops dossier synthesis: no JSON object found in response. Sample:', raw.slice(0, 200))
    }
    return empty
  }
  try {
    const parsed = JSON.parse(raw.slice(start, end + 1)) as Partial<OpsDossier>
    return {
      summary: typeof parsed.summary === 'string' ? stripCitations(parsed.summary) : '',
      inflections: cleanList(parsed.inflections),
      recentHires: cleanList(parsed.recentHires),
      openRoles: cleanList(parsed.openRoles),
    }
  } catch (err) {
    console.warn('Ops dossier synthesis: JSON parse failed (likely truncated). Sample:', raw.slice(-200), err)
    return empty
  }
}

export async function synthesizeOpsDossier(
  company: ResearchCompanyInput['company'],
  results: TavilyResult[],
  apiKey: string,
): Promise<OpsDossier> {
  if (results.length === 0) return emptyOpsDossier()
  const text = await callClaude({
    apiKey,
    model: SYNTH_MODEL,
    system: OPS_SYNTH_SYSTEM,
    userContent: buildOpsSynthesisPrompt(company, results),
    maxTokens: 2048,
  })
  return parseOpsDossierFromText(text)
}

export interface ResearchCompanyOpsHybridInput {
  company: ResearchCompanyInput['company']
  apiKey: string
  exaApiKey: string | null
  tavilyApiKey: string | null
  tavilySearchDepth?: 'basic' | 'advanced'
}

// Ops-shaped retrieval. Hits the company's own /careers, /team, /about,
// /jobs subpages via Exa /contents. No /search arm — funding events are
// a weaker ops signal than current org structure visible in hiring posts.
// Tavily fallback fires on two conditions:
//   1. Exa /contents returns zero subpages (small or new companies)
//   2. Synthesis produces an empty dossier from non-zero subpages (thin
//      /careers content — the "Notion problem" surfaced in the slice 3
//      smoke and called out by Codex)
// Condition 2 was added in slice 4 — without it, a company with a thin
// /about page would silently produce a weak dossier (zero inflections /
// recentHires / openRoles) and the draft would have no operational
// anchor, with no signal to the caller.
//
// No recencyDays filter on the contents arm — org structure is what's
// currently visible, not date-bounded. The Tavily fallback is also
// undated; org structure is a today-snapshot.
export async function researchCompanyDossierOpsHybrid(
  input: ResearchCompanyOpsHybridInput,
): Promise<OpsDossier> {
  const { company, apiKey, exaApiKey, tavilyApiKey } = input

  if (exaApiKey && company.domain) {
    const url = company.domain.startsWith('http') ? company.domain : `https://${company.domain}`
    const contentsResp = await exaContents({
      urls: [url],
      apiKey: exaApiKey,
      subpageTarget: ['careers', 'team', 'about', 'jobs'],
      subpages: 8,
      livecrawl: 'auto',
      textMaxCharacters: 2000,
    })

    if (contentsResp.results.length > 0) {
      const opsDossier = await synthesizeOpsDossier(company, contentsResp.results, apiKey)
      // Thin-content detection: if the company's own subpages exist but
      // are sparse enough that synthesis extracted no ops signals, fall
      // through to Tavily. Skip the fallback if Tavily isn't configured —
      // shipping the empty dossier is better than throwing.
      if (!isEmptyOpsDossier(opsDossier) || !tavilyApiKey) {
        return opsDossier
      }
      console.info(
        `Ops hybrid retrieval: Exa /contents produced empty dossier for "${company.name}" (thin subpages), falling back to Tavily`,
      )
    } else {
      console.info(
        `Ops hybrid retrieval: Exa /contents returned 0 subpages for "${company.name}", falling back to Tavily`,
      )
    }
  }

  if (!tavilyApiKey) return emptyOpsDossier()

  // Tavily fallback — broader keyword query that should surface careers
  // and team pages even when /contents subpage routing whiffs.
  const tavilyQuery = [
    company.name,
    company.domain,
    'careers team hiring jobs',
  ]
    .filter(Boolean)
    .join(' ')
  const tavilyResults = await tavilySearch({
    query: tavilyQuery,
    apiKey: tavilyApiKey,
    maxResults: 5,
    searchDepth: input.tavilySearchDepth ?? 'advanced',
  })
  return synthesizeOpsDossier(company, tavilyResults.results, apiKey)
}

export interface PickOpsAngleInput {
  dossier: OpsDossier
  resumeText: string | null
  apiKey: string
}

export interface OpsAngleResult {
  inflectionLine: string | null
  systemBuilt: string | null
}

const OPS_PICK_SYSTEM = `You pick the single best (inflection, system-built) PAIR for an operations cold-email candidate.

Inputs:
- An operations research dossier (the company's current inflection signals, recent hires, open roles)
- The candidate's resume

This is ONE coupled decision, not two independent ones. Search the cross-product of dossier inflections × resume operational credentials and return the strongest matching pair:
- SYSTEM is the specific operational system the candidate has built that establishes their relevance
- INFLECTION is the dossier signal that THIS system most directly speaks to

Prefer INFLECTION from inflections (stage-defining org states) over openRoles (literal listings) and recentHires (proof points). Inflections explain *why* the company needs operational help right now; open roles just describe what they're hiring for; recent hires describe what they've already done. Only fall back to openRoles when no inflection plausibly matches the chosen SYSTEM.

Grounding rules for SYSTEM — keep it grounded in the resume, but use what the resume actually has:
- Must anchor on something concrete: a named function the candidate stood up, a hiring or close process they owned, a team they scaled, a system they rolled out (ATS, performance review, billing, finance close), a Chief of Staff or BizOps function they held, an operating-cadence they ran. Use the resume's own words where natural.
- Do NOT invent scale the resume doesn't mention. If the resume only lists "Chief of Staff to CEO at a 30-person seed startup," "my Chief of Staff role at a seed startup" is fine. "$5M finance close" would be forbidden if "$5M" isn't on the resume.
- Avoid pure stand-ins like "my ops background" or "my operational experience" — anchor on a specific element from the resume even when that's a role or function rather than a flagship system.
- Output SYSTEM: NONE only when the resume genuinely has no operational-shaped element to anchor on. A weak-but-grounded system is better than NONE.

Output EXACTLY two lines, nothing else:
INFLECTION: <a short noun phrase from or grounded in the dossier inflections, lowercase, no period>
SYSTEM: <must start with "my " and read as a noun phrase>

Format examples for SYSTEM:
  "my Chief of Staff role at the YC seed-stage company"        // named role + stage
  "my first-Head-of-People build at the 12-person SaaS"        // function + scale from resume
  "my hiring pipeline that scaled eng from 4 to 14"            // grounded numbers from resume
  "my operating cadence at the post-Series-A consumer startup" // named process + stage
The system phrase has to grammatically slot into "For context, <SYSTEM> is the closest analog to what your team is building toward." If "For context, [your phrasing] is the closest analog..." doesn't read as a complete English sentence, rewrite.

Output INFLECTION: NONE only if no dossier inflection plausibly fits the chosen SYSTEM.
Output SYSTEM: NONE only when the resume has no concrete operational element to anchor on — when SYSTEM is NONE, still pick the most relevant INFLECTION if one exists. The opener can stand alone.`

function buildOpsPickPrompt(input: PickOpsAngleInput): string {
  const d = input.dossier
  const lines = [
    'Ops dossier:',
    d.summary ? `Summary: ${d.summary}` : null,
    d.inflections.length ? `Inflections: ${d.inflections.join('; ')}` : null,
    d.recentHires.length ? `Recent hires: ${d.recentHires.join('; ')}` : null,
    d.openRoles.length ? `Open roles: ${d.openRoles.join('; ')}` : null,
    '',
    'Candidate resume (full):',
    input.resumeText ?? '(no resume provided)',
  ].filter(line => line !== null)
  return lines.join('\n')
}

// Per-recipient personalization for ops drafts. Token-only — no search.
export async function pickOpsAngle(input: PickOpsAngleInput): Promise<OpsAngleResult> {
  if (isEmptyOpsDossier(input.dossier)) {
    return { inflectionLine: null, systemBuilt: null }
  }

  const text = await callClaude({
    apiKey: input.apiKey,
    model: SYNTH_MODEL,
    system: OPS_PICK_SYSTEM,
    userContent: buildOpsPickPrompt(input),
    maxTokens: 256,
  })

  console.log('[pickOpsAngle] raw output:', text)
  return {
    inflectionLine: parseLine(text, 'INFLECTION'),
    systemBuilt: parseLine(text, 'SYSTEM'),
  }
}
