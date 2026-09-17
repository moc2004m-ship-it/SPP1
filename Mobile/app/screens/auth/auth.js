// Phase 3 — same-origin by default. `window.AUTH_API_BASE` stays available
// as an override (e.g. a dev proxy pointing at a different host), but the
// old hardcoded 'http://localhost:3000' fallback broke the moment this
// screen was served from anywhere else (Render staging, a phone on the
// LAN, etc.) even though /auth/* is mounted on the very same origin as
// this static file (see Backend/src/index.js). Same-origin means: call
// the path as-is, no scheme/host prefix.
const API = window.AUTH_API_BASE || '';
const status = document.getElementById('status');
async function post(path, body){const r=await fetch(`${API}${path}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});const data=await r.json().catch(()=>({}));if(!r.ok)throw new Error(data.error||`HTTP ${r.status}`);return data;}
document.getElementById('send').onclick=async()=>{try{const data=await post('/auth/otp/request',{phone:document.getElementById('phone').value});status.textContent=`تم إرسال الرمز. صالح ${data.expiresInSeconds} ثانية.`;}catch(e){status.textContent=e.message;}};
document.getElementById('verify').onclick=async()=>{
  try{
    const data=await post('/auth/otp/verify',{phone:document.getElementById('phone').value,code:document.getElementById('otp').value,consentVersion:document.getElementById('consent').value,device:{name:navigator.userAgent,platform:'web'}});
    // Phase 3 — the app shell (../../app.js) needs BOTH of these to call
    // /platform/api/*: the bearer token for the Authorization header, and
    // the real server-issued account id (never a client-invented one).
    // Previously only accessToken was stored, so app.js had no real
    // identity to use and fell back to a fabricated 'demo_user'.
    sessionStorage.setItem('accessToken',data.accessToken);
    sessionStorage.setItem('accountId',data.account.id);
    status.textContent=`تم الدخول: ${data.account.id} — جاري التحويل…`;
    location.href='../../index.html';
  }catch(e){status.textContent=e.message;}
};
