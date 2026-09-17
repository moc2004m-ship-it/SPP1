'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { InMemoryAuditLogRepository } = require('../src/database/repositories/audit-log.repository');

test('record() rejects a missing actorId', async () => {
  const repo = new InMemoryAuditLogRepository();
  await assert.rejects(
    () => repo.record({ action: 'account:suspend', targetType: 'account', targetId: 'usr_1' }),
    (err) => err.status === 400
  );
});

test('record() rejects a missing action', async () => {
  const repo = new InMemoryAuditLogRepository();
  await assert.rejects(
    () => repo.record({ actorId: 'staff_1', targetType: 'account', targetId: 'usr_1' }),
    (err) => err.status === 400
  );
});

test('record() rejects a missing targetType/targetId', async () => {
  const repo = new InMemoryAuditLogRepository();
  await assert.rejects(
    () => repo.record({ actorId: 'staff_1', action: 'account:suspend', targetId: 'usr_1' }),
    (err) => err.status === 400
  );
  await assert.rejects(
    () => repo.record({ actorId: 'staff_1', action: 'account:suspend', targetType: 'account' }),
    (err) => err.status === 400
  );
});

test('record() creates a real, server-generated, immutable entry', async () => {
  const repo = new InMemoryAuditLogRepository();
  const entry = await repo.record({
    actorId: 'staff_1',
    action: 'account:suspend',
    targetType: 'account',
    targetId: 'usr_1',
    reason: 'fraud',
    metadata: { note: 'second offense' },
  });

  assert.ok(entry.id.startsWith('audit_'));
  assert.equal(entry.actorId, 'staff_1');
  assert.equal(entry.action, 'account:suspend');
  assert.equal(entry.targetType, 'account');
  assert.equal(entry.targetId, 'usr_1');
  assert.equal(entry.reason, 'fraud');
  assert.deepEqual(entry.metadata, { note: 'second offense' });
  assert.equal(typeof entry.createdAt, 'string');
  assert.ok(Object.isFrozen(entry));
});

test('record() defaults reason to null and metadata to {} when omitted', async () => {
  const repo = new InMemoryAuditLogRepository();
  const entry = await repo.record({
    actorId: 'staff_1',
    action: 'inventory:grant',
    targetType: 'inventory_item',
    targetId: 'item_1',
  });
  assert.equal(entry.reason, null);
  assert.deepEqual(entry.metadata, {});
});

test('list() returns newest-first', async () => {
  const repo = new InMemoryAuditLogRepository();
  const first = await repo.record({ actorId: 's1', action: 'a', targetType: 't', targetId: '1' });
  const second = await repo.record({ actorId: 's1', action: 'a', targetType: 't', targetId: '2' });
  const results = await repo.list();
  assert.deepEqual(results.map((e) => e.id), [second.id, first.id]);
});

test('list() filters by actorId/action/targetType/targetId', async () => {
  const repo = new InMemoryAuditLogRepository();
  await repo.record({ actorId: 's1', action: 'account:suspend', targetType: 'account', targetId: 'usr_1' });
  await repo.record({ actorId: 's2', action: 'inventory:grant', targetType: 'inventory_item', targetId: 'item_1' });
  await repo.record({ actorId: 's1', action: 'inventory:grant', targetType: 'inventory_item', targetId: 'item_2' });

  assert.equal((await repo.list({ actorId: 's1' })).length, 2);
  assert.equal((await repo.list({ action: 'inventory:grant' })).length, 2);
  assert.equal((await repo.list({ targetType: 'account' })).length, 1);
  assert.equal((await repo.list({ targetId: 'item_2' })).length, 1);
  assert.equal((await repo.list({ actorId: 's1', action: 'inventory:grant' })).length, 1);
});

test('list() respects limit', async () => {
  const repo = new InMemoryAuditLogRepository();
  for (let i = 0; i < 5; i += 1) {
    await repo.record({ actorId: 's1', action: 'a', targetType: 't', targetId: String(i) });
  }
  const results = await repo.list({ limit: 2 });
  assert.equal(results.length, 2);
});

test('list() returns an empty array when nothing matches', async () => {
  const repo = new InMemoryAuditLogRepository();
  await repo.record({ actorId: 's1', action: 'a', targetType: 't', targetId: '1' });
  assert.deepEqual(await repo.list({ actorId: 'nobody' }), []);
});

test('the log is append-only: no update/delete method exists', () => {
  const repo = new InMemoryAuditLogRepository();
  assert.equal(typeof repo.update, 'undefined');
  assert.equal(typeof repo.delete, 'undefined');
  assert.equal(typeof repo.remove, 'undefined');
});
