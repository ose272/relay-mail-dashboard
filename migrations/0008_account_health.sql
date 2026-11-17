ALTER TABLE accounts ADD COLUMN health_status TEXT NOT NULL DEFAULT 'Unknown';
ALTER TABLE accounts ADD COLUMN health_checked_at TEXT;
ALTER TABLE accounts ADD COLUMN health_code TEXT NOT NULL DEFAULT '';
ALTER TABLE accounts ADD COLUMN health_message TEXT NOT NULL DEFAULT '';

CREATE TABLE IF NOT EXISTS account_health_events (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  code TEXT NOT NULL DEFAULT '',
  message TEXT NOT NULL,
  created_at TEXT NOT NULL,
  resolved_at TEXT,
  read_at TEXT,
  email_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (email_status IN ('pending', 'sending', 'sent', 'failed', 'unavailable')),
  email_sent_at TEXT,
  email_sender TEXT,
  email_error TEXT
);

CREATE INDEX IF NOT EXISTS idx_account_health_events_account
  ON account_health_events(account_id, created_at DESC);

INSERT OR IGNORE INTO app_settings (key, value) VALUES ('healthNotificationEmail', '');
