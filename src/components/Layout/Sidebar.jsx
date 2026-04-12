import React, { useState, useRef, useEffect } from 'react'
import { useAuth } from '../../contexts/AuthContext'
import { LogOut, ChevronDown, Snowflake } from 'lucide-react'

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
        onClick={() => onTabChange(tab.id)}
        title={collapsed ? tab.label : undefined}
        className={`flex w-full items-center gap-3 rounded-lg px-2 py-1.5 text-sm font-medium transition-all duration-150 ${
          isActive
            ? 'bg-primary text-white'
            : 'text-muted hover:bg-slate-50 hover:text-dark'
        } ${collapsed ? 'justify-center' : ''}`}
      >
        <tab.icon size={15} className="shrink-0" />
        {!collapsed && tab.label}
      </button>
    )
  }

  return (
    <aside className={`relative z-20 flex h-screen shrink-0 flex-col border-r border-slate-100 bg-white/80 backdrop-blur-xl transition-all duration-200 ${collapsed ? 'w-14' : 'w-52'}`}>
      {/* Logo row */}
      <div className="flex h-14 shrink-0 items-center justify-between px-3">
        <Snowflake size={22} className="text-primary" strokeWidth={1.75} />
        {!collapsed && (
          <button
            onClick={() => setCollapsed(true)}
            className="text-[11px] font-medium text-muted/60 transition-colors hover:text-muted select-none"
          >
            {'<<'}
          </button>
        )}
        {collapsed && (
          <button
            onClick={() => setCollapsed(false)}
            className="absolute -right-3 top-4 flex h-6 w-6 items-center justify-center rounded-full border border-slate-100 bg-white text-[10px] font-medium text-muted shadow-sm transition-colors hover:text-dark"
          >
            {'>>'}
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
              onClick={() => setDropdownOpen(!dropdownOpen)}
              title={collapsed ? displayName : undefined}
              className={`flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-sm transition-all duration-150 hover:bg-slate-50 ${collapsed ? 'justify-center' : ''}`}
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
  )
}
