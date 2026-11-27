import test from 'node:test';
import assert from 'node:assert/strict';
import {createTestDb} from '../scripts/test-d1.mjs';
import {googleLoginStart,googleLoginCallback} from '../functions/_lib/google-login.js';
import {customerSession} from '../functions/_lib/customer-auth.js';
import {base64url} from '../functions/_lib/google-identity.js';
const origin='https://sendar.invalid';
async function fixture(){
 const db=createTestDb(),key=await crypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['sign','verify']),jwk=await crypto.subtle.exportKey('jwk',key.publicKey);Object.assign(jwk,{kid:'unit',alg:'RS256',use:'sig'});
 const env={DB:db,REGISTRATION_OPEN:'1',GOOGLE_OAUTH_ORIGIN:origin,GOOGLE_CLIENT_ID:'unit-client',GOOGLE_CLIENT_SECRET:'unit-secret',GOOGLE_OAUTH_ENCRYPTION_KEY:base64url(crypto.getRandomValues(new Uint8Array(32)))},ctx={calls:[],claims:{},flow:null,cookie:null};
 const encode=v=>base64url(new TextEncoder().encode(JSON.stringify(v)));
 const fetcher=async(url,init={})=>{ctx.calls.push(url);assert.equal(init.redirect,'manual');if(url.endsWith('/certs'))return Response.json({keys:[jwk]});assert.equal(url,'https://oauth2.googleapis.com/token');const now=Math.floor(Date.now()/1000),claims={iss:'https://accounts.google.com',aud:env.GOOGLE_CLIENT_ID,sub:'unit-google-sub',email:'owner@invalid.test',email_verified:true,iat:now,exp:now+3600,nonce:ctx.flow.searchParams.get('nonce'),...ctx.claims},body=encode({alg:'RS256',kid:'unit'})+'.'+encode(claims),sig=await crypto.subtle.sign('RSASSA-PKCS1-v1_5',key.privateKey,new TextEncoder().encode(body));return Response.json({id_token:body+'.'+base64url(sig),access_token:'unit-access-not-stored'});};
 const start=async()=>{const r=await googleLoginStart({env,request:new Request(origin+'/api/auth/google/start',{method:'POST',headers:{Origin:origin}})});assert.equal(r.status,200);ctx.flow=new URL((await r.json()).url);ctx.cookie=r.headers.get('Set-Cookie').split(';')[0];return r;};
 const finish=(cookie=ctx.cookie)=>googleLoginCallback({env,fetcher,request:new Request(origin+'/api/oauth/google/callback?state='+ctx.flow.searchParams.get('state')+'&code=unit-code',{headers:{Cookie:cookie}})});
 return {db,env,ctx,start,finish};
}
test('Google sign-up is browser-bound, verifies the signed identity, grants no Gmail permissions, and opens an isolated dashboard',async()=>{
 const f=await fixture();try{
  await f.start();assert.equal(f.ctx.flow.searchParams.get('scope'),'openid email profile');assert.equal(f.ctx.flow.searchParams.get('code_challenge_method'),'S256');
  assert.match((await f.finish('__Host-sendar_google_login='+'x'.repeat(43))).headers.get('Location'),/googleLogin=expired/);assert.equal(f.ctx.calls.length,0);
  const r=await f.finish();assert.equal(r.headers.get('Location'),origin+'/sendar/');const cookies=r.headers.getSetCookie(),session=cookies.find(c=>c.startsWith('relay_customer=')).split(';')[0];assert.match(cookies.join(';'),/HttpOnly; Secure; SameSite=Lax/);
  const user=await customerSession(f.db,new Request(origin,{headers:{Cookie:session}}));assert.equal(user.email,'owner@invalid.test');assert.ok(user.email_verified_at);
  assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) AS total FROM customer_google_mailboxes').get().total,0);
  assert.equal(f.db.sqlite.prepare('SELECT password_hash FROM auth_users').get().password_hash,'!google-only');
  assert.match((await f.finish()).headers.get('Location'),/googleLogin=expired/);
  await f.start();await f.finish();assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) AS total FROM auth_users').get().total,1);
 }finally{f.db.sqlite.close();}
});
test('Google email matches never silently take over an existing password account',async()=>{
 const f=await fixture();try{f.db.sqlite.exec("INSERT INTO auth_users(id,email,display_name,password_hash,created_at) VALUES('existing','owner@invalid.test','Existing','unit','2026-01-01')");await f.start();const r=await f.finish();assert.match(r.headers.get('Location'),/googleLogin=existing_account/);assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) AS total FROM auth_google_identities').get().total,0);}finally{f.db.sqlite.close();}
});
test('unverified identity, expired state, closed registration and foreign origins cannot create a session',async()=>{
 const f=await fixture();try{
  const foreign=await googleLoginStart({env:f.env,request:new Request(origin+'/api/auth/google/start',{method:'POST',headers:{Origin:'https://foreign.invalid'}})});assert.equal(foreign.status,403);
  await f.start();f.ctx.claims={email_verified:false};assert.match((await f.finish()).headers.get('Location'),/googleLogin=failed/);
  f.ctx.claims={};await f.start();f.db.sqlite.exec("UPDATE auth_google_login_states SET expires_at='2020-01-01'");assert.match((await f.finish()).headers.get('Location'),/googleLogin=expired/);
  await f.start();f.env.REGISTRATION_OPEN='0';assert.match((await f.finish()).headers.get('Location'),/googleLogin=registration_closed/);assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) AS total FROM auth_sessions').get().total,0);
 }finally{f.db.sqlite.close();}
});
