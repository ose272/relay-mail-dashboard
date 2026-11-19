-- Persist quota counters and an indexed ready-sender queue. History is recounted
-- only when the cached earliest quota expiry has passed.
ALTER TABLE campaigns ADD COLUMN in_flight_count INTEGER NOT NULL DEFAULT 0;
UPDATE campaigns SET in_flight_count=(SELECT COUNT(*) FROM campaign_deliveries d
 WHERE d.campaign_id=campaigns.id AND d.status='sending');
CREATE TABLE sender_budget(
 account_id TEXT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
 used_count INTEGER NOT NULL DEFAULT 0 CHECK(used_count>=0),
 cap INTEGER NOT NULL, expires_at TEXT
);
CREATE TABLE sender_ready(
 campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
 account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
 next_delivery_id TEXT, last_used_at TEXT, busy INTEGER NOT NULL DEFAULT 0,
 enabled INTEGER NOT NULL DEFAULT 0, ready_at TEXT NOT NULL DEFAULT '9999-12-31T00:00:00.000Z',
 PRIMARY KEY(campaign_id,account_id)
);
CREATE INDEX idx_sender_ready_seek ON sender_ready(campaign_id,ready_at,last_used_at,account_id)
 WHERE enabled=1 AND next_delivery_id IS NOT NULL;
CREATE INDEX idx_sender_ready_account ON sender_ready(account_id);
CREATE INDEX idx_delivery_cached_queue ON campaign_deliveries(campaign_id,account_id,day_no,COALESCE(retry_after,''),batch_no)
 WHERE status='queued';
INSERT INTO sender_budget(account_id,used_count,cap,expires_at)
 SELECT a.id,(SELECT COUNT(*) FROM campaign_deliveries d INDEXED BY idx_delivery_sender_quota_time
 WHERE d.account_id=a.id AND d.status IN ('sending','sent','uncertain') AND COALESCE(d.sent_at,d.started_at)>strftime('%Y-%m-%dT%H:%M:%fZ','now','-1 day')),
 MIN(40,a.cap,CAST(COALESCE((SELECT value FROM app_settings WHERE key='defaultCap'),'40') AS INTEGER)),
 (SELECT strftime('%Y-%m-%dT%H:%M:%fZ',COALESCE(d.sent_at,d.started_at),'+1 day')
 FROM campaign_deliveries d INDEXED BY idx_delivery_sender_quota_time WHERE d.account_id=a.id
 AND d.status IN ('sending','sent','uncertain') AND COALESCE(d.sent_at,d.started_at)>strftime('%Y-%m-%dT%H:%M:%fZ','now','-1 day')
 ORDER BY COALESCE(d.sent_at,d.started_at) LIMIT 1)
 FROM accounts a;
CREATE VIEW sender_readiness AS
 SELECT s.campaign_id,s.account_id,
 CASE WHEN d.id IS NOT NULL AND s.busy=0 AND a.paused=0 AND a.connection='Connected'
 AND a.smtp_verified_at IS NOT NULL AND a.credential_ciphertext IS NOT NULL THEN 1 ELSE 0 END AS enabled,
 CASE WHEN d.id IS NULL THEN '9999-12-31T00:00:00.000Z' ELSE
 MAX(strftime('%Y-%m-%dT%H:%M:%fZ',c.created_at,printf('+%d days',d.day_no-1)),
 COALESCE(d.retry_after,'0000'),
 CASE WHEN b.used_count>=b.cap THEN COALESCE(b.expires_at,'9999-12-31T00:00:00.000Z') ELSE '0000' END) END AS ready_at
 FROM sender_ready s JOIN accounts a ON a.id=s.account_id JOIN campaigns c ON c.id=s.campaign_id
 JOIN sender_budget b ON b.account_id=s.account_id LEFT JOIN campaign_deliveries d ON d.id=s.next_delivery_id;
INSERT OR IGNORE INTO sender_ready(campaign_id,account_id)
 SELECT DISTINCT campaign_id,account_id FROM campaign_deliveries;
UPDATE sender_ready SET next_delivery_id=(SELECT q.id FROM campaign_deliveries q INDEXED BY idx_delivery_cached_queue
 WHERE q.campaign_id=sender_ready.campaign_id AND q.account_id=sender_ready.account_id AND q.status='queued'
 ORDER BY q.day_no,COALESCE(q.retry_after,''),q.batch_no,q.rowid LIMIT 1);
UPDATE sender_ready SET last_used_at=(SELECT COALESCE(sent_at,started_at) FROM campaign_deliveries r
 INDEXED BY idx_delivery_campaign_sender_time WHERE r.campaign_id=sender_ready.campaign_id AND r.account_id=sender_ready.account_id
 AND r.status IN ('sending','sent','uncertain') ORDER BY COALESCE(sent_at,started_at) DESC LIMIT 1);
UPDATE sender_ready SET (enabled,ready_at)=(SELECT enabled,ready_at FROM sender_readiness v
 WHERE v.campaign_id=sender_ready.campaign_id AND v.account_id=sender_ready.account_id);
