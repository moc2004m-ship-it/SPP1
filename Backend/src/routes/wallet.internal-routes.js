'use strict';
const express = require('express');

// SECURITY: this router is mounted separately from /platform/api/* and is
// NEVER guarded by requireSession (see ./platform.routes.js). A valid
// mobile user session must NOT be sufficient to call these endpoints --
// that would let a client credit/debit its own wallet directly, which is
// exactly what Phase 1/2 explicitly forbids ("لا تسمح للـMobile بتعديل
// wallet/balance مباشرة"). Instead it requires a separate shared secret
// (WALLET_INTERNAL_KEY) that only trusted server-side callers hold: a
// verified payment webhook handler, a game-result settlement job, an admin
// tool. None of those exist yet as real integrations -- this router exists
// so that when they do, they have a real, tested, idempotent place to call
// into, instead of writing to the wallet ad hoc.
function requireServiceKey(expectedKey) {
  return (req, res, next) => {
    if (!expectedKey) {
      return res.status(503).json({ ok: false, error: 'WALLET_INTERNAL_KEY is not configured on this server' });
    }
    const provided = req.get('x-wallet-service-key');
    if (provided !== expectedKey) {
      return res.status(401).json({ ok: false, error: 'invalid or missing service key' });
    }
    return next();
  };
}

function createWalletInternalRouter({ wallets, serviceKey }) {
  const router = express.Router();
  router.use(express.json());
  router.use(requireServiceKey(serviceKey));

  router.post('/credit', async (req, res) => {
    try {
      const { accountId, currency, amount, idempotencyKey } = req.body || {};
      const result = await wallets.credit(accountId, currency, amount, idempotencyKey);
      res.json({ ok: true, data: result });
    } catch (e) {
      res.status(e.status || 400).json({ ok: false, error: e.message });
    }
  });

  router.post('/debit', async (req, res) => {
    try {
      const { accountId, currency, amount, idempotencyKey } = req.body || {};
      const result = await wallets.debit(accountId, currency, amount, idempotencyKey);
      res.json({ ok: true, data: result });
    } catch (e) {
      res.status(e.status || 400).json({ ok: false, error: e.message });
    }
  });

  router.get('/:accountId/balance', async (req, res) => {
    try {
      const result = await wallets.getBalance(req.params.accountId);
      res.json({ ok: true, data: result });
    } catch (e) {
      res.status(e.status || 400).json({ ok: false, error: e.message });
    }
  });

  return router;
}

module.exports = { createWalletInternalRouter, requireServiceKey };
