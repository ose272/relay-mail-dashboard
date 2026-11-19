import { SEND_CONCURRENCY } from './send-limits.mjs';

export const nextCandidatesSql = `
 WITH senders AS MATERIALIZED (
   SELECT a.id, a.cap,
     (SELECT COALESCE(recent.sent_at,recent.started_at)
      FROM campaign_deliveries recent
      WHERE recent.campaign_id = ? AND recent.account_id = a.id
        AND recent.status IN ('sending','sent','uncertain')
      ORDER BY COALESCE(recent.sent_at,recent.started_at) DESC LIMIT 1) AS last_sent
   FROM accounts a
   WHERE a.paused = 0 AND a.connection = 'Connected'
     AND a.smtp_verified_at IS NOT NULL AND a.credential_ciphertext IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM campaign_deliveries busy WHERE busy.account_id=a.id AND busy.status='sending')
 ), candidates AS MATERIALIZED (
   SELECT s.id AS account_id, s.cap, s.last_sent,
     (SELECT d.id FROM campaign_deliveries d
      WHERE d.campaign_id = ? AND d.account_id = s.id AND d.status = 'queued'
        AND d.day_no <= ? AND (d.retry_after IS NULL OR d.retry_after <= ?)
      ORDER BY d.day_no, d.batch_no, d.rowid LIMIT 1) AS id
   FROM senders s
 )
 SELECT d.id, d.day_no, candidate.account_id, candidate.cap
 FROM candidates candidate JOIN campaign_deliveries d ON d.id = candidate.id
 ORDER BY d.day_no, candidate.last_sent, d.batch_no, d.rowid
`;
export const senderUsageSql = `SELECT COUNT(*) AS used, MIN(COALESCE(sent_at,started_at)) AS oldest
 FROM campaign_deliveries
 WHERE account_id = ? AND status IN ('sending','sent','uncertain')
   AND COALESCE(sent_at,started_at) > ?`;

export async function selectNextDelivery(db, {campaignId,currentDay,nowIso,cutoff,defaultCap,candidateOffset=0}) {
 let candidates=(await db.prepare(nextCandidatesSql).bind(campaignId,campaignId,currentDay,nowIso).all()).results || [];
 if(!candidates.length)return {id:null,nextQuotaAt:null};
 // Spread concurrent lanes across distinct candidates in the earliest due day,
 // avoiding ten requests racing for the same sender. Atomic claims remain final.
 const earliest=candidates.filter(c=>c.day_no===candidates[0].day_no);
 const offset=Math.max(0,Math.min(SEND_CONCURRENCY-1,candidateOffset)) % earliest.length;
 candidates=[...earliest.slice(offset),...earliest.slice(0,offset),...candidates.slice(earliest.length)];
 const first=candidates[0];
 const usage=await db.prepare(senderUsageSql).bind(first.account_id,cutoff).first();
 if(Number(usage.used)<Math.min(40,first.cap,defaultCap))return {id:first.id,nextQuotaAt:null};
 // Only recount the other senders when the preferred sender has reached its cap.
 // IDs are batched below D1's 100-parameter limit.
 const byAccount=new Map([[first.account_id,usage]]);
 for(let i=0;i<candidates.length;i+=80){
   const ids=candidates.slice(i,i+80).map(c=>c.account_id);
   const rows=(await db.prepare(`SELECT account_id,COUNT(*) AS used,MIN(COALESCE(sent_at,started_at)) AS oldest
     FROM campaign_deliveries WHERE account_id IN (${ids.map(()=>'?').join(',')})
       AND status IN ('sending','sent','uncertain') AND COALESCE(sent_at,started_at)>?
     GROUP BY account_id`).bind(...ids,cutoff).all()).results || [];
   for(const row of rows)byAccount.set(row.account_id,row);
 }
 let reset=Infinity;
 for(const c of candidates){
   const used=byAccount.get(c.account_id);
   if(Number(used?.used || 0)<Math.min(40,c.cap,defaultCap))return {id:c.id,nextQuotaAt:null};
   if(used?.oldest)reset=Math.min(reset,Date.parse(used.oldest)+86400000+1000);
 }
 return {id:null,nextQuotaAt:Number.isFinite(reset)?new Date(reset).toISOString():null};
}

export const claimDeliverySql = `
 UPDATE OR IGNORE campaign_deliveries
 SET status='sending', started_at=?, attempt_count=attempt_count+1,
     retry_after=NULL,last_error=NULL
 WHERE id=? AND status='queued'
   AND (SELECT COUNT(*) FROM campaign_deliveries active WHERE active.campaign_id=campaign_deliveries.campaign_id AND active.status='sending') < ${SEND_CONCURRENCY}
   AND EXISTS (SELECT 1 FROM campaigns c WHERE c.id=campaign_deliveries.campaign_id
     AND c.status IN ('Sending','Scheduled','Dry run','Paused'))
   AND EXISTS (SELECT 1 FROM accounts a WHERE a.id=campaign_deliveries.account_id
     AND a.paused=0 AND a.connection='Connected' AND a.smtp_verified_at IS NOT NULL
     AND a.credential_ciphertext IS NOT NULL)
   AND (SELECT COUNT(*) FROM campaign_deliveries usage
     WHERE usage.account_id=? AND usage.status IN ('sending','sent','uncertain')
       AND COALESCE(usage.sent_at,usage.started_at)>?) < MIN(40,?,?)
`;

export const expireStaleDeliveriesSql = `
 UPDATE campaign_deliveries SET status='uncertain'
 WHERE id IN (
   SELECT stale.id FROM campaign_deliveries stale INDEXED BY idx_delivery_stale_inflight
   WHERE stale.campaign_id=? AND stale.status='sending' AND stale.started_at<?
 )
`;
