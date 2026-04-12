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

export const sampleContactData = {
  first_name: 'Alex',
  last_name: 'Chen',
  company: 'Momentum AI',
  role: 'Co-founder & CEO',
  sender_name: 'Your Name',
}
