'use strict';
// Stage 5 -- direct unit tests for the social-login verification boundary
// (../src/auth/provider-verifiers.js). Before this file, only one case was
// covered anywhere in the suite (a forged Apple signature, in
// final-corrections.test.js). This file closes the rest of the Stage 5 gap
// called out in the audit: the real Apple ES256/JWKS verification path
// (success, expired token, wrong audience, wrong issuer, JWKS fetch
// failure, malformed token, missing config) plus the Google and Facebook
// provider-token verification behavior. No network access is available in
// this sandbox, so global.fetch is monkeypatched to stand in for the
// provider's HTTP endpoint -- the same technique already used by
// final-corrections.test.js and recharge-provider-verifier.test.js. The
// Apple signature itself is REAL: a genuine EC P-256 key pair is generated
// with node:crypto and used to sign a real token, so the "successful
// verification" test proves actual ECDSA verification, not a mock.

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { verifyProviderToken } = require('../src/auth/provider-verifiers');

const realFetch = global.fetch;
test.afterEach(() => {
  global.fetch = realFetch;
});

// ---- helpers -------------------------------------------------------------

function b64url(value) {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

// Converts a DER-encoded ECDSA signature (what node:crypto produces) into
// the fixed-width raw r||s format used by JWS/Apple identity tokens, so the
// verifier under test (which expects raw 64-byte P-256 signatures) accepts
// it. This is the exact inverse of ecdsaRawToDer() in the module under test.
function derToRaw(der) {
  let offset = 2; // skip SEQUENCE tag + length
  function readInt() {
    if (der[offset] !== 0x02) throw new Error('expected INTEGER');
    offset += 1;
    let len = der[offset]; offset += 1;
    let bytes = der.subarray(offset, offset + len); offset += len;
    while (bytes.length > 32 && bytes[0] === 0) bytes = bytes.subarray(1);
    if (bytes.length < 32) bytes = Buffer.concat([Buffer.alloc(32 - bytes.length), bytes]);
    return bytes;
  }
  const r = readInt();
  const s = readInt();
  return Buffer.concat([r, s]);
}

// The module under test caches JWKS responses in a module-level Map keyed
// by jwksUrl (by design, to avoid hitting Apple's endpoint on every
// verification). That cache persists for the lifetime of this whole test
// file. To keep each test's key pair isolated from every other test's, each
// test gets both a unique kid AND a unique jwksUrl (via config.apple.jwksUrl)
// so no test can ever be served another test's cached key.
let keyCounter = 0;
function makeAppleKeyPair() {
  keyCounter += 1;
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const jwk = publicKey.export({ format: 'jwk' });
  jwk.kid = `test-key-${keyCounter}`;
  jwk.alg = 'ES256';
  jwk.use = 'sig';
  const jwksUrl = `https://appleid.apple.com/auth/keys?test-run=${keyCounter}`;
  return { jwk, privateKey, jwksUrl };
}

function signAppleToken(privateKey, header, claims) {
  const h = b64url(header);
  const p = b64url(claims);
  const signer = crypto.createSign('SHA256');
  signer.update(`${h}.${p}`);
  signer.end();
  const der = signer.sign(privateKey);
  const raw = derToRaw(der);
  return `${h}.${p}.${raw.toString('base64url')}`;
}

function stubJwksFetch(jwk) {
  global.fetch = async () => ({ ok: true, json: async () => ({ keys: [jwk] }) });
}

const AUD = 'com.example.app';
const ISS = 'https://appleid.apple.com';

function baseClaims(overrides = {}) {
  const now = Math.floor(Date.now() / 1000);
  return { sub: 'apple-user-1', iss: ISS, aud: AUD, iat: now, exp: now + 300, ...overrides };
}

// ---- Apple: successful verification --------------------------------------

test('Apple verifier accepts a genuinely signed, unexpired, correctly-audienced token', async () => {
  const { jwk, privateKey, jwksUrl } = makeAppleKeyPair();
  const token = signAppleToken(privateKey, { alg: 'ES256', kid: jwk.kid }, baseClaims());
  stubJwksFetch(jwk);
  const identity = await verifyProviderToken('apple', token, { apple: { audience: AUD, jwksUrl } });
  assert.deepEqual(identity, { subject: 'apple-user-1', provider: 'apple' });
});

test('Apple verifier fetches the JWKS only once per key id (cache hit on repeat verification)', async () => {
  const { jwk, privateKey, jwksUrl } = makeAppleKeyPair();
  const token = signAppleToken(privateKey, { alg: 'ES256', kid: jwk.kid }, baseClaims());
  let calls = 0;
  global.fetch = async () => { calls += 1; return { ok: true, json: async () => ({ keys: [jwk] }) }; };
  await verifyProviderToken('apple', token, { apple: { audience: AUD, jwksUrl } });
  await verifyProviderToken('apple', token, { apple: { audience: AUD, jwksUrl } });
  assert.equal(calls, 1);
});

// ---- Apple: forged / invalid signature ------------------------------------

test('Apple verifier rejects a token whose signature does not match its own claims', async () => {
  const { jwk, privateKey, jwksUrl } = makeAppleKeyPair();
  // Sign one payload, then swap in a different payload after signing so the
  // signature no longer matches -- a genuine forgery attempt, not a malformed blob.
  const signedToken = signAppleToken(privateKey, { alg: 'ES256', kid: jwk.kid }, baseClaims({ sub: 'victim' }));
  const [header, , signature] = signedToken.split('.');
  const forgedPayload = b64url(baseClaims({ sub: 'attacker' }));
  const forgedToken = `${header}.${forgedPayload}.${signature}`;
  stubJwksFetch(jwk);
  await assert.rejects(
    () => verifyProviderToken('apple', forgedToken, { apple: { audience: AUD, jwksUrl } }),
    /invalid Apple token signature/
  );
});

// ---- Apple: expired token ---------------------------------------------------

test('Apple verifier rejects an expired token even with a valid signature', async () => {
  const { jwk, privateKey, jwksUrl } = makeAppleKeyPair();
  const now = Math.floor(Date.now() / 1000);
  const token = signAppleToken(privateKey, { alg: 'ES256', kid: jwk.kid }, baseClaims({ iat: now - 700, exp: now - 100 }));
  stubJwksFetch(jwk);
  await assert.rejects(
    () => verifyProviderToken('apple', token, { apple: { audience: AUD, jwksUrl } }),
    /expired or invalid Apple identity token/
  );
});

// ---- Apple: wrong audience / wrong issuer -----------------------------------

test('Apple verifier rejects a token issued for a different app (aud mismatch)', async () => {
  const { jwk, privateKey, jwksUrl } = makeAppleKeyPair();
  const token = signAppleToken(privateKey, { alg: 'ES256', kid: jwk.kid }, baseClaims({ aud: 'com.other.app' }));
  stubJwksFetch(jwk);
  await assert.rejects(
    () => verifyProviderToken('apple', token, { apple: { audience: AUD, jwksUrl } }),
    /invalid Apple identity claims/
  );
});

test('Apple verifier rejects a token from an unexpected issuer (iss mismatch)', async () => {
  const { jwk, privateKey, jwksUrl } = makeAppleKeyPair();
  const token = signAppleToken(privateKey, { alg: 'ES256', kid: jwk.kid }, baseClaims({ iss: 'https://evil.example.com' }));
  stubJwksFetch(jwk);
  await assert.rejects(
    () => verifyProviderToken('apple', token, { apple: { audience: AUD, jwksUrl } }),
    /invalid Apple identity claims/
  );
});

// ---- Apple: JWKS / key handling failures ------------------------------------

test('Apple verifier fails closed (503) when the JWKS endpoint cannot be reached', async () => {
  const { jwk, privateKey, jwksUrl } = makeAppleKeyPair();
  const token = signAppleToken(privateKey, { alg: 'ES256', kid: jwk.kid }, baseClaims());
  global.fetch = async () => ({ ok: false, status: 503, json: async () => ({}) });
  await assert.rejects(
    () => verifyProviderToken('apple', token, { apple: { audience: AUD, jwksUrl } }),
    (e) => e.status === 401 && /provider verification failed/.test(e.message)
  );
});

test('Apple verifier rejects when the JWKS response has no matching key id', async () => {
  const { privateKey, jwksUrl } = makeAppleKeyPair();
  const token = signAppleToken(privateKey, { alg: 'ES256', kid: 'unknown-kid' }, baseClaims());
  global.fetch = async () => ({ ok: true, json: async () => ({ keys: [] }) });
  await assert.rejects(
    () => verifyProviderToken('apple', token, { apple: { audience: AUD, jwksUrl } }),
    (e) => e.status === 401 && /Apple signing key not found/.test(e.message)
  );
});

test('Apple verifier rejects a malformed JWKS document (not an array of keys)', async () => {
  const { jwk, privateKey, jwksUrl } = makeAppleKeyPair();
  const token = signAppleToken(privateKey, { alg: 'ES256', kid: jwk.kid }, baseClaims());
  global.fetch = async () => ({ ok: true, json: async () => ({ keys: 'not-an-array' }) });
  await assert.rejects(
    () => verifyProviderToken('apple', token, { apple: { audience: AUD, jwksUrl } }),
    (e) => e.status === 503 && /invalid Apple JWKS/.test(e.message)
  );
});

// ---- Apple: malformed / unsupported tokens ----------------------------------

test('Apple verifier rejects a token that is not three dot-separated segments', async () => {
  await assert.rejects(
    () => verifyProviderToken('apple', 'not-a-jwt', { apple: { audience: AUD } }),
    (e) => e.status === 401 && /invalid Apple identity token/.test(e.message)
  );
});

test('Apple verifier rejects a token with unparsable header/payload segments', async () => {
  const token = `${Buffer.from('not-json').toString('base64url')}.${Buffer.from('not-json').toString('base64url')}.sig`;
  await assert.rejects(
    () => verifyProviderToken('apple', token, { apple: { audience: AUD } }),
    (e) => e.status === 401 && /invalid Apple identity token/.test(e.message)
  );
});

test('Apple verifier rejects a non-ES256 signing algorithm', async () => {
  const { jwk, privateKey, jwksUrl } = makeAppleKeyPair();
  const token = signAppleToken(privateKey, { alg: 'HS256', kid: jwk.kid }, baseClaims());
  await assert.rejects(
    () => verifyProviderToken('apple', token, { apple: { audience: AUD, jwksUrl } }),
    (e) => e.status === 401 && /unsupported Apple signing algorithm/.test(e.message)
  );
});

test('Apple verifier rejects a token with a truncated (wrong-length) signature', async () => {
  const { jwk, privateKey, jwksUrl } = makeAppleKeyPair();
  const token = signAppleToken(privateKey, { alg: 'ES256', kid: jwk.kid }, baseClaims());
  const [header, payload] = token.split('.');
  const shortSig = Buffer.alloc(16, 1).toString('base64url');
  stubJwksFetch(jwk);
  await assert.rejects(
    () => verifyProviderToken('apple', `${header}.${payload}.${shortSig}`, { apple: { audience: AUD, jwksUrl } }),
    (e) => e.status === 401 && /invalid Apple signature/.test(e.message)
  );
});

// ---- Apple: fails closed when unconfigured ----------------------------------

test('Apple verifier fails closed (503) when no audience is configured, without calling fetch', async () => {
  let called = false;
  global.fetch = async () => { called = true; return { ok: true, json: async () => ({ keys: [] }) }; };
  await assert.rejects(
    () => verifyProviderToken('apple', 'irrelevant.token.value', {}),
    (e) => e.status === 503 && /Apple audience is not configured/.test(e.message)
  );
  assert.equal(called, false);
});

// ---- Google -----------------------------------------------------------------

test('Google verifier returns the account subject on a successful provider response', async () => {
  global.fetch = async (url, init) => {
    assert.equal(init.headers.authorization, 'Bearer good-token');
    return { ok: true, json: async () => ({ sub: 'google-user-42' }) };
  };
  const identity = await verifyProviderToken('google', 'good-token', {});
  assert.deepEqual(identity, { subject: 'google-user-42', provider: 'google' });
});

test('Google verifier rejects a provider response with no sub claim', async () => {
  global.fetch = async () => ({ ok: true, json: async () => ({}) });
  await assert.rejects(
    () => verifyProviderToken('google', 'some-token', {}),
    (e) => e.status === 401 && /invalid Google identity/.test(e.message)
  );
});

test('Google verifier propagates a non-2xx provider response as a failed verification', async () => {
  global.fetch = async () => ({ ok: false, status: 401, json: async () => ({}) });
  await assert.rejects(
    () => verifyProviderToken('google', 'bad-token', {}),
    (e) => e.status === 401 && /provider verification failed/.test(e.message)
  );
});

// ---- Facebook -----------------------------------------------------------------

test('Facebook verifier returns the account subject on a successful provider response', async () => {
  global.fetch = async (url) => {
    assert.match(url, /access_token=good-token/);
    return { ok: true, json: async () => ({ id: 'fb-user-7' }) };
  };
  const identity = await verifyProviderToken('facebook', 'good-token', {});
  assert.deepEqual(identity, { subject: 'fb-user-7', provider: 'facebook' });
});

test('Facebook verifier rejects a provider response with no id field', async () => {
  global.fetch = async () => ({ ok: true, json: async () => ({}) });
  await assert.rejects(
    () => verifyProviderToken('facebook', 'some-token', {}),
    (e) => e.status === 401 && /invalid Facebook identity/.test(e.message)
  );
});

test('Facebook verifier propagates a non-2xx provider response as a failed verification', async () => {
  global.fetch = async () => ({ ok: false, status: 400, json: async () => ({}) });
  await assert.rejects(
    () => verifyProviderToken('facebook', 'bad-token', {}),
    (e) => e.status === 401 && /provider verification failed/.test(e.message)
  );
});

// ---- Cross-cutting: malformed / unsupported requests -------------------------

test('verifyProviderToken rejects a missing access token before contacting any provider', async () => {
  let called = false;
  global.fetch = async () => { called = true; return { ok: true, json: async () => ({}) }; };
  await assert.rejects(
    () => verifyProviderToken('google', '', {}),
    (e) => e.status === 400 && /provider token required/.test(e.message)
  );
  assert.equal(called, false);
});

test('verifyProviderToken rejects an unsupported provider name', async () => {
  await assert.rejects(
    () => verifyProviderToken('twitter', 'some-token', {}),
    (e) => e.status === 400 && /unsupported provider/.test(e.message)
  );
});

test('verifyProviderToken normalizes provider name casing (e.g. "Apple")', async () => {
  await assert.rejects(
    () => verifyProviderToken('Apple', 'irrelevant.token.value', {}),
    (e) => e.status === 503 && /Apple audience is not configured/.test(e.message)
  );
});
