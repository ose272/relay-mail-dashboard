import test from 'node:test';
import assert from 'node:assert/strict';
import { onRequest } from '../functions/api/[[path]].js';
import { createTestDb } from '../scripts/test-d1.mjs';
const call=async(db,path,body)=>{const request=new Request('http://localhost/api/'+path,body===undefined?{}:{method:'POST',headers:{Origin:'http://localhost','Content-Type':'application/json'},body:JSON.stringify(body)});const res=await onRequest({request,env:{DB:db}});return{status:res.status,data:await res.json()};};
test('real state returns empty data, sanitized accounts, and persisted workspace settings',async()=>{const db=createTestDb();try{
 db.sqlite.exec("INSERT INTO accounts(id,email,created_at,credential_ciphertext) VALUES('a','test@invalid.test','2026-01-01','never-return-this')");
 let r=await call(db,'state');assert.equal(r.status,200);assert.equal(r.data.leads.length,0);assert.equal(r.data.campaigns.length,0);assert.equal(r.data.accounts[0].hasCredentials,true);assert.ok(!JSON.stringify(r.data).includes('never-return-this'));
 r=await call(db,'settings',{cap:23,workspaceName:'Live workspace'});assert.equal(r.status,200);r=await call(db,'state');assert.equal(r.data.workspaceName,'Live workspace');assert.equal(r.data.accounts[0].cap,23);
 assert.equal((await call(db,'account/cap',{id:'a',cap:41})).status,400);
}finally{db.sqlite.close();}});
test('inbox batches over 100 threads, excludes old inbound and outbound-only activity, persists tags',async()=>{const db=createTestDb();try{
 const now=new Date().toISOString(),old=new Date(Date.now()-86400000*2).toISOString();db.sqlite.exec("INSERT INTO accounts(id,email,created_at) VALUES('a','sender@invalid.test','2026-01-01')");
 const t=db.sqlite.prepare('INSERT INTO threads(id,name,email,subject,account_id) VALUES(?,?,?,?,?)'),m=db.sqlite.prepare('INSERT INTO messages(id,thread_id,direction,body,time) VALUES(?,?,?,?,?)');
 for(let i=0;i<152;i++){t.run('t'+i,'Name','recipient@invalid.test','Subject','a');m.run('m'+i,'t'+i,i===151?'out':'in','message',i===150?old:now);}
 let r=await call(db,'state');assert.equal(r.status,200);assert.equal(r.data.threads.length,150);assert.ok(!r.data.threads.some(t=>['t150','t151'].includes(t.id)));
 assert.equal((await call(db,'thread/update',{id:'t0',tag:'Interested',starred:true,archived:true,unread:false})).status,200);r=await call(db,'thread?id=t0');assert.equal(r.data.thread.starred,true);assert.equal(r.data.thread.archived,true);assert.equal(r.data.thread.tag,'Interested');
}finally{db.sqlite.close();}});
test('quoted import, body-only plans, pause/activate and delivery status use database records',async()=>{const db=createTestDb();try{
 let r=await call(db,'import',{fileName:'quoted.csv',text:'name,email,store\n"Person, One",one@invalid.test,"Store, One"'});assert.equal(r.status,200);r=await call(db,'state');assert.equal(r.data.leads[0].name,'Person, One');assert.equal(r.data.leadImportBatches[0].leadCount,1);
 r=await call(db,'template',{name:'Body only',subject:'',body:'Hi {{name}}'});assert.equal(r.status,200);const id=r.data.id;assert.equal((await call(db,'template/status',{id,paused:true})).status,200);assert.ok((await call(db,'state')).data.templates[0].archivedAt);await call(db,'template/status',{id,paused:false});assert.equal((await call(db,'state')).data.templates[0].archivedAt,null);
 db.sqlite.exec(`INSERT INTO accounts(id,email,created_at) VALUES('a','sender@invalid.test','2026-01-01');INSERT INTO campaigns(id,name,template_id,status,created_at,allocation_json) VALUES('c','Direct send','${id}','User paused','2026-01-01','[]');INSERT INTO campaign_deliveries(id,campaign_id,batch_no,day_no,lead_id,account_id,template_id,status,created_at) SELECT 'd','c',1,1,id,'a','${id}','uncertain','2026-01-01' FROM leads LIMIT 1;`);
 db.sqlite.exec("UPDATE campaign_deliveries SET status='queued' WHERE id='d'; UPDATE campaign_deliveries SET status='uncertain' WHERE id='d';");
 r=await call(db,'sending/status');assert.equal(r.status,200);assert.equal(r.data.runs[0].uncertain,1);assert.equal(r.data.deliveries[0].status,'uncertain');
}finally{db.sqlite.close();}});

