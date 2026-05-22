// Exa search HTTP wrapper. Drop-in alternative to tavily-search.ts: same
// graded failure model, same TavilyResult-compatible shape, so the dossier
// synthesis step can consume either provider's output unchanged.
//
// Why Exa as a second retrieval option:
//   - Date filtering (startPublishedDate) — cold email needs recency, and
//     Tavily has no native window control.
//   - Neural ranking via 'type: auto' for descriptive queries; keyword for
//     proper-noun lookups. The classifier routes per-query.
//   - Inline content extraction (contents.text) so we don't need a separate
//     /contents call to get readable page text.

const EXA_URL = 'https://api.exa.ai/search'

export interface ExaResult {
  title: string
  url: string
  content: string
  publishedDate: string | null
  score: number | null
}

export interface ExaSearchInput {
  query: string
  apiKey: string
  numResults?: number
  // 'auto' lets Exa's classifier route between neural and keyword per query.
  // Right default for mixed queries that contain both a proper noun and a
  // descriptive concept (e.g., "<Company> recent launch").
  type?: 'neural' | 'keyword' | 'auto'
  // ISO 8601 date filter — only return pages published on/after this date.
  // Caller passes ~180 days back for cold-email recency.
  startPublishedDate?: string
  endPublishedDate?: string
  // Per-result text cap. 2000 chars matches Tavily 'advanced' depth.
  textMaxCharacters?: number
  // Exa rewrites the query for better neural retrieval when true. Useful for
  // descriptive queries, can hurt for strict named-entity lookups.
  useAutoprompt?: boolean
  includeDomains?: string[]
  // Exa server-side filter — restricts results to a category. 'company' is the
  // useful one for the ingest-discovery script (skips news/blog/encyclopedia
  // pages); other valid values per Exa docs include 'research paper', 'news',
  // 'linkedin profile', 'github', 'tweet', 'movie', 'song', 'personal site',
  // 'pdf', 'financial report'.
  category?: string
}

export interface ExaSearchResponse {
  results: ExaResult[]
  // Echoed back when useAutoprompt rewrote the query — useful for the demo
  // script to show "what Exa actually searched for."
  autopromptString?: string | null
}

interface RawExaResult {
  title?: unknown
  url?: unknown
  text?: unknown
  highlights?: unknown
  publishedDate?: unknown
  score?: unknown
}

function asString(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null
}

// Prefer full text when present; fall back to highlights joined; else empty.
// Returning empty content with a valid title+url is still useful — the
// synthesis prompt can decide if there's enough signal to cite.
function extractContent(r: RawExaResult): string {
  const text = asString(r.text)
  if (text) return text
  if (Array.isArray(r.highlights)) {
    return r.highlights.filter((h): h is string => typeof h === 'string').join(' … ')
  }
  return ''
}

function normalize(raw: unknown): ExaResult | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as RawExaResult
  const title = asString(r.title)
  const url = asString(r.url)
  if (!title || !url) return null
  return {
    title,
    url,
    content: extractContent(r),
    publishedDate: asString(r.publishedDate),
    score: typeof r.score === 'number' ? r.score : null,
  }
}

// Failure handling mirrors tavily-search.ts:
//   - 401/403 → throw, so misconfiguration is loud.
//   - 5xx, network, JSON parse → log + return empty, so a flaky upstream
//     doesn't block email drafts.
//   - 200 with no results → silent empty (normal "found nothing" outcome).
export async function exaSearch(input: ExaSearchInput): Promise<ExaSearchResponse> {
  const body: Record<string, unknown> = {
    query: input.query,
    numResults: input.numResults ?? 5,
    type: input.type ?? 'auto',
    contents: {
      text: { maxCharacters: input.textMaxCharacters ?? 2000 },
      highlights: { numSentences: 3, highlightsPerUrl: 2 },
    },
  }
  if (input.startPublishedDate) body.startPublishedDate = input.startPublishedDate
  if (input.endPublishedDate) body.endPublishedDate = input.endPublishedDate
  if (input.useAutoprompt !== undefined) body.useAutoprompt = input.useAutoprompt
  if (input.includeDomains && input.includeDomains.length > 0) {
    body.includeDomains = input.includeDomains
  }
  if (input.category) body.category = input.category

  let resp: Response
  try {
    resp = await fetch(EXA_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': input.apiKey,
      },
      body: JSON.stringify(body),
    })
  } catch (err) {
    console.warn('Exa search network error:', err)
    return { results: [] }
  }

  if (resp.status === 401 || resp.status === 403) {
    const text = await resp.text().catch(() => '')
    throw new Error(`Exa API ${resp.status}: ${text || 'auth failed — check EXA_API_KEY'}`)
  }

  if (!resp.ok) {
    const text = await resp.text().catch(() => '')
    console.warn(`Exa search ${resp.status}:`, text)
    return { results: [] }
  }

  let data: { results?: unknown[]; autopromptString?: unknown }
  try {
    data = (await resp.json()) as { results?: unknown[]; autopromptString?: unknown }
  } catch (err) {
    console.warn('Exa response JSON parse error:', err)
    return { results: [] }
  }

  const results = Array.isArray(data.results)
    ? data.results.map(normalize).filter((r): r is ExaResult => r !== null)
    : []
  return {
    results,
    autopromptString: typeof data.autopromptString === 'string' ? data.autopromptString : null,
  }
}

