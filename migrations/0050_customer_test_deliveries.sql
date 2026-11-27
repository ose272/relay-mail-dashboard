-- Operator-created, recipient-bound test jobs. A capability authorizes only its fixed job.
CREATE TABLE customer_test_deliveries (
 id TEXT PRIMARY KEY,
 workspace_id TEXT NOT NULL REFERENCES auth_workspaces(id),
 mailbox_id TEXT NOT NULL REFERENCES customer_google_mailboxes(id),
 recipient TEXT NOT NULL,
 capability_hash TEXT NOT NULL,
 expires_at TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'queued' CHECK(status IN('queued','sending','sent','uncertain','failed','blocked')),
 created_at TEXT NOT NULL,
 started_at TEXT,
 sent_at TEXT,
 provider_message_id TEXT,
 error_code TEXT
);
CREATE INDEX customer_test_mailbox_usage ON customer_test_deliveries(mailbox_id,status,started_at);
