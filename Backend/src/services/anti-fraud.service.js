'use strict';

function createAntiFraudService({ recharges, accounts, clock = () => new Date() }) {
  async function scan({ windowMinutes = 10, maxCompleted = 3, maxFailed = 5 } = {}) {
    const minutes = Number(windowMinutes);
    if (!Number.isFinite(minutes) || minutes <= 0 || minutes > 1440) throw Object.assign(new Error('windowMinutes must be between 1 and 1440'), { status: 400 });
    const since = new Date(clock().getTime() - minutes * 60 * 1000);
    const orders = await recharges.listAll();
    const byAccount = new Map();
    for (const order of orders) {
      if (new Date(order.createdAt) < since) continue;
      const row = byAccount.get(order.accountId) || { accountId: order.accountId, completed: 0, failed: 0, pending: 0, totalCoins: 0, orders: [] };
      row[order.status] = (row[order.status] || 0) + 1;
      if (order.status === 'completed') row.totalCoins += Number(order.coinsToCredit || 0);
      row.orders.push(order.id);
      byAccount.set(order.accountId, row);
    }
    const flags = [];
    for (const row of byAccount.values()) {
      const reasons = [];
      if (row.completed > maxCompleted) reasons.push('completed_recharge_burst');
      if (row.failed > maxFailed) reasons.push('repeated_failed_recharges');
      if (row.pending >= maxFailed) reasons.push('pending_recharge_burst');
      if (reasons.length) flags.push({ ...row, reasons, severity: reasons.length > 1 ? 'high' : 'medium' });
    }
    const known = new Set((await accounts.list()).map(a => a.id));
    return { windowMinutes: minutes, since: since.toISOString(), scannedOrders: orders.length, flags: flags.filter(f => known.has(f.accountId)) };
  }
  return { scan };
}
module.exports = { createAntiFraudService };
