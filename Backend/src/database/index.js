// Stage 3 — Database entry point / factory.
//
// This is the ONE place that decides which storage implementation the
// rest of the backend talks to. Routes, scripts, and tests all go through
// `getDatabase()` — none of them import a repository class directly.
//
// Current state (Stage 3): no external database is connected. Everything
// runs against the in-memory repositories, on purpose:
//   - "لا تربط Database خارجية الآن" — no external DB connection yet.
//   - "لا تدّعي وجود Database production حقيقية إذا لم تكن موجودة" — this
//     factory reports which backend is active (`backend: 'memory'`) so
//     nothing pretends to be a real, persistent production database.
//
// To connect a real Postgres database in a LATER stage:
//   1. `npm install` (adds `pg`, already declared in package.json).
//   2. Run the SQL files in src/database/schema/ against that database
//      (see src/database/migrations/migrate.js).
//   3. Set DATABASE_URL and STAGE3_ENABLE_POSTGRES=true.
// No model, route, or script needs to change for that swap.

const { InMemoryAccountRepository, PostgresAccountRepository } = require('./repositories/account.repository');
const {
  InMemoryReferenceRepository,
  PostgresReferenceRepository,
} = require('./repositories/reference.repository');
// Phase 2 — first Stage 6-35 domain moved onto this same real-DB pattern.
const { InMemoryWalletRepository, PostgresWalletRepository } = require('./repositories/wallet.repository');
// Phase 2 — every other Stage 6-35 domain (Rooms, Battles, Games, Gifts,
// Family, Events, Notifications, Settings, Moderation/Support, Profile,
// Social, Chat) shares this one generic repository — see
// feature-record.repository.js and schema/004_create_feature_records.sql.
const {
  InMemoryFeatureRecordRepository,
  PostgresFeatureRecordRepository,
} = require('./repositories/feature-record.repository');
// Phase 5 — central systems: Inventory, Recharge, Gifts, Game Matches each
// moved onto their own dedicated relational table/repository, same pattern
// as Wallet in Phase 2, replacing their previous generic feature_records
// representation. See PHASE5_CENTRAL_SYSTEMS_REPORT.md.
const { InMemoryInventoryRepository, PostgresInventoryRepository } = require('./repositories/inventory.repository');
// Stage 18 — Battles moved off the generic feature_records stage-18 slot
// onto its own dedicated table, same Phase 5 pattern as the domains above.
// See schema/024_create_battles.sql and repositories/battle.repository.js.
const { InMemoryBattleRepository, PostgresBattleRepository } = require('./repositories/battle.repository');
const { InMemoryRechargeRepository, PostgresRechargeRepository } = require('./repositories/recharge.repository');
const { InMemoryGiftRepository, PostgresGiftRepository } = require('./repositories/gift.repository');
// Stage 26 -- Gift Wall sessions/contributions, own dedicated tables
// (gift_wall_sessions, gift_wall_contributions, gift_wall_applied_gifts),
// same Phase 5 pattern as Gifts above. Kept separate from gift.repository.js
// on purpose: gifts_log is the permanent, real-money gift ledger; this is
// the resettable-per-session leaderboard built on top of it.
const { InMemoryGiftWallRepository, PostgresGiftWallRepository } = require('./repositories/gift-wall.repository');
const {
  InMemoryGameMatchRepository,
  PostgresGameMatchRepository,
} = require('./repositories/game-match.repository');
// Stage 30 -- Family moves onto its own dedicated tables (families,
// family_memberships, family_invites), same Phase 5 pattern as
// Inventory/Recharge/Gifts/Game Matches above, replacing the earlier
// generic feature_records (stage 30) representation.
const { InMemoryFamilyRepository, PostgresFamilyRepository } = require('./repositories/family.repository');
// Stage 31 -- Events moves onto its own dedicated tables
// (event_mission_progress, event_shares), same Phase 5 pattern as Family
// above. Events/missions themselves are a code catalog (see
// ../domain/events-catalog.js), not a repository.
const { InMemoryEventRepository, PostgresEventRepository } = require('./repositories/event.repository');
// Stage 32 -- Couple/CP moves onto its own dedicated tables (couples,
// couple_invites), same Phase 5 pattern as Family above.
const { InMemoryCoupleRepository, PostgresCoupleRepository } = require('./repositories/couple.repository');
// Stage 32 -- Guard/Fan Club, same Phase 5 pattern as Couple/Family above:
// one dedicated table (guards), (fanId, hostId) upserted in place.
const { InMemoryGuardRepository, PostgresGuardRepository } = require('./repositories/guard.repository');
// Stage 33 -- Notifications + Push, same Phase 5 pattern as Guard above:
// three dedicated tables (notifications, notification_preferences,
// push_tokens) behind one repository -- see
// ../services/notification.service.js and schema/021_create_notifications.sql.
const {
  InMemoryNotificationRepository,
  PostgresNotificationRepository,
} = require('./repositories/notification.repository');
// Stage 11 -- Private Chat, same Phase 5 pattern as Guard/Notifications
// above: own dedicated tables (chat_conversations, chat_messages,
// chat_presence) behind one repository -- see
// ../services/chat.service.js and schema/023_create_private_chat.sql.
const { InMemoryChatRepository, PostgresChatRepository } = require('./repositories/chat.repository');
// Stage 34 -- General Settings, same Phase 5 pattern as Guard/
// Notifications/Chat above: one dedicated table (settings), (user_id,
// key) upserted in place -- see ../services/settings.service.js and
// schema/025_create_settings.sql. Replaces the old generic
// feature_records (stage 34) representation.
const { InMemorySettingsRepository, PostgresSettingsRepository } = require('./repositories/settings.repository');
// Stage 5 completion (this session) -- Auth (identities/OTP/sessions/
// consents) joins the same real-DB pattern as every domain above.
// Previously `auth.store.js` always constructed its own private
// InMemoryAuthRepository (never `db.auth`), so OTP/session/consent data
// was NEVER persisted even when STAGE3_ENABLE_POSTGRES=true and every
// other domain was already durable -- a restart lost every session and
// consent record while the rest of the database survived. See
// ./repositories/auth.repository.js (both implementations already
// existed and were reviewed; they just were not wired in here) and
// Authentication/STAGE5_TODO.md item 5, which this closes.
const { InMemoryAuthRepository, PostgresAuthRepository } = require('./repositories/auth.repository');
// Stage 36 — Central Audit Log, same Phase 5 pattern as every domain
// above: one dedicated table (audit_log), append-only -- see
// ./repositories/audit-log.repository.js and
// ./schema/029_create_audit_log.sql.
const { InMemoryAuditLogRepository, PostgresAuditLogRepository } = require('./repositories/audit-log.repository');

