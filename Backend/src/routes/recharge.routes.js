'use strict';
const express = require('express');
const { requireSession } = require('../auth/session-middleware');
const { assertOwnAccount } = require('./platform.guards');
const { listPackages } = require('../database/models/recharge.model');

// SECURITY: same rules as platform.routes.js -- every route requires a
// valid Bearer session, and the acting identity is always
// req.session.accountId, never a client-supplied field. coinsToCredit is
// never accepted from the client (see ../models/recharge.model.js); it is
// always resolved server-side from packageId. Completion always goes
// through real provider verification (../services/recharge-provider-verifier.js)
// -- there is no path here that credits a wallet without it.
function createRechargeRouter({ rechargeService, recharges, authStore }) {
  const router = express.Router();
  router.use(requireSession(authStore));

  // Stage 25 -- real, server-owned package catalog. No ownership scoping
  // needed (the catalog is the same for every account), but the route is
  // still behind requireSession like every other route in this file --
  // there is no public/unauthenticated surface in this router. Lets the
  // client discover real packageId/coins pairs instead of hardcoding them.
  router.get('/api/recharge/packages', async (req, res) => {
    try {
      res.json({ ok: true, data: listPackages() });
    } catch (e) {
      res.status(e.status || 400).json({ ok: false, error: e.message });
    }
  });

  router.post('/api/recharge/orders', async (req, res) => {
    try {
      const order = await rechargeService.createOrder(req.session.accountId, req.body?.packageId, req.body?.provider);
      res.status(201).json({ ok: true, data: order });
    } catch (e) {
      res.status(e.status || 400).json({ ok: false, error: e.message });
    }
  });

  router.post('/api/recharge/orders/:orderId/complete', async (req, res) => {
    try {
      const order = await rechargeService.completeOrder(
        req.params.orderId,
        req.session.accountId,
        req.body?.providerPurchaseRef
      );
      res.json({ ok: true, data: order });
    } catch (e) {
      res.status(e.status || 400).json({ ok: false, error: e.message });
    }
  });

  router.get('/api/recharge/orders', async (req, res) => {
    try {
      const orders = await recharges.listByAccount(req.session.accountId);
      res.json({ ok: true, data: orders });
    } catch (e) {
      res.status(e.status || 400).json({ ok: false, error: e.message });
    }
  });

  // A session may only ever read its own orders -- consistent with
  // wallet/notifications/settings self-scoping in platform.routes.js.
  router.get('/api/recharge/orders/:orderId', async (req, res) => {
    try {
      const order = await recharges.findById(req.params.orderId);
      if (!order) return res.status(404).json({ ok: false, error: 'order not found' });
      assertOwnAccount(req.session, order.accountId);
      res.json({ ok: true, data: order });
    } catch (e) {
      res.status(e.status || 400).json({ ok: false, error: e.message });
    }
  });

  return router;
}

module.exports = { createRechargeRouter };
