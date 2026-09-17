'use strict';
const express = require('express');
const { requireSession } = require('../auth/session-middleware');
const { assertOwnAccount, requireRoomOwner, requireRoomMember, forbidden } = require('./platform.guards');
const { listGames } = require('../domain/game-catalog');
const { latestSettingsByKey, myReports, myTickets } = require('./platform.reads');
const { STORE_ITEMS } = require('../domain/store-catalog');
const { STICKERS } = require('../domain/chat-catalog');

// SECURITY: every /platform/api/* route requires a valid Bearer session
// token (see ../auth/session-middleware.js). The acting user's identity is
// always taken from req.session.accountId (set by requireSession after
// verifying the token against the real session store) -- never from
// req.body.userId / req.query.userId / req.params.userId. Any such field
// arriving from the client is treated as untrusted and ignored for identity
// purposes; it is only used where it legitimately denotes a *target* of an
// action (e.g. targetId to follow/block, receiverId of a gift), never the
// actor performing the action.
//
// Phase 2 -- every domain (rooms, battles, games, gifts, family, events,
// notifications, settings, moderation) now persists through
// platform.store, which is backed by a real repository (in-memory today,
// Postgres-ready -- see ../feature-platform.js and
// ../database/repositories/feature-record.repository.js). That store is
// async, so every handler below is async and awaits it; nothing here
// changes the actual authorization/business logic from the previous
// (already-verified) version of this router.
function createPlatformRouter({ platform, authStore, wallets, inventory, gifts, giftsService, giftWallService, gameMatchService, gameMatches, snakesLaddersService, quizService, ludoService, carromService, chessService, eightBallService, dominoService, battleService, referralService, storeService, inventoryAdminService, familyService, rankingService, eventService, coupleService, guardService, notificationService, chatService, settingsService, accountAdminService, auditService }) {
  const router = express.Router();
  const json = async (res, fn) => {
    try { res.json({ ok: true, data: await fn() }); }
    catch (e) { res.status(e.status || 400).json({ ok: false, error: e.message }); }
  };

  router.use(requireSession(authStore));

  router.get('/api/home', async (req, res) => {
    try {
      // Stage 12 -- rooms.listDiscoverable() (not the raw store) so a
      // private room owned by someone else, and every room's
      // passwordHash, never reach the home feed. See
      // feature-platform.js's listDiscoverable() for the exact rule.
      // Ordering/slicing is unchanged from before this stage (last 20
      // by creation order, newest first).
      const [rooms, events] = await Promise.all([
        platform.rooms.listDiscoverable({ actingAccountId: req.session.accountId }),
        platform.store.list(31),
      ]);
      // Stage 6 -- additive-only fields on top of the existing, untouched
      // rooms/events shape above: real category tallies (categoryCounts())
      // and the real unread-notification count (the same source
      // GET /api/notifications/unread-count uses) for the Home header
      // badge, so the Mobile shell does not need a second round-trip just
      // to know whether to show a dot on the bell icon.
      const [categories, unreadNotifications] = await Promise.all([
        platform.rooms.categoryCounts({ actingAccountId: req.session.accountId }),
        notificationService.getUnreadCount({ actingAccountId: req.session.accountId }),
      ]);
      res.json({ ok: true, data: { ...platform.home, rooms: rooms.slice(-20).reverse(), events: events.slice(-10).reverse(), categories, unreadNotifications } });
    } catch (e) { res.status(e.status || 400).json({ ok: false, error: e.message }); }
  });

  // Stage 6 -- Home room feed, tab-aware (live/following/popular/new),
  // combinable with the same category/language/tag/q filters GET
  // /api/rooms already supports. A NEW route, additive only: GET
  // /api/rooms and GET /api/home above are completely untouched, so
  // every existing caller/test of either keeps its exact prior behavior.
  router.get('/api/home/rooms', async (req, res) => {
    try {
      const rooms = await platform.rooms.discoverForHome({
        actingAccountId: req.session.accountId,
        tab: req.query.tab || 'new',
        category: req.query.category,
        language: req.query.language,
        tag: req.query.tag,
        query: req.query.q,
      });
      res.json({ ok: true, data: rooms });
    } catch (e) { res.status(e.status || 400).json({ ok: false, error: e.message }); }
  });

  router.get('/api/profile/:userId', (req, res) => json(res, () => platform.profile.get(req.params.userId)));
  router.post('/api/profile', (req, res) => json(res, () => platform.profile.create({ ...req.body, userId: req.session.accountId })));
  // Stage 7 -- composed real profile view (base fields + public account
  // standing + live social counts), gated by privacy/block inside
  // profile.getFull() itself. viewerId is always the session, never a
  // client-supplied field -- so a caller cannot spoof "viewing as" someone
  // else to bypass the friends-only/private gate.
  router.get('/api/profile/:userId/full', (req, res) => json(res, () => platform.profile.getFull(req.session.accountId, req.params.userId)));
  // Stage 8 -- privacy settings patch. Always applies to the caller's own
  // profile (req.session.accountId) -- there is no target id here by
  // design, a session can only ever change its own privacy.
  router.post('/api/profile/privacy', (req, res) => json(res, () => platform.profile.updatePrivacy(req.session.accountId, req.body || {})));
  // Stage 8 audit fix -- "Share" (requirement #7). See
  // platform.profile.shareLink()'s own header in feature-platform.js for
  // why this deliberately does not re-run getFull()'s privacy/block gate:
  // the link is static and reveals nothing by itself, the gate still
  // applies whenever anyone actually opens it.
  router.get('/api/profile/:userId/share', (req, res) => json(res, () => platform.profile.shareLink(req.params.userId)));

  // Stage 9 audit fix -- actingAccountId is now passed so room results
  // can apply the same owner-exception private-room rule
  // rooms.listDiscoverable() already uses (see search.query()'s header
  // in feature-platform.js). Always the session, never a client-supplied
  // field -- same identity discipline as every other route in this file.
  router.get('/api/search', (req, res) => json(res, () => platform.search.query(req.query.q || '', req.session.accountId)));

  router.post('/api/follow', (req, res) => json(res, () => platform.social.follow(req.session.accountId, req.body.targetId)));
  // Stage 8 -- real unfollow, symmetric with /api/follow above.
  router.post('/api/unfollow', (req, res) => json(res, () => platform.social.unfollow(req.session.accountId, req.body.targetId)));
  router.post('/api/friend', (req, res) => json(res, () => platform.social.friend(req.session.accountId, req.body.targetId)));
  router.post('/api/block', (req, res) => json(res, () => platform.social.block(req.session.accountId, req.body.targetId)));
  // Stage 35 Part 2/8 -- real unblock, symmetric with /api/block above
  // (same shape as /api/unfollow above /api/follow).
  router.post('/api/unblock', (req, res) => json(res, () => platform.social.unblock(req.session.accountId, req.body.targetId)));
  // Stage 10 -- real accept/reject/mute on the stage-10 record. The acting
  // user always comes from req.session.accountId (see the file-level
  // SECURITY note above); platform.social.accept/reject/mute independently
  // re-verify that this session is actually the recipient (accept/reject)
  // or a participant (mute/unmute) of the given request/relation id, so a
  // caller cannot act on someone else's friend request by guessing its id.
  router.post('/api/friends/:requestId/accept', (req, res) => json(res, () => platform.social.accept(req.session.accountId, req.params.requestId)));
  router.post('/api/friends/:requestId/reject', (req, res) => json(res, () => platform.social.reject(req.session.accountId, req.params.requestId)));
  router.post('/api/social/:relationId/mute', (req, res) => json(res, () => platform.social.mute(req.session.accountId, req.params.relationId)));
  router.post('/api/social/:relationId/unmute', (req, res) => json(res, () => platform.social.unmute(req.session.accountId, req.params.relationId)));
  // Stage 35 Part 3/8 -- Mute (a user), symmetric with /api/block and
  // /api/unblock above, and deliberately NOT the same route as
  // /api/social/:relationId/mute above -- that one is the pre-existing
  // Stage 10 per-relation mute (relationId in the path, flips a `muted`
  // flag on that relation). This is a standalone user-to-user mute
  // (targetId in the body, like block), backed by
  // platform.social.muteUser()/unmuteUser() -- see that method's header
  // in feature-platform.js for why it isn't named mute()/unmute() in that
  // file (those names were already taken by the Stage 10 pair).
  router.post('/api/mute', (req, res) => json(res, () => platform.social.muteUser(req.session.accountId, req.body.targetId)));
  router.post('/api/unmute', (req, res) => json(res, () => platform.social.unmuteUser(req.session.accountId, req.body.targetId)));
  // Stage 10 audit fix -- Lists (requirement #5). Real ids from the same
  // stage-10 store follow()/friend()/accept() maintain, gated by
  // profile.getFull()'s exact privacy/block rule (see
  // profile.listFriends/listFollowers/listFollowing's header in
  // feature-platform.js) -- the acting viewer always comes from
  // req.session.accountId, never a client-supplied field, same discipline
  // as every other route in this file.
  router.get('/api/friends/:userId', (req, res) => json(res, () => platform.profile.listFriends(req.session.accountId, req.params.userId)));
  router.get('/api/followers/:userId', (req, res) => json(res, () => platform.profile.listFollowers(req.session.accountId, req.params.userId)));
  router.get('/api/following/:userId', (req, res) => json(res, () => platform.profile.listFollowing(req.session.accountId, req.params.userId)));

  // Stage 12 -- real discovery, via rooms.listDiscoverable() instead of
  // the raw store: strips passwordHash from every room and excludes any
  // 'private' room not owned by the caller (see feature-platform.js).
  // Optional query params (?category=&language=&tag=&q=) are additive
  // filters on top of that -- omitting all of them (the pre-existing
  // client behavior) returns the same set of rooms as before, minus the
  // now-fixed visibility/password leak.
  router.get('/api/rooms', async (req, res) => {
    try {
      const rooms = await platform.rooms.listDiscoverable({
        actingAccountId: req.session.accountId,
        category: req.query.category,
        language: req.query.language,
        tag: req.query.tag,
        query: req.query.q,
      });
      res.json({ ok: true, data: rooms.slice().reverse() });
    } catch (e) { res.status(e.status || 400).json({ ok: false, error: e.message }); }
  });
  router.post('/api/rooms', (req, res) => json(res, () => platform.rooms.create({ ...req.body, ownerId: req.session.accountId })));
  // Stage 12 -- optional password in the body for a password-protected
  // room (see rooms.join()/room-password.js). A room without a
  // password ignores this field entirely, so omitting it (every
  // pre-Stage-12 client call) is completely unaffected.
  router.post('/api/rooms/:roomId/join', (req, res) => json(res, () => platform.rooms.join(req.params.roomId, req.session.accountId, req.body && req.body.password)));
  // Stage 13 -- Room Entry/Join/Leave/Reconnect. leave() is a voluntary
  // exit; disconnect()/reconnect() model an involuntary network drop and
  // its resumption, always scoped to the caller's own session
  // (req.session.accountId), never a body/param-supplied userId, same
  // identity discipline as every other self-serve route in this file.
  router.post('/api/rooms/:roomId/leave', (req, res) => json(res, () => platform.rooms.leave(req.params.roomId, req.session.accountId)));
  router.post('/api/rooms/:roomId/disconnect', (req, res) => json(res, () => platform.rooms.disconnect(req.params.roomId, req.session.accountId)));
  router.post('/api/rooms/:roomId/reconnect', (req, res) => json(res, () => platform.rooms.reconnect(req.params.roomId, req.session.accountId)));
  router.post('/api/rooms/:roomId/seats', (req, res) => json(res, () => platform.rooms.seat(req.params.roomId, req.session.accountId, req.body.seatNumber)));

  // Host/moderator-only actions: the acting session must own the room.
  // Stage 15 -- Room Settings. requireRoomOwner() here and the internal
  // ownership check inside platform.rooms.setting() are deliberately
  // redundant (same defense-in-depth already used by the seat/moderation
  // routes below): the route-level check gives a consistent early 403
  // for every host-gated route in this file, the service-level check
  // means setting()/getSettings() are still safe if ever called directly.
  router.post('/api/rooms/:roomId/settings', (req, res) => json(res, async () => {
    await requireRoomOwner(platform.store, req.params.roomId, req.session);
    return platform.rooms.setting(req.session.accountId, req.params.roomId, req.body.key, req.body.value);
  }));
  // Read side: the room owner can fetch their room's current settings
  // (the same fields the POST above edits one at a time). Not exposed to
  // non-owners -- discovery already exposes the public-safe subset of a
  // room's fields via GET /api/rooms/GET /api/home (sanitizeRoomForClient),
  // this endpoint is specifically the host-only settings view.
  router.get('/api/rooms/:roomId/settings', (req, res) => json(res, async () => {
    await requireRoomOwner(platform.store, req.params.roomId, req.session);
    return platform.rooms.getSettings(req.session.accountId, req.params.roomId);
  }));
  router.post('/api/rooms/:roomId/moderation', (req, res) => json(res, async () => {
    await requireRoomOwner(platform.store, req.params.roomId, req.session);
    return platform.rooms.moderation(req.params.roomId, req.session.accountId, req.body.targetId, req.body.action);
  }));
  // Stage 14 -- Mic/Seats approve/reject/mute. Ownership of the room the
  // seat belongs to is re-verified inside platform.rooms.*Seat() itself
  // (see _requireOwnerOfSeat), so a caller cannot approve/mute a seat in a
  // room they don't own by guessing its seatId.
  router.post('/api/rooms/seats/:seatId/approve', (req, res) => json(res, () => platform.rooms.approveSeat(req.session.accountId, req.params.seatId)));
  router.post('/api/rooms/seats/:seatId/reject', (req, res) => json(res, () => platform.rooms.rejectSeat(req.session.accountId, req.params.seatId)));
  router.post('/api/rooms/seats/:seatId/mute', (req, res) => json(res, () => platform.rooms.muteSeat(req.session.accountId, req.params.seatId)));
  router.post('/api/rooms/seats/:seatId/unmute', (req, res) => json(res, () => platform.rooms.unmuteSeat(req.session.accountId, req.params.seatId)));
  // Stage 16 -- moderation with a real effect (kick changes stage-13
  // membership, mute/unmute changes the target's stage-14 seat), on top of
  // the existing audit-only moderation() above. Room ownership is
  // re-verified inside platform.rooms.kick/muteMember/unmuteMember too.
  router.post('/api/rooms/:roomId/kick', (req, res) => json(res, () => platform.rooms.kick(req.session.accountId, req.params.roomId, req.body.targetId)));
  router.post('/api/rooms/:roomId/mute-member', (req, res) => json(res, () => platform.rooms.muteMember(req.session.accountId, req.params.roomId, req.body.targetId)));
  router.post('/api/rooms/:roomId/unmute-member', (req, res) => json(res, () => platform.rooms.unmuteMember(req.session.accountId, req.params.roomId, req.body.targetId)));
  // Stage 35 Part 5/8 -- Room Ban/Unban. actorId is always the caller's
  // own authenticated session (never trusted from req.body), same
  // pattern as kick/mute-member above; ownership is independently
  // re-verified inside platform.rooms.banMember/unbanMember too.
  router.post('/api/rooms/:roomId/ban', (req, res) => json(res, () => platform.rooms.banMember(req.session.accountId, req.params.roomId, req.body.targetId)));
  router.post('/api/rooms/:roomId/unban', (req, res) => json(res, () => platform.rooms.unbanMember(req.session.accountId, req.params.roomId, req.body.targetId)));

  // Stage 17 -- Music/DJ. actorId is always the caller's own
  // authenticated session (never trusted from req.body), same pattern as
  // kick/mute-member/ban above. Every route below re-verifies
  // ownership/DJ-status/membership inside platform.music itself (see
  // feature-platform.js's _requireDJ()/_requireMember()) -- there is no
  // route-level requireRoomOwner/requireRoomMember short-circuit here,
  // same "seat/mute-seat routes call straight through, the service layer
  // owns the check" shape already used by
  // /api/rooms/seats/:seatId/approve|reject|mute|unmute above.
  router.post('/api/rooms/:roomId/music/dj', (req, res) => json(res, () => platform.music.grantDJ(req.session.accountId, req.params.roomId, req.body.targetId)));
  router.post('/api/rooms/:roomId/music/dj/revoke', (req, res) => json(res, () => platform.music.revokeDJ(req.session.accountId, req.params.roomId, req.body.targetId)));
  router.get('/api/rooms/:roomId/music/dj', (req, res) => json(res, () => platform.music.listDJs(req.session.accountId, req.params.roomId)));
  router.post('/api/rooms/:roomId/music/queue', (req, res) => json(res, () => platform.music.queueAdd(req.session.accountId, req.params.roomId, { title: req.body?.title, url: req.body?.url, durationSec: req.body?.durationSec })));
  router.get('/api/rooms/:roomId/music/queue', (req, res) => json(res, () => platform.music.queueList(req.session.accountId, req.params.roomId)));
  router.post('/api/rooms/:roomId/music/queue/:trackId/remove', (req, res) => json(res, () => platform.music.queueRemove(req.session.accountId, req.params.roomId, req.params.trackId)));
  router.post('/api/rooms/:roomId/music/queue/reorder', (req, res) => json(res, () => platform.music.queueReorder(req.session.accountId, req.params.roomId, req.body?.trackId, req.body?.position)));
  router.post('/api/rooms/:roomId/music/play', (req, res) => json(res, () => platform.music.play(req.session.accountId, req.params.roomId, req.body?.trackId)));
  router.post('/api/rooms/:roomId/music/pause', (req, res) => json(res, () => platform.music.pause(req.session.accountId, req.params.roomId)));
  router.post('/api/rooms/:roomId/music/next', (req, res) => json(res, () => platform.music.next(req.session.accountId, req.params.roomId)));
  router.post('/api/rooms/:roomId/music/volume', (req, res) => json(res, () => platform.music.setVolume(req.session.accountId, req.params.roomId, req.body?.volume)));
  router.get('/api/rooms/:roomId/music/state', (req, res) => json(res, () => platform.music.getState(req.session.accountId, req.params.roomId)));

  // Stage 18 -- PK/Battles, now a real domain (see
  // ../services/battle.service.js). hostId is always req.session.accountId,
  // never trusted from the client. Only the room's real owner may start a
  // challenge from it -- requireRoomOwner reads that from platform.store,
  // same guard used by room settings/moderation/gift-wall-close.
  router.post('/api/battles', (req, res) => json(res, async () => {
    await requireRoomOwner(platform.store, req.body?.roomId, req.session);
    return battleService.createChallenge({
      roomId: req.body?.roomId,
      hostId: req.session.accountId,
      opponentId: req.body?.opponentId,
      durationMs: req.body?.durationMs,
    });
  }));
  // "My battles": any battle where the caller is host or opponent, most
  // recent first. Fully served by battleService now (real repository
  // query, not a filter over the generic store) -- it also lazily
  // auto-ends any battle whose round timer has already expired.
  router.get('/api/battles', (req, res) => json(res, () => battleService.listMine(req.session.accountId)));
  // Single battle detail -- 403s for anyone who is neither side (see
  // getBattle's own authorization), and lazily auto-ends an expired
  // battle the same way the list endpoint does.
  router.get('/api/battles/:battleId', (req, res) => json(res, () => battleService.getBattle(req.session.accountId, req.params.battleId)));
  // Only the challenged opponent may accept/decline -- enforced inside
  // battleService itself, not just here, same "re-verified at the
  // service layer" pattern as rooms.approveSeat/rejectSeat.
  router.post('/api/battles/:battleId/accept', (req, res) => json(res, () => battleService.acceptChallenge(req.session.accountId, req.params.battleId)));
  router.post('/api/battles/:battleId/decline', (req, res) => json(res, () => battleService.declineChallenge(req.session.accountId, req.params.battleId)));
  // Only the host may withdraw their own still-pending challenge.
  router.post('/api/battles/:battleId/cancel', (req, res) => json(res, () => battleService.cancelChallenge(req.session.accountId, req.params.battleId)));
  // Either participant may end an active battle early; the winner is
  // still computed honestly from real gift-sourced score (see
  // battle.service.js#endBattle/recordGiftPoints), never reset or guessed.
  router.post('/api/battles/:battleId/end', (req, res) => json(res, () => battleService.endBattle(req.session.accountId, req.params.battleId)));

  // Stage 19 -- Room Game Center catalog: the fixed, server-owned registry
  // of games the Game Center framework knows how to host a lobby for (see
  // ../domain/game-catalog.js). Read-only, no session-scoping needed --
  // same "fixed enum, not account data" shape as GET on any other catalog.
  // Registered BEFORE GET /api/games/:matchId below so 'catalog' is never
  // captured as a matchId.
  router.get('/api/games/catalog', (req, res) => json(res, () => listGames()));

  // Phase 5 -- games moved off the generic feature_records store onto the
  // dedicated game_matches table/repository (see
  // ../database/repositories/game-match.repository.js and
  // ../services/game-match.service.js). startedBy and playerIds are never
  // trusted from the client for identity purposes: startedBy is always the
  // verified session, and the acting session is always folded into
  // playerIds so it is always a participant of its own match.
  //
  // Stage 19 -- gameId is now validated against the real catalog and the
  // caller must be a real member of the room (owner or Stage 13
  // joined/disconnected membership) before a lobby can even be created --
  // see game-match.service.js#createMatch/_requireMember. Neither check
  // existed before this stage.
  router.post('/api/games', (req, res) => json(res, () => {
    const startedBy = req.session.accountId;
    const otherPlayerIds = Array.isArray(req.body?.playerIds) ? req.body.playerIds.filter((p) => p !== startedBy) : [];
    return gameMatchService.createMatch({
      roomId: req.body?.roomId,
      gameId: req.body?.gameId,
      version: req.body?.version,
      startedBy,
      playerIds: [startedBy, ...otherPlayerIds],
    });
  }));
  // "My games" (scoped by startedBy, unchanged since before Stage 19) when
  // called with no query, OR -- Stage 19 -- a room's own Game Center lobby
  // view (any match in that room, any state, regardless of who started
  // it) when called as `?roomId=...`. This is what lets a room member
  // discover and join a lobby someone else started, which "my games" by
  // itself never could. Membership in the room is required for the
  // roomId-scoped form -- see game-match.service.js#listByRoom.
  router.get('/api/games', (req, res) => json(res, () => {
    if (req.query && req.query.roomId) {
      return gameMatchService.listByRoom(req.session.accountId, req.query.roomId);
    }
    return gameMatches.listByStartedBy(req.session.accountId);
  }));
  // Stage 19 -- single match detail, visible only to its own players
  // (see game-match.service.js#getMatch).
  router.get('/api/games/:matchId', (req, res) => json(res, () => gameMatchService.getMatch(req.session.accountId, req.params.matchId)));
  // Stage 19 -- join a still-open lobby someone else started. Room
  // membership and lobby-fullness/state are all re-verified inside
  // gameMatchService.joinMatch() itself, never trusted from anywhere else.
  router.post('/api/games/:matchId/join', (req, res) => json(res, () => gameMatchService.joinMatch(req.session.accountId, req.params.matchId)));
  // Stage 19 -- a non-host player leaves a still-open lobby; the host
  // leaving is treated as cancelling the whole lobby (see
  // game-match.service.js#leaveMatch).
  router.post('/api/games/:matchId/leave', (req, res) => json(res, () => gameMatchService.leaveMatch(req.session.accountId, req.params.matchId)));
  // Stage 19 -- only the host may withdraw their own still-open lobby.
  router.post('/api/games/:matchId/cancel', (req, res) => json(res, () => gameMatchService.cancelMatch(req.session.accountId, req.params.matchId)));
  // Stage 19 -- only the host may start their own lobby, and only once
  // the catalog's real minimum player count for that game is met. This is
  // a framework lifecycle transition (lobby -> active), never a game
  // result -- see game-match.service.js#startMatch.
  router.post('/api/games/:matchId/start', (req, res) => json(res, () => gameMatchService.startMatch(req.session.accountId, req.params.matchId)));

  // Stage 21 -- Snakes & Ladders. The die is rolled server-side inside
  // snakesLaddersService.rollDice() (node:crypto, never client input) and
  // a win is only ever recorded when a roll server-side actually lands a
  // player on square 100 -- see services/snakes-ladders.service.js. These
  // two routes are the entire client-facing surface for the game; there
  // is no way for a client to set its own position, its own die, or its
  // own turn.
  router.get('/api/games/:matchId/board', (req, res) => json(res, () => snakesLaddersService.getState(req.session.accountId, req.params.matchId)));
  router.post('/api/games/:matchId/roll', (req, res) => json(res, () => snakesLaddersService.rollDice(req.session.accountId, req.params.matchId)));

  // Stage 21 -- Quiz. The question bank, the correct answers, and the
  // per-question clock are all server-only (see domain/quiz-bank.js and
  // services/quiz.service.js) -- a client only ever receives the current
  // question's text/choices (never correctIndex) and only ever learns a
  // question's correct answer once that question has already closed.
  router.get('/api/games/:matchId/quiz', (req, res) => json(res, () => quizService.getState(req.session.accountId, req.params.matchId)));
  router.post('/api/games/:matchId/quiz/answer', (req, res) => json(res, () => quizService.submitAnswer(req.session.accountId, req.params.matchId, req.body?.choiceIndex)));

  // Stage 20 -- Ludo. Two-phase turn (roll then move), matching how Ludo
  // is actually played: the die is rolled server-side (node:crypto,
  // never client input) into that match's pendingDie, and a win is only
  // ever recorded once a player's 4th token, server-side, actually
  // reaches home -- see services/ludo.service.js. A client only ever
  // supplies which of its own tokens to move; the server independently
  // recomputes whether that move is legal (base/board/home-column/
  // overshoot) and resolves capturing itself.
  router.get('/api/games/:matchId/ludo', (req, res) => json(res, () => ludoService.getState(req.session.accountId, req.params.matchId)));
  router.post('/api/games/:matchId/ludo/roll', (req, res) => json(res, () => ludoService.rollDice(req.session.accountId, req.params.matchId)));
  router.post('/api/games/:matchId/ludo/move', (req, res) => json(res, () => ludoService.moveToken(req.session.accountId, req.params.matchId, req.body?.pieceIndex)));

  // Stage 20 -- Carrom. Each strike is a single atomic server action:
  // the outcome is rolled server-side (node:crypto) and resolved through
  // the fixed, documented bands in ../domain/carrom-board.js -- a client
  // only ever calls strike(); it can never supply which piece was
  // pocketed, whether it was a foul, or any score delta. A win is only
  // ever recorded once every regular piece is actually gone server-side
  // (queen resolved) -- see services/carrom.service.js.
  router.get('/api/games/:matchId/carrom', (req, res) => json(res, () => carromService.getState(req.session.accountId, req.params.matchId)));
  router.post('/api/games/:matchId/carrom/strike', (req, res) => json(res, () => carromService.strike(req.session.accountId, req.params.matchId)));

  // Stage 22 -- Chess. Every move is re-validated server-side from
  // scratch against ../domain/chess.board.js's own legal-move generator
  // (full piece rules, check/pin filtering, castling, en passant,
  // promotion) before being applied -- a client only ever supplies
  // {from, to, promotion}; it can never supply "this move is legal".
  // Checkmate/stalemate/insufficient-material are detected server-side
  // after every move; resign/draw-offer/draw-response and a real
  // per-player clock are separate real actions -- see
  // services/chess.service.js.
  router.get('/api/games/:matchId/chess', (req, res) => json(res, () => chessService.getState(req.session.accountId, req.params.matchId)));
  router.post('/api/games/:matchId/chess/move', (req, res) => json(res, () => chessService.move(req.session.accountId, req.params.matchId, { from: req.body?.from, to: req.body?.to, promotion: req.body?.promotion })));
  router.post('/api/games/:matchId/chess/resign', (req, res) => json(res, () => chessService.resign(req.session.accountId, req.params.matchId)));
  router.post('/api/games/:matchId/chess/draw-offer', (req, res) => json(res, () => chessService.offerDraw(req.session.accountId, req.params.matchId)));
  router.post('/api/games/:matchId/chess/draw-respond', (req, res) => json(res, () => chessService.respondDraw(req.session.accountId, req.params.matchId, !!req.body?.accept)));

  // Stage 22 -- Eight Ball. Each strike is a single atomic server
  // action, resolved server-side (node:crypto) against the fixed bands
  // in ../domain/eight-ball.board.js -- a client only ever calls
  // strike(); it can never supply which ball was potted, its own group,
  // or a foul. Groups are assigned server-side on the first legal pot
  // (never preassigned); the 8-ball is only ever a win when the actor's
  // own group is actually, server-side, already cleared -- see
  // services/eight-ball.service.js.
  router.get('/api/games/:matchId/eight-ball', (req, res) => json(res, () => eightBallService.getState(req.session.accountId, req.params.matchId)));
  router.post('/api/games/:matchId/eight-ball/strike', (req, res) => json(res, () => eightBallService.strike(req.session.accountId, req.params.matchId)));

  // Stage 22 -- Domino. The full 28-tile set is shuffled and dealt
  // server-side (node:crypto); a client's own hand is only ever visible
  // to that client (other players' hands are sizes only). Every play is
  // re-validated against the real chain ends
  // (../domain/domino.board.js#legalEnds/attach) before being applied --
  // a client only ever supplies {tileIndex, end}. draw()/pass() are only
  // ever legal when the actor server-side genuinely has no legal move --
  // see services/domino.service.js.
  router.get('/api/games/:matchId/domino', (req, res) => json(res, () => dominoService.getState(req.session.accountId, req.params.matchId)));
  router.post('/api/games/:matchId/domino/play', (req, res) => json(res, () => dominoService.playTile(req.session.accountId, req.params.matchId, { tileIndex: req.body?.tileIndex, end: req.body?.end })));
  router.post('/api/games/:matchId/domino/draw', (req, res) => json(res, () => dominoService.draw(req.session.accountId, req.params.matchId)));
  router.post('/api/games/:matchId/domino/pass', (req, res) => json(res, () => dominoService.pass(req.session.accountId, req.params.matchId)));

  // Phase 5 -- a match's result can only be correct if a real per-game
  // rules engine actually played it out server-side. Any game NOT in
  // ENGINE_BACKED_GAMES below has no such engine yet, so this route
  // stays explicitly blocked for it rather than trusting a
  // client-declared winner (a fake result) -- same honesty pattern POST
  // /api/inventory/grant below now enforces via a real admin allowlist
  // check instead of a blanket block.
  //
  // Stage 21 added snakes_ladders and quiz as exceptions; Stage 20 added
  // ludo and carrom; Stage 22 adds chess, eight_ball and domino the same
  // way: their engines are real (above), and finishMatch() is ALREADY
  // called, only by those engines, only once a real server-side
  // win/completion happened (see snakes-ladders.service.js#rollDice,
  // quiz.service.js#_finalizeCurrentAndAdvance, ludo.service.js
  // #moveToken, carrom.service.js#strike/#_finish,
  // chess.service.js#move/#resign/#respondDraw/#_tick,
  // eight-ball.service.js#strike, and domino.service.js
  // #playTile/#pass). This route is therefore never a "submit a result"
  // endpoint for any of these seven games -- it never reads a
  // winner/result from req.body at all -- it is only ever a
  // read-confirmation of a result the engine already produced. If the
  // engine has not actually finished the match yet, this still 409s
  // rather than inventing or trusting anything from the client.
  const ENGINE_BACKED_GAMES = new Set(['snakes_ladders', 'quiz', 'ludo', 'carrom', 'chess', 'eight_ball', 'domino']);
  router.post('/api/games/:matchId/finish', (req, res) => json(res, async () => {
    const match = await gameMatchService.getMatch(req.session.accountId, req.params.matchId);
    if (!ENGINE_BACKED_GAMES.has(match.gameId)) {
      throw Object.assign(new Error('submitting a game result is not available yet; it requires a real server-side game rules engine (not implemented), never a client-declared winner'), { status: 403 });
    }
    if (match.state !== 'finished' || match.resultSource !== 'server') {
      throw Object.assign(new Error('this match has not been finished by the server-side game engine yet -- play it out via /board+/roll or /quiz+/quiz/answer'), { status: 409 });
    }
    return match;
  }));

  // Wallet is read-only from this router (no ledger-write endpoint is
  // exposed to mobile at all) and a session may only ever read its OWN
  // wallet -- never another account's.
  router.get('/api/wallet/:userId', async (req, res) => {
    try {
      const userId = assertOwnAccount(req.session, req.params.userId);
      const ledger = await platform.store.list(24, (x) => x.userId === userId);
      res.json({ ok: true, data: ledger.slice().reverse() });
    } catch (e) { res.status(e.status || 400).json({ ok: false, error: e.message }); }
  });

  // Phase 2 -- real balance (wallet_balances / InMemoryWalletRepository),
  // as opposed to the event ledger above. Read-only here too, and locked
  // to the caller's own account for the same reason: no write endpoint for
  // wallet balances exists on this (session-based, mobile-facing) router.
  // Credit/debit only happen via ../routes/wallet.internal-routes.js, which
  // requires a separate service key and is never reachable with a mobile
  // session token.
  router.get('/api/wallet/:userId/balance', async (req, res) => {
    try {
      const userId = assertOwnAccount(req.session, req.params.userId);
      const balance = await wallets.getBalance(userId);
      res.json({ ok: true, data: balance });
    } catch (e) { res.status(e.status || 400).json({ ok: false, error: e.message }); }
  });

  // Phase 5 -- gifts now move a real wallet balance (see
  // ../services/gifts.service.js): the sender's coins are actually
  // debited, at a price looked up server-side from the gift catalog
  // (../domain/gift-catalog.js), before any gift record is created. A
  // debit that fails (insufficient balance) means no gift record is
  // created either -- there is no partial/fake success.
  router.post('/api/gifts/send', (req, res) => json(res, () => giftsService.sendGift({
    roomId: req.body?.roomId,
    senderId: req.session.accountId,
    receiverId: req.body?.receiverId,
    giftId: req.body?.giftId,
    quantity: Number.isInteger(req.body?.quantity) ? req.body.quantity : 1,
  })));

  // Stage 23 -- Referral. myCode is idempotent (same code returned on
  // repeat calls); redeem goes through referralService because it must
  // touch the real wallet (see services/referral.service.js), never
  // through platform.referral directly from a route.
  router.get('/api/referral/my-code', (req, res) => json(res, () => platform.referral.myCode(req.session.accountId)));
  router.post('/api/referral/redeem', (req, res) => json(res, () => referralService.redeem(req.session.accountId, req.body?.code)));

  // Stage 23 -- Part 2: Room-in-Room breakout. Fixed decision this
  // session implements: only the room host/owner may create/start a
  // breakout -- requireRoomOwner() here mirrors the exact same
  // route-level gate already used for Room Settings above, and
  // platform.roomInRoom.create() independently re-checks the same thing
  // at the service layer (same defense-in-depth as everywhere else in
  // this file). Viewing a room's breakout(s) is member-only
  // (requireRoomMember, same guard the Game Center routes use below);
  // join/leave/end re-verify parent-room membership / host identity
  // inside platform.roomInRoom itself, so a caller cannot join/end a
  // breakout in a room they don't belong to by guessing its breakoutId.
  router.post('/api/rooms/:roomId/breakout', (req, res) => json(res, async () => {
    await requireRoomOwner(platform.store, req.params.roomId, req.session);
    return platform.roomInRoom.create(req.session.accountId, req.params.roomId, { name: req.body?.name, capacity: req.body?.capacity });
  }));
  router.get('/api/rooms/:roomId/breakout', (req, res) => json(res, async () => {
    await requireRoomMember(platform.store, req.params.roomId, req.session);
    return platform.roomInRoom.listForRoom(req.session.accountId, req.params.roomId);
  }));
  router.post('/api/rooms/breakout/:breakoutId/join', (req, res) => json(res, () => platform.roomInRoom.join(req.session.accountId, req.params.breakoutId)));
  router.post('/api/rooms/breakout/:breakoutId/leave', (req, res) => json(res, () => platform.roomInRoom.leave(req.session.accountId, req.params.breakoutId)));
  router.post('/api/rooms/breakout/:breakoutId/end', (req, res) => json(res, () => platform.roomInRoom.end(req.session.accountId, req.params.breakoutId)));

  // Stage 26 -- Gift Wall: room-scoped, visible to any authenticated
  // session, same visibility level as GET /api/rooms itself (no
  // per-account restriction -- a real gift wall is public within the
  // room, not private to sender/receiver). This is the real, server-side
  // aggregated leaderboard for the room's CURRENT Host Room Session (see
  // ../services/gift-wall.service.js) -- ranked totals per gifter and the
  // top 3, never the raw per-send log (that remains available, unranked,
  // via ../database/repositories/gift.repository.js's listByRoom for
  // anything that still needs the full history).
  router.get('/api/gifts/wall/:roomId', (req, res) => json(res, () => giftWallService.getWall(req.params.roomId)));

  // Stage 26 -- ends the room's current Gift Wall session (Host Room
  // Session boundary). Host-only, same guard used for every other
  // host-gated room action (settings/mute/kick) -- requireRoomOwner reads
  // the REAL room owner from platform.store, never trusting a client
  // claim of being the host. The next gift sent to this room starts a
  // brand-new session with a clean wall; this session's totals are never
  // reused.
  router.post('/api/gifts/wall/:roomId/close', (req, res) => json(res, async () => {
    await requireRoomOwner(platform.store, req.params.roomId, req.session);
    return giftWallService.closeSession(req.params.roomId);
  }));

  // Phase 5 -- a session may read its OWN inventory (real, DB-backed --
  // see ../database/repositories/inventory.repository.js). Granting items
  // is still NOT allowed just because a session is authenticated -- that
  // would let any client grant itself free items. A grant only ever
  // reaches inventory.grant() through one of three trusted, non-client-
  // declared paths: Stage 29's /api/store/purchase below (real wallet
  // debit, server-priced, before any grant -- see
  // ../services/store.service.js), a verified recharge completion, or --
  // completing this stage -- this route, now real: it requires the
  // caller's OWN session (req.session.accountId, never a client-supplied
  // field) to be in the real, server-only INVENTORY_ADMIN_IDS allowlist
  // (../config/admin-staff.js, same allowlist pattern Stage 35 Part 6's
  // MODERATION_REVIEWER_IDS already uses for content-review reviewers --
  // see ../services/inventory-admin.service.js for the full reasoning).
  // A normal, non-admin session -- including a caller trying to grant
  // itself items via accountId: req.session.accountId in the body -- is
  // rejected with 403 by inventoryAdminService.grant() itself, before any
  // grant is attempted; accountId in the body is only ever a *target*,
  // exactly like every other target-vs-actor field in this file (see the
  // header comment), never trusted as proof of authorization.
  router.get('/api/inventory/:userId', async (req, res) => {
    try {
      const userId = assertOwnAccount(req.session, req.params.userId);
      const items = await inventory.listByAccount(userId);
      res.json({ ok: true, data: items });
    } catch (e) { res.status(e.status || 400).json({ ok: false, error: e.message }); }
  });
  router.post('/api/inventory/grant', (req, res) => json(res, () => inventoryAdminService.grant({
    actorId: req.session.accountId,
    accountId: req.body?.accountId,
    itemId: req.body?.itemId,
    quantity: Number.isInteger(req.body?.quantity) ? req.body.quantity : req.body?.quantity,
  })));

  // Stage 36 -- Admin: account suspend/unsuspend/list, gated by
  // ../security/staff.js's central Staff/RBAC (account:suspend/
  // account:unsuspend/users:view), not a single-purpose allowlist. Every
  // action is recorded to the central Audit Log as its last step (see
  // ../services/account-admin.service.js). `actorId` is always
  // req.session.accountId, same rule as every other admin route above --
  // never a client-supplied field, and `accountId` in the body/params is
  // only ever a target, never proof of authorization.
  router.post('/api/admin/accounts/:accountId/suspend', (req, res) => json(res, () => accountAdminService.suspend({
    actorId: req.session.accountId,
    accountId: req.params.accountId,
    reason: req.body?.reason,
  })));
  router.post('/api/admin/accounts/:accountId/unsuspend', (req, res) => json(res, () => accountAdminService.unsuspend({
    actorId: req.session.accountId,
    accountId: req.params.accountId,
  })));
  router.get('/api/admin/accounts/suspended', (req, res) => json(res, () => accountAdminService.listSuspended({
    actorId: req.session.accountId,
  })));

  // Stage 36 -- Admin: read-only audit log browse, gated on the
  // audit:view permission (see ../services/audit.service.js#list). Query
  // params are optional filters -- untrusted client input, but only ever
  // used to narrow a read, never to bypass the AUDIT_VIEW check above it.
  router.get('/api/admin/audit-log', (req, res) => json(res, () => auditService.list({
    actorId: req.session.accountId,
    action: req.query?.action,
    targetType: req.query?.targetType,
    targetId: req.query?.targetId,
    limit: req.query?.limit,
  })));

  // Stage 29 -- Store. Catalog is public (any authenticated session, same
  // visibility level as gift catalog values baked into the mobile client);
  // purchase always goes through storeService, which debits the real
  // wallet at the real server-side price BEFORE granting the item (see
  // ../services/store.service.js) -- a failed debit (insufficient
  // balance) means no inventory row is created either, same as gifts.
  router.get('/api/store/items', (req, res) => {
    res.json({ ok: true, data: Object.values(STORE_ITEMS) });
  });
  router.post('/api/store/purchase', (req, res) => json(res, () => storeService.purchase({
    accountId: req.session.accountId,
    itemId: req.body?.itemId,
    quantity: Number.isInteger(req.body?.quantity) ? req.body.quantity : 1,
  })));

  // Stage 30 -- Family. Moved off the generic feature_records store onto
  // its own dedicated repository/service, same Phase 5 pattern as Store
  // above -- ALL membership/rank/donate rules live in
  // ../services/family.service.js, never in this router (see that file's
  // header comment for the full rule list). The acting account is always
  // req.session.accountId; any accountId-shaped field in the body/params
  // (inviteeId, targetAccountId) is only ever a *target*, never trusted
  // as the actor.
  router.post('/api/families', (req, res) => json(res, () => familyService.createFamily({
    ownerId: req.session.accountId,
    name: req.body?.name,
  })));
  // Directory: public to any authenticated session, same visibility level
  // as GET /api/rooms / GET /api/events -- browse-only, not "my families".
  router.get('/api/families', (req, res) => json(res, () => familyService.listFamilies()));

  // Registered BEFORE the /:familyId/* routes below so the literal
  // "invites" segment is never captured as a :familyId param value.
  router.get('/api/families/invites/mine', (req, res) => json(res, () => familyService.listMyInvites(req.session.accountId)));
  router.post('/api/families/invites/:inviteId/accept', (req, res) => json(res, () => familyService.acceptInvite({
    actingAccountId: req.session.accountId,
    inviteId: req.params.inviteId,
  })));
  router.post('/api/families/invites/:inviteId/decline', (req, res) => json(res, () => familyService.declineInvite({
    actingAccountId: req.session.accountId,
    inviteId: req.params.inviteId,
  })));
  router.post('/api/families/invites/:inviteId/revoke', (req, res) => json(res, () => familyService.revokeInvite({
    actingAccountId: req.session.accountId,
    inviteId: req.params.inviteId,
  })));

  router.get('/api/families/:familyId/members', (req, res) => json(res, () => familyService.listMembers({
    actingAccountId: req.session.accountId,
    familyId: req.params.familyId,
  })));
  router.post('/api/families/:familyId/invite', (req, res) => json(res, () => familyService.inviteMember({
    actingAccountId: req.session.accountId,
    familyId: req.params.familyId,
    inviteeId: req.body?.inviteeId,
  })));
  router.post('/api/families/:familyId/leave', (req, res) => json(res, () => familyService.leaveFamily({
    actingAccountId: req.session.accountId,
    familyId: req.params.familyId,
  })));
  router.post('/api/families/:familyId/donate', (req, res) => json(res, () => familyService.donate({
    actingAccountId: req.session.accountId,
    familyId: req.params.familyId,
    tierId: req.body?.tierId,
  })));
  router.post('/api/families/:familyId/transfer-ownership', (req, res) => json(res, () => familyService.transferOwnership({
    actingAccountId: req.session.accountId,
    familyId: req.params.familyId,
    targetAccountId: req.body?.targetAccountId,
  })));
  router.post('/api/families/:familyId/members/:targetAccountId/kick', (req, res) => json(res, () => familyService.kickMember({
    actingAccountId: req.session.accountId,
    familyId: req.params.familyId,
    targetAccountId: req.params.targetAccountId,
  })));
  router.post('/api/families/:familyId/members/:targetAccountId/ban', (req, res) => json(res, () => familyService.banMember({
    actingAccountId: req.session.accountId,
    familyId: req.params.familyId,
    targetAccountId: req.params.targetAccountId,
  })));
  router.post('/api/families/:familyId/members/:targetAccountId/unban', (req, res) => json(res, () => familyService.unbanMember({
    actingAccountId: req.session.accountId,
    familyId: req.params.familyId,
    targetAccountId: req.params.targetAccountId,
  })));
  router.post('/api/families/:familyId/members/:targetAccountId/promote', (req, res) => json(res, () => familyService.promoteMember({
    actingAccountId: req.session.accountId,
    familyId: req.params.familyId,
    targetAccountId: req.params.targetAccountId,
  })));
  router.post('/api/families/:familyId/members/:targetAccountId/demote', (req, res) => json(res, () => familyService.demoteMember({
    actingAccountId: req.session.accountId,
    familyId: req.params.familyId,
    targetAccountId: req.params.targetAccountId,
  })));

  // Stage 31 -- Rankings. Read-only; real data (gifts/family), see
  // ../services/ranking.service.js. type: 'wealth' | 'charm' | 'family'.
  // period ('daily'|'weekly'|'monthly'|'all') is ignored for 'family',
  // which has no per-period activity log -- see that service's header.
  router.get('/api/rankings/:type', (req, res) => json(res, () => rankingService.getRanking({
    type: req.params.type,
    period: req.query.period,
    limit: req.query.limit ? Number(req.query.limit) : undefined,
  })));
  router.get('/api/rankings/:type/me', (req, res) => json(res, () => rankingService.getMyRank({
    type: req.params.type,
    period: req.query.period,
    accountId: req.session.accountId,
  })));

  // Stage 31 -- Events. Catalog-driven (../domain/events-catalog.js);
  // real per-account progress/share/claim state, see
  // ../services/event.service.js. Registered BEFORE
  // /api/events/:eventId/* below so the literal "history" segment is
  // never captured as an :eventId param value.
  router.get('/api/events', (req, res) => json(res, () => eventService.listEvents()));
  router.get('/api/events/history', (req, res) => json(res, () => eventService.getHistory({
    accountId: req.session.accountId,
  })));
  router.get('/api/events/:eventId', (req, res) => json(res, () => eventService.getEvent(req.params.eventId)));
  router.get('/api/events/:eventId/progress', (req, res) => json(res, () => eventService.getMyProgress({
    eventId: req.params.eventId,
    accountId: req.session.accountId,
  })));
  router.post('/api/events/:eventId/share', (req, res) => json(res, () => eventService.recordShare({
    eventId: req.params.eventId,
    accountId: req.session.accountId,
  })));
  router.post('/api/events/:eventId/missions/:missionKey/claim', (req, res) => json(res, () => eventService.claimReward({
    eventId: req.params.eventId,
    missionKey: req.params.missionKey,
    accountId: req.session.accountId,
  })));

  // Stage 32 -- Couple/CP. Own dedicated repository/service, same Phase 5
  // pattern as Family/Events above -- ALL invite/pairing/unpair rules
  // live in ../services/couple.service.js, never in this router (see
  // that file's header comment). The acting account is always
  // req.session.accountId; any accountId-shaped field in the body/params
  // (inviteeId, targetAccountId) is only ever a *target*, never trusted
  // as the actor. Registered BEFORE /:coupleId/* below so the literal
  // "invites"/"status" segments are never captured as a :coupleId value.
  router.post('/api/couple/invites', (req, res) => json(res, () => coupleService.sendInvite({
    actingAccountId: req.session.accountId,
    inviteeId: req.body?.inviteeId,
  })));
  router.get('/api/couple/invites/mine', (req, res) => json(res, () => coupleService.listMyInvites(req.session.accountId)));
  router.post('/api/couple/invites/:inviteId/accept', (req, res) => json(res, () => coupleService.acceptInvite({
    actingAccountId: req.session.accountId,
    inviteId: req.params.inviteId,
  })));
  router.post('/api/couple/invites/:inviteId/decline', (req, res) => json(res, () => coupleService.declineInvite({
    actingAccountId: req.session.accountId,
    inviteId: req.params.inviteId,
  })));
  router.post('/api/couple/invites/:inviteId/cancel', (req, res) => json(res, () => coupleService.cancelInvite({
    actingAccountId: req.session.accountId,
    inviteId: req.params.inviteId,
  })));
  router.get('/api/couple/status', (req, res) => json(res, () => coupleService.getStatus(req.session.accountId)));
  router.post('/api/couple/:coupleId/unpair', (req, res) => json(res, () => coupleService.unpair({
    actingAccountId: req.session.accountId,
    coupleId: req.params.coupleId,
  })));

  // Stage 32 -- Guard/Fan Club. Own dedicated repository/service, same
  // Phase 5 pattern as Couple/Family above -- ALL pricing/authorization
  // rules live in ../services/guard.service.js, never in this router (see
  // that file's header comment). The acting account is always
  // req.session.accountId (the fan spending real coins); hostId in the
  // body/params is only ever a *target*, never trusted as the actor.
  // tierKey is always resolved server-side from ../domain/guard-catalog.js
  // -- price/duration are NEVER accepted as numbers from the client.
  router.post('/api/guard/purchase', (req, res) => json(res, () => guardService.purchaseGuard({
    actingAccountId: req.session.accountId,
    hostId: req.body?.hostId,
    tierKey: req.body?.tierKey,
  })));
  router.get('/api/guard/status/:hostId', (req, res) => json(res, () => guardService.getGuardStatus({
    actingAccountId: req.session.accountId,
    hostId: req.params.hostId,
  })));
  router.get('/api/guard/fan-club/:hostId', (req, res) => json(res, () => guardService.listFanClub({
    hostId: req.params.hostId,
  })));

  // Stage 11 -- Private Chat. Own dedicated repository/service, same
  // Phase 5 pattern as Guard above -- ALL authorization/privacy rules
  // (self-chat rejected, block check both directions, whoCanMessage/
  // showLastSeen enforcement, sender-only delete, self-report rejected,
  // real presence-derived delivered/sent) live in
  // ../services/chat.service.js, never in this router. The acting
  // account is always req.session.accountId; otherUserId/hostId-shaped
  // fields in the body/params are only ever a *target*, never trusted as
  // the actor -- same identity discipline as every other route above.
  //
  // Registration order matters: /api/chat/stickers and
  // /api/chat/conversations (the literal list route) are registered
  // BEFORE /api/chat/conversations/:id/... below, same discipline
  // already applied in this file to /api/guard/fan-club before a
  // hypothetical /api/guard/:id and to /api/notifications/unread-count
  // before /api/notifications/:userId further down.
  router.get('/api/chat/stickers', (req, res) => { res.json({ ok: true, data: Object.values(STICKERS) }); });
  router.get('/api/chat/conversations', (req, res) => json(res, () => chatService.listConversations({
    actingAccountId: req.session.accountId,
  })));
  router.post('/api/chat/conversations', (req, res) => json(res, () => chatService.getOrCreateConversation(
    req.session.accountId,
    req.body?.otherUserId,
  )));
  router.get('/api/chat/conversations/:id/messages', (req, res) => json(res, () => chatService.listMessages({
    actingAccountId: req.session.accountId,
    conversationId: req.params.id,
    limit: req.query.limit ? Number(req.query.limit) : undefined,
  })));
  router.post('/api/chat/conversations/:id/messages', (req, res) => json(res, () => chatService.sendMessage({
    actingAccountId: req.session.accountId,
    conversationId: req.params.id,
    type: req.body?.type,
    body: req.body?.body,
    stickerId: req.body?.stickerId,
    imageUrl: req.body?.imageUrl,
    replyToMessageId: req.body?.replyToMessageId,
  })));
  router.post('/api/chat/conversations/:id/read', (req, res) => json(res, () => chatService.markConversationRead({
    actingAccountId: req.session.accountId,
    conversationId: req.params.id,
  })));
  router.post('/api/chat/messages/:id/delete', (req, res) => json(res, () => chatService.deleteMessage({
    actingAccountId: req.session.accountId,
    messageId: req.params.id,
  })));
  router.post('/api/chat/messages/:id/report', (req, res) => json(res, () => chatService.reportMessage({
    actingAccountId: req.session.accountId,
    messageId: req.params.id,
    reason: req.body?.reason,
  })));
  router.post('/api/presence/heartbeat', (req, res) => json(res, () => chatService.heartbeat({
    actingAccountId: req.session.accountId,
  })));
  router.post('/api/presence/offline', (req, res) => json(res, () => chatService.goOffline({
    actingAccountId: req.session.accountId,
  })));
  router.get('/api/presence/:userId', (req, res) => json(res, () => chatService.getPresence({
    actingAccountId: req.session.accountId,
    targetUserId: req.params.userId,
  })));

  // Stage 33 -- Notifications + Push. All real logic (ownership,
  // security-category-can-never-be-muted, catalog-resolved type/deepLink,
  // best-effort push) lives in ../services/notification.service.js, never
  // here -- see that file's header. The acting account is ALWAYS
  // req.session.accountId, exactly like every other route in this file;
  // notificationId in the params is only ever a *target*, and
  // notificationService itself independently re-verifies ownership of it
  // (403/404) before allowing markRead/redeliverPendingPush to touch it,
  // so a caller cannot act on someone else's notification by guessing its
  // id even if this router had a bug.
  //
  // Registration order matters: the literal segments below
  // (unread-count, preferences, read-all, devices) MUST be registered
  // BEFORE the generic GET /api/notifications/:userId further down, or
  // :userId would capture them -- same discipline already applied in this
  // file to /api/couple/invites before /api/couple/:coupleId and to
  // /api/events/history before /api/events/:eventId.
  router.get('/api/notifications/unread-count', (req, res) => json(res, () => notificationService.getUnreadCount({
    actingAccountId: req.session.accountId,
  })));
  router.get('/api/notifications/preferences', (req, res) => json(res, () => notificationService.getPreferences({
    actingAccountId: req.session.accountId,
  })));
  router.post('/api/notifications/preferences', (req, res) => json(res, () => notificationService.updatePreferences({
    actingAccountId: req.session.accountId,
    mutedCategories: req.body?.mutedCategories,
  })));
  router.post('/api/notifications/read-all', (req, res) => json(res, () => notificationService.markAllRead({
    actingAccountId: req.session.accountId,
  })));
  router.post('/api/notifications/devices', (req, res) => json(res, () => notificationService.registerDevice({
    actingAccountId: req.session.accountId,
    token: req.body?.token,
    platform: req.body?.platform,
  })));
  router.post('/api/notifications/devices/remove', (req, res) => json(res, () => notificationService.removeDevice({
    actingAccountId: req.session.accountId,
    token: req.body?.token,
  })));
  // notificationId-scoped actions -- distinct segment count from
  // :userId above, so no ordering hazard against it, but still registered
  // alongside the other literal-first routes for readability.
  router.post('/api/notifications/:notificationId/read', (req, res) => json(res, () => notificationService.markRead({
    actingAccountId: req.session.accountId,
    notificationId: req.params.notificationId,
  })));
  router.post('/api/notifications/:notificationId/redeliver', (req, res) => json(res, () => notificationService.redeliverPendingPush({
    actingAccountId: req.session.accountId,
    notificationId: req.params.notificationId,
  })));
  // Notifications are per-user; a session may only read its own queue.
  // Migrated from the old always-empty platform.store.list(33, ...) (no
  // real writer ever fed it) to the real notificationService.list() --
  // same response shape (array of records with type/status/createdAt)
  // consumed by Mobile/app/app.js's notificationRow(). No extra
  // .slice().reverse() here: notification.repository.js's
  // listForAccount() already returns newest-first.
  router.get('/api/notifications/:userId', async (req, res) => {
    try {
      const userId = assertOwnAccount(req.session, req.params.userId);
      const notifications = await notificationService.list({ actingAccountId: userId });
      res.json({ ok: true, data: notifications });
    } catch (e) { res.status(e.status || 400).json({ ok: false, error: e.message }); }
  });

  // Stage 34 -- General Settings, now backed by a real dedicated service
  // (see ../services/settings.service.js) instead of the old append-only
  // stage-34 store slot. set() validates key+value and upserts in place;
  // get() always returns exactly the five known keys with their current
  // effective value (falling back to a real default for a key never set)
  // -- see settings.service.js's header for why the response shape is an
  // object of known keys rather than the old raw-record array (nothing in
  // this codebase depended on the old shape -- confirmed by grep before
  // this change; see STAGE_34_FINAL_REPORT.md).
  router.post('/api/settings', (req, res) => json(res, () => settingsService.set(req.session.accountId, req.session.accountId, req.body?.key, req.body?.value)));
  // Self-scoped via the same assertOwnAccount pattern as wallet/notifications
  // (kept here, not inside the service, so every route in this file that
  // takes a :userId path param stays consistent about where that check
  // lives -- the service itself also independently rejects a mismatched
  // userId, same defense-in-depth as requireRoomOwner/platform.rooms.setting()).
  router.get('/api/settings/:userId', async (req, res) => {
    try {
      const userId = assertOwnAccount(req.session, req.params.userId);
      const data = await settingsService.get(req.session.accountId, userId);
      res.json({ ok: true, data });
    } catch (e) { res.status(e.status || 400).json({ ok: false, error: e.message }); }
  });
  // Stage 34 -- Delete Account. No target id: a session may only ever
  // delete its own account, same "no target id at all" shape as
  // /auth/logout. SAFE soft delete + force logout of every active
  // session -- see settings.service.js's deleteAccount().
  router.post('/api/settings/account/delete', (req, res) => json(res, () => settingsService.deleteAccount(req.session.accountId)));
  // Stage 34 -- Terms/Help: real, deterministic, static content (see
  // ../domain/legal-content.js). No CMS, no per-user data, so no
  // ownership check beyond the router-wide requireSession above.
  router.get('/api/settings/terms', (req, res) => json(res, () => settingsService.getTerms()));
  router.get('/api/settings/help', (req, res) => json(res, () => settingsService.getHelp()));

  router.post('/api/moderation/report', (req, res) => json(res, () => platform.moderation.report({ ...req.body, reporterId: req.session.accountId })));
  // Phase 4 -- "my reports": reports and tickets share stage 35 with no
  // discriminator field, so myReports()/myTickets() (./platform.reads.js)
  // tell them apart structurally (targetId vs messages). Self-scoped: a
  // session can only read reports/tickets it filed.
  router.get('/api/moderation/reports', async (req, res) => {
    try {
      const all = await platform.store.list(35);
      res.json({ ok: true, data: myReports(all, req.session.accountId).slice().reverse() });
    } catch (e) { res.status(e.status || 400).json({ ok: false, error: e.message }); }
  });

  // Stage 35 Part 6/8 -- Content Review. Reviewer-only (see
  // ../feature-platform.js's moderation.review._requireReviewer(), which
  // checks the real, server-only, env-configured allowlist from
  // ../config/moderation-staff.js -- never a client-supplied
  // reviewerId/role field). actorId is always req.session.accountId,
  // same discipline as every other route in this file.
  router.get('/api/moderation/review', (req, res) => json(res, () => platform.moderation.review.list(req.session.accountId, { status: req.query.status })));
  router.get('/api/moderation/review/:id', (req, res) => json(res, () => platform.moderation.review.get(req.session.accountId, req.params.id)));
  router.post('/api/moderation/review/:id/assign', (req, res) => json(res, () => platform.moderation.review.assign(req.session.accountId, req.params.id)));
  router.post('/api/moderation/review/:id/decision', (req, res) => json(res, () => platform.moderation.review.decision(req.session.accountId, req.params.id, {
    outcome: req.body?.outcome,
    notes: req.body?.notes,
    evidence: req.body?.evidence,
  })));

  // Stage 35 Part 7/8 -- Appeals (user submission side). appellantId is
  // always req.session.accountId -- never req.body -- so a caller can
  // never submit, or read, an appeal as anyone but themselves. Staff
  // adjudication routes (second half) are below, after listMine.
  router.post('/api/moderation/appeals', (req, res) => json(res, () => platform.moderation.appeals.create(req.session.accountId, {
    reviewId: req.body?.reviewId,
    reason: req.body?.reason,
  })));
  router.get('/api/moderation/appeals', (req, res) => json(res, () => platform.moderation.appeals.listMine(req.session.accountId)));

  // Stage 35 Part 7/8 -- Appeals, SECOND HALF (staff adjudication).
  // Reviewer-only, same authorization discipline as
  // /api/moderation/review/* above (actorId always
  // req.session.accountId, checked server-side against the real
  // allowlist -- never a client-supplied reviewerId/role field). The
  // '/queue' routes are registered BEFORE the '/:id' user-scoped route
  // below so 'queue' is never swallowed as a claimed appeal id by that
  // route's own matcher.
  router.get('/api/moderation/appeals/queue', (req, res) => json(res, () => platform.moderation.appeals.queue(req.session.accountId, { status: req.query.status })));
  router.get('/api/moderation/appeals/queue/:id', (req, res) => json(res, () => platform.moderation.appeals.getForReview(req.session.accountId, req.params.id)));
  router.post('/api/moderation/appeals/:id/assign', (req, res) => json(res, () => platform.moderation.appeals.assign(req.session.accountId, req.params.id)));
  router.post('/api/moderation/appeals/:id/decision', (req, res) => json(res, () => platform.moderation.appeals.decision(req.session.accountId, req.params.id, {
    outcome: req.body?.outcome,
    notes: req.body?.notes,
    evidence: req.body?.evidence,
  })));

  router.get('/api/moderation/appeals/:id', (req, res) => json(res, () => platform.moderation.appeals.getMine(req.session.accountId, req.params.id)));

  router.post('/api/support/tickets', (req, res) => json(res, () => platform.moderation.ticket({ ...req.body, reporterId: req.session.accountId })));
  router.get('/api/support/tickets', async (req, res) => {
    try {
      const all = await platform.store.list(35);
      res.json({ ok: true, data: myTickets(all, req.session.accountId).slice().reverse() });
    } catch (e) { res.status(e.status || 400).json({ ok: false, error: e.message }); }
  });

  // Stage 35 Part 8/8 -- Customer Support (rest of the ticket lifecycle,
  // plus FAQ). Same discipline as every other route in this file:
  // actorId/reporterId/staffId are always req.session.accountId, never
  // req.body -- staff authorization itself is enforced server-side inside
  // platform.moderation.support (../feature-platform.js) against the real
  // allowlist, never a client-supplied role field. FAQ needs only the
  // router-wide requireSession above (real static content, no per-user
  // ownership check -- same as GET /api/settings/terms|help).
  router.get('/api/support/faq', (req, res) => json(res, () => settingsService.getFaq()));

  // '/queue' routes registered BEFORE '/:id' so 'queue' is never
  // swallowed as a claimed ticket id by that route's own matcher (same
  // ordering discipline as the appeals queue routes above).
  router.get('/api/support/queue', (req, res) => json(res, () => platform.moderation.support.queue(req.session.accountId, { status: req.query.status })));
  router.get('/api/support/queue/:id', (req, res) => json(res, () => platform.moderation.support.getForStaff(req.session.accountId, req.params.id)));

  router.get('/api/support/tickets/:id', (req, res) => json(res, () => platform.moderation.support.getMine(req.session.accountId, req.params.id)));
  router.post('/api/support/tickets/:id/attachments', (req, res) => json(res, () => platform.moderation.support.attach(req.session.accountId, req.params.id, req.body?.url)));
  router.post('/api/support/tickets/:id/reply', (req, res) => json(res, () => platform.moderation.support.reply(req.session.accountId, req.params.id, req.body?.body)));
  router.post('/api/support/tickets/:id/status', (req, res) => json(res, () => platform.moderation.support.setStatus(req.session.accountId, req.params.id, req.body?.status)));
  router.post('/api/support/tickets/:id/escalate', (req, res) => json(res, () => platform.moderation.support.escalate(req.session.accountId, req.params.id)));

  router.get('/api/state', async (req, res) => {
    try {
      const entries = await Promise.all(
        Object.entries(platform.stages).map(async ([n, name]) => [name, (await platform.store.list(Number(n))).length])
      );
      res.json({ ok: true, data: Object.fromEntries(entries) });
    } catch (e) { res.status(e.status || 400).json({ ok: false, error: e.message }); }
  });

  return router;
}

module.exports = { createPlatformRouter };
