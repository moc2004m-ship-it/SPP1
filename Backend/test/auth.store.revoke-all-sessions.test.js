'use strict';
// Stage 34 — focused tests for AuthStore#revokeAllSessions(), the piece
// ../services/settings.service.js's deleteAccount() relies on for
// "force logout everywhere". No dedicated auth.store.js test file
// existed before this session; this file is deliberately scoped to just
// this one new method rather than retrofitting full coverage of the
// rest of AuthStore (out of Stage 34's scope).
//
// Stage 5 completion (this session) -- AuthStore's methods are now
// `async` (see ../src/auth/auth.store.js's header: this is what let
// db.auth be a real PostgresAuthRepository instead of only ever an
// in-memory one -- Authentication/STAGE5_TODO.md item 5). Every call
// below is updated to `await` accordingly; the assertions and scenarios
// themselves are byte-for-byte the same behavior this file always
// verified, just awaited.

const test = require('node:test');
const assert = require('node:assert/strict');

const { AuthStore } = require('../src/auth/auth.store');
const { InMemoryAccountRepository } = require('../src/database/repositories/account.repository');

async function setup() {
  const accounts = new InMemoryAccountRepository();
  const auth = new AuthStore(accounts);
  const account = await accounts.create();
  return { auth, accounts, accountId: account.id };
}

test('revokeAllSessions revokes every currently-active session for the account', async () => {
  const { auth, accountId } = await setup();
  const s1 = await auth.createSession(accountId, { name: 'phone' });
  const s2 = await auth.createSession(accountId, { name: 'tablet' });

  const count = await auth.revokeAllSessions(accountId);
  assert.equal(count, 2);
  assert.equal(await auth.authenticate(s1.token), null);
  assert.equal(await auth.authenticate(s2.token), null);
});

test('revokeAllSessions never touches another account\'s sessions', async () => {
  const { auth, accounts, accountId } = await setup();
  const other = await accounts.create();
  const mine = await auth.createSession(accountId, { name: 'phone' });
  const theirs = await auth.createSession(other.id, { name: 'phone' });

  await auth.revokeAllSessions(accountId);
  assert.equal(await auth.authenticate(mine.token), null);
  assert.ok(await auth.authenticate(theirs.token), 'the other account\'s session must remain valid');
});

test('revokeAllSessions is idempotent -- a second call with nothing left to revoke is a real no-op returning 0', async () => {
  const { auth, accountId } = await setup();
  await auth.createSession(accountId, { name: 'phone' });
  const first = await auth.revokeAllSessions(accountId);
  const second = await auth.revokeAllSessions(accountId);
  assert.equal(first, 1);
  assert.equal(second, 0);
});

test('revokeAllSessions returns 0 for an account with no sessions at all', async () => {
  const { auth, accountId } = await setup();
  assert.equal(await auth.revokeAllSessions(accountId), 0);
});

test('revokeAllSessions does not revoke a session already revoked individually (does not double-count/crash)', async () => {
  const { auth, accountId } = await setup();
  const s1 = await auth.createSession(accountId, { name: 'phone' });
  const session = await auth.authenticate(s1.token);
  await auth.revokeSessionById(accountId, session.id);
  const count = await auth.revokeAllSessions(accountId);
  assert.equal(count, 0);
});
