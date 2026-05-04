import React from 'react'
import { Link, NavLink, Navigate, Outlet, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import Badge from '../ui/Badge'
import { useAppData, type UiCampaign } from '../../contexts/AppDataContext'

// Phase 3 of the campaigns-as-workspaces redesign. Provides the persistent
// shell - header (campaign name, status, back-to-Home) + sub-tab nav - for
// every per-campaign route. Phase 4a-d migrated Discover/Drafts/Sent/Settings
// into the workspace sub-tabs; Phase 4e retired the legacy top-level surfaces
// so this URL is now the only way to enter a campaign.

const SUB_TABS = [
  { key: 'overview', label: 'Overview' },
  { key: 'leads', label: 'Leads' },
  { key: 'drafts', label: 'Drafts' },
  { key: 'sent', label: 'Sent' },
  { key: 'settings', label: 'Settings' },
] as const

export type WorkspaceSubTab = typeof SUB_TABS[number]['key']

interface WorkspaceShellProps {
  // Forwarded into the outlet so sub-tabs that mount existing top-level
  // components (LeadDiscovery, Drafts, Settings) can pass it along.
  workspaceConfig: any
  profile: any
  profileLoading: boolean
}

// Shape of what nested sub-tabs see via useOutletContext.
export interface WorkspaceOutletContext {
  campaign: UiCampaign
  workspaceConfig: any
  profile: any
  profileLoading: boolean
}

export default function WorkspaceShell({ workspaceConfig, profile, profileLoading }: WorkspaceShellProps) {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { campaigns, dataLoaded } = useAppData()

  const campaign = id ? campaigns.find(c => c.id === id) : null

  if (!id) return <Navigate to="/dashboard" replace />

  // Wait for the campaigns list to settle before deciding the id is bad -
  // refreshing into a workspace url shouldn't yank the user back to Home.
  if (!campaign) {
    if (!dataLoaded) {
      return (
        <div className="page-shell">
          <p className="text-sm text-muted">Loading campaign…</p>
        </div>
      )
    }
    return (
      <div className="page-shell">
        <div className="rounded-2xl border border-warm-200 bg-panel px-6 py-8 text-center">
          <h2 className="font-display text-xl font-semibold text-dark">Campaign not found</h2>
          <p className="mt-2 text-sm text-muted">It may have been deleted, or the link is wrong.</p>
          <button onClick={() => navigate('/dashboard')} className="btn-primary mt-4">
            <ArrowLeft size={14} /> Back to Home
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="page-shell">
      <WorkspaceHeader campaign={campaign} />
      <SubTabNav campaignId={campaign.id} />
      <div className="mt-5">
        <Outlet context={{ campaign, workspaceConfig, profile, profileLoading } satisfies WorkspaceOutletContext} />
      </div>
    </div>
  )
}

// Persistent header - campaign name, status badge, back-to-Home link.
// Edit affordance is intentionally omitted at this stage; the Settings
// sub-tab owns campaign mutations in Phase 4.
function WorkspaceHeader({ campaign }: { campaign: UiCampaign }) {
  return (
    <header className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
      <div className="min-w-0">
        <Link
          to="/dashboard"
          className="inline-flex items-center gap-1.5 text-xs text-muted hover:text-dark transition-colors"
        >
          <ArrowLeft size={12} /> Home
        </Link>
        <div className="mt-2 flex items-center gap-3">
          <h1 className="font-display text-3xl font-semibold text-dark truncate">
            {campaign.name}
          </h1>
          <Badge variant={campaign.status}>{campaign.status}</Badge>
        </div>
      </div>
    </header>
  )
}

function SubTabNav({ campaignId }: { campaignId: string }) {
  return (
    <nav
      role="tablist"
      aria-label="Campaign workspace sections"
      className="mt-5 flex flex-wrap gap-1 overflow-x-clip border-b border-warm-200"
    >
      {SUB_TABS.map(t => (
        <NavLink
          key={t.key}
          to={`/campaigns/${campaignId}/${t.key}`}
          role="tab"
          className={({ isActive }) =>
            `relative inline-flex items-center px-3 py-2.5 text-sm font-medium transition-colors ${
              isActive
                ? 'text-dark after:absolute after:inset-x-2 after:-bottom-px after:h-0.5 after:rounded-full after:bg-primary'
                : 'text-muted hover:text-dark'
            }`
          }
        >
          {t.label}
        </NavLink>
      ))}
    </nav>
  )
}
