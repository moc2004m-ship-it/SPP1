'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createAdminPanelService } = require('../src/services/admin-panel.service');
const { createAnalyticsService } = require('../src/services/analytics.service');
const { createAntiFraudService } = require('../src/services/anti-fraud.service');
const { PERMISSIONS, ROLE_PERMISSIONS, ROLES } = require('../src/security/staff');

function staff(role='admin') { return new Map([['staff', new Set([role])]]); }
function makeDeps() {
  const accounts = { list: async () => [{id:'u1'},{id:'u2'}], listSuspended: async()=>[{id:'u2'}] };
  const wallets = { getBalance: async id => ({accountId:id,coins:10,diamonds:2}), credit: async (...a)=>({id:'tx1',accountId:a[0],currency:a[1],direction:'credit',amount:a[2]}), debit: async (...a)=>({id:'tx2',accountId:a[0],currency:a[1],direction:'debit',amount:a[2]}) };
  const recharges = { listAll: async()=>[{id:'r1',accountId:'u1',status:'completed',coinsToCredit:100,createdAt:new Date().toISOString()},{id:'r2',accountId:'u1',status:'completed',coinsToCredit:100,createdAt:new Date().toISOString()},{id:'r3',accountId:'u1',status:'completed',coinsToCredit:100,createdAt:new Date().toISOString()},{id:'r4',accountId:'u1',status:'completed',coinsToCredit:100,createdAt:new Date().toISOString()}] };
  const gifts = { listAll: async()=>[{id:'g1'}] };
  const gameMatches = { listAll: async()=>[{id:'m1'}] };
  const platform = { store: { list: async(stage,p=()=>true)=>({12:[{id:'room1'}],35:[{id:'rep',targetId:'u1'},{id:'ticket',messages:[]}]}[stage]||[]).filter(p), find: async()=>({id:'room1'}), update: async(stage,id,patch)=>({id,...patch}) } };
  const audit=[]; const auditService={record:async x=>{audit.push(x);return x},list:async()=>audit};
  const analyticsService={snapshot:async()=>({ok:true})};
  const antiFraudService={scan:async()=>({flags:[]})};
  return {accounts,wallets,recharges,gifts,gameMatches,platform,auditService,analyticsService,antiFraudService,audit};
}

test('admin panel exposes all required surfaces through real service methods', async()=>{
  const d=makeDeps(); const svc=createAdminPanelService({...d,staffRoles:staff()});
  assert.equal((await svc.listUsers('staff')).length,2); assert.equal((await svc.listRooms('staff')).length,1);
  assert.equal((await svc.listEconomy('staff')).length,2); assert.equal((await svc.listRecharge('staff')).length,4);
  assert.equal((await svc.listGifts('staff')).length,1); assert.equal((await svc.listGames('staff')).length,1);
  assert.equal((await svc.listReports('staff')).length,1); assert.equal((await svc.listBans('staff')).suspendedAccounts.length,1);
  assert.equal((await svc.listTickets('staff')).length,1); assert.equal((await svc.listSupport('staff')).length,0);
  assert.deepEqual(await svc.listAnalytics('staff'),{ok:true}); assert.equal((await svc.fraud('staff')).flags.length,0);
});

test('economy adjustment is server-side and audited', async()=>{
  const d=makeDeps(); const svc=createAdminPanelService({...d,staffRoles:staff()});
  const tx=await svc.adjustBalance({actorId:'staff',accountId:'u1',currency:'coins',amount:25,direction:'credit',reason:'support correction'});
  assert.equal(tx.id,'tx1'); assert.equal(d.audit.length,1); assert.equal(d.audit[0].action,'economy:credit');
});

test('non-admin role is denied economy mutation', async()=>{
  const d=makeDeps(); const svc=createAdminPanelService({...d,staffRoles:staff(ROLES.SUPPORT)});
  await assert.rejects(()=>svc.adjustBalance({actorId:'staff',accountId:'u1',currency:'coins',amount:1,direction:'credit'}),e=>e.status===403);
});

test('anti-fraud flags abnormal repeated completed recharge activity', async()=>{
  const d=makeDeps(); const svc=createAntiFraudService({recharges:d.recharges,accounts:d.accounts,clock:()=>new Date()});
  const result=await svc.scan({windowMinutes:10,maxCompleted:3});
  assert.equal(result.flags.length,1); assert.deepEqual(result.flags[0].reasons,['completed_recharge_burst']);
});

test('analytics computes DAU/MAU/funnel from actual repository records', async()=>{
  const d=makeDeps();
  const auth={listAllSessions:async()=>[
    {accountId:'u1',createdAt:new Date(Date.now()-2*86400000).toISOString(),lastSeenAt:new Date().toISOString()},
    {accountId:'u2',createdAt:new Date(Date.now()-40*86400000).toISOString(),lastSeenAt:new Date().toISOString()}
  ]};
  const a=createAnalyticsService({accounts:d.accounts,recharges:d.recharges,auth,platform:d.platform,gameMatches:d.gameMatches,clock:()=>new Date()});
  const x=await a.snapshot('30d'); assert.equal(x.users.mau,2); assert.equal(x.users.dau,2); assert.equal(x.rechargeFunnel.completed,4); assert.equal(x.arpuCoins,200);
});

test('RBAC has a single central permission vocabulary',()=>{
  const all=new Set(Object.values(PERMISSIONS));
  for(const permissions of Object.values(ROLE_PERMISSIONS)) for(const p of permissions) assert.equal(all.has(p),true);
  assert.equal(ROLE_PERMISSIONS[ROLES.SUPERADMIN].length,all.size);
});
