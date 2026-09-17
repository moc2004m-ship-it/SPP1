'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createRateLimiter, otpRequestLimiter } = require('../src/security/rate-limit');
const { securityHeaders } = require('../src/security/headers');

function mockRes() {
  const res = {
    statusCode: 200,
    headers: {},
    body: undefined,
    status(code) { this.statusCode = code; return this; },
    set(name, value) { this.headers[name] = value; return this; },
    json(payload) { this.body = payload; return this; },
  };
  return res;
}

test('rate limiter allows requests under the max within the window', () => {
  const limit = createRateLimiter({ windowMs: 1000, max: 3, keyFn: () => 'k' });
  const req = {};
  let calls = 0;
  for (let i = 0; i < 3; i += 1) {
    const res = mockRes();
    limit(req, res, () => { calls += 1; });
    assert.equal(res.statusCode, 200);
  }
  assert.equal(calls, 3);
});

test('rate limiter blocks with 429 once max is exceeded for the same key', () => {
  const limit = createRateLimiter({ windowMs: 60_000, max: 2, keyFn: () => 'same-key' });
  const req = {};
  for (let i = 0; i < 2; i += 1) limit(req, mockRes(), () => {});
  const res = mockRes();
  let nextCalled = false;
  limit(req, res, () => { nextCalled = true; });
  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 429);
  assert.equal(res.body.error, 'too_many_requests');
  assert.ok(res.headers['Retry-After']);
});

test('rate limiter tracks distinct keys independently', () => {
  const limit = createRateLimiter({ windowMs: 60_000, max: 1, keyFn: (req) => req.key });
  const resA1 = mockRes();
  limit({ key: 'a' }, resA1, () => {});
  const resB1 = mockRes();
  limit({ key: 'b' }, resB1, () => {});
  assert.equal(resA1.statusCode, 200);
  assert.equal(resB1.statusCode, 200);
  const resA2 = mockRes();
  limit({ key: 'a' }, resA2, () => {});
  assert.equal(resA2.statusCode, 429);
});

test('otpRequestLimiter keys by ip+phone so two phones from one ip do not share a budget', () => {
  const limit = otpRequestLimiter({ windowMs: 60_000, max: 1 });
  const resA = mockRes();
  limit({ ip: '1.2.3.4', body: { phone: '+10000000001' } }, resA, () => {});
  const resB = mockRes();
  limit({ ip: '1.2.3.4', body: { phone: '+10000000002' } }, resB, () => {});
  assert.equal(resA.statusCode, 200);
  assert.equal(resB.statusCode, 200);
});

test('otpRequestLimiter blocks a second request for the same ip+phone within the window', () => {
  const limit = otpRequestLimiter({ windowMs: 60_000, max: 1 });
  const req = { ip: '1.2.3.4', body: { phone: '+10000000001' } };
  limit(req, mockRes(), () => {});
  const res2 = mockRes();
  let nextCalled = false;
  limit(req, res2, () => { nextCalled = true; });
  assert.equal(nextCalled, false);
  assert.equal(res2.statusCode, 429);
});

test('securityHeaders sets baseline headers and calls next', () => {
  const mw = securityHeaders();
  const req = { secure: false };
  const res = mockRes();
  let nextCalled = false;
  mw(req, res, () => { nextCalled = true; });
  assert.equal(nextCalled, true);
  assert.equal(res.headers['X-Content-Type-Options'], 'nosniff');
  assert.equal(res.headers['X-Frame-Options'], 'DENY');
  assert.equal(res.headers['Referrer-Policy'], 'no-referrer');
  assert.equal(res.headers['Cache-Control'], 'no-store');
  assert.equal(res.headers['Strict-Transport-Security'], undefined);
});

test('securityHeaders adds HSTS only over a secure connection', () => {
  const mw = securityHeaders();
  const res = mockRes();
  mw({ secure: true }, res, () => {});
  assert.ok(res.headers['Strict-Transport-Security']);
});
