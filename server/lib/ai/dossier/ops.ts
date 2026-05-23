import { callClaude } from '../anthropic.js'
import { tavilySearch, type TavilyResult } from '../tavily-search.js'
import { exaContents } from '../exa-search.js'
import {
  SYNTH_MODEL,
  cleanList,
  parseDossierJson,
  parseLine,
  stripCitations,
  type ResearchCompanyInput,
} from './shared.js'

// Operations pipeline (ADR-0005 slice 3). Ops cold outreach is shaped
// around the company's org inflection rather than its product surfaces
// or GTM motion. Hook is an "operational inflection" (team-size jump,
// hiring pace, recent funding without an ops hire, role/title gap
// inferred from /team or /careers). Pitch is a "relevant system built"
// (scaled team from N to M, stood up the first hiring pipeline, ran
// the close, owned the org rollout). The bridge is a stage match —
// "you're at the inflection where this becomes critical, and I built
// the system that handles it." See ADR-0005 decision 1.
//
// Retrieval shape differs from both eng (Exa /search + /contents on
// company subpages) and GTM (Exa /search with press includeDomains):
// ops is best read from the company's own /careers, /team, /about,
// /jobs subpages — that's where org structure and hiring posture
// live. Single /contents call, Tavily fallback.

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
  return parseDossierJson(
    raw,
    emptyOpsDossier(),
    parsed => ({
      summary: typeof parsed.summary === 'string' ? stripCitations(parsed.summary) : '',
      inflections: cleanList(parsed.inflections),
      recentHires: cleanList(parsed.recentHires),
      openRoles: cleanList(parsed.openRoles),
    }),
    'Ops dossier synthesis',
  )
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
// /jobs subpages via Exa /contents. No /search arm — funding events
// are a weaker ops signal than current org structure visible in hiring
// posts. Tavily fallback fires on two conditions:
//   1. Exa /contents returns zero subpages (small or new companies)
//   2. Synthesis produces an empty dossier from non-zero subpages
//      (thin /careers content — the "Notion problem" surfaced in the
//      slice 3 smoke and called out by Codex)
// Condition 2 was added in slice 4 — without it, a company with a thin
// /about page would silently produce a weak dossier (zero inflections
// / recentHires / openRoles) and the draft would have no operational
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
      // through to Tavily. Skip the fallback if Tavily isn't configured
      // — shipping the empty dossier is better than throwing.
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
  // Set by the change-angle path when the user has picked an INFLECTION
  // in the UI; the picker echoes it back verbatim and only re-derives
  // SYSTEM. Mirrors forceFeatureLine on PickFitAngleInput.
  forceInflectionLine?: string | null
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

Prefer positive inflections (active events, visible scale, named transitions like "Series D + AI agent launches") over negative inferences (things missing from public pages, like "no visible Head of People"). Negative inferences can come across as presumptuous in cold outreach — the candidate is guessing at org gaps from absence rather than referencing a real signal. Only pick a negative-inference inflection when the dossier has no positive inflection that plausibly matches the chosen SYSTEM.

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
  const forced = input.forceInflectionLine?.trim() || null
  const lines = [
    'Ops dossier:',
    d.summary ? `Summary: ${d.summary}` : null,
    d.inflections.length ? `Inflections: ${d.inflections.join('; ')}` : null,
    d.recentHires.length ? `Recent hires: ${d.recentHires.join('; ')}` : null,
    d.openRoles.length ? `Open roles: ${d.openRoles.join('; ')}` : null,
    '',
    'Candidate resume (full):',
    input.resumeText ?? '(no resume provided)',
    forced ? '' : null,
    // The user has explicitly chosen INFLECTION in the UI. Echo it back
    // verbatim and pick only SYSTEM to bridge to it. Mirrors the eng
    // forceFeatureLine path in buildPickPrompt.
    forced ? `INFLECTION is fixed: "${forced}". Output INFLECTION: "${forced}" exactly, then pick SYSTEM that bridges most directly to that inflection.` : null,
  ].filter(line => line !== null)
  return lines.join('\n')
}

// Per-recipient personalization for ops drafts. Token-only — no search.
export async function pickOpsAngle(input: PickOpsAngleInput): Promise<OpsAngleResult> {
  if (isEmptyOpsDossier(input.dossier)) {
    return { inflectionLine: input.forceInflectionLine?.trim() || null, systemBuilt: null }
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
