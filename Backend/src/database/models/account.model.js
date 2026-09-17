// Stage 3 — Basic Account Model.
// Stage 27/28 — added xp and lifetimeDiamondsRecharged (see
// ../repositories/account.repository.js's addXp()/addLifetimeRecharge()
// and ../../domain/level-curve.js, ../../domain/vip-tiers.js).
// Stage 34 — added deletedAt (see ../repositories/account.repository.js's
// softDelete()). NULL for every account until
// ../../services/settings.service.js's deleteAccount() sets it exactly
// once, server-side. This is a SAFE soft delete only -- no other field on
// this record, and no data in any other stage's tables, is ever touched
// by it.
// Stage 36 — added suspendedAt/suspendedReason/suspendedBy (see
// ../repositories/account.repository.js's suspend()/unsuspend()/
// listSuspended(), and ../../security/staff.js for who is allowed to call
// them). NULL/NULL/NULL for every account until an authorized staff
// member suspends it. Distinct from, and independent of, deletedAt --
// see ../schema/028_add_account_suspension.sql's header.
//
// Security boundary (see Database/DATABASE_DESIGN.md § "Security boundaries"):
// this factory does not read ANY field from client input. The signature
// intentionally takes no arguments. If a future stage needs an optional,
// non-sensitive profile field (e.g. a display name), it must be added
// explicitly here and reviewed — it must never include id/vip/svip/lvl/
// xp/lifetimeDiamondsRecharged/coins/diamonds, which stay backend-owned
// forever.

const { generateUserId } = require('../id-generator');

// Frozen so any accidental attempt to mutate a returned account object
// after creation fails loudly instead of silently drifting from what the
// repository/database actually holds.
function createAccount() {
  const now = new Date().toISOString();
  return Object.freeze({
    id: generateUserId(), // server-generated — never accepted from a client
    vip: 0,
    svip: 0,
    lvl: 0,
    xp: 0,
    coins: 0,
    diamonds: 0,
    // Lifetime total of everything ever successfully, provider-verified
    // recharged for this account. Deliberately separate from the
    // spendable `coins`/`diamonds` balances above, which go DOWN when the
    // user spends -- VIP/SVIP tiers must be based on a counter that never
    // decreases (see ../../domain/vip-tiers.js).
    lifetimeDiamondsRecharged: 0,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    suspendedAt: null,
    suspendedReason: null,
    suspendedBy: null,
  });
}

// Fields that a client must never be able to set or overwrite directly,
// on this or any future account-related endpoint. Kept here as a single
// named source of truth so route/validation code elsewhere can reference
// it instead of re-typing the list.
const SERVER_OWNED_FIELDS = Object.freeze([
  'id',
  'vip',
  'svip',
  'lvl',
  'xp',
  'coins',
  'diamonds',
  'lifetimeDiamondsRecharged',
  'createdAt',
  'updatedAt',
  'deletedAt',
  'suspendedAt',
  'suspendedReason',
  'suspendedBy',
]);

module.exports = { createAccount, SERVER_OWNED_FIELDS };
