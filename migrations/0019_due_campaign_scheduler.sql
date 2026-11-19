-- A campaign is only polled when work is due. This prevents the background
-- sender from repeatedly scanning a paused or future-dated campaign.
ALTER TABLE campaigns ADD COLUMN next_send_at TEXT;

CREATE INDEX idx_campaigns_due_scheduler
  ON campaigns(name, status, next_send_at, created_at);

CREATE INDEX idx_campaign_deliveries_due_scheduler
  ON campaign_deliveries(campaign_id, status, day_no, retry_after, batch_no);
