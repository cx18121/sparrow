import React, { useState, useRef, useEffect } from 'react'
import { useAuth } from '../../contexts/AuthContext'
import { Settings, LogOut, ChevronDown, Zap } from 'lucide-react'

export default function Header({ onSignIn, onOpenSettings, activeTab, tabs, onTabChange }) {
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

  return (
    <header className="bg-dark text-white">
      {/* Top bar */}
      <div className="flex items-center justify-between px-6 h-14 border-b border-white/10">
        {/* Logo */}
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 bg-primary rounded-lg flex items-center justify-center">
            <Zap size={14} fill="white" className="text-white" />
          </div>
          <span className="font-display font-semibold text-base tracking-tight">ColdFlow</span>
        </div>

        {/* Right actions */}
        <div className="flex items-center gap-2">
          {user ? (
            <div className="relative" ref={dropRef}>
              <button
                onClick={() => setDropdownOpen(!dropdownOpen)}
                className="flex items-center gap-2 px-2 py-1 rounded-lg hover:bg-white/10 transition-colors"
              >
                {avatarUrl ? (
                  <img src={avatarUrl} alt={displayName} className="w-7 h-7 rounded-full object-cover" />
                ) : (
                  <div className="w-7 h-7 rounded-full bg-primary flex items-center justify-center text-xs font-semibold">
                    {initials}
                  </div>
                )}
                <span className="text-sm text-white/80 max-w-[120px] truncate">{displayName}</span>
                <ChevronDown size={13} className="text-white/50" />
              </button>

              {dropdownOpen && (
                <div className="absolute right-0 top-full mt-1 w-48 bg-white rounded-xl shadow-modal border border-gray-100 py-1 z-50 animate-fade-in">
                  <div className="px-3 py-2 border-b border-gray-100">
                    <p className="text-xs font-medium text-dark truncate">{displayName}</p>
                    <p className="text-xs text-muted truncate">{user.email}</p>
                  </div>
                  <button
                    onClick={() => { setDropdownOpen(false); onOpenSettings() }}
                    className="flex items-center gap-2 w-full px-3 py-2 text-sm text-dark hover:bg-gray-50 transition-colors"
                  >
                    <Settings size={14} className="text-muted" /> Settings
                  </button>
                  <button
                    onClick={() => { setDropdownOpen(false); signOut() }}
                    className="flex items-center gap-2 w-full px-3 py-2 text-sm text-red-600 hover:bg-red-50 transition-colors"
                  >
                    <LogOut size={14} /> Sign out
                  </button>
                </div>
              )}
            </div>
          ) : (
            <button onClick={onSignIn} className="btn-primary py-1.5 text-xs">
              Sign in
            </button>
          )}
        </div>
      </div>

      {/* Tab navigation */}
      <div className="flex items-center px-6 gap-1">
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => onTabChange(tab.id)}
            className={`flex items-center gap-1.5 px-3 py-3 text-sm font-medium border-b-2 transition-colors ${
              activeTab === tab.id
                ? 'text-white border-primary'
                : 'text-white/50 border-transparent hover:text-white/80'
            }`}
          >
            <tab.icon size={14} />
            {tab.label}
          </button>
        ))}
      </div>
    </header>
  )
}
