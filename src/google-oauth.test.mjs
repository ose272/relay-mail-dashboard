import test from 'node:test';
import assert from 'node:assert/strict';
import {createTestDb} from '../scripts/test-d1.mjs';
import {customerGoogleOAuth} from '../functions/_lib/customer-google-oauth.js';
import {base64url,digest,googleScopes,pkceChallenge,providerJson,verifyGoogleIdentity} from '../functions/_lib/google-identity.js';
import {onRequest as middleware} from '../functions/_middleware.js';

const origin='https://sendar.invalid',encode=value=>base64url(new TextEncoder().encode(JSON.stringify(value)));
const keyPair=crypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['sign','verify']);
async function signedIdentity(claims,header={alg:'RS256',kid:'unit-google-key'}){
 const keys=await keyPair,body=encode(header)+'.'+encode(claims),signature=await crypto.subtle.sign('RSASSA-PKCS1-v1_5',keys.privateKey,new TextEncoder().encode(body));return body+'.'+base64url(signature);
}
async function fixture(){
 const db=createTestDb(),a='a'.repeat(64),b='b'.repeat(64),stamp=new Date().toISOString();
 db.sqlite.exec("INSERT INTO auth_users(id,email,display_name,password_hash,created_at) VALUES('ua','a@invalid.test','A','unit-only','2026-01-01'),('ub','b@invalid.test','B','unit-only','2026-01-01');INSERT INTO auth_workspaces(id,owner_user_id,name,created_at) VALUES('wa','ua','A workspace','2026-01-01'),('wb','ub','B workspace','2026-01-01');INSERT INTO accounts(id,email,created_at,credential_ciphertext) VALUES('legacy','legacy@invalid.test','2026-01-01','unit-only-legacy');");
 const insert=db.sqlite.prepare('INSERT INTO auth_sessions(token_hash,user_id,created_at,expires_at) VALUES(?,?,?,?)'),expiry=new Date(Date.now()+3600000).toISOString();insert.run(await digest(a),'ua',stamp,expiry);insert.run(await digest(b),'ub',stamp,expiry);
 const env={DB:db,GOOGLE_CLIENT_ID:'unit-client.apps.googleusercontent.com',GOOGLE_CLIENT_SECRET:'unit-only-client-secret',GOOGLE_OAUTH_ENCRYPTION_KEY:base64url(crypto.getRandomValues(new Uint8Array(32))),GOOGLE_OAUTH_ORIGIN:origin,ADMIN_LOGIN_DISABLED:'1'};
 const publicKey=await crypto.subtle.exportKey('jwk',(await keyPair).publicKey);Object.assign(publicKey,{kid:'unit-google-key',use:'sig',alg:'RS256'});
 const ctx={calls:[],flow:null,claims:{},scope:googleScopes.join(' '),expiresIn:3600,refreshError:null,profileEmail:'connected@invalid.test',revokeFails:false};
 const fetcher=async(url,init={})=>{
  ctx.calls.push({url,method:init.method||'GET'});
  if(url==='https://www.googleapis.com/oauth2/v3/certs')return Response.json({keys:[publicKey]});
  if(url==='https://oauth2.googleapis.com/token'){
   const form=new URLSearchParams(init.body);assert.equal(form.get('client_id'),env.GOOGLE_CLIENT_ID);assert.equal(form.get('client_secret'),env.GOOGLE_CLIENT_SECRET);
   if(form.get('grant_type')==='refresh_token'){
    if(ctx.refreshError)return Response.json({error:ctx.refreshError,error_description:'provider detail must not be exposed'},{status:400});
    assert.equal(form.get('refresh_token'),'unit-only-refresh-token');return Response.json({access_token:'unit-only-refreshed-access',expires_in:3600});
   }
   if(ctx.authorizationError)return Response.json({error:ctx.authorizationError,error_description:'unit-sensitive-provider-detail-must-not-be-stored'},{status:400});
   assert.equal(form.get('grant_type'),'authorization_code');assert.equal(form.get('redirect_uri'),origin+'/api/oauth/google/callback');assert.equal(await pkceChallenge(form.get('code_verifier')),ctx.flow.searchParams.get('code_challenge'));
   const now=Math.floor(Date.now()/1000),claims={iss:'https://accounts.google.com',aud:env.GOOGLE_CLIENT_ID,sub:'google-unit-sub',email:'connected@invalid.test',email_verified:true,iat:now,exp:now+3600,nonce:ctx.flow.searchParams.get('nonce'),...ctx.claims};
   return Response.json({id_token:await signedIdentity(claims),access_token:'unit-only-access-token',refresh_token:'unit-only-refresh-token',scope:ctx.scope,expires_in:ctx.expiresIn});
  }
  if(url==='https://gmail.googleapis.com/gmail/v1/users/me/profile')return Response.json({emailAddress:ctx.profileEmail,messagesTotal:100});
  if(url==='https://oauth2.googleapis.com/revoke')return new Response(null,{status:ctx.revokeFails?503:200});
  throw Error('Unexpected provider request in isolated OAuth test.');
 };
 const call=(path,{body,cookie=a,headers={},method=body===undefined?'GET':'POST',urlOrigin=origin}={})=>customerGoogleOAuth({env,fetcher,request:new Request(urlOrigin+'/api/oauth/google/'+path,{method,headers:{...(cookie?{Cookie:'relay_customer='+cookie}:{}),...(body===undefined?{}:{Origin:urlOrigin,'Content-Type':'application/json'}),...headers},...(body===undefined?{}:{body:JSON.stringify(body)})})});
 const start=async(cookie=a)=>{const r=await call('start',{body:{},cookie});assert.equal(r.status,200);ctx.flow=new URL((await r.json()).url);return ctx.flow;};
 const finish=(cookie=a,extra='')=>call('callback?state='+ctx.flow.searchParams.get('state')+'&code=unit-authorization-code'+extra,{cookie});
 return {db,env,ctx,call,start,finish,a,b,close:()=>db.sqlite.close()};
}