test('pause and resume keep unconfirmed deliveries blocked until explicit retry',async()=>{const db=createTestDb();try{
 db.sqlite.exec("INSERT INTO templates(id,name,subject,body,created_at) VALUES('p','Plan','','Body','2026-01-01'); INSERT INTO accounts(id,email,created_at) VALUES('a','local@invalid.test','2026-01-01'); INSERT INTO leads(id,email,created_at) VALUES('l','lead@invalid.test','2026-01-01'),('l2','lead2@invalid.test','2026-01-01'); INSERT INTO campaigns(id,name,template_id,status,created_at,allocation_json) VALUES('c','Direct send','p','Sending','2026-01-01','[]'); INSERT INTO campaign_deliveries(id,campaign_id,batch_no,day_no,lead_id,account_id,status,created_at) VALUES('d','c',1,1,'l','a','queued','2026-01-01'),('u','c',1,1,'l2','a','uncertain','2026-01-01');");
 assert.equal((await call(db,'campaign/pause',{campaignId:'c'})).status,200);assert.equal(db.sqlite.prepare("SELECT status,next_send_at FROM campaigns WHERE id='c'").get().next_send_at,null);
 assert.equal((await call(db,'campaign/resume-pending',{campaignId:'c'})).status,200);assert.equal(db.sqlite.prepare("SELECT status FROM campaign_deliveries WHERE id='u'").get().status,'uncertain');
 assert.equal((await call(db,'campaign/retry-uncertain',{deliveryId:'u'})).status,200);assert.equal(db.sqlite.prepare("SELECT status FROM campaign_deliveries WHERE id='u'").get().status,'queued');
}finally{db.sqlite.close();}});

test('streamed import reports committed row progress and real completion totals',async()=>{const db=createTestDb();try{
 const text='name,email,store\n'+Array.from({length:2201},(_,i)=>`Person ${i},person${i}@invalid.test,Store`).join('\n');
 const request=new Request('http://localhost/api/import/progress',{method:'POST',headers:{Origin:'http://localhost','Content-Type':'application/json'},body:JSON.stringify({fileName:'progress.csv',text})});
 const response=await onRequest({request,env:{DB:db}});assert.equal(response.status,200);assert.match(response.headers.get('Content-Type'),/application\/x-ndjson/);
 const events=(await response.text()).trim().split('\n').map(line=>JSON.parse(line));assert.equal(events[0].phase,'validating');const counts=events.filter(e=>e.total!==null).map(e=>e.completed);assert.ok(counts.length>4);assert.deepEqual(counts,[...counts].sort((a,b)=>a-b));const done=events.at(-1);assert.equal(done.phase,'complete');assert.equal(done.completed,done.total);assert.equal(done.result.imported,2201);assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS count FROM lead_import_batch_items').get().count,2201);
}finally{db.sqlite.close();}});

test('automatic mailbox checks are rejected before any database reads',async()=>{
 const db={prepare(){throw new Error('No database reads permitted for automatic checks');}};
 const result=await call(db,'mail/sync',{accountId:'local-only'});assert.equal(result.status,400);assert.match(result.data.error,/Automatic mailbox checks are disabled/);
});

test('usage safety guard holds sending before the application read/write allowance is exhausted',async()=>{
 const db=createTestDb();try{
 const day=new Date().toISOString().slice(0,10);db.sqlite.prepare('INSERT INTO app_usage_days(day,rows_read,rows_written) VALUES(?,?,?)').run(day,4000000,0);
 let result=await call(db,'internal/send-tick',{});assert.equal(result.status,503);assert.equal(result.data.code,'APP_USAGE_BUDGET');assert.ok(result.data.resetAt.endsWith('T00:00:00.000Z'));
 db.sqlite.prepare('UPDATE app_usage_days SET rows_read=0,rows_written=80000 WHERE day=?').run(day);result=await call(db,'state');assert.equal(result.status,503);assert.equal(result.data.code,'APP_USAGE_BUDGET');
}finally{db.sqlite.close();}});

