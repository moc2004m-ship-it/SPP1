'use strict';

// Stages 6–35 domain foundation. This module is intentionally provider-neutral:
// persistence/realtime/payment/RTC/push adapters are injected later, never faked.

const crypto = require('node:crypto');
const { InMemoryFeatureRecordRepository } = require('./database/repositories/feature-record.repository');
const { generateReferralCode, assertNotSelfReferral } = require('./database/models/referral.model');
// Stage 12 -- Create Room. See these three files' own headers for why
// each concern lives where it does (fixed enums vs free-form validation
// vs password hashing).
const { resolveTheme, resolveCategory, resolveLanguage, resolveAgeRule, ROOM_CATEGORIES } = require('./domain/room-catalog');
const {
  assertValidVisibility, assertValidMicSeats, normalizeTags,
  assertValidImageUrl, assertValidAnnouncement, assertValidPassword,
  sanitizeRoomForClient,
} = require('./database/models/room.model');
const { hashRoomPassword, verifyRoomPassword } = require('./security/room-password');
// Stage 9 -- Search's Game Search reuses the real Stage 19 game
// REGISTRY (see that file's own header: fixed catalog, no game logic).
// listGames() is a pure read of the fixed catalog -- nothing in Stage
// 19-22's actual game logic is touched or imported here.
const { listGames } = require('./domain/game-catalog');
// Stage 35 Part 4/8 -- Word Filter. Centralized implementation lives in
// ./services/word-filter.service.js (reused here, not reimplemented).
// Applied below only to the free-form user-facing text fields this
// audit identified (room name, profile name, profile bio) -- see
// STAGE_35_WORD_FILTER_FINAL_REPORT.md section 8 for the full content-
// path list and which fields were intentionally left out.
const { assertCleanContent } = require('./services/word-filter.service');
// Stage 35 Part 6/8 -- Content Review reviewer authorization. See
// ./config/moderation-staff.js's header for the full audit/rationale:
// no staff/admin role exists anywhere in this codebase, so this is a
// real, server-only, env-configured allowlist -- never a fake login.
const { loadReviewerIdsFromEnv, isReviewer } = require('./config/moderation-staff');
// Stage 36 -- central Staff/Roles/Permissions system. See its header for
// why this is additive/OR'd with the legacy `reviewers` allowlist above,
// not a replacement of it.
const { loadStaffFromEnv, hasPermission, PERMISSIONS } = require('./security/staff');
// Stage 17 -- Music/DJ. Validation lives in ./database/models/music.model.js
// (structural checks + bounds), same split as room.model.js/chat.model.js --
// the `music` domain below only orchestrates it.
const {
  assertValidTrackTitle, assertValidTrackUrl, assertValidDurationSeconds,
  assertValidVolume, DEFAULT_VOLUME,
} = require('./database/models/music.model');
// Stage 7 completion (this session) -- profile.getFull() below composes in
// real Family title/badges (same pure threshold function Stage 30 already
// uses on the real per-membership `contribution` counter, never a new
// number) and real Couple status, exactly the same "public standing"
// treatment already given to lvl/vip/svip a few lines below. No new
// stage/economy logic is added here -- these are read-only compositions of
// numbers Stage 30/32 already compute and persist.
const { titleForContribution, badgesForContribution } = require('./domain/family-titles');
const STAGES = Object.freeze({
  6:'Home',7:'Profile',8:'Profile Actions + Privacy',9:'Search',10:'Friends + Follow',
  11:'Private Chat',12:'Create Room',13:'Room Entry/Join/Leave/Reconnect',14:'Mic/Seats',
  15:'Room Settings',16:'Host/Moderator + Room Chat',17:'Music/DJ',18:'PK/Battles',
  19:'Room Game Center',20:'Ludo + Carrom',21:'Snakes & Ladders + Quiz',22:'Chess + Eight Ball + Domino',
  23:'Referral + Room-in-Room',24:'Wallet',25:'Recharge/Google Play Billing',26:'Gifts + Gift Wall',
  27:'VIP + SVIP',28:'LVL/XP + Charm/Wealth',29:'Store + Inventory',30:'Family',
  31:'Rankings + Events',32:'Couple/CP + Guard/Fan Club',33:'Notifications + Push',34:'General Settings',35:'Moderation + Support'
});

const id = prefix => `${prefix}_${crypto.randomUUID()}`;
const now = () => new Date().toISOString();
// Stage 35 Part 8/8 -- Customer Support. Small validated catalogs (this
// work package's section 5/6) -- never arbitrary client-supplied
// strings. Types chosen to cover the real domains already in this
// codebase (account/profile, wallet/recharge/gifts billing, RTC/technical,
// room, or anything else); statuses are the standard support-ticket
// lifecycle this work package names as an example, with valid
// transitions enforced server-side only (see `support.setStatus` below).
const TICKET_TYPES = ['account', 'billing', 'technical', 'room', 'gift_wallet', 'other'];
const TICKET_STATUSES = ['open', 'in_progress', 'waiting_user', 'resolved', 'closed', 'escalated'];
const TICKET_STATUS_TRANSITIONS = {
  open: ['in_progress', 'escalated', 'closed'],
  in_progress: ['waiting_user', 'resolved', 'escalated', 'closed'],
  waiting_user: ['in_progress', 'resolved', 'escalated', 'closed'],
  escalated: ['in_progress', 'resolved', 'closed'],
  resolved: ['closed'],
  closed: [],
};
// Stage 13 -- how long a 'disconnected' room membership stays resumable via
// reconnect() before it must go through join() again as a fresh session.
const RECONNECT_GRACE_MS = 5 * 60 * 1000;

// Phase 2 -- FeatureStore is now a thin async wrapper around a real
// repository (see database/repositories/feature-record.repository.js)
// instead of an in-process array. Every domain method below (rooms,
// battles, games, ...) is unchanged -- they all just `return
// store.add(...)`/`store.list(...)`/`store.find(...)`, which now resolve
// through real persistence. Callers (routes, tests) must await them.
class FeatureStore {
  constructor(repository = new InMemoryFeatureRecordRepository()) {
    this._repository = repository;
  }
  async add(stage, value) {
    const item = { ...value, id: value.id || id(`s${stage}`), createdAt: value.createdAt || now(), updatedAt: now() };
    return this._repository.add(stage, item);
  }
  async list(stage, predicate = () => true) {
    const all = await this._repository.list(stage);
    return all.filter(predicate);
  }
  async find(stage, predicate) {
    const all = await this._repository.list(stage);
    return all.find(predicate) || null;
  }
  // Phase 6 -- real state transitions (friend accept/reject, seat
  // approve/mute, room-membership kick, referral redemption). See
  // ./database/repositories/feature-record.repository.js#update. Throws if
  // the record doesn't exist so callers get a clear 404 instead of a
  // silent no-op.
  async update(stage, itemId, patch) {
    const updated = await this._repository.update(stage, itemId, patch);
    if (!updated) throw Object.assign(new Error('record not found'), { status: 404 });
    return updated;
  }
}

function requireString(value, name, max=500) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Error(`${name} is invalid`);
  return value.trim();
}
function requireId(value, name='id') { return requireString(value,name,200); }

