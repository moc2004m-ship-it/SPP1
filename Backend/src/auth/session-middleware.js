'use strict';

// Extracted from routes/auth.routes.js so platform.routes.js (and tests)
// can depend on the real session-check logic without pulling in express.
// Behaviour is unchanged: a valid, non-revoked Bearer session token is
// required, and req.session is set from the authenticated session record.

function getBearer(req) {
  const value = (req.headers && req.headers.authorization) || '';
  return value.startsWith('Bearer ') ? value.slice(7) : null;
}

// Stage 34 -- smallest additive change required to make a soft-deleted
// account (see ../database/repositories/account.repository.js's
// softDelete()) truly unusable, not just logged out of its sessions at
// the moment of deletion.
//
// Why revokeAllSessions() alone (in ../services/settings.service.js's
// deleteAccount()) is NOT enough: it only revokes sessions that exist
// at the instant of deletion. It does nothing to stop the SAME account
// id from authenticating again afterwards -- e.g. via
// AuthStore#findOrCreatePhoneAccount()/findOrCreateSocialAccount(),
// which look up the identity mapping and hand back a session for
// whatever account id is already on file, deleted or not, then
// AuthStore#createSession() would happily mint a brand-new, perfectly
// valid, non-revoked session for a deleted account. Without this check
// that new session would pass authenticate() (it only checks
// revokedAt) and reach every protected route normally.
//
// The fix is here, not in AuthStore#authenticate(), because
// authenticate() is a synchronous, storage-agnostic session lookup used
// in several places (including tests that construct an AuthStore with
// no accountRepository at all); requireSession() is the one place that
// already always has both the session store and the account repository
// (`auth.accounts`, set in the AuthStore constructor) and already sits
// on the request path for every protected route. This does not change
// AuthStore#authenticate()'s behavior or signature at all -- purely
// additive.
// Returns the promise chain (in addition to the usual express
// side-effects of calling res/next) purely so tests can `await` it
// deterministically instead of racing a microtask -- express itself
// ignores a middleware's return value, so this is safe in production.
// Stage 5 completion (this session) -- AuthStore#authenticate() is now
// async (see ../auth.store.js's header: it awaits its repository call so
// a Postgres-backed auth repository works, not just the in-memory one).
// requireSession() already returned a promise chain for the
// account-lookup half; it now also awaits the session lookup itself,
// same fail-closed behavior as before (no session/account -> 401), and
// still resolves/rejects through the same paths so every existing
// caller (routes mounting this middleware, and tests that already
// `await requireSession(auth)(...)`) is unaffected.
function requireSession(auth) {
  return (req, res, next) => Promise.resolve(auth.authenticate(getBearer(req)))
    .then((session) => {
      if (!session) {
        res.status(401).json({ error: 'unauthorized' });
        return null;
      }
      return Promise.resolve(auth.accounts.findById(session.accountId))
        .then((account) => {
          if (!account || account.deletedAt) {
            res.status(401).json({ error: 'unauthorized' });
            return;
          }
          req.session = session;
          next();
        });
    })
    .catch(next);
}

module.exports = { requireSession, getBearer };
