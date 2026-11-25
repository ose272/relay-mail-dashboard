import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {SEND_WINDOW_MS,SEND_WINDOW_HOURS} from './send-window.mjs';
import {claimReadyDeliverySql,seedSenderQueue} from './ready-senders.mjs';
import {createTestDb} from '../scripts/test-d1.mjs';

test('window migration refreshes actual history, releases only expired app quota and preserves provider holds',()=>{
 const s=new DatabaseSync(':memory:');try{
  const files=readdirSync(new URL('../migrations/',import.meta.url)).filter(n=>n.endsWith('.sql')).sort();
  for(const name of files){if(name.startsWith('0045'))break;s.exec(readFileSync(new URL('../migrations/'+name,import.meta.url),'utf8'));}
  const now=Date.now(),stamp=new Date(now).toISOString(),created=new Date(now-11*3600000).toISOString(),cooldown=new Date(now+12*3600000).toISOString();
  s.prepare("INSERT INTO campaigns(id,name,template_id,status,created_at,allocation_json) VALUES('c','Direct send','seed-intro','Scheduled',?,'[]')").run(created);
  for(const id of ['expired','recent','cooling','uncertain']){
   s.prepare("INSERT INTO accounts(id,email,cap,created_at,connection,credential_ciphertext,smtp_verified_at) VALUES(?,?,1,?,'Connected','local-test',?)").run(id,id+'@invalid.test',created,stamp);
   for(const suffix of ['history','queued']){
    const key=id+'-'+suffix;s.prepare('INSERT INTO leads(id,email,created_at) VALUES(?,?,?)').run(key,key+'@invalid.test',created);
    s.prepare("INSERT INTO campaign_deliveries(id,campaign_id,account_id,lead_id,batch_no,day_no,created_at) VALUES(?,'c',?,?,1,?,?)").run(key,id,key,suffix==='queued'?2:1,created);
   }
   const time=new Date(now-(id==='recent'?9:11)*3600000).toISOString();
   s.prepare("UPDATE campaign_deliveries SET status=?,sent_at=?,started_at=? WHERE id=?").run(id==='uncertain'?'uncertain':'sent',id==='uncertain'?null:time,time,id+'-history');
   s.prepare("INSERT INTO sender_ready(campaign_id,account_id,next_delivery_id) VALUES('c',?,?)").run(id,id+'-queued');
  }
  s.prepare("UPDATE accounts SET send_retry_after=? WHERE id='cooling'").run(cooldown);
  assert.equal(s.prepare("SELECT used_count FROM sender_budget WHERE account_id='expired'").get().used_count,1);
  const before=s.prepare('SELECT id,status,started_at,sent_at FROM campaign_deliveries ORDER BY id').all();
  s.exec(readFileSync(new URL('../migrations/0045_ten_hour_sending_window.sql',import.meta.url),'utf8'));
  assert.deepEqual(s.prepare('SELECT id,status,started_at,sent_at FROM campaign_deliveries ORDER BY id').all(),before);
  assert.equal(s.prepare("SELECT used_count FROM sender_budget WHERE account_id='expired'").get().used_count,0);
  assert.equal(s.prepare("SELECT used_count FROM sender_budget WHERE account_id='recent'").get().used_count,1);
  assert.equal(s.prepare("SELECT ready_at FROM sender_ready WHERE account_id='cooling'").get().ready_at,cooldown);
  assert.equal(s.prepare("SELECT send_retry_after FROM accounts WHERE id='cooling'").get().send_retry_after,cooldown);
  assert.equal(s.prepare("SELECT COUNT(*) n FROM accounts WHERE cap=1").get().n,4);
  assert.equal(s.prepare(claimReadyDeliverySql).run(stamp,'cooling-queued',stamp).changes,0);
  assert.equal(s.prepare(claimReadyDeliverySql).run(stamp,'recent-queued',stamp).changes,0);
  assert.equal(s.prepare(claimReadyDeliverySql).run(stamp,'expired-queued',stamp).changes,1);
  assert.equal(s.prepare(claimReadyDeliverySql).run(stamp,'expired-queued',stamp).changes,0);
  assert.equal(s.prepare("SELECT status FROM campaign_deliveries WHERE id='uncertain-history'").get().status,'uncertain');
 }finally{s.close();}
});

test('ten-hour quota boundary retains recent uncertainty and excludes older sends without resetting history',async()=>{
 assert.equal(SEND_WINDOW_HOURS,10);assert.equal(SEND_WINDOW_MS,36000000);
 const db=createTestDb(),s=db.sqlite,now=Date.now(),stamp=new Date(now).toISOString();try{
  s.prepare("INSERT INTO accounts(id,email,cap,created_at,connection,credential_ciphertext,smtp_verified_at) VALUES('a','test@invalid.test',1,?,'Connected','local-test',?)").run(stamp,stamp);
  s.prepare("INSERT INTO templates(id,name,subject,body,created_at) VALUES('seed-intro','Local plan','','Body',?)").run(stamp);
  s.prepare("INSERT INTO campaigns(id,name,template_id,status,created_at,allocation_json) VALUES('c','Direct send','seed-intro','Sending',?,'[]')").run(stamp);
  for(let i=0;i<3;i++){s.prepare('INSERT INTO leads(id,email,created_at) VALUES(?,?,?)').run('l'+i,'l'+i+'@invalid.test',stamp);s.prepare("INSERT INTO campaign_deliveries(id,campaign_id,account_id,lead_id,batch_no,day_no,created_at) VALUES(?,'c','a',?,1,1,?)").run('d'+i,'l'+i,stamp);}
  s.prepare("UPDATE campaign_deliveries SET status='sent',sent_at=? WHERE id='d0'").run(new Date(now-SEND_WINDOW_MS-60000).toISOString());
  const recent=new Date(now-SEND_WINDOW_MS+60000).toISOString();
  s.prepare("UPDATE campaign_deliveries SET status='uncertain',started_at=? WHERE id='d1'").run(recent);
  await seedSenderQueue(db,'c');
  const b=s.prepare("SELECT used_count,expires_at FROM sender_budget WHERE account_id='a'").get();
  assert.equal(b.used_count,1);assert.equal(Date.parse(b.expires_at),Date.parse(recent)+SEND_WINDOW_MS);
  assert.equal(s.prepare(claimReadyDeliverySql).run(stamp,'d2',stamp).changes,0);
  assert.equal(s.prepare('SELECT COUNT(*) n FROM campaign_deliveries').get().n,3);
 }finally{s.close();}
});
