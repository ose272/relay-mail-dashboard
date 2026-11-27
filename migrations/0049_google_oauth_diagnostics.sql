-- Fixed diagnostic codes only: never record provider payloads, email addresses,
-- authorization codes, OAuth state, token values or encrypted credentials.
CREATE TABLE customer_google_oauth_errors (
 id TEXT PRIMARY KEY,
 workspace_id TEXT NOT NULL REFERENCES auth_workspaces(id),
 stage TEXT NOT NULL,
 error_code TEXT NOT NULL,
 provider_status INTEGER NOT NULL DEFAULT 0,
 created_at TEXT NOT NULL
);
CREATE INDEX customer_google_errors_workspace ON customer_google_oauth_errors(workspace_id,created_at,id);
CREATE INDEX customer_google_errors_expiry ON customer_google_oauth_errors(created_at,id);
