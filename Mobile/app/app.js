const API='/platform';
// Phase 3 — identity comes ONLY from the real session created by
// /auth/otp/verify (see screens/auth/auth.js), never a client-invented
// id. Backend/src/routes/platform.routes.js explicitly ignores any
// userId/ownerId the client sends in the body and takes the acting
// account from req.session.accountId instead -- which is set by
// requireSession() from the Bearer token below. Without that token every
// /platform/api/* call 401s (see requireSession in
// Backend/src/auth/session-middleware.js), which is exactly what the
// previous version of this file did silently: it never sent a token at
// all, and the fabricated 'demo_user' id was discarded server-side.
const state={tab:'home',rooms:[],events:[],connected:false,token:sessionStorage.getItem('accessToken'),userId:sessionStorage.getItem('accountId')};
// Real Agora voice client (see rtc/agora-voice-client.js, loaded before
// this file in index.html). Created lazily on first join so a page that
// never touches voice never even attempts to reach the Agora SDK. There
// is exactly one active voice connection at a time, matching one real
// device joining one real room's voice channel.
let voiceClient=null;
// Stage 34 -- General Settings, real client-effect application. The
// backend (Backend/src/database/models/settings.model.js) owns the fixed
// key catalog + validation; this is the ONLY place the Mobile client
// applies one of those five persisted values to real, observable client
// behavior -- no separate client-side "settings" invented anywhere else.
//   - language: applied to the one real localization mechanism this app
//     has today -- <html lang>/<html dir> (see index.html's static
//     lang="ar" dir="rtl"). 'ar' -> rtl, anything else supported ('en')
//     -> ltr.
//   - mic: passed straight into the real Agora voice client's
//     setMuted() (see rtc/agora-voice-client.js) -- only meaningful once
//     actually joined with a local mic track (host role); a no-op
//     otherwise, never a fake "success".
// sound/network/media have no native pipeline in this browser-based build
// (no volume mixer, no data-usage manager, no autoplay engine) to hook
// into beyond real persistence + real read, which POST/GET /api/settings
// already provide -- see settings.model.js's header for the same
// documented boundary on the backend side.
function applySettingEffect(key,value){
  if(key==='language'){
    document.documentElement.lang=value;
    document.documentElement.dir=(value==='ar'?'rtl':'ltr');
  }else if(key==='mic'&&voiceClient&&voiceClient.isJoined()){
    voiceClient.setMuted(!!value).catch(()=>{});
  }
}
const $=s=>document.querySelector(s);
function goToLogin(){location.href='screens/auth/index.html'}
async function api(path,opt={}){
  if(!state.token){goToLogin();throw Error('no session')}
  const r=await fetch(API+path,{headers:{'Content-Type':'application/json',Authorization:'Bearer '+state.token},...opt});
  if(r.status===401){sessionStorage.removeItem('accessToken');sessionStorage.removeItem('accountId');goToLogin();throw Error('session expired')}
  const j=await r.json();
  if(!j.ok)throw Error(j.error||'Request failed');
  return j.data;
}
function toast(t){const x=document.createElement('div');x.className='toast';x.textContent=t;document.body.append(x);setTimeout(()=>x.remove(),2200)}
// Client-generated idempotency reference id for write actions that require
// one (gifts.send -- see feature-platform.js requireId(input.referenceId)).
// This is NOT fabricated business data: it is only an opaque correlation
// token the client is expected to mint for its own request, exactly like a
// real payment/gift client would.
function genRef(){return 'ref_'+Date.now().toString(36)+'_'+Math.random().toString(36).slice(2,8)}
// Generic renderer for the real record the server just returned from a
// write-only domain action (battles/games/gifts/family/settings/moderation).
// `note` is used to honestly disclose when no GET/list endpoint exists yet
// for that domain, instead of inventing a history/list UI with nothing real
// behind it.
function kv(obj){return Object.entries(obj||{}).map(([k,v])=>`${esc(k)}: ${esc(typeof v==='object'&&v!==null?JSON.stringify(v):v)}`).join('<br>')}
function resultCard(title,obj,note){return `<h3>${esc(title)}</h3><div class="card"><p class="muted">${kv(obj)}</p></div>${note?`<div class="empty">${esc(note)}</div>`:''}`}
// Phase 4 — generic real-list renderer for the new GET/read endpoints
// (battles/games/gifts-wall/families/settings/reports/tickets). Same
// no-fake-data rule as resultCard(): every row is exactly the record the
// server returned, nothing invented on the client.
function genericRow(x){return `<div class="card"><p class="muted">${kv(x)}</p></div>`}
function listCard(title,items,renderRow,emptyMsg){return `<h3>${esc(title)}</h3><div class="list">${items.length?items.map(renderRow).join(''):`<div class="empty">${esc(emptyMsg)}</div>`}</div>`}
// Stage 18 (Mobile UI) — real per-battle actions for the endpoints that
// already existed server-side but had no UI: accept/decline (opponent
// only), cancel (host only), end (either participant), and a detail view.
// This renders EXACTLY what the server returned for that battle (status,
// hostScore/opponentScore, winnerId once ended) and only shows the action
// buttons that make sense for the caller's real role and the battle's
// real current status -- a button that can't legally do anything (e.g.
// "accept" shown to the host) is never rendered, since platform.routes.js
// would just 403 it anyway. No client-side score/state is ever invented;
// every field here is copied straight from the server record.
const BATTLE_STATUS_LABEL={pending:'قيد الانتظار',active:'جارٍ الآن',declined:'مرفوض',cancelled:'ملغى',ended:'انتهى'};
function battleStatusBadge(b){return `<span class="badge">${esc(BATTLE_STATUS_LABEL[b.status]||b.status)}</span>`}
function battleScoreLine(b){return `النتيجة — أنا (host): ${esc(b.hostScore)} · الخصم (opponent): ${esc(b.opponentScore)}${b.status==='ended'?(b.winnerId?` · الفائز: ${esc(b.winnerId)}`:' · تعادل حقيقي'):''}`}
function battleRow(b){
  const isHost=b.hostId===state.userId, isOpponent=b.opponentId===state.userId;
  const btns=[];
  if(b.status==='pending'&&isOpponent){btns.push(`<button class="btn primary" data-battle-accept="${b.id}">قبول</button>`);btns.push(`<button class="btn" data-battle-decline="${b.id}">رفض</button>`)}
  if(b.status==='pending'&&isHost){btns.push(`<button class="btn" data-battle-cancel="${b.id}">إلغاء التحدي</button>`)}
  if(b.status==='active'&&(isHost||isOpponent)){btns.push(`<button class="btn" data-battle-end="${b.id}">إنهاء التحدي</button>`)}
  btns.push(`<button class="btn" data-battle-view="${b.id}">التفاصيل</button>`);
  return `<div class="card"><b>غرفة: ${esc(b.roomId)}</b> ${battleStatusBadge(b)}<div class="muted">مضيف: ${esc(b.hostId)} · خصم: ${esc(b.opponentId)}</div><div class="muted">${battleScoreLine(b)}</div><div class="actions">${btns.join('')}</div></div>`;
}
// Re-fetches and re-renders "my battles" (GET /api/battles, the same real
// endpoint #battlesList already used) with the action buttons above, then
// rebinds them -- called both on first open and after every action so the
// list always reflects the server's real current state, never a client
// guess at what an action "should" have done.
async function renderBattlesList(){
  try{
    const list=await api('/api/battles');
    $('#profileExtra').innerHTML=listCard('تحدياتي',list,battleRow,'لا توجد تحديات بعد.');
    bindBattleActions();
  }catch(e){toast(e.message)}
}
function bindBattleActions(){
  document.querySelectorAll('[data-battle-accept]').forEach(b=>b.onclick=async()=>{try{await api('/api/battles/'+b.dataset.battleAccept+'/accept',{method:'POST',body:JSON.stringify({})});toast('تم قبول التحدي');renderBattlesList()}catch(e){toast(e.message)}});
  document.querySelectorAll('[data-battle-decline]').forEach(b=>b.onclick=async()=>{try{await api('/api/battles/'+b.dataset.battleDecline+'/decline',{method:'POST',body:JSON.stringify({})});toast('تم رفض التحدي');renderBattlesList()}catch(e){toast(e.message)}});
  document.querySelectorAll('[data-battle-cancel]').forEach(b=>b.onclick=async()=>{try{await api('/api/battles/'+b.dataset.battleCancel+'/cancel',{method:'POST',body:JSON.stringify({})});toast('تم إلغاء التحدي');renderBattlesList()}catch(e){toast(e.message)}});
  document.querySelectorAll('[data-battle-end]').forEach(b=>b.onclick=async()=>{try{await api('/api/battles/'+b.dataset.battleEnd+'/end',{method:'POST',body:JSON.stringify({})});toast('تم إنهاء التحدي');renderBattlesList()}catch(e){toast(e.message)}});
  document.querySelectorAll('[data-battle-view]').forEach(b=>b.onclick=async()=>{
    try{
      const x=await api('/api/battles/'+b.dataset.battleView);
      $('#profileExtra').innerHTML=resultCard('تفاصيل التحدي',x)+'<div class="actions"><button class="btn" id="backToBattles">رجوع لقائمة تحدياتي</button></div>';
      $('#backToBattles').onclick=renderBattlesList;
    }catch(e){toast(e.message)}
  });
}
// Stage 19 (Mobile UI) -- Room Game Center. Replaces the old free-text
// prompt() for gameId (which let the client send ANY string) with a UI
// driven entirely by the real server catalog (GET /api/games/catalog --
// see Backend/src/domain/game-catalog.js): the seven real games, each
// with its real min/maxPlayers, are rendered as buttons and a match is
// only ever created with a gameId the server itself listed. Alongside
// that catalog this also renders the room's own real Game Center lobby
// (GET /api/games?roomId=X -- game-match.service.js#listByRoom) with
// join/leave/start/cancel actions, same "only show the button the server
// would actually allow" rule and same
// row()/render...List()/bind...Actions() shape as
// battleRow()/renderBattlesList()/bindBattleActions() above. Every field
// rendered (state, playerIds, startedBy) is copied verbatim from the
// server record -- no client-side game state is ever invented, since
// there is still no per-game rules engine (see POST /api/games/:id/finish
// on the server, deliberately left 403).
const GAME_STATE_LABEL={lobby:'قيد التجهيز',active:'جارية الآن',finished:'انتهت',cancelled:'ملغاة'};
function gameStateBadge(g){return `<span class="badge">${esc(GAME_STATE_LABEL[g.state]||g.state)}</span>`}
function gamePlayersLine(g){return `اللاعبون (${(g.playerIds||[]).length}): ${esc((g.playerIds||[]).join('، '))}`}
function gameRow(g){
  const isPlayer=(g.playerIds||[]).includes(state.userId), isHost=g.startedBy===state.userId;
  const btns=[];
  if(g.state==='lobby'&&!isPlayer){btns.push(`<button class="btn primary" data-game-join="${g.id}">انضمام</button>`)}
  if(g.state==='lobby'&&isPlayer&&!isHost){btns.push(`<button class="btn" data-game-leave="${g.id}">مغادرة</button>`)}
  if(g.state==='lobby'&&isHost){btns.push(`<button class="btn primary" data-game-start="${g.id}">بدء اللعبة</button>`);btns.push(`<button class="btn" data-game-cancel="${g.id}">إلغاء</button>`)}
  btns.push(`<button class="btn" data-game-view="${g.id}">التفاصيل</button>`);
  return `<div class="card"><b>اللعبة: ${esc(g.gameId)}</b> ${gameStateBadge(g)}<div class="muted">غرفة: ${esc(g.roomId)} · المضيف: ${esc(g.startedBy)}</div><div class="muted">${gamePlayersLine(g)}</div><div class="actions">${btns.join('')}</div></div>`;
}
// One catalog entry, rendered as a real "start" button -- the ONLY way a
// new match's gameId is ever chosen now (was: `prompt('معرف اللعبة
// (gameId)؟')`, a free string never validated against anything client-side).
function gameCatalogRow(game){return `<div class="card"><b>${esc(game.name)}</b><div class="muted">من ${esc(game.minPlayers)} إلى ${esc(game.maxPlayers)} لاعبين</div><div class="actions"><button class="btn primary" data-game-start-new="${esc(game.id)}">بدء لعبة ${esc(game.name)}</button></div></div>`}
// Fetches both the room's real Game Center lobby (GET /api/games?roomId=)
// and the real catalog (GET /api/games/catalog) and re-renders both --
// called on first open of a room's Game Center and after every action, so
// the UI always reflects the server's real current state, never a client
// guess.
async function renderRoomGameCenter(roomId){
  try{
    const [list,catalog]=await Promise.all([api('/api/games?roomId='+encodeURIComponent(roomId)),api('/api/games/catalog')]);
    $('#profileExtra').innerHTML=listCard('مركز ألعاب الغرفة',list,gameRow,'لا توجد ألعاب فـ هذه الغرفة بعد.')
      +listCard('بدء لعبة جديدة من الكتالوج',catalog,gameCatalogRow,'الكتالوج فارغ.');
    bindGameActions(roomId);
  }catch(e){toast(e.message)}
}
function bindGameActions(roomId){
  document.querySelectorAll('[data-game-join]').forEach(b=>b.onclick=async()=>{try{await api('/api/games/'+b.dataset.gameJoin+'/join',{method:'POST',body:JSON.stringify({})});toast('تم الانضمام للعبة');renderRoomGameCenter(roomId)}catch(e){toast(e.message)}});
  document.querySelectorAll('[data-game-leave]').forEach(b=>b.onclick=async()=>{try{await api('/api/games/'+b.dataset.gameLeave+'/leave',{method:'POST',body:JSON.stringify({})});toast('تمت مغادرة اللعبة');renderRoomGameCenter(roomId)}catch(e){toast(e.message)}});
  document.querySelectorAll('[data-game-cancel]').forEach(b=>b.onclick=async()=>{try{await api('/api/games/'+b.dataset.gameCancel+'/cancel',{method:'POST',body:JSON.stringify({})});toast('تم إلغاء اللعبة');renderRoomGameCenter(roomId)}catch(e){toast(e.message)}});
  document.querySelectorAll('[data-game-start]').forEach(b=>b.onclick=async()=>{try{await api('/api/games/'+b.dataset.gameStart+'/start',{method:'POST',body:JSON.stringify({})});toast('تم بدء اللعبة');renderRoomGameCenter(roomId)}catch(e){toast(e.message)}});
  document.querySelectorAll('[data-game-start-new]').forEach(b=>b.onclick=async()=>{try{await api('/api/games',{method:'POST',body:JSON.stringify({roomId,gameId:b.dataset.gameStartNew,version:'1'})});toast('تم بدء لعبة جديدة');renderRoomGameCenter(roomId)}catch(e){toast(e.message)}});
  document.querySelectorAll('[data-game-view]').forEach(b=>b.onclick=async()=>{
    try{
      const x=await api('/api/games/'+b.dataset.gameView);
      $('#profileExtra').innerHTML=resultCard('تفاصيل اللعبة',x)+'<div class="actions"><button class="btn" id="backToGames">رجوع لمركز الألعاب</button></div>';
      $('#backToGames').onclick=()=>renderRoomGameCenter(roomId);
    }catch(e){toast(e.message)}
  });
}
// Stage 23 (Mobile UI) -- Referral/Invite. GET /api/referral/my-code is
// idempotent (see platform.referral.myCode in feature-platform.js): the
// first call generates the caller's own code, every later call returns
// the SAME code back -- so this is always safe to call on open, never
// accumulates duplicate codes. The redeem code itself comes from a real
// prompt() (same single-field pattern as every other write action here --
// #family, #settingsBtn, #report, #ticket below), never a client-invented
// value; the server alone decides validity, self-referral, and the
// one-redemption-per-referee rule (see services/referral.service.js) --
// this UI only ever shows the real server response, success or error.
function referralCodeCard(rec){
  return `<h3>كود الإحالة الخاص بي</h3><div class="card"><b style="font-size:1.4em;letter-spacing:3px">${esc(rec.code)}</b><div class="muted">شارك هذا الكود مع صديقك. عند استخدامه لأول مرة تحصل أنت على مكافأة حقيقية تُضاف لمحفظتك من الخادم.</div></div>`;
}
async function renderMyReferralCode(){
  try{
    const rec=await api('/api/referral/my-code');
    $('#profileExtra').innerHTML=referralCodeCard(rec);
  }catch(e){toast(e.message)}
}
// Stage 23 -- Part 2 (Mobile UI): Room-in-Room breakout. The fixed
// decision this session implements -- creating/starting a breakout is
// host/owner-only -- is enforced by the SERVER (POST
// /api/rooms/:roomId/breakout is gated by requireRoomOwner, see
// Backend/src/routes/platform.routes.js), never faked or duplicated
// here client-side: the "start" button is shown to whoever asks (same
// "let the server decide" rule already used by #battles above, which
// also has no client-side ownership check before calling its own
// host-gated POST /api/battles), and a real 403 for a non-owner is
// surfaced verbatim via toast, never silently swallowed or hidden.
// `isHost` below (used only to decide whether to render the "end"
// button) is a real, server-supplied field (b.hostId), the same
// "only show the button the server would actually allow" rule
// gameRow()/battleRow() already use for their own host-only buttons.
const BREAKOUT_STATUS_LABEL={open:'مفتوحة',closed:'مغلقة'};
function breakoutStatusBadge(b){return `<span class="badge">${esc(BREAKOUT_STATUS_LABEL[b.status]||b.status)}</span>`}
function breakoutRow(b){
  const isHost=b.hostId===state.userId;
  const btns=[];
  if(b.status==='open'){
    btns.push(`<button class="btn primary" data-breakout-join="${b.id}">انضمام</button>`);
    btns.push(`<button class="btn" data-breakout-leave="${b.id}">مغادرة</button>`);
  }
  if(isHost&&b.status==='open'){btns.push(`<button class="btn" data-breakout-end="${b.id}">إنهاء الغرفة الفرعية</button>`)}
  return `<div class="card"><b>${esc(b.name)}</b> ${breakoutStatusBadge(b)}<div class="muted">المضيف: ${esc(b.hostId)}${b.capacity?` · السعة: ${esc(b.capacity)}`:''}</div><div class="actions">${btns.join('')}</div></div>`;
}
// Fetches the real, member-only list of this room's breakout(s) (GET
// /api/rooms/:roomId/breakout -- 403 server-side for anyone who is not a
// real member of the parent room) and re-renders it, called on first
// open and after every join/leave/end action so the UI always reflects
// the server's real current state.
async function renderRoomBreakout(roomId){
  try{
    const list=await api('/api/rooms/'+encodeURIComponent(roomId)+'/breakout');
    $('#profileExtra').innerHTML=listCard('الغرف الفرعية (Room-in-Room) لهذه الغرفة',list,breakoutRow,'لا توجد غرفة فرعية مفتوحة حالياً في هذه الغرفة.');
    bindBreakoutActions(roomId);
  }catch(e){toast(e.message)}
}
function bindBreakoutActions(roomId){
  document.querySelectorAll('[data-breakout-join]').forEach(b=>b.onclick=async()=>{try{await api('/api/rooms/breakout/'+b.dataset.breakoutJoin+'/join',{method:'POST',body:JSON.stringify({})});toast('تم الانضمام للغرفة الفرعية');renderRoomBreakout(roomId)}catch(e){toast(e.message)}});
  document.querySelectorAll('[data-breakout-leave]').forEach(b=>b.onclick=async()=>{try{await api('/api/rooms/breakout/'+b.dataset.breakoutLeave+'/leave',{method:'POST',body:JSON.stringify({})});toast('تمت مغادرة الغرفة الفرعية');renderRoomBreakout(roomId)}catch(e){toast(e.message)}});
  document.querySelectorAll('[data-breakout-end]').forEach(b=>b.onclick=async()=>{try{await api('/api/rooms/breakout/'+b.dataset.breakoutEnd+'/end',{method:'POST',body:JSON.stringify({})});toast('تم إنهاء الغرفة الفرعية');renderRoomBreakout(roomId)}catch(e){toast(e.message)}});
}
function nav(){return `<nav class="bottom"><button class="nav ${state.tab==='home'?'active':''}" data-tab="home">⌂<br>الرئيسية</button><button class="nav ${state.tab==='rooms'?'active':''}" data-tab="rooms">◉<br>الغرف</button><button class="nav ${state.tab==='events'?'active':''}" data-tab="events">★<br>الفعاليات</button><button class="nav ${state.tab==='wallet'?'active':''}" data-tab="wallet">◈<br>المحفظة</button><button class="nav ${state.tab==='profile'?'active':''}" data-tab="profile">●<br>حسابي</button></nav>`}
function shell(body){$('#app').innerHTML=`<div class="shell"><header class="top"><span class="brand">LiveRoom</span><span class="status">● ${state.connected?'متصل بالخادم':'غير متصل'}</span></header><main class="content">${body}</main>${nav()}</div>`;document.querySelectorAll('[data-tab]').forEach(b=>b.onclick=()=>{state.tab=b.dataset.tab;render()})}
function roomCard(r){return `<article class="card room"><div><div class="cover"></div><b>${esc(r.name)}</b><div class="muted"><span class="badge">${r.visibility}</span><span class="badge">🎙 ${r.micSeats}</span></div></div><button class="btn primary" data-join="${r.id}">دخول الغرفة</button><button class="btn" data-leave="${r.id}">مغادرة</button></article>`}
function esc(s){return String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]))}
// Stage 6 -- Home. Real tab-aware feed (live/following/popular/new) via
// GET /api/home/rooms, real category chips (counts from GET /api/home's
// categories field), and real read-only sections for every entry
// STAGES' home.entries lists (games/events/rankings/family/search/
// notifications) -- each backed by an existing, already-tested endpoint
// (see app.js header comments elsewhere for the write-side of each
// domain). Every section has its own honest loading/error/empty state;
// nothing here is a placeholder or fabricated count.
const HOME_TABS=[['live','مباشر'],['following','متابعة'],['popular','شعبي'],['new','جديد']];
function eventRow(e){return `<div class="card"><b>${esc(e.name)}</b><div class="muted">${esc(e.startAt)} → ${esc(e.endAt)}</div><span class="badge">${esc(e.status)}</span></div>`}
function familyRow(f){return `<div class="card"><b>${esc(f.name)}</b><div class="muted">المالك: ${esc(f.ownerId)} · المستوى: ${esc(f.level)}</div></div>`}
function searchResultRow(x){return `<div class="card"><span class="badge">${esc(x.type)}</span><b> ${esc(x.name||x.id)}</b></div>`}
// Generic loader for one Home section: shows a real loading state, then
// replaces it with the real result or a real error -- never both at once,
// and never a fake success on failure.
async function loadHomeSection(containerId,fetcher,render,emptyMsg){
  const el=$('#'+containerId);if(!el)return;
  el.innerHTML='<div class="empty">جارِ التحميل...</div>';
  try{
    const data=await fetcher();
    const items=Array.isArray(data)?data:(data?.results||data?.rooms||[]);
    el.innerHTML=items.length?items.map(render).join(''):`<div class="empty">${esc(emptyMsg)}</div>`;
  }catch(e){el.innerHTML=`<div class="empty">تعذر التحميل: ${esc(e.message)}</div>`}
}
function homeCatChip(id,label){return `<button class="chip ${state.homeCategory===id?'active':''}" data-homecat="${id}">${esc(label)}</button>`}
// Real, per-tab room feed loader. Each call shows a real loading state in
// #homeRoomsGrid FIRST (no blocking the whole Home render on this
// network round-trip), then replaces it with the real GET
// /api/home/rooms?tab=... result, or a real error -- exactly the
// loading/error/empty triad the other Home sections already had.
async function loadHomeRoomsTab(){
  const el=$('#homeRoomsGrid');
  if(el)el.innerHTML='<div class="empty">جارِ تحميل الغرف...</div>';
  try{
    const qs=new URLSearchParams({tab:state.homeTab});if(state.homeCategory)qs.set('category',state.homeCategory);
    const rooms=await api('/api/home/rooms?'+qs.toString());
    state.rooms=rooms;
    if(el)el.innerHTML=rooms.length?rooms.map(roomCard).join(''):'<div class="empty">لا توجد غرف في هذا التبويب بعد.</div>';
  }catch(e){if(el)el.innerHTML=`<div class="empty">تعذر تحميل الغرف: ${esc(e.message)}</div>`}
  bindRooms();
}
// Real category chips + events list, both sourced from the same enriched
// GET /api/home (categories/events/unreadNotifications -- see
// Backend/src/routes/platform.routes.js). Loaded lazily, with its own
// loading/error state, so switching tabs never has to wait on this.
async function loadHomeSummary(){
  const catsEl=$('#homeCats'),evEl=$('#homeEvents'),bellEl=$('#notifBell');
  if(catsEl)catsEl.innerHTML='<div class="empty">جارِ تحميل الفئات...</div>';
  if(evEl)evEl.innerHTML='<div class="empty">جارِ تحميل الفعاليات...</div>';
  try{
    const d=await api('/api/home');
    state.events=d.events||[];state.categories=d.categories||[];state.unreadNotifications=d.unreadNotifications||0;
    if(catsEl){
      catsEl.innerHTML=state.categories.length?(homeCatChip('','الكل')+state.categories.map(c=>homeCatChip(c.id,c.name+' ('+c.count+')')).join('')):'';
      document.querySelectorAll('[data-homecat]').forEach(b=>b.onclick=()=>{state.homeCategory=b.dataset.homecat;state.homeTab=state.homeTab;home()});
    }
    if(evEl)evEl.innerHTML=state.events.length?state.events.map(eventRow).join(''):'<div class="empty">لا توجد فعاليات بعد.</div>';
    if(bellEl)bellEl.innerHTML=`🔔${state.unreadNotifications>0?`<span class="badge">${state.unreadNotifications}</span>`:''}`;
  }catch(e){
    if(catsEl)catsEl.innerHTML=`<div class="empty">تعذر تحميل الفئات: ${esc(e.message)}</div>`;
    if(evEl)evEl.innerHTML=`<div class="empty">تعذر تحميل الفعاليات: ${esc(e.message)}</div>`;
  }
}
async function home(){
  state.homeTab=state.homeTab||'live';
  state.homeCategory=state.homeCategory||'';
  state.rankType=state.rankType||'wealth';
  state.unreadNotifications=state.unreadNotifications||0;
  const tabsHtml=HOME_TABS.map(([id,label])=>`<button class="chip ${state.homeTab===id?'active':''}" data-hometab="${id}">${label}</button>`).join('');
  const rankTypes=[['wealth','الأغنياء'],['charm','الأكثر جاذبية'],['family','العائلات']];
  // Shell renders immediately -- every data-backed section below starts in
  // its own real loading state and is filled in (or shown a real error/
  // empty state) by the async loaders kicked off at the end of this
  // function. Nothing here blocks the initial paint on a network call.
  shell(`<section class="hero"><div class="muted">مساحة اجتماعية مباشرة</div><div style="display:flex;justify-content:space-between;align-items:flex-start"><h1>اكتشف الغرف الآن</h1><button class="btn" id="notifBell">🔔${state.unreadNotifications>0?`<span class="badge">${state.unreadNotifications}</span>`:''}</button></div><p class="muted">البيانات المعروضة هنا تأتي من Backend محلي حقيقي، وليست بيانات واجهة ثابتة.</p><div class="actions"><button class="btn primary" id="newRoom">إنشاء غرفة</button><button class="btn" id="refresh">تحديث</button></div></section>
  <div class="tabs" id="homeTabs">${tabsHtml}</div>
  <div id="homeCats"><div class="empty">جارِ تحميل الفئات...</div></div>
  <h3>الغرف</h3><div class="grid" id="homeRoomsGrid"><div class="empty">جارِ تحميل الغرف...</div></div>
  <h3>البحث</h3><input class="field" id="homeSearchInput" placeholder="ابحث عن مستخدم/غرفة/عائلة/لعبة"><div id="homeSearchResults" class="list"></div>
  <h3>الفعاليات</h3><div class="list" id="homeEvents"><div class="empty">جارِ تحميل الفعاليات...</div></div>
  <h3>ألعابي</h3><div class="list" id="homeGames"><div class="empty">جارِ التحميل...</div></div>
  <h3>الترتيب</h3><div class="tabs" id="homeRankTypes">${rankTypes.map(([id,label])=>`<button class="chip ${state.rankType===id?'active':''}" data-ranktype="${id}">${label}</button>`).join('')}</div><div class="list" id="homeRankings"><div class="empty">جارِ التحميل...</div></div>
  <h3>العائلات</h3><div class="list" id="homeFamilies"><div class="empty">جارِ التحميل...</div></div>
  <h3>الإشعارات</h3><div class="list" id="homeNotifications"><div class="empty">جارِ التحميل...</div></div>`);
  bindHomeControls();
  loadHomeRoomsTab();loadHomeSummary();loadHomeSections();
}
function bindHomeControls(){
  document.querySelectorAll('[data-hometab]').forEach(b=>b.onclick=()=>{state.homeTab=b.dataset.hometab;home()});
  document.querySelectorAll('[data-ranktype]').forEach(b=>b.onclick=()=>{state.rankType=b.dataset.ranktype;home()});
  $('#refresh')?.addEventListener('click',render);
  $('#newRoom')?.addEventListener('click',createRoom);
  $('#notifBell')?.addEventListener('click',()=>{state.tab='profile';render()});
  const runSearch=async()=>{
    const q=$('#homeSearchInput').value.trim();
    const el=$('#homeSearchResults');
    if(!q){el.innerHTML='';return}
    el.innerHTML='<div class="empty">جارِ البحث...</div>';
    try{const r=await api('/api/search?q='+encodeURIComponent(q));el.innerHTML=r.results.length?r.results.map(searchResultRow).join(''):'<div class="empty">لا نتائج.</div>'}
    catch(e){el.innerHTML=`<div class="empty">تعذر البحث: ${esc(e.message)}</div>`}
  };
  let searchDebounce;
  $('#homeSearchInput')?.addEventListener('input',()=>{clearTimeout(searchDebounce);searchDebounce=setTimeout(runSearch,350)});
}
function loadHomeSections(){
  loadHomeSection('homeGames',()=>api('/api/games'),genericRow,'لا توجد ألعاب بعد.');
  loadHomeSection('homeRankings',()=>api('/api/rankings/'+state.rankType),genericRow,'لا يوجد ترتيب بعد.');
  loadHomeSection('homeFamilies',()=>api('/api/families'),familyRow,'لا توجد عائلات بعد.');
  loadHomeSection('homeNotifications',()=>api('/api/notifications/'+state.userId),notificationRow,'لا توجد إشعارات بعد.');
}
function bindRooms(){document.querySelectorAll('[data-join]').forEach(b=>b.onclick=async()=>{try{await api('/api/rooms/'+b.dataset.join+'/join',{method:'POST',body:JSON.stringify({})});toast('تم تسجيل دخولك للغرفة على الخادم');}catch(e){toast(e.message)}});document.querySelectorAll('[data-leave]').forEach(b=>b.onclick=async()=>{try{await api('/api/rooms/'+b.dataset.leave+'/leave',{method:'POST',body:JSON.stringify({})});toast('تمت مغادرة الغرفة');}catch(e){toast(e.message)}})}
async function createRoom(){const name=prompt('اسم الغرفة؟');if(!name)return;try{await api('/api/rooms',{method:'POST',body:JSON.stringify({name,micSeats:8,visibility:'public'})});toast('تم إنشاء الغرفة');render()}catch(e){toast(e.message)}}
async function rooms(){state.rooms=await api('/api/rooms');shell(`<h2>الغرف</h2><p class="muted">قائمة الغرف الحالية من الخادم.</p><div class="list">${state.rooms.length?state.rooms.map(roomCard).join(''):'<div class="empty">لا توجد غرف.</div>'}</div>`);bindRooms()}
async function events(){state.events=await api('/api/events');shell(`<h2>الفعاليات</h2><p class="muted">الفعاليات المسجلة في Backend.</p><div class="list">${state.events.length?state.events.map(eventRow).join(''):'<div class="empty">لا توجد فعاليات بعد.</div>'}</div>`)}
// Phase 3 — wallet screen. Backend/src/routes/platform.routes.js only
// exposes READ-ONLY wallet endpoints to a mobile session
// (/api/wallet/:userId and /api/wallet/:userId/balance, both locked to the
// caller's own account via assertOwnAccount). Crediting/debiting is
// intentionally NOT reachable from here -- that only happens through the
// separate, service-key-protected internal wallet router -- so this
// screen has no "add coins" button; adding one would be fake, since no
// real endpoint backs it.
function ledgerRow(l){return `<div class="card"><b>${esc(l.currency)} ${l.amount>0?'+':''}${esc(l.amount)}</b><div class="muted">${esc(l.status)} · ref: ${esc(l.referenceId)}</div></div>`}
// Stage 25 (Mobile UI) -- Recharge / Google Play Billing. This shell has
// no real Google Play Billing native library to invoke (it is a web
// shell, not a native Android app), so this UI does not, and cannot
// honestly, obtain a real purchaseToken itself. What it DOES do for
// real: fetch the real server-side package catalog (GET
// /api/recharge/packages, never hardcoded packageId/coins values), open
// a real pending order for a chosen package (POST /api/recharge/orders,
// provider fixed to 'google_play' here since that is this button's
// label -- accountId always comes from the session server-side, never
// sent by this client), and submit whatever purchase token the user
// provides (the same single prompt() pattern already used for every
// other externally-sourced value in this app, e.g. the referral code
// above) to the real completion endpoint (POST
// /api/recharge/orders/:orderId/complete). The server alone decides
// whether that token verifies -- see
// Backend/src/services/recharge-provider-verifier.js, which fails
// closed with a real 503 when no provider is configured (as in this
// sandbox) rather than ever faking a "verified" purchase. Any real
// server response, success or failure, is shown verbatim; nothing here
// invents a credited balance.
function rechargePackageRow(pkg){return `<div class="card"><b>${esc(pkg.coins)} 🪙</b><div class="muted">Package: ${esc(pkg.id)}</div><div class="actions"><button class="btn primary" data-recharge-buy="${esc(pkg.id)}">شراء عبر Google Play</button></div></div>`}
const RECHARGE_STATUS_LABEL={pending:'قيد الانتظار',completed:'مكتمل',failed:'فشل'};
function rechargeOrderRow(o){
  const btns=[];
  if(o.status==='pending')btns.push(`<button class="btn" data-recharge-complete="${esc(o.id)}">إكمال الشراء</button>`);
  return `<div class="card"><b>${esc(o.coinsToCredit)} 🪙</b> <span class="badge">${esc(RECHARGE_STATUS_LABEL[o.status]||o.status)}</span><div class="muted">Order: ${esc(o.id)} · Provider: ${esc(o.provider)}${o.failureReason?` · ${esc(o.failureReason)}`:''}</div><div class="actions">${btns.join('')}</div></div>`;
}
function bindRechargeActions(){
  document.querySelectorAll('[data-recharge-buy]').forEach(b=>b.onclick=async()=>{
    try{
      const order=await api('/api/recharge/orders',{method:'POST',body:JSON.stringify({packageId:b.dataset.rechargeBuy,provider:'google_play'})});
      $('#walletExtra').innerHTML=resultCard('تم إنشاء طلب شحن حقيقي على الخادم — أكمل الشراء عبر Google Play ثم اضغط "إكمال الشراء"',order);
      bindRechargeActions();
    }catch(e){toast(e.message)}
  });
  document.querySelectorAll('[data-recharge-complete]').forEach(b=>b.onclick=async()=>{
    const providerPurchaseRef=prompt('رمز إثبات الشراء الحقيقي من Google Play (providerPurchaseRef)؟');if(!providerPurchaseRef)return;
    try{
      const order=await api('/api/recharge/orders/'+encodeURIComponent(b.dataset.rechargeComplete)+'/complete',{method:'POST',body:JSON.stringify({providerPurchaseRef})});
      $('#walletExtra').innerHTML=resultCard('تم التحقق الحقيقي من الشراء وإضافة الرصيد على الخادم',order);
      toast('تمت إضافة الرصيد بنجاح');
    }catch(e){toast(e.message)}
  });
}
async function renderRechargePackages(){
  try{
    const packages=await api('/api/recharge/packages');
    $('#walletExtra').innerHTML=listCard('باقات الشحن (Google Play)',packages,rechargePackageRow,'لا توجد باقات متاحة حالياً.');
    bindRechargeActions();
  }catch(e){toast(e.message)}
}
async function renderMyRechargeOrders(){
  try{
    const orders=await api('/api/recharge/orders');
    $('#walletExtra').innerHTML=listCard('طلبات الشحن السابقة',orders,rechargeOrderRow,'لا توجد طلبات شحن بعد.');
    bindRechargeActions();
  }catch(e){toast(e.message)}
}
async function wallet(){
  const [balance,ledger]=await Promise.all([api('/api/wallet/'+state.userId+'/balance'),api('/api/wallet/'+state.userId)]);
  shell(`<div class="hero"><div class="muted">المحفظة</div><h1>${esc(balance.coins)} 🪙 &nbsp; ${esc(balance.diamonds)} 💎</h1><p class="muted">الرصيد الحقيقي من الخادم. الشحن هنا حقيقي أيضاً عبر Google Play Billing — لا تُضاف أي عملة إلا بعد تحقق حقيقي من المزوّد على الخادم.</p><div class="actions"><button class="btn primary" id="rechargePackages">شحن الرصيد (Google Play)</button><button class="btn" id="rechargeOrders">طلبات الشحن السابقة</button></div></div><h3>سجل الحركات</h3><div class="list">${ledger.length?ledger.map(ledgerRow).join(''):'<div class="empty">لا توجد حركات بعد.</div>'}</div><div id="walletExtra"></div>`);
  $('#rechargePackages').onclick=renderRechargePackages;
  $('#rechargeOrders').onclick=renderMyRechargeOrders;
}
// Phase 3 (continued) — notifications view. Backend/src/routes/platform.routes.js
// exposes GET /api/notifications/:userId (stage 33) as a real, session-locked,
// read-only endpoint (assertOwnAccount -- a session can only ever read its own
// queue, same rule as the wallet endpoints above). There is no enqueue/write
// route reachable from a mobile session (notifications.enqueue in
// feature-platform.js is only called server-side), so this view has no
// "mark as read"/compose button -- there is no real endpoint behind either
// action yet, and adding one would be exactly the fake-UI this build must
// avoid. An empty list here is a true, honest state (no notification has been
// enqueued for this account yet), not a loading placeholder.
function notificationRow(n){return `<div class="card"><b>${esc(n.type)}</b><div class="muted">${esc(n.status)} · ${esc(n.createdAt||'')}</div></div>`}
// Stage 7 audit fix (Mobile UI) -- the profile screen used to fetch the
// plain GET /api/profile/:userId (base record only: id/name/bio/avatarUrl)
// and render nothing but the name + account id, even though the real
// composed view (LVL/VIP/SVIP + real Followers/Following/Friends counts +
// avatar + bio, all already implemented server-side in
// platform.profile.getFull(), see feature-platform.js) was sitting unused
// behind GET /api/profile/:userId/full. Self-view (viewerId===targetId)
// always passes getFull()'s privacy gate, so this is safe for the
// caller's own profile. Falls back to the plain endpoint only if /full
// itself fails (e.g. no profile created yet -- both 404 the same way),
// so "no profile yet" still renders honestly instead of throwing.
function profileStandingLine(p){
  if(!p)return'';
  const bits=[];
  if(p.lvl!==undefined)bits.push(`LVL ${esc(p.lvl)}`);
  if(p.vip)bits.push(`<span class="badge">VIP ${esc(p.vip)}</span>`);
  if(p.svip)bits.push(`<span class="badge">SVIP ${esc(p.svip)}</span>`);
  return bits.length?`<p class="muted">${bits.join(' · ')}</p>`:'';
}
function profileCountsLine(p){
  if(!p||p.privacyRestricted)return'';
  if(p.followersCount===undefined)return'';
  return `<p class="muted">المتابِعون: ${esc(p.followersCount)} · المتابَعون: ${esc(p.followingCount)} · الأصدقاء: ${esc(p.friendsCount)}</p>`;
}
// Stage 7 completion (this session) -- Family title/badges and Couple
// status are the SAME "public standing" tier as LVL/VIP/SVIP above (real
// server data from platform.profile.getFull(), never privacy-gated --
// present even when p.privacyRestricted is true, see
// feature-platform.js's Stage 7 completion comments), so this sits next to
// profileStandingLine() rather than profileCountsLine().
function profileFamilyCoupleLine(p){
  if(!p)return'';
  const bits=[];
  if(p.family)bits.push(`<span class="badge">عائلة: ${esc(p.family.title)}</span>`);
  if(p.couple)bits.push(`<span class="badge">مرتبط (CP LVL ${esc(p.couple.level)})</span>`);
  return bits.length?`<p class="muted">${bits.join(' · ')}</p>`:'';
}
// Stage 7 completion (this session) -- Gifts received is the SAME privacy
// tier as followers/following/friends (see feature-platform.js's Stage 7
// completion comment on the `gifts` field: gated behind the same
// canSeeFull check, absent entirely from the privacyRestricted branch), so
// this checks `p.gifts` the same way profileCountsLine() checks
// p.followersCount, not the unconditional way profileFamilyCoupleLine()
// does above.
function profileGiftsLine(p){
  if(!p||p.privacyRestricted)return'';
  if(!p.gifts)return'';
  return `<p class="muted">الهدايا المستلمة: ${esc(p.gifts.count)} (${esc(p.gifts.totalCoins)} عملة)</p>`;
}
async function profile(){
  let p=null;try{p=await api('/api/profile/'+state.userId+'/full')}catch{try{p=await api('/api/profile/'+state.userId)}catch{}}
  // Stage 34 -- apply the caller's real persisted language on every
  // profile open (the only screen this build reliably re-renders after
  // login), same real GET /api/settings/:userId used by #settingsList
  // below. Failure here (e.g. a test harness that doesn't mock this URL)
  // must never break the rest of the profile screen, so it is silent.
  try{const s=await api('/api/settings/'+state.userId);applySettingEffect('language',s.language)}catch{}
  const avatarHtml=p?.avatarUrl?`<img class="avatar" src="${esc(p.avatarUrl)}" alt="">`:'';
  shell(`<div class="hero">${avatarHtml}<div class="muted">الحساب</div><h1>${p?esc(p.name):'حساب بلا ملف بعد'}</h1><p class="muted">Account ID: ${esc(state.userId)}</p>${profileStandingLine(p)}${profileFamilyCoupleLine(p)}${p?.bio?`<p class="muted">${esc(p.bio)}</p>`:''}${profileCountsLine(p)}${profileGiftsLine(p)}<div class="actions"><button class="btn primary" id="createProfile">إنشاء/تحديث الملف</button><button class="btn" id="editPrivacy">إعدادات الخصوصية</button><button class="btn" id="shareProfile">مشاركة الملف الشخصي</button><button class="btn" id="notifications">الإشعارات</button><button class="btn" id="state">حالة الخادم</button><button class="btn" id="logout">تسجيل الخروج</button></div></div>
  <h3>ميزات إضافية</h3><p class="muted">كل زر هنا يستدعي endpoint حقيقي وموجود مسبقاً في الخادم. الصف الأول للكتابة والثاني لقراءة السجل الحقيقي من الخادم (GET).</p>
  <div class="actions"><button class="btn" id="battles">تحدٍ (Battle)</button><button class="btn" id="games">بدء لعبة</button><button class="btn" id="gifts">إرسال هدية</button><button class="btn" id="family">إنشاء عائلة</button><button class="btn" id="settingsBtn">حفظ إعداد</button><button class="btn" id="report">إبلاغ عن مستخدم</button><button class="btn" id="ticket">تذكرة دعم</button><button class="btn danger" id="block">حظر مستخدم</button><button class="btn" id="unblock">إلغاء حظر مستخدم</button><button class="btn" id="muteUser">كتم مستخدم</button><button class="btn" id="unmuteUser">إلغاء كتم مستخدم</button></div>
  <div class="actions"><button class="btn" id="battlesList">تحدياتي</button><button class="btn" id="gamesList">ألعابي</button><button class="btn" id="giftsWall">جدار الهدايا</button><button class="btn" id="familiesList">العائلات</button><button class="btn" id="settingsList">إعداداتي</button><button class="btn" id="reportsList">بلاغاتي</button><button class="btn" id="ticketsList">تذاكري</button></div>
  <h3>الأصدقاء والمتابعة (Stage 10)</h3><p class="muted">متابعة/إلغاء متابعة وطلبات صداقة حقيقية عبر الخادم (POST /api/follow، /api/friend، /api/friends/:id/accept|reject)، وقوائم حقيقية للمتابِعين والمتابَعين والأصدقاء (GET).</p>
  <div class="actions"><button class="btn primary" id="followUser">متابعة مستخدم</button><button class="btn" id="unfollowUser">إلغاء متابعة</button><button class="btn" id="friendRequest">إرسال طلب صداقة</button></div>
  <div class="actions"><button class="btn" id="friendAccept">قبول طلب صداقة</button><button class="btn" id="friendReject">رفض طلب صداقة</button></div>
  <div class="actions"><button class="btn" id="friendsList">أصدقائي</button><button class="btn" id="followersList">المتابِعون</button><button class="btn" id="followingList">المتابَعون</button></div>
  <h3>الإعدادات العامة (Stage 34)</h3><p class="muted">الشروط والمساعدة (محتوى حقيقي من الخادم) وحذف الحساب (تعطيل حقيقي + إنهاء كل الجلسات).</p>
  <div class="actions"><button class="btn" id="settingsTerms">الشروط والأحكام</button><button class="btn" id="settingsHelp">المساعدة</button><button class="btn danger" id="deleteAccount">حذف الحساب</button></div>
  <h3>الإحالة / دعوة صديق</h3><p class="muted">كود إحالتك الخاص من الخادم، واستخدام كود صديق للحصول على مكافأة حقيقية.</p>
  <div class="actions"><button class="btn primary" id="referralCode">كود الإحالة الخاص بي</button><button class="btn" id="referralRedeem">استخدام كود إحالة</button></div>
  <h3>غرفة داخل الغرفة (Room-in-Room)</h3><p class="muted">بدء/إنشاء غرفة فرعية مسموح فقط لمالك الغرفة الرئيسية — القرار يُفرض من الخادم نفسه، لا من هذا التطبيق. أي عضو حقيقي في الغرفة الرئيسية يمكنه عرض الغرف الفرعية المفتوحة والانضمام إليها.</p>
  <div class="actions"><button class="btn primary" id="breakoutCreate">بدء غرفة فرعية</button><button class="btn" id="breakoutView">عرض الغرف الفرعية</button></div>
  <h3>الصوت المباشر (Agora RTC)</h3><p class="muted">دخول/خروج القناة الصوتية الحقيقية لغرفة ما. الدور (مضيف/مستمع) والتوكن يُقرَّران من الخادم فقط.</p>
  <div class="actions"><button class="btn primary" id="voiceJoin">دخول صوتي لغرفة</button><button class="btn" id="voiceLeave">مغادرة الصوت</button></div>
  <div id="profileExtra"></div>`);
  // Stage 7 audit fix -- name/bio/avatarUrl were being overwritten with
  // ('New User'/''/omitted) on every save because this prompt never
  // offered the caller's own existing values back for bio/avatarUrl (only
  // name had a default). platform.profile.create() is a real upsert (see
  // feature-platform.js), so an update that omits avatarUrl already
  // preserves the existing one server-side -- but bio has no such
  // fallback (empty input there really does clear it), so it must be
  // pre-filled here to make "update just the name" not silently erase
  // the bio.
  $('#createProfile').onclick=async()=>{
    const name=prompt('الاسم؟',p?.name||'New User');if(!name)return;
    const bio=prompt('نبذة (Bio)؟ اتركها فارغة لحذفها.',p?.bio||'');if(bio===null)return;
    const avatarUrl=prompt('رابط الصورة الشخصية (Avatar URL)؟',p?.avatarUrl||'');if(avatarUrl===null)return;
    try{const x=await api('/api/profile',{method:'POST',body:JSON.stringify({name,bio,avatarUrl})});toast('تم حفظ الملف: '+x.id)}catch(e){toast(e.message)}
  };
  // Stage 8 audit fix (Mobile UI) -- platform.profile.updatePrivacy()
  // (POST /api/profile/privacy) existed server-side with full test
  // coverage, but nothing in this app ever called it: there was no way
  // for a real user to ever change their own privacy settings, only to
  // have Stage 7's defaults applied forever. Shows the real current
  // values (from the same full-profile fetch above, refetched here in
  // case another tab/session changed them) and only sends the one field
  // the caller actually chooses to change -- updatePrivacy() merges a
  // partial patch, matching this app's existing prompt-per-field pattern
  // (#settingsBtn above).
  $('#editPrivacy').onclick=async()=>{
    const key=prompt('أي إعداد تريد تغييره؟ (profileVisibility / discoverable / whoCanMessage / showLastSeen / whoCanInviteToRoom)');if(!key)return;
    const allowed=['profileVisibility','discoverable','whoCanMessage','showLastSeen','whoCanInviteToRoom'];
    if(!allowed.includes(key)){toast('إعداد خصوصية غير معروف — استخدم: '+allowed.join(', '));return}
    let value;
    if(key==='profileVisibility'){value=prompt('الظهور؟ (public / friends / private)')}
    else if(key==='whoCanMessage'||key==='whoCanInviteToRoom'){value=prompt((key==='whoCanMessage'?'من يمكنه مراسلتي؟':'من يمكنه دعوتي للغرفة؟')+' (everyone / friends / nobody)')}
    else{const raw=prompt((key==='discoverable'?'قابل للاكتشاف في البحث؟':'إظهار آخر ظهور؟')+' (yes/no)');if(raw===null)return;value=raw.trim().toLowerCase()==='yes'}
    if(value===null||value===undefined||value==='')return;
    try{const x=await api('/api/profile/privacy',{method:'POST',body:JSON.stringify({[key]:value})});
      $('#profileExtra').innerHTML=resultCard('تم حفظ إعداد الخصوصية على الخادم',x.privacy||x);
    }catch(e){toast(e.message)}
  };
  // Stage 7 internal gap fix (this session) -- profile.shareLink()
  // (GET /api/profile/:userId/share) has existed on the backend, fully
  // tested, since an earlier session (see feature-platform.js's header
  // comment on shareLink()), but nothing in this app ever called it --
  // no button, no wiring, no test. This calls the REAL existing
  // endpoint for the caller's own profile id and renders the REAL
  // deepLink it returns; it never fabricates a local link. Uses the
  // same resultCard() renderer + #profileExtra target as every other
  // read-only server action on this screen (#notifications/#state
  // below), so it matches this app's own established pattern rather
  // than introducing a new UI convention.
  $('#shareProfile').onclick=async()=>{
    try{const x=await api('/api/profile/'+state.userId+'/share');
      $('#profileExtra').innerHTML=resultCard('رابط مشاركة الملف الشخصي',x);
    }catch(e){toast(e.message)}
  };
  $('#notifications').onclick=async()=>{try{const list=await api('/api/notifications/'+state.userId);$('#profileExtra').innerHTML='<h3>الإشعارات</h3><div class="list">'+(list.length?list.map(notificationRow).join(''):'<div class="empty">لا توجد إشعارات بعد.</div>')+'</div>'}catch(e){toast(e.message)}};
  $('#state').onclick=async()=>{const x=await api('/api/state');$('#profileExtra').innerHTML='<div class="card"><b>حالة وظائف الخادم</b><p class="muted">'+Object.entries(x).map(([k,v])=>`${esc(k)}: ${v}`).join('<br>')+'</p></div>'};
  // Stage 18 -- Battles. POST /api/battles creates; hostId is taken from
  // the session server-side. Phase 4 -- GET /api/battles now exists ("my
  // battles", any battle where the caller is host or opponent) — see
  // #battlesList below.
  $('#battles').onclick=async()=>{
    const roomId=prompt('معرف الغرفة (roomId)؟');if(!roomId)return;
    const opponentId=prompt('معرف الخصم (opponentId)؟');if(!opponentId)return;
    try{const x=await api('/api/battles',{method:'POST',body:JSON.stringify({roomId,opponentId})});
      $('#profileExtra').innerHTML=resultCard('تم إنشاء تحدٍ حقيقي على الخادم',x);
    }catch(e){toast(e.message)}
  };
  // Stage 19 (Mobile UI) -- Room Game Center. Only prompts for roomId now;
  // gameId is no longer a free prompt() string -- it is chosen from the
  // real server catalog (GET /api/games/catalog) via gameCatalogRow()'s
  // buttons, and the room's own existing lobby (GET /api/games?roomId=)
  // is shown alongside it with join/leave/start/cancel -- see
  // renderRoomGameCenter()/gameRow()/bindGameActions() above. startedBy
  // is still taken from the session server-side (client never sends it —
  // same rule as hostId above). Phase 4 -- GET /api/games with no query
  // ("my games", scoped by startedBy) is unchanged — see #gamesList below.
  $('#games').onclick=async()=>{
    const roomId=prompt('معرف الغرفة (roomId)؟');if(!roomId)return;
    await renderRoomGameCenter(roomId);
  };
  // Stage 26 -- Gifts. POST /api/gifts/send only; senderId comes from the
  // session. referenceId is a client-minted idempotency token (genRef()),
  // not fabricated gift/business data. Phase 4 -- GET /api/gifts/wall/:roomId
  // now exists (room-scoped gift wall, public to any session) — see
  // #giftsWall below.
  $('#gifts').onclick=async()=>{
    const roomId=prompt('معرف الغرفة (roomId)؟');if(!roomId)return;
    const receiverId=prompt('معرف المستلم (receiverId)؟');if(!receiverId)return;
    const giftId=prompt('معرف الهدية (giftId)؟');if(!giftId)return;
    const quantity=parseInt(prompt('الكمية؟','1')||'1',10)||1;
    try{const x=await api('/api/gifts/send',{method:'POST',body:JSON.stringify({roomId,receiverId,giftId,quantity,referenceId:genRef()})});
      $('#profileExtra').innerHTML=resultCard('تم إرسال هدية حقيقية على الخادم',x);
    }catch(e){toast(e.message)}
  };
  // Stage 30 -- Family. POST /api/families only (create); ownerId comes
  // from the session. Phase 4 -- GET /api/families now exists (a public
  // browse directory; there is still no join/membership endpoint) — see
  // #familiesList below.
  $('#family').onclick=async()=>{
    const name=prompt('اسم العائلة؟');if(!name)return;
    try{const x=await api('/api/families',{method:'POST',body:JSON.stringify({name})});
      $('#profileExtra').innerHTML=resultCard('تم إنشاء عائلة حقيقية على الخادم',x);
    }catch(e){toast(e.message)}
  };
  // Stage 34 -- General Settings. POST /api/settings; userId comes from
  // the session. The key catalog is exactly the five real preferences
  // Backend/src/database/models/settings.model.js validates
  // (language/sound/mic/network/media) — free-text keys outside that
  // list are rejected by the real server (400), same as any other write
  // action here; this client does not invent a sixth key. Once the
  // server confirms the write, the real client-side effect for that key
  // (language dir/lang, mic mute) is applied immediately via
  // applySettingEffect() — see its definition above.
  $('#settingsBtn').onclick=async()=>{
    const key=prompt('اسم الإعداد (language/sound/mic/network/media)؟');if(!key)return;
    let value;
    if(key==='language'){value=prompt('اللغة؟ (ar / en)')}
    else if(key==='sound'||key==='mic'||key==='media'){
      const raw=prompt((key==='mic'?'كتم الميكروفون؟':key+' مفعّل؟')+' (yes/no)');
      if(raw===null)return;
      value=raw.trim().toLowerCase()==='yes';
    }else if(key==='network'){value=prompt('وضع الشبكة؟ (wifi_only / wifi_and_cellular)')}
    else{toast('إعداد غير معروف — استخدم: language, sound, mic, network, media');return}
    if(value===null||value===undefined||value==='')return;
    try{const x=await api('/api/settings',{method:'POST',body:JSON.stringify({key,value})});
      applySettingEffect(key,value);
      $('#profileExtra').innerHTML=resultCard('تم حفظ إعداد حقيقي على الخادم',x);
    }catch(e){toast(e.message)}
  };
  // Stage 34 -- Terms/Help. Real, static, versioned server content (see
  // Backend/src/domain/legal-content.js) — never an invented CMS.
  $('#settingsTerms').onclick=async()=>{try{const x=await api('/api/settings/terms');$('#profileExtra').innerHTML=resultCard('الشروط والأحكام',x)}catch(e){toast(e.message)}};
  $('#settingsHelp').onclick=async()=>{try{const x=await api('/api/settings/help');$('#profileExtra').innerHTML=resultCard('المساعدة',x)}catch(e){toast(e.message)}};
  // Stage 34 -- Delete Account. Real soft-delete + real force-logout of
  // every active session (see settings.service.js#deleteAccount()) --
  // never a fake "success" with no server-side effect. The client's own
  // session is immediately discarded and the user is sent back to login,
  // matching the real server-side session revocation that just happened.
  $('#deleteAccount').onclick=async()=>{
    if(!confirm('هل أنت متأكد من حذف الحساب؟ سيتم تعطيله وإنهاء كل الجلسات النشطة.'))return;
    try{
      await api('/api/settings/account/delete',{method:'POST',body:JSON.stringify({})});
      toast('تم حذف الحساب');
      sessionStorage.removeItem('accessToken');sessionStorage.removeItem('accountId');
      goToLogin();
    }catch(e){toast(e.message)}
  };
  // Stage 35 -- Moderation + Support. Two real, separate write endpoints:
  // POST /api/moderation/report and POST /api/support/tickets. reporterId
  // comes from the session in both cases. Phase 4 -- GET /api/moderation/reports
  // and GET /api/support/tickets now exist (each self-scoped to the caller)
  // — see #reportsList / #ticketsList below.
  $('#report').onclick=async()=>{
    const targetId=prompt('معرف المستخدم المُبلَّغ عنه (targetId)؟');if(!targetId)return;
    const reason=prompt('سبب الإبلاغ؟');if(!reason)return;
    try{const x=await api('/api/moderation/report',{method:'POST',body:JSON.stringify({targetId,reason})});
      $('#profileExtra').innerHTML=resultCard('تم إرسال بلاغ حقيقي إلى الخادم',x);
    }catch(e){toast(e.message)}
  };
  $('#ticket').onclick=async()=>{
    const type=prompt('نوع التذكرة؟','عام');if(!type)return;
    const description=prompt('وصف المشكلة؟');if(!description)return;
    try{const x=await api('/api/support/tickets',{method:'POST',body:JSON.stringify({type,description})});
      $('#profileExtra').innerHTML=resultCard('تم فتح تذكرة دعم حقيقية على الخادم',x);
    }catch(e){toast(e.message)}
  };
  // Stage 35 Part 2/8 -- Block/Unblock. Real POST /api/block and
  // POST /api/unblock, same shape as #report/#ticket above: userId comes
  // from the session server-side (see platform.routes.js), never sent by
  // this client. Calling #block twice for the same target is a real,
  // idempotent no-op (same record returned, not a fake success) --
  // see platform.social.block() in feature-platform.js.
  $('#block').onclick=async()=>{
    const targetId=prompt('معرف المستخدم المُراد حظره (targetId)؟');if(!targetId)return;
    try{const x=await api('/api/block',{method:'POST',body:JSON.stringify({targetId})});
      $('#profileExtra').innerHTML=resultCard('تم حظر المستخدم فعلياً على الخادم',x);
    }catch(e){toast(e.message)}
  };
  $('#unblock').onclick=async()=>{
    const targetId=prompt('معرف المستخدم المُراد إلغاء حظره (targetId)؟');if(!targetId)return;
    try{const x=await api('/api/unblock',{method:'POST',body:JSON.stringify({targetId})});
      $('#profileExtra').innerHTML=resultCard('تم إلغاء حظر المستخدم فعلياً على الخادم',x);
    }catch(e){toast(e.message)}
  };
  // Stage 35 Part 3/8 -- Mute/Unmute a user. Same real-round-trip shape as
  // #block/#unblock above: POST /api/mute and POST /api/unmute, targetId
  // only, the muting user comes from the session server-side. Unlike
  // block, muting never stops the target from following/messaging the
  // caller -- it only suppresses notifications the caller would get about
  // them (see platform.social.muteUser() in feature-platform.js).
  $('#muteUser').onclick=async()=>{
    const targetId=prompt('معرف المستخدم المُراد كتمه (targetId)؟');if(!targetId)return;
    try{const x=await api('/api/mute',{method:'POST',body:JSON.stringify({targetId})});
      $('#profileExtra').innerHTML=resultCard('تم كتم المستخدم فعلياً على الخادم',x);
    }catch(e){toast(e.message)}
  };
  $('#unmuteUser').onclick=async()=>{
    const targetId=prompt('معرف المستخدم المُراد إلغاء كتمه (targetId)؟');if(!targetId)return;
    try{const x=await api('/api/unmute',{method:'POST',body:JSON.stringify({targetId})});
      $('#profileExtra').innerHTML=resultCard('تم إلغاء كتم المستخدم فعلياً على الخادم',x);
    }catch(e){toast(e.message)}
  };
  // Stage 10 -- Follow/Friend. Real POST /api/follow, /api/unfollow,
  // /api/friend, and accept/reject on the real request id -- same
  // real-round-trip shape as #block/#muteUser above: userId always comes
  // from the session server-side (req.session.accountId), never from this
  // client; only targetId/requestId is user-supplied. Self-follow,
  // request-to-self, duplicate-follow and duplicate-request are all
  // rejected server-side (see platform.social.follow()/friend() in
  // feature-platform.js) -- this UI does not pre-validate any of that, it
  // just surfaces whatever the server real-decides.
  $('#followUser').onclick=async()=>{
    const targetId=prompt('معرف المستخدم المُراد متابعته (targetId)؟');if(!targetId)return;
    try{const x=await api('/api/follow',{method:'POST',body:JSON.stringify({targetId})});
      $('#profileExtra').innerHTML=resultCard('تمت المتابعة فعلياً على الخادم',x);
    }catch(e){toast(e.message)}
  };
  $('#unfollowUser').onclick=async()=>{
    const targetId=prompt('معرف المستخدم المُراد إلغاء متابعته (targetId)؟');if(!targetId)return;
    try{const x=await api('/api/unfollow',{method:'POST',body:JSON.stringify({targetId})});
      $('#profileExtra').innerHTML=resultCard('تم إلغاء المتابعة فعلياً على الخادم',x);
    }catch(e){toast(e.message)}
  };
  $('#friendRequest').onclick=async()=>{
    const targetId=prompt('معرف المستخدم المُراد إرسال طلب صداقة له (targetId)؟');if(!targetId)return;
    try{const x=await api('/api/friend',{method:'POST',body:JSON.stringify({targetId})});
      $('#profileExtra').innerHTML=resultCard('تم إرسال طلب الصداقة فعلياً على الخادم',x);
    }catch(e){toast(e.message)}
  };
  $('#friendAccept').onclick=async()=>{
    const requestId=prompt('معرف طلب الصداقة المُراد قبوله (requestId)؟');if(!requestId)return;
    try{const x=await api('/api/friends/'+encodeURIComponent(requestId)+'/accept',{method:'POST',body:JSON.stringify({})});
      $('#profileExtra').innerHTML=resultCard('تم قبول طلب الصداقة فعلياً على الخادم',x);
    }catch(e){toast(e.message)}
  };
  $('#friendReject').onclick=async()=>{
    const requestId=prompt('معرف طلب الصداقة المُراد رفضه (requestId)؟');if(!requestId)return;
    try{const x=await api('/api/friends/'+encodeURIComponent(requestId)+'/reject',{method:'POST',body:JSON.stringify({})});
      $('#profileExtra').innerHTML=resultCard('تم رفض طلب الصداقة فعلياً على الخادم',x);
    }catch(e){toast(e.message)}
  };
  // Stage 10 audit fix -- Lists. Real GET /api/friends/:userId,
  // /api/followers/:userId, /api/following/:userId, defaulting to the
  // caller's own account (state.userId) but accepting any account id so a
  // viewer can also open someone else's public/friends-visible list -- the
  // server enforces the actual privacy/block gate either way (see
  // profile.listFriends/listFollowers/listFollowing in feature-platform.js),
  // this client never decides visibility itself.
  $('#friendsList').onclick=async()=>{
    const userId=prompt('عرض أصدقاء أي مستخدم؟ (اتركه فارغاً لحسابك)','')||state.userId;
    try{const list=await api('/api/friends/'+encodeURIComponent(userId));
      $('#profileExtra').innerHTML=listCard('الأصدقاء',list,genericRow,'لا يوجد أصدقاء بعد.');
    }catch(e){toast(e.message)}
  };
  $('#followersList').onclick=async()=>{
    const userId=prompt('عرض متابِعي أي مستخدم؟ (اتركه فارغاً لحسابك)','')||state.userId;
    try{const list=await api('/api/followers/'+encodeURIComponent(userId));
      $('#profileExtra').innerHTML=listCard('المتابِعون',list,genericRow,'لا يوجد متابِعون بعد.');
    }catch(e){toast(e.message)}
  };
  $('#followingList').onclick=async()=>{
    const userId=prompt('عرض متابَعي أي مستخدم؟ (اتركه فارغاً لحسابك)','')||state.userId;
    try{const list=await api('/api/following/'+encodeURIComponent(userId));
      $('#profileExtra').innerHTML=listCard('المتابَعون',list,genericRow,'لا يتابع أحداً بعد.');
    }catch(e){toast(e.message)}
  };
  // Stage 23 -- Referral. GET my-code is idempotent (see
  // renderMyReferralCode()/referralCodeCard() above); redeem posts the
  // code the user typed to POST /api/referral/redeem, and refereeId is
  // taken from the session server-side (never sent by this client) --
  // same identity rule as every other write action in this file. Any
  // server rejection (unknown code, self-referral, already redeemed) is
  // shown verbatim via toast, never masked as a success.
  $('#referralCode').onclick=renderMyReferralCode;
  $('#referralRedeem').onclick=async()=>{
    const code=prompt('كود الإحالة الذي حصلت عليه من صديقك؟');if(!code)return;
    try{
      const x=await api('/api/referral/redeem',{method:'POST',body:JSON.stringify({code})});
      $('#profileExtra').innerHTML=resultCard('تم استخدام كود الإحالة — تمت مكافأة صديقك',x);
    }catch(e){toast(e.message)}
  };
  // Stage 23 -- Part 2: Room-in-Room breakout. Only prompts for roomId
  // (+ an optional name) -- never checks ownership client-side. POST
  // /api/rooms/:roomId/breakout is gated by requireRoomOwner server-side
  // (see platform.routes.js): a real 403 for anyone who is not the
  // parent room's real owner is shown verbatim via toast, never a fake
  // success, same rule as #battles above.
  $('#breakoutCreate').onclick=async()=>{
    const roomId=prompt('معرف الغرفة الرئيسية (roomId)؟');if(!roomId)return;
    const name=prompt('اسم الغرفة الفرعية؟','Breakout');
    try{
      const x=await api('/api/rooms/'+encodeURIComponent(roomId)+'/breakout',{method:'POST',body:JSON.stringify({name})});
      $('#profileExtra').innerHTML=resultCard('تم بدء غرفة فرعية حقيقية على الخادم',x);
    }catch(e){toast(e.message)}
  };
  $('#breakoutView').onclick=async()=>{
    const roomId=prompt('معرف الغرفة الرئيسية (roomId)؟');if(!roomId)return;
    await renderRoomBreakout(roomId);
  };
  // Phase 4 -- read/list actions. Each calls the new real GET endpoint and
  // renders exactly what the server returns via listCard()/genericRow() —
  // no client-side caching of what was just written, no invented fields.
  // Stage 18 (Mobile UI) -- now a real, role-aware list: see
  // renderBattlesList()/battleRow() above for accept/decline/cancel/end/
  // detail actions, each backed by the real endpoint that already existed
  // server-side (POST /api/battles/:id/accept|decline|cancel|end, GET
  // /api/battles/:id).
  $('#battlesList').onclick=renderBattlesList;
  $('#gamesList').onclick=async()=>{try{const list=await api('/api/games');$('#profileExtra').innerHTML=listCard('ألعابي',list,genericRow,'لا توجد ألعاب بعد.');}catch(e){toast(e.message)}};
  $('#giftsWall').onclick=async()=>{
    const roomId=prompt('معرف الغرفة لعرض جدار الهدايا (roomId)؟');if(!roomId)return;
    try{
      const wall=await api('/api/gifts/wall/'+roomId);
      const rows=(wall.gifters||[]).map((g,i)=>({rank:i+1,gifterId:g.gifterId,totalCoins:g.totalCoins}));
      const title=`جدار الهدايا — إجمالي ${wall.totalCoins||0} عملة (Top 3: ${(wall.topGifters||[]).length})`;
      $('#profileExtra').innerHTML=listCard(title,rows,genericRow,'لا توجد هدايا في هذه الجلسة الحالية لهذه الغرفة بعد.');
    }catch(e){toast(e.message)}
  };
  $('#familiesList').onclick=async()=>{try{const list=await api('/api/families');$('#profileExtra').innerHTML=listCard('العائلات',list,genericRow,'لا توجد عائلات بعد.');}catch(e){toast(e.message)}};
  // Phase 5 (Stage 34) -- GET /api/settings/:userId now returns a single
  // object with the effective current value of all five real keys
  // (real defaults filled in for anything never explicitly set) instead
  // of a raw append-only record list -- see settings.service.js#get()'s
  // header for the shape change. Rendered with resultCard() (a single
  // record), not listCard() (a list of records), to match.
  $('#settingsList').onclick=async()=>{try{const data=await api('/api/settings/'+state.userId);$('#profileExtra').innerHTML=resultCard('إعداداتي الحالية (قيم فعلية، بما فيها الافتراضية)',data);}catch(e){toast(e.message)}};
  $('#reportsList').onclick=async()=>{try{const list=await api('/api/moderation/reports');$('#profileExtra').innerHTML=listCard('بلاغاتي',list,genericRow,'لم تُرسل أي بلاغات بعد.');}catch(e){toast(e.message)}};
  $('#ticketsList').onclick=async()=>{try{const list=await api('/api/support/tickets');$('#profileExtra').innerHTML=listCard('تذاكري',list,genericRow,'لا توجد تذاكر بعد.');}catch(e){toast(e.message)}};
  // Real Agora RTC voice. POST /platform/api/rtc/token (see
  // Backend/src/routes/agora.routes.js) is a session-guarded endpoint:
  // the server decides host/audience from real room ownership and mints
  // a real, short-lived token -- this button never invents a token or a
  // "connected" state on its own. If the Agora Web SDK failed to load
  // (see index.html) or the backend has no Agora credentials configured,
  // createAgoraVoiceClient()/join() throws and the real error is shown
  // via toast, not swallowed into a fake success.
  $('#voiceJoin').onclick=async()=>{
    const roomId=prompt('معرف الغرفة للدخول صوتياً (roomId)؟');if(!roomId)return;
    try{
      if(typeof createAgoraVoiceClient==='undefined')throw new Error('Agora voice client script not loaded (rtc/agora-voice-client.js)');
      if(!voiceClient)voiceClient=createAgoraVoiceClient({fetchRtcToken:(rid)=>api('/api/rtc/token',{method:'POST',body:JSON.stringify({roomId:rid})})});
      const info=await voiceClient.join(roomId);
      // Stage 34 -- apply the caller's real persisted `mic` preference
      // (mute/unmute) to the real local mic track the SDK just created
      // for a host. A non-host has no local track (see
      // agora-voice-client.js#join()) so setMuted() would throw -- this
      // is silently skipped rather than surfaced as a fake failure, same
      // as every other role-conditional action in this file.
      try{if(info.role==='host'){const s=await api('/api/settings/'+state.userId);await voiceClient.setMuted(!!s.mic)}}catch(e){}
      $('#profileExtra').innerHTML=resultCard('تم الانضمام إلى القناة الصوتية الحقيقية',info);
      toast('متصل صوتياً بالغرفة');
    }catch(e){toast(e.message)}
  };
  $('#voiceLeave').onclick=async()=>{
    try{
      if(!voiceClient||!voiceClient.isJoined()){toast('لست متصلاً صوتياً حالياً');return}
      await voiceClient.leave();
      toast('تمت مغادرة القناة الصوتية');
    }catch(e){toast(e.message)}
  };
  $('#logout').onclick=async()=>{
    // /auth/logout is mounted at the API root, not under /platform, so it
    // bypasses the api() helper (which always prefixes '/platform') and
    // is called directly here with the same real bearer token.
    try{await fetch('/auth/logout',{method:'POST',headers:{Authorization:'Bearer '+state.token}})}catch{}
    sessionStorage.removeItem('accessToken');sessionStorage.removeItem('accountId');
    goToLogin();
  };
}
async function render(){
  if(!state.token||!state.userId){goToLogin();return}
  try{state.connected=false;await api('/api/home');state.connected=true}catch(e){shell('<div class="empty"><h2>الخادم غير متاح</h2><p>شغّل Backend ثم افتح التطبيق من خلاله.</p></div>');return}
  if(state.tab==='home')home();else if(state.tab==='rooms')rooms();else if(state.tab==='events')events();else if(state.tab==='wallet')wallet();else profile()
}
render();
