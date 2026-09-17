'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

const { InMemorySettingsRepository } = require('../src/database/repositories/settings.repository');
const { InMemoryAccountRepository } = require('../src/database/repositories/account.repository');
const { AuthStore } = require('../src/auth/auth.store');
const { createSettingsService } = require('../src/services/settings.service');
const { DEFAULT_SETTINGS } = require('../src/database/models/settings.model');
const { TERMS_CONTENT, HELP_CONTENT } = require('../src/domain/legal-content');

const FIXED_NOW = () => new Date('2026-01-01T00:00:00.000Z');

async function setup({ now = FIXED_NOW } = {}) {
  const settings = new InMemorySettingsRepository();
  const accounts = new InMemoryAccountRepository();
  const authStore = new AuthStore(accounts);
  const service = createSettingsService({ settings, accounts, authStore, now });
  const account = await accounts.create();
  return { service, settings, accounts, authStore, accountId: account.id };
}

test('createSettingsService requires settings/accounts/authStore', () => {
  const settings = new InMemorySettingsRepository();
  const accounts = new InMemoryAccountRepository();
  const authStore = new AuthStore(accounts);
  assert.throws(() => createSettingsService({ accounts, authStore }), /settings repository is required/);
  assert.throws(() => createSettingsService({ settings, authStore }), /accounts repository is required/);
  assert.throws(() => createSettingsService({ settings, accounts }), /authStore is required/);
});

// --- get() / set() ownership ------------------------------------------

test('an authenticated user can read their own settings', async () => {
  const { service, accountId } = await setup();
  const result = await service.get(accountId, accountId);
  assert.deepEqual(result, DEFAULT_SETTINGS);
});

test('an authenticated user can update their own settings', async () => {
  const { service, accountId } = await setup();
  const result = await service.set(accountId, accountId, 'sound', false);
  assert.equal(result.key, 'sound');
  assert.equal(result.value, false);
});

test('cannot read another user\'s settings (403)', async () => {
  const { service, accounts } = await setup();
  const victim = await accounts.create();
  const attacker = await accounts.create();
  await assert.rejects(
    () => service.get(attacker.id, victim.id),
    (e) => e.status === 403
  );
});

test('cannot modify another user\'s settings (403)', async () => {
  const { service, accounts } = await setup();
  const victim = await accounts.create();
  const attacker = await accounts.create();
  await assert.rejects(
    () => service.set(attacker.id, victim.id, 'sound', false),
    (e) => e.status === 403
  );
});

test('get() requires authentication (403 with no actingAccountId)', async () => {
  const { service, accountId } = await setup();
  await assert.rejects(() => service.get(null, accountId), (e) => e.status === 403);
});

test('set() requires authentication (403 with no actingAccountId)', async () => {
  const { service, accountId } = await setup();
  await assert.rejects(() => service.set(null, accountId, 'sound', true), (e) => e.status === 403);
});

// --- defaults / persistence --------------------------------------------

test('defaults are returned for every key never explicitly set', async () => {
  const { service, accountId } = await setup();
  const result = await service.get(accountId, accountId);
  assert.deepEqual(result, DEFAULT_SETTINGS);
});

test('an update persists and is reflected by a later get()', async () => {
  const { service, accountId } = await setup();
  await service.set(accountId, accountId, 'language', 'en');
  await service.set(accountId, accountId, 'mic', true);
  const result = await service.get(accountId, accountId);
  assert.equal(result.language, 'en');
  assert.equal(result.mic, true);
  // Untouched keys still fall back to their real default.
  assert.equal(result.sound, DEFAULT_SETTINGS.sound);
  assert.equal(result.network, DEFAULT_SETTINGS.network);
  assert.equal(result.media, DEFAULT_SETTINGS.media);
});

test('set() twice for the same key updates in place -- get() reflects only the latest value', async () => {
  const { service, accountId } = await setup();
  await service.set(accountId, accountId, 'sound', true);
  await service.set(accountId, accountId, 'sound', false);
  const result = await service.get(accountId, accountId);
  assert.equal(result.sound, false);
});

// --- validation ----------------------------------------------------------

test('set() rejects an unknown key', async () => {
  const { service, accountId } = await setup();
  await assert.rejects(
    () => service.set(accountId, accountId, 'not_a_real_key', true),
    (e) => e.status === 400
  );
});

test('set() rejects an invalid value for a known key', async () => {
  const { service, accountId } = await setup();
  await assert.rejects(
    () => service.set(accountId, accountId, 'language', 'klingon'),
    (e) => e.status === 400
  );
  await assert.rejects(
    () => service.set(accountId, accountId, 'sound', 'not-a-boolean'),
    (e) => e.status === 400
  );
});

test('set() rejects a missing key', async () => {
  const { service, accountId } = await setup();
  await assert.rejects(
    () => service.set(accountId, accountId, '', true),
    (e) => e.status === 400
  );
});

// --- deleteAccount() ------------------------------------------------------

test('deleteAccount soft-deletes the account and sets deletedAt', async () => {
  const { service, accounts, accountId } = await setup();
  const result = await service.deleteAccount(accountId);
  assert.equal(result.accountId, accountId);
  assert.ok(result.deletedAt);
  const account = await accounts.findById(accountId);
  assert.ok(account.deletedAt);
});

test('deleteAccount revokes every active session for that account', async () => {
  const { service, authStore, accountId } = await setup();
  const s1 = await authStore.createSession(accountId, { name: 'phone' });
  const s2 = await authStore.createSession(accountId, { name: 'tablet' });
  const result = await service.deleteAccount(accountId);
  assert.equal(result.sessionsRevoked, 2);
  assert.equal(await authStore.authenticate(s1.token), null);
  assert.equal(await authStore.authenticate(s2.token), null);
});

test('deleteAccount requires authentication', async () => {
  const { service } = await setup();
  await assert.rejects(() => service.deleteAccount(null), (e) => e.status === 403);
});

test('deleteAccount is idempotent -- calling it twice is a real no-op the second time (0 sessions revoked)', async () => {
  const { service, authStore, accountId } = await setup();
  authStore.createSession(accountId, { name: 'phone' });
  const first = await service.deleteAccount(accountId);
  const second = await service.deleteAccount(accountId);
  assert.equal(first.sessionsRevoked, 1);
  assert.equal(second.sessionsRevoked, 0);
  assert.equal(second.deletedAt, first.deletedAt);
});

test('deleteAccount does not destroy unrelated data -- other stored settings for the account remain in place', async () => {
  const { service, settings, accountId } = await setup();
  await service.set(accountId, accountId, 'sound', false);
  await service.deleteAccount(accountId);
  const rows = await settings.listForUser(accountId);
  assert.equal(rows.length, 1, 'settings rows for the now-deleted account are left in place, not purged');
});

// --- Terms / Help ----------------------------------------------------------

test('getTerms returns real, deterministic, server-served content', async () => {
  const { service } = await setup();
  const a = service.getTerms();
  const b = service.getTerms();
  assert.deepEqual(a, TERMS_CONTENT);
  assert.deepEqual(a, b, 'deterministic -- same content every call');
});

test('getHelp returns real, deterministic, server-served content', async () => {
  const { service } = await setup();
  const a = service.getHelp();
  const b = service.getHelp();
  assert.deepEqual(a, HELP_CONTENT);
  assert.deepEqual(a, b);
});
