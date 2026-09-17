'use strict';

function createAnalyticsService({ accounts, recharges, auth, platform, gameMatches, clock = () => new Date() }) {
  async function snapshot(period = '30d') {
    const days = period === '7d' ? 7 : period === '30d' ? 30 : period === '90d' ? 90 : Number(period);
    if (!Number.isInteger(days) || days <= 0 || days > 3650) throw Object.assign(new Error('period must be 7d, 30d, 90d, or a positive day count'), { status: 400 });
    const now = clock();
    const since = new Date(now.getTime() - days * 86400000);
    const [allAccounts, orders, sessions, rooms, games] = await Promise.all([
      accounts.list(), recharges.listAll(), auth.listAllSessions(), platform.store.list(12), gameMatches.listAll(),
    ]);
    const activeSessionRows = sessions.filter(s => new Date(s.lastSeenAt || s.createdAt) >= since);
    const dauStart = new Date(now.getTime() - 86400000);
    const dau = new Set(sessions.filter(s => new Date(s.lastSeenAt || s.createdAt) >= dauStart).map(s => s.accountId)).size;
    const mau = new Set(activeSessionRows.map(s => s.accountId)).size;
    const completed = orders.filter(o => o.status === 'completed' && new Date(o.createdAt) >= since);
    const failed = orders.filter(o => o.status === 'failed' && new Date(o.createdAt) >= since);
    const pending = orders.filter(o => o.status === 'pending' && new Date(o.createdAt) >= since);
    const coins = completed.reduce((sum, o) => sum + Number(o.coinsToCredit || 0), 0);
    const retentionBase = new Set(sessions.filter(s => new Date(s.createdAt) < since && new Date(s.lastSeenAt || s.createdAt) >= since).map(s => s.accountId));
    const retentionReturning = new Set(activeSessionRows.filter(s => new Date(s.createdAt) < since).map(s => s.accountId));
    const retentionRate = retentionBase.size ? retentionReturning.size / retentionBase.size : null;
    return {
      period: `${days}d`, generatedAt: now.toISOString(), users: { total: allAccounts.length, dau, mau },
      arpuCoins: mau ? coins / mau : 0,
      arpuCurrency: null,
      arpuCurrencyReason: 'Recharge orders in this project store coin credit but no verified monetary price field; currency ARPU is intentionally not fabricated.',
      retention: { returningUsers: retentionReturning.size, eligibleUsers: retentionBase.size, rate: retentionRate },
      rechargeFunnel: { pending: pending.length, completed: completed.length, failed: failed.length, conversionRate: (pending.length + completed.length + failed.length) ? completed.length / (pending.length + completed.length + failed.length) : 0 },
      roomActivity: { roomsCreated: rooms.filter(r => new Date(r.createdAt) >= since).length, activeRooms: rooms.filter(r => r.status !== 'closed').length },
      gameActivity: { matchesCreated: games.filter(g => new Date(g.createdAt) >= since).length, finishedMatches: games.filter(g => g.state === 'finished' && new Date(g.updatedAt || g.createdAt) >= since).length },
      errors: { source: 'central application logger', available: false, count: null },
    };
  }
  return { snapshot };
}
module.exports = { createAnalyticsService };
