// Single Anthropic HTTP module. All Claude API calls go through callClaude.
// Version and URL are pinned here so callers never redeclare them.

export const ANTHROPIC_VERSION = '2023-06-01'
const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages'
const MAX_PAUSE_TURN_ITERATIONS = 3

export interface AnthropicTool {
  type: string
  name: string
  [key: string]: unknown
}

type ContentBlock = { type: string; text?: string; [key: string]: unknown }
type AnthropicMessage = { role: 'user' | 'assistant'; content: string | ContentBlock[] }
type AnthropicResponse = { content?: ContentBlock[]; stop_reason?: string }

async function postMessages(
  apiKey: string,
  body: Record<string, unknown>
): Promise<AnthropicResponse> {
  const resp = await fetch(ANTHROPIC_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': ANTHROPIC_VERSION,
    },
    body: JSON.stringify(body),
  })

  if (!resp.ok) {
    const text = await resp.text()
    throw new Error(`Anthropic API ${resp.status}: ${text}`)
  }

  return (await resp.json()) as AnthropicResponse
}

export async function callClaude({
  apiKey,
  model,
  system,
  userContent,
  maxTokens,
  tools,
}: {
  apiKey: string
  model: string
  system?: string
  userContent: string
  maxTokens: number
  tools?: AnthropicTool[]
}): Promise<string> {
  const messages: AnthropicMessage[] = [{ role: 'user', content: userContent }]
  let data: AnthropicResponse | null = null

  // Pause-turn loop: when stop_reason is 'pause_turn' the model paused mid
  // server-tool execution. We continue by feeding the prior assistant content
  // back as conversation history. Capped to prevent runaway loops.
  for (let i = 0; i < MAX_PAUSE_TURN_ITERATIONS; i++) {
    data = await postMessages(apiKey, {
      model,
      max_tokens: maxTokens,
      ...(system != null && { system }),
      ...(tools && tools.length > 0 && { tools }),
      messages,
    })

    if (data.stop_reason !== 'pause_turn') break
    if (data.content && data.content.length > 0) {
      messages.push({ role: 'assistant', content: data.content })
    }
  }

  const textBlocks = data?.content?.filter(c => c.type === 'text') ?? []
  const last = textBlocks[textBlocks.length - 1]
  return last?.text?.trim() ?? ''
}
