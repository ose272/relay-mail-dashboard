CREATE TABLE IF NOT EXISTS campaign_deliveries (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  batch_no INTEGER NOT NULL,
  day_no INTEGER NOT NULL,
  lead_id TEXT NOT NULL REFERENCES leads(id),
  account_id TEXT NOT NULL REFERENCES accounts(id),
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'sending', 'sent', 'uncertain')),
  created_at TEXT NOT NULL,
  started_at TEXT,
  sent_at TEXT,
  UNIQUE (campaign_id, batch_no, lead_id)
);

CREATE INDEX IF NOT EXISTS idx_campaign_deliveries_queue
  ON campaign_deliveries(campaign_id, status, day_no, batch_no);
CREATE INDEX IF NOT EXISTS idx_campaign_deliveries_account_quota
  ON campaign_deliveries(account_id, status, sent_at, started_at);

UPDATE app_settings SET value = '40'
WHERE key = 'defaultCap' AND CAST(value AS INTEGER) > 40;
UPDATE accounts SET cap = 40 WHERE cap > 40;
