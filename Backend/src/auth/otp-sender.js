/**
 * Real SMS delivery boundary. The backend never pretends a code was sent in
 * production: without a configured SMS endpoint, requests fail closed.
 */
async function sendOtp(phone, code, cfg = {}) {
  if (!cfg.url) {
    if (process.env.NODE_ENV === 'test' || process.env.AUTH_EXPOSE_TEST_OTP === 'true') return { delivered: false, testOnly: true };
    throw Object.assign(new Error('SMS provider is not configured'), { status: 503 });
  }
  const response = await fetch(cfg.url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(cfg.headers || {}) },
    body: JSON.stringify({ to: phone, message: cfg.messageTemplate ? cfg.messageTemplate.replace('{code}', code) : `Your verification code is ${code}` }),
  });
  if (!response.ok) throw Object.assign(new Error(`SMS provider rejected request (${response.status})`), { status: 502 });
  return { delivered: true };
}
module.exports = { sendOtp };
