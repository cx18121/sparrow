import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'

// Pageviews fire only for known public paths or for authenticated users.
// Bots scrape route names out of the JS bundle and fire requests at
// /dashboard, /settings, /templates etc. — GA used to count those because
// the auto pageview ran before AuthContext could redirect. With
// send_page_view: false set in public/ga.js and this gate, those hits
// produce no analytics event.
const PUBLIC_PATHS = new Set(['/', '/login', '/privacy', '/terms'])

function normalizePath(pathname: string): string {
  if (pathname.length > 1 && pathname.endsWith('/')) return pathname.slice(0, -1)
  return pathname
}

function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.has(normalizePath(pathname))
}

// Module-level dedupe so StrictMode's intentional double-mount in dev
// doesn't fire two pageviews. useRef re-initializes on remount; module
// state survives. The 100ms window distinguishes a synchronous StrictMode
// remount (microseconds apart) from a real back-nav to the same path
// (seconds apart), so legitimate revisits still emit.
let lastFiredKey: string | null = null
let lastFiredAt = 0

export function useAnalyticsPageView(isAuthenticated: boolean): void {
  const location = useLocation()

  useEffect(() => {
    if (typeof window === 'undefined') return
    if (typeof window.gtag !== 'function') return
    if (!isPublicPath(location.pathname) && !isAuthenticated) return

    const key = `${location.pathname}${location.search}|${isAuthenticated}`
    const now = Date.now()
    if (lastFiredKey === key && now - lastFiredAt < 100) return
    lastFiredKey = key
    lastFiredAt = now

    window.gtag('event', 'page_view', {
      page_path: location.pathname + location.search,
      page_location: window.location.href,
      page_title: document.title,
    })
  }, [location.pathname, location.search, isAuthenticated])
}
