'use strict';

const { hasPermission, PERMISSIONS } = require('../security/staff');

function forbidden(permission) {
  throw Object.assign(new Error(`${permission} permission required`), { status: 403 });
}
function requireId(value, name = 'id') {
  if (typeof value !== 'string' || !value.trim()) throw Object.assign(new Error(`${name} must be a non-empty string`), { status: 400 });
  return value.trim();
}
function requirePositiveInt(value, name) {
  if (!Number.isInteger(value) || value <= 0) throw Object.assign(new Error(`${name} must be a positive integer`), { status: 400 });
  return value;
}

function createAdminPanelService({ accounts, wallets, recharges, gifts, gameMatches, platform, auditService, staffRoles, analyticsService, antiFraudService }) {
  const check = (actorId, permission) => {
    if (!hasPermission(staffRoles, actorId, permission)) forbidden(permission);
  };
  const audit = (actorId, action, targetType, targetId, metadata = {}) => auditService.record({ actorId, action, targetType, targetId, metadata });

  async function listUsers(actorId) { check(actorId, PERMISSIONS.USERS_VIEW); return accounts.list(); }
  async function listRooms(actorId) { check(actorId, PERMISSIONS.ROOMS_MANAGE); return platform.store.list(12); }
  async function listEconomy(actorId) { check(actorId, PERMISSIONS.ECONOMY_MANAGE); return accounts.list().then(async rows => Promise.all(rows.map(async a => ({ account: a, balance: await wallets.getBalance(a.id) })))); }
  async function adjustBalance({ actorId, accountId, currency, amount, direction, reason }) {
    check(actorId, PERMISSIONS.ECONOMY_MANAGE);
    requireId(accountId, 'accountId');
    if (!['coins', 'diamonds'].includes(currency)) throw Object.assign(new Error('currency must be coins or diamonds'), { status: 400 });
    if (!['credit', 'debit'].includes(direction)) throw Object.assign(new Error('direction must be credit or debit'), { status: 400 });
    requirePositiveInt(amount, 'amount');
    const key = `admin_${actorId}_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const tx = direction === 'credit' ? await wallets.credit(accountId, currency, amount, key) : await wallets.debit(accountId, currency, amount, key);
    await audit(actorId, `economy:${direction}`, 'account', accountId, { currency, amount, transactionId: tx.id, reason: reason || null });
    return tx;
  }
  async function listRecharge(actorId) { check(actorId, PERMISSIONS.RECHARGE_VIEW); return recharges.listAll(); }
  async function listGifts(actorId) { check(actorId, PERMISSIONS.GIFTS_MANAGE); return gifts.listAll(); }
  async function listGames(actorId) { check(actorId, PERMISSIONS.GAMES_MANAGE); return gameMatches.listAll(); }
  async function listReports(actorId) { check(actorId, PERMISSIONS.REPORTS_VIEW); return platform.store.list(35, r => !r.kind && Object.prototype.hasOwnProperty.call(r, 'targetId')); }
  async function listBans(actorId) {
    check(actorId, PERMISSIONS.BANS_MANAGE);
    const [suspended, roomBans] = await Promise.all([accounts.listSuspended(), platform.store.list(16, r => r.type === 'ban' && r.status === 'active')]);
    return { suspendedAccounts: suspended, roomBans };
  }
  async function listTickets(actorId) { check(actorId, PERMISSIONS.TICKETS_MANAGE); return platform.store.list(35, r => Array.isArray(r.messages)); }
  async function listSupport(actorId) { check(actorId, PERMISSIONS.SUPPORT_VIEW); return platform.store.list(35, r => r.kind === 'appeal' || r.kind === 'review'); }
  async function listAnalytics(actorId, period) { check(actorId, PERMISSIONS.ANALYTICS_VIEW); return analyticsService.snapshot(period); }
  async function listAudit(actorId, filters) { check(actorId, PERMISSIONS.AUDIT_VIEW); return auditService.list({ actorId, ...filters }); }
  async function fraud(actorId, options) { check(actorId, PERMISSIONS.ECONOMY_MANAGE); return antiFraudService.scan(options); }

  async function closeRoom({ actorId, roomId, reason }) {
    check(actorId, PERMISSIONS.ROOMS_MANAGE);
    requireId(roomId, 'roomId');
    const room = await platform.store.find(12, r => r.id === roomId);
    if (!room) throw Object.assign(new Error('room not found'), { status: 404 });
    const updated = await platform.store.update(12, roomId, { status: 'closed', closedAt: new Date().toISOString(), closedBy: actorId });
    await audit(actorId, 'room:close', 'room', roomId, { reason: reason || null });
    return updated;
  }

  return { listUsers, listRooms, listEconomy, adjustBalance, listRecharge, listGifts, listGames, listReports, listBans, listTickets, listSupport, listAnalytics, listAudit, fraud, closeRoom };
}
module.exports = { createAdminPanelService };
