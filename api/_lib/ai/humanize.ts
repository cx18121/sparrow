import { HUMANIZER_SYSTEM_PROMPT } from './prompts.js'

const ANTHROPIC_VERSION = '2023-06-01'
const HUMANIZER_MODEL = 'claude-haiku-4-5-20251001'

export async function humanizeEmailBody(body: string, apiKey: string): Promise<string> {
  try {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
      },
      body: JSON.stringify({
        model: HUMANIZER_MODEL,
        max_tokens: 1024,
        system: HUMANIZER_SYSTEM_PROMPT,
        messages: [{ role: 'user', content: body }],
      }),
    })

    if (!resp.ok) return body

    const data = (await resp.json()) as { content?: Array<{ type: string; text?: string }> }
    const text = data.content?.find((c) => c.type === 'text')?.text?.trim()
    return text || body
  } catch {
    return body
  }
}
