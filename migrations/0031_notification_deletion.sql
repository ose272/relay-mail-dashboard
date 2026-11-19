ALTER TABLE account_health_events ADD COLUMN deleted_at TEXT;
CREATE INDEX idx_health_notifications_visible ON account_health_events(created_at DESC,id DESC) WHERE deleted_at IS NULL;
