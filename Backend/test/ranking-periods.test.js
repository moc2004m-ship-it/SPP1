'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { PERIODS, assertValidPeriod, periodStart } = require('../src/domain/ranking-periods');

test('PERIODS lists exactly the four supported periods', () => {
  assert.deepEqual(PERIODS, ['daily', 'weekly', 'monthly', 'all']);
});

test('assertValidPeriod accepts every listed period and rejects anything else', () => {
  for (const p of PERIODS) assert.doesNotThrow(() => assertValidPeriod(p));
  assert.throws(() => assertValidPeriod('yearly'), (e) => e.status === 400);
  assert.throws(() => assertValidPeriod(''), (e) => e.status === 400);
  assert.throws(() => assertValidPeriod(undefined), (e) => e.status === 400);
});

test("periodStart('daily') returns UTC midnight of the same day, regardless of time-of-day", () => {
  const now = new Date('2026-09-14T23:59:59.000Z');
  const start = periodStart('daily', now);
  assert.equal(start.toISOString(), '2026-09-14T00:00:00.000Z');
});

test("periodStart('weekly') returns the Monday of the current ISO week in UTC", () => {
  // 2026-09-14 is a Monday.
  const monday = periodStart('weekly', new Date('2026-09-14T05:00:00.000Z'));
  assert.equal(monday.toISOString(), '2026-09-14T00:00:00.000Z');

  // 2026-09-17 is a Thursday -- same week, same Monday boundary.
  const thursday = periodStart('weekly', new Date('2026-09-17T12:00:00.000Z'));
  assert.equal(thursday.toISOString(), '2026-09-14T00:00:00.000Z');

  // 2026-09-13 is a Sunday -- the trickiest case (getUTCDay() === 0), must
  // resolve to the Monday of the PREVIOUS week, not the coming one.
  const sunday = periodStart('weekly', new Date('2026-09-13T23:00:00.000Z'));
  assert.equal(sunday.toISOString(), '2026-09-07T00:00:00.000Z');
});

test("periodStart('monthly') returns the first day of the current UTC month", () => {
  const start = periodStart('monthly', new Date('2026-09-14T23:59:59.000Z'));
  assert.equal(start.toISOString(), '2026-09-01T00:00:00.000Z');
});

test("periodStart('all') returns null (no lower bound)", () => {
  assert.equal(periodStart('all', new Date('2026-09-14T00:00:00.000Z')), null);
});

test('periodStart rejects an invalid period the same way assertValidPeriod does', () => {
  assert.throws(() => periodStart('century', new Date()), (e) => e.status === 400);
});

test('periodStart defaults `now` to the real current time when omitted', () => {
  const before = Date.now();
  const start = periodStart('daily');
  const after = Date.now();
  assert.ok(start.getTime() <= before && start.getTime() <= after, 'start-of-today must not be in the future');
});
