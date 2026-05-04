export const STYLE_TESTS = [
  {
    id: 'tone',
    label: 'Tone',
    dimension: 'Choose the opening voice that feels more natural for you.',
    a: {
      label: 'Direct',
      traits: { directness: 3, warmth: 0, brevity: 1, specificity: 0, polish: 0 },
      body: "I'm a junior at Cornell studying CS, and I've been following {{company}}'s work for the past few months.\n\nI'd like to connect with someone on the team to learn more about what you're building. Would a quick call this week work?",
    },
    b: {
      label: 'Warm',
      traits: { directness: 0, warmth: 3, brevity: 0, specificity: 0, polish: 1 },
      body: "I came across {{company}} while looking at teams doing thoughtful work in this space, and your approach stood out to me.\n\nI'm a junior at Cornell studying CS and would genuinely love to hear more about the direction you're taking. Would anyone on the team be open to a conversation?",
    },
  },
  {
    id: 'length',
    label: 'Length',
    dimension: 'Choose how much context you want to give before the ask.',
    a: {
      label: 'Concise',
      traits: { directness: 1, warmth: 0, brevity: 3, specificity: 0, polish: 0 },
      body: "I'm a Cornell CS junior interested in what {{company}} is building.\n\nWould a quick call make sense?",
    },
    b: {
      label: 'Contextual',
      traits: { directness: 0, warmth: 1, brevity: 0, specificity: 3, polish: 1 },
      body: "I've been following {{company}} for the past couple months. I'm a junior at Cornell studying CS, and I've been spending most of my time outside class on ML infrastructure and systems.\n\nI'd love to hear more about what the team is focused on right now. Would a 20-minute call make sense?",
    },
  },
  {
    id: 'ask',
    label: 'The Ask',
    dimension: 'Choose the call to action that feels more like you.',
    a: {
      label: 'Direct ask',
      traits: { directness: 3, warmth: 0, brevity: 1, specificity: 1, polish: 0 },
      body: "I've been following {{company}}'s work and think there's a real fit with my background.\n\nWould you be open to a 20-minute call next week? I'm free Tuesday or Wednesday afternoon.",
    },
    b: {
      label: 'Soft ask',
      traits: { directness: 0, warmth: 3, brevity: 0, specificity: 0, polish: 1 },
      body: "I've been following {{company}}'s work and think there's a real fit with my background.\n\nNo pressure to schedule anything yet — would it be helpful if I sent over a bit more context on what I've been working on first?",
    },
  },
  {
    id: 'personalization',
    label: 'Research depth',
    dimension: 'Choose how much you want to reference about them in the opening.',
    a: {
      label: 'Light touch',
      traits: { directness: 1, warmth: 0, brevity: 2, specificity: 0, polish: 0 },
      body: "I came across {{company}} and thought there could be a good reason to connect.\n\nI'm a Cornell CS student working on ML tooling. Worth a quick conversation?",
    },
    b: {
      label: 'Specific',
      traits: { directness: 0, warmth: 0, brevity: 0, specificity: 3, polish: 1 },
      body: "I've been following {{company}}'s work closely — the infrastructure approach you're taking is something I've been thinking about through my own projects.\n\nI'm a junior at Cornell studying CS, and I'd love to hear how the team is approaching that problem. Would a quick call make sense?",
    },
  },
] as const

export const STYLE_LABELS: Record<string, string> = {
  directness: 'direct',
  warmth: 'warm',
  brevity: 'concise',
  specificity: 'specific',
  polish: 'polished',
}

export const STYLE_PROMPTS: Record<string, string> = {
  direct: 'Use direct language. State the reason for reaching out early and include a clear ask.',
  warm: 'Use a warm but professional tone. Keep the message human without adding filler.',
  concise: 'Keep the email short. Prefer 70 to 100 words and remove unnecessary setup.',
  specific: 'Include one concrete relevance signal about the company or recipient. Do not invent facts.',
  polished: 'Keep phrasing professional and composed. Avoid slang, hype, and overfamiliar language.',
}

export const DEFAULT_STYLE_PROFILE = {
  name: 'Balanced outreach',
  summary: 'Concise, clear, and easy to edit.',
  prompt: 'Write concise, clear outreach with a specific reason for contact and one low-friction ask.',
  traits: ['direct', 'concise', 'specific'],
  scores: { directness: 1, warmth: 1, brevity: 1, specificity: 1, polish: 1 },
}

export interface StyleProfile {
  name: string
  summary: string
  prompt: string
  traits: string[]
  scores: Record<string, number>
  examples?: string[]
}

export function scoreStyleChoices(choices: Record<string, string> = {}): StyleProfile {
  const scores: Record<string, number> = { directness: 0, warmth: 0, brevity: 0, specificity: 0, polish: 0 }

  STYLE_TESTS.forEach(test => {
    const pick = choices[test.id] as 'a' | 'b' | undefined
    const option = pick ? test[pick] : null
    if (!option) return
    Object.entries(option.traits).forEach(([trait, value]) => {
      scores[trait] = (scores[trait] || 0) + (value as number)
    })
  })

  const ranked = Object.entries(scores).sort((a, b) => b[1] - a[1])
  const topTraits = ranked.filter(([, v]) => v > 0).slice(0, 3).map(([t]) => STYLE_LABELS[t])
  const prompt = topTraits.length
    ? topTraits.map(t => STYLE_PROMPTS[t]).filter(Boolean).join(' ')
    : DEFAULT_STYLE_PROFILE.prompt

  const examples = STYLE_TESTS
    .map(test => {
      const pick = choices[test.id] as 'a' | 'b' | undefined
      return pick ? test[pick].body : null
    })
    .filter(Boolean) as string[]

  return {
    name: topTraits.length
      ? `${topTraits.map(t => t[0].toUpperCase() + t.slice(1)).join(', ')} outreach`
      : DEFAULT_STYLE_PROFILE.name,
    summary: topTraits.length
      ? `Your drafts should feel ${topTraits.join(', ')}.`
      : DEFAULT_STYLE_PROFILE.summary,
    prompt,
    traits: topTraits.length ? topTraits : DEFAULT_STYLE_PROFILE.traits,
    scores,
    examples,
  }
}
