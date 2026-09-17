const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { AuthStore } = require('../src/auth/auth.store');
const { InMemoryAccountRepository } = require('../src/database/repositories/account.repository');
const { createAuthRouter } = require('../src/routes/auth.routes');

function setup() {
  const accounts = new InMemoryAccountRepository();
  const auth = new AuthStore(accounts);
  const app = express(); app.use(express.json());
  app.use(createAuthRouter({ authStore: auth, accountRepository: accounts }));
  app.use((err, req, res, next) => res.status(err.status || 500).json({ error: err.message }));
  return { app, auth };
}
async function request(app, path, options={}) {
  const server = app.listen(0); const port = server.address().port;
  try { return await fetch(`http://127.0.0.1:${port}${path}`, { ...options, headers: {'content-type':'application/json', ...(options.headers||{}) } }); }
  finally { server.close(); }
}

test('OTP signup creates server-owned account and consent', async () => {
  const { app } = setup();
  const phone = '+213555123456';
  let r = await request(app, '/auth/otp/request', {method:'POST', body:JSON.stringify({phone})});
  assert.equal(r.status, 202); const otp = (await r.json()).testCode;
  r = await request(app, '/auth/otp/verify', {method:'POST', body:JSON.stringify({phone, code:otp, consentVersion:'1.0', device:{name:'test',platform:'android'}})});
  assert.equal(r.status, 200); const body = await r.json();
  assert.match(body.account.id, /^usr_/); assert.equal(body.account.vip,0); assert.equal(body.account.coins,0); assert.equal(body.consent, undefined);
  r = await request(app, '/auth/me', {headers:{authorization:`Bearer ${body.accessToken}`}});
  assert.equal(r.status,200); const me=await r.json(); assert.equal(me.consent.version,'1.0');
});

test('two devices are listed and one can be revoked remotely', async () => {
  const { app } = setup(); const phone='+213555123457';
  let r=await request(app,'/auth/otp/request',{method:'POST',body:JSON.stringify({phone})}); const code=(await r.json()).testCode;
  r=await request(app,'/auth/otp/verify',{method:'POST',body:JSON.stringify({phone,code,consentVersion:'1.0',device:{name:'A',platform:'android'}})}); const a=await r.json();
  r=await request(app,'/auth/otp/request',{method:'POST',body:JSON.stringify({phone})}); const code2=(await r.json()).testCode;
  r=await request(app,'/auth/otp/verify',{method:'POST',body:JSON.stringify({phone,code:code2,consentVersion:'1.0',device:{name:'B',platform:'android'}})}); const b=await r.json();
  r=await request(app,'/auth/sessions',{headers:{authorization:`Bearer ${a.accessToken}`}}); const sessions=(await r.json()).sessions; assert.equal(sessions.length,2);
  r=await request(app,`/auth/sessions/${sessions.find(x=>x.id!==a.session.id).id}`,{method:'DELETE',headers:{authorization:`Bearer ${a.accessToken}`}}); assert.equal(r.status,204);
  r=await request(app,'/auth/me',{headers:{authorization:`Bearer ${b.accessToken}`}}); assert.equal(r.status,401);
});

test('social login fails closed when provider token is absent', async()=>{
  const {app}=setup(); const r=await request(app,'/auth/social/google',{method:'POST',body:JSON.stringify({consentVersion:'1.0'})}); assert.equal(r.status,400);
});
