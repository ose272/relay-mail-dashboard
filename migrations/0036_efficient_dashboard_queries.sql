CREATE INDEX IF NOT EXISTS idx_leads_status_page ON leads(status,created_at,email,id);
CREATE INDEX IF NOT EXISTS idx_messages_idempotency_lookup ON messages(idempotency_key) WHERE idempotency_key IS NOT NULL;
