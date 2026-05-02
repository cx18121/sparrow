export const STYLE_TESTS = [
  {
    id: 'tone',
    label: 'Tone',
    dimension: 'Choose the voice that feels more natural for you.',
    a: {
      label: 'Straightforward',
      traits: { directness: 3, warmth: 0, brevity: 1, specificity: 0, polish: 0 },
      body: 'Noticed {{company}} is working in a space where targeted outreach and timing matter.\n\nI am building a lightweight workflow that turns public company signals into cleaner first drafts, without making the message feel automated.\n\nWorth sending over a quick example?',
    },
    b: {
      label: 'Warm',
      traits: { directness: 0, warmth: 3, brevity: 0, specificity: 0, polish: 1 },
      body: 'I came across {{company}} while looking at teams doing thoughtful work in this market, and your focus stood out.\n\nI have been exploring how small teams can make first-touch outreach feel more researched without adding hours of manual writing.\n\nWould it be useful if I shared the short version?',
    },
  },
  {
    id: 'length',
    label: 'Length',
    dimension: 'Choose how much context you want before the ask.',
    a: {
      label: 'Concise',
      traits: { directness: 1, warmth: 0, brevity: 3, specificity: 0, polish: 0 },
      body: 'Noticed {{company}} and thought my work on research-backed cold outreach might be relevant.\n\nCould I send over a quick example?',
    },
    b: {
      label: 'Contextual',
      traits: { directness: 0, warmth: 1, brevity: 0, specificity: 3, polish: 1 },
      body: 'I noticed {{company}} while looking at teams where trust and timing seem important in outbound.\n\nMy recent work focuses on turning scattered prospect research into short, specific first drafts, especially when there is only one useful company signal to work from.\n\nIf helpful, I can send a brief example using a public signal from your site.',
    },
  },
  {
    id: 'ask',
    label: 'Ask',
    dimension: 'Choose the kind of call to action you prefer.',
    a: {
      label: 'Specific ask',
      traits: { directness: 3, warmth: 0, brevity: 1, specificity: 1, polish: 0 },
      body: 'I noticed {{company}} and thought there may be a useful fit with my work on making cold outreach more specific and less manual.\n\nWould you be open to a 15-minute conversation next week so I can show you what I am building?',
    },
    b: {
      label: 'Soft ask',
      traits: { directness: 0, warmth: 3, brevity: 0, specificity: 0, polish: 1 },
      body: 'I noticed {{company}} and thought there may be a useful fit with my work on making first-touch emails more relevant.\n\nNo need to book time yet. Would it be helpful if I sent over the 3-line version first?',
    },
  },
  {
    id: 'personalization',
    label: 'Personalization',
    dimension: 'Choose how much research detail should appear in the first note.',
    a: {
      label: 'Light',
      traits: { directness: 1, warmth: 0, brevity: 2, specificity: 0, polish: 0 },
      body: 'I saw {{company}} and thought there could be a useful reason to connect.\n\nI am working on a tool that helps students turn lead research into reviewed first drafts faster.\n\nWorth sharing?',
    },
    b: {
      label: 'Specific',
      traits: { directness: 0, warmth: 0, brevity: 0, specificity: 3, polish: 1 },
      body: 'I noticed {{company}} is in a market where a generic first email would probably get ignored. That caught my attention because my recent work is about using public company signals to write a more relevant first draft.\n\nWould a short example using one signal from {{company}} be useful?',
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
  }
}
