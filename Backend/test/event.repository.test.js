'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { InMemoryEventRepository } = require('../src/database/repositories/event.repository');

function setup() {
  return new InMemoryEventRepository();
}

// ---------------------------------------------------------------------
// getProgress / upsertProgress
// ---------------------------------------------------------------------

test('getProgress returns null when no progress row exists yet', async () => {
  const repo = setup();
  const progress = await repo.getProgress('evt_a', 'mission_a', 'usr_1');
  assert.equal(progress, null);
});

test('upsertProgress creates a new row on first call, with claimedAt null', async () => {
  const repo = setup();
  const row = await repo.upsertProgress({ eventId: 'evt_a', missionKey: 'mission_a', accountId: 'usr_1', progress: 3, completed: false });
  assert.ok(row.id);
  assert.match(row.id, /^eprog_/);
  assert.equal(row.progress, 3);
  assert.equal(row.completed, false);
  assert.equal(row.claimedAt, null);
});

test('upsertProgress updates the SAME row in place on subsequent calls (never a second row)', async () => {
  const repo = setup();
  const first = await repo.upsertProgress({ eventId: 'evt_a', missionKey: 'mission_a', accountId: 'usr_1', progress: 3, completed: false });
  const second = await repo.upsertProgress({ eventId: 'evt_a', missionKey: 'mission_a', accountId: 'usr_1', progress: 7, completed: false });
  assert.equal(second.id, first.id, 'must be the same row, not a new one');
  assert.equal(second.progress, 7);

  const fetched = await repo.getProgress('evt_a', 'mission_a', 'usr_1');
  assert.equal(fetched.progress, 7);
});

test('progress rows are isolated per (eventId, missionKey, accountId)', async () => {
  const repo = setup();
  await repo.upsertProgress({ eventId: 'evt_a', missionKey: 'mission_a', accountId: 'usr_1', progress: 5, completed: false });
  await repo.upsertProgress({ eventId: 'evt_a', missionKey: 'mission_b', accountId: 'usr_1', progress: 1, completed: false });
  await repo.upsertProgress({ eventId: 'evt_b', missionKey: 'mission_a', accountId: 'usr_1', progress: 9, completed: false });
  await repo.upsertProgress({ eventId: 'evt_a', missionKey: 'mission_a', accountId: 'usr_2', progress: 2, completed: false });

  assert.equal((await repo.getProgress('evt_a', 'mission_a', 'usr_1')).progress, 5);
  assert.equal((await repo.getProgress('evt_a', 'mission_b', 'usr_1')).progress, 1);
  assert.equal((await repo.getProgress('evt_b', 'mission_a', 'usr_1')).progress, 9);
  assert.equal((await repo.getProgress('evt_a', 'mission_a', 'usr_2')).progress, 2);
});

test('listProgressForEvent returns only rows for that event and account', async () => {
  const repo = setup();
  await repo.upsertProgress({ eventId: 'evt_a', missionKey: 'mission_a', accountId: 'usr_1', progress: 1, completed: false });
  await repo.upsertProgress({ eventId: 'evt_a', missionKey: 'mission_b', accountId: 'usr_1', progress: 2, completed: false });
  await repo.upsertProgress({ eventId: 'evt_b', missionKey: 'mission_a', accountId: 'usr_1', progress: 3, completed: false });
  await repo.upsertProgress({ eventId: 'evt_a', missionKey: 'mission_a', accountId: 'usr_2', progress: 4, completed: false });

  const rows = await repo.listProgressForEvent('evt_a', 'usr_1');
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((r) => r.missionKey).sort(), ['mission_a', 'mission_b']);
});

// ---------------------------------------------------------------------
// markClaimed
// ---------------------------------------------------------------------

test('markClaimed throws 404 when no progress row exists yet', async () => {
  const repo = setup();
  await assert.rejects(() => repo.markClaimed('evt_a', 'mission_a', 'usr_1'), (e) => e.status === 404);
});

test('markClaimed sets claimedAt exactly once and returns the updated row', async () => {
  const repo = setup();
  await repo.upsertProgress({ eventId: 'evt_a', missionKey: 'mission_a', accountId: 'usr_1', progress: 10, completed: true });
  const claimed = await repo.markClaimed('evt_a', 'mission_a', 'usr_1');
  assert.ok(claimed.claimedAt, 'claimedAt must be set');

  const fetched = await repo.getProgress('evt_a', 'mission_a', 'usr_1');
  assert.equal(fetched.claimedAt, claimed.claimedAt);
});

