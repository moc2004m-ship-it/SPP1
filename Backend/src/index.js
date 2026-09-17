const express = require('express');
const pinoHttp = require('pino-http');
const logger = require('./logger');
const { buildErrorResponseBody } = require('./error-response');
// Stage 3 — Database Design / Basic Account Model (see ../../Database/).
const { createAccountsRouter } = require('./routes/accounts.routes');
// Stage 4 — Config API (see ../../Config/).
const configRouter = require('./routes/config.routes');
const { AuthStore } = require('./auth/auth.store');
const { createAuthRouter } = require('./routes/auth.routes');
// Stage 5 audit (this session) — real gap: these two loaders did not
// exist, so createAuthRouter() below was being called with NO
// socialConfig/smsConfig at all, meaning social login (especially Apple,
// which requires config.apple.audience) and SMS delivery could never be
// turned on in a real deployment no matter what env vars were set. See
// ./auth/social-config.js and ./auth/sms-config.js for the full env var
// list.
const { loadSocialConfigFromEnv } = require('./auth/social-config');
const { loadSmsConfigFromEnv } = require('./auth/sms-config');
const { getDatabase } = require('./database');
const { STAGES, createPlatform, FeatureStore } = require('./feature-platform');
const { createPlatformRouter } = require('./routes/platform.routes');
const { createAdminRouter } = require('./routes/admin.routes');
const { createWalletInternalRouter } = require('./routes/wallet.internal-routes');
// Agora RTC voice — token endpoint only. See ./rtc/agora-config.js for the
// required env vars and ./routes/agora.routes.js for the security notes.
const { loadAgoraConfigFromEnv } = require('./rtc/agora-config');
const { loadAgoraTokenBuilder } = require('./rtc/agora-sdk-loader');
const { createAgoraTokenService } = require('./rtc/agora-token.service');
const { createAgoraRouter } = require('./routes/agora.routes');
// Phase 5 -- central systems: Recharge (real provider-verified) and Gifts
// (real wallet debit) services, plus the Game Matches repository (see
// PHASE5_CENTRAL_SYSTEMS_REPORT.md).
const { createRechargeService } = require('./services/recharge.service');
const { loadRechargeProviderConfigFromEnv } = require('./services/recharge-provider-verifier');
const { createGiftsService } = require('./services/gifts.service');
// Stage 29 completion (this session) -- the real trusted server-side/admin
// path for POST /api/inventory/grant. See ./config/admin-staff.js and
// ./services/inventory-admin.service.js for the full reasoning.
const { loadAdminIdsFromEnv } = require('./config/admin-staff');
const { createInventoryAdminService } = require('./services/inventory-admin.service');
// Stage 36 -- central Staff/Roles/Permissions. Loaded once here and
// handed to both createPlatform() (content-review authorization) and
// createInventoryAdminService() (inventory-grant authorization), same
// single-source-of-truth pattern reviewerIds/adminIds already use.
const { loadStaffFromEnv } = require('./security/staff');
// Stage 26 -- Gift Wall (per Host Room Session leaderboard, real
// server-side aggregation over already-committed gift sends). See
// ./services/gift-wall.service.js.
const { createGiftWallService } = require('./services/gift-wall.service');
const { createGameMatchService } = require('./services/game-match.service');
const { createSnakesLaddersService } = require('./services/snakes-ladders.service');
const { createQuizService } = require('./services/quiz.service');
const { createLudoService } = require('./services/ludo.service');
const { createCarromService } = require('./services/carrom.service');
// Stage 22 -- Chess / Eight Ball / Domino rules engines.
const { createChessService } = require('./services/chess.service');
const { createEightBallService } = require('./services/eight-ball.service');
const { createDominoService } = require('./services/domino.service');
// Stage 18 -- PK/Battles (real challenge/accept/decline state machine +
// real score sourced from already-committed gift coins, never a fake/
// client-declared winner). See ./services/battle.service.js.
const { createBattleService } = require('./services/battle.service');
// Stage 29 -- Store (real wallet debit + real inventory grant, same
// pattern as Gifts above).
const { createStoreService } = require('./services/store.service');
// Stage 23 -- Referral (real code redemption + real wallet credit, same
// pattern as Gifts above).
const { createReferralService } = require('./services/referral.service');
// Stage 30 -- Family (real membership/rank enforcement + real wallet
// debit on donate, own dedicated repository -- see ./services/family.service.js).
const { createFamilyService } = require('./services/family.service');
// Stage 31 -- Rankings (read-only, real data from gifts/family) + Events
// (real catalog-driven missions/rewards/countdown/share/history). See
// ./services/ranking.service.js and ./services/event.service.js.
const { createRankingService } = require('./services/ranking.service');
const { createEventService } = require('./services/event.service');
// Stage 32 -- Couple/CP (real invite/accept/unpair, real cp from
// already-debited gifts between partners). See ./services/couple.service.js.
const { createCoupleService } = require('./services/couple.service');
// Stage 32 -- Guard/Fan Club (real wallet-debited purchase + renewal,
// own dedicated repository -- see ./services/guard.service.js).
const { createGuardService } = require('./services/guard.service');
// Stage 33 -- Notifications + Push. createNotificationBus() is a plain
// in-process EventEmitter (see ./realtime/notification-bus.js).
// createPushProvider() is the ONLY code path that ever talks to Firebase
// -- if FIREBASE_* env vars are unset or firebase-admin is not installed,
// every send throws a real 503; there is NO fake "delivered" fallback
// (see ./push/push.service.js's header). notificationService is handed
// to the other services below as an OPTIONAL dependency, same additive
// pattern as eventService/coupleService above -- omitting it (impossible
// here, since it is always constructed, but true of every one of its
// eight call sites) leaves existing behavior unchanged.
const { createNotificationBus } = require('./realtime/notification-bus');
const { createNotificationService } = require('./services/notification.service');
// Stage 11 -- Private Chat. createChatBus() is a plain in-process
// EventEmitter (see ./realtime/chat-bus.js), same structural pattern as
// notificationBus above. chatService is handed notificationService as an
// OPTIONAL dependency (same additive pattern used throughout this file)
// so a real PRIVATE_MESSAGE notification is reported after a real send.
const { createChatBus } = require('./realtime/chat-bus');
const { createChatService } = require('./services/chat.service');
// Stage 17 -- Music/DJ. createMusicBus() is a plain in-process
// EventEmitter (see ./realtime/music-bus.js), same structural pattern as
// chatBus/notificationBus above. Unlike chatService, the `music` domain
// lives directly on `platform` (feature-platform.js), the same "small,
// room-scoped, store-backed domain" shape as `rooms`/`roomInRoom` --
// so `musicBus` is handed straight to createPlatform() below as an
// OPTIONAL constructor dependency, not to a separate service file.
const { createMusicBus } = require('./realtime/music-bus');
// Stage 34 -- General Settings (real language/sound/mic/network/media
// preferences + Delete Account + Terms/Help). See ./services/settings.service.js.
const { createSettingsService } = require('./services/settings.service');
const { loadPushConfigFromEnv } = require('./push/push-config');
const { loadFirebaseAdmin } = require('./push/firebase-sdk-loader');
const { createPushProvider } = require('./push/push.service');
const { createRechargeRouter } = require('./routes/recharge.routes');
const { securityHeaders } = require('./security/headers');

