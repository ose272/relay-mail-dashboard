import test from 'node:test';
import assert from 'node:assert/strict';
import { createTestDb } from '../scripts/test-d1.mjs';
import { nextCandidatesSql, selectNextDelivery } from './send-selection.mjs';
test('send selection uses sender seeks and preserves quotas, retries, day gates and round robin',async()=>{
 const db=createTestDb(),s=db.sqlite;try{
 s.exec("INSERT INTO templates(id,name,subject,body,created_at) VALUES('p','Plan','','Body','2026-01-01'); INSERT INTO campaigns(id,name,template_id,status,created_at,allocation_json) VALUES('c','Direct send','p','Sending','2026-01-01','[]');");
 const account=s.prepare("INSERT INTO accounts(id,email,cap,created_at,connection,credential_ciphertext,smtp_verified_at) VALUES(?,?,40,'2026-01-01','Connected','local-only','2026-01-01')");
 const lead=s.prepare("INSERT INTO leads(id,email,created_at) VALUES(?,?,'2026-01-01')");const delivery=s.prepare("INSERT INTO campaign_deliveries(id,campaign_id,account_id,lead_id,batch_no,day_no,created_at,status,sent_at) VALUES(?,'c',?,?,1,?,'2026-01-01',?,?)");
 for(let a=0;a<74;a++){account.run('a'+a,`a${a}@invalid.test`);for(let i=0;i<120;i++){const id=`d${a}-${i}`;lead.run(id,id+'@invalid.test');delivery.run(id,'a'+a,id,Math.floor(i/40)+1,'queued',null);}}
 const now='2026-11-19T09:00:00.000Z',cutoff='2026-11-18T09:00:00.000Z';
 const choose=()=>selectNextDelivery(db,{cutoff,campaignId:'c',currentDay:1,nowIso:now,defaultCap:40});
 const lanes=await Promise.all(Array.from({length:10},(_,candidateOffset)=>selectNextDelivery(db,{cutoff,campaignId:'c',currentDay:1,nowIso:now,defaultCap:40,candidateOffset})));assert.equal(new Set(lanes.map(c=>c.id)).size,10);
 assert.equal((await choose()).id,'d0-0');s.exec("UPDATE campaign_deliveries SET status='sent',sent_at='2026-11-19T08:00:00.000Z' WHERE id='d0-0'");assert.equal((await choose()).id,'d1-0');
 s.exec("UPDATE accounts SET paused=1 WHERE id='a1'; UPDATE campaign_deliveries SET retry_after='2026-11-20T00:00:00.000Z' WHERE account_id='a2' AND day_no=1");assert.equal((await choose()).id,'d3-0');
 s.exec("UPDATE accounts SET cap=1 WHERE id='a0'; UPDATE accounts SET paused=1 WHERE id NOT IN ('a0','a1','a2')");assert.equal((await choose()).id,null);assert.equal((await choose()).nextQuotaAt,'2026-11-20T08:00:01.000Z');
 const plan=s.prepare('EXPLAIN QUERY PLAN '+nextCandidatesSql).all('c','c',1,now).map(r=>r.detail).join('\n');assert.match(plan,/idx_delivery_sender_queue_seek/);assert.match(plan,/idx_delivery_campaign_sender_time/);assert.doesNotMatch(plan,/SCAN (?:usage|recent|d)\b/);
 console.log('Indexed selector query plan:\n'+plan);
 }finally{s.close();}
});

