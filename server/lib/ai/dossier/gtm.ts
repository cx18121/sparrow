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

// GTM pipeline (ADR-0005 slice 2). GTM cold outreach is structurally
// different from engineering: hooks are "triggers" (recent events that
// signal motion — funding, exec hires, market moves) rather than
// product surfaces, and the candidate pitch is "proof of motion"
// (deals closed, growth experiments, customer wins) rather than a
// project bridging to a feature. Hence its own dossier shape,
// retrieval targets (press domains instead of company website), and
// picker. See docs/adr/0005-role-shaped-outreach-pipelines.md.

// GTM dossier — what a GTM candidate references when writing cold
// outreach. triggers and recentMoves are kept separate the same way
// surfaces and recentLaunches are in CompanyDossier: triggers are
// stable signals (Series B in the last 6 months, new VP Sales) that
// establish stage and momentum; recentMoves are concrete events to
// namecheck ("launched RevenueOS", "expanded to EMEA"). marketSignals
// captures industry context the candidate can position against
// (sector growth, competitor activity).
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
// business-news domains so Exa lands on press coverage of company
// events (funding rounds, hires, launches with GTM angle) rather than
// on the company's own product pages — which are eng-shaped material.
// Per ADR-0005 decision 3: "press is a small allowlist of high-signal
// sites for the specific question GTM cold outreach is asking."
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
  return parseDossierJson(
    raw,
    emptyGtmDossier(),
    parsed => ({
      summary: typeof parsed.summary === 'string' ? stripCitations(parsed.summary) : '',
      triggers: cleanList(parsed.triggers),
      recentMoves: cleanList(parsed.recentMoves),
      marketSignals: cleanList(parsed.marketSignals),
    }),
    'GTM dossier synthesis',
  )
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
//   1. /search — press coverage (TechCrunch, BusinessWire, etc.) for
//      funding, hires, market moves. The "external view" of the company.
//   2. /contents — the company's own /blog, /news, /careers subpages.
//      Captures companies whose news lives on their own site rather
//      than in press (Linear's "how we hire" blog, OSS launches
//      without press coverage). Closes the slice-2 LinkedIn-deferral
//      gap by routing the same retrieval shape the ops pipeline uses
//      for org-structure signals.
// Merged with /search first so press takes precedence when both fire —
// press is the higher-signal source for stage and motion. Tavily stays
// as the final rescue branch when both Exa arms whiff.
//
// Tighter recencyDays default (90 days) than the eng pipeline (180
// days) because GTM triggers decay faster — a Series B announcement is
// great signal at 30 days, stale at 18 months.
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

  // Tavily fallback — no domain filter (Tavily doesn't restrict as
  // cleanly) but the GTM-shaped query alone usually surfaces relevant
  // material on the long-tail companies Exa missed.
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
  // Set by the change-angle path when the user has picked a TRIGGER in
  // the UI; the picker echoes it back verbatim and only re-derives
  // PROOF. Mirrors forceFeatureLine on PickFitAngleInput.
  forceTriggerLine?: string | null
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
  const forced = input.forceTriggerLine?.trim() || null
  const lines = [
    'GTM dossier:',
    d.summary ? `Summary: ${d.summary}` : null,
    d.triggers.length ? `Triggers: ${d.triggers.join('; ')}` : null,
    d.recentMoves.length ? `Recent moves: ${d.recentMoves.join('; ')}` : null,
    d.marketSignals.length ? `Market signals: ${d.marketSignals.join('; ')}` : null,
    '',
    'Candidate resume (full):',
    input.resumeText ?? '(no resume provided)',
    forced ? '' : null,
    // The user has explicitly chosen TRIGGER in the UI. Echo it back
    // verbatim and pick only PROOF to bridge to it. Mirrors the eng
    // forceFeatureLine path in buildPickPrompt.
    forced ? `TRIGGER is fixed: "${forced}". Output TRIGGER: "${forced}" exactly, then pick PROOF that bridges most directly to that trigger.` : null,
  ].filter(line => line !== null)
  return lines.join('\n')
}

// Per-recipient personalization for GTM drafts. Token-only — no search.
export async function pickGtmAngle(input: PickGtmAngleInput): Promise<GtmAngleResult> {
  if (isEmptyGtmDossier(input.dossier)) {
    return { triggerLine: input.forceTriggerLine?.trim() || null, proofOfMotion: null }
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
