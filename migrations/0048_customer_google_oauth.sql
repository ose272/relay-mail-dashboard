-- Customer OAuth connections never reference the legacy administrator's mailbox rows.
CREATE TABLE customer_google_mailboxes (
 id TEXT PRIMARY KEY,
 workspace_id TEXT NOT NULL REFERENCES auth_workspaces(id),
 google_sub TEXT NOT NULL,
 email TEXT NOT NULL,
 refresh_ciphertext TEXT NOT NULL,
 access_ciphertext TEXT NOT NULL,
 access_expires_at TEXT NOT NULL,
 granted_scopes TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'connected' CHECK(status IN('connected','reconnect_required','disconnected')),
 connected_at TEXT NOT NULL,
 updated_at TEXT NOT NULL,
 checked_at TEXT,
 last_check_status TEXT
);
CREATE INDEX customer_google_workspace ON customer_google_mailboxes(workspace_id,connected_at,id);
CREATE UNIQUE INDEX customer_google_active_identity ON customer_google_mailboxes(google_sub) WHERE status<>'disconnected';
CREATE TABLE customer_google_oauth_states (
 state_hash TEXT PRIMARY KEY,
 session_hash TEXT NOT NULL,
 user_id TEXT NOT NULL REFERENCES auth_users(id),
 workspace_id TEXT NOT NULL REFERENCES auth_workspaces(id),
 verifier_ciphertext TEXT NOT NULL,
 nonce_hash TEXT NOT NULL,
 created_at TEXT NOT NULL,
 expires_at TEXT NOT NULL
);
CREATE INDEX customer_google_state_expiry ON customer_google_oauth_states(expires_at);
CREATE INDEX customer_google_state_rate ON customer_google_oauth_states(user_id,created_at);
