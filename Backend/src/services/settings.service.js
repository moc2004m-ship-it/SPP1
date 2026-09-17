'use strict';

// Stage 34 — General Settings service.
//
// The ONLY code path allowed to read/write a user's five real settings
// preferences, soft-delete an account, or serve Terms/Help content. Same
// split as every other Phase 5 service here: ../database/repositories/
// settings.repository.js is a plain data-integrity layer with no opinion
// on who may do what -- every rule below lives here.
//
// Ownership: get()/set() always take `actingAccountId` (always
// req.session.accountId from the route layer, never trusted from a
// client-supplied field) and a `userId` target, and reject
// (403 forbidden) unless they match -- same "you may only act on your
// own data" discipline as couple.service.js/guard.service.js/
// notification.service.js. deleteAccount() takes only actingAccountId --
// there is no target id at all, by design, same as auth.routes.js's
// /auth/logout (a session can only ever act on itself here).
//
// SCOPE (see STAGE_34_FINAL_REPORT.md for the full gap analysis): the
// original Stage 34 list has far more items than "language/sound/mic/
// network/media". Every other item already has a real, complete
// implementation from an earlier stage:
//   - Account            -> Stage 7  ../feature-platform.js's `profile`
//   - Privacy             -> Stage 8  `profile.updatePrivacy()`
//   - Notifications       -> Stage 33 ./notification.service.js
//   - Devices             -> Stage 5  ../auth/auth.store.js (sessions)
//   - Login/Password/OTP  -> Stage 5  ../routes/auth.routes.js
//   - Logout              -> Stage 5  POST /auth/logout
//   - Block/Security      -> Stage 10 `platform.social.block()`
//   - Report              -> Stage 35 `platform.moderation.report()`
// This service deliberately does NOT reimplement any of the above -- a
// General Settings screen calls those real endpoints directly. Only
// Delete Account and Terms/Help had no prior implementation anywhere in
// the repository, so they are implemented here for real (see below).

const {
  SETTING_KEYS,
  DEFAULT_SETTINGS,
  validateSettingValue,
} = require('../database/models/settings.model');
const { TERMS_CONTENT, HELP_CONTENT, FAQ_CONTENT } = require('../domain/legal-content');

function badRequest(message) {
  return Object.assign(new Error(message), { status: 400 });
}
function forbidden(message) {
  return Object.assign(new Error(message), { status: 403 });
}

function assertOwnUser(actingAccountId, userId) {
  if (!actingAccountId) throw forbidden('authentication required');
  if (actingAccountId !== userId) throw forbidden('you may only access your own settings');
}

// `settings` (required): ../database/repositories/settings.repository.js
// instance -- the only place preference data lives.
// `accounts` (required): ../database/repositories/account.repository.js
// instance -- needed for deleteAccount()'s softDelete().
// `authStore` (required): ../auth/auth.store.js instance -- needed for
// deleteAccount()'s revokeAllSessions().
// `now` (optional): injected clock, same testability pattern as
// guard.service.js/couple.service.js.
function createSettingsService({ settings, accounts, authStore, now = () => new Date() }) {
  if (!settings) throw new Error('settings repository is required');
  if (!accounts) throw new Error('accounts repository is required');
  if (!authStore) throw new Error('authStore is required');

  return {
    // Real update-in-place: validates key+value, then upserts. Returns
    // the single current record for that key (never an array, never a
    // history) -- the append-only primitive this replaces is gone.
    async set(actingAccountId, userId, key, value) {
      assertOwnUser(actingAccountId, userId);
      if (typeof key !== 'string' || !key) throw badRequest('key is required');
      const normalizedValue = validateSettingValue(key, value);
      const record = await settings.upsert(userId, key, normalizedValue, now());
      return { key: record.key, value: record.value, updatedAt: record.updatedAt };
    },

    // Real read: every one of the five known keys is always present in
    // the response (falling back to DEFAULT_SETTINGS for a key the user
    // has never set) -- a client never has to special-case "missing".
    // Deliberately returns only the effective values, not raw storage
    // rows, so `network`/`media`/etc. are never confused with real,
    // separately-owned domain records (e.g. notification preferences).
    async get(actingAccountId, userId) {
      assertOwnUser(actingAccountId, userId);
      const rows = await settings.listForUser(userId);
      const byKey = new Map(rows.map((r) => [r.key, r]));
      const result = {};
      for (const key of SETTING_KEYS) {
        result[key] = byKey.has(key) ? byKey.get(key).value : DEFAULT_SETTINGS[key];
      }
      return result;
    },

    // Stage 34 — Delete Account. SAFE soft delete only (explicit
    // instruction): marks the account deleted and force-revokes every
    // active session. Does NOT touch wallet/room/family/chat/
    // notifications/settings/etc. data belonging to the account -- those
    // rows are simply left in place, still correctly attributed to this
    // (now-deleted) accountId, exactly as every other stage already
    // handles a referenced id it doesn't own. Idempotent: deleting an
    // already-deleted account is a real no-op (accounts.softDelete()
    // itself is idempotent; revokeAllSessions() naturally returns 0 once
    // nothing is left to revoke).
    async deleteAccount(actingAccountId) {
      if (!actingAccountId) throw forbidden('authentication required');
      const account = await accounts.softDelete(actingAccountId);
      const sessionsRevoked = await authStore.revokeAllSessions(actingAccountId);
      return { accountId: actingAccountId, deletedAt: account.deletedAt, sessionsRevoked };
    },

    // Terms/Help -- real, deterministic, server-served static content
    // (see ../domain/legal-content.js). No CMS, no database-backed CRUD,
    // no admin editor -- exactly as instructed. Requires a session (same
    // as everything else under /platform) because it is served from
    // inside the General Settings screen; it is plain content, not a
    // per-user record, so there is no ownership check to make here.
    getTerms() {
      return TERMS_CONTENT;
    },
    getHelp() {
      return HELP_CONTENT;
    },

    // Stage 35 Part 8/8 -- Customer Support FAQ. Same static-content
    // discipline as getTerms()/getHelp() directly above (see
    // ../domain/legal-content.js#FAQ_CONTENT for why this is not a CMS).
    getFaq() {
      return FAQ_CONTENT;
    },
  };
}

module.exports = { createSettingsService };
