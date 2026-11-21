-- Additive preparation journal. No existing campaign or delivery is modified.
CREATE TABLE campaign_preparations(
 campaign_id TEXT PRIMARY KEY REFERENCES campaigns(id) ON DELETE CASCADE,
 target_status TEXT NOT NULL CHECK(target_status IN ('Sending','Dry run')),
 phase TEXT NOT NULL DEFAULT 'deliveries',
 total_count INTEGER NOT NULL,prepared_count INTEGER NOT NULL DEFAULT 0,
 total_senders INTEGER NOT NULL,prepared_senders INTEGER NOT NULL DEFAULT 0,
 chunk_count INTEGER NOT NULL,lease_token TEXT,lease_until TEXT,
 heartbeat_at TEXT NOT NULL,error_code TEXT,error_at TEXT
);
CREATE TABLE campaign_preparation_chunks(
 campaign_id TEXT NOT NULL REFERENCES campaign_preparations(campaign_id) ON DELETE CASCADE,
 chunk_no INTEGER NOT NULL,kind TEXT NOT NULL CHECK(kind IN ('deliveries','senders')),
 row_count INTEGER NOT NULL,payload TEXT NOT NULL,done INTEGER NOT NULL DEFAULT 0,
 PRIMARY KEY(campaign_id,chunk_no)
);
CREATE INDEX idx_preparation_pending_chunks ON campaign_preparation_chunks(campaign_id,chunk_no) WHERE done=0;
CREATE INDEX idx_preparation_work ON campaign_preparations(phase,lease_until,heartbeat_at);
-- Dismiss review notices without deleting delivery or uncertainty history.
ALTER TABLE campaign_deliveries ADD COLUMN review_dismissed_at TEXT;
