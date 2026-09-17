'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { InMemoryFeatureRecordRepository } = require('../src/database/repositories/feature-record.repository');

// NOTE ON SCOPE: same as wallet.repository.test.js -- these exercise
// InMemoryFeatureRecordRepository, the implementation actually active in
// this sandbox. PostgresFeatureRecordRepository targets the identical
// add(stage, item)/list(stage) contract against real SQL (see
// src/database/schema/004_create_feature_records.sql) but has not been run
// against a live database here -- no network access (see PHASE2 report).

test('add() stores a record and list() returns it back for the same stage', async () => {
  const repo = new InMemoryFeatureRecordRepository();
  const record = { id: 's12_1', ownerId: 'usr_1', name: 'Room' };
  await repo.add(12, record);
  const rooms = await repo.list(12);
  assert.equal(rooms.length, 1);
  assert.deepEqual(rooms[0], record);
});

test('records are isolated per stage number', async () => {
  const repo = new InMemoryFeatureRecordRepository();
  await repo.add(12, { id: 'room_1' });
  await repo.add(18, { id: 'battle_1' });
  assert.equal((await repo.list(12)).length, 1);
  assert.equal((await repo.list(18)).length, 1);
  assert.equal((await repo.list(19)).length, 0);
});

test('list() on a stage with no records returns an empty array, not undefined', async () => {
  const repo = new InMemoryFeatureRecordRepository();
  assert.deepEqual(await repo.list(99), []);
});

test('multiple adds to the same stage preserve insertion order', async () => {
  const repo = new InMemoryFeatureRecordRepository();
  await repo.add(31, { id: 'evt_1' });
  await repo.add(31, { id: 'evt_2' });
  await repo.add(31, { id: 'evt_3' });
  const events = await repo.list(31);
  assert.deepEqual(events.map((e) => e.id), ['evt_1', 'evt_2', 'evt_3']);
});

// Phase 6 -- update() is the new in-place-mutation primitive real state
// transitions (accept/reject, mute, kick, referral) are built on.

test('update() shallow-merges a patch onto an existing record and returns it', async () => {
  const repo = new InMemoryFeatureRecordRepository();
  await repo.add(10, { id: 'req_1', status: 'pending', userId: 'usr_1' });
  const updated = await repo.update(10, 'req_1', { status: 'accepted' });
  assert.equal(updated.status, 'accepted');
  assert.equal(updated.userId, 'usr_1'); // untouched fields survive
  assert.equal(updated.id, 'req_1');
});

test('update() returns null (not throw) when the record does not exist, so the caller decides on 404', async () => {
  const repo = new InMemoryFeatureRecordRepository();
  const result = await repo.update(10, 'missing', { status: 'accepted' });
  assert.equal(result, null);
});

test('update() cannot be tricked into overwriting the record id via the patch', async () => {
  const repo = new InMemoryFeatureRecordRepository();
  await repo.add(10, { id: 'req_1', status: 'pending' });
  const updated = await repo.update(10, 'req_1', { id: 'req_hijacked', status: 'accepted' });
  assert.equal(updated.id, 'req_1');
});

test('update() always refreshes updatedAt, even if the patch tries to set its own', async () => {
  const repo = new InMemoryFeatureRecordRepository();
  await repo.add(10, { id: 'req_1', status: 'pending' });
  const before = Date.now();
  const updated = await repo.update(10, 'req_1', { status: 'accepted', updatedAt: 'stale-fake-value' });
  assert.notEqual(updated.updatedAt, 'stale-fake-value');
  assert.ok(new Date(updated.updatedAt).getTime() >= before);
});

test('update() mutates the record in place: a later list() reflects the patch, not the original add()', async () => {
  const repo = new InMemoryFeatureRecordRepository();
  await repo.add(12, { id: 'room_1', name: 'Original' });
  await repo.update(12, 'room_1', { name: 'Renamed' });
  const rooms = await repo.list(12);
  assert.equal(rooms.length, 1); // in-place update, not a duplicate append
  assert.equal(rooms[0].name, 'Renamed');
});
