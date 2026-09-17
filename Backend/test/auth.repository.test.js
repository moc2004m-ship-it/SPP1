'use strict';
// Stage 5 audit (this session) — dependency-free tests for the new
// ../src/database/repositories/auth.repository.js (InMemoryAuthRepository)
// and, at the AuthStore level, the exact "two devices show in Devices,
// and one can be ended remotely" scenario the task asked to verify —
// proven here independently of express (which is not installable in
// this sandbox — see test/auth.routes.test.js for the HTTP-level
// version of the same scenario, currently blocked by that missing
// dependency, not by any logic defect).

const test = require('node:test');
const assert = require('node:assert/strict');
const { InMemoryAuthRepository } = require('../src/database/repositories/auth.repository');
const { AuthStore } = require('../src/auth/auth.store');
const { InMemoryAccountRepository } = require('../src/database/repositories/account.repository');

// ---------------------------------------------------------------------
// InMemoryAuthRepository — direct unit tests
// ---------------------------------------------------------------------

test('identities: unknown key returns null, set-then-get round-trips', () => {
  const repo = new InMemoryAuthRepository();
  assert.equal(repo.getIdentityAccountId('phone:+1'), null);
  repo.setIdentity('phone:+1', 'usr_1');
  assert.equal(repo.getIdentityAccountId('phone:+1'), 'usr_1');
});

test('otp challenges: set/get/delete round-trip, unknown phone returns null', () => {
  const repo = new InMemoryAuthRepository();
  assert.equal(repo.getOtpChallenge('+1'), null);
  repo.setOtpChallenge('+1', { hash: 'h', expiresAt: 123, attempts: 0 });
  assert.deepEqual(repo.getOtpChallenge('+1'), { hash: 'h', expiresAt: 123, attempts: 0 });
  repo.deleteOtpChallenge('+1');
  assert.equal(repo.getOtpChallenge('+1'), null);
});

test('sessions: createSession/getSessionByTokenHash round-trip, unknown hash returns null', () => {
  const repo = new InMemoryAuthRepository();
  assert.equal(repo.getSessionByTokenHash('nope'), null);
  const session = { id: 'session_1', accountId: 'usr_1', revokedAt: null };
  repo.createSession(session, 'hash_1');
  assert.deepEqual(repo.getSessionByTokenHash('hash_1'), session);
});

test('listActiveSessionsForAccount excludes revoked sessions and other accounts', () => {
  const repo = new InMemoryAuthRepository();
  repo.createSession({ id: 's1', accountId: 'A', revokedAt: null }, 'h1');
  repo.createSession({ id: 's2', accountId: 'A', revokedAt: '2020-01-01' }, 'h2');
  repo.createSession({ id: 's3', accountId: 'B', revokedAt: null }, 'h3');
  const active = repo.listActiveSessionsForAccount('A');
  assert.equal(active.length, 1);
  assert.equal(active[0].id, 's1');
});

test('revokeSessionById only revokes the matching (accountId, sessionId) pair, returns false when not found', () => {
  const repo = new InMemoryAuthRepository();
  repo.createSession({ id: 's1', accountId: 'A', revokedAt: null }, 'h1');
  repo.createSession({ id: 's2', accountId: 'A', revokedAt: null }, 'h2');
  assert.equal(repo.revokeSessionById('A', 'nonexistent', 'now'), false);
  assert.equal(repo.revokeSessionById('B', 's1', 'now'), false, 'must not revoke another account\'s session');
  assert.equal(repo.revokeSessionById('A', 's1', 'now'), true);
  assert.equal(repo.getSessionByTokenHash('h1').revokedAt, 'now');
  assert.equal(repo.getSessionByTokenHash('h2').revokedAt, null, 'the other session must remain untouched');
});

test('revokeAllSessionsForAccount revokes only that account\'s active sessions and is idempotent', () => {
  const repo = new InMemoryAuthRepository();
  repo.createSession({ id: 's1', accountId: 'A', revokedAt: null }, 'h1');
  repo.createSession({ id: 's2', accountId: 'A', revokedAt: null }, 'h2');
  repo.createSession({ id: 's3', accountId: 'B', revokedAt: null }, 'h3');
  assert.equal(repo.revokeAllSessionsForAccount('A', 'now'), 2);
  assert.equal(repo.revokeAllSessionsForAccount('A', 'now'), 0, 'second call has nothing left to revoke');
  assert.equal(repo.getSessionByTokenHash('h3').revokedAt, null, 'account B must be unaffected');
});

test('consents: unknown account returns null, set-then-get round-trips', () => {
  const repo = new InMemoryAuthRepository();
  assert.equal(repo.getConsent('A'), null);
  const record = { accountId: 'A', version: '1.0', acceptedAt: 'now' };
  repo.setConsent('A', record);
  assert.deepEqual(repo.getConsent('A'), record);
});

// ---------------------------------------------------------------------
// AuthStore, backed by the (now-extracted) repository — the exact
// end-to-end scenario the task asked to verify, without express.
// ---------------------------------------------------------------------

async function setupAuthStore() {
  const accounts = new InMemoryAccountRepository();
  const auth = new AuthStore(accounts);
  const account = await auth.findOrCreatePhoneAccount('+213555999999');
  return { auth, account };
}

test('two devices for the same account both show up in Devices, and remotely ending one truly ends that session', async () => {
  const { auth, account } = await setupAuthStore();

  const deviceA = await auth.createSession(account.id, { name: 'iPhone 15', platform: 'ios' });
  const deviceB = await auth.createSession(account.id, { name: 'Galaxy S24', platform: 'android' });

  // Both devices show in the account's Devices/Sessions list.
  const sessions = await auth.listSessions(account.id);
  assert.equal(sessions.length, 2, 'both devices must appear in the sessions/devices list');
  const ids = sessions.map((s) => s.id).sort();
  assert.deepEqual(ids, [deviceA.session.id, deviceB.session.id].sort());

  // Both bearer tokens currently authenticate.
  assert.ok(await auth.authenticate(deviceA.token));
  assert.ok(await auth.authenticate(deviceB.token));

  // Remotely end ONLY device B's session (e.g. "log out this device"
  // initiated from device A's Devices screen).
  const revoked = await auth.revokeSessionById(account.id, deviceB.session.id);
  assert.equal(revoked, true);

  // Device B's token is now truly dead — authenticate() rejects it.
  assert.equal(await auth.authenticate(deviceB.token), null, 'the remotely-ended device must no longer authenticate');
  // Device A is completely unaffected.
  assert.ok(await auth.authenticate(deviceA.token), 'the other device must remain logged in');

  // Devices list now reflects only the one still-active device.
  const remaining = await auth.listSessions(account.id);
  assert.equal(remaining.length, 1);
  assert.equal(remaining[0].id, deviceA.session.id);
});

test('ending a device session for a DIFFERENT account is rejected, never leaks cross-account revocation', async () => {
  const accounts = new InMemoryAccountRepository();
  const auth = new AuthStore(accounts);
  const alice = await auth.findOrCreatePhoneAccount('+213555111111');
  const bob = await auth.findOrCreatePhoneAccount('+213555222222');

  const bobSession = await auth.createSession(bob.id, { name: 'Bob phone', platform: 'android' });

  // Alice tries to end Bob's session by guessing/knowing its id.
  const revoked = await auth.revokeSessionById(alice.id, bobSession.session.id);
  assert.equal(revoked, false, 'a session must only be revocable by its own account');
  assert.ok(await auth.authenticate(bobSession.token), 'Bob\'s session must remain untouched');
});
