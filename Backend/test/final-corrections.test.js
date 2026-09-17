'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { InMemoryWalletRepository } = require('../src/database/repositories/wallet.repository');
const { createPlatform } = require('../src/feature-platform');
const { InMemoryFeatureRecordRepository } = require('../src/database/repositories/feature-record.repository');
const { InMemoryAccountRepository } = require('../src/database/repositories/account.repository');
const { verifyProviderToken } = require('../src/auth/provider-verifiers');

test('wallet rejects reuse of an idempotency key for a different operation', async () => {
  const w = new InMemoryWalletRepository();
  const first = await w.credit('usr_a', 'coins', 100, 'idem-key-1');
  assert.equal(first.balanceAfter, 100);
  await assert.rejects(() => w.debit('usr_a', 'coins', 50, 'idem-key-1'), /different wallet operation/);
  assert.equal((await w.getBalance('usr_a')).coins, 100);
});

test('search returns real repository-backed records instead of an unconditional empty result', async () => {
  const accounts = new InMemoryAccountRepository();
  const account = await accounts.create();
  const store = new InMemoryFeatureRecordRepository();
  const platform = createPlatform({ store: new (require('../src/feature-platform').FeatureStore)(store), accounts });
  await platform.rooms.create({ ownerId: account.id, name: 'Arabic Lounge' });
  const result = await platform.search.query('arabic');
  assert.equal(result.results.length, 1);
  assert.equal(result.results[0].type, 'room');
});

test('Apple verifier rejects a forged ES256 token signature', async () => {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve:'prime256v1' });
  const jwk = publicKey.export({ format:'jwk' });
  jwk.kid = 'test-key'; jwk.alg = 'ES256'; jwk.use = 'sig';
  const now = Math.floor(Date.now()/1000);
  const b64 = (v) => Buffer.from(JSON.stringify(v)).toString('base64url');
  const header = b64({ alg:'ES256', kid:'test-key' });
  const payload = b64({ sub:'apple-user', iss:'https://appleid.apple.com', aud:'com.example.app', iat:now, exp:now+300 });
  const signer = crypto.createSign('SHA256'); signer.update(`${header}.${payload}`); signer.end();
  const der = signer.sign(privateKey);
  // Deliberately use a malformed/forged raw signature. The verifier must fail closed.
  const forged = Buffer.alloc(64, 7).toString('base64url');
  const token = `${header}.${payload}.${forged}`;
  global.fetch = async () => ({ ok:true, json:async()=>({keys:[jwk]}) });
  await assert.rejects(() => verifyProviderToken('apple', token, { apple:{ audience:'com.example.app' } }), /invalid Apple token signature/);
  void der;
});
