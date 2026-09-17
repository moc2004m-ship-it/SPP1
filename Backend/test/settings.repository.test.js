'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

const { InMemorySettingsRepository } = require('../src/database/repositories/settings.repository');

const FIXED_NOW = new Date('2026-01-01T00:00:00.000Z');
const LATER = new Date('2026-01-02T00:00:00.000Z');

test('upsert creates a new row for a never-set (userId, key)', async () => {
  const repo = new InMemorySettingsRepository();
  const row = await repo.upsert('usr_a', 'sound', true, FIXED_NOW);
  assert.equal(row.userId, 'usr_a');
  assert.equal(row.key, 'sound');
  assert.equal(row.value, true);
  assert.ok(row.id);
  assert.equal(row.createdAt, FIXED_NOW.toISOString());
  assert.equal(row.updatedAt, FIXED_NOW.toISOString());
});

test('upsert updates the SAME row in place for a repeat (userId, key) -- real update-in-place, not append-only', async () => {
  const repo = new InMemorySettingsRepository();
  const first = await repo.upsert('usr_a', 'sound', true, FIXED_NOW);
  const second = await repo.upsert('usr_a', 'sound', false, LATER);

  assert.equal(second.id, first.id, 'must be the same row, not a new one');
  assert.equal(second.value, false);
  assert.equal(second.createdAt, first.createdAt, 'createdAt is preserved from the original row');
  assert.equal(second.updatedAt, LATER.toISOString());
});

test('no duplicate current rows ever exist for a given user+key after repeated upserts', async () => {
  const repo = new InMemorySettingsRepository();
  await repo.upsert('usr_a', 'sound', true, FIXED_NOW);
  await repo.upsert('usr_a', 'sound', false, FIXED_NOW);
  await repo.upsert('usr_a', 'sound', true, FIXED_NOW);
  const all = await repo.listForUser('usr_a');
  assert.equal(all.filter((r) => r.key === 'sound').length, 1);
});

test('get returns the current row for a (userId, key)', async () => {
  const repo = new InMemorySettingsRepository();
  await repo.upsert('usr_a', 'mic', true, FIXED_NOW);
  const row = await repo.get('usr_a', 'mic');
  assert.equal(row.value, true);
});

test('get returns null for a (userId, key) never set', async () => {
  const repo = new InMemorySettingsRepository();
  assert.equal(await repo.get('usr_a', 'mic'), null);
});

test('listForUser returns every key set for that user', async () => {
  const repo = new InMemorySettingsRepository();
  await repo.upsert('usr_a', 'sound', true, FIXED_NOW);
  await repo.upsert('usr_a', 'mic', false, FIXED_NOW);
  const rows = await repo.listForUser('usr_a');
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((r) => r.key).sort(), ['mic', 'sound']);
});

test('user isolation -- one user\'s rows never leak into another\'s listForUser', async () => {
  const repo = new InMemorySettingsRepository();
  await repo.upsert('usr_a', 'sound', true, FIXED_NOW);
  await repo.upsert('usr_b', 'sound', false, FIXED_NOW);

  const aRows = await repo.listForUser('usr_a');
  const bRows = await repo.listForUser('usr_b');
  assert.equal(aRows.length, 1);
  assert.equal(bRows.length, 1);
  assert.equal(aRows[0].value, true);
  assert.equal(bRows[0].value, false);
});

test('user isolation -- get() for one user never returns another user\'s row for the same key', async () => {
  const repo = new InMemorySettingsRepository();
  await repo.upsert('usr_a', 'sound', true, FIXED_NOW);
  assert.equal(await repo.get('usr_b', 'sound'), null);
});

// --- Postgres query contract (matches schema/025_create_settings.sql) ---
// Same "assert the SQL shape without a live database" style as
// notification.repository.js's own contract tests -- confirms the real
// upsert-in-place ON CONFLICT clause and column list, not just that a
// query method exists.

test('PostgresSettingsRepository.upsert issues a real ON CONFLICT (user_id, key) upsert, not an append-only INSERT', async () => {
  const { PostgresSettingsRepository } = require('../src/database/repositories/settings.repository');
  let capturedSql = null;
  let capturedParams = null;
  const fakePool = {
    async query(sql, params) {
      capturedSql = sql;
      capturedParams = params;
      return { rows: [{ id: 'set_1', user_id: 'usr_a', key: 'sound', value: 'true', created_at: FIXED_NOW, updated_at: FIXED_NOW }] };
    },
  };
  const repo = new PostgresSettingsRepository(fakePool);
  await repo.upsert('usr_a', 'sound', true, FIXED_NOW);

  assert.match(capturedSql, /INSERT INTO settings/);
  assert.match(capturedSql, /ON CONFLICT \(user_id, key\) DO UPDATE/);
  assert.deepEqual(capturedParams.slice(1, 3), ['usr_a', 'sound']);
});

test('PostgresSettingsRepository.get / listForUser scope their WHERE clause to the given userId', async () => {
  const { PostgresSettingsRepository } = require('../src/database/repositories/settings.repository');
  const calls = [];
  const fakePool = {
    async query(sql, params) {
      calls.push({ sql, params });
      return { rows: [] };
    },
  };
  const repo = new PostgresSettingsRepository(fakePool);
  await repo.get('usr_a', 'sound');
  await repo.listForUser('usr_a');

  assert.match(calls[0].sql, /WHERE user_id = \$1 AND key = \$2/);
  assert.deepEqual(calls[0].params, ['usr_a', 'sound']);
  assert.match(calls[1].sql, /WHERE user_id = \$1/);
  assert.deepEqual(calls[1].params, ['usr_a']);
});
