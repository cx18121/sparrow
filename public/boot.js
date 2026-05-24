// Render-first-authenticate-second pre-paint hint: if a Supabase session is
// in localStorage, mark <html> so the inline critical CSS paints the sidebar
// placeholder before the JS bundle parses. Lives in /public so it satisfies
// the production CSP `script-src 'self'` (inline blocks are rejected).
(function () {
  try {
    var keys = Object.keys(localStorage);
    for (var i = 0; i < keys.length; i++) {
      if (/^sb-.+-auth-token$/.test(keys[i]) && localStorage.getItem(keys[i])) {
        document.documentElement.classList.add('app-logged-in');
        return;
      }
    }
  } catch (e) {}
})();