UPDATE sender_ready SET busy=EXISTS(SELECT 1 FROM campaign_deliveries d WHERE d.account_id=sender_ready.account_id AND d.status='sending');
UPDATE sender_ready SET (enabled,ready_at)=(SELECT enabled,ready_at FROM sender_readiness v
 WHERE v.campaign_id=sender_ready.campaign_id AND v.account_id=sender_ready.account_id);
CREATE TRIGGER sender_budget_new_account AFTER INSERT ON accounts BEGIN
 INSERT INTO sender_budget(account_id,cap) VALUES(NEW.id,MIN(40,NEW.cap,CAST(COALESCE((SELECT value FROM app_settings WHERE key='defaultCap'),'40') AS INTEGER)));
END;
CREATE TRIGGER sender_budget_account_change AFTER UPDATE OF cap,paused,connection,smtp_verified_at,credential_ciphertext ON accounts BEGIN
 UPDATE sender_budget SET cap=MIN(40,NEW.cap,CAST(COALESCE((SELECT value FROM app_settings WHERE key='defaultCap'),'40') AS INTEGER)) WHERE account_id=NEW.id;
 UPDATE sender_ready SET (enabled,ready_at)=(SELECT enabled,ready_at FROM sender_readiness v
 WHERE v.campaign_id=sender_ready.campaign_id AND v.account_id=sender_ready.account_id) WHERE account_id=NEW.id;
END;
CREATE TRIGGER sender_budget_default_cap AFTER UPDATE OF value ON app_settings WHEN NEW.key='defaultCap' BEGIN
 UPDATE sender_budget SET cap=MIN(40,CAST(NEW.value AS INTEGER),(SELECT cap FROM accounts WHERE id=sender_budget.account_id));
END;
CREATE TRIGGER sender_budget_ready_change AFTER UPDATE ON sender_budget
 WHEN NEW.cap<>OLD.cap OR NEW.used_count<OLD.used_count BEGIN
 UPDATE sender_ready SET (enabled,ready_at)=(SELECT enabled,ready_at FROM sender_readiness v
 WHERE v.campaign_id=sender_ready.campaign_id AND v.account_id=sender_ready.account_id) WHERE account_id=NEW.account_id;
END;
CREATE TRIGGER sender_budget_before_claim BEFORE UPDATE OF status ON campaign_deliveries
 WHEN NEW.status='sending' AND OLD.status='queued' BEGIN
 UPDATE sender_budget SET
 used_count=(SELECT COUNT(*) FROM campaign_deliveries d INDEXED BY idx_delivery_sender_quota_time
 WHERE d.account_id=NEW.account_id AND d.status IN ('sending','sent','uncertain') AND COALESCE(d.sent_at,d.started_at)>strftime('%Y-%m-%dT%H:%M:%fZ','now','-1 day')),
 expires_at=(SELECT strftime('%Y-%m-%dT%H:%M:%fZ',COALESCE(d.sent_at,d.started_at),'+1 day')
 FROM campaign_deliveries d INDEXED BY idx_delivery_sender_quota_time WHERE d.account_id=NEW.account_id
 AND d.status IN ('sending','sent','uncertain') AND COALESCE(d.sent_at,d.started_at)>strftime('%Y-%m-%dT%H:%M:%fZ','now','-1 day')
 ORDER BY COALESCE(d.sent_at,d.started_at) LIMIT 1)
 WHERE account_id=NEW.account_id AND expires_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now');
 SELECT CASE WHEN (SELECT used_count>=cap FROM sender_budget WHERE account_id=NEW.account_id)
 THEN RAISE(IGNORE) END;
END;
CREATE TRIGGER sender_budget_delivery_update AFTER UPDATE OF status,sent_at,started_at,retry_after ON campaign_deliveries BEGIN
 UPDATE campaigns SET in_flight_count=MAX(0,in_flight_count+(NEW.status='sending')-(OLD.status='sending')), status=CASE WHEN NEW.status='uncertain' AND OLD.status='sending' AND status IN ('Sending','Scheduled','Dry run','Paused') THEN 'Needs review' ELSE status END WHERE id=NEW.campaign_id;
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
CREATE TRIGGER sender_budget_delivery_insert AFTER INSERT ON campaign_deliveries WHEN (NEW.status IN ('sending','sent','uncertain') AND COALESCE(NEW.sent_at,NEW.started_at)>strftime('%Y-%m-%dT%H:%M:%fZ','now','-1 day')) BEGIN
 UPDATE campaigns SET in_flight_count=in_flight_count+(NEW.status='sending') WHERE id=NEW.campaign_id;
 UPDATE sender_budget SET used_count=used_count+1,
 expires_at=MIN(COALESCE(expires_at,'9999-12-31T00:00:00.000Z'),strftime('%Y-%m-%dT%H:%M:%fZ',COALESCE(NEW.sent_at,NEW.started_at),'+1 day')) WHERE account_id=NEW.account_id;
END;
