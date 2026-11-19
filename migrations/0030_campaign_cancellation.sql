ALTER TABLE campaigns ADD COLUMN cancelled_count INTEGER NOT NULL DEFAULT 0 CHECK(cancelled_count>=0);
ALTER TABLE campaigns ADD COLUMN cancelled_at TEXT;
