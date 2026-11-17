ALTER TABLE accounts ADD COLUMN credential_ciphertext TEXT;
ALTER TABLE accounts ADD COLUMN imap_verified_at TEXT;
ALTER TABLE accounts ADD COLUMN smtp_verified_at TEXT;
ALTER TABLE accounts ADD COLUMN last_sync_at TEXT;

ALTER TABLE messages ADD COLUMN external_id TEXT NOT NULL DEFAULT '';
ALTER TABLE messages ADD COLUMN send_state TEXT NOT NULL DEFAULT 'sent';
ALTER TABLE messages ADD COLUMN idempotency_key TEXT NOT NULL DEFAULT '';

CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_external_id
  ON messages(external_id) WHERE external_id <> '';
CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_idempotency_key
  ON messages(idempotency_key) WHERE idempotency_key <> '';