test('OAuth start is customer-only, same-origin, session-bound and uses PKCE and a fixed callback',async()=>{
 const f=await fixture();try{
  assert.equal((await f.call('start',{body:{},cookie:''})).status,401);assert.equal((await f.call('start',{body:{},headers:{Origin:'https://attacker.invalid'}})).status,403);
  assert.equal((await f.call('start',{body:{},urlOrigin:'https://other.invalid'})).status,400);
  const url=await f.start();assert.equal(url.origin,'https://accounts.google.com');assert.equal(url.searchParams.get('redirect_uri'),origin+'/api/oauth/google/callback');assert.equal(url.searchParams.get('code_challenge_method'),'S256');assert.equal(url.searchParams.get('access_type'),'offline');assert.equal(url.searchParams.get('state').length,43);
  const row=f.db.sqlite.prepare('SELECT * FROM customer_google_oauth_states').get();assert.notEqual(row.state_hash,url.searchParams.get('state'));assert.equal(row.workspace_id,'wa');assert.equal(row.session_hash,await digest(f.a));assert.ok(row.verifier_ciphertext.includes('.'));assert.equal(f.ctx.calls.length,0);
  const ownerOnly=await f.call('mailboxes',{cookie:'',headers:{Cookie:'relay_session=legacy-owner-cookie'}});assert.equal(ownerOnly.status,401);
 }finally{f.close();}
});

