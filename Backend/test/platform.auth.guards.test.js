'use strict';
// Pure-logic tests for the new session middleware + platform authorization
// guards. Deliberately dependency-free (no express, no supertest) so they
// run in environments without npm/network access, per project constraint:
// HTTP-level tests that need express are recorded as BLOCKED separately,
// not silently skipped.

const test = require('node:test');
const assert = require('node:assert/strict');

const { AuthStore } = require('../src/auth/auth.store');
const { InMemoryAccountRepository } = require('../src/database/repositories/account.repository');
const { requireSession } = require('../src/auth/session-middleware');
const { assertOwnAccount, requireRoomOwner, isRoomMember, requireRoomMember } = require('../src/routes/platform.guards');
const { createPlatform } = require('../src/feature-platform');

function fakeRes() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
}

async function makeSession() {
  const accounts = new InMemoryAccountRepository();
  const auth = new AuthStore(accounts);
  const account = await accounts.create();
  const { token } = await auth.createSession(account.id, { name: 'test-device' });
  return { auth, accountId: account.id, token };
}

test('requireSession rejects requests with no Authorization header', async () => {
  const { auth } = await makeSession();
  const req = { headers: {} };
  const res = fakeRes();
  let nextCalled = false;
  await requireSession(auth)(req, res, () => { nextCalled = true; });
  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 401);
  assert.equal(res.body.error, 'unauthorized');
});

test('requireSession rejects an invalid/forged Bearer token', async () => {
  const { auth } = await makeSession();
  const req = { headers: { authorization: 'Bearer not_a_real_token' } };
  const res = fakeRes();
  let nextCalled = false;
  await requireSession(auth)(req, res, () => { nextCalled = true; });
  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 401);
});

test('requireSession accepts a real token and sets req.session.accountId from the server-side session, not the client', async () => {
  const { auth, accountId, token } = await makeSession();
  const req = { headers: { authorization: `Bearer ${token}` }, body: { userId: 'someone-else-entirely' } };
  const res = fakeRes();
  let nextCalled = false;
  await requireSession(auth)(req, res, () => { nextCalled = true; });
  assert.equal(nextCalled, true);
  assert.equal(req.session.accountId, accountId);
  // Confirms identity comes from the verified session, never from req.body.
  assert.notEqual(req.session.accountId, req.body.userId);
});

test('requireSession rejects a revoked session token', async () => {
  const { auth, accountId, token } = await makeSession();
  const session = await auth.authenticate(token);
  await auth.revokeSessionById(accountId, session.id);
  const req = { headers: { authorization: `Bearer ${token}` } };
  const res = fakeRes();
  let nextCalled = false;
  await requireSession(auth)(req, res, () => { nextCalled = true; });
  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 401);
});

// ---------------------------------------------------------------------
// Stage 34 — a soft-deleted account cannot authenticate normally, even
// with a technically-still-valid (non-revoked) session token. See
// ../src/auth/session-middleware.js's requireSession() comment for why
// revokeAllSessions() alone is not enough (a fresh session minted for
// the same account id after deletion would otherwise sail through).
// ---------------------------------------------------------------------

test('requireSession rejects a session belonging to a soft-deleted account, even though the token itself was never revoked', async () => {
  const { auth, accountId, token } = await makeSession();
  await auth.accounts.softDelete(accountId);
  // Sanity: the token is still a real, non-revoked session at the
  // AuthStore layer -- this is specifically testing the extra check
  // requireSession() adds on top of authenticate().
  assert.ok(await auth.authenticate(token));

  const req = { headers: { authorization: `Bearer ${token}` } };
  const res = fakeRes();
  let nextCalled = false;
  await requireSession(auth)(req, res, () => { nextCalled = true; });
  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 401);
});

test('requireSession still accepts a brand-new session minted for an account that was later soft-deleted -- once deleted, not before', async () => {
  const { auth, accountId, token } = await makeSession();
  const req = { headers: { authorization: `Bearer ${token}` } };
  const res = fakeRes();
  let nextCalled = false;
  await requireSession(auth)(req, res, () => { nextCalled = true; });
  assert.equal(nextCalled, true, 'not yet deleted, so the existing session works normally');
  assert.equal(req.session.accountId, accountId);
});

test('requireSession rejects even a session created for an account AFTER it was soft-deleted (e.g. a re-login attempt via OTP) -- this is the exact gap revokeAllSessions() alone cannot close', async () => {
  const { auth, accountId } = await makeSession();
  await auth.accounts.softDelete(accountId);
  // Simulates AuthStore#findOrCreatePhoneAccount() finding the existing
  // (now-deleted) account id and minting it a fresh session, exactly as
  // a real re-login attempt against a deleted account would.
  const { token: newToken } = await auth.createSession(accountId, { name: 'new-device-after-deletion' });

  const req = { headers: { authorization: `Bearer ${newToken}` } };
  const res = fakeRes();
  let nextCalled = false;
  await requireSession(auth)(req, res, () => { nextCalled = true; });
  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 401);
});

