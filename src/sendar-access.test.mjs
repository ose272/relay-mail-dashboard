import test from 'node:test';import assert from 'node:assert/strict';
import {onRequest as middleware} from '../functions/_middleware.js';
import {onRequest as page} from '../functions/sendar/[[path]].js';
const env={DB:{},DASHBOARD_PASSWORD:'local-only-owner-password'};
test('Sendar customer pages are public while anonymous owner workspace access goes to owner sign-in',async()=>{
 for(const route of ['design','signin','signup','welcome','about']){const r=await middleware({request:new Request('https://mail.invalid/sendar/'+route),env:{},next:()=>new Response('PUBLIC ACCOUNT UI')});assert.equal(await r.text(),'PUBLIC ACCOUNT UI');}
 const r=await middleware({request:new Request('https://mail.invalid/sendar/'),env,next:()=>new Response('PRIVATE')});assert.equal(r.status,302);assert.equal(r.headers.get('Location'),'https://mail.invalid/sendar/signin?access=administrator');
});
test('a customer cookie cannot gain owner workspace or mail API access through the Sendar path',async()=>{
 const headers={Cookie:'relay_customer='+'a'.repeat(64)};
 const r=await middleware({request:new Request('https://mail.invalid/sendar/',{headers}),env,next:()=>new Response('PRIVATE')});assert.equal(r.headers.get('Location'),'https://mail.invalid/sendar/welcome');
 const api=await middleware({request:new Request('https://mail.invalid/api/state',{headers}),env,next:()=>new Response('PRIVATE')});assert.equal(api.status,401);
});
test('Sendar SPA fallback serves only known GET pages with private caching and no external scripts',async()=>{
 let requested='';const mock={ASSETS:{fetch:async r=>{requested=r.url;return new Response('<h1>Sendar</h1>');}}};
 const r=await page({request:new Request('https://mail.invalid/sendar/signin'),env:mock});assert.equal(requested,'https://mail.invalid/sendar/');assert.equal(r.headers.get('Cache-Control'),'no-store');assert.match(r.headers.get('Content-Security-Policy'),/script-src 'self'/);
 assert.equal(r.headers.get('X-Frame-Options'),'DENY');assert.match(r.headers.get('Content-Security-Policy'),/frame-ancestors 'none'/);
 const design=await page({request:new Request('https://mail.invalid/sendar/design?frame=1'),env:mock});assert.equal(design.headers.get('X-Frame-Options'),'SAMEORIGIN');assert.match(design.headers.get('Content-Security-Policy'),/frame-ancestors 'self'/);
 assert.equal((await page({request:new Request('https://mail.invalid/sendar/not-a-page'),env:mock})).status,404);
 assert.equal((await page({request:new Request('https://mail.invalid/sendar/signin',{method:'POST'}),env:mock})).status,405);
});
