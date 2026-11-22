-- Lead history checks must seek directly when archiving/deleting import batches.
CREATE INDEX IF NOT EXISTS idx_delivery_lead_history ON campaign_deliveries(lead_id);
