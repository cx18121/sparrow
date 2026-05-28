// GA4 dataLayer queue initializer. The async gtag.js library consumes this
// once it loads. Lives in /public so it satisfies CSP `script-src 'self'`
// (inline blocks are rejected in prod).
//
// `send_page_view: false` disables GA's automatic initial pageview so we
// can fire pageviews manually from React (see useAnalyticsPageView). This
// drops bot pollution on auth-walled routes — bots hit /dashboard, fire
// the auto pageview, and exit before AuthContext redirects them. Manual
// firing lets us gate on (public path OR authenticated).
window.dataLayer = window.dataLayer || [];
window.gtag = function gtag(){ window.dataLayer.push(arguments); };
window.gtag('js', new Date());
window.gtag('config', 'G-HP498BKBTX', { send_page_view: false });