test('callback rejects a swapped customer session and replay, encrypts tokens and never exposes legacy mail',async()=>{
 const f=await fixture();try{
  await f.start();const swapped=await f.finish(f.b);assert.match(swapped.headers.get('Location'),/google=expired$/);assert.equal(f.ctx.calls.length,0);assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) AS n FROM customer_google_oauth_states').get().n,1);
  const r=await f.finish();assert.equal(r.status,303);assert.equal(r.headers.get('Referrer-Policy'),'no-referrer');assert.match(r.headers.get('Location'),/google=connected$/);
  const row=f.db.sqlite.prepare('SELECT * FROM customer_google_mailboxes').get();assert.equal(row.workspace_id,'wa');assert.equal(row.email,'connected@invalid.test');assert.ok(!row.refresh_ciphertext.includes('unit-only-refresh-token'));assert.ok(!row.access_ciphertext.includes('unit-only-access-token'));
  const list=await(await f.call('mailboxes')).json();assert.equal(list.total,1);assert.equal(list.mailboxes[0].id,row.id);assert.doesNotMatch(JSON.stringify(list),/ciphertext|unit-only|legacy@invalid|access_token|refresh_token/);assert.equal((await(await f.call('mailboxes',{cookie:f.b})).json()).total,0);
  const count=f.ctx.calls.length;assert.match((await f.finish()).headers.get('Location'),/google=expired$/);assert.equal(f.ctx.calls.length,count);assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) AS n FROM customer_google_mailboxes').get().n,1);
 }finally{f.close();}
});

test('callback accepts the exact string true used in Google documented signed identities',async()=>{
 const f=await fixture();try{f.ctx.claims={email_verified:'true'};await f.start();const response=await f.finish();assert.match(response.headers.get('Location'),/google=connected$/);assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) AS n FROM customer_google_mailboxes').get().n,1);}finally{f.close();}
});

test('denied or incomplete grants and expired states do not connect a mailbox',async()=>{
 const f=await fixture();try{
  await f.start();assert.match((await f.finish(f.a,'&error=access_denied')).headers.get('Location'),/google=denied$/);assert.equal(f.ctx.calls.length,0);
  await f.start();f.ctx.scope='openid email';assert.match((await f.finish()).headers.get('Location'),/google=permissions$/);assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) AS n FROM customer_google_mailboxes').get().n,0);
  await f.start();f.db.sqlite.exec("UPDATE customer_google_oauth_states SET expires_at='2000-01-01T00:00:00Z'");const count=f.ctx.calls.length;assert.match((await f.finish()).headers.get('Location'),/google=expired$/);assert.equal(f.ctx.calls.length,count);
 }finally{f.close();}
});

test('a connected Google identity cannot be silently assigned to another workspace',async()=>{
 const f=await fixture();try{await f.start();await f.finish();await f.start(f.b);assert.match((await f.finish(f.b)).headers.get('Location'),/google=account_conflict$/);assert.equal(f.db.sqlite.prepare('SELECT workspace_id FROM customer_google_mailboxes').get().workspace_id,'wa');}finally{f.close();}
});

test('callback diagnostics report fixed provider-stage codes without storing provider details or tokens',async()=>{
 const f=await fixture();try{
  for(const [provider,expected] of [['invalid_client','google_client_rejected'],['invalid_grant','google_code_rejected']]){
   f.ctx.authorizationError=provider;await f.start();const response=await f.finish(),url=new URL(response.headers.get('Location'));assert.equal(url.searchParams.get('google'),expected);const reference=url.searchParams.get('reference');assert.match(reference,/^[a-f0-9-]{36}$/);
   const row=f.db.sqlite.prepare('SELECT * FROM customer_google_oauth_errors WHERE id=?').get(reference);assert.equal(row.stage,'token_exchange');assert.equal(row.error_code,expected);assert.equal(row.provider_status,400);assert.doesNotMatch(JSON.stringify(row),/unit-sensitive|unit-only|authorization-code|access_token|refresh_token|connected@/);
  }
  assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) AS n FROM customer_google_mailboxes').get().n,0);
 }finally{f.close();}
});

