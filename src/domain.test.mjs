import { test } from 'node:test';
import assert from 'node:assert/strict';
import {allocate, allocateAcrossDays, allocateRepeatedCampaign, assignScoutingPlans, assessAccountHealth, parseLeads} from './domain.mjs';
import {parseCredentialFile} from './gmail.mjs';
import {createCampaignMessageOptions} from '../functions/_lib/gmail.js';
import {createSession, readSessionCookie, verifySession} from '../functions/_lib/auth.js';
import {decryptCredential, encryptCredential} from '../functions/_lib/credentials.js';
import scheduledSender from './send-scheduler.js';
import {eligibleLeadsSql} from './sending-query.mjs';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync, readdirSync} from 'node:fs';
test('balances 2000 leads across 82 accounts within cap',()=>{
 const r=allocate(Array.from({length:2000},(_,id)=>({id})),Array.from({length:82},(_,id)=>({id,cap:40})));
 const counts=Object.values(Object.groupBy(r.assignments,x=>x.accountId)).map(x=>x.length);
 assert.equal(counts.filter(x=>x===25).length,32); assert.equal(counts.filter(x=>x===24).length,50); assert.equal(r.remaining,0);
});
test('respects capacity and paused accounts',()=>{
 const r=allocate([{id:1},{id:2},{id:3}],[{id:1,cap:2,used:1},{id:2,paused:true}]);
 assert.equal(r.assignments.length,1); assert.equal(r.remaining,2);
});
test('only connected cloud accounts receive dry-run assignments',()=>{
 const r=allocate([{id:1},{id:2}],[{id:'connected',cap:1,connection:'Connected'},{id:'pending',cap:1,connection:'Pending connection'}]);
 assert.deepEqual(r.assignments.map(item=>item.accountId),['connected']);
 assert.equal(r.remaining,1);
});
test('plans 12000 leads over verified accounts and respects per-day caps',()=>{
 const accounts=Array.from({length:79},(_,id)=>({id,cap:40,connection:id<74?'Verified via IMAP':'Connection failed'}));
 const r=allocateAcrossDays(Array.from({length:12000},(_,id)=>({id})),accounts,40);
 assert.equal(r.days,5);
 assert.equal(r.assignments.length,12000);
 assert.equal(r.remaining,0);
 for(let day=1;day<=r.days;day++){
  const rows=r.assignments.filter(item=>item.day===day);
  assert.ok(rows.length<=74*40);
  assert.ok(rows.every(item=>item.accountId<74));
  for(const account of accounts.filter(a=>a.connection==='Verified via IMAP')){
   assert.ok(rows.filter(item=>item.accountId===account.id).length<=40);
  }
 }
});
test('repeats a 2000-lead list across each 50-account batch at a hard cap of 40',()=>{
 const leads=Array.from({length:2000},(_,id)=>({id}));
 const accounts=Array.from({length:100},(_,id)=>({id,cap:500,connection:'Connected'}));
 const result=allocateRepeatedCampaign(leads,accounts,500);
 assert.equal(result.sends,4000);
 assert.equal(result.days,1);
 assert.equal(result.batches,2);
 assert.equal(result.assignments.length,100);
 for(let batch=1;batch<=2;batch++){
  const rows=result.assignments.filter(item=>item.batch===batch);
  assert.equal(rows.reduce((total,item)=>total+item.leadIds.length,0),2000);
  assert.ok(rows.every(item=>item.leadIds.length===40));
 }
});
test('allocates 3000 unique leads first, then reuses 1000 from the first group to fill the second',()=>{
 const leads=Array.from({length:3000},(_,id)=>({id}));
 const accounts=Array.from({length:100},(_,id)=>({id,cap:40,connection:'Connected'}));
 const result=allocateRepeatedCampaign(leads,accounts);
 assert.equal(result.sends,4000);
 assert.equal(result.days,1);
 for(let batch=1;batch<=2;batch++){
  const rows=result.assignments.filter(item=>item.batch===batch);
  assert.equal(rows.reduce((total,item)=>total+item.leadIds.length,0),2000);
  assert.ok(rows.every(item=>item.leadIds.length===40));
  assert.ok(rows.every(item=>new Set(item.leadIds).size===item.leadIds.length));
 }
 const firstGroup=new Set(result.assignments.filter(item=>item.batch===1).flatMap(item=>item.leadIds));
 const secondGroup=new Set(result.assignments.filter(item=>item.batch===2).flatMap(item=>item.leadIds));
 assert.equal(firstGroup.size,2000);
 assert.equal(secondGroup.size,2000);
 assert.equal([...secondGroup].filter(leadId=>firstGroup.has(leadId)).length,1000);
});
test('splits a 4000-lead list between two 50-account groups without repeats',()=>{
 const leads=Array.from({length:4000},(_,id)=>({id}));
 const accounts=Array.from({length:100},(_,id)=>({id,cap:40,connection:'Connected'}));
 const result=allocateRepeatedCampaign(leads,accounts);
 assert.equal(result.sends,4000);
 for(let batch=1;batch<=2;batch++){
  const rows=result.assignments.filter(item=>item.batch===batch);
  assert.equal(rows.reduce((total,item)=>total+item.leadIds.length,0),2000);
  assert.ok(rows.every(item=>item.leadIds.length===40));
 }
 assert.equal(new Set(result.assignments.flatMap(item=>item.leadIds)).size,4000);
});
test('reuses a smaller lead list across unused sender capacity without same-sender repeats',()=>{
 const leads=Array.from({length:1000},(_,id)=>({id}));
 const accounts=Array.from({length:50},(_,id)=>({id,cap:40,connection:'Connected'}));
 const result=allocateRepeatedCampaign(leads,accounts);
 assert.equal(result.sends,2000);
 assert.ok(result.assignments.every(item=>item.leadIds.length===40));
 assert.ok(result.assignments.every(item=>new Set(item.leadIds).size===item.leadIds.length));
});
test('continues remaining unique leads in the next 24-hour window',()=>{
 const leads=Array.from({length:5000},(_,id)=>({id}));
 const accounts=Array.from({length:100},(_,id)=>({id,cap:40,connection:'Connected'}));
 const result=allocateRepeatedCampaign(leads,accounts);
 assert.equal(result.sends,8000);
 assert.equal(result.days,2);
 for(let day=1;day<=2;day++){
  const rows=result.assignments.filter(item=>item.day===day);
  assert.equal(rows.reduce((total,item)=>total+item.leadIds.length,0),4000);
  assert.ok(rows.every(item=>item.leadIds.length<=40));
 }
 const perAccount=new Map();
 for(const item of result.assignments){
  const key=`${item.accountId}:${item.day}`;
  perAccount.set(key,(perAccount.get(key)||0)+item.leadIds.length);
 }
 assert.ok([...perAccount.values()].every(count=>count<=40));
});
test('randomly assigns one stable scouting plan per sending account',()=>{
 const templates=Array.from({length:4},(_,id)=>({id:`t${id+1}`,name:`Plan ${id+1}`,subject:'',body:'Hello {{name}}'}));
 const assignments=[
  {accountId:'a1',day:1,leadIds:['l1']},
  {accountId:'a1',day:2,leadIds:['l2']},
  {accountId:'a2',day:1,leadIds:['l3']}
 ];
 const selected=[0,0.75];
 const result=assignScoutingPlans(assignments,templates,[
  {id:'l1',name:'One'},{id:'l2',name:'Two'},{id:'l3',name:'Three'}
 ],()=>selected.shift());
 assert.equal(result.missingAccountId,null);
 assert.deepEqual(result.assignments.map(item=>item.templateId),['t1','t1','t4']);
 assert.deepEqual([...new Set(result.assignments.filter(item=>item.accountId==='a1').map(item=>item.templateId))],['t1']);
});
test('random plan selection excludes plans missing recipient personalization',()=>{
 const result=assignScoutingPlans(
  [{accountId:'a1',leadIds:['l1']}],
  [
   {id:'store',name:'Store plan',subject:'',body:'Hello {{store}}'},
   {id:'basic',name:'Basic plan',subject:'',body:'Hello there'}
  ],
  [{id:'l1',name:'Lead',store:''}],
  ()=>0
 );
 assert.equal(result.assignments[0].templateId,'basic');
 assert.equal(assignScoutingPlans(
  [{accountId:'a1',leadIds:['l1']}],
  [{id:'store',name:'Store plan',subject:'',body:'Hello {{store}}'}],
  [{id:'l1',name:'Lead',store:''}]
 ).missingAccountId,'a1');
});
test('classifies connection failures without claiming reputation status',()=>{
 assert.equal(assessAccountHealth({imap:true,smtp:true}).status,'Healthy');
 assert.equal(assessAccountHealth({imap:true,smtp:false,smtpError:{code:'535',message:'Authentication failed'}}).status,'Warning');
 assert.equal(assessAccountHealth({imap:false,smtp:false,imapError:{code:'AUTH',message:'Account blocked by provider'}}).status,'Restricted');
});
test('imports a 12000-lead CSV',()=>{
 const csv=['email,name,store',...Array.from({length:12000},(_,id)=>`lead${id}@example.com,Lead ${id},Store ${id}`)].join('\n');
 const r=parseLeads(csv);
 assert.equal(r.leads.length,12000);
 assert.equal(r.invalid,0);
});
test('parses app-password records without accepting malformed entries',()=>{
 const records=parseCredentialFile('\uFEFFabcd efgh ijkl mnop pilot@example.com\nshort pass broken@example.com\nqrst uvwx yzab cdef not-an-email');
 assert.deepEqual(records.map(({line,email,password})=>({line,email,password})),[
  {line:1,email:'pilot@example.com',password:'abcdefghijklmnop'}
 ]);
});
test('body-only campaign messages omit the subject header',()=>{
 const common={email:'sender@example.com',to:'lead@example.com',text:'Hello there',messageId:'<test@relay.example>'};
 const bodyOnly=createCampaignMessageOptions({...common,subject:'  '});
 assert.equal(Object.hasOwn(bodyOnly,'subject'),false);
 assert.equal(createCampaignMessageOptions({...common,subject:'A quick note'}).subject,'A quick note');
});
test('scheduled sender processes at most 150 messages with ten concurrent requests per tick',async()=>{
 const originalFetch=globalThis.fetch;
 let calls=0,active=0,maximumActive=0;
 globalThis.fetch=async()=>{
  calls++;active++;maximumActive=Math.max(maximumActive,active);
  await Promise.resolve();
  active--;
  return new Response(JSON.stringify({sent:true}),{status:200,headers:{'Content-Type':'application/json'}});
 };
 try{
  await scheduledSender.scheduled({},{
   DASHBOARD_API_URL:'https://dashboard.example',
   BACKGROUND_CRON_SECRET:'test-only-secret'
  });
  assert.equal(calls,150);
  assert.equal(maximumActive,10);
 }finally{
  globalThis.fetch=originalFetch;
 }
});
test('campaign progress counters backfill and follow delivery status changes',()=>{
 const db=new DatabaseSync(':memory:');
 try{
  const migrations=readdirSync(new URL('../migrations/',import.meta.url)).filter(name=>name.endsWith('.sql')).sort();
  for(const name of migrations){
   if(name==='0016_campaign_progress_counters.sql')break;
   db.exec(readFileSync(new URL(`../migrations/${name}`,import.meta.url),'utf8'));
  }
  db.exec(`
   INSERT INTO accounts (id,email,created_at) VALUES ('a1','sender@example.com','2026-01-01T00:00:00.000Z');
   INSERT INTO leads (id,email,created_at) VALUES
    ('l1','one@example.com','2026-01-01T00:00:00.000Z'),
    ('l2','two@example.com','2026-01-01T00:00:00.000Z'),
    ('l3','three@example.com','2026-01-01T00:00:00.000Z');
   INSERT INTO campaigns (id,name,template_id,status,created_at,allocation_json)
    VALUES ('c1','Direct send','seed-intro','Sending','2026-01-01T00:00:00.000Z','[]');
   INSERT INTO campaign_deliveries (id,campaign_id,batch_no,day_no,lead_id,account_id,status,created_at,last_error) VALUES
    ('d1','c1',1,1,'l1','a1','queued','2026-01-01T00:00:00.000Z',NULL),
    ('d2','c1',1,1,'l2','a1','uncertain','2026-01-01T00:00:00.000Z','SMTP_UNCONFIRMED'),
    ('d3','c1',1,1,'l3','a1','failed','2026-01-01T00:00:00.000Z','SMTP_550');
  `);
  db.exec(readFileSync(new URL('../migrations/0016_campaign_progress_counters.sql',import.meta.url),'utf8'));
  const readProgress=()=>({...db.prepare(`SELECT planned_sends,sent_count,pending_count,uncertain_count,failed_count,failure_codes FROM campaigns WHERE id='c1'`).get()});
  assert.deepEqual(readProgress(),{
   planned_sends:3,sent_count:0,pending_count:1,uncertain_count:1,failed_count:1,failure_codes:'SMTP_550'
  });
  db.exec("UPDATE campaign_deliveries SET status='sending' WHERE id='d1'; UPDATE campaign_deliveries SET status='queued' WHERE id='d1';");
  assert.equal(readProgress().pending_count,1);
  db.exec("UPDATE campaign_deliveries SET status='sending' WHERE id='d1'; UPDATE campaign_deliveries SET status='sent' WHERE id='d1';");
  db.exec("UPDATE campaign_deliveries SET status='queued',last_error=NULL WHERE id='d2';");
  assert.equal(readProgress().pending_count,1);
  db.exec("UPDATE campaign_deliveries SET status='sending' WHERE id='d2'; UPDATE campaign_deliveries SET status='sent' WHERE id='d2';");
  const progress=readProgress();
  assert.deepEqual(progress,{
   planned_sends:3,sent_count:2,pending_count:0,uncertain_count:0,failed_count:1,failure_codes:'SMTP_550'
  });
 }finally{
  db.close();
 }
});
test('send-start eligibility uses indexed blocker sets and preserves suppression rules',()=>{
 const db=new DatabaseSync(':memory:');
 const legacyEligibilitySql=`
   SELECT l.id FROM leads l
   WHERE l.status = 'Ready'
     AND NOT EXISTS (
       SELECT 1 FROM campaign_deliveries d
       WHERE d.lead_id = l.id AND d.status IN ('sending', 'sent', 'uncertain')
     )
     AND NOT EXISTS (
       SELECT 1 FROM threads th JOIN messages m ON m.thread_id = th.id
       WHERE lower(th.email) = lower(l.email) AND m.direction = 'out'
         AND m.send_state IN ('sending', 'sent', 'uncertain')
     )
 `;
 try{
  const migrations=readdirSync(new URL('../migrations/',import.meta.url)).filter(name=>name.endsWith('.sql')).sort();
  for(const name of migrations){
   if(name==='0017_sending_eligibility_indexes.sql') break;
   db.exec(readFileSync(new URL(`../migrations/${name}`,import.meta.url),'utf8'));
  }
  const insertLead=db.prepare('INSERT INTO leads (id,email,created_at) VALUES (?,?,?)');
  for(let index=0;index<9000;index++) insertLead.run(`lead-${index}`,`lead-${index}@example.com`,'2026-11-17T00:00:00.000Z');
  db.exec(`
   INSERT INTO accounts (id,email,created_at) VALUES ('a1','sender@example.com','2026-11-17T00:00:00.000Z');
   INSERT INTO campaigns (id,name,template_id,status,created_at,allocation_json)
     VALUES ('c1','Direct send','seed-intro','User paused','2026-11-17T00:00:00.000Z','[]');
  `);
  const insertDelivery=db.prepare(`
   INSERT INTO campaign_deliveries (id,campaign_id,batch_no,day_no,lead_id,account_id,status,created_at)
   VALUES (?,?,?,?,?,?,?,?)
  `);
  for(let index=0;index<4000;index++) insertDelivery.run(`queued-${index}`,'c1',1,1,`lead-${index}`,'a1','queued','2026-11-17T00:00:00.000Z');
  insertDelivery.run('sent-1','c1',1,1,'lead-8000','a1','sent','2026-11-17T00:00:00.000Z');
  insertDelivery.run('sending-1','c1',1,1,'lead-8001','a1','sending','2026-11-17T00:00:00.000Z');
  insertDelivery.run('uncertain-1','c1',1,1,'lead-8002','a1','uncertain','2026-11-17T00:00:00.000Z');
  insertDelivery.run('failed-1','c1',1,1,'lead-8003','a1','failed','2026-11-17T00:00:00.000Z');
  db.exec(`
   INSERT INTO threads (id,name,email,subject,account_id) VALUES
    ('t-sent','Sent reply','LEAD-8004@example.com','Re: hello','a1'),
    ('t-queued','Queued reply','lead-8005@example.com','Re: hello','a1');
   INSERT INTO messages (id,thread_id,direction,body,time,send_state) VALUES
    ('m-sent','t-sent','out','reply','2026-11-17T00:00:00.000Z','sent'),
    ('m-queued','t-queued','out','reply','2026-11-17T00:00:00.000Z','queued');
  `);
  const legacyPlan=db.prepare(`EXPLAIN QUERY PLAN ${legacyEligibilitySql}`).all().map(row=>row.detail).join('\n');
  assert.match(legacyPlan,/CORRELATED SCALAR SUBQUERY/);
  assert.match(legacyPlan,/SCAN d/);
  db.exec(readFileSync(new URL('../migrations/0017_sending_eligibility_indexes.sql',import.meta.url),'utf8'));
  const optimizedPlan=db.prepare(`EXPLAIN QUERY PLAN ${eligibleLeadsSql}`).all().map(row=>row.detail).join('\n');
  assert.doesNotMatch(optimizedPlan,/CORRELATED SCALAR SUBQUERY/);
  assert.match(optimizedPlan,/idx_campaign_deliveries_status_lead/);
  assert.match(optimizedPlan,/idx_messages_direction_state_thread/);
  assert.doesNotMatch(optimizedPlan,/SCAN d(?:\s|$)/);
  assert.doesNotMatch(optimizedPlan,/SCAN m(?:\s|$)/);
  db.exec(readFileSync(new URL('../migrations/0018_inbox_summary_index.sql',import.meta.url),'utf8'));
  const inboxSummaryPlan=db.prepare('EXPLAIN QUERY PLAN SELECT thread_id, direction, body, time, send_state FROM messages ORDER BY time DESC, id DESC LIMIT 250').all().map(row=>row.detail).join('\n');
  assert.match(inboxSummaryPlan,/idx_messages_time_thread/);
  const eligible=new Set(db.prepare(eligibleLeadsSql).all().map(row=>row.id));
  assert.equal(eligible.has('lead-8000'),false);
  assert.equal(eligible.has('lead-8001'),false);
  assert.equal(eligible.has('lead-8002'),false);
  assert.equal(eligible.has('lead-8003'),true);
  assert.equal(eligible.has('lead-8004'),false);
  assert.equal(eligible.has('lead-8005'),true);
 }finally{
  db.close();
 }
});
test('signs dashboard sessions and rejects tampering',async()=>{
 const secret='test-only-dashboard-password-123456';
 const session=await createSession(secret);
 assert.equal(await verifySession(session.token,secret),true);
 assert.equal(await verifySession(session.token,`${secret}x`),false);
 assert.equal(await verifySession(`${session.token}x`,secret),false);
 const request=new Request('https://dashboard.example/',{headers:{Cookie:`other=value; relay_session=${session.token}`}});
 assert.equal(readSessionCookie(request),session.token);
});
test('encrypts account credentials and binds them to the account email',async()=>{
 const key=Buffer.alloc(32,7).toString('base64url');
 const encrypted=await encryptCredential('pilot@example.com','abcd efgh ijkl mnop',key);
 assert.notEqual(encrypted,'abcd efgh ijkl mnop');
 assert.equal(await decryptCredential('pilot@example.com',encrypted,key),'abcd efgh ijkl mnop');
 await assert.rejects(decryptCredential('other@example.com',encrypted,key));
 await assert.rejects(decryptCredential('pilot@example.com',encrypted,Buffer.alloc(32,8).toString('base64url')));
});
test('CSV quoted fields, deduplication and invalid addresses',()=>{
 const r=parseLeads('email,name,store\na@example.com,A,"Store, One"\na@example.com,B,X\nbad,C,X\nb@example.com,B,Y');
 assert.equal(r.leads[0].store,'Store, One'); assert.equal(r.leads.length,2); assert.equal(r.duplicates,1); assert.equal(r.invalid,1);
});

test('scheduler bounds contention retries and never retries an unconfirmed request',async()=>{
 const originalFetch=globalThis.fetch;let calls=0;
 try{
 globalThis.fetch=async()=>{calls++;return new Response(JSON.stringify({busy:true}),{headers:{'Content-Type':'application/json'}});};
 await scheduledSender.scheduled({},{DASHBOARD_API_URL:'https://dashboard.example',BACKGROUND_CRON_SECRET:'local-only'});assert.equal(calls,300);
 calls=0;globalThis.fetch=async()=>{calls++;throw new Error('No confirmation');};await scheduledSender.scheduled({},{DASHBOARD_API_URL:'https://dashboard.example',BACKGROUND_CRON_SECRET:'local-only'});assert.ok(calls<=10);
 }finally{globalThis.fetch=originalFetch;}
});
