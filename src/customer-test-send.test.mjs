import test from 'node:test';
import assert from 'node:assert/strict';
import {createTestDb} from '../scripts/test-d1.mjs';
import {customerTestSend} from '../functions/_lib/customer-test-send.js';
import {encryptCredential} from '../functions/_lib/credentials.js';
import {base64url,digest,randomToken} from '../functions/_lib/google-identity.js';

async function fixture(){
 const db=createTestDb(),token=randomToken(),id=crypto.randomUUID(),now=new Date().toISOString(),key=base64url(crypto.getRandomValues(new Uint8Array(32)));
 db.sqlite.exec("INSERT INTO auth_users(id,email,display_name,password_hash,created_at) VALUES('u','owner@invalid.test','Owner','test','2026-01-01');INSERT INTO auth_workspaces(id,owner_user_id,name,created_at) VALUES('w','u','Test','2026-01-01');");
 const access=await encryptCredential('google-mailbox:w:sub','unit-access',key),refresh=await encryptCredential('google-mailbox:w:sub','unit-refresh',key);
 db.sqlite.prepare('INSERT INTO customer_google_mailboxes(id,workspace_id,google_sub,email,refresh_ciphertext,access_ciphertext,access_expires_at,granted_scopes,connected_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)').run('m','w','sub','sender@invalid.test',refresh,access,new Date(Date.now()+3600000).toISOString(),'https://www.googleapis.com/auth/gmail.send',now,now);
 db.sqlite.prepare('INSERT INTO customer_test_deliveries(id,workspace_id,mailbox_id,recipient,capability_hash,expires_at,created_at) VALUES(?,?,?,?,?,?,?)').run(id,'w','m','recipient@invalid.test',await digest(token),new Date(Date.now()+600000).toISOString(),now);
 const ctx={sends:0,mode:'ok',profile:'sender@invalid.test'};
 const fetcher=async(url,init)=>{
  assert.equal(init.redirect,'manual');
  if(url.endsWith('/profile'))return Response.json({emailAddress:ctx.profile});
  if(url.endsWith('/messages/send')){
   ctx.sends++;assert.equal(init.method,'POST');
   const raw=JSON.parse(init.body).raw,mime=Buffer.from(raw,'base64url').toString();
   assert.match(mime,/To: recipient@invalid.test\r\n/);assert.match(mime,/Subject: Sendar OAuth connection test\r\n/);
   if(ctx.mode==='timeout')throw Error('Socket timeout');
   if(ctx.mode==='reject')return Response.json({error:{message:'private provider detail'}},{status:403});
   if(ctx.mode==='server')return Response.json({error:'provider detail'},{status:503});
   return Response.json({id:'confirmed-provider-id'});
  }
  throw Error('Unexpected URL');
 };
 const call=(credential=token)=>customerTestSend({env:{DB:db,GOOGLE_OAUTH_ENCRYPTION_KEY:key},fetcher,request:new Request('https://sendar.invalid/api/internal/customer-test-send',{method:'POST',headers:{Authorization:'Bearer '+credential},body:JSON.stringify({id})})});
 return {db,id,ctx,call};
}
test('a fixed test job requires a valid unexpired capability and confirms exactly once under concurrent requests',async()=>{
 const f=await fixture();try{
  assert.equal((await f.call(randomToken())).status,403);assert.equal(f.ctx.sends,0);
  const results=await Promise.all([f.call(),f.call()]);assert.ok(results.some(r=>r.status===200));assert.equal(f.ctx.sends,1);
  assert.equal((await(await f.call()).json()).status,'sent');assert.equal(f.ctx.sends,1);
  assert.equal(f.db.sqlite.prepare('SELECT provider_message_id FROM customer_test_deliveries').get().provider_message_id,'confirmed-provider-id');
  f.db.sqlite.exec("UPDATE customer_test_deliveries SET expires_at='2020-01-01'");assert.equal((await f.call()).status,403);
 }finally{f.db.sqlite.close();}
});
for(const [mode,status] of [['timeout','uncertain'],['server','uncertain'],['reject','failed']])test('Google '+mode+' persists '+status+' without a retry',async()=>{
 const f=await fixture();try{f.ctx.mode=mode;assert.equal((await(await f.call()).json()).status,status);await f.call();assert.equal(f.ctx.sends,1);}finally{f.db.sqlite.close();}
});
test('mismatched Gmail identity and existing provider holds cannot dispatch',async()=>{
 const f=await fixture();try{f.ctx.profile='different@invalid.test';assert.equal((await(await f.call()).json()).errorCode,'GMAIL_IDENTITY_MISMATCH');assert.equal(f.ctx.sends,0);}finally{f.db.sqlite.close();}
 const g=await fixture();try{g.db.sqlite.prepare('INSERT INTO accounts(id,email,created_at,send_retry_after) VALUES(?,?,?,?)').run('legacy','sender@invalid.test','2026-01-01',new Date(Date.now()+3600000).toISOString());assert.equal((await(await g.call()).json()).errorCode,'EXISTING_PROVIDER_HOLD');assert.equal(g.ctx.sends,0);}finally{g.db.sqlite.close();}
});
test('existing rolling usage counts and a mismatched workspace prevent dispatch',async()=>{
 const f=await fixture();try{
  const seed=f.db.sqlite.prepare("INSERT INTO customer_test_deliveries(id,workspace_id,mailbox_id,recipient,capability_hash,expires_at,status,created_at,started_at) VALUES(?,'w','m','r@invalid.test','unit','2099-01-01','sent',?,?)");
  const now=new Date().toISOString();for(let i=0;i<40;i++)seed.run(crypto.randomUUID(),now,now);
  assert.equal((await(await f.call()).json()).errorCode,'SENDER_CAPACITY');assert.equal(f.ctx.sends,0);
 }finally{f.db.sqlite.close();}
 const g=await fixture();try{g.db.sqlite.exec("INSERT INTO auth_users(id,email,display_name,password_hash,created_at) VALUES('u2','u2@invalid.test','Two','test','2026-01-01');INSERT INTO auth_workspaces(id,owner_user_id,name,created_at) VALUES('w2','u2','Other','2026-01-01');UPDATE customer_test_deliveries SET workspace_id='w2'");assert.equal((await(await g.call()).json()).errorCode,'MAILBOX_NOT_READY');assert.equal(g.ctx.sends,0);}finally{g.db.sqlite.close();}
});
test('disconnecting and reconnecting a Google identity cannot reset its rolling quota',async()=>{
 const f=await fixture();try{
  const now=new Date().toISOString();
  f.db.sqlite.prepare("INSERT INTO customer_test_deliveries(id,workspace_id,mailbox_id,recipient,capability_hash,expires_at,status,created_at,started_at,sent_at) VALUES(?,'w','m','r@invalid.test','unit','2099-01-01','sent',?,?,?)").run(crypto.randomUUID(),now,now,now);
  f.db.sqlite.exec("UPDATE customer_google_mailboxes SET status='disconnected';INSERT INTO customer_google_mailboxes(id,workspace_id,google_sub,email,refresh_ciphertext,access_ciphertext,access_expires_at,granted_scopes,connected_at,updated_at,cap) SELECT 'm2',workspace_id,google_sub,email,refresh_ciphertext,access_ciphertext,access_expires_at,granted_scopes,connected_at,updated_at,1 FROM customer_google_mailboxes WHERE id='m'");
  f.db.sqlite.prepare('UPDATE customer_test_deliveries SET mailbox_id=? WHERE id=?').run('m2',f.id);
  assert.equal((await(await f.call()).json()).errorCode,'SENDER_CAPACITY');assert.equal(f.ctx.sends,0);
 }finally{f.db.sqlite.close();}
});