test('atomic claims prevent duplicates, same-sender overlap and more than 150 in-flight messages',async()=>{
 const {claimDeliverySql}=await import('./send-selection.mjs');const db=createTestDb(),s=db.sqlite;
 try{
 s.exec("INSERT INTO templates(id,name,subject,body,created_at) VALUES('p','Plan','','Body','2026-01-01');INSERT INTO campaigns(id,name,template_id,status,created_at,allocation_json) VALUES('c','Direct send','p','Sending','2026-01-01','[]');");
 for(let i=0;i<151;i++){s.prepare("INSERT INTO accounts(id,email,cap,created_at,connection,credential_ciphertext,smtp_verified_at) VALUES(?,?,40,'2026-01-01','Connected','local-only','2026-01-01')").run('a'+i,`a${i}@invalid.test`);for(let j=0;j<2;j++){const id=`a${i}d${j}`;s.prepare("INSERT INTO leads(id,email,created_at) VALUES(?,?,'2026-01-01')").run(id,id+'@invalid.test');s.prepare("INSERT INTO campaign_deliveries(id,campaign_id,account_id,lead_id,batch_no,day_no,created_at) VALUES(?,'c',?,?,1,1,'2026-01-01')").run(id,'a'+i,id);}}
 const claim=(id,a,cap=40)=>s.prepare(claimDeliverySql).run('2026-11-19T09:00:00.000Z',id,a,'2026-11-18T09:00:00.000Z',cap,40).changes;
 assert.equal(claim('a0d0','a0'),1);assert.equal(claim('a0d0','a0'),0);assert.equal(claim('a0d1','a0'),0);
 for(let i=1;i<150;i++)assert.equal(claim(`a${i}d0`,'a'+i),1);assert.equal(claim('a150d0','a150'),0);
 s.exec("UPDATE campaign_deliveries SET status='sent',sent_at='2026-11-19T09:00:00.000Z' WHERE id='a0d0'");assert.equal(claim('a0d1','a0',1),0);assert.equal(claim('a150d0','a150'),1);
 s.exec("UPDATE campaign_deliveries SET status='sent',sent_at='2026-11-19T09:00:00.000Z' WHERE id='a1d0'; UPDATE campaigns SET status='Needs review' WHERE id='c'");assert.equal(claim('a1d1','a1'),0);s.exec("UPDATE campaigns SET status='User paused' WHERE id='c'");assert.equal(claim('a1d1','a1'),0);
 }finally{s.close();}
});

test('stale-send recovery seeks only in-flight IDs and leaves queued/sent deliveries untouched',async()=>{
 const {expireStaleDeliveriesSql}=await import('./send-selection.mjs');const db=createTestDb(),s=db.sqlite;try{
 s.exec("INSERT INTO templates(id,name,subject,body,created_at) VALUES('p','Plan','','Body','2026-01-01');INSERT INTO campaigns(id,name,template_id,status,created_at,allocation_json) VALUES('c','Direct send','p','Sending','2026-01-01','[]');INSERT INTO accounts(id,email,created_at) VALUES('a','local@invalid.test','2026-01-01');");
 const lead=s.prepare("INSERT INTO leads(id,email,created_at) VALUES(?,?,'2026-01-01')"),delivery=s.prepare("INSERT INTO campaign_deliveries(id,campaign_id,account_id,lead_id,batch_no,day_no,created_at) VALUES(?,'c','a',?,1,1,'2026-01-01')");for(let i=0;i<8880;i++){lead.run('l'+i,`l${i}@invalid.test`);delivery.run('d'+i,'l'+i);}
 const stmt=s.prepare(expireStaleDeliveriesSql);assert.equal(stmt.run('c','2026-11-19T09:00:00.000Z').changes,0);s.exec("UPDATE campaign_deliveries SET status='sending',started_at='2026-11-19T08:00:00.000Z' WHERE id='d0';UPDATE campaign_deliveries SET status='sent' WHERE id='d1'");assert.equal(stmt.run('c','2026-11-19T09:00:00.000Z').changes,1);assert.equal(s.prepare("SELECT status FROM campaign_deliveries WHERE id='d0'").get().status,'uncertain');assert.equal(s.prepare("SELECT status FROM campaign_deliveries WHERE id='d1'").get().status,'sent');
 const plan=s.prepare('EXPLAIN QUERY PLAN '+expireStaleDeliveriesSql).all('c','2026-11-19T09:00:00.000Z').map(r=>r.detail).join('\n');assert.match(plan,/SEARCH stale USING INDEX idx_delivery_stale_inflight/);assert.match(plan,/SEARCH campaign_deliveries USING/);assert.doesNotMatch(plan,/SCAN campaign_deliveries/);
 }finally{s.close();}
});
