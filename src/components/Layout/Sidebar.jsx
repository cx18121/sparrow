import React, { useState, useRef, useEffect } from 'react'
import { useAuth } from '../../contexts/AuthContext'
import { LogOut, ChevronDown, Snowflake, PanelLeftClose, PanelLeftOpen } from 'lucide-react'

export default function Sidebar({
  activeTab,
  tabs,
  onTabChange,
}) {
  const { user, signOut } = useAuth()
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
            ? 'bg-primary text-white shadow-[0_10px_24px_rgba(27,110,243,0.18)]'
            : 'text-muted hover:bg-slate-50 hover:text-dark'
        } ${collapsed ? 'justify-center' : ''}`}
      >
        <tab.icon size={15} className="shrink-0" />
        {!collapsed && tab.label}
      </button>
    )
  }

  return (
    <>
    <aside className={`relative z-20 hidden h-screen shrink-0 flex-col border-r border-slate-100 bg-white/90 backdrop-blur-xl transition-all duration-200 md:flex ${collapsed ? 'w-16' : 'w-56'}`}>
      {/* Logo row */}
      <div className="flex h-14 shrink-0 items-center justify-between px-3">
        <div className={`flex min-w-0 items-center gap-2.5 ${collapsed ? 'justify-center' : ''}`}>
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Snowflake size={18} strokeWidth={1.9} />
          </div>
          {!collapsed && (
            <div className="min-w-0">
              <p className="truncate font-display text-sm font-semibold tracking-[-0.02em] text-dark">Coldflow</p>
            </div>
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
            className="absolute -right-3 top-4 flex h-7 w-7 items-center justify-center rounded-full border border-slate-100 bg-white text-muted shadow-sm transition-colors hover:text-dark"
            title="Expand sidebar"
          >
            <PanelLeftOpen size={13} />
          </button>
        )}
      </div>

      <div className="mx-3 border-t border-slate-100" />

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto px-2 py-3 space-y-0.5">
        {mainTabs.map(renderTabButton)}
      </nav>

      {/* Bottom */}
      <div className="shrink-0 border-t border-slate-100 px-2 py-2 space-y-0.5">
        {settingsTab && renderTabButton(settingsTab)}
        {user && (
          <div className="relative" ref={dropRef}>
            <button
              type="button"
              onClick={() => setDropdownOpen(!dropdownOpen)}
              title={collapsed ? displayName : undefined}
              className={`flex min-h-10 w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-sm transition-all duration-150 hover:bg-slate-50 ${collapsed ? 'justify-center' : ''}`}
            >
              {avatarUrl ? (
                <img src={avatarUrl} alt={displayName} className="h-6 w-6 shrink-0 rounded-full object-cover" />
              ) : (
                <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-[10px] font-semibold text-white">
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
              <div className={`absolute bottom-full z-50 mb-1 rounded-[18px] border border-white/80 bg-white/96 py-2 shadow-modal backdrop-blur-xl animate-fade-in ${collapsed ? 'left-10 w-48' : 'left-0 right-0'}`}>
                <div className="border-b border-slate-100 px-4 py-3">
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

    <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-100 bg-white/96 px-2 pb-[calc(env(safe-area-inset-bottom)+0.5rem)] pt-2 shadow-[0_-10px_30px_rgba(15,23,42,0.08)] backdrop-blur-xl md:hidden">
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
                isActive ? 'bg-primary text-white shadow-[0_10px_24px_rgba(27,110,243,0.18)]' : 'text-muted hover:bg-slate-50 hover:text-dark'
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