test('summary-only sending polls do not load delivery activity',async()=>{
 const db=createTestDb();try{
 db.sqlite.exec("INSERT INTO templates(id,name,subject,body,created_at) VALUES('p','Plan','','Body','2026-01-01');INSERT INTO campaigns(id,name,template_id,status,created_at,allocation_json) VALUES('c','Direct send','p','Sending','2026-01-01','[]')");
 db.sqlite.exec("UPDATE campaigns SET in_flight_count=7,next_send_at='2026-11-20T09:00:00.000Z' WHERE id='c'");
 const queries=[],prepare=db.prepare;db.prepare=sql=>{queries.push(sql);return prepare(sql);};
 const result=await call(db,'sending/status?summary=1');assert.equal(result.status,200);assert.deepEqual(result.data.deliveries,[]);assert.equal(result.data.runs.length,1);assert.equal(result.data.runs[0].inFlight,7);assert.equal(result.data.runs[0].nextSendAt,'2026-11-20T09:00:00.000Z');assert.ok(!queries.some(sql=>sql.includes('d.started_at, d.sent_at')));assert.ok(!queries.some(sql=>sql.includes('account_health_events') || sql.includes('delivery_bounces')));
 queries.length=0;await call(db,'sending/status');assert.ok(queries.some(sql=>sql.includes('d.started_at, d.sent_at')));
 const day=new Date().toISOString().slice(0,10);assert.ok(db.sqlite.prepare('SELECT rows_written FROM app_usage_days WHERE day=?').get(day).rows_written>=3);
}finally{db.sqlite.close();}});


test('internal sender releases headers before work finishes and keeps confirmation in the body',{timeout:5000},async()=>{
 const db=createTestDb();let release;const gate=new Promise(r=>release=r);const prepare=db.prepare;
 db.prepare=sql=>{const statement=prepare(sql);if(sql.includes('SELECT c.id FROM campaigns c')){const bind=statement.bind;statement.bind=(...args)=>{const bound=bind(...args),first=bound.first;bound.first=async()=>{await gate;return first();};return bound;};}return statement;};
 try{const request=new Request('http://localhost/api/internal/send-tick',{method:'POST',headers:{Origin:'http://localhost','Content-Type':'application/json'},body:'{}'});
 const response=await onRequest({request,env:{DB:db}});const reader=response.body.getReader();const initial=await reader.read();assert.equal(new TextDecoder().decode(initial.value),' ');release();let text='';for(;;){const part=await reader.read();if(part.done)break;text+=new TextDecoder().decode(part.value);}assert.equal(JSON.parse(text).httpStatus,200);assert.equal(JSON.parse(text).done,true);
 }finally{release();db.sqlite.close();}
});

test('batch deletion preserves shared leads and accepted history and uses a lead seek',async()=>{const db=createTestDb();try{const s=db.sqlite; s.exec("INSERT INTO lead_import_batches(id,file_name,created_at) VALUES('b','old.csv','2026-01-01'),('other','other.csv','2026-01-01'); INSERT INTO leads(id,email,created_at) VALUES('unused','u@invalid.test','2026-01-01'),('shared','s@invalid.test','2026-01-01'),('sent','h@invalid.test','2026-01-01'); INSERT INTO lead_import_batch_items(batch_id,lead_id,created_at) VALUES('b','unused','2026-01-01'),('b','shared','2026-01-01'),('b','sent','2026-01-01'),('other','shared','2026-01-01'); INSERT INTO accounts(id,email,created_at) VALUES('a','a@invalid.test','2026-01-01'); INSERT INTO templates(id,name,subject,body,created_at) VALUES('p','Plan','','Body','2026-01-01'); INSERT INTO campaigns(id,name,template_id,status,created_at,allocation_json) VALUES('c','Direct send','p','Cancelled','2026-01-01','[]'); INSERT INTO campaign_deliveries(id,campaign_id,account_id,lead_id,batch_no,day_no,created_at,status) VALUES('d','c','a','sent',1,1,'2026-01-01','sent');");const r=await call(db,'import/batch/delete',{batchId:'b'});assert.equal(r.status,200);assert.equal(r.data.deleted,1);assert.equal(r.data.archived,1);assert.equal(r.data.retained,1);assert.equal(s.prepare("SELECT COUNT(*) n FROM leads WHERE id='unused'").get().n,0);assert.equal(s.prepare("SELECT status FROM leads WHERE id='sent'").get().status,'Archived');assert.equal(s.prepare("SELECT COUNT(*) n FROM campaign_deliveries WHERE id='d'").get().n,1);assert.equal(s.prepare("SELECT COUNT(*) n FROM lead_import_batches WHERE id='b'").get().n,0);const plan=s.prepare('EXPLAIN QUERY PLAN SELECT 1 FROM campaign_deliveries WHERE lead_id=?').all('sent').map(r=>r.detail).join(' ');assert.match(plan,/SEARCH .*idx_delivery_lead_history/);}finally{db.sqlite.close();}});
