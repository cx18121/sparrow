import React, { useState, useRef, useEffect } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import { useAppData } from '../../contexts/AppDataContext'
import type { UiCampaign } from '../../contexts/AppDataContext'
import { LogOut, ChevronDown, PanelLeftClose, PanelLeftOpen, Plus, Send } from 'lucide-react'

// Sidebar layout (per the latest mockup):
//   Brand row    : forest green circle + Send icon + Sparrow wordmark, no
//                  bottom divider (the previous border-t was the "white bar"
//                  that crowded the top).
//   Main nav     : Home, Templates (Settings demoted to bottom rail).
//   Campaigns    : Active and Paused campaigns surfaced inline so the user
//                  can jump between them without bouncing through Home.
//                  Click a campaign → its workspace overview.
//   Bottom rail  : Settings + user avatar menu.
//
// Mobile bottom-nav stays unchanged - it carries the global tabs only.

const STATUS_DOT: Record<UiCampaign['status'], string> = {
  active: 'bg-primary',
  paused: 'bg-amber-500',
  completed: 'bg-warm-400',
}

export default function Sidebar({
  activeTab,
  tabs,
  onTabChange,
}) {
  const { user, signOut } = useAuth()
  const { campaigns } = useAppData()
  const navigate = useNavigate()
  const location = useLocation()
  const [collapsed, setCollapsed] = useState(false)
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const dropRef = useRef(null)

  useEffect(() => {
    const handler = (e) => {
      if (dropRef.current && !dropRef.current.contains(e.target)) setDropdownOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const avatarUrl = user?.user_metadata?.avatar_url
  const displayName = user?.user_metadata?.full_name || user?.email?.split('@')[0] || 'User'
  const initials = displayName.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()

  const mainTabs = tabs.filter(t => t.id !== 'settings')
  const settingsTab = tabs.find(t => t.id === 'settings')

  // Live-list campaigns: show Active first, then Paused. Completed campaigns
  // are intentionally hidden from the sidebar to keep it about ongoing work
  // (Home's grid surfaces Completed for users who want to revisit them).
  // Optimistic temp-id rows (created via createCampaign before the server
  // response arrives) are skipped - clicking them would 404 every workspace
  // fetch since the server doesn't know that id yet.
  const sidebarCampaigns = [
    ...campaigns.filter(c => c.status === 'active' && !c.id.startsWith('temp-')),
    ...campaigns.filter(c => c.status === 'paused' && !c.id.startsWith('temp-')),
  ]
  const activeCampaignId = location.pathname.match(/^\/campaigns\/([^/]+)/)?.[1] ?? null

  const renderTabButton = (tab) => {
    const isActive = activeTab === tab.id
    return (
      <button
        key={tab.id}
        type="button"
        onClick={() => onTabChange(tab.id)}
        title={collapsed ? tab.label : undefined}
        aria-current={isActive ? 'page' : undefined}
        className={`group flex min-h-9 w-full items-center gap-3 rounded-xl px-2.5 py-2 text-sm font-medium transition-all duration-150 ${
          isActive
            ? 'bg-primary text-warm-50 shadow-[0_10px_24px_rgba(85,122,87,0.18)]'
            : 'text-muted hover:bg-accent/10 hover:text-dark'
        } ${collapsed ? 'justify-center' : ''}`}
      >
        <tab.icon size={15} className="shrink-0" />
        {!collapsed && tab.label}
      </button>
    )
  }

  const renderCampaignRow = (campaign: UiCampaign) => {
    const isActive = activeCampaignId === campaign.id
    return (
      <button
        key={campaign.id}
        type="button"
        onClick={() => navigate(`/campaigns/${campaign.id}/overview`)}
        title={collapsed ? campaign.name : undefined}
        aria-current={isActive ? 'page' : undefined}
        className={`group flex min-h-8 w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-[13px] transition-all duration-150 ${
          isActive
            ? 'bg-warm-100 text-dark'
            : 'text-muted hover:bg-accent/10 hover:text-dark'
        } ${collapsed ? 'justify-center' : ''}`}
      >
        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${STATUS_DOT[campaign.status]}`} aria-hidden />
        {!collapsed && (
          <span className="min-w-0 flex-1 truncate">{campaign.name}</span>
        )}
      </button>
    )
  }

  return (
    <>
    <aside className={`relative z-20 hidden h-screen shrink-0 flex-col border-r border-accent/20 bg-[#F8F4ED] transition-all duration-200 md:flex ${collapsed ? 'w-16' : 'w-56'}`}>
      {/* Brand row - forest green badge + wordmark. No divider underneath
          (the previous border-t crowded the top). */}
      <div className="flex h-14 shrink-0 items-center justify-between px-3">
        <div className={`flex min-w-0 items-center gap-2.5 ${collapsed ? 'justify-center' : ''}`}>
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-warm-50 shadow-[0_4px_12px_rgba(85,122,87,0.22)]">
            <Send size={14} className="-rotate-12" />
          </span>
          {!collapsed && (
            <span className="font-display text-[17px] font-semibold text-dark">Sparrow</span>
          )}
        </div>
        {!collapsed && (
          <button
            type="button"
            onClick={() => setCollapsed(true)}
            className="btn-ghost p-1.5 text-muted/70 hover:text-dark"
            title="Collapse sidebar"
          >
            <PanelLeftClose size={14} />
          </button>
        )}
        {collapsed && (
          <button
            type="button"
            onClick={() => setCollapsed(false)}
            className="absolute -right-3 top-4 flex h-7 w-7 items-center justify-center rounded-full border border-accent/20 bg-[#F8F4ED] text-muted shadow-sm transition-colors hover:text-dark"
            title="Expand sidebar"
          >
            <PanelLeftOpen size={13} />
          </button>
        )}
      </div>

      {/* Main nav */}
      <nav className="flex-1 overflow-y-auto px-2 pt-2 pb-3">
        <div className="space-y-0.5">
          {mainTabs.map(renderTabButton)}
        </div>

        {/* Campaigns inline list. When collapsed, render as small status
            dots (no labels) so the user still sees what's running and how
            many - clicking a dot still navigates into the workspace. */}
        {sidebarCampaigns.length > 0 && (
          <div className="mt-5">
            {!collapsed && (
              <div className="mb-1.5 flex items-center justify-between px-2.5">
                <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted/70">
                  Campaigns
                </span>
                <button
                  type="button"
                  onClick={() => navigate('/dashboard?new=1')}
                  title="New campaign"
                  className="flex h-4 w-4 items-center justify-center rounded-full text-muted/70 transition-colors hover:bg-accent/15 hover:text-dark"
                  aria-label="New campaign"
                >
                  <Plus size={11} />
                </button>
              </div>
            )}
            <div className="space-y-0">
              {sidebarCampaigns.slice(0, 8).map(renderCampaignRow)}
              {!collapsed && sidebarCampaigns.length > 8 && (
                <button
                  type="button"
                  onClick={() => onTabChange('dashboard')}
                  className="mt-1 px-2.5 py-1 text-[11px] font-medium text-muted hover:text-dark"
                >
                  View all ({sidebarCampaigns.length}) →
                </button>
              )}
            </div>
          </div>
        )}
      </nav>

      {/* Bottom - Settings + user menu */}
      <div className="shrink-0 border-t border-accent/15 px-2 py-2 space-y-0.5">
        {settingsTab && renderTabButton(settingsTab)}
        {user && (
          <div className="relative" ref={dropRef}>
            <button
              type="button"
              onClick={() => setDropdownOpen(!dropdownOpen)}
              title={collapsed ? displayName : undefined}
              className={`flex min-h-10 w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-sm transition-all duration-150 hover:bg-accent/10 ${collapsed ? 'justify-center' : ''}`}
            >
              {avatarUrl ? (
                <img src={avatarUrl} alt={displayName} className="h-6 w-6 shrink-0 rounded-full object-cover" />
              ) : (
                <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-[10px] font-semibold text-warm-50">
                  {initials}
                </div>
              )}
              {!collapsed && (
                <>
                  <span className="min-w-0 flex-1 truncate text-left text-sm font-medium text-dark">{displayName}</span>
                  <ChevronDown size={12} className="shrink-0 text-muted" />
                </>
              )}
            </button>

            {dropdownOpen && (
              <div className={`absolute bottom-full z-50 mb-1 rounded-[18px] border border-accent/20 bg-[#F8F4ED] py-2 shadow-modal animate-fade-in ${collapsed ? 'left-10 w-48' : 'left-0 right-0'}`}>
                <div className="border-b border-accent/15 px-4 py-3">
                  <p className="truncate text-sm font-medium text-dark">{displayName}</p>
                  <p className="mt-0.5 truncate text-xs text-muted">{user.email}</p>
                </div>
                <button
                  type="button"
                  onClick={() => { setDropdownOpen(false); signOut() }}
                  className="flex w-full items-center gap-2 px-4 py-2.5 text-sm text-red-600 transition-colors hover:bg-red-50"
                >
                  <LogOut size={14} /> Sign out
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </aside>

    <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-accent/20 bg-[#F8F4ED]/[0.97] px-2 pb-[calc(env(safe-area-inset-bottom)+0.5rem)] pt-2 shadow-[0_-10px_30px_rgba(44,31,16,0.08)] backdrop-blur-md md:hidden">
      <div
        className="grid gap-1 overflow-x-auto"
        style={{ gridTemplateColumns: `repeat(${tabs.length}, minmax(58px, 1fr))` }}
      >
        {tabs.map(tab => {
          const isActive = activeTab === tab.id
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => onTabChange(tab.id)}
              aria-current={isActive ? 'page' : undefined}
              className={`flex min-h-[52px] flex-col items-center justify-center gap-1 rounded-xl px-1 text-[10px] font-semibold transition-colors ${
                isActive ? 'bg-primary text-warm-50 shadow-[0_10px_24px_rgba(85,122,87,0.18)]' : 'text-muted hover:bg-warm-50 hover:text-dark'
              }`}
            >
              <tab.icon size={16} />
              <span className="max-w-full truncate">{tab.label}</span>
            </button>
          )
        })}
      </div>
    </nav>
    </>
  )
}
