import { v4 as uuidv4 } from 'uuid'
import { subDays, format } from 'date-fns'

// ── Analytics mock data ───────────────────────────────────────────────────────
export const generateAnalyticsData = () => {
  const days = 30
  return Array.from({ length: days }, (_, i) => {
    const date = subDays(new Date(), days - 1 - i)
    const base = 100 + Math.round(Math.sin(i / 4) * 30 + Math.random() * 20)
    return {
      date: format(date, 'MMM d'),
      sent: base + Math.round(Math.random() * 40),
      openRate: +(28 + Math.sin(i / 5) * 8 + Math.random() * 5).toFixed(1),
      replyRate: +(8 + Math.sin(i / 7) * 3 + Math.random() * 2).toFixed(1),
      bounceRate: +(2 + Math.random() * 1.5).toFixed(1),
      conversionRate: +(3.5 + Math.sin(i / 6) * 1.5 + Math.random() * 1).toFixed(1),
    }
  })
}

export const campaignStats = [
  { id: uuidv4(), name: 'YC W24 Founders Outreach', sent: 342, opens: 127, replies: 28, bounces: 4, openRate: 37.1, replyRate: 8.2 },
  { id: uuidv4(), name: 'SaaS CTOs — April Push', sent: 215, opens: 68, replies: 11, bounces: 2, openRate: 31.6, replyRate: 5.1 },
  { id: uuidv4(), name: 'Enterprise Sales Pilot', sent: 89, opens: 41, replies: 9, bounces: 1, openRate: 46.1, replyRate: 10.1 },
  { id: uuidv4(), name: 'Re-engagement Q1', sent: 180, opens: 44, replies: 7, bounces: 6, openRate: 24.4, replyRate: 3.9 },
  { id: uuidv4(), name: 'Product Launch Announcement', sent: 1240, opens: 511, replies: 88, bounces: 18, openRate: 41.2, replyRate: 7.1 },
]

// ── Initial seed data for local state ────────────────────────────────────────
export const seedTemplates = [
  {
    id: uuidv4(),
    name: 'Cold Intro — Startup Founder',
    subject: 'Quick question about {{company}}',
    body: '<p>Hi {{first_name}},</p><p>I came across {{company}} and was really impressed by what you\'re building.</p><p>I\'m reaching out because I think there\'s a strong fit between your goals and what we offer at ColdFlow — specifically around [VALUE_PROP].</p><p>Would you be open to a 15-minute call this week?</p><p>Best,<br>{{sender_name}}</p>',
    isShared: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: uuidv4(),
    name: 'Follow-up #1',
    subject: 'Re: Quick question about {{company}}',
    body: '<p>Hi {{first_name}},</p><p>Just wanted to follow up on my previous email — wanted to make sure it didn\'t get buried.</p><p>Happy to share a quick case study from a company similar to {{company}} if that would be helpful.</p><p>Best,<br>{{sender_name}}</p>',
    isShared: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: uuidv4(),
    name: 'Break-up Email',
    subject: 'Closing the loop, {{first_name}}',
    body: '<p>Hi {{first_name}},</p><p>I\'ll keep this short — I\'ve reached out a couple of times but haven\'t heard back, so I\'ll assume the timing isn\'t right.</p><p>If you\'d like to connect in the future, my inbox is always open.</p><p>Best,<br>{{sender_name}}</p>',
    isShared: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
]

export const seedSequences = [
  {
    id: uuidv4(),
    name: '3-Touch Startup Sequence',
    description: 'Classic 3-step cold sequence with 3-day gaps',
    steps: [
      { id: uuidv4(), order: 0, name: 'Initial Email', templateId: null, waitDays: 0, variants: [] },
      { id: uuidv4(), order: 1, name: 'Follow-up', templateId: null, waitDays: 3, variants: [] },
      { id: uuidv4(), order: 2, name: 'Break-up Email', templateId: null, waitDays: 7, variants: [] },
    ],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: uuidv4(),
    name: 'Quick 2-Touch',
    description: 'Lightweight two-touch sequence',
    steps: [
      { id: uuidv4(), order: 0, name: 'Initial Email', templateId: null, waitDays: 0, variants: [] },
      { id: uuidv4(), order: 1, name: 'Follow-up', templateId: null, waitDays: 5, variants: [] },
    ],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
]

export const seedContacts = Array.from({ length: 40 }, (_, i) => ({
  id: uuidv4(),
  firstName: ['Alice', 'Bob', 'Carol', 'David', 'Eva', 'Frank', 'Grace', 'Hank', 'Iris', 'Jack'][i % 10],
  lastName: ['Smith', 'Jones', 'Williams', 'Brown', 'Davis', 'Miller', 'Wilson', 'Moore', 'Taylor', 'Anderson'][i % 10],
  email: `contact${i + 1}@example${(i % 5) + 1}.com`,
  company: ['Acme Corp', 'TechStartup Inc', 'Founders Co', 'Growth Labs', 'Velocity AI'][i % 5],
  status: ['active', 'active', 'active', 'bounced', 'unsubscribed'][i % 5],
  createdAt: subDays(new Date(), i * 2).toISOString(),
}))

export const seedCampaigns = [
  {
    id: uuidv4(),
    name: 'YC W24 Founders Outreach',
    subject: 'Quick question about {{company}}',
    status: 'active',
    sequenceId: null,
    templateId: null,
    contactListId: null,
    scheduledAt: new Date().toISOString(),
    createdAt: subDays(new Date(), 14).toISOString(),
    updatedAt: subDays(new Date(), 2).toISOString(),
  },
  {
    id: uuidv4(),
    name: 'SaaS CTOs — April Push',
    subject: 'How {{company}} can cut email ops cost by 40%',
    status: 'paused',
    sequenceId: null,
    templateId: null,
    contactListId: null,
    scheduledAt: subDays(new Date(), 5).toISOString(),
    createdAt: subDays(new Date(), 20).toISOString(),
    updatedAt: subDays(new Date(), 5).toISOString(),
  },
  {
    id: uuidv4(),
    name: 'Product Launch Announcement',
    subject: 'Introducing ColdFlow 2.0',
    status: 'completed',
    sequenceId: null,
    templateId: null,
    contactListId: null,
    scheduledAt: subDays(new Date(), 30).toISOString(),
    createdAt: subDays(new Date(), 35).toISOString(),
    updatedAt: subDays(new Date(), 30).toISOString(),
  },
  {
    id: uuidv4(),
    name: 'Re-engagement Q1',
    subject: 'Still interested in automating outreach?',
    status: 'draft',
    sequenceId: null,
    templateId: null,
    contactListId: null,
    scheduledAt: null,
    createdAt: subDays(new Date(), 3).toISOString(),
    updatedAt: subDays(new Date(), 1).toISOString(),
  },
]

export const sampleContactData = {
  first_name: 'Alex',
  last_name: 'Chen',
  company: 'Momentum AI',
  role: 'Co-founder & CEO',
  sender_name: 'Your Name',
}
