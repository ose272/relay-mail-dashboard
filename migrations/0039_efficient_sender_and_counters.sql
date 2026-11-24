-- Remove duplicate sender writes while preserving atomic quota and delivery guards.
DROP TRIGGER campaign_delivery_status_progress;
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
 UPDATE sender_budget SET used_count=MAX(0,used_count+CASE WHEN (NEW.status IN ('sending','sent','uncertain') AND COALESCE(NEW.sent_at,NEW.started_at)>strftime('%Y-%m-%dT%H:%M:%fZ','now','-1 day')) THEN 1 ELSE 0 END-CASE WHEN (OLD.status IN ('sending','sent','uncertain') AND COALESCE(OLD.sent_at,OLD.started_at)>strftime('%Y-%m-%dT%H:%M:%fZ','now','-1 day')) THEN 1 ELSE 0 END),
 expires_at=CASE WHEN (NEW.status IN ('sending','sent','uncertain') AND COALESCE(NEW.sent_at,NEW.started_at)>strftime('%Y-%m-%dT%H:%M:%fZ','now','-1 day')) THEN MIN(COALESCE(expires_at,'9999-12-31T00:00:00.000Z'),strftime('%Y-%m-%dT%H:%M:%fZ',COALESCE(NEW.sent_at,NEW.started_at),'+1 day')) ELSE expires_at END
 WHERE account_id=NEW.account_id AND ((NEW.status IN ('sending','sent','uncertain') AND COALESCE(NEW.sent_at,NEW.started_at)>strftime('%Y-%m-%dT%H:%M:%fZ','now','-1 day')) <> (OLD.status IN ('sending','sent','uncertain') AND COALESCE(OLD.sent_at,OLD.started_at)>strftime('%Y-%m-%dT%H:%M:%fZ','now','-1 day')));
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
DROP INDEX idx_messages_idempotency_lookup;
DROP INDEX idx_messages_thread;
DROP INDEX idx_messages_inbound_received_at;
CREATE INDEX idx_messages_inbound_received_at ON messages(time DESC,thread_id) WHERE direction='in';
CREATE INDEX idx_messages_inbound_thread_time ON messages(thread_id,time DESC) WHERE direction='in';
CREATE TABLE lead_status_counts(status TEXT PRIMARY KEY,total INTEGER NOT NULL DEFAULT 0 CHECK(total>=0));
INSERT INTO lead_status_counts(status,total) SELECT status,COUNT(*) FROM leads GROUP BY status;
CREATE TRIGGER lead_count_insert AFTER INSERT ON leads BEGIN INSERT INTO lead_status_counts(status,total) VALUES(NEW.status,1) ON CONFLICT(status) DO UPDATE SET total=total+1; END;
CREATE TRIGGER lead_count_delete AFTER DELETE ON leads BEGIN UPDATE lead_status_counts SET total=total-1 WHERE status=OLD.status; END;
CREATE TRIGGER lead_count_status AFTER UPDATE OF status ON leads WHEN NEW.status<>OLD.status BEGIN UPDATE lead_status_counts SET total=total-1 WHERE status=OLD.status; INSERT INTO lead_status_counts(status,total) VALUES(NEW.status,1) ON CONFLICT(status) DO UPDATE SET total=total+1; END;
ALTER TABLE lead_import_batches ADD COLUMN lead_count INTEGER NOT NULL DEFAULT 0;
UPDATE lead_import_batches SET lead_count=(SELECT COUNT(*) FROM lead_import_batch_items i WHERE i.batch_id=lead_import_batches.id);
CREATE TRIGGER batch_count_insert AFTER INSERT ON lead_import_batch_items BEGIN UPDATE lead_import_batches SET lead_count=lead_count+1 WHERE id=NEW.batch_id; END;
CREATE TRIGGER batch_count_delete AFTER DELETE ON lead_import_batch_items BEGIN UPDATE lead_import_batches SET lead_count=lead_count-1 WHERE id=OLD.batch_id; END;
