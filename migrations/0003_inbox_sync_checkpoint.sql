ALTER TABLE accounts ADD COLUMN last_sync_uid INTEGER NOT NULL DEFAULT 0;
ALTER TABLE accounts ADD COLUMN last_sync_uid_validity TEXT;
