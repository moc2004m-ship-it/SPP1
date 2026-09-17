const express = require('express');
const { verifyProviderToken } = require('../auth/provider-verifiers');
const { sendOtp } = require('../auth/otp-sender');
const { requireSession } = require('../auth/session-middleware');
const { otpRequestLimiter } = require('../security/rate-limit');

function normalizePhone(phone) {
  const value = String(phone || '').trim();
  if (!/^\+[1-9]\d{7,14}$/.test(value)) throw Object.assign(new Error('phone must be E.164 format'), { status: 400 });
  return value;
}

function createAuthRouter({ authStore, accountRepository, socialConfig = {}, smsConfig = {} }) {
  const router = express.Router();
  // Shared across /auth/otp/request and /auth/recovery/otp/request so a
  // phone number's total OTP-send budget is bounded regardless of which
  // route is used to request it. See ../security/rate-limit.js.
  const otpLimiter = otpRequestLimiter();

  router.post('/auth/otp/request', otpLimiter, async (req, res) => {
    try {
      const phone = normalizePhone(req.body?.phone);
      const code = await authStore.issueOtp(phone);
      await sendOtp(phone, code, smsConfig);
      // The code is never returned in production. A development-only opt-in is
      // available for local automated testing and is visibly marked as such.
      const response = { status: 'accepted', expiresInSeconds: 300 };
      if (process.env.NODE_ENV === 'test' || process.env.AUTH_EXPOSE_TEST_OTP === 'true') response.testCode = code;
      return res.status(202).json(response);
    } catch (err) { return res.status(err.status || 500).json({ error: err.message }); }
  });

  router.post('/auth/otp/verify', async (req, res, next) => {
    try {
      const phone = normalizePhone(req.body?.phone);
      const code = String(req.body?.code || '');
      const consentVersion = String(req.body?.consentVersion || '').trim();
      const device = req.body?.device || {};
      if (!(await authStore.verifyOtp(phone, code))) return res.status(401).json({ error: 'invalid_or_expired_otp' });
      if (!/^\d+\.\d+$/.test(consentVersion)) return res.status(400).json({ error: 'consent required' });
      const account = await authStore.findOrCreatePhoneAccount(phone);
      await authStore.setConsent(account.id, consentVersion);
      const result = await authStore.createSession(account.id, device);
      res.status(200).json({ account, session: result.session, accessToken: result.token });
    } catch (err) { next(err); }
  });

  router.post('/auth/social/:provider', async (req, res, next) => {
    try {
      const provider = String(req.params.provider).toLowerCase();
      const consentVersion = String(req.body?.consentVersion || '').trim();
      if (!/^\d+\.\d+$/.test(consentVersion)) return res.status(400).json({ error: 'consent required' });
      const identity = await verifyProviderToken(provider, req.body?.accessToken, socialConfig[provider]);
      const account = await authStore.findOrCreateSocialAccount(identity.provider, identity.subject);
      await authStore.setConsent(account.id, consentVersion);
      const result = await authStore.createSession(account.id, req.body?.device || {});
      res.status(200).json({ account, session: result.session, accessToken: result.token });
    } catch (err) { next(err); }
  });

  router.get('/auth/me', requireSession(authStore), async (req, res, next) => {
    try {
      const account = await accountRepository.findById(req.session.accountId);
      if (!account) return res.status(401).json({ error: 'account not found' });
      res.json({ account, consent: await authStore.getConsent(account.id) });
    } catch (err) { next(err); }
  });

  router.get('/auth/sessions', requireSession(authStore), async (req, res, next) => {
    try {
      res.json({ sessions: await authStore.listSessions(req.session.accountId) });
    } catch (err) { next(err); }
  });

  router.delete('/auth/sessions/:sessionId', requireSession(authStore), async (req, res, next) => {
    try {
      const revoked = await authStore.revokeSessionById(req.session.accountId, req.params.sessionId);
      if (!revoked) return res.status(404).json({ error: 'session not found' });
      res.status(204).end();
    } catch (err) { next(err); }
  });

  router.post('/auth/recovery/otp/request', otpLimiter, async (req, res) => {
    try {
      const phone = normalizePhone(req.body?.phone);
      const code = await authStore.issueOtp(phone);
      await sendOtp(phone, code, smsConfig);
      const response = { status: 'accepted', expiresInSeconds: 300 };
      if (process.env.NODE_ENV === 'test' || process.env.AUTH_EXPOSE_TEST_OTP === 'true') response.testCode = code;
      res.status(202).json(response);
    } catch (err) { res.status(err.status || 500).json({ error: err.message }); }
  });

  router.post('/auth/recovery/otp/verify', async (req, res, next) => {
    try {
      const phone = normalizePhone(req.body?.phone);
      const code = String(req.body?.code || '');
      if (!(await authStore.verifyOtp(phone, code))) return res.status(401).json({ error: 'invalid_or_expired_otp' });
      const account = await authStore.findOrCreatePhoneAccount(phone);
      const result = await authStore.createSession(account.id, req.body?.device || {});
      res.status(200).json({ account, session: result.session, accessToken: result.token, recovered: true });
    } catch (err) { next(err); }
  });

  router.post('/auth/logout', requireSession(authStore), async (req, res, next) => {
    try {
      await authStore.revokeSessionById(req.session.accountId, req.session.id);
      res.status(204).end();
    } catch (err) { next(err); }
  });

  return router;
}

module.exports = { createAuthRouter, requireSession };
