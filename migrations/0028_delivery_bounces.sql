-- Bounce outcomes are separate from SMTP acceptance, so a bounce never frees
-- the sender's already-consumed rolling quota or requeues an accepted message.
CREATE TABLE delivery_bounces (
 delivery_id TEXT PRIMARY KEY REFERENCES campaign_deliveries(id) ON DELETE CASCADE,
 campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
 received_at TEXT NOT NULL, code TEXT NOT NULL, external_id TEXT NOT NULL
);
CREATE INDEX idx_delivery_bounces_campaign_time ON delivery_bounces(campaign_id,received_at DESC,delivery_id DESC);
ALTER TABLE accounts ADD COLUMN last_bounce_sync_uid INTEGER NOT NULL DEFAULT 0;
ALTER TABLE accounts ADD COLUMN last_bounce_sync_uid_validity TEXT;
CREATE TRIGGER delivery_bounce_progress AFTER INSERT ON delivery_bounces BEGIN
 UPDATE campaigns SET sent_count=MAX(0,sent_count-1),failed_count=failed_count+1,
 failure_codes=CASE WHEN instr(','||failure_codes||',',','||NEW.code||',')=0
 THEN CASE WHEN failure_codes='' THEN NEW.code ELSE failure_codes||','||NEW.code END ELSE failure_codes END
 WHERE id=(SELECT campaign_id FROM campaign_deliveries WHERE id=NEW.delivery_id);
END;

CREATE INDEX idx_account_health_unresolved_recent ON account_health_events(created_at DESC) WHERE resolved_at IS NULL;

ALTER TABLE accounts ADD COLUMN send_retry_after TEXT;
DROP VIEW sender_readiness;
CREATE VIEW sender_readiness AS
 SELECT s.campaign_id,s.account_id,
 CASE WHEN d.id IS NOT NULL AND s.busy=0 AND a.paused=0 AND a.connection='Connected'
 AND a.smtp_verified_at IS NOT NULL AND a.credential_ciphertext IS NOT NULL THEN 1 ELSE 0 END AS enabled,
 CASE WHEN d.id IS NULL THEN '9999-12-31T00:00:00.000Z' ELSE
 MAX(strftime('%Y-%m-%dT%H:%M:%fZ',c.created_at,printf('+%d days',d.day_no-1)),
 COALESCE(d.retry_after,'0000'),COALESCE(a.send_retry_after,'0000'),
 CASE WHEN b.used_count>=b.cap THEN COALESCE(b.expires_at,'9999-12-31T00:00:00.000Z') ELSE '0000' END) END AS ready_at
 FROM sender_ready s JOIN accounts a ON a.id=s.account_id JOIN campaigns c ON c.id=s.campaign_id
 JOIN sender_budget b ON b.account_id=s.account_id LEFT JOIN campaign_deliveries d ON d.id=s.next_delivery_id;

CREATE TRIGGER sender_retry_after_change AFTER UPDATE OF send_retry_after ON accounts BEGIN
 UPDATE sender_ready SET(enabled,ready_at)=(SELECT enabled,ready_at FROM sender_readiness v
 WHERE v.campaign_id=sender_ready.campaign_id AND v.account_id=sender_ready.account_id) WHERE account_id=NEW.id;
END;
