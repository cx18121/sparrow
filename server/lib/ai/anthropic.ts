// Single Anthropic HTTP module. All Claude API calls go through callClaude.
// Version and URL are pinned here so callers never redeclare them.

export const ANTHROPIC_VERSION = '2023-06-01'
const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages'

export async function callClaude({
  apiKey,
  model,
  system,
  userContent,
  maxTokens,
}: {
  apiKey: string
  model: string
  system?: string
  userContent: string
  maxTokens: number
}): Promise<string> {
  const resp = await fetch(ANTHROPIC_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': ANTHROPIC_VERSION,
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      ...(system != null && { system }),
      messages: [{ role: 'user', content: userContent }],
    }),
  })

  if (!resp.ok) {
    const text = await resp.text()
    throw new Error(`Anthropic API ${resp.status}: ${text}`)
  }

  const data = (await resp.json()) as { content?: Array<{ type: string; text?: string }> }
  return data.content?.find(c => c.type === 'text')?.text?.trim() ?? ''
}
