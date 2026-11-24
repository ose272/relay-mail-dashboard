ALTER TABLE campaigns ADD COLUMN capacity_checked_at TEXT;
CREATE TABLE delivery_sender_transfers(
 id TEXT PRIMARY KEY,
 delivery_id TEXT NOT NULL REFERENCES campaign_deliveries(id) ON DELETE CASCADE,
 from_account_id TEXT NOT NULL REFERENCES accounts(id),
 to_account_id TEXT NOT NULL REFERENCES accounts(id),
 created_at TEXT NOT NULL
);
