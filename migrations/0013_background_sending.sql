ALTER TABLE campaign_deliveries ADD COLUMN attempt_count INTEGER NOT NULL DEFAULT 0
  CHECK (attempt_count >= 0);
ALTER TABLE campaign_deliveries ADD COLUMN retry_after TEXT;
ALTER TABLE campaign_deliveries ADD COLUMN last_error TEXT;

DROP INDEX idx_one_active_direct_send;

CREATE UNIQUE INDEX idx_one_active_direct_send
  ON campaigns(name)
  WHERE name = 'Direct send'
    AND status IN ('Preparing', 'Dry run', 'Sending', 'Scheduled', 'Paused', 'Needs review', 'User paused');

CREATE INDEX idx_campaign_delivery_retry
  ON campaign_deliveries(campaign_id, status, retry_after, day_no, batch_no);
