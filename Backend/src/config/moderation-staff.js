'use strict';

// Stage 35 Part 6/8 -- Content Review reviewer authorization.
//
// AUDIT FINDING (see STAGE_35_CONTENT_REVIEW_FINAL_REPORT.md section 4):
// this codebase has exactly one protected role anywhere -- room owner
// (room-scoped, see platform.guards.js#requireRoomOwner). There is no
// global staff/admin/moderator concept on the account model
// (database/models/account.model.js has no role field of any kind) and
// no staff login/session type distinct from a normal account session.
//
// Content Review needs *some* real, server-side-only way to know which
// authenticated accounts are allowed to see/act on the review queue.
// Per this work package's instruction ("if no staff runtime exists,
// implement only genuine domain/service/repository infrastructure; do
// NOT fake a staff login"), this file does NOT invent a staff login,
// a fake session type, or treat every authenticated account as a
// reviewer. It implements exactly one real, minimal, honest mechanism:
// a server-only allowlist of account ids, configured via an environment
// variable on the Backend host (never sent by, or readable from, a
// client) -- same "pure function of env, defaults to process.env, unit
// testable without mutating the real environment" pattern already used
// by ../push/push-config.js#loadPushConfigFromEnv and
// ../rtc/agora-config.js#loadAgoraConfigFromEnv.
//
// MODERATION_REVIEWER_IDS: comma-separated list of account ids
// authorized to use the review queue. Not set in this sandbox (no
// review staff exist here) -- see the Final Report's "Environment
// limitations" section. A real deployment sets this to the actual
// account ids of its content-review staff.
//
// Explicitly OUT OF SCOPE for this work package (documented, not
// silently skipped): a self-service "grant/revoke reviewer" API/UI.
// Nothing in the Part 6 instructions asked for staff-management
// tooling, and building one would be exactly the kind of invented,
// unrequested subsystem the instructions ask NOT to build. If a future
// stage needs reviewers to be grantable at runtime instead of only via
// deployment config, that is new, explicitly-scoped work for that
// stage -- not assumed here.
function loadReviewerIdsFromEnv(env = process.env) {
  const raw = (env.MODERATION_REVIEWER_IDS || '').trim();
  if (!raw) return new Set();
  return new Set(
    raw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
  );
}

// Pure check, never trusts anything from a request -- `reviewerIds` is
// always the server-loaded Set above (or a test-injected Set), never a
// client-supplied role/reviewerId field. See feature-platform.js's
// moderation.review._requireReviewer(), which is the only caller.
function isReviewer(reviewerIds, accountId) {
  return !!accountId && reviewerIds instanceof Set && reviewerIds.has(accountId);
}

module.exports = { loadReviewerIdsFromEnv, isReviewer };