test('markClaimed throws 409 on a second claim of the same mission (never double-pays)', async () => {
  const repo = setup();
  await repo.upsertProgress({ eventId: 'evt_a', missionKey: 'mission_a', accountId: 'usr_1', progress: 10, completed: true });
  await repo.markClaimed('evt_a', 'mission_a', 'usr_1');
  await assert.rejects(() => repo.markClaimed('evt_a', 'mission_a', 'usr_1'), (e) => e.status === 409);
});

test('markClaimed never unsets or overwrites an existing claimedAt (checked via the 409 path)', async () => {
  const repo = setup();
  await repo.upsertProgress({ eventId: 'evt_a', missionKey: 'mission_a', accountId: 'usr_1', progress: 10, completed: true });
  const first = await repo.markClaimed('evt_a', 'mission_a', 'usr_1');
  await assert.rejects(() => repo.markClaimed('evt_a', 'mission_a', 'usr_1'), (e) => e.status === 409);
  const fetched = await repo.getProgress('evt_a', 'mission_a', 'usr_1');
  assert.equal(fetched.claimedAt, first.claimedAt, 'claimedAt must be unchanged after a rejected second claim');
});

// ---------------------------------------------------------------------
// listClaimsForAccount
// ---------------------------------------------------------------------

test('listClaimsForAccount returns only claimed rows, most recent first', async () => {
  const repo = setup();
  await repo.upsertProgress({ eventId: 'evt_a', missionKey: 'mission_a', accountId: 'usr_1', progress: 10, completed: true });
  await repo.upsertProgress({ eventId: 'evt_a', missionKey: 'mission_b', accountId: 'usr_1', progress: 5, completed: false }); // never claimed
  await repo.upsertProgress({ eventId: 'evt_b', missionKey: 'mission_a', accountId: 'usr_1', progress: 10, completed: true });

  await repo.markClaimed('evt_a', 'mission_a', 'usr_1');
  await repo.markClaimed('evt_b', 'mission_a', 'usr_1');

  const claims = await repo.listClaimsForAccount('usr_1');
  assert.equal(claims.length, 2, 'the never-claimed mission_b row must be excluded');
  assert.ok(claims.every((c) => c.claimedAt), 'every returned row must actually be claimed');
  // most-recent-first: the second markClaimed() call (evt_b) must sort before the first (evt_a).
  assert.equal(claims[0].eventId, 'evt_b');
  assert.equal(claims[1].eventId, 'evt_a');
});

test('listClaimsForAccount never mixes in another account\'s claims', async () => {
  const repo = setup();
  await repo.upsertProgress({ eventId: 'evt_a', missionKey: 'mission_a', accountId: 'usr_1', progress: 10, completed: true });
  await repo.upsertProgress({ eventId: 'evt_a', missionKey: 'mission_a', accountId: 'usr_2', progress: 10, completed: true });
  await repo.markClaimed('evt_a', 'mission_a', 'usr_1');
  await repo.markClaimed('evt_a', 'mission_a', 'usr_2');

  const claims = await repo.listClaimsForAccount('usr_1');
  assert.equal(claims.length, 1);
  assert.equal(claims[0].accountId, 'usr_1');
});

// ---------------------------------------------------------------------
// recordShare / countShares
// ---------------------------------------------------------------------

test('recordShare persists a real, timestamped, non-deduplicated row', async () => {
  const repo = setup();
  const share = await repo.recordShare({ eventId: 'evt_a', accountId: 'usr_1' });
  assert.ok(share.id);
  assert.match(share.id, /^esh_/);
  assert.ok(share.createdAt);
});

test('countShares counts every share for that (eventId, accountId), including repeats', async () => {
  const repo = setup();
  await repo.recordShare({ eventId: 'evt_a', accountId: 'usr_1' });
  await repo.recordShare({ eventId: 'evt_a', accountId: 'usr_1' }); // a real account CAN share twice
  await repo.recordShare({ eventId: 'evt_a', accountId: 'usr_2' }); // different account, must not count
  await repo.recordShare({ eventId: 'evt_b', accountId: 'usr_1' }); // different event, must not count

  assert.equal(await repo.countShares('evt_a', 'usr_1'), 2);
  assert.equal(await repo.countShares('evt_a', 'usr_2'), 1);
  assert.equal(await repo.countShares('evt_b', 'usr_1'), 1);
  assert.equal(await repo.countShares('evt_c', 'usr_1'), 0);
});
