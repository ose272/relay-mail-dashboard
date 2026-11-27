ALTER TABLE customer_google_mailboxes ADD COLUMN last_sync_at TEXT;
ALTER TABLE customer_google_mailboxes ADD COLUMN sync_cursor TEXT;
ALTER TABLE customer_google_mailboxes ADD COLUMN sync_query TEXT;
ALTER TABLE customer_google_mailboxes ADD COLUMN sync_lease TEXT;
ALTER TABLE customer_google_mailboxes ADD COLUMN sync_lease_until TEXT;
CREATE TABLE customer_mail_threads (
 id TEXT PRIMARY KEY,workspace_id TEXT NOT NULL REFERENCES auth_workspaces(id) ON DELETE CASCADE,
 mailbox_id TEXT NOT NULL REFERENCES customer_google_mailboxes(id),provider_id TEXT NOT NULL,
 email TEXT NOT NULL,name TEXT NOT NULL,subject TEXT NOT NULL,
 unread INTEGER NOT NULL DEFAULT 0,archived INTEGER NOT NULL DEFAULT 0,trashed INTEGER NOT NULL DEFAULT 0,
 starred INTEGER NOT NULL DEFAULT 0,tag TEXT NOT NULL DEFAULT 'Question',inbound_at TEXT,updated_at TEXT NOT NULL,
 UNIQUE(mailbox_id,provider_id)
);
CREATE INDEX customer_thread_workspace ON customer_mail_threads(workspace_id,trashed,inbound_at DESC,id);
CREATE TABLE customer_mail_messages (
 id TEXT PRIMARY KEY,workspace_id TEXT NOT NULL REFERENCES auth_workspaces(id) ON DELETE CASCADE,
 thread_id TEXT NOT NULL REFERENCES customer_mail_threads(id) ON DELETE CASCADE,
 provider_id TEXT NOT NULL,sender_email TEXT NOT NULL,direction TEXT NOT NULL CHECK(direction IN('in','out')),
 body TEXT NOT NULL,sent_at TEXT NOT NULL,message_id TEXT NOT NULL DEFAULT '',
 UNIQUE(thread_id,provider_id)
);
CREATE INDEX customer_message_thread ON customer_mail_messages(workspace_id,thread_id,sent_at,id);
CREATE TABLE customer_mail_actions (
 id TEXT PRIMARY KEY,workspace_id TEXT NOT NULL REFERENCES auth_workspaces(id) ON DELETE CASCADE,
 thread_id TEXT NOT NULL REFERENCES customer_mail_threads(id) ON DELETE CASCADE,
 kind TEXT NOT NULL,status TEXT NOT NULL CHECK(status IN('pending','confirmed','uncertain','failed')),
 created_at TEXT NOT NULL,confirmed_at TEXT
);
