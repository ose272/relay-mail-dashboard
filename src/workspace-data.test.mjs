import test from 'node:test';
import assert from 'node:assert/strict';
import {createTestDb} from '../scripts/test-d1.mjs';
import {workspaceActivity} from '../functions/_lib/workspace-data.js';
import {onRequest} from '../functions/api/[[path]].js';
const call=async(db,path,body)=>{const r=await onRequest({env:{DB:db},request:new Request('https://local.invalid/api/'+path,body===undefined?{}:{method:'POST',headers:{Origin:'https://local.invalid','Content-Type':'application/json'},body:JSON.stringify(body)})});return {status:r.status,data:await r.json()};};
test('workspace activity fills missing dates and assigns messages across Lagos midnight without counting outbound mail',async()=>{
 const db=createTestDb();try{
 db.sqlite.exec("INSERT INTO accounts(id,email,created_at) VALUES('a','local@invalid.test','2026-01-01');INSERT INTO threads(id,account_id,email,name,subject,status,unread) VALUES('t','a','lead@invalid.test','Lead','Subject','Needs reply',1);INSERT INTO messages(id,thread_id,direction,body,time) VALUES('m','t','in','Message','2026-11-25T23:30:00Z'),('o','t','out','Reply','2026-11-25T23:40:00Z');");
 let data=await workspaceActivity(db,{now:new Date('2026-11-26T10:00:00Z'),days:14});assert.equal(data.days.length,14);assert.equal(data.today.day,'2026-11-26');assert.equal(data.today.replies,1);assert.equal(data.days.at(-2).replies,0);
 db.sqlite.exec("UPDATE messages SET body='Edited text' WHERE id='m'");assert.equal((await workspaceActivity(db,{now:new Date('2026-11-26T10:00:00Z')})).today.replies,1);
 db.sqlite.exec("UPDATE messages SET time='2026-11-25T20:00:00Z' WHERE id='m'");data=await workspaceActivity(db,{now:new Date('2026-11-26T10:00:00Z')});assert.equal(data.today.replies,0);assert.equal(data.days.at(-2).replies,1);
 }finally{db.sqlite.close();}
});
test('explicit account pause is idempotent and disconnect removes credentials while preserving account history',async()=>{
 const db=createTestDb();try{db.sqlite.exec("INSERT INTO accounts(id,email,created_at,credential_ciphertext,connection) VALUES('a','local@invalid.test','2026-01-01','local-only-fixture','Connected')");
 for(let i=0;i<2;i++)assert.equal((await call(db,'account',{id:'a',paused:true})).status,200);assert.equal(db.sqlite.prepare("SELECT paused FROM accounts WHERE id='a'").get().paused,1);
 assert.equal((await call(db,'account/disconnect',{id:'a'})).status,200);const row=db.sqlite.prepare("SELECT paused,credential_ciphertext,connection FROM accounts WHERE id='a'").get();assert.equal(row.credential_ciphertext,null);assert.equal(row.paused,1);assert.equal(row.connection,'Not connected');assert.equal((await call(db,'state')).data.accounts.length,1);
 assert.equal((await call(db,'account/disconnect',{id:'missing'})).status,404);
 }finally{db.sqlite.close();}
});
test('daily send totals count an accepted delivery once across repeated confirmations',async()=>{
 const db=createTestDb();try{
 db.sqlite.exec("INSERT INTO accounts(id,email,created_at) VALUES('a','local@invalid.test','2026-01-01');INSERT INTO templates(id,name,subject,body,created_at) VALUES('p','Plan','','Body','2026-01-01');INSERT INTO leads(id,email,created_at) VALUES('l','lead@invalid.test','2026-01-01');INSERT INTO campaigns(id,name,template_id,status,created_at,allocation_json) VALUES('c','Direct send','p','Sending','2026-01-01','[]');INSERT INTO campaign_deliveries(id,campaign_id,batch_no,day_no,lead_id,account_id,template_id,status,created_at) VALUES('d','c',1,1,'l','a','p','queued','2026-11-25T20:00:00Z');UPDATE campaign_deliveries SET status='sending',started_at='2026-11-25T23:30:00Z' WHERE id='d';");
 const when={now:new Date('2026-11-26T10:00:00Z')};assert.equal((await workspaceActivity(db,when)).today.sent,0);
 db.sqlite.exec("UPDATE campaign_deliveries SET status='sent',sent_at='2026-11-25T23:30:00Z' WHERE id='d';UPDATE campaign_deliveries SET status='sent',sent_at='2026-11-25T23:30:00Z' WHERE id='d';");
 assert.equal((await workspaceActivity(db,when)).today.sent,1);assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS n FROM campaign_deliveries WHERE status='sent'").get().n,1);
 }finally{db.sqlite.close();}
});
test('plan description and workspace profile survive independent server reads',async()=>{
 const db=createTestDb();try{const plan=await call(db,'template',{name:'Saved plan',description:'Saved description',subject:'Subject',body:'Actual message'});assert.equal(plan.status,200);assert.equal((await call(db,'settings',{cap:40,profileName:'Workspace Person'})).status,200);let state=(await call(db,'state')).data;assert.equal(state.profileName,'Workspace Person');assert.equal(state.templates[0].description,'Saved description');
 await call(db,'template/update',{id:plan.data.id,name:'Edited plan',subject:'',body:'Edited body'});state=(await call(db,'state')).data;assert.equal(state.templates[0].description,'Saved description');assert.equal(state.templates[0].body,'Edited body');assert.equal((await call(db,'workspace/activity?days=14')).data.days.length,14);
 }finally{db.sqlite.close();}
});
