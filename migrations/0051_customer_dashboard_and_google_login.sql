CREATE TABLE auth_google_identities (
 google_sub TEXT PRIMARY KEY,user_id TEXT NOT NULL UNIQUE REFERENCES auth_users(id) ON DELETE CASCADE,created_at TEXT NOT NULL
);
CREATE TABLE auth_google_login_states (
 state_hash TEXT PRIMARY KEY,browser_hash TEXT NOT NULL,verifier_ciphertext TEXT NOT NULL,nonce_hash TEXT NOT NULL,created_at TEXT NOT NULL,expires_at TEXT NOT NULL
);
CREATE INDEX auth_google_login_expiry ON auth_google_login_states(expires_at);
ALTER TABLE customer_google_mailboxes ADD COLUMN cap INTEGER NOT NULL DEFAULT 40 CHECK(cap BETWEEN 1 AND 40);
ALTER TABLE customer_google_mailboxes ADD COLUMN paused INTEGER NOT NULL DEFAULT 0 CHECK(paused IN(0,1));
CREATE TABLE customer_workspace_settings (
 workspace_id TEXT NOT NULL REFERENCES auth_workspaces(id) ON DELETE CASCADE,key TEXT NOT NULL,value TEXT NOT NULL,PRIMARY KEY(workspace_id,key)
);
CREATE TABLE customer_plans (
 id TEXT PRIMARY KEY,workspace_id TEXT NOT NULL REFERENCES auth_workspaces(id) ON DELETE CASCADE,
 name TEXT NOT NULL,subject TEXT NOT NULL,body TEXT NOT NULL,description TEXT NOT NULL DEFAULT '',archived_at TEXT,created_at TEXT NOT NULL
);
CREATE INDEX customer_plan_workspace ON customer_plans(workspace_id,created_at,id);
CREATE TABLE customer_lead_batches (
 id TEXT PRIMARY KEY,workspace_id TEXT NOT NULL REFERENCES auth_workspaces(id) ON DELETE CASCADE,
 file_name TEXT NOT NULL,imported_count INTEGER NOT NULL DEFAULT 0,duplicate_count INTEGER NOT NULL DEFAULT 0,invalid_count INTEGER NOT NULL DEFAULT 0,
 status TEXT NOT NULL DEFAULT 'importing' CHECK(status IN('importing','complete','failed')),created_at TEXT NOT NULL
);
CREATE INDEX customer_batch_workspace ON customer_lead_batches(workspace_id,created_at,id);
CREATE TABLE customer_leads (
 id TEXT PRIMARY KEY,workspace_id TEXT NOT NULL REFERENCES auth_workspaces(id) ON DELETE CASCADE,
 batch_id TEXT NOT NULL REFERENCES customer_lead_batches(id),email TEXT NOT NULL COLLATE NOCASE,name TEXT NOT NULL,store TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'Ready',created_at TEXT NOT NULL,UNIQUE(workspace_id,email)
);
CREATE INDEX customer_lead_workspace ON customer_leads(workspace_id,created_at,id);
CREATE INDEX customer_lead_batch ON customer_leads(workspace_id,batch_id);
-- No recipient, message content, Google tokens or customer profile survives deletion here.
CREATE TABLE customer_retained_send_usage (id TEXT PRIMARY KEY,sender_hash TEXT NOT NULL,status TEXT NOT NULL,used_at TEXT NOT NULL);
CREATE INDEX customer_retained_usage ON customer_retained_send_usage(sender_hash,used_at);
