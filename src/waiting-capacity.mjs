import { SEND_WINDOW_MS } from './send-window.mjs';
import {advanceQueuedCapacity} from './advance-queued-capacity.mjs';
// Only definite, queued work can move. Sent, sending and uncertain records never do.
export function planCapacityTransfers(queued,accounts,blocked=[],limit=200){
 const capacity=new Map(accounts.map(a=>[a.id,Math.max(0,Math.min(40,a.cap)-a.used)]));
 const seen=new Map(accounts.map(a=>[a.id,new Set()]));for(const row of blocked)seen.get(row.account_id)?.add(row.lead_id);
 const transfers=[];let cursor=0;
 for(const row of queued){if(transfers.length>=limit)break;for(let attempt=0;attempt<accounts.length;attempt++){const a=accounts[cursor++%accounts.length];if(a.id===row.account_id||!capacity.get(a.id)||seen.get(a.id).has(row.lead_id))continue;transfers.push({id:row.id,from_id:row.account_id,to_id:a.id});capacity.set(a.id,capacity.get(a.id)-1);seen.get(a.id).add(row.lead_id);break;}}
 return transfers;
}
export async function recoverWaitingCapacity(db,{campaignId,now=new Date()}={}){
 const stamp=now.toISOString(),before=new Date(now.getTime()-300000).toISOString();
 const campaign=await (campaignId?db.prepare('SELECT id,created_at FROM campaigns WHERE id=?'):db.prepare("SELECT id,created_at FROM campaigns WHERE name='Direct send' AND status IN('Sending','Scheduled') AND pending_count>0 ORDER BY created_at DESC LIMIT 1")).bind(...(campaignId?[campaignId]:[])).first();
 if(!campaign)return{moved:0,checked:false};
 const lease=await db.prepare("UPDATE campaigns SET capacity_checked_at=?,capacity_next_check_at=NULL WHERE id=? AND status IN('Sending','Scheduled') AND in_flight_count=0 AND pending_count>0 AND (capacity_checked_at IS NULL OR capacity_checked_at<=? OR capacity_next_check_at<=?)").bind(stamp,campaign.id,before,stamp).run();
 if(!lease.meta?.changes)return{moved:0,checked:false};
 const cutoff=new Date(now.getTime()-SEND_WINDOW_MS).toISOString();
 // Expired quota caches are refreshed once, then get a new expiry (or NULL).
 await db.prepare(`UPDATE sender_budget SET used_count=(SELECT COUNT(*) FROM campaign_deliveries d INDEXED BY idx_delivery_sender_quota_time WHERE d.account_id=sender_budget.account_id AND d.status IN('sending','sent','uncertain') AND COALESCE(d.sent_at,d.started_at)>?),expires_at=(SELECT strftime('%Y-%m-%dT%H:%M:%fZ',COALESCE(d.sent_at,d.started_at),'+10 hours') FROM campaign_deliveries d INDEXED BY idx_delivery_sender_quota_time WHERE d.account_id=sender_budget.account_id AND d.status IN('sending','sent','uncertain') AND COALESCE(d.sent_at,d.started_at)>? ORDER BY COALESCE(d.sent_at,d.started_at) LIMIT 1) WHERE expires_at<=?`).bind(cutoff,cutoff,stamp).run();
 const available=await db.prepare(`SELECT a.id,b.cap,b.used_count AS used FROM accounts a JOIN sender_budget b ON b.account_id=a.id WHERE a.paused=0 AND a.connection='Connected' AND a.smtp_verified_at IS NOT NULL AND a.credential_ciphertext IS NOT NULL AND (a.send_retry_after IS NULL OR a.send_retry_after<=?) AND b.used_count<b.cap AND NOT EXISTS(SELECT 1 FROM campaign_deliveries d WHERE d.account_id=a.id AND d.status='sending') ORDER BY b.used_count,a.created_at,a.id`).bind(stamp).all();
 const accounts=available.results||[];let moved=0,advanced=0;
 let alreadyReady=await db.prepare('SELECT 1 FROM sender_ready WHERE campaign_id=? AND enabled=1 AND next_delivery_id IS NOT NULL AND ready_at<=? LIMIT 1').bind(campaign.id,stamp).first();
 if(accounts.length&&!alreadyReady){
  const day=Math.max(1,Math.floor((now-Date.parse(campaign.created_at))/SEND_WINDOW_MS)+1);
  advanced=await advanceQueuedCapacity(db,{campaignId:campaign.id,day,stamp});
  if(advanced)alreadyReady=true;
 }
 if(accounts.length&&!alreadyReady){
  const ids=JSON.stringify(accounts.map(a=>a.id)),day=Math.max(1,Math.floor((now-Date.parse(campaign.created_at))/SEND_WINDOW_MS)+1);
  const [queued,blocked]=await Promise.all([
   db.prepare("SELECT id,account_id,lead_id FROM campaign_deliveries WHERE campaign_id=? AND status='queued' AND day_no<=? ORDER BY day_no,batch_no,id").bind(campaign.id,day).all(),
   db.prepare('SELECT account_id,lead_id FROM campaign_deliveries WHERE campaign_id=? AND account_id IN(SELECT value FROM json_each(?))').bind(campaign.id,ids).all()
  ]);
  const plan=planCapacityTransfers(queued.results||[],accounts,blocked.results||[]);
  if(plan.length){const payload=JSON.stringify(plan),affected=JSON.stringify([...new Set(plan.flatMap(p=>[p.from_id,p.to_id]))]);
   const results=await db.batch([
    db.prepare(`UPDATE OR IGNORE campaign_deliveries AS d SET account_id=json_extract(p.value,'$.to_id'),retry_after=NULL,attempt_count=0,last_error=NULL FROM json_each(?) p WHERE d.id=json_extract(p.value,'$.id') AND d.account_id=json_extract(p.value,'$.from_id') AND d.campaign_id=? AND d.status='queued' AND EXISTS(SELECT 1 FROM campaigns c WHERE c.id=d.campaign_id AND c.status IN('Sending','Scheduled'))`).bind(payload,campaign.id),
    db.prepare(`INSERT INTO delivery_sender_transfers(id,delivery_id,from_account_id,to_account_id,created_at) SELECT lower(hex(randomblob(16))),json_extract(p.value,'$.id'),json_extract(p.value,'$.from_id'),json_extract(p.value,'$.to_id'),? FROM json_each(?) p JOIN campaign_deliveries d ON d.id=json_extract(p.value,'$.id') AND d.account_id=json_extract(p.value,'$.to_id') WHERE d.status='queued'`).bind(stamp,payload),
    db.prepare(`INSERT OR IGNORE INTO sender_ready(campaign_id,account_id,lane) SELECT ?,value,CAST(key AS INTEGER)%200 FROM json_each(?)`).bind(campaign.id,affected),
    db.prepare(`UPDATE sender_ready SET next_delivery_id=(SELECT d.id FROM campaign_deliveries d INDEXED BY idx_delivery_cached_queue WHERE d.campaign_id=sender_ready.campaign_id AND d.account_id=sender_ready.account_id AND d.status='queued' ORDER BY d.day_no,COALESCE(d.retry_after,''),d.batch_no,d.rowid LIMIT 1),busy=EXISTS(SELECT 1 FROM campaign_deliveries d WHERE d.account_id=sender_ready.account_id AND d.status='sending') WHERE campaign_id=? AND account_id IN(SELECT value FROM json_each(?))`).bind(campaign.id,affected),
    db.prepare(`UPDATE sender_ready SET(enabled,ready_at)=(SELECT enabled,ready_at FROM sender_readiness v WHERE v.campaign_id=sender_ready.campaign_id AND v.account_id=sender_ready.account_id) WHERE campaign_id=? AND account_id IN(SELECT value FROM json_each(?))`).bind(campaign.id,affected)
   ]);moved=Number(results[0].meta?.changes||0);
  }
 }
 const [queuedState,capacityState]=await Promise.all([
  db.prepare('SELECT MIN(ready_at) AS next_at,SUM(ready_at<=?) AS ready FROM sender_ready WHERE campaign_id=? AND enabled=1 AND next_delivery_id IS NOT NULL').bind(stamp,campaign.id).first(),
  db.prepare(`WITH future AS(SELECT MAX(CASE WHEN b.used_count>=b.cap THEN COALESCE(b.expires_at,'9999-12-31T00:00:00.000Z') ELSE '0000' END,COALESCE(a.send_retry_after,'0000')) AS next_at FROM accounts a JOIN sender_budget b ON b.account_id=a.id WHERE a.paused=0 AND a.connection='Connected' AND a.smtp_verified_at IS NOT NULL AND a.credential_ciphertext IS NOT NULL) SELECT MIN(next_at) AS next_at FROM future WHERE next_at>? AND next_at<'9999'`).bind(stamp).first()
 ]);
 const earliest=values=>values.filter(Boolean).sort()[0]||null;
 const ready=Number(queuedState?.ready||0)>0;
 const nextAt=earliest([queuedState?.next_at,capacityState?.next_at]);
 const changed=moved+advanced;
 const nextCheck=changed?null:earliest([capacityState?.next_at,new Date(now.getTime()+300000).toISOString()]);
 await db.prepare("UPDATE campaigns SET status=?,next_send_at=?,capacity_next_check_at=?,wait_reason=?,capacity_checked_at=CASE WHEN ?>0 THEN NULL ELSE capacity_checked_at END WHERE id=? AND status IN('Sending','Scheduled') AND in_flight_count=0").bind(ready?'Sending':'Scheduled',nextAt,nextCheck,ready?'':'sender_capacity',changed,campaign.id).run();
 return{moved,advanced,checked:true};
}