test('identity and database failures have separate diagnostics without weakening Google validation',async()=>{
 const f=await fixture();try{
  f.ctx.claims={nonce:'wrong-nonce'};await f.start();let response=await f.finish();assert.match(response.headers.get('Location'),/google=google_identity_nonce&reference=/);assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) AS n FROM customer_google_mailboxes').get().n,0);
  f.ctx.claims={};f.db.sqlite.exec("CREATE TRIGGER unit_mailbox_write_failure BEFORE INSERT ON customer_google_mailboxes BEGIN SELECT RAISE(ABORT,'unit-sensitive-database-error');END;");await f.start();response=await f.finish();assert.match(response.headers.get('Location'),/google=connection_save_failed&reference=/);const row=f.db.sqlite.prepare("SELECT * FROM customer_google_oauth_errors WHERE stage='connection_save'").get();assert.equal(row.error_code,'connection_save_failed');assert.doesNotMatch(JSON.stringify(row),/unit-sensitive|unit-only|ciphertext|connected@/);
 }finally{f.close();}
});

test('Gmail access check is read-only, workspace-scoped and cached briefly without sending mail',async()=>{
 const f=await fixture();try{
  await f.start();await f.finish();const id=f.db.sqlite.prepare('SELECT id FROM customer_google_mailboxes').get().id,count=f.ctx.calls.length;
  assert.equal((await f.call('check',{body:{mailboxId:id},cookie:f.b})).status,404);assert.equal((await f.call('disconnect',{body:{mailboxId:id},cookie:f.b})).status,404);assert.equal(f.ctx.calls.length,count);
  const check=await f.call('check',{body:{mailboxId:id}});assert.equal(check.status,200);assert.match((await check.json()).message,/No email was sent/);const after=f.ctx.calls.length;
  assert.equal((await(await f.call('check',{body:{mailboxId:id}})).json()).cached,true);assert.equal(f.ctx.calls.length,after);
  assert.deepEqual(f.ctx.calls.filter(c=>c.url.includes('gmail.googleapis.com')), [{url:'https://gmail.googleapis.com/gmail/v1/users/me/profile',method:'GET'}]);assert.equal(f.ctx.calls.some(c=>c.url.includes('/messages/send')),false);
 }finally{f.close();}
});

test('expired access refreshes securely and invalid grants require reconnection without implying account restriction',async()=>{
 const f=await fixture();try{
  f.ctx.expiresIn=1;await f.start();await f.finish();const id=f.db.sqlite.prepare('SELECT id FROM customer_google_mailboxes').get().id;
  assert.equal((await f.call('check',{body:{mailboxId:id}})).status,200);assert.equal(f.ctx.calls.filter(c=>c.url==='https://oauth2.googleapis.com/token').length,2);
  f.db.sqlite.exec("UPDATE customer_google_mailboxes SET access_expires_at='2000-01-01T00:00:00Z',checked_at=NULL");f.ctx.refreshError='invalid_grant';const r=await f.call('check',{body:{mailboxId:id}});assert.equal(r.status,502);const body=await r.json();assert.match(body.error,/expired or was revoked/);assert.doesNotMatch(body.error,/provider detail|restricted|unit-only/);assert.equal(f.db.sqlite.prepare('SELECT status FROM customer_google_mailboxes').get().status,'reconnect_required');
 }finally{f.close();}
});

test('disconnect clears local tokens even if Google revocation is unavailable',async()=>{
 const f=await fixture();try{await f.start();await f.finish();const id=f.db.sqlite.prepare('SELECT id FROM customer_google_mailboxes').get().id;f.ctx.revokeFails=true;const r=await f.call('disconnect',{body:{mailboxId:id}});assert.equal(r.status,200);assert.equal((await r.json()).revoked,false);const row=f.db.sqlite.prepare('SELECT status,refresh_ciphertext,access_ciphertext FROM customer_google_mailboxes').get();assert.equal(row.status,'disconnected');assert.equal(row.refresh_ciphertext,'');assert.equal(row.access_ciphertext,'');assert.equal((await(await f.call('mailboxes')).json()).total,0);assert.equal(f.db.sqlite.prepare("SELECT COUNT(*) AS n FROM accounts WHERE id='legacy'").get().n,1);}finally{f.close();}
});

