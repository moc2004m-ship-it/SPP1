# Stage 29 — Completion Report (Store + Inventory: admin grant path)

## Scope of this pass

Store + Inventory were already complete except for one gap: `POST
/api/inventory/grant` unconditionally returned `403 "not yet
implemented"` for every caller. This pass implements the one missing
piece — a real, trusted server-side/admin grant path — and touches
nothing else in Store or Inventory.

## What was missing

`Backend/src/routes/platform.routes.js` (before this pass):

```js
router.post('/api/inventory/grant', (req, res) => {
  res.status(403).json({ ok: false, error: 'inventory grants are not available to mobile clients; requires a trusted server-side/admin path (not yet implemented)' });
});
```

There was no staff/admin/role concept anywhere in the codebase to build
a real check on top of, other than the room-scoped "room owner" guard —
same real gap Stage 35 Part 6 already documented and solved for
content-review reviewers (`Backend/src/config/moderation-staff.js`).
No general Stage 36 staff system exists yet, so this pass follows the
instruction's first option: **the same allowlist pattern**, not a new
invented staff login.

## What was built

**`Backend/src/config/admin-staff.js`** (new) — `loadAdminIdsFromEnv()` /
`isAdmin()`, byte-for-byte the same shape as `moderation-staff.js`:
a server-only `Set` of account ids from `INVENTORY_ADMIN_IDS`
(comma-separated env var), never sent by or readable from a client, not
set in this sandbox (so the route correctly 403s for everyone until a
real deployment configures it). Deliberately a **separate** allowlist
from `MODERATION_REVIEWER_IDS` — different responsibility, different
people in a real org — rather than reusing/widening the reviewer set.
The file documents that if a future stage builds a real general
Staff/roles system, swapping this env-loader for a real roles lookup is
a one-line change at the `index.js` call site.

**`Backend/src/database/models/inventory.model.js`** (edited) — added
`generateAdminGrantId()` (`admgrant_<uuid>`), same role
`generatePurchaseId()` plays for `store_purchase` grants. Server-generated
only, never client-supplied.

**`Backend/src/services/inventory-admin.service.js`** (new) —
`createInventoryAdminService({ inventory, adminIds }).grant({ actorId,
accountId, itemId, quantity })`:
1. Checks `isAdmin(adminIds, actorId)` **first**, before any input
   validation — a rejected caller (including one trying to grant to
   itself) learns nothing more from a malformed body than from a
   well-formed one; both just get 403.
2. Validates `accountId`/`itemId`/`quantity` (400 on failure).
3. Generates a fresh `referenceId` via `generateAdminGrantId()` and
   calls `inventory.grant(accountId, itemId, quantity, 'admin',
   referenceId)` — this is the "source transaction" every grant in this
   codebase already requires (`source` + `referenceId`, same
   idempotency guarantee `wallet_transactions.idempotency_key` gives
   money). Because `inventory.grant()` is idempotent on
   `(referenceId, itemId)`, and `referenceId` is fresh per real call
   here, a genuine retry can't double-grant, and two separate real
   admin actions are never merged into one.

**`Backend/src/routes/platform.routes.js`** (edited) — the route now
actually calls the service:

```js
router.post('/api/inventory/grant', (req, res) => json(res, () => inventoryAdminService.grant({
  actorId: req.session.accountId,
  accountId: req.body?.accountId,
  itemId: req.body?.itemId,
  quantity: Number.isInteger(req.body?.quantity) ? req.body.quantity : req.body?.quantity,
})));
```

`actorId` is always `req.session.accountId` (never a client-supplied
field, same rule this whole router already follows everywhere else).
`accountId` in the body is only ever a *target*, never proof of
authorization — a normal session cannot grant to itself or to anyone
else; both are rejected the same way, with the same 403, by the service
layer.

**`Backend/src/index.js`** (edited) — wires
`loadAdminIdsFromEnv()` and `createInventoryAdminService({ inventory:
db.inventory, adminIds })` into `createPlatformRouter(...)`.

## What still cannot happen (unchanged, verified)

- No authenticated session — admin or not — can grant itself or anyone
  else inventory through any *other* route. `POST /api/store/purchase`
  still requires a real wallet debit first (`store.service.js`,
  untouched). `GET /api/inventory/:userId` is still read-only and still
  locked to the caller's own account (`assertOwnAccount`, untouched).
- A non-admin session hitting `POST /api/inventory/grant` — including
  one that names itself as the `accountId` target — is rejected with
  403 before any grant is attempted. Verified explicitly, both as
  direct service calls and as route-contract tests reproducing the
  actual handler.
- With the real, unconfigured (empty) `INVENTORY_ADMIN_IDS` default —
  which is the state of this sandbox — **every** caller is rejected,
  including an otherwise well-formed request. Verified explicitly.

## Stage 29 tests

New files, all passing:

| File | Tests |
|---|---|
| `test/admin-staff.test.js` | 9/9 |
| `test/inventory-admin.service.test.js` | 11/11 |
| `test/platform.inventory-grant.routes-contract.test.js` | 7/7 |

Combined with the pre-existing, untouched Stage 29 files
(`store.service.test.js`, `store-catalog.test.js`,
`inventory.repository.test.js`): **44/44**.

## Full suite: before / after

Both counted with `node --test test/*.test.js`.

- Before this pass (new files absent): **1711 tests**, 1707 pass, 4
  fail — same 4 pre-existing failures below.
- After this pass (27 new tests added, nothing else changed):
  **1738 tests**, run 4 consecutive times for stability:
  - All 4 runs: **1734 pass, 4 fail** — identical, deterministic every
    time.

The same 4 failures every run (`accounts.routes.test.js`,
`agora.routes.test.js`, `auth.routes.test.js`, `config.routes.test.js`)
are the identical, sandbox-only `Cannot find module 'express'` error —
confirmed via direct error inspection, unrelated to this pass (no
express-dependent code was touched; the new grant path and its tests
depend on nothing but `node:crypto` and the existing in-memory
repositories, same as every other service-layer test in this suite).

## Net result

`POST /api/inventory/grant` is now a real, working admin-only path:
it succeeds only for an account in the real, server-only
`INVENTORY_ADMIN_IDS` allowlist, every grant is a traceable
`source: 'admin'` transaction with its own server-generated
`referenceId`, and no normal client — including one targeting its own
account — can reach it. Stage 29 (Store + Inventory) is complete.
