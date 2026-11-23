-- Preserve uncertainty records/quota; hold only uncertain messages while remaining work continues.
DROP TRIGGER sender_budget_delivery_update;
CREATE TRIGGER sender_budget_delivery_update AFTER UPDATE OF status,sent_at,started_at,retry_after ON campaign_deliveries BEGIN
 UPDATE campaigns SET in_flight_count=MAX(0,in_flight_count+(NEW.status='sending')-(OLD.status='sending')), status=CASE WHEN NEW.status='uncertain' AND OLD.status='sending' AND status IN ('Sending','Scheduled','Dry run','Paused') THEN CASE WHEN EXISTS(SELECT 1 FROM campaign_deliveries remaining WHERE remaining.campaign_id=NEW.campaign_id AND remaining.status IN ('queued','sending')) THEN 'Sending' ELSE 'Needs review' END ELSE status END WHERE id=NEW.campaign_id;
 UPDATE sender_budget SET used_count=MAX(0,used_count+CASE WHEN (NEW.status IN ('sending','sent','uncertain') AND COALESCE(NEW.sent_at,NEW.started_at)>strftime('%Y-%m-%dT%H:%M:%fZ','now','-1 day')) THEN 1 ELSE 0 END-CASE WHEN (OLD.status IN ('sending','sent','uncertain') AND COALESCE(OLD.sent_at,OLD.started_at)>strftime('%Y-%m-%dT%H:%M:%fZ','now','-1 day')) THEN 1 ELSE 0 END),
 expires_at=CASE WHEN (NEW.status IN ('sending','sent','uncertain') AND COALESCE(NEW.sent_at,NEW.started_at)>strftime('%Y-%m-%dT%H:%M:%fZ','now','-1 day')) THEN MIN(COALESCE(expires_at,'9999-12-31T00:00:00.000Z'),strftime('%Y-%m-%dT%H:%M:%fZ',COALESCE(NEW.sent_at,NEW.started_at),'+1 day')) ELSE expires_at END
 WHERE account_id=NEW.account_id;
 UPDATE sender_ready SET busy=EXISTS(SELECT 1 FROM campaign_deliveries busy INDEXED BY idx_one_sending_delivery_per_account WHERE busy.account_id=NEW.account_id AND busy.status='sending') WHERE account_id=NEW.account_id;
 UPDATE sender_ready SET
 next_delivery_id=CASE WHEN OLD.status='queued' OR NEW.status='queued' THEN (SELECT q.id FROM campaign_deliveries q INDEXED BY idx_delivery_cached_queue
 WHERE q.campaign_id=sender_ready.campaign_id AND q.account_id=sender_ready.account_id AND q.status='queued'
 ORDER BY q.day_no,COALESCE(q.retry_after,''),q.batch_no,q.rowid LIMIT 1) ELSE next_delivery_id END,
 last_used_at=CASE WHEN NEW.status='sending' THEN NEW.started_at ELSE last_used_at END
 WHERE campaign_id=NEW.campaign_id AND account_id=NEW.account_id;
 UPDATE sender_ready SET (enabled,ready_at)=(SELECT enabled,ready_at FROM sender_readiness v
 WHERE v.campaign_id=sender_ready.campaign_id AND v.account_id=sender_ready.account_id) WHERE account_id=NEW.account_id;
END;

WITH ranked AS (SELECT campaign_id,account_id,(ROW_NUMBER() OVER(PARTITION BY campaign_id ORDER BY account_id)-1)%200 AS slot FROM sender_ready) UPDATE sender_ready SET lane=(SELECT slot FROM ranked r WHERE r.campaign_id=sender_ready.campaign_id AND r.account_id=sender_ready.account_id);
UPDATE campaigns SET status='Sending',next_send_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE status='Needs review' AND pending_count>0;