// Stage 33 -- `notificationService` is an OPTIONAL constructor dependency,
// same additive pattern as `accounts` above and as `eventService`/
// `coupleService` in gifts.service.js: when provided, a real completed
// action below reports a real notification via
// ../services/notification.service.js's notify(); when omitted, behavior
// is byte-for-byte identical to before this stage. notify() itself never
// throws on a failed/blocked push (see that file's header), and this file
// never lets a notify() failure affect the real state transition it is
// reporting -- notify() is always called AFTER the real store mutation
// above it has already succeeded, and any error from notify() would only
// ever be a bug in notify() itself, not an expected outcome to guard
// against here (unlike push delivery, which notify() already isolates).
// Stage 35 Part 6/8 -- `reviewerIds` is an OPTIONAL constructor
// dependency, same additive pattern as `notificationService`/`clock`
// above: when provided (tests inject a plain Set), it is used as-is;
// when omitted (real server bootstrap, see ../index.js), it defaults to
// the real env-configured allowlist via loadReviewerIdsFromEnv(). Either
// way it is a genuine, server-side-only Set of account ids -- never
// derived from, or overridable by, anything in a request.
// Stage 7 completion (this session) -- `couples` and `gifts` are likewise
// OPTIONAL constructor dependencies, same additive pattern as `families`
// just above (and as `accounts`/`notificationService` everywhere in this
// file): when provided, profile.getFull() further below composes in real
// Couple status and real Gifts-received totals; when omitted, behavior is
// byte-for-byte identical to before this change (both fields simply don't
// appear, same as `family`/`lvl`/`vip`/`svip` already do when `families`/
// `accounts` are omitted).
function createPlatform({ store, accounts, notificationService, clock, reviewerIds, staffRoles, families, couples, gifts, musicBus, auditService } = {}) {
  store = store || new FeatureStore();
  const reviewers = reviewerIds instanceof Set ? reviewerIds : loadReviewerIdsFromEnv();
  // Stage 36 -- `staffRoles` is an OPTIONAL constructor dependency, same
  // additive pattern as `reviewerIds` just above: tests inject a plain
  // Map, real server bootstrap (../index.js) omits it and gets the real
  // env-configured STAFF_ROLES via loadStaffFromEnv().
  const staff = staffRoles instanceof Map ? staffRoles : loadStaffFromEnv();
  // Stage 10/8 -- `social` is declared as a local const BEFORE the
  // returned object (instead of an inline object-literal property) purely
  // so Stage 7's `profile.getFull()` further below can call
  // `social.allowed()` for its block check via normal closure -- object
  // literals can't reference a sibling property from within another
  // sibling being built in the same literal. Behavior of every
  // pre-existing method is unchanged.
  const social = {
        async follow(userId,targetId) {
          requireId(userId,'userId'); requireId(targetId,'targetId');
          // Stage 10 audit fix -- self-follow prevention (requirement:
          // "self-follow إذا كان غير مسموح"). Deliberately not merged into
          // allowed()/block's userId===targetId convention above (block/mute
          // stay self-permitted by design, see their own comments) --
          // following yourself has no product meaning, unlike self-block.
          if (userId === targetId) throw Object.assign(new Error('you cannot follow yourself'), { status: 400 });
          const ok = await social.allowed(userId, targetId, 'follow');
          if (!ok) throw Object.assign(new Error('you cannot follow this account'), { status: 403 });
          // Stage 10 audit fix -- duplicate-follow prevention. follow() had
          // no find-before-write guard (unlike block()/muteUser() below),
          // so calling it twice created two separate active follow records
          // for the same pair, inflating followersCount. Same idempotent
          // pattern as block(): an existing active follow is returned as-is.
          const existingFollow = await store.find(10, x => x.userId===userId && x.targetId===targetId && x.type==='follow' && x.status==='active');
          if (existingFollow) return existingFollow;
          const record = await store.add(10,{userId,targetId,type:'follow',status:'active'});
          // Stage 35 Part 3/8 -- Mute effect #1: a NEW_FOLLOWER notification is
          // suppressed when the recipient has muted the actor via
          // muteUser()/unmuteUser() below (directional: does the recipient of
          // this notification currently mute the account that just acted).
          // The follow record itself is unaffected -- muting never changes
          // who follows whom, only whether the target is notified about it.
          if (notificationService && !(await social.isUserMuted(targetId, userId))) {
            await notificationService.notify({ recipientId: targetId, type: 'NEW_FOLLOWER', payload: { accountId: userId } });
          }
          return record;
        },
        // Stage 8 -- real unfollow: was entirely missing before (only
        // follow() existed), so followersCount could only ever grow.
        // Flips every active follow record from userId->targetId to a
        // 'removed' status instead of deleting it, matching this file's
        // existing append/patch-only pattern (see store.update() doc
        // above) -- consistent with reject()/decline() elsewhere never
        // hard-deleting a record either.
        async unfollow(userId,targetId) {
          requireId(userId,'userId'); requireId(targetId,'targetId');
          const record = await store.find(10, x => x.userId===userId && x.targetId===targetId && x.type==='follow' && x.status==='active');
          if (!record) throw Object.assign(new Error('you are not following this account'), { status: 404 });
          return store.update(10, record.id, { status: 'removed' });
        },
        async friend(userId,targetId) {
          requireId(userId,'userId'); requireId(targetId,'targetId');
          // Stage 10 audit fix -- request-to-self prevention.
          if (userId === targetId) throw Object.assign(new Error('you cannot send a friend request to yourself'), { status: 400 });
          const ok = await social.allowed(userId, targetId, 'friend');
          if (!ok) throw Object.assign(new Error('you cannot send a friend request to this account'), { status: 403 });
          // Stage 10 audit fix -- duplicate-request prevention. friend() had
          // no guard at all, so the same pair could accumulate multiple
          // pending requests, and a request could be sent even after the
          // two accounts were already friends. Checked in both directions
          // since a pending/accepted record from either side represents the
          // same real-world relationship.
          const existingEitherWay = await store.find(10, x => x.type==='friend' && x.status!=='rejected' && ((x.userId===userId && x.targetId===targetId) || (x.userId===targetId && x.targetId===userId)));
          if (existingEitherWay) {
            if (existingEitherWay.status === 'accepted') throw Object.assign(new Error('you are already friends with this account'), { status: 409 });
            return existingEitherWay;
          }
          const record = await store.add(10,{userId,targetId,type:'friend',status:'pending'});
          // Stage 35 Part 3/8 -- Mute effect #2, same directional suppression
          // as follow() above.
          if (notificationService && !(await social.isUserMuted(targetId, userId))) {
            await notificationService.notify({ recipientId: targetId, type: 'FRIEND_REQUEST', payload: { requestId: record.id } });
          }
          return record;
        },
        // Stage 35 Part 2/8 -- Block, audited and completed on top of the
        // pre-existing Stage 8/10 owner. block() itself already validated
        // and persisted for real (store.add(8, ...)); the two real gaps
        // found on audit, fixed here:
        //   1. block() was not idempotent -- calling it twice created two
        //      separate 'active' records for the same pair. Now mirrors
        //      the find-before-write idempotency this file already uses
        //      elsewhere (e.g. profile.create()/upsert-style records):
        //      an existing active block is returned as-is rather than
        //      duplicated, so unblock() (below) always has exactly one
        //      active record to resolve, and "duplicate block behavior is
        //      deterministic" (see this stage's test list) holds.
        //   2. There was no unblock() at all -- block() existed but the
        //      relationship could never be reversed. Added as the exact
        //      symmetric counterpart to unfollow() above: same file, same
        //      object, same status-flip-not-delete pattern, same 404 when
        //      there is nothing active to remove.
        // Self-block is left unrestricted, matching this file's existing
        // convention for follow()/friend() (neither rejects userId===targetId
        // either); getFull() above already skips the block check entirely
        // for isOwner, so a self-block can never lock a user out of their
        // own profile.
        async block(userId,targetId) {
          requireId(userId,'userId'); requireId(targetId,'targetId');
          const existing = await store.find(8, x => x.userId===userId && x.targetId===targetId && x.type==='block' && x.status==='active');
          if (existing) return existing;
          return store.add(8,{userId,targetId,type:'block',status:'active'});
        },
        async unblock(userId,targetId) {
          requireId(userId,'userId'); requireId(targetId,'targetId');
          const record = await store.find(8, x => x.userId===userId && x.targetId===targetId && x.type==='block' && x.status==='active');
          if (!record) throw Object.assign(new Error('you have not blocked this account'), { status: 404 });
          return store.update(8, record.id, { status: 'removed' });
        },
        async allowed(userId,targetId,action) { const [blockedByTarget, blockedByUser] = await Promise.all([store.find(8,x=>x.type==='block'&&x.userId===targetId&&x.targetId===userId&&x.status==='active'), store.find(8,x=>x.type==='block'&&x.userId===userId&&x.targetId===targetId&&x.status==='active')]); return !blockedByTarget && !blockedByUser; },
        async accept(userId, requestId) {
          requireId(userId,'userId'); requireId(requestId,'requestId');
          const record = await store.find(10, x => x.id === requestId);
          if (!record) throw Object.assign(new Error('request not found'), { status: 404 });
          if (record.type !== 'friend') throw Object.assign(new Error('only friend requests can be accepted'), { status: 400 });
          if (record.targetId !== userId) throw Object.assign(new Error('only the recipient can accept this request'), { status: 403 });
          if (record.status !== 'pending') throw Object.assign(new Error(`request is already ${record.status}`), { status: 409 });
          const updated = await store.update(10, requestId, { status: 'accepted' });
          // Stage 35 Part 3/8 -- Mute effect #3, same directional suppression
          // as follow()/friend() above (here the original requester,
          // record.userId, is the one being notified that userId accepted).
          if (notificationService && !(await social.isUserMuted(record.userId, userId))) {
            await notificationService.notify({ recipientId: record.userId, type: 'FRIEND_ACCEPTED', payload: { accountId: userId } });
          }
          return updated;
        },
        async reject(userId, requestId) {
          requireId(userId,'userId'); requireId(requestId,'requestId');
          const record = await store.find(10, x => x.id === requestId);
          if (!record) throw Object.assign(new Error('request not found'), { status: 404 });
          if (record.type !== 'friend') throw Object.assign(new Error('only friend requests can be rejected'), { status: 400 });
          if (record.targetId !== userId) throw Object.assign(new Error('only the recipient can reject this request'), { status: 403 });
          if (record.status !== 'pending') throw Object.assign(new Error(`request is already ${record.status}`), { status: 409 });
          return store.update(10, requestId, { status: 'rejected' });
        },
        async mute(userId, relationId) {
          requireId(userId,'userId'); requireId(relationId,'relationId');
          const record = await store.find(10, x => x.id === relationId);
          if (!record) throw Object.assign(new Error('relation not found'), { status: 404 });
          if (record.userId !== userId && record.targetId !== userId) throw Object.assign(new Error('you are not part of this relation'), { status: 403 });
          return store.update(10, relationId, { muted: true });
        },
        async unmute(userId, relationId) {
          requireId(userId,'userId'); requireId(relationId,'relationId');
          const record = await store.find(10, x => x.id === relationId);
          if (!record) throw Object.assign(new Error('relation not found'), { status: 404 });
          if (record.userId !== userId && record.targetId !== userId) throw Object.assign(new Error('you are not part of this relation'), { status: 403 });
          return store.update(10, relationId, { muted: false });
        },
        // Stage 35 Part 3/8 -- Mute (a user, not a relation).
        //
        // AUDIT NOTE: this file already had a `mute`/`unmute` pair (directly
        // above) from Stage 10, but that pair operates on an EXISTING
        // follow/friend relation id (`store.find(10, x => x.id === relationId)`)
        // and only flips a `muted` boolean used for that relation's own
        // notifications -- it requires the two accounts to already have a
        // relation, and it is not user-to-user in the way Block (Part 2/8)
        // is. It does not cover "mute this account" as a standalone action
        // reachable from a profile the way Block is, and a repo-wide search
        // turned up no other user-to-user mute implementation (Mobile has no
        // mute UI at all; room seat mute (`rooms.muteSeat`/`muteMember`,
        // Stage 14/16) and notification-category mute
        // (`notification.service.js`'s `mutedCategories`) are both
        // unrelated, room- and category-scoped concerns, not a user-to-user
        // relationship). So Stage 35 Part 3/8 is genuinely new, not a
        // duplicate of something that already exists.
        //
        // To avoid colliding with the pre-existing Stage 10 `mute`/`unmute`
        // (same object, and already wired to real routes
        // `POST /api/social/:relationId/mute`/`unmute` -- overwriting those
        // names here would silently break that existing, tested feature),
        // this new pair is named `muteUser`/`unmuteUser`. Deliberately
        // modeled on `block()`/`unblock()` directly above (own store
        // record, `type:'mute'`, same status:'active'/'removed' reversible
        // pattern, same find-before-write idempotency, same stage-8
        // partition Block already uses since this is the same kind of
        // "one account's standing profile-level action toward another
        // account" as Block, not a Stage 35-specific record type) --
        // but intentionally NOT identical to Block:
        //   - muteUser() never touches `allowed()`, so it never blocks
        //     follow/friend/profile-view/messaging the way Block does.
        //   - Its only real effect (see follow()/friend()/accept() above
        //     and chat.service.js's sendMessage()) is suppressing
        //     notifications the muter would otherwise receive about the
        //     muted account's actions -- the muted account is never
        //     informed, can still see/follow/message the muter, exactly
        //     like every other product's "mute" (as distinct from "block").
        // Self-mute is left unrestricted, matching this file's existing
        // convention for follow()/friend()/block() (none of them reject
        // userId === targetId).
        async muteUser(userId, targetId) {
          requireId(userId,'userId'); requireId(targetId,'targetId');
          const existing = await store.find(8, x => x.userId===userId && x.targetId===targetId && x.type==='mute' && x.status==='active');
          if (existing) return existing;
          return store.add(8,{userId,targetId,type:'mute',status:'active'});
        },
        async unmuteUser(userId, targetId) {
          requireId(userId,'userId'); requireId(targetId,'targetId');
          const record = await store.find(8, x => x.userId===userId && x.targetId===targetId && x.type==='mute' && x.status==='active');
          if (!record) throw Object.assign(new Error('you have not muted this account'), { status: 404 });
          return store.update(8, record.id, { status: 'removed' });
        },
        // Directional: "does userId currently mute targetId". Used
        // internally (follow/friend/accept above, chat.service.js's
        // sendMessage) to decide whether to suppress a notification to
        // userId about an action taken by targetId. Not part of allowed()
        // -- mute never gates an action, only its notification.
        async isUserMuted(userId, targetId) {
          requireId(userId,'userId'); requireId(targetId,'targetId');
          const record = await store.find(8, x => x.userId===userId && x.targetId===targetId && x.type==='mute' && x.status==='active');
          return !!record;
        }
    };
  return {
    stages: STAGES,
    store,
    home: { tabs:['live','following','popular','new','categories'], entries:['games','events','rankings','family','search','notifications'] },
    social,
    // Stage 7 -- Profile. `create` used to be a pure append, so a second
    // call for the same userId silently produced a second stage-7 record
    // and `get()` (a plain array .find()) kept returning the FIRST/oldest
    // one forever -- a real, previously-undocumented bug: a user editing
    // their profile could never see their own edits reflected. Fixed here
    // with a real find-then-update-or-create (upsert), same store.update()
    // mechanism every other stage already uses for state transitions.
    // `create` is kept as the public method name (routes already call
    // `platform.profile.create`) but now behaves as an upsert.
    profile: {
      async create(input={}) {
        const userId = requireId(input.userId,'userId');
        const existing = await store.find(7, x => x.userId === userId);
        const defaultPrivacy = { profileVisibility:'public', discoverable:true, whoCanMessage:'everyone', showLastSeen:true, whoCanInviteToRoom:'everyone' };
        const patch = {
          userId,
          name: assertCleanContent(requireString(input.name,'name',80), 'name'),
          // Stage 35 Part 4/8 -- bio is optional free text; only run it
          // through the filter when non-empty (an empty/omitted bio was
          // never validated before this stage and still isn't -- this
          // preserves that exact behavior for the common "no bio yet"
          // case).
          bio: input.bio ? assertCleanContent(input.bio, 'bio') : '',
          avatarUrl: input.avatarUrl ? requireString(input.avatarUrl,'avatarUrl',2000) : (existing?.avatarUrl || ''),
          privacy: { ...defaultPrivacy, ...(existing?.privacy||{}), ...(input.privacy||{}) },
        };
        if (existing) return store.update(7, existing.id, patch);
        return store.add(7, patch);
      },
      get(userId) { return store.find(7,x=>x.userId===requireId(userId,'userId')); },
      // Stage 8 -- privacy settings live on the same stage-7 profile
      // record (there is exactly one profile per user); this just merges
      // a partial patch into the existing `privacy` object via the same
      // upsert path as create(), so a profile that doesn't exist yet gets
      // created with defaults + this patch instead of throwing.
      async updatePrivacy(userId, patch={}) {
        requireId(userId,'userId');
        const existing = await store.find(7, x => x.userId === userId);
        return this.create({ userId, name: existing?.name || 'مستخدم', bio: existing?.bio, avatarUrl: existing?.avatarUrl, privacy: { ...(existing?.privacy||{}), ...patch } });
      },
      // Stage 7 -- the real composed profile view: base profile fields +
      // PUBLIC account standing (lvl/vip/svip -- never coins/diamonds,
      // same wallet-privacy rule already enforced on the accounts lookup
      // route, see FINAL_CORRECTED_BUILD_REPORT.md #11) + live social
      // counts computed from the real stage-10 store + privacy/block
      // enforcement. `accounts`/`this` are the same optional constructor
      // dependencies used elsewhere in this file (search.query already
      // uses `accounts` the same way).
      async getFull(viewerId, targetUserId) {
        requireId(viewerId,'viewerId'); requireId(targetUserId,'targetUserId');
        const isOwner = viewerId === targetUserId;
        if (!isOwner) {
          const ok = await social.allowed(viewerId, targetUserId, 'view_profile');
          if (!ok) throw Object.assign(new Error('this profile is not available to you'), { status: 403 });
        }
        const rawProfile = await store.find(7, x => x.userId === targetUserId);
        const privacy = { profileVisibility:'public', discoverable:true, whoCanMessage:'everyone', showLastSeen:true, whoCanInviteToRoom:'everyone', ...(rawProfile?.privacy||{}) };
        const [followers, following, friendsAsUser, friendsAsTarget] = await Promise.all([
          store.list(10, x => x.targetId === targetUserId && x.type === 'follow' && x.status !== 'removed'),
          store.list(10, x => x.userId === targetUserId && x.type === 'follow' && x.status !== 'removed'),
          store.list(10, x => x.userId === targetUserId && x.type === 'friend' && x.status === 'accepted'),
          store.list(10, x => x.targetId === targetUserId && x.type === 'friend' && x.status === 'accepted'),
        ]);
        const isFriend = isOwner || friendsAsUser.some(f => f.targetId === viewerId) || friendsAsTarget.some(f => f.userId === viewerId);
        const base = {
          id: targetUserId,
          name: rawProfile?.name || null,
          avatarUrl: rawProfile?.avatarUrl || '',
        };
        const account = accounts ? await accounts.findById(targetUserId) : null;
        if (account) { base.lvl = account.lvl; base.vip = account.vip; base.svip = account.svip; }
        // Stage 7 completion (this session) -- Family title/badges: same
        // "public standing" tier as lvl/vip/svip just above (not privacy-
        // gated, exactly like those), computed from the REAL per-
        // membership contribution total Stage 30's family.service.js
        // already persists via donate() -- titleForContribution()/
        // badgesForContribution() are the same pure, already-existing
        // domain/family-titles.js functions Stage 30 itself uses, called
        // here read-only. A user not currently in any active family
        // simply gets no `family` field, same "field only appears when
        // real data backs it" rule as `lvl`/`vip`/`svip` above.
        if (families) {
          const membership = await families.findActiveMembershipByAccount(targetUserId);
          if (membership) {
            base.family = {
              familyId: membership.familyId,
              title: titleForContribution(membership.contribution),
              badges: badgesForContribution(membership.contribution),
            };
          }
        }
        // Stage 7 completion (this session) -- Couple status: same
        // treatment as `family` just above, from the REAL active-couple
        // record Stage 32's couple.repository.js already persists
        // (cpValue/level only ever move through gifts.service.js's
        // already-committed sends, via couple.service.js's recordGift()
        // -- nothing new is computed here). No `couple` field when the
        // user is not currently paired.
        if (couples) {
          const activeCouple = await couples.findActiveCoupleByAccount(targetUserId);
          if (activeCouple) {
            base.couple = {
              coupleId: activeCouple.id,
              partnerId: activeCouple.accountA === targetUserId ? activeCouple.accountB : activeCouple.accountA,
              level: activeCouple.level,
            };
          }
        }
        const canSeeFull = isOwner || privacy.profileVisibility === 'public' || (privacy.profileVisibility === 'friends' && isFriend);
        // Stage 8 audit fix -- "Followers privacy" (requirement #11): the
        // follower/following/friend COUNTS were being returned unconditionally
        // above, even for a viewer the profileVisibility gate had just
        // rejected for `bio` (a stranger on a 'private' profile, or a
        // non-friend on a 'friends' profile, could still see exact
        // followers/following/friends counts). That is the same privacy
        // signal as bio and must fail the same gate -- these three fields
        // now follow canSeeFull exactly like bio does, instead of being
        // computed and attached before the gate even runs. Owner and
        // authorized viewers are completely unaffected (same values as
        // before).
        if (!canSeeFull) return { ...base, bio: null, privacyRestricted: true };
        // Stage 7 completion (this session) -- Gifts received: same
        // privacy tier as followers/following/friends counts just below
        // (a social/popularity signal, not a raw server-standing field
        // like lvl/vip/svip above) -- gated behind the exact same
        // canSeeFull check, so a private/friends-restricted profile hides
        // it from an unauthorized viewer exactly like it already hides
        // bio and the three counts. Computed from
        // gift.repository.js's real listByReceiver() (Stage 26/Phase 5's
        // actual committed gift ledger, the same rows sumByReceiver()
        // already aggregates for Stage 31 Rankings) -- no new gift data,
        // just a read-only per-profile roll-up of numbers that already
        // exist.
        let giftsSummary;
        if (gifts) {
          const received = await gifts.listByReceiver(targetUserId);
          giftsSummary = {
            count: received.length,
            totalCoins: received.reduce((sum, g) => sum + g.totalCostCoins, 0),
          };
        }
        return {
          ...base,
          bio: rawProfile?.bio || '',
          followersCount: followers.length,
          followingCount: following.length,
          friendsCount: friendsAsUser.length + friendsAsTarget.length,
          ...(giftsSummary ? { gifts: giftsSummary } : {}),
          privacyRestricted: false,
        };
      },
      // Stage 10 audit fix -- Lists (requirement #5: Friends/Followers/
      // Following lists). getFull() above already computed real counts
      // from the stage-10 store, but there was no way to fetch the actual
      // member ids behind those counts -- no list endpoint existed at all.
      // These three reuse getFull()'s exact privacy/block gate (same
      // allowed() call, same profileVisibility/isFriend logic) so a list
      // can never leak data getFull() itself would have hidden -- a
      // blocked or unauthorized viewer gets the same 403, a private/
      // friends-only profile hides the list from a non-friend the same
      // way it hides bio/counts. Real data only: ids come straight from
      // the same store records follow()/friend()/accept() maintain, never
      // a mock list.
      async _listGate(viewerId, targetUserId) {
        const isOwner = viewerId === targetUserId;
        if (!isOwner) {
          const ok = await social.allowed(viewerId, targetUserId, 'view_profile');
          if (!ok) throw Object.assign(new Error('this profile is not available to you'), { status: 403 });
        }
        const rawProfile = await store.find(7, x => x.userId === targetUserId);
        const privacy = { profileVisibility:'public', discoverable:true, ...(rawProfile?.privacy||{}) };
        const [friendsAsUser, friendsAsTarget] = await Promise.all([
          store.list(10, x => x.userId === targetUserId && x.type === 'friend' && x.status === 'accepted'),
          store.list(10, x => x.targetId === targetUserId && x.type === 'friend' && x.status === 'accepted'),
        ]);
        const isFriend = isOwner || friendsAsUser.some(f => f.targetId === viewerId) || friendsAsTarget.some(f => f.userId === viewerId);
        const canSeeFull = isOwner || privacy.profileVisibility === 'public' || (privacy.profileVisibility === 'friends' && isFriend);
        if (!canSeeFull) throw Object.assign(new Error('this profile is not available to you'), { status: 403 });
        return { friendsAsUser, friendsAsTarget };
      },
      async listFriends(viewerId, targetUserId) {
        requireId(viewerId,'viewerId'); requireId(targetUserId,'targetUserId');
        const { friendsAsUser, friendsAsTarget } = await this._listGate(viewerId, targetUserId);
        const ids = [...friendsAsUser.map(f => f.targetId), ...friendsAsTarget.map(f => f.userId)];
        return ids.map(accountId => ({ accountId }));
      },
      async listFollowers(viewerId, targetUserId) {
        requireId(viewerId,'viewerId'); requireId(targetUserId,'targetUserId');
        await this._listGate(viewerId, targetUserId);
        const followers = await store.list(10, x => x.targetId === targetUserId && x.type === 'follow' && x.status === 'active');
        return followers.map(f => ({ accountId: f.userId }));
      },
      async listFollowing(viewerId, targetUserId) {
        requireId(viewerId,'viewerId'); requireId(targetUserId,'targetUserId');
        await this._listGate(viewerId, targetUserId);
        const following = await store.list(10, x => x.userId === targetUserId && x.type === 'follow' && x.status === 'active');
        return following.map(f => ({ accountId: f.targetId }));
      },
      // Stage 8 audit fix -- "Share" (requirement #7): a Profile Action
      // that was entirely missing (no share endpoint, no share helper,
      // Mobile has no share button). This is NOT a new external system --
      // it reuses the exact deep-link convention this codebase already
      // has for the same target (see ../domain/notification-catalog.js's
      // `app://profile/${accountId}` builder, used for FRIEND_REQUEST/
      // NEW_FOLLOWER notifications). No new store record, no state: a
      // share is just handing back the canonical link for a profile that
      // already publicly exists at that id, so there is nothing to
      // persist and nothing to fake. Deliberately does NOT run the
      // block/privacy gate profile.getFull() runs -- the link itself
      // reveals nothing (not even whether the account exists); whoever
      // opens it still goes through getFull()'s real privacy/block check
      // at that point, exactly as if they had navigated there directly.
      shareLink(targetUserId) {
        requireId(targetUserId, 'targetUserId');
        return { deepLink: `app://profile/${targetUserId}` };
      }
    },
    // Stage 23 -- Referral. Code generation/lookup and the redemption
    // *record* live here (pure feature-record CRUD, like every other
    // domain in this file); actually crediting the referrer's wallet is a
    // separate concern that needs the wallet repository, so that step is
    // in services/referral.service.js (same split as gifts: gifts.service
    // debits the wallet, feature-platform just records the gift).
    referral: {
      // Idempotent from the caller's point of view: a user who already has
      // a code gets the same one back rather than accumulating duplicates.
      async myCode(userId) {
        requireId(userId,'userId');
        const existing = await store.find(23, x => x.type === 'code' && x.ownerId === userId);
        if (existing) return existing;
        return store.add(23, { type: 'code', ownerId: userId, code: generateReferralCode() });
      },
      async findByCode(code) {
        requireString(code, 'code', 32);
        return store.find(23, x => x.type === 'code' && x.code === code);
      },
      async hasRedeemed(userId) {
        requireId(userId,'userId');
        const existing = await store.find(23, x => x.type === 'redemption' && x.refereeId === userId);
        return !!existing;
      }
    },
    // Stage 23 -- Part 2: Room-in-Room breakout. The other half of Stage
    // 23 (see `referral` above for Part 1 -- Referral/Invite). Persisted
    // through the same generic stage-record store, store type 23,
    // distinguished by `type` ('breakout' / 'breakout-membership') the
    // same way referral above distinguishes 'code' / 'redemption' in that
    // same store slot -- no new schema/table needed for a framework-level
    // feature like this, same boundary Stage 19's Game Center had before
    // it later moved to a dedicated table.
    //
    // Fixed decision this session implements: creating/starting a
    // room-in-room breakout is host/owner-only -- ONLY the parent room's
    // real owner may do it, never a member, moderator, or anyone else.
    // Re-checked here even though routes/platform.routes.js's
    // requireRoomOwner guard already gates the create route at the route
    // layer -- same defense-in-depth already used by rooms.setting()/
    // kick()/muteMember() above, so this method stays safe to call
    // directly (tests, a future internal caller) without depending on the
    // route layer.
    roomInRoom: {
      async _requireParentRoom(parentRoomId) {
        const room = await store.find(12, r => r.id === parentRoomId);
        if (!room) throw Object.assign(new Error('parent room not found'), { status: 404 });
        return room;
      },
      // Same "owner, or a real active Stage 13 membership" membership
      // concept already used by routes/platform.guards.js#isRoomMember
      // for the Game Center -- deliberately re-derived here from the same
      // underlying stage-12/stage-13 records rather than imported from
      // the route-layer guards module, to keep this service layer
      // independent of the routing layer (same separation every other
      // method in this file already keeps).
      async _isParentRoomMember(parentRoomId, accountId) {
        const room = await store.find(12, r => r.id === parentRoomId);
        if (!room) return false;
        if (room.ownerId === accountId) return true;
        const memberships = await store.list(13);
        return memberships.some(m => m.roomId === parentRoomId && m.userId === accountId && (m.status === 'joined' || m.status === 'disconnected'));
      },
      // Only the parent room's real owner may create/start a breakout.
      // Idempotency guard: at most one OPEN breakout per parent room at a
      // time (a second attempt while one is already open is a real 409,
      // not a silently-created duplicate) -- the host must end the
      // current one before starting another.
      async create(actorId, parentRoomId, input = {}) {
        requireId(actorId, 'actorId'); requireId(parentRoomId, 'parentRoomId');
        const room = await this._requireParentRoom(parentRoomId);
        if (room.ownerId !== actorId) {
          throw Object.assign(new Error('only the room host/owner may create/start a room-in-room breakout'), { status: 403 });
        }
        const existingOpen = await store.find(23, x => x.type === 'breakout' && x.parentRoomId === parentRoomId && x.status === 'open');
        if (existingOpen) throw Object.assign(new Error('a room-in-room breakout is already open for this room'), { status: 409 });
        const name = (input.name !== undefined && input.name !== null) ? requireString(input.name, 'name', 80) : 'Breakout';
        const capacity = (Number.isInteger(input.capacity) && input.capacity > 0) ? input.capacity : null;
        return store.add(23, { type: 'breakout', parentRoomId, hostId: actorId, name, capacity, status: 'open' });
      },
      // Only the host who actually started this breakout (verified as the
      // parent room's owner at create() time) may end it.
      async end(actorId, breakoutId) {
        requireId(actorId, 'actorId'); requireId(breakoutId, 'breakoutId');
        const breakout = await store.find(23, x => x.type === 'breakout' && x.id === breakoutId);
        if (!breakout) throw Object.assign(new Error('breakout not found'), { status: 404 });
        if (breakout.hostId !== actorId) throw Object.assign(new Error('only the host who started this breakout may end it'), { status: 403 });
        if (breakout.status !== 'open') throw Object.assign(new Error('this breakout is already closed'), { status: 409 });
        const updated = await store.update(23, breakoutId, { status: 'closed', endedAt: now() });
        // Real effect, not just an audit flag: every still-'joined'
        // breakout-membership under a closed breakout is closed out too,
        // same "kick/mute actually changes the target's state" discipline
        // rooms.kick()/muteMember() already follow above.
        const activeMemberships = await store.list(23, x => x.type === 'breakout-membership' && x.breakoutId === breakoutId && x.status === 'joined');
        await Promise.all(activeMemberships.map(m => store.update(23, m.id, { status: 'ended' })));
        return updated;
      },
      // Visible to any real member of the parent room (owner, or an
      // active Stage 13 membership) -- also independently re-checked at
      // the route layer via requireRoomMember, same defense-in-depth
      // pattern as create()/end() above.
      async listForRoom(actorId, parentRoomId) {
        requireId(actorId, 'actorId'); requireId(parentRoomId, 'parentRoomId');
        await this._requireParentRoom(parentRoomId);
        const isMember = await this._isParentRoomMember(parentRoomId, actorId);
        if (!isMember) throw Object.assign(new Error('only members of the parent room may view its room-in-room breakouts'), { status: 403 });
        return store.list(23, x => x.type === 'breakout' && x.parentRoomId === parentRoomId);
      },
      // Join/leave: a breakout is a sub-space of a room the caller is
      // already in -- real membership of the PARENT room is required, not
      // independently joinable by a stranger to the parent room.
      // Idempotent join (mirrors rooms.join()): already-joined returns
      // the existing membership rather than creating a duplicate.
      async join(actorId, breakoutId) {
        requireId(actorId, 'actorId'); requireId(breakoutId, 'breakoutId');
        const breakout = await store.find(23, x => x.type === 'breakout' && x.id === breakoutId);
        if (!breakout) throw Object.assign(new Error('breakout not found'), { status: 404 });
        if (breakout.status !== 'open') throw Object.assign(new Error('this breakout is not open'), { status: 409 });
        const isMember = await this._isParentRoomMember(breakout.parentRoomId, actorId);
        if (!isMember) throw Object.assign(new Error('only members of the parent room may join its room-in-room breakout'), { status: 403 });
        const existing = await store.find(23, x => x.type === 'breakout-membership' && x.breakoutId === breakoutId && x.userId === actorId && x.status === 'joined');
        if (existing) return existing;
        if (breakout.capacity) {
          const activeCount = (await store.list(23, x => x.type === 'breakout-membership' && x.breakoutId === breakoutId && x.status === 'joined')).length;
          if (activeCount >= breakout.capacity) throw Object.assign(new Error('this breakout is full'), { status: 409 });
        }
        return store.add(23, { type: 'breakout-membership', breakoutId, parentRoomId: breakout.parentRoomId, userId: actorId, status: 'joined' });
      },
      async leave(actorId, breakoutId) {
        requireId(actorId, 'actorId'); requireId(breakoutId, 'breakoutId');
        const membership = await store.find(23, x => x.type === 'breakout-membership' && x.breakoutId === breakoutId && x.userId === actorId && x.status === 'joined');
        if (!membership) throw Object.assign(new Error('you are not currently in this breakout'), { status: 404 });
        return store.update(23, membership.id, { status: 'left' });
      }
    },
    search: {
      // Stage 9 audit fixes on top of the pre-existing Stage 8
      // discoverability gate (kept unchanged below):
      //   1. USER SEARCH -- "Username" was never actually searchable.
      //      This architecture has no separate username field (accounts
      //      only have `id`; the only user-facing name is the stage-7
      //      profile's `name`) -- confirmed by a repo-wide search before
      //      writing this. Matching now checks profile.name too, not
      //      just account id, and the response now includes `name` so a
      //      "username" match is actually visible in the result (it
      //      wasn't returned at all before this fix).
      //   2. ROOM SEARCH -- was reading store 12 raw with zero privacy
      //      filter, unlike every other room-listing path in this file
      //      (rooms.listDiscoverable() below). A 'private' room's
      //      existence/name was leaking to any searcher. Fixed with the
      //      exact same rule listDiscoverable() documents on itself
      //      (`visibility !== 'private' || ownerId === actingAccountId`)
      //      plus the same sanitizeRoomForClient() every other room
      //      response already goes through -- reusing that real,
      //      shared function (imported at top of this file) rather than
      //      re-deriving a safe shape by hand. `rooms.listDiscoverable`
      //      itself cannot be called from here (it's a plain object
      //      property assigned later in this same literal, not a
      //      pre-declared closure const like `social` above) -- calling
      //      into store 12 directly, the same access this method
      //      already had, with the identical filter/sanitizer rule
      //      applied, is the minimal fix that doesn't restructure the
      //      Rooms domain (out of Stage 9's scope) while still
      //      respecting the exact rule that domain already established.
      //      `actingAccountId` is a new, optional second parameter --
      //      omitting it (every pre-existing caller/test) simply means
      //      "no owner exception", never a widened result set, so this
      //      is backward compatible.
      //   3. GAME SEARCH -- was searching only live match records (store
      //      19: an active game instance in some room), so a game with
      //      no live match right now (e.g. searching "ludo" when no
      //      Ludo match is in progress anywhere) was invisible even
      //      though the game genuinely exists. Now also matches the
      //      real Stage 19 catalog (listGames(), imported at top) by id
      //      or display name -- additive, live match results are
      //      unchanged.
      // Family search and its discoverability: a repo-wide search
      // confirmed no privacy/visibility concept exists for families
      // anywhere in this codebase, so there is nothing to enforce here
      // beyond what already existed (id/name substring match) -- adding
      // one would be inventing a new Family privacy system, out of
      // Stage 9's scope.
      //   4. FAMILY SEARCH -- a real, previously undiscovered bug (not
      //      a missing feature): this method was reading `store.list(30)`
      //      -- the generic stage-30 feature-record store -- but real
      //      families are created/persisted through a dedicated
      //      repository (see ../database/repositories/family.repository.js,
      //      injected into ../services/family.service.js as `families`),
      //      completely separate from the generic `store`. A repo-wide
      //      search confirms store 30 is written to nowhere in this
      //      codebase, so Family Search was structurally incapable of
      //      ever returning a real family -- always an empty match set,
      //      regardless of query. Fixed by taking the same repository
      //      `family.service.js` already uses as a new, optional
      //      constructor dependency (same additive pattern as `accounts`
      //      above: omitted -> empty family results, exactly the old
      //      behavior; provided, see ../index.js -- real families now
      //      searchable).
      async query(q='', actingAccountId) {
        const term=String(q).trim().toLowerCase();
        if (!term) return { term, types:['user','room','family','game'], results:[] };
        const [accountsList, allProfiles, rooms, familyList, matches] = await Promise.all([
          accounts ? accounts.list() : [],
          store.list(7), store.list(12),
          families ? families.listFamilies() : [],
          store.list(19),
        ]);
        const profileByUserId = new Map(allProfiles.map(p => [p.userId, p]));
        // Stage 8 -- discoverability (unchanged): an account whose
        // profile privacy sets discoverable:false must not surface in a
        // stranger's search results; defaults to discoverable when no
        // stage-7 record exists yet, matching profile.create's default.
        const matchingAccounts = accountsList
          .filter(a => String(a.id).toLowerCase().includes(term) || String(profileByUserId.get(a.id)?.name || '').toLowerCase().includes(term))
          .slice(0,20);
        const users = matchingAccounts
          .filter(a => profileByUserId.get(a.id)?.privacy?.discoverable !== false)
          .map(a => ({ type:'user', id:a.id, name: profileByUserId.get(a.id)?.name || null, vip:a.vip, svip:a.svip, lvl:a.lvl }));
        const matchText = (x, fields) => fields.some(f => String(x[f] ?? '').toLowerCase().includes(term));
        const roomResults = rooms
          .filter(x => x.visibility !== 'private' || x.ownerId === actingAccountId)
          .filter(x => matchText(x,['id','name']))
          .slice(0,20)
          .map(x => ({ type:'room', ...sanitizeRoomForClient(x) }));
        const familyResults = familyList.filter(x => matchText(x,['id','name'])).slice(0,20).map(x => ({ type:'family', id:x.id, name:x.name, level:x.level }));
        const catalogGameResults = listGames()
          .filter(g => g.id.toLowerCase().includes(term) || g.name.toLowerCase().includes(term))
          .map(g => ({ type:'game', id:g.id, name:g.name, minPlayers:g.minPlayers, maxPlayers:g.maxPlayers, catalog:true }));
        const liveGameResults = matches.filter(x => matchText(x,['id','gameId','roomId'])).slice(0,20).map(x => ({ type:'game', id:x.id, gameId:x.gameId, roomId:x.roomId, state:x.state, catalog:false }));
        return { term, types:['user','room','family','game'], results:[...users,...roomResults,...familyResults,...catalogGameResults,...liveGameResults] };
      }
    },
    rooms: {
      // Stage 12 -- Create Room. Before this stage, create() only ever
      // set {ownerId,name,visibility,micSeats,capacity,status} -- and
      // even those had real gaps: visibility accepted ANY truthy string
      // (not just 'public'/'private'), micSeats accepted any integer
      // including 0/negative with no upper bound, and there was no room
      // for the discovery/branding metadata (cover/background/theme/
      // category/language/tags/ageRule/announcement) or a real
      // password lock -- every field the original 40-stage plan calls
      // for this stage to have. All of the new fields below are
      // OPTIONAL with the exact same defaults the field had before (or,
      // for genuinely new fields, a documented neutral default) -- every
      // pre-existing call to rooms.create() across Stage 13/14/16's own
      // tests (which only ever pass {ownerId,name[,capacity]}) produces
      // a byte-for-byte-compatible room for every field it already
      // depended on (id/ownerId/name/visibility/micSeats/capacity/
      // status), plus the new fields at their defaults.
      //
      // Validation lives in ./database/models/room.model.js (structural
      // checks + bounds) and ./domain/room-catalog.js (fixed enums,
      // same "resolved server-side, never trusted from the client" rule
      // as gift-catalog.js/guard-catalog.js/chat-catalog.js) -- create()
      // itself only orchestrates them, exactly like chat.service.js
      // orchestrates chat.model.js's assertValidMessage*() before ever
      // touching the repository.
      //
      // Password: never stored in plaintext. If provided, it is hashed
      // immediately (security/room-password.js, scrypt + per-room salt)
      // and only the hash is persisted; `hasPassword` (a plain boolean)
      // is what discovery/the client ever see -- see room.model.js's
      // sanitizeRoomForClient(), used everywhere a room reaches a
      // client (GET /api/home, GET /api/rooms -- see
      // routes/platform.routes.js). Omitted password -> hasPassword:
      // false, join() imposes no password check (see join() below),
      // identical to every room created before this stage existed.
      create(input) {
        const ownerId = requireId(input.ownerId, 'ownerId');
        const name = assertCleanContent(requireString(input.name, 'name', 120), 'name');
        const visibility = assertValidVisibility(input.visibility);
        const micSeats = assertValidMicSeats(input.micSeats);
        const capacity = (Number.isInteger(input.capacity) && input.capacity > 0) ? input.capacity : null;
        const theme = resolveTheme(input.theme);
        const category = resolveCategory(input.category);
        const language = resolveLanguage(input.language);
        const ageRule = resolveAgeRule(input.ageRule);
        const tags = normalizeTags(input.tags);
        const cover = assertValidImageUrl(input.cover, 'cover');
        const background = assertValidImageUrl(input.background, 'background');
        const announcement = assertValidAnnouncement(input.announcement);
        const password = assertValidPassword(input.password);
        const passwordHash = password ? hashRoomPassword(password) : null;
        return store.add(12, {
          ownerId, name, visibility, micSeats, capacity, status: 'open',
          theme, category, language, ageRule, tags, cover, background, announcement,
          hasPassword: !!passwordHash, passwordHash,
        });
      },
      // Stage 12 -- real discovery. Before this stage, GET /api/rooms
      // and GET /api/home returned platform.store.list(12) completely
      // raw: every room regardless of visibility (a 'private' room's
      // full record, indistinguishable from a public one, was visible
      // to literally any authenticated session), and -- as of this
      // stage's new passwordHash field existing at all -- would have
      // leaked it verbatim to any caller. sanitizeRoomForClient() (see
      // room.model.js) strips passwordHash unconditionally; the
      // visibility filter below is the only access rule: a private
      // room is only included for its own owner, the same "owner is
      // the only real membership concept" boundary already documented
      // in rtc/agora-room-access.js for voice access. Optional
      // category/language/tag/query filters are additive discovery
      // conveniences on top of that, never a replacement for it.
      async listDiscoverable({ actingAccountId, category, language, tag, query } = {}) {
        const all = await store.list(12);
        const term = typeof query === 'string' ? query.trim().toLowerCase() : '';
        const wantedTag = typeof tag === 'string' && tag.trim() ? tag.trim().toLowerCase() : null;
        return all
          .filter((room) => room.visibility !== 'private' || room.ownerId === actingAccountId)
          .filter((room) => !category || room.category === category)
          .filter((room) => !language || room.language === language)
          .filter((room) => !wantedTag || (Array.isArray(room.tags) && room.tags.some((t) => t.toLowerCase() === wantedTag)))
          .filter((room) => !term || room.name.toLowerCase().includes(term))
          .map(sanitizeRoomForClient);
      },
      // Stage 6 -- Home feed. Added alongside (never replacing)
      // listDiscoverable() above, which Stage 12/13's own tests and the
      // existing GET /api/rooms + GET /api/home routes depend on
      // byte-for-byte -- this is a pure addition, zero change to any
      // existing method's behavior or signature.
      //
      // Real per-room activity: `memberCount`/`isLive` are computed from
      // the actual Stage-13 membership ledger (store type 13, the same
      // records join()/leave()/disconnect()/reconnect() already
      // maintain) -- a room is "live" if and only if it has at least one
      // membership currently in the real 'joined' state, never a
      // fabricated/random signal. 'popular' sorts by that same real
      // count, descending. There is no separate view/impression counter
      // anywhere in this codebase, so "popular" is honestly defined as
      // "most people in the room right now" rather than inventing a
      // metric nothing tracks.
      //
      // 'following' reuses the real Stage 10 follow ledger (store type
      // 10, type:'follow', status:'active') -- the exact same records
      // social.follow()/unfollow() maintain -- filtered to rooms owned
      // by an account the caller actively follows. No new relation type
      // is introduced.
      async discoverForHome({ actingAccountId, tab = 'new', category, language, tag, query } = {}) {
        const validTabs = ['live', 'following', 'popular', 'new'];
        if (!validTabs.includes(tab)) {
          throw Object.assign(new Error(`tab must be one of ${validTabs.join(', ')}`), { status: 400 });
        }
        if (tab === 'following' && !actingAccountId) {
          throw Object.assign(new Error('actingAccountId is required for the following tab'), { status: 400 });
        }
        const [all, memberships, follows] = await Promise.all([
          store.list(12),
          store.list(13),
          tab === 'following'
            ? store.list(10, (x) => x.userId === actingAccountId && x.type === 'follow' && x.status === 'active')
            : Promise.resolve([]),
        ]);
        const joinedCounts = new Map();
        for (const m of memberships) {
          if (m.status === 'joined') joinedCounts.set(m.roomId, (joinedCounts.get(m.roomId) || 0) + 1);
        }
        const followingOwnerIds = tab === 'following' ? new Set(follows.map((f) => f.targetId)) : null;
        const term = typeof query === 'string' ? query.trim().toLowerCase() : '';
        const wantedTag = typeof tag === 'string' && tag.trim() ? tag.trim().toLowerCase() : null;
        let visible = all
          .filter((room) => room.visibility !== 'private' || room.ownerId === actingAccountId)
          .filter((room) => !category || room.category === category)
          .filter((room) => !language || room.language === language)
          .filter((room) => !wantedTag || (Array.isArray(room.tags) && room.tags.some((t) => t.toLowerCase() === wantedTag)))
          .filter((room) => !term || room.name.toLowerCase().includes(term));
        if (tab === 'following') visible = visible.filter((room) => followingOwnerIds.has(room.ownerId));
        const withStats = visible.map((room) => {
          const memberCount = joinedCounts.get(room.id) || 0;
          return { ...sanitizeRoomForClient(room), memberCount, isLive: memberCount > 0 };
        });
        if (tab === 'popular') return withStats.slice().sort((a, b) => b.memberCount - a.memberCount);
        if (tab === 'live') return withStats.filter((r) => r.isLive).reverse();
        // 'new' and 'following' both default to newest-first (insertion order reversed).
        return withStats.slice().reverse();
      },
      // Stage 6 -- real category counts for the Home category chips.
      // Categories themselves are the fixed, reviewed catalog from
      // room-catalog.js (never client-supplied); the count next to each
      // one is a real tally of currently-visible rooms, not a fabricated
      // number.
      async categoryCounts({ actingAccountId } = {}) {
        const all = await store.list(12);
        const visible = all.filter((room) => room.visibility !== 'private' || room.ownerId === actingAccountId);
        const counts = {};
        for (const room of visible) counts[room.category] = (counts[room.category] || 0) + 1;
        return Object.values(ROOM_CATEGORIES).map((c) => ({ id: c.id, name: c.name, count: counts[c.id] || 0 }));
      },
      // Stage 13 -- Room Entry/Join/Leave/Reconnect. Before this stage,
      // join() was a bare `store.add()` with no room-existence check, no
      // open/closed check, and -- critically -- no idempotency: calling it
      // twice for the same (roomId,userId) silently created two separate
      // 'joined' stage-13 records, which made Stage 16's kick() (which does
      // `memberships.find(status==='joined')`) ambiguous about which one is
      // "the" membership. There was also no leave/disconnect/reconnect at
      // all, so a dropped connection had no representable state and a
      // reconnecting client had no way to resume the same membership.
      //
      // Membership lifecycle (stage-13 record, one row = one membership
      // attempt, never deleted, only patched via store.update() like every
      // other stage in this file): 'joined' -> 'disconnected' -> 'joined'
      // (reconnect, any number of times) -> 'left' (voluntary) or 'kicked'
      // (Stage 16, unchanged). At most one *active* ('joined' or
      // 'disconnected') membership may exist per (roomId,userId) at a time
      // -- _activeMembership() below is the single source of truth other
      // methods (join/leave/disconnect/reconnect, and Stage 16's kick())
      // rely on to find it.
      //
      // `_clock` is an optional injected `() => Date` (same additive-DI
      // pattern as `eventService`'s `now` in event.service.js) purely so
      // tests can control RECONNECT_GRACE_MS expiry deterministically;
      // defaults to the real clock, so behavior is unchanged if unused.
      _clock: clock || (() => new Date()),
      async _activeMembership(roomId, userId) {
        const memberships = await store.list(13);
        return memberships.find((m) => m.roomId === roomId && m.userId === userId && (m.status === 'joined' || m.status === 'disconnected'));
      },
      async _requireOpenRoom(roomId) {
        const room = await store.find(12, (r) => r.id === roomId);
        if (!room) throw Object.assign(new Error('room not found'), { status: 404 });
        if (room.status !== 'open') throw Object.assign(new Error('this room is not open'), { status: 409 });
        return room;
      },
      // join(): real entry into a room.
      // - unknown/closed room -> 404/409 (this used to silently "succeed"
      //   with a membership record for a room that doesn't exist).
      // - already 'joined' -> idempotent, returns the existing membership
      //   unchanged (no duplicate row, no error -- a client calling join()
      //   twice in a row, e.g. a retried request, must not fork state).
      // - currently 'disconnected' (mid reconnect-grace-window) -> resumes
      //   the *same* membership record (same id) rather than creating a
      //   new one, which is exactly what makes state "not lost": any
      //   Stage 14 seat or Stage 16 moderation history keyed by
      //   roomId+userId was never touched by disconnect() in the first
      //   place, so resuming the membership makes the room's view of this
      //   user whole again with zero extra bookkeeping.
      // - otherwise (never joined, or previous membership ended in
      //   'left'/'kicked') -> a brand new membership record.
      // Stage 12 -- `password` is a new, optional 3rd argument (rooms
      // created before this stage, and every existing Stage 13 test,
      // only ever call join(roomId,userId) with two arguments --
      // password is simply undefined for all of them, and the check
      // below only runs at all when room.passwordHash is set, which it
      // never was before this stage). See room-password.js.
      async join(roomId, userId, password) {
        requireId(roomId, 'roomId'); requireId(userId, 'userId');
        const room = await this._requireOpenRoom(roomId);
        // Stage 35 Part 5/8 -- Room Ban enforcement point. Checked before
        // any membership branch below (idempotent re-join, disconnected-
        // resume, or brand-new join all go through join()) so a ban
        // cannot be bypassed by any of them. Never triggered for the
        // room's own owner (banMember() already refuses to ban a room's
        // owner, so this is a defense-in-depth check, not the only one).
        if (await this.isBanned(roomId, userId)) {
          throw Object.assign(new Error('you are banned from this room'), { status: 403 });
        }
        const active = await this._activeMembership(roomId, userId);
        if (active && active.status === 'joined') return active;
        if (active && active.status === 'disconnected') {
          return store.update(13, active.id, { status: 'joined', reconnectedAt: this._clock().toISOString(), reconnectCount: (active.reconnectCount || 0) + 1 });
        }
        // Stage 12 -- password-protected room enforcement. Only guards
        // a brand-new membership (the two branches above -- idempotent
        // re-join and disconnected-resume -- represent a session that
        // already passed this check once and is not re-prompted on
        // every retry/reconnect). The room's own owner never needs
        // their own password. A room with no password
        // (room.passwordHash === null, the default, and every room
        // created before this stage) skips this block entirely --
        // zero behavior change for it.
        if (room.passwordHash && room.ownerId !== userId) {
          if (typeof password !== 'string' || !password || !verifyRoomPassword(password, room.passwordHash)) {
            throw Object.assign(new Error('the correct room password is required to join this room'), { status: 401 });
          }
        }
        // Optional audience capacity (room.capacity, set at rooms.create()
        // time -- null/unset means unlimited, the original/default
        // behavior, so existing rooms and every pre-Stage-13 test that
        // never passed a capacity are completely unaffected). Only a
        // brand-new membership consumes a slot -- an idempotent re-join or
        // a resumed 'disconnected' member (handled above, before this
        // check) already occupies one and must never be double-counted or
        // rejected for a room they are already in.
        if (room.capacity) {
          const memberships = await store.list(13);
          const activeCount = memberships.filter((m) => m.roomId === roomId && (m.status === 'joined' || m.status === 'disconnected')).length;
          if (activeCount >= room.capacity) throw Object.assign(new Error('this room is full'), { status: 409 });
        }
        return store.add(13, { roomId, userId, status: 'joined', joinedAt: this._clock().toISOString(), reconnectCount: 0 });
      },
      // leave(): voluntary exit. Requires a currently-active ('joined' or
      // 'disconnected') membership -- leaving a room you were never in, or
      // already left/were kicked from, is a 404, not a silent success.
      async leave(roomId, userId) {
        requireId(roomId, 'roomId'); requireId(userId, 'userId');
        const active = await this._activeMembership(roomId, userId);
        if (!active) throw Object.assign(new Error('you are not currently in this room'), { status: 404 });
        return store.update(13, active.id, { status: 'left', leftAt: this._clock().toISOString() });
      },
      // disconnect(): an *involuntary* network drop, as distinct from
      // leave(). Only valid from 'joined' (a client that is already marked
      // 'disconnected' cannot disconnect again). Deliberately does not
      // touch any Stage 14 seat record -- the whole point is that a
      // dropped connection must not cost the user their mic seat while
      // they are within the reconnect grace window.
      async disconnect(roomId, userId) {
        requireId(roomId, 'roomId'); requireId(userId, 'userId');
        const memberships = await store.list(13);
        const joined = memberships.find((m) => m.roomId === roomId && m.userId === userId && m.status === 'joined');
        if (!joined) throw Object.assign(new Error('no active session to disconnect'), { status: 404 });
        return store.update(13, joined.id, { status: 'disconnected', disconnectedAt: this._clock().toISOString() });
      },
      // reconnect(): the explicit counterpart to disconnect(), for a
      // client that knows it is resuming (rather than joining fresh).
      // - no 'disconnected' membership at all -> 404 (nothing to resume;
      //   the caller should call join() instead).
      // - a 'disconnected' membership older than RECONNECT_GRACE_MS -> 410
      //   Gone: the grace window expired, the session is no longer
      //   resumable and the caller must join() fresh (which will correctly
      //   create a brand-new membership, not silently revive a stale one).
      // - otherwise -> resumes the same membership record, same as the
      //   auto-resume branch inside join() above.
      async reconnect(roomId, userId) {
        requireId(roomId, 'roomId'); requireId(userId, 'userId');
        const memberships = await store.list(13);
        const disconnected = memberships.find((m) => m.roomId === roomId && m.userId === userId && m.status === 'disconnected');
        if (!disconnected) throw Object.assign(new Error('no disconnected session found to reconnect; use join instead'), { status: 404 });
        const elapsedMs = this._clock().getTime() - Date.parse(disconnected.disconnectedAt);
        if (elapsedMs > RECONNECT_GRACE_MS) {
          throw Object.assign(new Error('reconnect window has expired; join again'), { status: 410 });
        }
        return store.update(13, disconnected.id, { status: 'joined', reconnectedAt: this._clock().toISOString(), reconnectCount: (disconnected.reconnectCount || 0) + 1 });
      },
      seat(roomId,userId,seatNumber) { return store.add(14,{roomId:requireId(roomId,'roomId'),userId:requireId(userId,'userId'),seatNumber,status:'requested'}); },
      // Stage 15 -- Room Settings, with a real effect on the room record.
      // Before this stage, setting() was a bare `store.add()`: no
      // ownership check (any caller could write an audit row for any
      // room), no key allowlist (any string at all was accepted), no
      // reuse of the create-time validators, and -- critically -- no
      // actual change to the room a client would ever see (it wrote an
      // orphan stage-15 record that nothing ever read back). This is the
      // exact same "bare store.add(), audit-only, no real effect" gap
      // Stage 16's kick()/muteMember()/unmuteMember() closed for
      // moderation() above -- the fix here follows that same shape:
      // apply a real, validated patch to the stage-12 room record via
      // store.update(), keep writing the stage-15 record as an audit
      // trail of who changed what and when (never removed, only no
      // longer the only thing that happens).
      //
      // Every editable key below reuses the exact validators
      // rooms.create() already uses (room.model.js / room-catalog.js) --
      // no new/duplicate validation logic, no enum resolved anywhere
      // else. `password` is special-cased the same way it is at create
      // time: the plaintext never touches the stage-15 audit record or
      // the stage-12 room record itself, only its hash does (see
      // security/room-password.js); an empty/omitted password clears an
      // existing one, identical to omitting it at create().
      _ROOM_SETTING_KEYS: Object.freeze(['name','visibility','micSeats','theme','category','language','ageRule','tags','cover','background','announcement','password']),
      _applyRoomSetting(key, value) {
        switch (key) {
          case 'name':
            return { name: assertCleanContent(requireString(value, 'name', 120), 'name') };
          case 'visibility':
            if (value === undefined || value === null) throw Object.assign(new Error('visibility is required'), { status: 400 });
            return { visibility: assertValidVisibility(value) };
          case 'micSeats':
            if (value === undefined || value === null) throw Object.assign(new Error('micSeats is required'), { status: 400 });
            return { micSeats: assertValidMicSeats(value) };
          case 'theme':
            if (value === undefined || value === null) throw Object.assign(new Error('theme is required'), { status: 400 });
            return { theme: resolveTheme(value) };
          case 'category':
            if (value === undefined || value === null) throw Object.assign(new Error('category is required'), { status: 400 });
            return { category: resolveCategory(value) };
          case 'language':
            if (value === undefined || value === null) throw Object.assign(new Error('language is required'), { status: 400 });
            return { language: resolveLanguage(value) };
          case 'ageRule':
            if (value === undefined || value === null) throw Object.assign(new Error('ageRule is required'), { status: 400 });
            return { ageRule: resolveAgeRule(value) };
          case 'tags':
            return { tags: normalizeTags(value) };
          case 'cover':
            return { cover: assertValidImageUrl(value, 'cover') };
          case 'background':
            return { background: assertValidImageUrl(value, 'background') };
          case 'announcement':
            return { announcement: assertValidAnnouncement(value) };
          case 'password': {
            const password = assertValidPassword(value);
            const passwordHash = password ? hashRoomPassword(password) : null;
            return { passwordHash, hasPassword: !!passwordHash };
          }
          default:
            throw Object.assign(new Error(`key must be one of ${this._ROOM_SETTING_KEYS.join(', ')}`), { status: 400 });
        }
      },
      // actorId is always the caller's own session id (see
      // routes/platform.routes.js's POST /api/rooms/:roomId/settings,
      // which also independently gates on requireRoomOwner before ever
      // reaching here) -- re-checked here too, the same defense-in-depth
      // already used by _requireOwnerOfSeat()/kick()/muteMember(), so
      // this method is safe to call directly (e.g. from tests or a
      // future internal caller) without depending on the route layer.
      async setting(actorId, roomId, key, value) {
        requireId(actorId, 'actorId'); requireId(roomId, 'roomId'); requireString(key, 'key', 80);
        const room = await store.find(12, r => r.id === roomId);
        if (!room) throw Object.assign(new Error('room not found'), { status: 404 });
        if (room.ownerId !== actorId) throw Object.assign(new Error('only the room owner can change room settings'), { status: 403 });
        const patch = this._applyRoomSetting(key, value);
        const updated = await store.update(12, roomId, patch);
        // Audit trail: never the plaintext password, even redacted-in-name
        // -- a settings-change log is not a place a secret should ever be
        // recoverable from.
        await store.add(15, { roomId, actorId, key, value: key === 'password' ? { changed: !!patch.hasPassword } : value });
        return sanitizeRoomForClient(updated);
      },
      // Read side of Stage 15: the room owner can fetch the room's own
      // current settings. This intentionally returns the sanitized room
      // record itself (the same shape setting() just updated), not the
      // stage-15 audit log -- "what are my room's settings right now" is
      // a different question from "what changed and when", and only the
      // former has a natural single answer per room. Reuses
      // sanitizeRoomForClient() so passwordHash never leaks here either.
      async getSettings(actorId, roomId) {
        requireId(actorId, 'actorId'); requireId(roomId, 'roomId');
        const room = await store.find(12, r => r.id === roomId);
        if (!room) throw Object.assign(new Error('room not found'), { status: 404 });
        if (room.ownerId !== actorId) throw Object.assign(new Error('only the room owner can view room settings'), { status: 403 });
        return sanitizeRoomForClient(room);
      },
      moderation(roomId,actorId,targetId,action) { return store.add(16,{roomId:requireId(roomId,'roomId'),actorId:requireId(actorId,'actorId'),targetId:requireId(targetId,'targetId'),action:requireString(action,'action',40)}); },
      // internal: shared by Stage 14 (self-serve host actions) and Stage 16
      // (moderation-triggered actions on a seat) -- confirms actorId truly
      // owns the room that owns this seat before any mutation is allowed.
      async _requireOwnerOfSeat(actorId, seatId) {
        const seat = await store.find(14, s => s.id === seatId);
        if (!seat) throw Object.assign(new Error('seat not found'), { status: 404 });
        const room = await store.find(12, r => r.id === seat.roomId);
        if (!room) throw Object.assign(new Error('room not found'), { status: 404 });
        if (room.ownerId !== actorId) throw Object.assign(new Error('only the room owner can act on seats'), { status: 403 });
        return seat;
      },
      // Stage 14 -- Mic/Seats approve/reject/mute, real host-gated state
      // transitions on the stage-14 record via store.update(), same pattern
      // as Stage 10. Only the owner of the room the seat belongs to may act.
      async approveSeat(actorId, seatId) {
        requireId(actorId,'actorId'); requireId(seatId,'seatId');
        const seat = await this._requireOwnerOfSeat(actorId, seatId);
        if (seat.status !== 'requested') throw Object.assign(new Error(`seat is already ${seat.status}`), { status: 409 });
        const updated = await store.update(14, seatId, { status: 'approved' });
        if (notificationService) {
          await notificationService.notify({ recipientId: seat.userId, type: 'MIC_SEAT_APPROVED', payload: { roomId: seat.roomId } });
        }
        return updated;
      },
      async rejectSeat(actorId, seatId) {
        requireId(actorId,'actorId'); requireId(seatId,'seatId');
        const seat = await this._requireOwnerOfSeat(actorId, seatId);
        if (seat.status !== 'requested') throw Object.assign(new Error(`seat is already ${seat.status}`), { status: 409 });
        const updated = await store.update(14, seatId, { status: 'rejected' });
        if (notificationService) {
          await notificationService.notify({ recipientId: seat.userId, type: 'MIC_SEAT_REJECTED', payload: { roomId: seat.roomId } });
        }
        return updated;
      },
      async muteSeat(actorId, seatId) {
        requireId(actorId,'actorId'); requireId(seatId,'seatId');
        const seat = await this._requireOwnerOfSeat(actorId, seatId);
        if (seat.status !== 'approved') throw Object.assign(new Error('only an approved seat can be muted'), { status: 409 });
        return store.update(14, seatId, { muted: true });
      },
      async unmuteSeat(actorId, seatId) {
        requireId(actorId,'actorId'); requireId(seatId,'seatId');
        const seat = await this._requireOwnerOfSeat(actorId, seatId);
        if (seat.status !== 'approved') throw Object.assign(new Error('only an approved seat can be unmuted'), { status: 409 });
        return store.update(14, seatId, { muted: false });
      },
      // Stage 16 -- Room moderation with a *real* effect, not just an audit
      // log: kick actually changes the target's stage-13 membership status,
      // mute actually changes the target's stage-14 seat. moderation()
      // above still writes the stage-16 audit entry for both.
      async kick(actorId, roomId, targetId) {
        requireId(actorId,'actorId'); requireId(roomId,'roomId'); requireId(targetId,'targetId');
        const room = await store.find(12, r => r.id === roomId);
        if (!room) throw Object.assign(new Error('room not found'), { status: 404 });
        if (room.ownerId !== actorId) throw Object.assign(new Error('only the room owner can kick'), { status: 403 });
        const memberships = await store.list(13);
        const membership = memberships.find(m => m.roomId === roomId && m.userId === targetId && m.status === 'joined');
        if (!membership) throw Object.assign(new Error('target is not currently in this room'), { status: 404 });
        const updated = await store.update(13, membership.id, { status: 'kicked' });
        await this.moderation(roomId, actorId, targetId, 'kick');
        return updated;
      },
      async muteMember(actorId, roomId, targetId) {
        requireId(actorId,'actorId'); requireId(roomId,'roomId'); requireId(targetId,'targetId');
        const room = await store.find(12, r => r.id === roomId);
        if (!room) throw Object.assign(new Error('room not found'), { status: 404 });
        if (room.ownerId !== actorId) throw Object.assign(new Error('only the room owner can mute members'), { status: 403 });
        const seats = await store.list(14);
        const seat = seats.find(s => s.roomId === roomId && s.userId === targetId && s.status === 'approved');
        if (!seat) throw Object.assign(new Error('target has no active seat in this room'), { status: 404 });
        const updated = await store.update(14, seat.id, { muted: true });
        await this.moderation(roomId, actorId, targetId, 'mute');
        return updated;
      },
      async unmuteMember(actorId, roomId, targetId) {
        requireId(actorId,'actorId'); requireId(roomId,'roomId'); requireId(targetId,'targetId');
        const room = await store.find(12, r => r.id === roomId);
        if (!room) throw Object.assign(new Error('room not found'), { status: 404 });
        if (room.ownerId !== actorId) throw Object.assign(new Error('only the room owner can unmute members'), { status: 403 });
        const seats = await store.list(14);
        const seat = seats.find(s => s.roomId === roomId && s.userId === targetId && s.status === 'approved');
        if (!seat) throw Object.assign(new Error('target has no active seat in this room'), { status: 404 });
        const updated = await store.update(14, seat.id, { muted: false });
        await this.moderation(roomId, actorId, targetId, 'unmute');
        return updated;
      },
      // Stage 35 Part 5/8 -- Room Ban/Unban. Audit found no pre-existing
      // ban of any kind: Stage 16's kick() only flips a stage-13
      // membership to 'kicked' -- removal, never a barrier to rejoining
      // (confirmed by rooms.stage13.entry.test.js's own comment: "kick is
      // removal, not a ban"). Room Ban closes that gap with a real,
      // persistent, room-scoped record, kept in the same stage-16
      // ("Host/Moderator") store this file's moderation() audit trail
      // already uses -- not a new store/number, not a second domain
      // object. Discriminated from plain kick/mute audit rows (which have
      // no `type` field) via `type:'ban'`, the exact same same-store,
      // discriminator-field pattern this file already uses for Stage 23's
      // 'breakout'/'breakout-membership' records above. Shape/lifecycle
      // (`status:'active'|'removed'`, idempotent create, 404-if-missing
      // removal) deliberately mirrors social.block()/unblock() above --
      // this IS a block, just scoped to one room instead of globally, so
      // it reuses that exact precedent rather than inventing a new one.
      //
      // GLOBAL BLOCK vs ROOM BAN: social.block() (store 8) is unrelated
      // and untouched -- a room ban never touches it, and a global block
      // is never consulted here. Only this room's own ban records gate
      // this room's own join().
      async _activeBan(roomId, targetId) {
        return store.find(16, r => r.type === 'ban' && r.roomId === roomId && r.targetId === targetId && r.status === 'active');
      },
      async isBanned(roomId, targetId) {
        return !!(await this._activeBan(roomId, targetId));
      },
      // Only the room owner may ban -- the same, and only, protected role
      // this codebase has (no separate moderator/admin role exists
      // anywhere in this repository, see room.model.js/feature-platform.js
      // audit; reusing a second role system was explicitly out of scope).
      // The owner themselves can never be the target -- there is no
      // owner-transfer concept here, so a self-ban (or an owner banned by
      // some future higher role) is never a state this codebase can
      // reason about; reject it outright rather than guess.
      async banMember(actorId, roomId, targetId) {
        requireId(actorId, 'actorId'); requireId(roomId, 'roomId'); requireId(targetId, 'targetId');
        const room = await store.find(12, r => r.id === roomId);
        if (!room) throw Object.assign(new Error('room not found'), { status: 404 });
        if (room.ownerId !== actorId) throw Object.assign(new Error('only the room owner can ban members'), { status: 403 });
        if (targetId === room.ownerId) throw Object.assign(new Error('the room owner cannot be banned'), { status: 403 });
        // Idempotent, exactly like social.block(): a second ban() call
        // while one is already active returns the existing record rather
        // than creating a duplicate (so unban() always has exactly one
        // active record to resolve).
        const existing = await this._activeBan(roomId, targetId);
        if (existing) return existing;
        const record = await store.add(16, { type: 'ban', roomId, targetId, actorId, status: 'active' });
        // A ban also ends any current presence in the room -- same
        // membership-status effect kick() already applies (no seat-level
        // cleanup either, matching kick()'s own existing, unchanged
        // behavior; not something this stage invents differently for ban
        // than it already works for kick). Only applied if the target is
        // actually in the room right now; banning someone not currently
        // present must not throw (this is 'ban', not 'kick', so "target
        // not currently in this room" is not an error here).
        const membership = await this._activeMembership(roomId, targetId);
        if (membership) await store.update(13, membership.id, { status: 'kicked' });
        await this.moderation(roomId, actorId, targetId, 'ban');
        return record;
      },
      async unbanMember(actorId, roomId, targetId) {
        requireId(actorId, 'actorId'); requireId(roomId, 'roomId'); requireId(targetId, 'targetId');
        const room = await store.find(12, r => r.id === roomId);
        if (!room) throw Object.assign(new Error('room not found'), { status: 404 });
        if (room.ownerId !== actorId) throw Object.assign(new Error('only the room owner can unban members'), { status: 403 });
        const record = await this._activeBan(roomId, targetId);
        if (!record) throw Object.assign(new Error('this account is not currently banned from this room'), { status: 404 });
        const updated = await store.update(16, record.id, { status: 'removed' });
        await this.moderation(roomId, actorId, targetId, 'unban');
        return updated;
      }
    },
    // Stage 17 -- Music/DJ. Before this stage, store type 17 was entirely
    // unused (no `music` key existed on the object this function
    // returns) -- zero code, confirmed by a repo-wide search for
    // "music"/"dj"/"DJ" turning up nothing but the STAGES label above
    // and an unrelated room-catalog.js `theme` entry (a room's visual
    // theme, not a DJ feature).
    //
    // Same role precedent room ban (Stage 35 Part 5/8, see rooms.banMember's
    // own header) and Stage 19's Game Center authorization already
    // documented: this codebase has exactly one real, pre-existing
    // protected room role -- room owner. Rather than reuse a second,
    // unrelated allowlist (e.g. the env-configured, GLOBAL, cross-room
    // MODERATION_REVIEWER_IDS staff allowlist -- config/moderation-staff.js
    // -- which has nothing to do with any one room), DJ control here is a
    // real, persistent, ROOM-SCOPED allowlist the room owner alone grants/
    // revokes (type:'dj' records below), the exact same "no new role
    // system, a real record instead" precedent Room Ban set for a new
    // room-scoped concept. The room owner is always implicitly in control
    // (never needs a record of their own) -- see _isDJ()/​_requireDJ().
    //
    // Persistence: the existing generic store type 17 (this stage's own
    // slot in the shared feature_records table -- see
    // ./database/repositories/feature-record.repository.js), discriminated
    // by `type` ('dj' | 'track' | 'player') the same way Stage 23's
    // roomInRoom above discriminates 'breakout'/'breakout-membership' in
    // its own store slot -- no new table, no second store.
    //
    // Realtime: every real state change below (DJ grant/revoke, queue add/
    // remove/reorder, play/pause/next/volume) is published to `musicBus`
    // (see ./realtime/music-bus.js) -- a byte-for-byte structural copy of
    // ../realtime/chat-bus.js (Stage 11)/notification-bus.js (Stage 33),
    // the exact same in-process EventEmitter infrastructure already used
    // for Chat/Notifications real-time fan-out in this project. `musicBus`
    // is an OPTIONAL constructor dependency (same additive pattern as
    // `notificationService` above) -- publish() never throws even with no
    // subscriber connected (documented on the bus itself), so every method
    // below is byte-for-byte safe to call whether or not a bus was
    // supplied (e.g. from a test that only passes `store`).
    music: {
      async _requireRoom(roomId) {
        requireId(roomId, 'roomId');
        const room = await store.find(12, r => r.id === roomId);
        if (!room) throw Object.assign(new Error('room not found'), { status: 404 });
        return room;
      },
      // Same real Stage 12 ownership + Stage 13 join/leave membership
      // ledger concept as roomInRoom._isParentRoomMember above -- deliberately
      // re-derived here (not imported from ./routes/platform.guards.js)
      // to keep this service layer independent of the routing layer, the
      // same separation every other method in this file already keeps.
      async _isRoomMember(roomId, accountId) {
        if (!accountId) return false;
        const room = await store.find(12, r => r.id === roomId);
        if (!room) return false;
        if (room.ownerId === accountId) return true;
        const memberships = await store.list(13);
        return memberships.some(m => m.roomId === roomId && m.userId === accountId && (m.status === 'joined' || m.status === 'disconnected'));
      },
      async _activeDjRecord(roomId, userId) {
        return store.find(17, r => r.type === 'dj' && r.roomId === roomId && r.userId === userId && r.status === 'active');
      },
      // The room owner is always, implicitly, in control -- no record
      // needed for them (mirrors rooms.kick()/etc. never needing a
      // "membership" record for the owner either).
      async _isDJ(roomId, userId, room) {
        const theRoom = room || await store.find(12, r => r.id === roomId);
        if (!theRoom) return false;
        if (theRoom.ownerId === userId) return true;
        return !!(await this._activeDjRecord(roomId, userId));
      },
      async _requireMember(actorId, roomId) {
        requireId(actorId, 'actorId');
        const room = await this._requireRoom(roomId);
        const isMember = await this._isRoomMember(roomId, actorId);
        if (!isMember) throw Object.assign(new Error('you must be a member of this room to use its music player'), { status: 403 });
        return room;
      },
      // Playback control (play/pause/next/volume) and queue moderation
      // (remove-any/reorder) are gated by this -- owner OR an active,
      // owner-granted DJ record. Never a client-claimed role.
      async _requireDJ(actorId, roomId) {
        requireId(actorId, 'actorId');
        const room = await this._requireRoom(roomId);
        const isDJ = await this._isDJ(roomId, actorId, room);
        if (!isDJ) throw Object.assign(new Error('only the room owner or an assigned DJ can control music playback'), { status: 403 });
        return room;
      },
      _publish(roomId, event) {
        if (musicBus) musicBus.publish(roomId, event);
      },

      // ---- DJ assignment -------------------------------------------------
      // Only the room owner may grant/revoke DJ. The owner themselves is
      // never a valid target (they are already, always, implicitly in
      // control -- same "no owner-transfer concept, reject outright rather
      // than guess" discipline as rooms.banMember()'s own owner-target
      // guard above), and only a real member of the room may be granted DJ
      // (granting playback control to someone not even in the room has no
      // product meaning).
      async grantDJ(actorId, roomId, targetUserId) {
        requireId(actorId, 'actorId'); requireId(targetUserId, 'targetUserId');
        const room = await this._requireRoom(roomId);
        if (room.ownerId !== actorId) throw Object.assign(new Error('only the room owner can assign a DJ'), { status: 403 });
        if (targetUserId === room.ownerId) throw Object.assign(new Error('the room owner is always in control of music and cannot be assigned as DJ'), { status: 400 });
        const isMember = await this._isRoomMember(roomId, targetUserId);
        if (!isMember) throw Object.assign(new Error('only a member of this room can be assigned as DJ'), { status: 403 });
        // Idempotent, same precedent as social.block()/rooms.banMember():
        // a second grant while one is already active returns the existing
        // record rather than creating a duplicate.
        const existing = await this._activeDjRecord(roomId, targetUserId);
        if (existing) return existing;
        const record = await store.add(17, { type: 'dj', roomId, userId: targetUserId, grantedBy: actorId, status: 'active' });
        // No notificationService.notify() call here on purpose: doing so
        // would require adding a new type to the Stage 33 notification
        // catalog (./domain/notification-catalog.js), which has its own
        // locked-down regression test asserting the exact 19 types
        // planned for that stage (notification-catalog.test.js). Per
        // instruction #7 ("do not touch any other stage"), Stage 17 stays
        // self-contained instead -- the real-time signal DJ grant/revoke
        // needs is `musicBus` below, not a push notification.
        this._publish(roomId, { type: 'dj-granted', roomId, userId: targetUserId });
        return record;
      },
      async revokeDJ(actorId, roomId, targetUserId) {
        requireId(actorId, 'actorId'); requireId(targetUserId, 'targetUserId');
        const room = await this._requireRoom(roomId);
        if (room.ownerId !== actorId) throw Object.assign(new Error('only the room owner can revoke a DJ'), { status: 403 });
        const record = await this._activeDjRecord(roomId, targetUserId);
        if (!record) throw Object.assign(new Error('this account is not currently an assigned DJ in this room'), { status: 404 });
        const updated = await store.update(17, record.id, { status: 'revoked' });
        this._publish(roomId, { type: 'dj-revoked', roomId, userId: targetUserId });
        return updated;
      },
      // Visible to any real member of the room (same defense-in-depth
      // pattern as roomInRoom.listForRoom above).
      async listDJs(actorId, roomId) {
        await this._requireMember(actorId, roomId);
        return store.list(17, r => r.type === 'dj' && r.roomId === roomId && r.status === 'active');
      },

      // ---- Queue -----------------------------------------------------
      // Any real member of the room may queue a track -- the same
      // "request a song" convention every real DJ/room-music product
      // gives its listeners, not just the DJ. Appended at the end of the
      // current queue (position = current queued+playing count).
      async queueAdd(actorId, roomId, input = {}) {
        await this._requireMember(actorId, roomId);
        const title = assertValidTrackTitle(input.title);
        const url = assertValidTrackUrl(input.url);
        const durationSec = assertValidDurationSeconds(input.durationSec);
        const active = await store.list(17, r => r.type === 'track' && r.roomId === roomId && (r.status === 'queued' || r.status === 'playing'));
        const position = active.length;
        const record = await store.add(17, { type: 'track', roomId, requestedBy: actorId, title, url, durationSec, position, status: 'queued' });
        this._publish(roomId, { type: 'queue-added', roomId, track: record });
        return record;
      },
      async _requireQueuedTrack(roomId, trackId) {
        const track = await store.find(17, r => r.type === 'track' && r.id === trackId && r.roomId === roomId);
        if (!track) throw Object.assign(new Error('track not found in this room\'s queue'), { status: 404 });
        return track;
      },
      // Re-numbers the remaining queued tracks in a room to a contiguous
      // 0..n-1 sequence, preserving their relative order -- called after
      // any removal/reorder so `position` always reflects real play order
      // with no gaps, the same invariant a real playback client needs.
      async _reindexQueue(roomId) {
        const queued = (await store.list(17, r => r.type === 'track' && r.roomId === roomId && r.status === 'queued'))
          .sort((a, b) => a.position - b.position);
        await Promise.all(queued.map((t, i) => (t.position === i ? null : store.update(17, t.id, { position: i }))));
      },
      // Removable by: the DJ/owner (may remove anyone's queued track), or
      // the account that originally requested it (may remove their own),
      // same "sender-only, or a real moderator" split as
      // chat.service.js#deleteMessage/reportMessage. Only a still-'queued'
      // track can be removed this way -- a currently playing or already
      // played track is not "removed", it moves on via next()/play().
      async queueRemove(actorId, roomId, trackId) {
        requireId(actorId, 'actorId');
        const room = await this._requireRoom(roomId);
        const track = await this._requireQueuedTrack(roomId, trackId);
        const isDJ = await this._isDJ(roomId, actorId, room);
        if (!isDJ && track.requestedBy !== actorId) {
          throw Object.assign(new Error('only the DJ, the room owner, or the account that requested this track may remove it'), { status: 403 });
        }
        if (track.status !== 'queued') throw Object.assign(new Error(`track is already ${track.status}`), { status: 409 });
        const updated = await store.update(17, trackId, { status: 'removed' });
        await this._reindexQueue(roomId);
        this._publish(roomId, { type: 'queue-removed', roomId, trackId });
        return updated;
      },
      // DJ-only: re-orders a still-queued track to a new 0-based position
      // among the currently queued tracks (a currently playing track is
      // never part of this list -- only the DJ's play()/next() decide what
      // plays, not queue position).
      async queueReorder(actorId, roomId, trackId, position) {
        await this._requireDJ(actorId, roomId);
        const track = await this._requireQueuedTrack(roomId, trackId);
        if (track.status !== 'queued') throw Object.assign(new Error(`only a queued track can be reordered (this one is ${track.status})`), { status: 409 });
        const queued = (await store.list(17, r => r.type === 'track' && r.roomId === roomId && r.status === 'queued'))
          .sort((a, b) => a.position - b.position);
        if (!Number.isInteger(position) || position < 0 || position >= queued.length) {
          throw Object.assign(new Error(`position must be an integer between 0 and ${queued.length - 1}`), { status: 400 });
        }
        const withoutTrack = queued.filter(t => t.id !== trackId);
        withoutTrack.splice(position, 0, track);
        await Promise.all(withoutTrack.map((t, i) => (t.position === i ? null : store.update(17, t.id, { position: i }))));
        const reordered = await store.list(17, r => r.type === 'track' && r.roomId === roomId && r.status === 'queued');
        this._publish(roomId, { type: 'queue-reordered', roomId });
        return reordered.sort((a, b) => a.position - b.position);
      },
      // Any real member of the room may view the queue.
      async queueList(actorId, roomId) {
        await this._requireMember(actorId, roomId);
        const tracks = await store.list(17, r => r.type === 'track' && r.roomId === roomId && (r.status === 'queued' || r.status === 'playing'));
        return tracks.sort((a, b) => a.position - b.position);
      },

      // ---- Playback state ---------------------------------------------
      // One player-state record per room, created lazily on first real use
      // (same "find-then-create" upsert shape as profile.create() above --
      // no migration/seed step needed for a room that has never touched
      // music yet).
      async _getOrCreatePlayerState(roomId) {
        const existing = await store.find(17, r => r.type === 'player' && r.roomId === roomId);
        if (existing) return existing;
        return store.add(17, { type: 'player', roomId, status: 'stopped', currentTrackId: null, volume: DEFAULT_VOLUME, updatedBy: null });
      },
      // DJ-only. With an explicit trackId, plays that specific still-queued
      // track (409 if it isn't queued -- e.g. already playing/played/
      // removed, or belongs to a different room). With no trackId: resumes
      // a paused track in place, or -- if nothing is paused -- auto-picks
      // the lowest-position queued track (409 if the queue is empty). A
      // track that was already playing when play() switches to a different
      // one is marked 'played' (never left dangling as 'playing'), the
      // same "at most one real playing track per room" invariant next()
      // below also maintains.
      async play(actorId, roomId, trackId) {
        const room = await this._requireDJ(actorId, roomId);
        const state = await this._getOrCreatePlayerState(roomId);
        let track;
        if (trackId) {
          track = await this._requireQueuedTrack(roomId, trackId);
          if (track.status !== 'queued') throw Object.assign(new Error(`track is already ${track.status}`), { status: 409 });
        } else if (state.status === 'paused' && state.currentTrackId) {
          track = await store.find(17, r => r.type === 'track' && r.id === state.currentTrackId);
        } else {
          const queued = (await store.list(17, r => r.type === 'track' && r.roomId === roomId && r.status === 'queued'))
            .sort((a, b) => a.position - b.position);
          track = queued[0];
          if (!track) throw Object.assign(new Error('the queue is empty'), { status: 409 });
        }
        if (state.currentTrackId && state.currentTrackId !== track.id) {
          const previous = await store.find(17, r => r.type === 'track' && r.id === state.currentTrackId);
          if (previous && previous.status === 'playing') await store.update(17, previous.id, { status: 'played' });
        }
        if (track.status === 'queued') await store.update(17, track.id, { status: 'playing' });
        const updated = await store.update(17, state.id, { status: 'playing', currentTrackId: track.id, updatedBy: actorId });
        this._publish(roomId, { type: 'play', roomId, trackId: track.id, byUserId: actorId });
        return updated;
      },
      // DJ-only. Pauses the currently playing track in place -- the track
      // itself stays 'playing' (it hasn't ended or moved in the queue),
      // only the room's player status changes, so play() with no trackId
      // resumes the exact same track.
      async pause(actorId, roomId) {
        await this._requireDJ(actorId, roomId);
        const state = await this._getOrCreatePlayerState(roomId);
        if (state.status !== 'playing') throw Object.assign(new Error('nothing is currently playing in this room'), { status: 409 });
        const updated = await store.update(17, state.id, { status: 'paused', updatedBy: actorId });
        this._publish(roomId, { type: 'pause', roomId, byUserId: actorId });
        return updated;
      },
      // DJ-only. Ends the current track (marks it 'played', never left
      // dangling) and auto-advances to the next lowest-position queued
      // track, or stops the player if the queue is now empty -- a real
      // effect, not just an audit flag, same discipline Stage 14/16's
      // seat/kick/mute actions already follow.
      async next(actorId, roomId) {
        await this._requireDJ(actorId, roomId);
        const state = await this._getOrCreatePlayerState(roomId);
        if (state.currentTrackId) {
          const current = await store.find(17, r => r.type === 'track' && r.id === state.currentTrackId);
          if (current && current.status === 'playing') await store.update(17, current.id, { status: 'played' });
        }
        const queued = (await store.list(17, r => r.type === 'track' && r.roomId === roomId && r.status === 'queued'))
          .sort((a, b) => a.position - b.position);
        const nextTrack = queued[0];
        let updated;
        if (nextTrack) {
          await store.update(17, nextTrack.id, { status: 'playing' });
          updated = await store.update(17, state.id, { status: 'playing', currentTrackId: nextTrack.id, updatedBy: actorId });
        } else {
          updated = await store.update(17, state.id, { status: 'stopped', currentTrackId: null, updatedBy: actorId });
        }
        this._publish(roomId, { type: 'next', roomId, trackId: updated.currentTrackId, byUserId: actorId });
        return updated;
      },
      // DJ-only. Sets the room's shared playback volume (0-100) -- a
      // single, real, room-wide value every listener hears, not a
      // per-listener client-side setting.
      async setVolume(actorId, roomId, volume) {
        await this._requireDJ(actorId, roomId);
        const validVolume = assertValidVolume(volume);
        const state = await this._getOrCreatePlayerState(roomId);
        const updated = await store.update(17, state.id, { volume: validVolume, updatedBy: actorId });
        this._publish(roomId, { type: 'volume', roomId, volume: validVolume, byUserId: actorId });
        return updated;
      },
      // Any real member of the room may view the current playback state
      // and queue together -- the one call a client needs on room entry
      // (or reconnect) to render the music player fully in sync with
      // everyone else, the exact real-time consistency requirement this
      // stage's instructions call for.
      async getState(actorId, roomId) {
        await this._requireMember(actorId, roomId);
        const state = await this._getOrCreatePlayerState(roomId);
        const queue = await this.queueList(actorId, roomId);
        return { ...state, queue };
      },
    },
    // Stage 18 -- `battles` used to be a bare store.add(18, ...) stub
    // here (pending status, no authorization, no state machine, no real
    // effect on anything). It has been REMOVED in favor of a real,
    // dedicated domain: see ./services/battle.service.js,
    // ./database/repositories/battle.repository.js and
    // ./database/schema/024_create_battles.sql. Confirmed unreferenced
    // anywhere in this codebase (`grep -rn "platform.battles"` -- empty)
    // before deletion, same removal discipline as the old
    // `notifications.enqueue` stub below.
    // Phase 4 -- startedBy is now required (server sets it from the acting
    // session in platform.routes.js, exactly like battles.hostId already
    // does) so that GET /api/games can filter to "my games" the same way
    // GET /api/battles already filters by hostId/opponentId. Without this
    // field there would be no way to scope a game list to the caller
    // without exposing every session's games to every other session.
    games: { create(input) { return store.add(19,{roomId:requireId(input.roomId,'roomId'),gameId:requireId(input.gameId,'gameId'),version:requireString(input.version||'1','version',30),startedBy:requireId(input.startedBy,'startedBy'),matchId:id('match'),state:'lobby'}); } },
    wallet: { ledger(input) { return store.add(24,{userId:requireId(input.userId,'userId'),currency:requireString(input.currency,'currency',20),amount:Number(input.amount),referenceId:requireId(input.referenceId,'referenceId'),status:input.status||'pending'}); } },
    gifts: { send(input) { return store.add(26,{roomId:requireId(input.roomId,'roomId'),senderId:requireId(input.senderId,'senderId'),receiverId:requireId(input.receiverId,'receiverId'),giftId:requireId(input.giftId,'giftId'),quantity:Number.isInteger(input.quantity)?input.quantity:1,referenceId:requireId(input.referenceId,'referenceId'),status:'pending'}); } },
    inventory: { grant(input) { return store.add(29,{userId:requireId(input.userId,'userId'),itemId:requireId(input.itemId,'itemId'),source:input.source||'system',status:'owned'}); } },
    // Stage 33 -- the old `notifications.enqueue()` primitive above (a
    // dead stage-33 store record with no real reader) is REMOVED here.
    // Confirmed unreferenced anywhere in this codebase
    // (`grep -rn "notifications.enqueue"` -- empty) before deletion. Real
    // notifications now go through ../services/notification.service.js's
    // notify(), backed by its own dedicated repository (see
    // ../database/repositories/notification.repository.js) -- not
    // through this generic stage-33 store slot.
    // Stage 34 -- the old `settings.set()` primitive above (a bare
    // append-only `store.add(34, {userId, key, value})`, no validation,
    // no update-in-place, no fixed key set) is REMOVED here. Confirmed
    // unreferenced anywhere in this codebase (`grep -rn "platform.settings"`
    // -- empty) before deletion, same removal discipline as the old
    // `notifications.enqueue`/`battles` stubs above. Real settings now go
    // through ../services/settings.service.js, backed by its own
    // dedicated repository (see
    // ../database/repositories/settings.repository.js) -- not through
    // this generic stage-34 store slot. See STAGE_34_FINAL_REPORT.md.
    // Stage 35 Part 1/8 -- Report. reporterId/targetId/reason were already
    // format-validated (requireId/requireString); the one real gap found on
    // audit is that a caller could name themselves as the target, which
    // chat.service.js#reportMessage already rejects (403) for message
    // reports -- report() now enforces the same rule for this generic
    // report so both entry points agree. Nothing else changes: reporterId
    // still only ever comes from req.session.accountId at the route (see
    // platform.routes.js), never from input, and persistence/status/shape
    // are unchanged. ticket() (Part 8/8, Customer Support) is untouched.
    // `async` (not a plain function) so every validation throw above the
    // store.add() call -- same as follow()/friend() above -- is delivered
    // as a rejected promise, not a synchronous throw; route.js's `json()`
    // wrapper catches either shape, but this keeps report() awaitable the
    // same uniform way as every other domain method here and in its tests.
    moderation: {
      async report(input) { const reporterId=requireId(input.reporterId,'reporterId'); const targetId=requireId(input.targetId,'targetId'); if (targetId===reporterId) throw Object.assign(new Error('you cannot report yourself'), { status: 403 }); return store.add(35,{reporterId,targetId,reason:requireString(input.reason,'reason',500),status:'open'}); },
      // Stage 35 Part 8/8 -- Customer Support. ticket() itself was left as
      // a bare stub by Part 1 (see the comment above report()); this is
      // that stub's real completion, not a replacement -- it still
      // returns the exact same shape (reporterId/type/description/status/
      // messages, same stage-35 store) every existing caller (three
      // pre-existing tests plus POST /api/support/tickets) already
      // depends on, it just adds the real validated type catalog (section
      // 5 of this work package -- arbitrary client-supplied types are no
      // longer accepted) plus the extra real fields (attachments/
      // staffReplies/history) the `support` object below operates on.
      // `messages` is left completely alone (still an always-empty spare
      // array, exactly as Part 1 built it) since it is the exact field
      // myTickets()'s structural discriminator (./platform.reads.js) keys
      // off of -- changing its shape would silently break that filter.
      // Now `async` (Part 1's original stub was a plain function, safe
      // only because it had no validation that could throw) -- the new
      // type-catalog check above the store.add() call now needs the same
      // "every throw delivered as a rejected promise" discipline
      // report() documents on itself just above, since callers (routes,
      // tests) uniformly use await/.rejects() against every domain
      // method in this file.
      async ticket(input) {
        const reporterId = requireId(input.reporterId, 'reporterId');
        const type = requireString(input.type, 'type', 60);
        if (!TICKET_TYPES.includes(type)) throw Object.assign(new Error(`type must be one of ${TICKET_TYPES.join(', ')}`), { status: 400 });
        const description = requireString(input.description, 'description', 5000);
        return store.add(35, {
          reporterId, type, description, status: 'open', messages: [],
          attachments: [], staffReplies: [],
          history: [{ action: 'created', actorId: reporterId, at: now() }],
        });
      },
      // Stage 35 Part 8/8 -- Customer Support, the rest of the lifecycle
      // on top of ticket() above: staff replies, status transitions,
      // escalation, attachments, and the ticket queue/detail reads staff
      // need. Same stage-35 store as ticket() itself -- no second ticket
      // system. Same reviewer authorization as Part 6/7 above
      // (isReviewer(reviewers, actorId) against the real, server-only
      // allowlist from ./config/moderation-staff.js) -- this is a REUSE
      // of that authorization, not a new staff/admin role. FAQ is
      // separate, real static content served by
      // ../services/settings.service.js#getFaq() (see
      // ../domain/legal-content.js#FAQ_CONTENT) -- not duplicated here.
      support: {
        async _requireReviewer(actorId) {
          requireId(actorId, 'actorId');
          // Stage 36 -- OR the legacy allowlist with the new central
          // Staff/RBAC system (../security/staff.js): an account with the
          // 'moderator'/'admin'/'superadmin' role there is authorized even
          // if it was never added to MODERATION_REVIEWER_IDS. See
          // ../security/staff.js's header for why this is additive, not a
          // replacement.
          if (!isReviewer(reviewers, actorId) && !hasPermission(staff, actorId, PERMISSIONS.CONTENT_REVIEW)) {
            throw Object.assign(new Error('reviewer authorization required'), { status: 403 });
          }
          return actorId;
        },
        // A ticket is any stage-35 record shaped the way ticket() above
        // builds it -- has `messages`, same structural discriminator
        // myTickets() already uses, so a report/review/appeal record can
        // never be misread as a ticket here.
        async _requireTicket(ticketId) {
          requireId(ticketId, 'ticketId');
          const record = await store.find(35, (r) => r.id === ticketId && Object.prototype.hasOwnProperty.call(r, 'messages'));
          if (!record) throw Object.assign(new Error('ticket not found'), { status: 404 });
          return record;
        },
        // GET /api/support/tickets/:id -- own-only (403 on someone else's
        // ticket), same shape as appeals.getMine() above. Requester
        // identity is always the caller's own actorId (from
        // req.session.accountId at the route layer), never trusted from
        // input -- never spoofable.
        async getMine(actorId, ticketId) {
          requireId(actorId, 'actorId');
          const t = await this._requireTicket(ticketId);
          if (t.reporterId !== actorId) throw Object.assign(new Error('you may only view your own support tickets'), { status: 403 });
          return t;
        },
        // GET /api/support/queue -- every ticket, reviewer/staff-only.
        // Deliberately NOT scoped to the caller (same "queue sees
        // everything, own-* sees only mine" split as review.list()/
        // appeals.queue() above).
        async queue(actorId, { status } = {}) {
          await this._requireReviewer(actorId);
          const all = await store.list(35, (r) => Object.prototype.hasOwnProperty.call(r, 'messages'));
          let items = all.slice().reverse();
          if (status) items = items.filter((t) => t.status === status);
          return items;
        },
        // GET /api/support/queue/:id -- reviewer-only retrieval of any
        // single ticket (deliberately NOT own-only, unlike getMine()
        // above -- staff must be able to open any requester's ticket).
        async getForStaff(actorId, ticketId) {
          await this._requireReviewer(actorId);
          return this._requireTicket(ticketId);
        },
        // POST /api/support/tickets/:id/reply -- staff reply. staffId is
        // always actorId from req.session.accountId, checked against the
        // real allowlist -- never a client-supplied staffId/role field
        // (this work package's section 7/11). Ordering is preserved by
        // simple array append; requester reads the same array back
        // unfiltered via getMine() above, so replies are always visible
        // on their own ticket.
        async reply(actorId, ticketId, body) {
          await this._requireReviewer(actorId);
          const t = await this._requireTicket(ticketId);
          if (t.status === 'closed') throw Object.assign(new Error('this ticket is closed'), { status: 409 });
          const cleanBody = requireString(body, 'body', 5000);
          const entry = { staffId: actorId, body: cleanBody, at: now() };
          return store.update(35, t.id, {
            staffReplies: [...(t.staffReplies || []), entry],
            history: [...(t.history || []), { action: 'staff_reply', actorId, at: now() }],
          });
        },
        // POST /api/support/tickets/:id/status -- staff-only, enforced
        // valid transitions only. The CURRENT status is always read from
        // the persisted record, never taken from the request, so a
        // requester (who can never call this -- reviewer-gated) cannot
        // spoof a transition by claiming a fictitious current state
        // (this work package's section 6/11).
        async setStatus(actorId, ticketId, status) {
          await this._requireReviewer(actorId);
          const t = await this._requireTicket(ticketId);
          if (!TICKET_STATUSES.includes(status)) throw Object.assign(new Error(`status must be one of ${TICKET_STATUSES.join(', ')}`), { status: 400 });
          const allowed = TICKET_STATUS_TRANSITIONS[t.status] || [];
          if (!allowed.includes(status)) throw Object.assign(new Error(`cannot transition ticket from ${t.status} to ${status}`), { status: 409 });
          return store.update(35, t.id, {
            status,
            history: [...(t.history || []), { action: 'status_changed', actorId, from: t.status, to: status, at: now() }],
          });
        },
        // POST /api/support/tickets/:id/escalate -- staff-only. A
        // resolved/closed ticket has nothing left to escalate; escalating
        // an already-escalated ticket is a no-op (idempotent-return, same
        // convention as block()/muteUser() above), not an error.
        async escalate(actorId, ticketId) {
          await this._requireReviewer(actorId);
          const t = await this._requireTicket(ticketId);
          if (t.status === 'resolved' || t.status === 'closed') throw Object.assign(new Error(`cannot escalate a ${t.status} ticket`), { status: 409 });
          if (t.status === 'escalated') return t;
          return store.update(35, t.id, {
            status: 'escalated',
            history: [...(t.history || []), { action: 'escalated', actorId, at: now() }],
          });
        },
        // POST /api/support/tickets/:id/attachments -- own-ticket only.
        // No upload/CDN pipeline exists anywhere in this codebase (see
        // ../database/models/room.model.js#assertValidImageUrl's own
        // header) -- reused here unchanged, same "http(s) URL the client
        // already has hosted somewhere" boundary as room cover/background
        // and chat image messages, not a fabricated attachment record.
        async attach(actorId, ticketId, url) {
          requireId(actorId, 'actorId');
          const t = await this._requireTicket(ticketId);
          if (t.reporterId !== actorId) throw Object.assign(new Error('you may only add attachments to your own ticket'), { status: 403 });
          if (t.status === 'closed') throw Object.assign(new Error('this ticket is closed'), { status: 409 });
          const cleanUrl = assertValidImageUrl(url, 'attachment');
          if (!cleanUrl) throw Object.assign(new Error('attachment is required'), { status: 400 });
          return store.update(35, t.id, {
            attachments: [...(t.attachments || []), cleanUrl],
            history: [...(t.history || []), { action: 'attachment_added', actorId, at: now() }],
          });
        },
      },
      // Stage 35 Part 6/8 -- Content Review.
      //
      // AUDIT (see STAGE_35_CONTENT_REVIEW_FINAL_REPORT.md section 2 for
      // the full writeup): the only pre-existing "queue" this codebase has
      // is Report itself (store 35, reporterId/targetId/reason/status --
      // status is always 'open', never transitioned by anything). There is
      // no review/reviewer/flag/decision concept anywhere. Content Review
      // is built as a genuinely new, thin layer ON TOP of the real Report
      // records -- it never redesigns report()/ticket() above (both are
      // byte-for-byte unchanged) and never creates a second report system.
      //
      // Persistence: reuses the SAME stage-35 store report()/ticket()
      // already use -- not a new store/number. Review records are
      // discriminated from Report (reporterId+targetId+reason) and Ticket
      // (reporterId+type+description+messages) via an explicit `kind`
      // field, deliberately different from the *structural* (no
      // discriminator field) convention Report/Ticket already established
      // in platform.reads.js's myReports()/myTickets() -- that convention
      // exists only because those two shapes predate this stage and can
      // never be touched; every field this stage adds is new, so a real
      // `kind` field is the clearer choice for it and cannot collide with
      // Report/Ticket's own filters (neither of which checks for `kind`,
      // and a review/appeal record is deliberately given neither a
      // `reporterId`+`targetId` pair nor a `messages` array, so it can
      // never be misclassified as a Report or a Ticket by the existing
      // read-side helpers either).
      //
      // Review status model (distinct from -- and never mutating --
      // report.status, which per the audit above is always 'open' and is
      // left completely alone): a report with no review record yet is
      // implicitly 'open' (unreviewed); assign()/decision() create it in
      // 'in_review'; decision() moves it to the terminal 'resolved'. No
      // 'reopen' is implemented -- not requested, and reusing existing
      // conventions (kick/ban/block/mute never "reopen" either; a fresh
      // action is always a fresh record) rather than inventing a new one.
      review: {
        // Never trusts a client-supplied reviewerId/role (see this work
        // package's instructions, section 4) -- `actorId` here is always
        // req.session.accountId from the route layer, exactly like every
        // other actorId in this file, checked against the real,
        // server-only allowlist from ./config/moderation-staff.js.
        async _requireReviewer(actorId) {
          requireId(actorId, 'actorId');
          // Stage 36 -- same additive OR with the central Staff/RBAC
          // system as support._requireReviewer() above.
          if (!isReviewer(reviewers, actorId) && !hasPermission(staff, actorId, PERMISSIONS.CONTENT_REVIEW)) {
            throw Object.assign(new Error('reviewer authorization required'), { status: 403 });
          }
          return actorId;
        },
        // A "report" for review purposes is any stage-35 record shaped
        // like report() built it (has targetId, not a kind:'review'/
        // 'appeal' record and not a ticket, which report()/ticket() above
        // already keep distinguishable from each other via targetId vs
        // messages -- same structural check reused here, just also
        // excluding this stage's own new `kind`-tagged records).
        async _requireReport(reportId) {
          requireId(reportId, 'reportId');
          const record = await store.find(35, (r) => r.id === reportId && !r.kind && Object.prototype.hasOwnProperty.call(r, 'targetId'));
          if (!record) throw Object.assign(new Error('report not found'), { status: 404 });
          return record;
        },
        async _findReview(reportId) {
          return store.find(35, (r) => r.kind === 'review' && r.reportId === reportId);
        },
        // Only what review requires is exposed (this work package's
        // section 5 privacy instruction): the report's own already-minimal
        // fields (reporterId/targetId/reason/timestamps -- nothing beyond
        // what report() itself already stores) plus this stage's own
        // review fields. No other account/profile data is joined in.
        _project(report, review) {
          return {
            reportId: report.id,
            reporterId: report.reporterId,
            reportedAccountId: report.targetId,
            reason: report.reason,
            reportedAt: report.createdAt,
            reviewId: review ? review.id : null,
            status: review ? review.status : 'open',
            reviewerId: review ? review.reviewerId : null,
            decision: review ? review.decision : null,
            notes: review ? review.notes : '',
            evidence: review ? review.evidence : '',
            history: review ? review.history : [],
            resolvedAt: review ? review.resolvedAt : null,
          };
        },
        // GET /api/moderation/review -- the review queue. Reviewer-only
        // (never reachable by a normal user -- see _requireReviewer above).
        async list(actorId, { status } = {}) {
          await this._requireReviewer(actorId);
          const [reports, reviews] = await Promise.all([
            store.list(35, (r) => !r.kind && Object.prototype.hasOwnProperty.call(r, 'targetId')),
            store.list(35, (r) => r.kind === 'review'),
          ]);
          const byReport = new Map(reviews.map((r) => [r.reportId, r]));
          let items = reports.map((r) => this._project(r, byReport.get(r.id)));
          if (status) items = items.filter((i) => i.status === status);
          return items.slice().reverse();
        },
        // GET /api/moderation/review/:id -- retrieve one reported item.
        async get(actorId, reportId) {
          await this._requireReviewer(actorId);
          const report = await this._requireReport(reportId);
          const review = await this._findReview(reportId);
          return this._project(report, review);
        },
        // POST /api/moderation/review/:id/assign -- reviewer assignment.
        // Self-assign only: this codebase has no reviewer directory beyond
        // the flat allowlist (no way to verify a *different* named
        // reviewer id is meaningful/valid without inventing a staff
        // directory nothing here asked for), so "assign" always means "I,
        // the calling reviewer, am taking this" -- the same self-scoped
        // shape as every other actor-is-always-the-caller action in this
        // file. Idempotent for the same reviewer; a 409 conflict if
        // another reviewer already has it or it is already resolved
        // (this work package's "prevent unauthorized status/decision
        // changes" + "duplicate/conflicting decisions" requirements).
        async assign(actorId, reportId) {
          await this._requireReviewer(actorId);
          const report = await this._requireReport(reportId);
          const existing = await this._findReview(reportId);
          if (existing) {
            if (existing.status === 'resolved') throw Object.assign(new Error('this report has already been resolved'), { status: 409 });
            if (existing.reviewerId !== actorId) throw Object.assign(new Error('this report is already assigned to another reviewer'), { status: 409 });
            return this._project(report, existing);
          }
          const review = await store.add(35, {
            kind: 'review', reportId, reportedAccountId: report.targetId,
            status: 'in_review', reviewerId: actorId, decision: null, notes: '', evidence: '', resolvedAt: null,
            history: [{ action: 'assigned', actorId, at: now() }],
          });
          if (auditService) await auditService.record({ actorId, action: 'content-review:assign', targetType: 'report', targetId: reportId });
          return this._project(report, review);
        },
        // POST /api/moderation/review/:id/decision -- the real outcome.
        //
        // AUDIT (section 6 of this work package): a decision could only
        // legitimately "trigger an existing action" if this codebase had
        // an action a global reviewer is actually authorized to invoke on
        // someone else's behalf. It does not -- social.block()/muteUser()
        // are self-scoped (only the acting account's own relationship),
        // and rooms.banMember()/kick()/muteMember() are room-owner-scoped
        // (requireId(actorId)===room.ownerId, see Part 5's report) --
        // there is no admin-override path into any of them, and adding
        // one is exactly the kind of new authority/action this work
        // package's section 6 says not to invent. So a decision here is a
        // real, persisted, auditable outcome record -- not a fake trigger
        // of a side effect that this codebase has no authorized way to
        // perform. `outcome` is a fixed enum (never free text) for the
        // same reason every other status field in this codebase is:
        // 'dismissed' (no violation found) or 'upheld' (violation
        // confirmed -- this is the "real moderation/review outcome" Part
        // 7 Appeals' eligibility check below keys off of).
        async decision(actorId, reportId, { outcome, notes, evidence } = {}) {
          await this._requireReviewer(actorId);
          const report = await this._requireReport(reportId);
          const validOutcomes = ['dismissed', 'upheld'];
          if (!validOutcomes.includes(outcome)) throw Object.assign(new Error(`outcome must be one of ${validOutcomes.join(', ')}`), { status: 400 });
          const cleanNotes = notes ? requireString(notes, 'notes', 2000) : '';
          const cleanEvidence = evidence ? requireString(evidence, 'evidence', 2000) : '';
          const existing = await this._findReview(reportId);
          if (existing && existing.status === 'resolved') throw Object.assign(new Error('this report has already been resolved'), { status: 409 });
          if (existing && existing.reviewerId !== actorId) throw Object.assign(new Error('this report is assigned to another reviewer'), { status: 403 });
          const decisionEntry = { action: 'decision', actorId, outcome, at: now() };
          let review;
          if (!existing) {
            review = await store.add(35, {
              kind: 'review', reportId, reportedAccountId: report.targetId,
              status: 'resolved', reviewerId: actorId, decision: outcome, notes: cleanNotes, evidence: cleanEvidence, resolvedAt: now(),
              history: [{ action: 'assigned', actorId, at: now() }, decisionEntry],
            });
          } else {
            review = await store.update(35, existing.id, {
              status: 'resolved', decision: outcome, notes: cleanNotes, evidence: cleanEvidence, resolvedAt: now(),
              history: [...existing.history, decisionEntry],
            });
          }
          if (auditService) await auditService.record({ actorId, action: 'content-review:decision', targetType: 'report', targetId: reportId, metadata: { outcome } });
          return this._project(report, review);
        },
      },
      // Stage 35 Part 7/8 -- Appeals, FIRST HALF ONLY (user submission
      // side). Per this work package's explicit stop rule: staff
      // adjudication of an appeal (second half) and Part 8/8 (Customer
      // Support/FAQ/Tickets) are deliberately NOT implemented here -- see
      // STAGE_35_APPEALS_FIRST_HALF_PROGRESS.md.
      //
      // An appeal always references a REAL, resolved Content Review
      // decision -- never a free-standing complaint. Persisted in the
      // same stage-35 store, `kind:'appeal'`, same discriminator
      // convention as `kind:'review'` above (and same non-collision
      // reasoning: an appeal record has neither targetId+reporterId nor
      // messages, so it can never be misread as a Report or a Ticket).
      appeals: {
        async _requireReview(reviewId) {
          requireId(reviewId, 'reviewId');
          const record = await store.find(35, (r) => r.id === reviewId && r.kind === 'review');
          if (!record) throw Object.assign(new Error('review not found'), { status: 404 });
          return record;
        },
        // POST /api/moderation/appeals -- create.
        //
        // Eligibility (this work package's section 13/14): the review
        // must be a REAL, resolved record (never a client-claimed
        // decision -- decision/status are read from the persisted review,
        // never taken from input) whose outcome was 'upheld' (a
        // 'dismissed' report has nothing adverse to appeal), and the
        // caller must be the account that decision was actually made
        // against (`review.reportedAccountId`) -- never the original
        // reporter, and never an unrelated account naming someone else's
        // review id. One appeal per review (idempotent-reject, not
        // idempotent-return, since a second appeal attempt is exactly the
        // "duplicate abuse" this work package's section 14 says to
        // prevent -- unlike ban/block's idempotent-return, there is
        // nothing safe to silently no-op here: a second submission would
        // usually carry a materially different `reason`, so silently
        // discarding it in favor of the first would hide real user intent
        // -- rejecting with 409 is the honest response).
        async create(actorId, input) {
          requireId(actorId, 'actorId');
          const reviewId = requireId(input.reviewId, 'reviewId');
          const reason = requireString(input.reason, 'reason', 1000);
          const review = await this._requireReview(reviewId);
          if (review.status !== 'resolved') throw Object.assign(new Error('this review has not been resolved yet'), { status: 409 });
          if (review.decision !== 'upheld') throw Object.assign(new Error('this outcome is not eligible for appeal'), { status: 403 });
          if (review.reportedAccountId !== actorId) throw Object.assign(new Error('you may only appeal a decision made against your own account'), { status: 403 });
          const existingAppeal = await store.find(35, (r) => r.kind === 'appeal' && r.reviewId === reviewId);
          if (existingAppeal) throw Object.assign(new Error('an appeal for this decision has already been submitted'), { status: 409 });
          return store.add(35, {
            kind: 'appeal', reviewId, reportId: review.reportId, appellantId: actorId,
            reason, status: 'submitted',
          });
        },
        // GET /api/moderation/appeals -- the caller's own appeals only.
        async listMine(actorId) {
          requireId(actorId, 'actorId');
          const all = await store.list(35, (r) => r.kind === 'appeal' && r.appellantId === actorId);
          return all.slice().reverse();
        },
        // GET /api/moderation/appeals/:id -- one appeal, own-only (403 on
        // someone else's, same "you may only access your own" shape as
        // assertOwnAccount()/myReports() elsewhere in this codebase).
        async getMine(actorId, appealId) {
          requireId(actorId, 'actorId'); requireId(appealId, 'appealId');
          const record = await store.find(35, (r) => r.kind === 'appeal' && r.id === appealId);
          if (!record) throw Object.assign(new Error('appeal not found'), { status: 404 });
          if (record.appellantId !== actorId) throw Object.assign(new Error('you may only view your own appeals'), { status: 403 });
          return record;
        },

        // ---------------------------------------------------------------
        // Stage 35 Part 7/8 -- Appeals, SECOND HALF (staff adjudication).
        //
        // AUTH: never trusts a client-supplied reviewerId/staffId/role
        // (this work package's section 3). `actorId` here is always
        // req.session.accountId from the route layer, exactly like every
        // other actor in this file, checked against the exact same real,
        // server-only allowlist Part 6 uses: isReviewer(reviewers, ...)
        // from ./config/moderation-staff.js, with the identical
        // `reviewers` Set already loaded once in this closure (see
        // createPlatform above). This is a REUSE of Part 6's
        // authorization, not a second role system -- it cannot be
        // written as `moderation.review._requireReviewer(actorId)`
        // because `review` and `appeals` are sibling properties being
        // built in the same object literal (see the `social` const
        // comment near the top of this file for why cross-sibling `this`
        // doesn't work there); calling the same isReviewer()+`reviewers`
        // primitive Part 6's own _requireReviewer() calls is the honest
        // equivalent of reusing that method.
        async _requireReviewer(actorId) {
          requireId(actorId, 'actorId');
          // Stage 36 -- same additive OR with the central Staff/RBAC
          // system as support._requireReviewer() above.
          if (!isReviewer(reviewers, actorId) && !hasPermission(staff, actorId, PERMISSIONS.CONTENT_REVIEW)) {
            throw Object.assign(new Error('reviewer authorization required'), { status: 403 });
          }
          return actorId;
        },
        async _requireAppeal(appealId) {
          requireId(appealId, 'appealId');
          const record = await store.find(35, (r) => r.id === appealId && r.kind === 'appeal');
          if (!record) throw Object.assign(new Error('appeal not found'), { status: 404 });
          return record;
        },

        // GET /api/moderation/appeals/queue -- every submitted appeal,
        // reviewer-only (never reachable by a normal user, including the
        // appellant themselves -- they already have listMine()/getMine()
        // above for their own appeals). Unlike listMine(), this is not
        // scoped to the caller: a reviewer must be able to see appeals
        // filed by any account, same "queue sees everything, own-* sees
        // only mine" split Part 6 already established between
        // review.list() and (the non-existent, by design) "my reviews".
        async queue(actorId, { status } = {}) {
          await this._requireReviewer(actorId);
          const all = await store.list(35, (r) => r.kind === 'appeal');
          let items = all.slice().reverse();
          if (status) items = items.filter((a) => a.status === status);
          return items;
        },
        // GET /api/moderation/appeals/queue/:id -- reviewer-only
        // retrieval of any single appeal (deliberately NOT own-only,
        // unlike getMine() above -- a reviewer must be able to open an
        // appeal filed by an account other than themselves).
        async getForReview(actorId, appealId) {
          await this._requireReviewer(actorId);
          return this._requireAppeal(appealId);
        },
        // POST /api/moderation/appeals/:id/assign -- self-assign only,
        // same reasoning/shape as review.assign() above: this codebase
        // has no reviewer directory beyond the flat allowlist, so
        // "assign" always means "I, the calling reviewer, am taking
        // this appeal". Idempotent for the same reviewer; 409 if another
        // reviewer already has it or it is already resolved (this work
        // package's duplicate/conflicting-decision protection).
        async assign(actorId, appealId) {
          await this._requireReviewer(actorId);
          const appeal = await this._requireAppeal(appealId);
          if (appeal.status === 'resolved') throw Object.assign(new Error('this appeal has already been decided'), { status: 409 });
          if (appeal.reviewerId && appeal.reviewerId !== actorId) throw Object.assign(new Error('this appeal is already assigned to another reviewer'), { status: 409 });
          if (appeal.reviewerId === actorId) return appeal;
          return store.update(35, appeal.id, {
            status: 'under_review',
            reviewerId: actorId,
            history: [...(appeal.history || []), { action: 'assigned', actorId, at: now() }],
          });
        },
        // POST /api/moderation/appeals/:id/decision -- the real outcome:
        // 'upheld' (the original Content Review decision stands, appeal
        // denied) or 'overturned' (the original decision is reversed,
        // appeal granted). Valid transitions only: an already-resolved
        // appeal can never be decided again (409 -- prevents duplicate/
        // conflicting decisions), and an appeal already assigned to a
        // different reviewer cannot be decided by this one (403 --
        // prevents reviewer impersonation / unauthorized modification of
        // another reviewer's in-progress appeal). Deciding an
        // unassigned appeal implicitly assigns it to the deciding
        // reviewer first (same "decision can self-assign in one step"
        // shape as review.decision() above).
        async decision(actorId, appealId, { outcome, notes, evidence } = {}) {
          await this._requireReviewer(actorId);
          const appeal = await this._requireAppeal(appealId);
          const validOutcomes = ['upheld', 'overturned'];
          if (!validOutcomes.includes(outcome)) throw Object.assign(new Error(`outcome must be one of ${validOutcomes.join(', ')}`), { status: 400 });
          if (appeal.status === 'resolved') throw Object.assign(new Error('this appeal has already been decided'), { status: 409 });
          if (appeal.reviewerId && appeal.reviewerId !== actorId) throw Object.assign(new Error('this appeal is assigned to another reviewer'), { status: 403 });
          const cleanNotes = notes ? requireString(notes, 'notes', 2000) : '';
          const cleanEvidence = evidence ? requireString(evidence, 'evidence', 2000) : '';
          // Appeal decisions always reference the REAL, persisted
          // original Content Review record -- never a client-claimed
          // one -- via the same reviewId the appeal was created against
          // (immutable since create(), never taken from this call's
          // input).
          const review = await this._requireReview(appeal.reviewId);

          const priorHistory = appeal.history || [];
          const decisionEntry = { action: 'decision', actorId, outcome, at: now() };
          const history = appeal.reviewerId === actorId
            ? [...priorHistory, decisionEntry]
            : [...priorHistory, { action: 'assigned', actorId, at: now() }, decisionEntry];

          const updatedAppeal = await store.update(35, appeal.id, {
            status: 'resolved', reviewerId: actorId, outcome,
            notes: cleanNotes, evidence: cleanEvidence, resolvedAt: now(), history,
          });

          // Follow-on effect on the ORIGINAL review record.
          //
          // AUDIT (mirrors review.decision()'s own audit comment above):
          // a Part 6 decision never triggers any ban/mute/room action a
          // reviewer isn't already separately authorized to invoke --
          // there is no sanction anywhere in this codebase for an
          // overturned appeal to reverse. The only real, existing state
          // an overturn CAN honestly change is the review's own
          // `decision` field -- so that is the only thing this does.
          // 'upheld' (appeal denied) leaves the review's `decision`
          // completely untouched, only appending an audit history entry
          // -- the original outcome stands exactly as Part 6 recorded
          // it. Never invents a new sanction/reversal system.
          const reviewHistoryEntry = {
            action: outcome === 'overturned' ? 'appeal_overturned' : 'appeal_upheld',
            actorId, appealId: appeal.id, at: now(),
          };
          const reviewPatch = { history: [...review.history, reviewHistoryEntry] };
          if (outcome === 'overturned') reviewPatch.decision = 'overturned';
          await store.update(35, review.id, reviewPatch);

          return updatedAppeal;
        },
      },
    },
  };
}

module.exports = { STAGES, createPlatform, requireString, requireId, FeatureStore };
