// Reuse actual free sender capacity when an older allocation left queued work
// in a later application cycle. Never change senders, recipients or retry holds.
export async function advanceQueuedCapacity(db,{campaignId,day,stamp}){
 const candidates=await db.prepare(`WITH ranked AS (
  SELECT d.id,d.account_id,d.day_no,ROW_NUMBER() OVER(
   PARTITION BY d.account_id ORDER BY d.day_no,COALESCE(d.retry_after,''),d.batch_no,d.rowid
  ) AS position,b.cap-b.used_count AS free_slots
  FROM campaign_deliveries d JOIN accounts a ON a.id=d.account_id
  JOIN sender_budget b ON b.account_id=a.id
  WHERE d.campaign_id=? AND d.status='queued' AND d.day_no>?
   AND (d.retry_after IS NULL OR d.retry_after<=?)
   AND a.paused=0 AND a.connection='Connected' AND a.smtp_verified_at IS NOT NULL
   AND a.credential_ciphertext IS NOT NULL AND (a.send_retry_after IS NULL OR a.send_retry_after<=?)
   AND b.used_count<b.cap AND NOT EXISTS(
    SELECT 1 FROM campaign_deliveries active WHERE active.account_id=a.id AND active.status='sending')
 ) SELECT id,account_id,day_no FROM ranked WHERE position<=free_slots
 ORDER BY position,account_id LIMIT 2000`).bind(campaignId,day,stamp,stamp).all();
 const rows=candidates.results||[];if(!rows.length)return 0;
 const payload=JSON.stringify(rows),affected=JSON.stringify([...new Set(rows.map(r=>r.account_id))]);
 const results=await db.batch([
  db.prepare(`UPDATE campaign_deliveries AS d SET day_no=? FROM json_each(?) p
   WHERE d.id=json_extract(p.value,'$.id') AND d.account_id=json_extract(p.value,'$.account_id')
    AND d.day_no=json_extract(p.value,'$.day_no') AND d.campaign_id=? AND d.status='queued'
    AND (d.retry_after IS NULL OR d.retry_after<=?)
    AND EXISTS(SELECT 1 FROM campaigns c WHERE c.id=d.campaign_id AND c.status IN('Sending','Scheduled') AND c.in_flight_count=0)
    AND EXISTS(SELECT 1 FROM accounts a JOIN sender_budget b ON b.account_id=a.id
     WHERE a.id=d.account_id AND a.paused=0 AND a.connection='Connected' AND a.smtp_verified_at IS NOT NULL
      AND a.credential_ciphertext IS NOT NULL AND (a.send_retry_after IS NULL OR a.send_retry_after<=?)
      AND b.used_count<b.cap)`).bind(day,payload,campaignId,stamp,stamp),
  db.prepare(`INSERT OR IGNORE INTO delivery_schedule_advances(delivery_id,campaign_id,from_day_no,to_day_no,advanced_at)
   SELECT d.id,d.campaign_id,json_extract(p.value,'$.day_no'),?,? FROM json_each(?) p
   JOIN campaign_deliveries d ON d.id=json_extract(p.value,'$.id')
    AND d.account_id=json_extract(p.value,'$.account_id') WHERE d.campaign_id=? AND d.day_no=? AND d.status='queued'`).bind(day,stamp,payload,campaignId,day),
  db.prepare(`UPDATE sender_ready SET next_delivery_id=(SELECT d.id FROM campaign_deliveries d INDEXED BY idx_delivery_cached_queue
   WHERE d.campaign_id=sender_ready.campaign_id AND d.account_id=sender_ready.account_id AND d.status='queued'
   ORDER BY d.day_no,COALESCE(d.retry_after,''),d.batch_no,d.rowid LIMIT 1)
   WHERE campaign_id=? AND account_id IN(SELECT value FROM json_each(?))`).bind(campaignId,affected),
  db.prepare(`UPDATE sender_ready SET(enabled,ready_at)=(SELECT enabled,ready_at FROM sender_readiness v
   WHERE v.campaign_id=sender_ready.campaign_id AND v.account_id=sender_ready.account_id)
   WHERE campaign_id=? AND account_id IN(SELECT value FROM json_each(?))`).bind(campaignId,affected)
 ]);
 return Number(results[0].meta?.changes||0);
}
