// Stage 31 — Ranking service.
//
// Read-only. Every number here comes from real, already-persisted
// server-side data -- gifts.repository's gifts_log (real wallet-debited
// gift sends, see ../database/repositories/gift.repository.js and
// ../services/gifts.service.js) and families.repository's real xp/level
// (see ../services/family.service.js). Nothing here accepts a
// client-supplied score.
//
// Three ranking types:
//   'wealth' — top spenders (sum of totalCostCoins as sender), over a
//              period (daily/weekly/monthly/all).
//   'charm'  — top gift recipients (sum of totalCostCoins as receiver),
//              over the same periods.
//   'family' — top families by real, cumulative xp (see
//              ../domain/family-level-curve.js). Families have no
//              per-period activity log (only a running total), so this
//              type ignores the period argument and always reflects
//              current standings -- documented explicitly rather than
//              silently pretending to support a period it cannot honor.

const { assertValidPeriod, periodStart, PERIODS } = require('../domain/ranking-periods');

const TYPES = Object.freeze(['wealth', 'charm', 'family']);

function badRequest(message) {
  return Object.assign(new Error(message), { status: 400 });
}

function assertValidType(type) {
  if (!TYPES.includes(type)) {
    throw badRequest(`type must be one of ${TYPES.join(', ')}`);
  }
}

function assertValidLimit(limit) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw badRequest('limit must be an integer between 1 and 100');
  }
}

function createRankingService({ gifts, families, now = () => new Date() }) {
  async function wealthEntries(period) {
    const since = periodStart(period, now());
    return gifts.sumBySender({ since });
  }

  async function charmEntries(period) {
    const since = periodStart(period, now());
    return gifts.sumByReceiver({ since });
  }

  async function familyEntries() {
    const all = await families.listFamilies();
    return all
      .map((f) => ({ accountId: f.id, total: f.xp, name: f.name, level: f.level }))
      .sort((a, b) => b.total - a.total);
  }

  async function entriesFor(type, period) {
    assertValidType(type);
    if (type === 'family') return familyEntries();
    assertValidPeriod(period);
    return type === 'wealth' ? wealthEntries(period) : charmEntries(period);
  }

  // Top `limit` entries for a ranking type, each annotated with its
  // 1-based rank.
  async function getRanking({ type, period = 'all', limit = 20 }) {
    assertValidLimit(limit);
    const entries = await entriesFor(type, period);
    return entries.slice(0, limit).map((entry, index) => ({ rank: index + 1, ...entry }));
  }

  // Where a specific account currently stands on a ranking, even outside
  // the top N. Returns { rank: null, total: 0 } if the account has no
  // activity for this type/period rather than throwing -- "not ranked
  // yet" is a normal, expected answer, not an error.
  async function getMyRank({ type, period = 'all', accountId }) {
    if (typeof accountId !== 'string' || !accountId) throw badRequest('accountId is required');
    const entries = await entriesFor(type, period);
    const index = entries.findIndex((e) => e.accountId === accountId);
    if (index === -1) return { rank: null, total: 0 };
    return { rank: index + 1, ...entries[index] };
  }

  return { TYPES, PERIODS, getRanking, getMyRank };
}

module.exports = { createRankingService, TYPES };