test('signed Google identity checks issuer, audience, nonce, expiry, verified email and signature',async()=>{
 const key=await crypto.subtle.exportKey('jwk',(await keyPair).publicKey);Object.assign(key,{kid:'unit-google-key',use:'sig',alg:'RS256'});const fetcher=async()=>Response.json({keys:[key]}),now=Math.floor(Date.now()/1000),claims={iss:'https://accounts.google.com',aud:'unit-client',sub:'unit-sub',email:'email@invalid.test',email_verified:true,iat:now,exp:now+3600,nonce:'unit-nonce'},options={clientId:'unit-client',nonceHash:await digest('unit-nonce'),fetcher};
 assert.equal((await verifyGoogleIdentity(await signedIdentity(claims),options)).email,'email@invalid.test');
 assert.equal((await verifyGoogleIdentity(await signedIdentity({...claims,email_verified:'true'}),options)).email,'email@invalid.test');
 for(const value of ['false','TRUE',' true ',1,0,null,undefined])await assert.rejects(()=>signedIdentity({...claims,email_verified:value}).then(t=>verifyGoogleIdentity(t,options)));
 for(const change of [{iss:'https://attacker.invalid'},{aud:'other-client'},{nonce:'wrong'},{exp:now-1},{iat:now+1000},{email_verified:false},{email:'bad'}])await assert.rejects(()=>signedIdentity({...claims,...change}).then(t=>verifyGoogleIdentity(t,options)));
 const token=await signedIdentity(claims),parts=token.split('.');parts[1]=encode({...claims,email:'forged@invalid.test'});await assert.rejects(()=>verifyGoogleIdentity(parts.join('.'),options));await assert.rejects(()=>signedIdentity(claims,{alg:'none',kid:'unit-google-key'}).then(t=>verifyGoogleIdentity(t,options)));
});

test('Google requests use the Workerd-supported manual mode and reject redirects without forwarding credentials',async()=>{
 let calls=0;
 const fetcher=async(url,init)=>{calls++;assert.equal(url,'https://oauth2.googleapis.com/token');assert.equal(init.redirect,'manual');return Response.redirect('https://attacker.invalid/collect',302);};
 await assert.rejects(()=>providerJson(fetcher,'https://oauth2.googleapis.com/token',{method:'POST',body:new URLSearchParams({client_secret:'unit-only-secret'})}),error=>error.status===302&&error.providerCode==='redirect_blocked');assert.equal(calls,1);
 const data=await providerJson(async(url,init)=>{assert.equal(init.redirect,'manual');return Response.json({ok:true});},'https://www.googleapis.com/oauth2/v3/certs');assert.equal(data.ok,true);
});

test('public config contains no secrets and owner-disable middleware delegates only to self-authenticating OAuth handlers',async()=>{
 const f=await fixture();try{
  const config=await f.call('config',{cookie:''});assert.equal(config.status,200);const text=await config.text();assert.match(text,/configured/);assert.doesNotMatch(text,/unit-only-client-secret|ENCRYPTION_KEY|refresh/);
  const request=new Request(origin+'/api/oauth/google/mailboxes',{headers:{Cookie:'relay_session=legacy'}});const r=await middleware({request,env:f.env,next:()=>customerGoogleOAuth({request,env:f.env})});assert.equal(r.status,401);
  const invalid=await f.call('callback?code=not-logged',{cookie:''});assert.equal(invalid.status,303);assert.match(invalid.headers.get('Location'),/signin\?google=signin_required$/);assert.doesNotMatch(invalid.headers.get('Location'),/code=|state=/);
 }finally{f.close();}
});
