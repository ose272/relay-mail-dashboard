import test from 'node:test';import assert from 'node:assert/strict';import {createTestDb} from '../scripts/test-d1.mjs';import {cancelCampaign} from './campaign-control.mjs';import {seedSenderQueue,claimReadyDeliverySql} from './ready-senders.mjs';

test('terminal campaign transitions cannot hide queued work even with stale counters',()=>{const {s}=fixture();try{
 for(const status of ['Complete','Superseded'])assert.throws(()=>s.prepare('UPDATE campaigns SET status=?,pending_count=0 WHERE id=\'c\'').run(status),/pending deliveries/);
 assert.throws(()=>s.prepare("DELETE FROM campaigns WHERE id='c'").run(),/history must be retained/);
 assert.throws(()=>s.prepare("DELETE FROM campaign_deliveries WHERE id='d1'").run(),/explicit campaign cancellation/);
 assert.equal(s.prepare("SELECT COUNT(*) n FROM campaign_deliveries WHERE status='queued'").get().n,2);
}finally{s.close();}});

test('cancellation retains quota evidence and cannot cascade away accepted or uncertain sends',async()=>{const {db,s,now}=fixture();try{
 s.prepare("UPDATE campaign_deliveries SET status='sending',started_at=? WHERE id='d1'").run(now);
 s.prepare("UPDATE campaign_deliveries SET status='uncertain' WHERE id='d1'").run();
 await cancelCampaign(db,'c');
 for(const id of ['d0','d1'])assert.throws(()=>s.prepare('DELETE FROM campaign_deliveries WHERE id=?').run(id),/history must be retained/);
 assert.throws(()=>s.prepare("DELETE FROM campaigns WHERE id='c'").run(),/history must be retained/);
 assert.equal(s.prepare("SELECT used_count FROM sender_budget WHERE account_id='a'").get().used_count,2);
 assert.equal(s.prepare("SELECT cancelled_count FROM campaigns WHERE id='c'").get().cancelled_count,1);
}finally{s.close();}});

test('a genuinely exhausted campaign can finish and retained usage survives lead archival',()=>{const {s}=fixture();try{
 s.prepare("UPDATE campaign_deliveries SET status='failed' WHERE status='queued'").run();
 s.prepare("UPDATE campaigns SET status='Complete' WHERE id='c'").run();
 s.prepare("UPDATE leads SET status='Archived' WHERE id='l0'").run();
 assert.equal(s.prepare("SELECT used_count FROM sender_budget WHERE account_id='a'").get().used_count,1);
 assert.equal(s.prepare("SELECT status FROM campaigns WHERE id='c'").get().status,'Complete');
}finally{s.close();}});
function fixture(){const db=createTestDb(),s=db.sqlite,now=new Date().toISOString();s.prepare("INSERT INTO accounts(id,email,created_at,connection,credential_ciphertext,smtp_verified_at) VALUES('a','sender@invalid.test',?,'Connected','local-only',?)").run(now,now);s.prepare("INSERT INTO templates(id,name,subject,body,created_at) VALUES('p','Plan','','Hello',?)").run(now);s.prepare("INSERT INTO campaigns(id,name,template_id,status,created_at,allocation_json,planned_sends,pending_count) VALUES('c','Direct send','p','Sending',?,'[]',3,3)").run(now);for(let i=0;i<3;i++){s.prepare('INSERT INTO leads(id,email,created_at) VALUES(?,?,?)').run('l'+i,`l${i}@invalid.test`,now);s.prepare("INSERT INTO campaign_deliveries(id,campaign_id,account_id,lead_id,batch_no,day_no,created_at,template_id) VALUES(?,'c','a',?,1,1,?,'p')").run('d'+i,'l'+i,now);}s.prepare("UPDATE campaign_deliveries SET status='sent',sent_at=? WHERE id='d0'").run(now);return {db,s,now};}
test('cancellation removes queued work, preserves accepted sends and quota, and is idempotent',async()=>{const {db,s,now}=fixture();try{await seedSenderQueue(db,'c');await cancelCampaign(db,'c');await cancelCampaign(db,'c');const c=s.prepare("SELECT status,sent_count,pending_count,cancelled_count FROM campaigns WHERE id='c'").get();assert.deepEqual({...c},{status:'Cancelled',sent_count:1,pending_count:0,cancelled_count:2});assert.equal(s.prepare('SELECT COUNT(*) AS n FROM campaign_deliveries').get().n,1);assert.equal(s.prepare("SELECT used_count FROM sender_budget WHERE account_id='a'").get().used_count,1);assert.equal(s.prepare('SELECT COUNT(*) AS n FROM sender_ready').get().n,0);assert.equal(s.prepare(claimReadyDeliverySql).run(now,'d1',now).changes,0);}finally{s.close();}});
test('an in-flight confirmation can finish after cancellation without reviving the campaign',async()=>{const {db,s,now}=fixture();try{s.prepare("UPDATE campaign_deliveries SET status='sending',started_at=? WHERE id='d1'").run(now);await cancelCampaign(db,'c');assert.equal(s.prepare("SELECT cancelled_count FROM campaigns WHERE id='c'").get().cancelled_count,1);s.prepare("UPDATE campaign_deliveries SET status='sent',sent_at=? WHERE id='d1'").run(now);const c=s.prepare("SELECT status,pending_count,sent_count FROM campaigns WHERE id='c'").get();assert.deepEqual({...c},{status:'Cancelled',pending_count:0,sent_count:2});}finally{s.close();}});
