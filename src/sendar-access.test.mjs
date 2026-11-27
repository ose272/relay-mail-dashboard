import test from 'node:test';import assert from 'node:assert/strict';
import {onRequest as middleware} from '../functions/_middleware.js';
import {onRequest as page} from '../functions/sendar/[[path]].js';
import {onRequestPost as login} from '../functions/api/login.js';
import {createTestDb} from '../scripts/test-d1.mjs';
import {createSession} from '../functions/_lib/auth.js';
const env={DB:{},DASHBOARD_PASSWORD:'local-only-owner-password'};
test('Sendar customer pages are public while anonymous owner workspace access goes to owner sign-in',async()=>{
 for(const route of ['signin','signup','about']){const r=await middleware({request:new Request('https://mail.invalid/sendar/'+route),env:{},next:()=>new Response('PUBLIC ACCOUNT UI')});assert.equal(await r.text(),'PUBLIC ACCOUNT UI');}
 const r=await middleware({request:new Request('https://mail.invalid/sendar/'),env,next:()=>new Response('PRIVATE')});assert.equal(r.status,302);assert.equal(r.headers.get('Location'),'https://mail.invalid/sendar/signin');
});

test('disabled administrator access rejects old valid sessions and login attempts while preserving the authenticated scheduler',async()=>{
 const blockedEnv={...env,ADMIN_LOGIN_DISABLED:'1',BACKGROUND_CRON_SECRET:'local-only-scheduler-token'};
 const session=await createSession(env.DASHBOARD_PASSWORD);
 const headers={Cookie:'relay_session='+session.token};
 const api=await middleware({request:new Request('https://mail.invalid/api/state',{headers}),env:blockedEnv,next:()=>new Response('PRIVATE MAIL')});assert.equal(api.status,401);
 const browser=await middleware({request:new Request('https://mail.invalid/sendar/',{headers}),env:blockedEnv,next:()=>new Response('PRIVATE MAIL')});assert.equal(browser.headers.get('Location'),'https://mail.invalid/sendar/signin');
 const result=await login({request:new Request('https://mail.invalid/api/login',{method:'POST'}),env:{ADMIN_LOGIN_DISABLED:'1',DB:{prepare(){throw Error('Disabled login must not query the database');}}}});assert.equal(result.status,410);assert.equal(result.headers.get('Set-Cookie'),null);
 const tick=await middleware({request:new Request('https://mail.invalid/api/internal/send-tick',{method:'POST',headers:{Authorization:'Bearer local-only-scheduler-token'}}),env:blockedEnv,next:()=>new Response('AUTHORIZED TICK')});assert.equal(await tick.text(),'AUTHORIZED TICK');
 const fakeTick=await middleware({request:new Request('https://mail.invalid/api/internal/send-tick',{method:'POST'}),env:blockedEnv,next:()=>new Response('PRIVATE')});assert.equal(fakeTick.status,401);
});
test('a customer cookie cannot gain owner workspace or mail API access through the Sendar path',async()=>{
 const db=createTestDb();const isolated={...env,DB:db};const headers={Cookie:'relay_customer='+'a'.repeat(64)};
 const r=await middleware({request:new Request('https://mail.invalid/sendar/',{headers}),env:isolated,next:()=>new Response('PRIVATE')});assert.equal(r.headers.get('Location'),'https://mail.invalid/sendar/signin');
 const api=await middleware({request:new Request('https://mail.invalid/api/state',{headers}),env:isolated,next:()=>new Response('PRIVATE')});assert.equal(api.status,401);db.sqlite.close();
});
test('Sendar SPA fallback serves only known GET pages with private caching and no external scripts',async()=>{
 let requested='';const mock={ASSETS:{fetch:async r=>{requested=r.url;return new Response('<h1>Sendar</h1>');}}};
 const r=await page({request:new Request('https://mail.invalid/sendar/signin'),env:mock});assert.equal(requested,'https://mail.invalid/sendar/');assert.equal(r.headers.get('Cache-Control'),'no-store');assert.match(r.headers.get('Content-Security-Policy'),/script-src 'self'/);
 assert.equal(r.headers.get('X-Frame-Options'),'DENY');assert.match(r.headers.get('Content-Security-Policy'),/frame-ancestors 'none'/);
 const design=await page({request:new Request('https://mail.invalid/sendar/design?frame=1'),env:mock});assert.equal(design.status,302);assert.equal(design.headers.get('Location'),'https://mail.invalid/sendar/');
 assert.equal((await page({request:new Request('https://mail.invalid/sendar/not-a-page'),env:mock})).status,404);
 assert.equal((await page({request:new Request('https://mail.invalid/sendar/signin',{method:'POST'}),env:mock})).status,405);
});

test('legacy frontend and preview bookmarks redirect to the new frontend without losing verification access',async()=>{
 for(const [from,to] of [['/index.html','/sendar/'],['/login','/sendar/signin'],['/signup','/sendar/signup'],['/sendar/design?view=mobile','/sendar/']]){
  const r=await middleware({request:new Request('https://mail.invalid'+from),env:{},next:()=>new Response('OLD')});assert.equal(r.status,302);assert.equal(r.headers.get('Location'),'https://mail.invalid'+to);
 }
 const r=await middleware({request:new Request('https://mail.invalid/googleae5c9c582107a548.html'),env:{},next:()=>new Response('verification')});assert.equal(await r.text(),'verification');
});
