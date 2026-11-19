ALTER TABLE accounts ADD COLUMN sync_lease_token TEXT;
ALTER TABLE accounts ADD COLUMN sync_lease_until TEXT;
ALTER TABLE threads ADD COLUMN provider_thread_id TEXT;
ALTER TABLE threads ADD COLUMN provider_uid_validity TEXT;
ALTER TABLE threads ADD COLUMN provider_last_uid INTEGER NOT NULL DEFAULT 0;
ALTER TABLE threads ADD COLUMN provider_history_before_uid INTEGER;
ALTER TABLE messages ADD COLUMN sender_email TEXT NOT NULL DEFAULT '';
ALTER TABLE messages ADD COLUMN sender_name TEXT NOT NULL DEFAULT '';
CREATE INDEX idx_threads_provider_identity ON threads(account_id,provider_thread_id);
CREATE INDEX idx_messages_message_identity ON messages(message_id,thread_id);

CREATE INDEX idx_messages_thread_chronological ON messages(thread_id,time,id);

CREATE INDEX idx_account_health_history ON account_health_events(created_at DESC,id DESC);

ALTER TABLE sender_ready ADD COLUMN lane INTEGER NOT NULL DEFAULT 0;
WITH ranked AS (SELECT campaign_id,account_id,(ROW_NUMBER() OVER(PARTITION BY campaign_id ORDER BY account_id)-1)%150 AS slot FROM sender_ready)
UPDATE sender_ready SET lane=(SELECT slot FROM ranked r WHERE r.campaign_id=sender_ready.campaign_id AND r.account_id=sender_ready.account_id);
CREATE INDEX idx_sender_ready_lane ON sender_ready(campaign_id,lane,ready_at,last_used_at,account_id) WHERE enabled=1 AND next_delivery_id IS NOT NULL;