let cachedDatabase = null;

function buildDatabase() {
  const databaseUrl = process.env.DATABASE_URL;
  const postgresExplicitlyEnabled = process.env.STAGE3_ENABLE_POSTGRES === 'true';
  const runtimeEnv = process.env.NODE_ENV || 'development';

  // Production/staging must never silently fall back to an in-memory store.
  // A restart in those environments would otherwise lose accounts, wallet
  // balances, sessions and domain data while the process still reports OK.
  if ((runtimeEnv === 'production' || runtimeEnv === 'staging') && !postgresExplicitlyEnabled) {
    throw new Error('Postgres is mandatory in staging/production: set STAGE3_ENABLE_POSTGRES=true');
  }
  if ((runtimeEnv === 'production' || runtimeEnv === 'staging') && !databaseUrl) {
    throw new Error('Postgres is mandatory in staging/production: DATABASE_URL is required');
  }

  if (databaseUrl && postgresExplicitlyEnabled) {
    let Pool;
    try {
      // eslint-disable-next-line global-require
      ({ Pool } = require('pg'));
    } catch (err) {
      throw new Error(
        'STAGE3_ENABLE_POSTGRES is true but the "pg" package is not installed yet. ' +
          'Run `npm install` with network access first (see Database/STAGE3_TODO.md).'
      );
    }
    const pool = new Pool({ connectionString: databaseUrl });
    return {
      backend: 'postgres',
      accounts: new PostgresAccountRepository(pool),
      references: new PostgresReferenceRepository(pool),
      wallets: new PostgresWalletRepository(pool),
      featureRecords: new PostgresFeatureRecordRepository(pool),
      inventory: new PostgresInventoryRepository(pool),
      recharges: new PostgresRechargeRepository(pool),
      gifts: new PostgresGiftRepository(pool),
      giftWall: new PostgresGiftWallRepository(pool),
      gameMatches: new PostgresGameMatchRepository(pool),
      battles: new PostgresBattleRepository(pool),
      families: new PostgresFamilyRepository(pool),
      eventProgress: new PostgresEventRepository(pool),
      couples: new PostgresCoupleRepository(pool),
      guards: new PostgresGuardRepository(pool),
      notifications: new PostgresNotificationRepository(pool),
      chat: new PostgresChatRepository(pool),
      settings: new PostgresSettingsRepository(pool),
      auth: new PostgresAuthRepository(pool),
      auditLog: new PostgresAuditLogRepository(pool),
    };
  }

  return {
    backend: 'memory',
    accounts: new InMemoryAccountRepository(),
    references: new InMemoryReferenceRepository(),
    wallets: new InMemoryWalletRepository(),
    featureRecords: new InMemoryFeatureRecordRepository(),
    inventory: new InMemoryInventoryRepository(),
    recharges: new InMemoryRechargeRepository(),
    gifts: new InMemoryGiftRepository(),
    giftWall: new InMemoryGiftWallRepository(),
    gameMatches: new InMemoryGameMatchRepository(),
    battles: new InMemoryBattleRepository(),
    families: new InMemoryFamilyRepository(),
    eventProgress: new InMemoryEventRepository(),
    couples: new InMemoryCoupleRepository(),
    guards: new InMemoryGuardRepository(),
    notifications: new InMemoryNotificationRepository(),
    chat: new InMemoryChatRepository(),
    settings: new InMemorySettingsRepository(),
    auth: new InMemoryAuthRepository(),
    auditLog: new InMemoryAuditLogRepository(),
  };
}

// Cached so routes/scripts within one process share the same in-memory
// store instead of each getting an empty one.
function getDatabase() {
  if (!cachedDatabase) {
    cachedDatabase = buildDatabase();
  }
  return cachedDatabase;
}

// Test-only: allows tests to start from a clean database without
// restarting the process.
function resetDatabaseForTests() {
  cachedDatabase = null;
}

module.exports = { getDatabase, resetDatabaseForTests };
