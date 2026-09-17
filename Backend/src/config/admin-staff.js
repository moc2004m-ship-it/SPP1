'use strict';

// Stage 29 completion (this session) -- Inventory admin-grant authorization.
//
// Same real gap, and same fix, as ../config/moderation-staff.js (Stage 35
// Part 6): this codebase has no general staff/admin runtime anywhere (no
// role field on the account model, no staff login/session type distinct
// from a normal account session -- see that file's header for the full
// audit note, which still holds true as of this session). POST
// /api/inventory/grant needs *some* real, server-side-only way to know
// which authenticated accounts may grant inventory to another account
// without a real purchase/recharge/gift behind it.
//
// This file does NOT invent a staff login, a fake session type, or trust
// any role/isAdmin field a client could send. It implements exactly the
// same minimal, honest mechanism moderation-staff.js already uses for
// reviewers: a server-only allowlist of account ids, configured via an
// environment variable on the Backend host (never sent by, or readable
// from, a client) -- the same "pure function of env, defaults to
// process.env, unit testable without mutating the real environment"
// pattern as loadReviewerIdsFromEnv() here, loadPushConfigFromEnv()
// (../push/push-config.js) and loadAgoraConfigFromEnv()
// (../rtc/agora-config.js).
//
// INVENTORY_ADMIN_IDS: comma-separated list of account ids authorized to
// grant inventory to another account via POST /api/inventory/grant. Not
// set in this sandbox (no admin staff exist here) -- a real deployment
// sets this to the actual account ids of its trusted store/ops admins.
//
// This is deliberately a SEPARATE allowlist from MODERATION_REVIEWER_IDS
// (content-review authorization and inventory-grant authorization are
// different responsibilities held by different people in a real
// deployment) rather than reusing/widening the reviewer set. If a future
// stage builds a real general Staff/roles system (Stage 36 in the work
// package's own numbering), THAT should become the source of truth for
// this check instead -- swapping loadAdminIdsFromEnv()'s result for a
// real roles lookup is a one-line change at the call site in
// ../index.js; nothing above this file's boundary needs to change.
function loadAdminIdsFromEnv(env = process.env) {
  const raw = (env.INVENTORY_ADMIN_IDS || '').trim();
  if (!raw) return new Set();
  return new Set(
    raw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
  );
}

// Pure check, never trusts anything from a request -- `adminIds` is
// always the server-loaded Set above (or a test-injected Set), never a
// client-supplied role/isAdmin field. See
// ../services/inventory-admin.service.js#grant, the only caller.
function isAdmin(adminIds, accountId) {
  return !!accountId && adminIds instanceof Set && adminIds.has(accountId);
}

module.exports = { loadAdminIdsFromEnv, isAdmin };
