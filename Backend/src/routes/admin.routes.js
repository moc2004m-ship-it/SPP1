'use strict';
const express = require('express');
const { requireSession } = require('../auth/session-middleware');
const { STORE_COMPLIANCE } = require('../domain/store-compliance');

function createAdminRouter({ authStore, adminPanelService }) {
  const router = express.Router();
  router.use(requireSession(authStore));
  const run = async (res, fn) => {
    try { res.json({ ok: true, data: await fn() }); }
    catch (e) { res.status(e.status || 400).json({ ok: false, error: e.message }); }
  };
  router.get('/api/admin/users', (req,res) => run(res, () => adminPanelService.listUsers(req.session.accountId)));
  router.get('/api/admin/rooms', (req,res) => run(res, () => adminPanelService.listRooms(req.session.accountId)));
  router.get('/api/admin/economy', (req,res) => run(res, () => adminPanelService.listEconomy(req.session.accountId)));
  router.post('/api/admin/economy/adjust', (req,res) => run(res, () => adminPanelService.adjustBalance({ actorId:req.session.accountId, ...req.body })));
  router.get('/api/admin/recharge', (req,res) => run(res, () => adminPanelService.listRecharge(req.session.accountId)));
  router.get('/api/admin/gifts', (req,res) => run(res, () => adminPanelService.listGifts(req.session.accountId)));
  router.get('/api/admin/games', (req,res) => run(res, () => adminPanelService.listGames(req.session.accountId)));
  router.get('/api/admin/reports', (req,res) => run(res, () => adminPanelService.listReports(req.session.accountId)));
  router.get('/api/admin/bans', (req,res) => run(res, () => adminPanelService.listBans(req.session.accountId)));
  router.get('/api/admin/tickets', (req,res) => run(res, () => adminPanelService.listTickets(req.session.accountId)));
  router.get('/api/admin/support', (req,res) => run(res, () => adminPanelService.listSupport(req.session.accountId)));
  router.get('/api/admin/analytics', (req,res) => run(res, () => adminPanelService.listAnalytics(req.session.accountId, req.query.period || '30d')));
  router.get('/api/admin/audit-log', (req,res) => run(res, () => adminPanelService.listAudit(req.session.accountId, { action:req.query.action, targetType:req.query.targetType, targetId:req.query.targetId, limit:req.query.limit })));
  router.get('/api/admin/anti-fraud', (req,res) => run(res, () => adminPanelService.fraud(req.session.accountId, { windowMinutes:req.query.windowMinutes, maxCompleted:req.query.maxCompleted, maxFailed:req.query.maxFailed })));
  router.post('/api/admin/rooms/:roomId/close', (req,res) => run(res, () => adminPanelService.closeRoom({ actorId:req.session.accountId, roomId:req.params.roomId, reason:req.body?.reason })));
  router.get('/api/admin/compliance', (req,res) => run(res, () => STORE_COMPLIANCE));
  return router;
}
module.exports = { createAdminRouter };
