import test from 'node:test';import assert from 'node:assert/strict';
import {createTestDb} from '../scripts/test-d1.mjs';
import {seedSenderQueue,claimReadyDeliverySql} from './ready-senders.mjs';
import {advanceQueuedCapacity} from './advance-queued-capacity.mjs';
import {recoverWaitingCapacity} from './waiting-capacity.mjs';
async function fixture(){
 const db=createTestDb(),s=db.sqlite,now=new Date(),stamp=now.toISOString(),later=new Date(+now+3600000).toISOString();
 s.prepare("INSERT INTO templates(id,name,subject,body,created_at) VALUES('p','Plan','','Body',?)").run(stamp);
 s.prepare("INSERT INTO campaigns(id,name,template_id,status,created_at,allocation_json,planned_sends,pending_count) VALUES('c','Direct send','p','Scheduled',?,'[]',20,20)").run(stamp);
 for(const id of ['a','b','cooling','paused','full']){
  s.prepare("INSERT INTO accounts(id,email,cap,created_at,connection,credential_ciphertext,smtp_verified_at) VALUES(?,?,2,?,'Connected','local-only',?)").run(id,id+'@invalid.test',stamp,stamp);
  for(let i=0;i<4;i++){const key=id+i;s.prepare('INSERT INTO leads(id,email,created_at) VALUES(?,?,?)').run(key,key+'@invalid.test',stamp);s.prepare("INSERT INTO campaign_deliveries(id,campaign_id,account_id,lead_id,batch_no,day_no,created_at,template_id) VALUES(?,'c',?,?,1,2,?,'p')").run(key,id,key,stamp);}
 }
 s.prepare("UPDATE accounts SET send_retry_after=? WHERE id='cooling'").run(later);
 s.exec("UPDATE accounts SET paused=1 WHERE id='paused'");
 s.prepare("UPDATE campaign_deliveries SET status='uncertain',started_at=? WHERE id='a0'").run(stamp);
 s.prepare("UPDATE campaign_deliveries SET status='sent',sent_at=? WHERE id IN ('full0','full1')").run(stamp);
 s.prepare("UPDATE campaign_deliveries SET retry_after=? WHERE id='b0'").run(later);
 await seedSenderQueue(db,'c');return{db,s,now,stamp,later};
}
test('idle recovery uses real free quota despite future allocations without changing recipients or holds',async()=>{
 const {db,s,now,stamp,later}=await fixture();try{
  const before=s.prepare('SELECT id,account_id,lead_id,template_id,status FROM campaign_deliveries ORDER BY id').all();
  const result=await recoverWaitingCapacity(db,{campaignId:'c',now});
  assert.equal(result.advanced,3);assert.equal(result.moved,0);
  assert.deepEqual(s.prepare('SELECT id,account_id,lead_id,template_id,status FROM campaign_deliveries ORDER BY id').all(),before);
  assert.equal(s.prepare("SELECT COUNT(*) n FROM campaign_deliveries WHERE day_no=1 AND account_id='a'").get().n,1);
  assert.equal(s.prepare("SELECT COUNT(*) n FROM campaign_deliveries WHERE day_no=1 AND account_id='b'").get().n,2);
  assert.equal(s.prepare("SELECT COUNT(*) n FROM campaign_deliveries WHERE day_no=1 AND account_id IN ('paused','cooling','full')").get().n,0);
  assert.equal(s.prepare("SELECT day_no FROM campaign_deliveries WHERE id='b0'").get().day_no,2);
  assert.equal(s.prepare("SELECT retry_after FROM campaign_deliveries WHERE id='b0'").get().retry_after,later);
  assert.equal(s.prepare("SELECT send_retry_after FROM accounts WHERE id='cooling'").get().send_retry_after,later);
  assert.equal(s.prepare('SELECT COUNT(*) n FROM delivery_schedule_advances').get().n,3);
  assert.equal(s.prepare("SELECT status FROM campaigns WHERE id='c'").get().status,'Sending');
  assert.equal(s.prepare("SELECT used_count FROM sender_budget WHERE account_id='a'").get().used_count,1);
  assert.equal((await recoverWaitingCapacity(db,{campaignId:'c',now})).advanced,0);
  assert.equal(s.prepare('SELECT COUNT(*) n FROM delivery_schedule_advances').get().n,3);
  const id=s.prepare("SELECT id FROM campaign_deliveries WHERE account_id='a' AND day_no=1").get().id;
  assert.equal(s.prepare(claimReadyDeliverySql).run(stamp,id,stamp).changes,1);
  assert.equal(s.prepare(claimReadyDeliverySql).run(stamp,id,stamp).changes,0);
 }finally{s.close();}
});
test('a pause winning before advancement preserves the queued schedule and manual pause',async()=>{
 const {db,s,stamp}=await fixture();try{
  const batch=db.batch;db.batch=statements=>{s.exec("UPDATE campaigns SET status='User paused' WHERE id='c'");return batch(statements);};
  assert.equal(await advanceQueuedCapacity(db,{campaignId:'c',day:1,stamp}),0);
  assert.equal(s.prepare("SELECT COUNT(*) n FROM campaign_deliveries WHERE day_no=1").get().n,0);
  assert.equal(s.prepare('SELECT COUNT(*) n FROM delivery_schedule_advances').get().n,0);
  assert.equal(s.prepare("SELECT status FROM campaigns WHERE id='c'").get().status,'User paused');
 }finally{s.close();}
});
test('a provider cooldown winning before advancement blocks that sender at the atomic update',async()=>{
 const {db,s,stamp,later}=await fixture();try{
  const batch=db.batch;db.batch=statements=>{s.prepare("UPDATE accounts SET send_retry_after=? WHERE id='a'").run(later);return batch(statements);};
  assert.equal(await advanceQueuedCapacity(db,{campaignId:'c',day:1,stamp}),2);
  assert.equal(s.prepare("SELECT COUNT(*) n FROM campaign_deliveries WHERE day_no=1 AND account_id='a'").get().n,0);
  assert.equal(s.prepare('SELECT COUNT(*) n FROM delivery_schedule_advances').get().n,2);
 }finally{s.close();}
});
