CREATE TABLE campaign_deliveries_rebuilt (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  batch_no INTEGER NOT NULL,
  day_no INTEGER NOT NULL,
  lead_id TEXT NOT NULL REFERENCES leads(id),
  account_id TEXT NOT NULL REFERENCES accounts(id),
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'sending', 'sent', 'uncertain', 'failed')),
  created_at TEXT NOT NULL,
  started_at TEXT,
  sent_at TEXT,
  template_id TEXT REFERENCES templates(id),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  retry_after TEXT,
  last_error TEXT,
  UNIQUE (campaign_id, account_id, lead_id)
);

INSERT INTO campaign_deliveries_rebuilt (
  id, campaign_id, batch_no, day_no, lead_id, account_id, status,
  created_at, started_at, sent_at, template_id, attempt_count, retry_after, last_error
)
SELECT
  id, campaign_id, batch_no, day_no, lead_id, account_id,
  CASE
    WHEN status = 'uncertain' AND last_error GLOB 'SMTP_5[0-9][0-9]' THEN 'failed'
    ELSE status
  END,
  created_at, started_at, sent_at, template_id, attempt_count, retry_after, last_error
FROM campaign_deliveries;

DROP TABLE campaign_deliveries;
ALTER TABLE campaign_deliveries_rebuilt RENAME TO campaign_deliveries;

CREATE INDEX idx_campaign_deliveries_queue
  ON campaign_deliveries(campaign_id, status, day_no, batch_no);
CREATE INDEX idx_campaign_deliveries_account_quota
  ON campaign_deliveries(account_id, status, sent_at, started_at);
CREATE INDEX idx_campaign_delivery_retry
  ON campaign_deliveries(campaign_id, status, retry_after, day_no, batch_no);
