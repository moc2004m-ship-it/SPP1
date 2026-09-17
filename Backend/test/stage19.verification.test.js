'use strict';
const test=require('node:test'); const assert=require('node:assert/strict'); const fs=require('node:fs');
const routes=fs.readFileSync(require.resolve('../src/routes/platform.routes'),'utf8');
const required=['snakes_ladders','quiz','ludo','carrom','chess','eight_ball','domino'];
test('Stage 19 finish confirmation contains all seven server-engine-backed games',()=>{for(const game of required) assert.match(routes,new RegExp(`['"]${game}['"]`)); assert.match(routes,/resultSource !== 'server'/);});
test('Stage 19 route never accepts a client-declared winner/result',()=>{const block=routes.slice(routes.indexOf('const ENGINE_BACKED_GAMES')); const end=block.indexOf('// Wallet is read-only'); const section=block.slice(0,end); assert.equal(/req\.body.*winner|req\.body.*result/.test(section),false);});