// Exa /findSimilar — given a seed URL, return canonical company pages that
// are semantically similar. Same response shape as exaSearch so the discovery
// ingest script can reuse parseIndustry/parseOneLiner. Used by
// scripts/discover-exa-deep.ts to expand the DB beyond what VC portfolio
// scrapes can reach.
export interface ExaFindSimilarInput {
  url: string
  apiKey: string
  numResults?: number
  category?: string
  textMaxCharacters?: number
  excludeDomains?: string[]
  // Skip results from the seed's own host. Exa's docs flag this as a common
  // ask; without it /findSimilar can surface the seed's own subpages.
  excludeSourceDomain?: boolean
}

export async function exaFindSimilar(input: ExaFindSimilarInput): Promise<ExaSearchResponse> {
  const body: Record<string, unknown> = {
    url: input.url,
    numResults: input.numResults ?? 10,
    contents: {
      text: { maxCharacters: input.textMaxCharacters ?? 800 },
    },
  }
  if (input.category) body.category = input.category
  if (input.excludeDomains && input.excludeDomains.length > 0) {
    body.excludeDomains = input.excludeDomains
  }
  if (input.excludeSourceDomain) body.excludeSourceDomain = true

  let resp: Response
  try {
    resp = await fetch('https://api.exa.ai/findSimilar', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': input.apiKey },
      body: JSON.stringify(body),
    })
  } catch (err) {
    console.warn('Exa /findSimilar network error:', err)
    return { results: [] }
  }

  if (resp.status === 401 || resp.status === 403) {
    const text = await resp.text().catch(() => '')
    throw new Error(`Exa /findSimilar ${resp.status}: ${text || 'auth failed — check EXA_API_KEY'}`)
  }

  if (!resp.ok) {
    const text = await resp.text().catch(() => '')
    console.warn(`Exa /findSimilar ${resp.status}:`, text)
    return { results: [] }
  }

  let data: { results?: unknown[] }
  try {
    data = (await resp.json()) as { results?: unknown[] }
  } catch (err) {
    console.warn('Exa /findSimilar JSON parse error:', err)
    return { results: [] }
  }

  const results = Array.isArray(data.results)
    ? data.results.map(normalize).filter((r): r is ExaResult => r !== null)
    : []
  return { results }
}

// Exa /contents — fetch cleaned text/highlights for URLs you already have,
// without burning a search-credit on retrieval. Pair with subpageTarget to
// pick up /about, /team, /careers etc. in one shot. Returns the same
// ExaResult shape as exaSearch so synthesizeDossier can consume it unchanged.
export interface ExaContentsInput {
  urls: string[]
  apiKey: string
  textMaxCharacters?: number
  // Names of subpages to also crawl (e.g. ['about', 'team', 'careers']).
  subpageTarget?: string[]
  // Max number of subpages per URL to return.
  subpages?: number
  // 'auto' lets Exa decide cache-vs-live; 'always' forces a fresh fetch.
  livecrawl?: 'auto' | 'always' | 'never' | 'preferred' | 'fallback'
}

export async function exaContents(input: ExaContentsInput): Promise<ExaSearchResponse> {
  const body: Record<string, unknown> = {
    urls: input.urls,
    text: { maxCharacters: input.textMaxCharacters ?? 2000 },
    highlights: { numSentences: 3, highlightsPerUrl: 2 },
  }
  if (input.subpages !== undefined) body.subpages = input.subpages
  if (input.subpageTarget && input.subpageTarget.length > 0) {
    body.subpageTarget = input.subpageTarget
  }
  if (input.livecrawl) body.livecrawl = input.livecrawl

  let resp: Response
  try {
    resp = await fetch('https://api.exa.ai/contents', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': input.apiKey },
      body: JSON.stringify(body),
    })
  } catch (err) {
    console.warn('Exa contents network error:', err)
    return { results: [] }
  }

  if (resp.status === 401 || resp.status === 403) {
    const text = await resp.text().catch(() => '')
    throw new Error(`Exa /contents ${resp.status}: ${text || 'auth failed'}`)
  }

  if (!resp.ok) {
    const text = await resp.text().catch(() => '')
    console.warn(`Exa /contents ${resp.status}:`, text)
    return { results: [] }
  }

  let data: { results?: unknown[] }
  try {
    data = (await resp.json()) as { results?: unknown[] }
  } catch (err) {
    console.warn('Exa /contents JSON parse error:', err)
    return { results: [] }
  }

  // /contents returns subpages nested under each top-level result. Flatten so
  // the synthesizer sees one uniform list of pages rather than a tree.
  const flat: ExaResult[] = []
  if (Array.isArray(data.results)) {
    for (const raw of data.results) {
      const top = normalize(raw)
      if (top) flat.push(top)
      const subs = (raw as { subpages?: unknown[] })?.subpages
      if (Array.isArray(subs)) {
        for (const sub of subs) {
          const s = normalize(sub)
          if (s) flat.push(s)
        }
      }
    }
  }
  return { results: flat }
}
