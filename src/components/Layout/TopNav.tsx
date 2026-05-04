import React, { useEffect, useRef, useState } from 'react'
import { useAuth } from '../../contexts/AuthContext'
import { ChevronDown, LogOut } from 'lucide-react'

// Horizontal top nav. Replaces the previous left sidebar — three items
// don't justify a vertical rail, and the campaign grid wants the
// horizontal canvas. Mobile keeps the bottom nav unchanged.

interface Tab {
  id: string
  label: string
  icon: React.ComponentType<{ size?: number; className?: string }>
}

interface TopNavProps {
  activeTab: string
  tabs: Tab[]
  onTabChange: (id: string) => void
}

export default function TopNav({ activeTab, tabs, onTabChange }: TopNavProps) {
  const { user, signOut } = useAuth()
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const avatarUrl = user?.user_metadata?.avatar_url
  const displayName = user?.user_metadata?.full_name || user?.email?.split('@')[0] || 'User'
  const initials = displayName.split(' ').map((w: string) => w[0]).join('').slice(0, 2).toUpperCase()

  return (
    <>
      {/* Desktop top nav */}
      <header className="relative z-30 hidden border-b border-warm-200/70 bg-panel/95 backdrop-blur md:block">
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between gap-6 px-4 sm:px-6 lg:px-8">
          {/* Brand + tabs */}
          <div className="flex items-center gap-7">
            <button
              type="button"
              onClick={() => onTabChange(tabs[0].id)}
              className="font-display text-[18px] font-semibold tracking-[-0.04em] text-dark transition-colors hover:text-primary"
              aria-label="Sparrow home"
            >
              Sparrow
            </button>
            <nav className="flex items-center gap-1" aria-label="Primary">
              {/* Top nav uses plain buttons (not role="tab") because these are
                  navigation links, not the WAI-ARIA tabs pattern. The workspace
                  sub-tab nav inside /campaigns/:id/* uses real role="tab" for
                  its sub-panels; using "tab" here too would collide with that
                  semantically and break getByRole('tab') selectors in tests. */}
              {tabs.map(tab => {
                const isActive = activeTab === tab.id
                const Icon = tab.icon
                return (
                  <button
                    key={tab.id}
                    type="button"
                    aria-current={isActive ? 'page' : undefined}
                    onClick={() => onTabChange(tab.id)}
                    className={`relative inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium transition-colors ${
                      isActive
                        ? 'text-dark after:absolute after:inset-x-2 after:-bottom-[15px] after:h-0.5 after:rounded-full after:bg-primary'
                        : 'text-muted hover:text-dark'
                    }`}
                  >
                    <Icon size={14} className="opacity-80" />
                    {tab.label}
                  </button>
                )
              })}
            </nav>
          </div>

          {/* User menu */}
          {user && (
            <div className="relative" ref={menuRef}>
              <button
                type="button"
                onClick={() => setMenuOpen(o => !o)}
                className="flex items-center gap-2 rounded-full px-1.5 py-1 transition-colors hover:bg-warm-100"
                aria-haspopup="menu"
                aria-expanded={menuOpen}
              >
                {avatarUrl ? (
                  <img src={avatarUrl} alt={displayName} className="h-7 w-7 shrink-0 rounded-full object-cover" />
                ) : (
                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary text-[10px] font-semibold text-white">
                    {initials}
                  </div>
                )}
                <ChevronDown size={12} className="text-muted" />
              </button>
              {menuOpen && (
                <div
                  role="menu"
                  className="absolute right-0 top-full z-50 mt-2 w-56 rounded-2xl border border-warm-200 bg-panel py-2 shadow-modal animate-fade-in"
                >
                  <div className="border-b border-warm-200 px-4 py-3">
                    <p className="truncate text-sm font-medium text-dark">{displayName}</p>
                    <p className="mt-0.5 truncate text-xs text-muted">{user.email}</p>
                  </div>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => { setMenuOpen(false); signOut() }}
                    className="flex w-full items-center gap-2 px-4 py-2.5 text-sm text-red-600 transition-colors hover:bg-red-50"
                  >
                    <LogOut size={14} /> Sign out
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </header>

      {/* Mobile bottom nav — unchanged behavior, kept here so App.tsx mounts
          one nav component instead of two. */}
      <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-warm-200/70 bg-panel/95 px-2 pb-[calc(env(safe-area-inset-bottom)+0.5rem)] pt-2 shadow-[0_-10px_30px_rgba(44,31,16,0.08)] backdrop-blur-md md:hidden">
        <div
          className="grid gap-1"
          style={{ gridTemplateColumns: `repeat(${tabs.length}, minmax(58px, 1fr))` }}
        >
          {tabs.map(tab => {
            const isActive = activeTab === tab.id
            const Icon = tab.icon
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => onTabChange(tab.id)}
                aria-current={isActive ? 'page' : undefined}
                className={`flex min-h-[52px] flex-col items-center justify-center gap-1 rounded-xl px-1 text-[10px] font-semibold transition-colors ${
                  isActive ? 'bg-primary text-white shadow-[0_10px_24px_rgba(85,122,87,0.18)]' : 'text-muted hover:bg-warm-50 hover:text-dark'
                }`}
              >
                <Icon size={16} />
                <span className="max-w-full truncate">{tab.label}</span>
              </button>
            )
          })}
        </div>
      </nav>
    </>
  )
}
