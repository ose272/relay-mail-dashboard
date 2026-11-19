CREATE INDEX idx_delivery_stale_inflight
  ON campaign_deliveries(campaign_id, started_at) WHERE status = 'sending';
