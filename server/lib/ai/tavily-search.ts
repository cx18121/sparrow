// Tavily search HTTP wrapper. Used by researchCompanyDossier to gather raw
// search results, which Claude then synthesizes into structured JSON. Cheaper
// (~$0.005/search) and more LLM-friendly than Anthropic's web_search tool.

const TAVILY_URL = 'https://api.tavily.com/search'

export interface TavilyResult {
  title: string
  url: string
  content: string
}

export interface TavilySearchInput {
  query: string
  apiKey: string
  maxResults?: number
  includeDomains?: string[]
  // 'advanced' returns 1-3kb extracts per result (better for product research),
  // 'basic' returns ~500-char snippets (faster + cheaper). Defaults to advanced.
  searchDepth?: 'basic' | 'advanced'
}

export interface TavilySearchResponse {
  results: TavilyResult[]
}

interface RawTavilyResult {
  title?: unknown
  url?: unknown
  content?: unknown
}

function normalize(raw: unknown): TavilyResult | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as RawTavilyResult
  if (typeof r.title !== 'string' || typeof r.url !== 'string' || typeof r.content !== 'string') return null
  return { title: r.title, url: r.url, content: r.content }
}

// Failure handling is graded:
//   - Auth failures (401/403) → throw, so production misconfiguration is loud.
//   - Network/transient failures (5xx, fetch error, JSON parse) → log + return
//     empty results, so a flaky upstream doesn't block email drafts.
//   - 200 OK with empty/no results → return empty results silently — that's
//     a normal "we didn't find anything" outcome.
export async function tavilySearch(input: TavilySearchInput): Promise<TavilySearchResponse> {
  const body = {
    api_key: input.apiKey,
    query: input.query,
    max_results: input.maxResults ?? 5,
    search_depth: input.searchDepth ?? 'advanced',
    ...(input.includeDomains && input.includeDomains.length > 0 && { include_domains: input.includeDomains }),
  }

  let resp: Response
  try {
    resp = await fetch(TAVILY_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
  } catch (err) {
    console.warn('Tavily search network error:', err)
    return { results: [] }
  }

  if (resp.status === 401 || resp.status === 403) {
    const text = await resp.text().catch(() => '')
    throw new Error(`Tavily API ${resp.status}: ${text || 'auth failed — check TAVILY_API_KEY'}`)
  }

  if (!resp.ok) {
    const text = await resp.text().catch(() => '')
    console.warn(`Tavily search ${resp.status}:`, text)
    return { results: [] }
  }

  let data: { results?: unknown[] }
  try {
    data = (await resp.json()) as { results?: unknown[] }
  } catch (err) {
    console.warn('Tavily response JSON parse error:', err)
    return { results: [] }
  }

  const results = Array.isArray(data.results)
    ? data.results.map(normalize).filter((r): r is TavilyResult => r !== null)
    : []
  return { results }
}
