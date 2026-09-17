'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { EVENTS_CATALOG, findEvent, findMission, statusOf } = require('../src/domain/events-catalog');

test('EVENTS_CATALOG is a real, non-empty, frozen catalog', () => {
  assert.ok(Array.isArray(EVENTS_CATALOG));
  assert.ok(EVENTS_CATALOG.length >= 2);
  assert.ok(Object.isFrozen(EVENTS_CATALOG));
  for (const event of EVENTS_CATALOG) {
    assert.ok(Object.isFrozen(event), `${event.id} must be frozen`);
    assert.ok(Object.isFrozen(event.missions), `${event.id}.missions must be frozen`);
    for (const mission of event.missions) {
      assert.ok(Object.isFrozen(mission), `${event.id}/${mission.key} must be frozen`);
      assert.ok(['gift_sent', 'gift_received', 'share'].includes(mission.type));
      assert.ok(Number.isInteger(mission.targetCount) && mission.targetCount > 0);
      assert.ok(Number.isInteger(mission.rewardCoins) && mission.rewardCoins > 0);
    }
  }
});

test('findEvent returns the matching catalog entry', () => {
  const event = findEvent('evt_autumn_gifting');
  assert.equal(event.id, 'evt_autumn_gifting');
});

test('findEvent throws 404 for an unknown eventId', () => {
  assert.throws(() => findEvent('evt_does_not_exist'), (e) => e.status === 404);
});

test('findMission returns the matching mission within an event', () => {
  const event = findEvent('evt_autumn_gifting');
  const mission = findMission(event, 'share_the_event');
  assert.equal(mission.key, 'share_the_event');
});

test('findMission throws 404 for an unknown missionKey within a valid event', () => {
  const event = findEvent('evt_autumn_gifting');
  assert.throws(() => findMission(event, 'does_not_exist'), (e) => e.status === 404);
});

// --- statusOf: real timestamp comparisons, no stored/stale status field ---

test('statusOf returns "upcoming" before startAt', () => {
  const event = findEvent('evt_autumn_gifting'); // startAt 2026-09-08
  assert.equal(statusOf(event, new Date('2026-09-01T00:00:00.000Z')), 'upcoming');
});

test('statusOf returns "active" at exactly startAt and up to (not including) endAt', () => {
  const event = findEvent('evt_autumn_gifting'); // 2026-09-08 .. 2026-09-22
  assert.equal(statusOf(event, new Date('2026-09-08T00:00:00.000Z')), 'active', 'inclusive at startAt');
  assert.equal(statusOf(event, new Date('2026-09-15T00:00:00.000Z')), 'active', 'mid-event');
  assert.equal(statusOf(event, new Date('2026-09-21T23:59:59.999Z')), 'active', 'one ms before endAt');
});

test('statusOf returns "ended" at exactly endAt and after (endAt is exclusive of "active")', () => {
  const event = findEvent('evt_autumn_gifting');
  assert.equal(statusOf(event, new Date('2026-09-22T00:00:00.000Z')), 'ended', 'exactly at endAt');
  assert.equal(statusOf(event, new Date('2030-01-01T00:00:00.000Z')), 'ended', 'long after');
});
