'use strict';

// Baseline security headers, hand-rolled instead of pulling in `helmet`
// (no network access to `npm install` in this sandbox -- same reasoning
// as ./rate-limit.js). Closes the "no security headers at all" gap noted
// in the audit. This is a JSON API with no server-rendered HTML, so the
// header set is deliberately small and aimed at the risks that actually
// apply here (MIME sniffing, being framed, referrer leakage, caching of
// authenticated responses) rather than a full CSP meant for HTML pages.
function securityHeaders() {
  return (req, res, next) => {
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('X-Frame-Options', 'DENY');
    res.set('Referrer-Policy', 'no-referrer');
    // Authenticated JSON responses (accounts, wallet, sessions, etc.)
    // must never be cached by a shared/browser cache.
    res.set('Cache-Control', 'no-store');
    if (req.secure) {
      res.set('Strict-Transport-Security', 'max-age=15552000; includeSubDomains');
    }
    next();
  };
}

module.exports = { securityHeaders };
