-- Explicitly approved ten-hour application sender window.
-- Preserve account caps, provider cooldowns, delivery IDs and history.
DROP VIEW sender_readiness;
CREATE VIEW sender_readiness AS
 SELECT s.campaign_id,s.account_id,
 CASE WHEN d.id IS NOT NULL AND s.busy=0 AND a.paused=0 AND a.connection='Connected'
 AND a.smtp_verified_at IS NOT NULL AND a.credential_ciphertext IS NOT NULL THEN 1 ELSE 0 END AS enabled,
 CASE WHEN d.id IS NULL THEN '9999-12-31T00:00:00.000Z' ELSE
 MAX(strftime('%Y-%m-%dT%H:%M:%fZ',c.created_at,printf('+%d hours',(d.day_no-1)*10)),
 COALESCE(d.retry_after,'0000'),COALESCE(a.send_retry_after,'0000'),
 CASE WHEN b.used_count>=b.cap THEN COALESCE(b.expires_at,'9999-12-31T00:00:00.000Z') ELSE '0000' END) END AS ready_at
 FROM sender_ready s JOIN accounts a ON a.id=s.account_id JOIN campaigns c ON c.id=s.campaign_id
 JOIN sender_budget b ON b.account_id=s.account_id LEFT JOIN campaign_deliveries d ON d.id=s.next_delivery_id;
DROP TRIGGER sender_budget_before_claim;
CREATE TRIGGER sender_budget_before_claim BEFORE UPDATE OF status ON campaign_deliveries
 WHEN NEW.status='sending' AND OLD.status='queued' BEGIN
 UPDATE sender_budget SET
 used_count=(SELECT COUNT(*) FROM campaign_deliveries d INDEXED BY idx_delivery_sender_quota_time
 WHERE d.account_id=NEW.account_id AND d.status IN ('sending','sent','uncertain') AND COALESCE(d.sent_at,d.started_at)>strftime('%Y-%m-%dT%H:%M:%fZ','now','-10 hours')),
 expires_at=(SELECT strftime('%Y-%m-%dT%H:%M:%fZ',COALESCE(d.sent_at,d.started_at),'+10 hours')
 FROM campaign_deliveries d INDEXED BY idx_delivery_sender_quota_time WHERE d.account_id=NEW.account_id
 AND d.status IN ('sending','sent','uncertain') AND COALESCE(d.sent_at,d.started_at)>strftime('%Y-%m-%dT%H:%M:%fZ','now','-10 hours')
 ORDER BY COALESCE(d.sent_at,d.started_at) LIMIT 1)
 WHERE account_id=NEW.account_id AND expires_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now');
 SELECT CASE WHEN (SELECT used_count>=cap FROM sender_budget WHERE account_id=NEW.account_id)
 THEN RAISE(IGNORE) END;
