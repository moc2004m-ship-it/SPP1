'use strict';

// Minimal, dependency-free sliding-window rate limiter.
//
// Why hand-rolled instead of `express-rate-limit`: this sandbox has no
// network access to `npm install`, so adding a new dependency would be
// unusable here and untestable until a real environment installs it.
// This has zero dependencies and works today, in-memory, per-process --
// same limitation as every other InMemory* store in this build (does not
// survive a restart, does not share state across multiple instances; a
// real deployment should move this to Redis, same note as the wallet/
// session stores).
//
// Used to close the gap flagged in the audit: OTP request endpoints had
// no limiter at all, so a client could spam `/auth/otp/request` and
// `/auth/recovery/otp/request` without bound (SMS-bombing / cost abuse).

function createRateLimiter({ windowMs, max, keyFn }) {
  const hits = new Map(); // key -> array of timestamps (ms)

  function prune(list, now) {
    while (list.length && now - list[0] > windowMs) list.shift();
    return list;
  }

  return function rateLimit(req, res, next) {
    const key = keyFn(req);
    const now = Date.now();
    const list = prune(hits.get(key) || [], now);
    if (list.length >= max) {
      const retryAfterSeconds = Math.ceil((windowMs - (now - list[0])) / 1000);
      res.set('Retry-After', String(Math.max(retryAfterSeconds, 1)));
      return res.status(429).json({ error: 'too_many_requests' });
    }
    list.push(now);
    hits.set(key, list);
    next();
  };
}

// Keyed by phone number (from the parsed body) combined with the caller's
// IP, so one abusive IP cannot exhaust another phone number's budget and
// vice versa. Falls back to IP alone if the phone isn't parseable yet
// (the route's own validation still runs afterward and can 400 it).
function otpRequestLimiter({ windowMs = 10 * 60 * 1000, max = 5 } = {}) {
  return createRateLimiter({
    windowMs,
    max,
    keyFn: (req) => `${req.ip || req.socket?.remoteAddress || 'unknown'}:${req.body?.phone || ''}`,
  });
}

module.exports = { createRateLimiter, otpRequestLimiter };
