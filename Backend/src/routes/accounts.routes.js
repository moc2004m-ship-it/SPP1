// Stage 3 — Account routes.
//
// POST /accounts is intentionally public because it is the bootstrap account
// creation endpoint used before a session exists. GET /accounts/:id is NOT a
// public account dump: it requires a session and only permits the caller to
// read their own account. Wallet balances are never exposed here.
const express = require('express');
const { getDatabase } = require('../database');
const { requireSession } = require('../auth/session-middleware');
const { assertOwnAccount } = require('./platform.guards');

function createAccountsRouter({ authStore }) {
  const router = express.Router();

  router.post('/accounts', async (req, res, next) => {
    try {
      const db = getDatabase();
      const account = await db.accounts.create();
      res.status(201).json({ account, backend: db.backend });
    } catch (err) { next(err); }
  });

  router.get('/accounts/:id', requireSession(authStore), async (req, res, next) => {
    try {
      const userId = assertOwnAccount(req.session, req.params.id);
      const db = getDatabase();
      const account = await db.accounts.findById(userId);
      if (!account) return res.status(404).json({ error: 'account not found' });
      const publicAccount = {
        id: account.id,
        vip: account.vip,
        svip: account.svip,
        lvl: account.lvl,
        xp: account.xp,
        createdAt: account.createdAt,
        updatedAt: account.updatedAt,
      };
      res.json({ account: publicAccount });
    } catch (err) { next(err); }
  });

  return router;
}

module.exports = { createAccountsRouter };