END;
DROP TRIGGER sender_budget_delivery_update;
CREATE TRIGGER sender_budget_delivery_update AFTER UPDATE OF status,sent_at,started_at,retry_after ON campaign_deliveries BEGIN
 UPDATE campaigns SET pending_count = MAX(0, pending_count
      + CASE WHEN NEW.status IN ('queued', 'sending') THEN 1 ELSE 0 END
      - CASE WHEN OLD.status IN ('queued', 'sending') THEN 1 ELSE 0 END),
    sent_count = MAX(0, sent_count
      + CASE WHEN NEW.status = 'sent' THEN 1 ELSE 0 END
      - CASE WHEN OLD.status = 'sent' THEN 1 ELSE 0 END),
    uncertain_count = MAX(0, uncertain_count
      + CASE WHEN NEW.status = 'uncertain' THEN 1 ELSE 0 END
      - CASE WHEN OLD.status = 'uncertain' THEN 1 ELSE 0 END),
    failed_count = MAX(0, failed_count
      + CASE WHEN NEW.status = 'failed' THEN 1 ELSE 0 END
      - CASE WHEN OLD.status = 'failed' THEN 1 ELSE 0 END),
    failure_codes = CASE
      WHEN NEW.status = 'failed' AND COALESCE(NEW.last_error, '') <> ''
        AND instr(',' || failure_codes || ',', ',' || NEW.last_error || ',') = 0
      THEN CASE WHEN failure_codes = '' THEN NEW.last_error ELSE failure_codes || ',' || NEW.last_error END
      ELSE failure_codes
    END,
 in_flight_count=MAX(0,in_flight_count+(NEW.status='sending')-(OLD.status='sending')),
 status=CASE WHEN NEW.status='uncertain' AND OLD.status='sending' AND status IN ('Sending','Scheduled','Dry run','Paused') THEN CASE WHEN EXISTS(SELECT 1 FROM campaign_deliveries remaining WHERE remaining.campaign_id=NEW.campaign_id AND remaining.status IN ('queued','sending')) THEN 'Sending' ELSE 'Needs review' END ELSE status END WHERE id=NEW.campaign_id;
 UPDATE sender_budget SET used_count=MAX(0,used_count+CASE WHEN (NEW.status IN ('sending','sent','uncertain') AND COALESCE(NEW.sent_at,NEW.started_at)>strftime('%Y-%m-%dT%H:%M:%fZ','now','-10 hours')) THEN 1 ELSE 0 END-CASE WHEN (OLD.status IN ('sending','sent','uncertain') AND COALESCE(OLD.sent_at,OLD.started_at)>strftime('%Y-%m-%dT%H:%M:%fZ','now','-10 hours')) THEN 1 ELSE 0 END),
 expires_at=CASE WHEN (NEW.status IN ('sending','sent','uncertain') AND COALESCE(NEW.sent_at,NEW.started_at)>strftime('%Y-%m-%dT%H:%M:%fZ','now','-10 hours')) THEN MIN(COALESCE(expires_at,'9999-12-31T00:00:00.000Z'),strftime('%Y-%m-%dT%H:%M:%fZ',COALESCE(NEW.sent_at,NEW.started_at),'+10 hours')) ELSE expires_at END
 WHERE account_id=NEW.account_id AND ((NEW.status IN ('sending','sent','uncertain') AND COALESCE(NEW.sent_at,NEW.started_at)>strftime('%Y-%m-%dT%H:%M:%fZ','now','-10 hours')) <> (OLD.status IN ('sending','sent','uncertain') AND COALESCE(OLD.sent_at,OLD.started_at)>strftime('%Y-%m-%dT%H:%M:%fZ','now','-10 hours')));
 UPDATE sender_ready SET
 busy=CASE WHEN NEW.status='sending' THEN 1 WHEN OLD.status='sending' THEN 0 ELSE busy END,
 next_delivery_id=CASE WHEN campaign_id=NEW.campaign_id AND (OLD.status='queued' OR NEW.status='queued') THEN (SELECT q.id FROM campaign_deliveries q INDEXED BY idx_delivery_cached_queue
 WHERE q.campaign_id=sender_ready.campaign_id AND q.account_id=sender_ready.account_id AND q.status='queued'
 ORDER BY q.day_no,COALESCE(q.retry_after,''),q.batch_no,q.rowid LIMIT 1) ELSE next_delivery_id END,
 last_used_at=CASE WHEN campaign_id=NEW.campaign_id AND NEW.status='sending' THEN NEW.started_at ELSE last_used_at END
 WHERE account_id=NEW.account_id;
 UPDATE sender_ready SET (enabled,ready_at)=(SELECT enabled,ready_at FROM sender_readiness v
 WHERE v.campaign_id=sender_ready.campaign_id AND v.account_id=sender_ready.account_id) WHERE account_id=NEW.account_id;
END;
DROP TRIGGER sender_budget_delivery_insert;
CREATE TRIGGER sender_budget_delivery_insert AFTER INSERT ON campaign_deliveries WHEN (NEW.status IN ('sending','sent','uncertain') AND COALESCE(NEW.sent_at,NEW.started_at)>strftime('%Y-%m-%dT%H:%M:%fZ','now','-10 hours')) BEGIN
 UPDATE campaigns SET in_flight_count=in_flight_count+(NEW.status='sending') WHERE id=NEW.campaign_id;
 UPDATE sender_budget SET used_count=used_count+1,
 expires_at=MIN(COALESCE(expires_at,'9999-12-31T00:00:00.000Z'),strftime('%Y-%m-%dT%H:%M:%fZ',COALESCE(NEW.sent_at,NEW.started_at),'+10 hours')) WHERE account_id=NEW.account_id;
END;
UPDATE sender_budget SET used_count=(SELECT COUNT(*) FROM campaign_deliveries d INDEXED BY idx_delivery_sender_quota_time WHERE d.account_id=sender_budget.account_id AND d.status IN ('sending','sent','uncertain') AND COALESCE(d.sent_at,d.started_at)>strftime('%Y-%m-%dT%H:%M:%fZ','now','-10 hours')),
 expires_at=(SELECT strftime('%Y-%m-%dT%H:%M:%fZ',COALESCE(d.sent_at,d.started_at),'+10 hours') FROM campaign_deliveries d INDEXED BY idx_delivery_sender_quota_time WHERE d.account_id=sender_budget.account_id AND d.status IN ('sending','sent','uncertain') AND COALESCE(d.sent_at,d.started_at)>strftime('%Y-%m-%dT%H:%M:%fZ','now','-10 hours') ORDER BY COALESCE(d.sent_at,d.started_at) LIMIT 1);
UPDATE sender_ready SET(enabled,ready_at)=(SELECT enabled,ready_at FROM sender_readiness v WHERE v.campaign_id=sender_ready.campaign_id AND v.account_id=sender_ready.account_id);
UPDATE campaigns SET capacity_next_check_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),capacity_checked_at=NULL WHERE status IN ('Sending','Scheduled') AND pending_count>0 AND in_flight_count=0;
