// GA4 dataLayer queue initializer. The async gtag.js library consumes this
// once it loads. Lives in /public so it satisfies CSP `script-src 'self'`
// (inline blocks are rejected in prod).
window.dataLayer = window.dataLayer || [];
function gtag(){dataLayer.push(arguments);}
gtag('js', new Date());
gtag('config', 'G-HP498BKBTX');
