const test = require('node:test');
const assert = require('node:assert/strict');

const { createReference, transitionReferenceStatus } = require('../src/database/models/reference.model');
const { InMemoryReferenceRepository } = require('../src/database/repositories/reference.repository');
const { isReferenceId } = require('../src/database/id-generator');

test('createReference requires a type', () => {
  assert.throws(() => createReference({}));
});

test('createReference generates a server-side reference id and starts pending', () => {
  const ref = createReference({ type: 'generic-test' });
  assert.ok(isReferenceId(ref.id));
  assert.equal(ref.status, 'pending');
});

test('transitionReferenceStatus rejects an invalid status', () => {
  const ref = createReference({ type: 'generic-test' });
  assert.throws(() => transitionReferenceStatus(ref, 'not-a-real-status'));
});

test('transitionReferenceStatus moves to a valid status', () => {
  const ref = createReference({ type: 'generic-test' });
  const updated = transitionReferenceStatus(ref, 'completed');
  assert.equal(updated.status, 'completed');
  assert.equal(updated.id, ref.id);
});

test('repository create/find/updateStatus round-trip', async () => {
  const repo = new InMemoryReferenceRepository();
  const created = await repo.create({ type: 'generic-test', userId: 'usr_abc' });
  const found = await repo.findById(created.id);
  assert.deepEqual(found, created);

  const updated = await repo.updateStatus(created.id, 'failed');
  assert.equal(updated.status, 'failed');

  const byUser = await repo.listByUserId('usr_abc');
  assert.equal(byUser.length, 1);
  assert.equal(byUser[0].id, created.id);
});

test('updateStatus on an unknown id returns null', async () => {
  const repo = new InMemoryReferenceRepository();
  const result = await repo.updateStatus('txn_missing', 'completed');
  assert.equal(result, null);
});