const app = express();
const PORT = process.env.PORT || 3000;
const ENV = process.env.NODE_ENV || 'development';

// Every request is logged in structured JSON — this is what feeds
// the centralized log pipeline (see logging/README.md).
app.use(pinoHttp({ logger }));
app.use(securityHeaders());
app.use(express.json());

const db = getDatabase();
// Stage 5 completion (this session) -- pass db.auth (in-memory today,
// real PostgresAuthRepository when STAGE3_ENABLE_POSTGRES=true, exactly
// like every other db.* repository above) instead of relying on
// AuthStore's constructor default. This is the real activation of
// Authentication/STAGE5_TODO.md item 5: consent/session/OTP data now
// persists in the real database, same as accounts/wallets/etc., once
// Postgres is turned on -- no separate, never-wired-in in-memory store
// silently used behind everything else being durable.
const authStore = new AuthStore(db.accounts, db.auth);

// Stage 3 routes. Mounted additively — Stage 1's /health and / routes
// below are unchanged.
app.use(createAccountsRouter({ authStore }));
// Stage 4 route. Mounted additively — nothing above/below this line changed.
app.use(configRouter);
// Stage 5 audit (this session) — real gap fixed: socialConfig/smsConfig
// were never read from the environment and never passed here, so Apple
// login was permanently fail-closed (config.apple.audience never set)
// and SMS delivery could never be turned on in production no matter
// what env vars an operator configured. See ./auth/social-config.js and
// ./auth/sms-config.js for the full env var list; both fail closed with
// exactly the same behavior as before when unset, so this is additive.
const socialConfig = loadSocialConfigFromEnv(process.env);
const smsConfig = loadSmsConfigFromEnv(process.env);
app.use(createAuthRouter({ authStore, accountRepository: db.accounts, socialConfig, smsConfig }));
// Stage 33 -- constructed BEFORE createPlatform()/giftsService/etc. below,
// same "build the optional dependency first" ordering as eventService/
// coupleService above, since createPlatform() (Friend/Follow, Room/Mic)
// and several services below all take notificationService as an OPTIONAL
// constructor dependency.
const notificationBus = createNotificationBus();
const pushConfig = loadPushConfigFromEnv(process.env);
const pushProvider = createPushProvider({ ...pushConfig, sdk: loadFirebaseAdmin() });
const notificationService = createNotificationService({
  notifications: db.notifications,
  pushProvider,
  bus: notificationBus,
});
// Stage 9 audit fix -- `families: db.families` added so search.query()'s
// Family Search reads the real family repository (the same one
// familyService below is built on) instead of the disconnected generic
// stage-30 store it was reading before. See feature-platform.js's
// search.query() header for the full audit note.
// Stage 7 completion (this session) -- `couples: db.couples, gifts: db.gifts`
// added so profile.getFull() can compose in real Couple status and real
// Gifts-received totals (see feature-platform.js's Stage 7 completion
// comments), same "hand the platform the real repository other services
// already use" pattern as `families: db.families` just above. Both
// repositories already exist on `db` at this point (constructed in
// ./database/index.js) and are the exact same instances coupleService/
// giftsService below are built on -- no second/duplicate repository.
// Stage 17 -- constructed BEFORE createPlatform() below, same "build the
// optional dependency first" ordering as notificationBus above, since
// createPlatform()'s `music` domain takes musicBus as an optional
// constructor dependency.
const musicBus = createMusicBus();
// Stage 36 -- loaded once, shared by createPlatform() below and by
// inventoryAdminService further down, so a staff member's roles are
// consistent across every admin surface in a single process.
const staffRoles = loadStaffFromEnv();
const { createAuditService } = require('./services/audit.service');
const auditService = createAuditService({ auditLog: db.auditLog, staffRoles, logger });
const platform = createPlatform({ store: new FeatureStore(db.featureRecords), accounts: db.accounts, notificationService, families: db.families, couples: db.couples, gifts: db.gifts, musicBus, staffRoles, auditService });
// Stage 11 -- Private Chat. Built AFTER `platform` above (chatService
// needs the real platform.social.allowed()/platform.store privacy read --
// see ./services/chat.service.js's header), same ordering reason
// referralService further below is built after `platform` too.
const chatBus = createChatBus();
const chatService = createChatService({ chat: db.chat, platform, notificationService, bus: chatBus });
// Phase 5 -- Recharge/Gifts/Games central systems, wired against the same
// db.* repositories everything else uses (in-memory today, Postgres-ready
// -- see ./database/index.js). See PHASE5_CENTRAL_SYSTEMS_REPORT.md.
const rechargeProviderConfig = loadRechargeProviderConfigFromEnv(process.env);
const rechargeService = createRechargeService({ recharges: db.recharges, wallets: db.wallets, providerConfig: rechargeProviderConfig, accounts: db.accounts, notificationService });
const rankingService = createRankingService({ gifts: db.gifts, families: db.families });
// Created BEFORE giftsService below -- Stage 31's gift_sent/gift_received
// mission wiring needs a real eventService instance to hand to
// createGiftsService (see gifts.service.js's Stage 31 comment).
const eventService = createEventService({ eventProgress: db.eventProgress, wallets: db.wallets, notificationService });
// Stage 32 -- created BEFORE giftsService below, same reason as
// eventService above: gifts.service.js's optional coupleService.recordGift
// integration needs a real instance to hand to createGiftsService.
const coupleService = createCoupleService({ couples: db.couples, notificationService });
// Stage 32 -- Guard/Fan Club has no integration into other services
// (unlike coupleService/eventService above, which gifts.service.js
// optionally calls into) -- it only ever reads/writes db.guards and
// db.wallets directly, so it can be built independently, in any order
// relative to giftsService.
const guardService = createGuardService({ guards: db.guards, wallets: db.wallets, notificationService });
// Stage 26 -- created BEFORE giftsService below, same reason as
// eventService/coupleService above: gifts.service.js's optional
// giftWallService.recordContribution integration needs a real instance to
// hand to createGiftsService.
const giftWallService = createGiftWallService({ giftWall: db.giftWall });
// Stage 18 -- created BEFORE giftsService below, same reason as
// eventService/coupleService/giftWallService above: gifts.service.js's
// optional battleService.recordGiftPoints integration needs a real
// instance to hand to createGiftsService.
const battleService = createBattleService({ battles: db.battles });
const giftsService = createGiftsService({ wallets: db.wallets, gifts: db.gifts, accounts: db.accounts, eventService, coupleService, notificationService, giftWallService, battleService });
// Stage 19 -- Room Game Center authorization. isRoomMember() is the same
// real Stage 12 room-ownership + Stage 13 join/leave membership ledger
// requireRoomOwner()/requireRoomMember() already read from platform.store
// (see ./routes/platform.guards.js) -- wired in here so
// game-match.service.js can enforce it itself (creating/joining/listing a
// room's lobby all funnel through the same check), not just at the route
// layer.
const { isRoomMember: checkIsRoomMember } = require('./routes/platform.guards');
const gameMatchService = createGameMatchService({
  gameMatches: db.gameMatches,
  isRoomMember: (roomId, accountId) => checkIsRoomMember(platform.store, roomId, accountId),
});
// Stage 21 -- Snakes & Ladders / Quiz rules engines. Both are built on
// top of the real gameMatchService above (never a second, parallel
// authorization path) -- see services/snakes-ladders.service.js and
// services/quiz.service.js for why each is the only caller of
// gameMatchService.finishMatch() for its own game.
const snakesLaddersService = createSnakesLaddersService({ gameMatchService });
const quizService = createQuizService({ gameMatchService });
// Stage 20 -- Ludo / Carrom rules engines. Same posture as Stage 21's
// two engines above: built on the real gameMatchService, each the only
// caller of finishMatch() for its own game -- see
// services/ludo.service.js and services/carrom.service.js.
const ludoService = createLudoService({ gameMatchService });
const carromService = createCarromService({ gameMatchService });
// Stage 22 -- Chess / Eight Ball / Domino rules engines. Same posture as
// every prior stage's engines: built on the real gameMatchService, each
// the only caller of finishMatch() for its own game -- see
// services/chess.service.js, services/eight-ball.service.js and
// services/domino.service.js.
const chessService = createChessService({ gameMatchService });
const eightBallService = createEightBallService({ gameMatchService });
const dominoService = createDominoService({ gameMatchService });
const referralService = createReferralService({ platform, wallets: db.wallets });
const storeService = createStoreService({ wallets: db.wallets, inventory: db.inventory });
// Stage 29 completion (this session) -- adminIds comes ONLY from env
// (INVENTORY_ADMIN_IDS), same as reviewerIds above; not set in this
// sandbox (no admin staff exist here), so the grant route below correctly
// 403s for every caller until a real deployment configures it.
const inventoryAdminService = createInventoryAdminService({ inventory: db.inventory, adminIds: loadAdminIdsFromEnv(), staffRoles, auditService });
const familyService = createFamilyService({ families: db.families, wallets: db.wallets, notificationService });
// Stage 34 -- General Settings. Needs `authStore` (already constructed
// above, for Delete Account's revokeAllSessions()) and `db.accounts`
// (for Delete Account's softDelete()) in addition to its own dedicated
// db.settings repository.
const settingsService = createSettingsService({ settings: db.settings, accounts: db.accounts, authStore });
// Stage 36 -- admin services use the central audit service constructed above.
const { createAdminPanelService } = require('./services/admin-panel.service');
const { createAnalyticsService } = require('./services/analytics.service');
const { createAntiFraudService } = require('./services/anti-fraud.service');
const { createAccountAdminService } = require('./services/account-admin.service');
const analyticsService = createAnalyticsService({ accounts: db.accounts, recharges: db.recharges, auth: db.auth, platform, gameMatches: db.gameMatches });
const antiFraudService = createAntiFraudService({ recharges: db.recharges, accounts: db.accounts });
const accountAdminService = createAccountAdminService({ accounts: db.accounts, staffRoles, auditService });
app.use(
  '/platform',
  createPlatformRouter({
    platform,
    authStore,
    wallets: db.wallets,
    inventory: db.inventory,
    gifts: db.gifts,
    giftsService,
    giftWallService,
    gameMatchService,
    gameMatches: db.gameMatches,
    snakesLaddersService,
    quizService,
    ludoService,
    carromService,
    chessService,
    eightBallService,
    dominoService,
    battleService,
    referralService,
    storeService,
    inventoryAdminService,
    familyService,
    rankingService,
    eventService,
    coupleService,
    guardService,
    notificationService,
    chatService,
    settingsService,
    accountAdminService,
    auditService,
  })
);
const adminPanelService = createAdminPanelService({ accounts: db.accounts, wallets: db.wallets, recharges: db.recharges, gifts: db.gifts, gameMatches: db.gameMatches, platform, auditService, staffRoles, analyticsService, antiFraudService });
app.use('/platform', createAdminRouter({ authStore, adminPanelService }));
app.use('/platform', createRechargeRouter({ rechargeService, recharges: db.recharges, authStore }));
// Agora RTC token endpoint. Credentials come ONLY from env vars, never
// from source. If AGORA_APP_ID/AGORA_APP_CERTIFICATE are unset, or the
// agora-token package is not installed, the endpoint reports 503 rather
// than issuing a fake/placeholder token.
const agoraConfig = loadAgoraConfigFromEnv(process.env);
const agoraTokenService = createAgoraTokenService({ ...agoraConfig, sdk: loadAgoraTokenBuilder() });
app.use('/platform', createAgoraRouter({ platform, authStore, tokenService: agoraTokenService }));
// Phase 2 -- internal-only, service-key-guarded. Not under /platform on
// purpose, so it is never confused with (or accidentally covered by) the
// session-based requireSession() applied there.
app.use('/internal/wallet', createWalletInternalRouter({ wallets: db.wallets, serviceKey: process.env.WALLET_INTERNAL_KEY }));
app.use('/app', express.static(require('node:path').join(__dirname, '../../Mobile/app')));