test('assertOwnAccount allows a session to act on its own account only', () => {
  const session = { accountId: 'acc_1' };
  assert.equal(assertOwnAccount(session, 'acc_1'), 'acc_1');
});

test('assertOwnAccount blocks reading another account (e.g. wallet/notifications) even if the client asks for it by id', () => {
  const session = { accountId: 'acc_1' };
  assert.throws(() => assertOwnAccount(session, 'acc_2'), /own account/);
});

test('assertOwnAccount blocks unauthenticated (no session)', () => {
  assert.throws(() => assertOwnAccount(null, 'acc_2'), /authentication required/);
});

test('requireRoomOwner allows the room owner to act', async () => {
  const platform = createPlatform();
  const room = await platform.rooms.create({ ownerId: 'owner_1', name: 'Test Room' });
  const result = await requireRoomOwner(platform.store, room.id, { accountId: 'owner_1' });
  assert.equal(result.id, room.id);
});

test('requireRoomOwner blocks a non-owner from room settings/moderation actions', async () => {
  const platform = createPlatform();
  const room = await platform.rooms.create({ ownerId: 'owner_1', name: 'Test Room' });
  await assert.rejects(() => requireRoomOwner(platform.store, room.id, { accountId: 'intruder' }), /only the room owner/);
});

test('requireRoomOwner 404s for a room that does not exist', async () => {
  const platform = createPlatform();
  await assert.rejects(() => requireRoomOwner(platform.store, 'no_such_room', { accountId: 'owner_1' }), /room not found/);
});

// ---------------------------------------------------------------------
// Stage 19 — Room Game Center authorization: isRoomMember()/
// requireRoomMember(). Distinct from requireRoomOwner() above: a room's
// Game Center is meant for anyone actually in the room, not just its
// owner.
// ---------------------------------------------------------------------

test('isRoomMember is true for the room owner even if they never explicitly joined', async () => {
  const platform = createPlatform();
  const room = await platform.rooms.create({ ownerId: 'owner_1', name: 'Test Room' });
  assert.equal(await isRoomMember(platform.store, room.id, 'owner_1'), true);
});

test('isRoomMember is true for a real Stage 13 joined member who is not the owner', async () => {
  const platform = createPlatform();
  const room = await platform.rooms.create({ ownerId: 'owner_1', name: 'Test Room' });
  await platform.rooms.join(room.id, 'usr_2');
  assert.equal(await isRoomMember(platform.store, room.id, 'usr_2'), true);
});

test('isRoomMember is true for a disconnected (still-resumable) member, false once they actually left', async () => {
  const platform = createPlatform();
  const room = await platform.rooms.create({ ownerId: 'owner_1', name: 'Test Room' });
  await platform.rooms.join(room.id, 'usr_2');
  await platform.rooms.disconnect(room.id, 'usr_2');
  assert.equal(await isRoomMember(platform.store, room.id, 'usr_2'), true, 'a disconnected member can still resume, so still counts as in the room');
  await platform.rooms.reconnect(room.id, 'usr_2');
  await platform.rooms.leave(room.id, 'usr_2');
  assert.equal(await isRoomMember(platform.store, room.id, 'usr_2'), false, 'a member who actually left is no longer in the room');
});

test('isRoomMember is false for a session that never joined and does not own the room', async () => {
  const platform = createPlatform();
  const room = await platform.rooms.create({ ownerId: 'owner_1', name: 'Test Room' });
  assert.equal(await isRoomMember(platform.store, room.id, 'usr_stranger'), false);
});

test('isRoomMember is false for an unknown room', async () => {
  const platform = createPlatform();
  assert.equal(await isRoomMember(platform.store, 'no_such_room', 'anyone'), false);
});

test('requireRoomMember allows the owner and a real joined member, blocks a stranger, 404s an unknown room', async () => {
  const platform = createPlatform();
  const room = await platform.rooms.create({ ownerId: 'owner_1', name: 'Test Room' });
  await platform.rooms.join(room.id, 'usr_2');

  const asOwner = await requireRoomMember(platform.store, room.id, { accountId: 'owner_1' });
  assert.equal(asOwner.id, room.id);
  const asMember = await requireRoomMember(platform.store, room.id, { accountId: 'usr_2' });
  assert.equal(asMember.id, room.id);

  await assert.rejects(() => requireRoomMember(platform.store, room.id, { accountId: 'usr_stranger' }), /member of this room/);
  await assert.rejects(() => requireRoomMember(platform.store, 'no_such_room', { accountId: 'owner_1' }), /room not found/);
  await assert.rejects(() => requireRoomMember(platform.store, room.id, null), /authentication required/);
});
