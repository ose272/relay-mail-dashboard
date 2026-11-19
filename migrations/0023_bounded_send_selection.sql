-- Bounded queue lookup per sender and indexed rolling-window quota checks.
CREATE INDEX idx_delivery_sender_queue_seek
  ON campaign_deliveries(campaign_id, account_id, day_no, batch_no)
  WHERE status = 'queued';
CREATE INDEX idx_delivery_sender_quota_time
  ON campaign_deliveries(account_id, COALESCE(sent_at, started_at))
  WHERE status IN ('sending','sent','uncertain');
CREATE INDEX idx_delivery_campaign_sender_time
  ON campaign_deliveries(campaign_id, account_id, COALESCE(sent_at, started_at) DESC)
  WHERE status IN ('sending','sent','uncertain');
