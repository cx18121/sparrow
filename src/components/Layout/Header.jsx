import React, { useState, useRef, useEffect } from 'react'
import { useAuth } from '../../contexts/AuthContext'
import { Settings, LogOut, ChevronDown, Zap, ArrowLeft } from 'lucide-react'

export default function Header({
  onOpenSettings,
  activeTab,
  tabs,
  onTabChange,
  settingsOpen = false,
}) {
  const { user, signOut } = useAuth()
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const dropRef = useRef(null)

  useEffect(() => {
    const handler = (e) => { if (dropRef.current && !dropRef.current.contains(e.target)) setDropdownOpen(false) }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const avatarUrl = user?.user_metadata?.avatar_url
  const displayName = user?.user_metadata?.full_name || user?.email?.split('@')[0] || 'User'
  const initials = displayName.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()
  const activeWorkspaceTab = tabs.find(tab => tab.id === activeTab)

  return (
    <header className="relative z-20 px-6 pt-6 pb-4 sm:px-10 lg:px-14">
      <div className="mx-auto max-w-7xl">
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-[18px] bg-primary text-white">
                <Zap size={18} fill="white" className="text-white" />
              </div>
              <div>
                <p className="font-display text-xl font-semibold tracking-[-0.04em] text-dark">ColdFlow</p>
              </div>
            </div>

            <div className="flex items-center gap-2 self-start lg:self-auto">
              <button type="button" onClick={onOpenSettings} className="btn-secondary px-3 py-2 text-xs">
                {settingsOpen ? <ArrowLeft size={14} /> : <Settings size={14} />}
                {settingsOpen ? 'Dashboard' : 'Settings'}
              </button>

              {user && (
                <div className="relative" ref={dropRef}>
                  <button
                    onClick={() => setDropdownOpen(!dropdownOpen)}
                    className="inline-flex items-center gap-2 rounded-full border border-white/80 bg-white/82 px-2 py-1.5 text-sm text-dark shadow-[0_10px_24px_rgba(15,23,42,0.08)] transition-all duration-150 hover:-translate-y-0.5 hover:bg-white"
                  >
                    {avatarUrl ? (
                      <img src={avatarUrl} alt={displayName} className="h-8 w-8 rounded-full object-cover" />
                    ) : (
                      <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-xs font-semibold text-white">
                        {initials}
                      </div>
                    )}
                    <span className="max-w-[140px] truncate text-sm font-medium text-dark">{displayName}</span>
                    <ChevronDown size={13} className="text-muted" />
                  </button>

                  {dropdownOpen && (
                    <div className="absolute right-0 top-full z-50 mt-2 w-56 rounded-[24px] border border-white/80 bg-white/92 py-2 shadow-modal backdrop-blur-xl animate-fade-in">
                      <div className="border-b border-slate-100 px-4 py-3">
                        <p className="truncate text-sm font-medium text-dark">{displayName}</p>
                        <p className="mt-0.5 truncate text-xs text-muted">{user.email}</p>
                      </div>
                      <button
                        onClick={() => { setDropdownOpen(false); onOpenSettings() }}
                        className="flex w-full items-center gap-2 px-4 py-2.5 text-sm text-dark transition-colors hover:bg-slate-50"
                      >
                        {settingsOpen ? <ArrowLeft size={14} className="text-muted" /> : <Settings size={14} className="text-muted" />}
                        {settingsOpen ? 'Back to dashboard' : 'Settings'}
                      </button>
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
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {tabs.map(tab => (
              <button
                key={tab.id}
                onClick={() => onTabChange(tab.id)}
                className={`inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium transition-all duration-150 ${
                  activeTab === tab.id && !settingsOpen
                    ? 'bg-primary text-white'
                    : 'border border-white/80 bg-white/68 text-muted hover:-translate-y-0.5 hover:bg-white hover:text-dark'
                }`}
              >
                <tab.icon size={14} />
                {tab.label}
              </button>
            ))}
          </div>
        </div>
      </div>
    </header>
  )
}
