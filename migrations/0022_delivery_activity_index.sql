-- Bounded activity polling must not sort or scan an entire campaign.
CREATE INDEX idx_campaign_delivery_activity
  ON campaign_deliveries(campaign_id, status, created_at DESC, id DESC);

CREATE INDEX idx_campaign_recent_runs ON campaigns(name, created_at DESC);
