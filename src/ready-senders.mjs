import { SEND_CONCURRENCY } from './send-limits.mjs';

export const readySenderSql = `SELECT next_delivery_id AS id, account_id
 FROM sender_ready INDEXED BY idx_sender_ready_lane
 WHERE campaign_id=? AND enabled=1 AND next_delivery_id IS NOT NULL AND ready_at<=? AND lane=?
 ORDER BY ready_at,last_used_at,account_id LIMIT 1`;

export async function selectReadyDelivery(db,{campaignId,nowIso,candidateOffset=0}) {
 const offset=Math.max(0,Math.min(SEND_CONCURRENCY-1,candidateOffset));
 let row=await db.prepare(readySenderSql).bind(campaignId,nowIso,offset).first();
 if(!row)row=await db.prepare(`SELECT next_delivery_id AS id,account_id FROM sender_ready INDEXED BY idx_sender_ready_seek WHERE campaign_id=? AND enabled=1 AND next_delivery_id IS NOT NULL AND ready_at<=? ORDER BY ready_at,last_used_at,account_id LIMIT 1`).bind(campaignId,nowIso).first();
 if(row)return {id:row.id,nextQuotaAt:null};
 const next=await db.prepare(`SELECT ready_at FROM sender_ready INDEXED BY idx_sender_ready_seek
   WHERE campaign_id=? AND enabled=1 AND next_delivery_id IS NOT NULL
   ORDER BY ready_at,last_used_at,account_id LIMIT 1`).bind(campaignId).first();
 return {id:null,nextQuotaAt:next?.ready_at || null};
}

export const claimReadyDeliverySql = `UPDATE OR IGNORE campaign_deliveries
 SET status='sending',started_at=?,attempt_count=attempt_count+1,retry_after=NULL,last_error=NULL
 WHERE id=? AND status='queued'
 AND EXISTS(SELECT 1 FROM sender_ready r WHERE r.campaign_id=campaign_deliveries.campaign_id
   AND r.account_id=campaign_deliveries.account_id AND r.next_delivery_id=campaign_deliveries.id
   AND r.enabled=1 AND r.ready_at<=?)
 AND EXISTS(SELECT 1 FROM campaigns c WHERE c.id=campaign_deliveries.campaign_id
   AND c.in_flight_count<${SEND_CONCURRENCY} AND c.status IN ('Sending','Scheduled','Dry run','Paused'))`;

export function senderQueueStatements(db,campaignId){return [
 db.prepare(`INSERT OR IGNORE INTO sender_ready(campaign_id,account_id)
   SELECT campaign_id,account_id FROM campaign_deliveries WHERE campaign_id=? GROUP BY account_id`).bind(campaignId),
 db.prepare(`UPDATE sender_ready SET next_delivery_id=(SELECT d.id FROM campaign_deliveries d INDEXED BY idx_delivery_cached_queue
   WHERE d.campaign_id=sender_ready.campaign_id AND d.account_id=sender_ready.account_id AND d.status='queued'
   ORDER BY d.day_no,COALESCE(d.retry_after,''),d.batch_no,d.rowid LIMIT 1),
   last_used_at=(SELECT COALESCE(r.sent_at,r.started_at) FROM campaign_deliveries r INDEXED BY idx_delivery_campaign_sender_time
   WHERE r.campaign_id=sender_ready.campaign_id AND r.account_id=sender_ready.account_id AND r.status IN ('sending','sent','uncertain')
   ORDER BY COALESCE(r.sent_at,r.started_at) DESC LIMIT 1),
   busy=EXISTS(SELECT 1 FROM campaign_deliveries busy WHERE busy.account_id=sender_ready.account_id AND busy.status='sending')
   WHERE campaign_id=?`).bind(campaignId),
 db.prepare(`UPDATE sender_ready SET(enabled,ready_at)=(SELECT enabled,ready_at FROM sender_readiness v
   WHERE v.campaign_id=sender_ready.campaign_id AND v.account_id=sender_ready.account_id) WHERE campaign_id=?`).bind(campaignId),
 db.prepare(`WITH ranked AS(SELECT account_id,(ROW_NUMBER() OVER(ORDER BY account_id)-1)%${SEND_CONCURRENCY} AS slot FROM sender_ready WHERE campaign_id=?)
 UPDATE sender_ready SET lane=(SELECT slot FROM ranked r WHERE r.account_id=sender_ready.account_id) WHERE campaign_id=?`).bind(campaignId,campaignId),
];}
export async function seedSenderQueue(db,campaignId){await db.batch(senderQueueStatements(db,campaignId));}
