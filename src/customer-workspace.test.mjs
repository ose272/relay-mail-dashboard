import test from 'node:test';
import assert from 'node:assert/strict';
import {createTestDb} from '../scripts/test-d1.mjs';
import {digest} from '../functions/_lib/google-identity.js';
import {customerWorkspace} from '../functions/_lib/customer-workspace.js';
import {onRequest as middleware} from '../functions/_middleware.js';
import {onRequest as cleanup} from '../functions/api/internal/privacy-cleanup.js';
async function fixture(){
 const db=createTestDb(),now=new Date().toISOString();
 for(const id of ['a','b']){
  db.sqlite.prepare('INSERT INTO auth_users(id,email,display_name,password_hash,created_at) VALUES(?,?,?,?,?)').run(id,id+'@invalid.test',id,'unit',now);
  db.sqlite.prepare('INSERT INTO auth_workspaces(id,owner_user_id,name,created_at) VALUES(?,?,?,?)').run(id,id,id+' workspace',now);
  db.sqlite.prepare('INSERT INTO auth_sessions(token_hash,user_id,created_at,expires_at) VALUES(?,?,?,?)').run(await digest(id.repeat(64)),id,now,new Date(Date.now()+3600000).toISOString());
 }
 db.sqlite.exec("INSERT INTO accounts(id,email,credential_ciphertext,created_at) VALUES('legacy','private-legacy@invalid.test','unit-legacy-secret','2026-01-01')");
 const env={DB:db,ADMIN_LOGIN_DISABLED:'1',APP_USAGE_TIER:'paid'};
 const call=(path,body,user='a')=>customerWorkspace({env,request:new Request('https://sendar.invalid/api/'+path,{method:body===undefined?'GET':'POST',headers:{Cookie:'relay_customer='+user.repeat(64),Origin:'https://sendar.invalid','Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})})});
 return {db,env,call};
}
test('new customers see real empty workspaces, private settings and plans; foreign IDs cannot be changed',async()=>{
 const f=await fixture();try{
  const r=await f.call('state'),raw=await r.text(),state=JSON.parse(raw);assert.equal(r.status,200);assert.equal(state.workspaceName,'a workspace');assert.deepEqual(state.accounts,[]);assert.doesNotMatch(raw,/private-legacy|unit-legacy-secret|ciphertext/);
  assert.equal((await f.call('template',{name:'A plan',subject:'Hello',body:'Hi {{name}}'})).status,200);
  const plan=(await(await f.call('state')).json()).templates[0];assert.ok(plan.id);
  assert.equal((await f.call('template/update',{id:plan.id,name:'Hacked',body:'Hacked'},'b')).status,404);
  assert.deepEqual((await(await f.call('state',undefined,'b')).json()).templates,[]);
  assert.equal((await f.call('settings',{workspaceName:'Private A',profileName:'Person A',includeSpamFolders:true})).status,200);
  assert.equal((await(await f.call('state')).json()).workspaceName,'Private A');assert.equal((await(await f.call('state',undefined,'b')).json()).workspaceName,'b workspace');
  assert.equal((await f.call('usage')).status,403);assert.equal((await f.call('sending/start',{})).status,409);
  const page=await middleware({env:f.env,request:new Request('https://sendar.invalid/sendar/',{headers:{Cookie:'relay_customer='+'a'.repeat(64)}}),next:()=>new Response('ORIGINAL APP SHELL')});assert.equal(await page.text(),'ORIGINAL APP SHELL');
 }finally{f.db.sqlite.close();}
});
test('streamed imports persist only to their owner, report actual duplicates and never delete another customer batch',async()=>{
 const f=await fixture();try{
  const r=await f.call('import/progress',{fileName:'my-leads.csv',text:'email,name\none@invalid.test,One\ntwo@invalid.test,Two\none@invalid.test,Duplicate\nbad,Invalid'}),events=(await r.text()).trim().split('\n').map(JSON.parse),done=events.at(-1);assert.equal(done.phase,'complete');assert.equal(done.result.imported,2);assert.equal(done.result.duplicates,1);assert.equal(done.result.invalid,1);
  assert.equal((await(await f.call('state')).json()).leads.length,2);assert.equal((await(await f.call('state',undefined,'b')).json()).leads.length,0);
  assert.equal((await f.call('import/batch/delete',{batchId:done.result.batchId},'b')).status,404);
  assert.equal((await f.call('import/batch/delete',{batchId:done.result.batchId})).status,200);assert.equal((await(await f.call('state')).json()).leads.length,0);
 }finally{f.db.sqlite.close();}
});
test('approved deletion requires intent and recent authentication, deletes only its owner, and retains minimal expiring quota',async()=>{
 const f=await fixture();try{
  const now=new Date().toISOString();
  f.db.sqlite.prepare('INSERT INTO customer_google_mailboxes(id,workspace_id,google_sub,email,refresh_ciphertext,access_ciphertext,access_expires_at,granted_scopes,status,connected_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run('m','a','unit-sub','sender@invalid.test','','',now,'','disconnected',now,now);
  f.db.sqlite.prepare("INSERT INTO customer_test_deliveries(id,workspace_id,mailbox_id,recipient,capability_hash,expires_at,status,created_at,started_at,sent_at) VALUES('job','a','m','private-recipient@invalid.test','unit','2099-01-01','sent',?,?,?)").run(now,now,now);
  assert.equal((await f.call('account/delete',{})).status,400);
  f.db.sqlite.prepare('UPDATE auth_sessions SET created_at=? WHERE user_id=?').run(new Date(Date.now()-3600000).toISOString(),'a');assert.equal((await f.call('account/delete',{confirmation:'DELETE'})).status,409);
  f.db.sqlite.prepare('UPDATE auth_sessions SET created_at=? WHERE user_id=?').run(now,'a');
  const result=await f.call('account/delete',{confirmation:'DELETE',userId:'b',workspaceId:'b'});assert.equal(result.status,200);assert.match(result.headers.get('Set-Cookie'),/Max-Age=0/);
  assert.equal(f.db.sqlite.prepare("SELECT COUNT(*) AS n FROM auth_users WHERE id='a'").get().n,0);assert.equal(f.db.sqlite.prepare("SELECT COUNT(*) AS n FROM auth_users WHERE id='b'").get().n,1);
  assert.equal(f.db.sqlite.prepare("SELECT COUNT(*) AS n FROM auth_sessions WHERE user_id='a'").get().n,0);assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) AS n FROM customer_google_mailboxes').get().n,0);
  const retained=f.db.sqlite.prepare('SELECT * FROM customer_retained_send_usage').get();assert.equal(retained.sender_hash,await digest('sender@invalid.test'));assert.equal(retained.status,'sent');assert.doesNotMatch(JSON.stringify(retained),/sender@|private-recipient|ciphertext/);
  f.db.sqlite.prepare("INSERT INTO customer_retained_send_usage(id,sender_hash,status,used_at) VALUES('expired','unit','sent',?)").run(new Date(Date.now()-11*3600000).toISOString());
  assert.equal((await cleanup({env:f.env,request:new Request('https://sendar.invalid/api/internal/privacy-cleanup',{method:'POST'})})).status,403);
  const r=await cleanup({env:{...f.env,BACKGROUND_CRON_SECRET:'unit-secret'},request:new Request('https://sendar.invalid/api/internal/privacy-cleanup',{method:'POST',headers:{Authorization:'Bearer unit-secret'}})});assert.equal(r.status,200);assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) AS n FROM customer_retained_send_usage').get().n,1);
 }finally{f.db.sqlite.close();}
});
