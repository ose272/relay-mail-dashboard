CREATE INDEX idx_campaign_delivery_sender_recent
  ON campaign_deliveries(campaign_id, account_id, status, sent_at, started_at);
