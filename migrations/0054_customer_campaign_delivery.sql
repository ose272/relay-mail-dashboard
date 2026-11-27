ALTER TABLE customer_google_mailboxes ADD COLUMN send_retry_after TEXT;
CREATE TABLE customer_campaigns (
 id TEXT PRIMARY KEY,workspace_id TEXT NOT NULL REFERENCES auth_workspaces(id) ON DELETE CASCADE,
 name TEXT NOT NULL DEFAULT 'Direct send',status TEXT NOT NULL DEFAULT 'Preparing' CHECK(status IN('Preparing','Sending','Scheduled','User paused','Complete','Needs review','Cancelled')),
 created_at TEXT NOT NULL,updated_at TEXT NOT NULL,planned_sends INTEGER NOT NULL,
 prepared_count INTEGER NOT NULL DEFAULT 0,sent_count INTEGER NOT NULL DEFAULT 0,pending_count INTEGER NOT NULL DEFAULT 0,
 uncertain_count INTEGER NOT NULL DEFAULT 0,failed_count INTEGER NOT NULL DEFAULT 0,cancelled_count INTEGER NOT NULL DEFAULT 0,in_flight INTEGER NOT NULL DEFAULT 0,
 next_send_at TEXT,lead_cursor TEXT NOT NULL DEFAULT '',lead_upper TEXT NOT NULL,
 senders_json TEXT NOT NULL,plans_json TEXT NOT NULL,prepare_lease TEXT,prepare_until TEXT
);
CREATE UNIQUE INDEX customer_active_campaign ON customer_campaigns(workspace_id) WHERE status IN('Preparing','Sending','Scheduled','User paused','Needs review');
CREATE INDEX customer_campaign_workspace ON customer_campaigns(workspace_id,created_at DESC,id);
CREATE INDEX customer_campaign_due ON customer_campaigns(status,next_send_at,id);
CREATE TABLE customer_outbox (
 id TEXT PRIMARY KEY,workspace_id TEXT NOT NULL REFERENCES auth_workspaces(id),campaign_id TEXT REFERENCES customer_campaigns(id),
 mailbox_id TEXT NOT NULL REFERENCES customer_google_mailboxes(id),sender_hash TEXT NOT NULL,
 lead_id TEXT,plan_id TEXT,plan_name TEXT,thread_id TEXT REFERENCES customer_mail_threads(id),
 recipient TEXT NOT NULL,subject TEXT NOT NULL,body TEXT NOT NULL,request_key TEXT NOT NULL,payload_hash TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'queued' CHECK(status IN('queued','sending','sent','uncertain','failed','cancelled')),
 created_at TEXT NOT NULL,started_at TEXT,sent_at TEXT,retry_after TEXT NOT NULL DEFAULT '0000',
 provider_message_id TEXT,provider_thread_id TEXT,last_error TEXT,
 UNIQUE(workspace_id,request_key),UNIQUE(campaign_id,lead_id)
);
CREATE INDEX customer_outbox_due ON customer_outbox(status,retry_after,created_at,id);
CREATE INDEX customer_outbox_campaign ON customer_outbox(workspace_id,campaign_id,status,created_at,id);
CREATE INDEX customer_outbox_sender_usage ON customer_outbox(sender_hash,status,started_at);
CREATE INDEX customer_outbox_thread ON customer_outbox(workspace_id,thread_id,created_at);
CREATE UNIQUE INDEX customer_one_pending_reply ON customer_outbox(workspace_id,thread_id) WHERE thread_id IS NOT NULL AND status IN('queued','sending','uncertain');
CREATE INDEX customer_outbox_stale ON customer_outbox(status,started_at,id);
CREATE INDEX customer_outbox_workspace_usage ON customer_outbox(workspace_id,status,started_at,sender_hash);
CREATE INDEX customer_outbox_workspace_activity ON customer_outbox(workspace_id,status,sent_at);
CREATE INDEX customer_outbox_campaign_activity ON customer_outbox(workspace_id,campaign_id,created_at DESC,id DESC);
CREATE INDEX customer_lead_preparation ON customer_leads(workspace_id,status,id);
CREATE INDEX customer_legacy_sender_email ON accounts(lower(email));
CREATE INDEX customer_google_identity_history ON customer_google_mailboxes(google_sub,id);
CREATE TABLE customer_sender_locks(sender_hash TEXT PRIMARY KEY,owner TEXT,expires_at TEXT NOT NULL DEFAULT '0000');
CREATE TRIGGER customer_delivery_insert AFTER INSERT ON customer_outbox WHEN NEW.campaign_id IS NOT NULL BEGIN
 UPDATE customer_campaigns SET pending_count=pending_count+(NEW.status='queued'),in_flight=in_flight+(NEW.status='sending'),sent_count=sent_count+(NEW.status='sent'),uncertain_count=uncertain_count+(NEW.status='uncertain'),failed_count=failed_count+(NEW.status='failed'),cancelled_count=cancelled_count+(NEW.status='cancelled') WHERE id=NEW.campaign_id AND workspace_id=NEW.workspace_id;
END;
CREATE TRIGGER customer_delivery_update AFTER UPDATE OF status ON customer_outbox WHEN NEW.campaign_id IS NOT NULL AND NEW.status<>OLD.status BEGIN
 UPDATE customer_campaigns SET pending_count=pending_count+(NEW.status='queued')-(OLD.status='queued'),in_flight=in_flight+(NEW.status='sending')-(OLD.status='sending'),sent_count=sent_count+(NEW.status='sent')-(OLD.status='sent'),uncertain_count=uncertain_count+(NEW.status='uncertain')-(OLD.status='uncertain'),failed_count=failed_count+(NEW.status='failed')-(OLD.status='failed'),cancelled_count=cancelled_count+(NEW.status='cancelled')-(OLD.status='cancelled'),updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=NEW.campaign_id AND workspace_id=NEW.workspace_id;
END;
CREATE TRIGGER customer_campaign_no_early_finish BEFORE UPDATE OF status ON customer_campaigns WHEN NEW.status='Complete' AND (NEW.prepared_count<NEW.planned_sends OR EXISTS(SELECT 1 FROM customer_outbox WHERE campaign_id=NEW.id AND status IN('queued','sending','uncertain'))) BEGIN SELECT RAISE(ABORT,'Unfinished deliveries remain'); END;
CREATE TRIGGER customer_outbox_preserve_history BEFORE DELETE ON customer_outbox WHEN OLD.status='sending' OR (OLD.status IN('sent','uncertain') AND NOT EXISTS(SELECT 1 FROM customer_retained_send_usage WHERE id=OLD.id)) BEGIN SELECT RAISE(ABORT,'Preserve accepted or unconfirmed delivery history'); END;
