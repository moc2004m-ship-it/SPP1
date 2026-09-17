#!/usr/bin/env node
// Stage 3 — Requirement 7: a demo account, created FROM the backend, that
// automatically gets a real backend-generated User ID and all-zero
// defaults. This script does not hand-build a JSON object — it goes
// through the exact same getDatabase()/repository/model path that the
// POST /accounts route uses.
//
// Run with: npm run demo:account

const { getDatabase } = require('../src/database');

(async () => {
  const db = getDatabase();
  const account = await db.accounts.create();
  console.log(
    JSON.stringify(
      {
        backend: db.backend, // 'memory' in Stage 3 — no external DB connected yet
        account,
      },
      null,
      2
    )
  );
})();
