-- Enforce one in-flight delivery per sender across all campaigns.
CREATE UNIQUE INDEX idx_one_sending_delivery_per_account
  ON campaign_deliveries(account_id) WHERE status = 'sending';
