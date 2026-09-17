const crypto = require('node:crypto');

/**
 * Provider verification boundary. No client-supplied provider subject is trusted.
 * Production social login must provide a provider-issued token and configured
 * verification endpoint/keys. This module intentionally fails closed when the
 * provider is not configured instead of creating a fake social login.
 */
async function verifyProviderToken(provider, accessToken, config = {}) {
  if (!accessToken) throw Object.assign(new Error('provider token required'), { status: 400 });
  const normalized = String(provider).toLowerCase();
  if (!['google', 'apple', 'facebook'].includes(normalized)) {
    throw Object.assign(new Error('unsupported provider'), { status: 400 });
  }

  if (normalized === 'google') return verifyGoogle(accessToken, config.google);
  if (normalized === 'facebook') return verifyFacebook(accessToken, config.facebook);
  return verifyApple(accessToken, config.apple);
}

async function fetchJson(url, init) {
  const response = await fetch(url, { ...init, headers: { accept: 'application/json', ...(init?.headers || {}) } });
  if (!response.ok) throw Object.assign(new Error(`provider verification failed (${response.status})`), { status: 401 });
  return response.json();
}

async function verifyGoogle(token, cfg = {}) {
  const url = cfg.userInfoUrl || 'https://openidconnect.googleapis.com/v1/userinfo';
  const data = await fetchJson(url, { headers: { authorization: `Bearer ${token}` } });
  if (!data.sub) throw Object.assign(new Error('invalid Google identity'), { status: 401 });
  return { subject: data.sub, provider: 'google' };
}

async function verifyFacebook(token, cfg = {}) {
  const base = cfg.userInfoUrl || 'https://graph.facebook.com/me?fields=id';
  const separator = base.includes('?') ? '&' : '?';
  const data = await fetchJson(`${base}${separator}access_token=${encodeURIComponent(token)}`);
  if (!data.id) throw Object.assign(new Error('invalid Facebook identity'), { status: 401 });
  return { subject: data.id, provider: 'facebook' };
}

function base64urlToBuffer(value) {
  return Buffer.from(value, 'base64url');
}

function ecdsaRawToDer(signature) {
  const size = Math.floor(signature.length / 2);
  let r = signature.subarray(0, size);
  let s = signature.subarray(size);
  while (r.length > 1 && r[0] === 0) r = r.subarray(1);
  while (s.length > 1 && s[0] === 0) s = s.subarray(1);
  if (r[0] & 0x80) r = Buffer.concat([Buffer.from([0]), r]);
  if (s[0] & 0x80) s = Buffer.concat([Buffer.from([0]), s]);
  const body = Buffer.concat([Buffer.from([0x02, r.length]), r, Buffer.from([0x02, s.length]), s]);
  return Buffer.concat([Buffer.from([0x30, body.length]), body]);
}

const appleJwksCache = new Map();
async function getAppleKey(jwksUrl, kid) {
  const cached = appleJwksCache.get(jwksUrl);
  const nowMs = Date.now();
  if (cached && cached.expiresAt > nowMs) {
    const key = cached.keys.find(k => k.kid === kid);
    if (key) return key;
  }
  const data = await fetchJson(jwksUrl);
  if (!Array.isArray(data.keys)) throw Object.assign(new Error('invalid Apple JWKS'), { status: 503 });
  appleJwksCache.set(jwksUrl, { keys:data.keys, expiresAt:nowMs + 60*60*1000 });
  const key = data.keys.find(k => k.kid === kid);
  if (!key) throw Object.assign(new Error('Apple signing key not found'), { status:401 });
  return key;
}

async function verifyApple(token, cfg = {}) {
  const jwksUrl = cfg.jwksUrl || 'https://appleid.apple.com/auth/keys';
  const issuer = cfg.issuer || 'https://appleid.apple.com';
  const audience = cfg.audience;
  if (!audience) throw Object.assign(new Error('Apple audience is not configured'), { status:503 });
  const parts = String(token).split('.');
  if (parts.length !== 3) throw Object.assign(new Error('invalid Apple identity token'), { status:401 });
  let header, claims;
  try {
    header = JSON.parse(base64urlToBuffer(parts[0]).toString('utf8'));
    claims = JSON.parse(base64urlToBuffer(parts[1]).toString('utf8'));
  } catch { throw Object.assign(new Error('invalid Apple identity token'), { status:401 }); }
  if (header.alg !== 'ES256' || !header.kid) throw Object.assign(new Error('unsupported Apple signing algorithm'), { status:401 });
  if (!claims.sub || claims.iss !== issuer || claims.aud !== audience) throw Object.assign(new Error('invalid Apple identity claims'), { status:401 });
  const nowSec = Math.floor(Date.now()/1000);
  if (typeof claims.exp !== 'number' || claims.exp <= nowSec || (claims.iat && claims.iat > nowSec + 60)) {
    throw Object.assign(new Error('expired or invalid Apple identity token'), { status:401 });
  }
  const jwk = await getAppleKey(jwksUrl, header.kid);
  let publicKey;
  try { publicKey = crypto.createPublicKey({ key:jwk, format:'jwk' }); }
  catch { throw Object.assign(new Error('invalid Apple signing key'), { status:503 }); }
  const signingInput = `${parts[0]}.${parts[1]}`;
  const rawSig = base64urlToBuffer(parts[2]);
  if (rawSig.length !== 64) throw Object.assign(new Error('invalid Apple signature'), { status:401 });
  const verify = crypto.createVerify('SHA256');
  verify.update(signingInput);
  verify.end();
  if (!verify.verify(publicKey, ecdsaRawToDer(rawSig))) throw Object.assign(new Error('invalid Apple token signature'), { status:401 });
  return { subject: claims.sub, provider:'apple' };
}

module.exports = { verifyProviderToken };