app.get('/platform/stages', (req, res) => {
  res.json({ stages: STAGES, implementation: 'domain-foundation-only', externalProviders: 'not connected' });
});

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    env: ENV,
    service: 'backend',
    timestamp: new Date().toISOString(),
  });
});

app.get('/', (req, res) => {
  res.json({ message: `Backend instance running in ${ENV}` });
});

// Stage 1 — Basic Logs / Error Handling.
// Any error passed to next(err) or thrown in a route handler lands here.
// Logged with full context via pino, but the response body never leaks a
// stack trace to the client (stack is included only in development).
// Status/message selection is pure logic in ./error-response.js so it can
// be unit tested without express (see test/error-response.test.js).
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  logger.error(
    { err, path: req.path, method: req.method },
    'Unhandled request error'
  );
  if (res.headersSent) {
    return next(err);
  }
  const { status, body } = buildErrorResponseBody(err, ENV);
  res.status(status).json(body);
});

// Stage 1 — Basic Logs.
// Process-level safety net: log fatal errors that never reach Express
// (e.g. thrown outside a request, or an unhandled promise rejection) so
// they are never silently swallowed. Exits after logging an
// uncaughtException, since the process is in an unknown state at that
// point; unhandledRejection is logged but not fatal on its own.
process.on('uncaughtException', (err) => {
  logger.fatal({ err }, 'Uncaught exception — shutting down');
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  logger.error({ err: reason }, 'Unhandled promise rejection');
});

if (require.main === module) {
  app.listen(PORT, () => {
    logger.info(`Backend instance listening on port ${PORT} [${ENV}]`);
  });
}

module.exports = { app, authStore, platform };
