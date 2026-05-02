import { callClaude } from './anthropic.js'
import { HUMANIZER_SYSTEM_PROMPT } from './prompts.js'

const HUMANIZER_MODEL = 'claude-haiku-4-5-20251001'

export async function humanizeEmailBody(body: string, apiKey: string): Promise<string> {
  try {
    const result = await callClaude({
      apiKey,
      model: HUMANIZER_MODEL,
      system: HUMANIZER_SYSTEM_PROMPT,
      userContent: body,
      maxTokens: 1024,
    })
    return result || body
  } catch {
    return body
  }
}
