-- Customer identities are separate from the existing administrator mailbox workspace.
CREATE TABLE auth_users(
 id TEXT PRIMARY KEY,
 email TEXT NOT NULL COLLATE NOCASE UNIQUE,
 display_name TEXT NOT NULL,
 password_hash TEXT NOT NULL,
 created_at TEXT NOT NULL,
 email_verified_at TEXT
);
CREATE TABLE auth_workspaces(
 id TEXT PRIMARY KEY,
 owner_user_id TEXT NOT NULL UNIQUE REFERENCES auth_users(id) ON DELETE CASCADE,
 name TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'pending_setup' CHECK(status IN('pending_setup','ready')),
 created_at TEXT NOT NULL
);
CREATE TABLE auth_sessions(
 token_hash TEXT PRIMARY KEY,
 user_id TEXT NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
 created_at TEXT NOT NULL,
 expires_at TEXT NOT NULL
);
CREATE INDEX auth_sessions_expiry ON auth_sessions(expires_at);
CREATE INDEX auth_sessions_user ON auth_sessions(user_id);
CREATE TABLE auth_rate_limits(
 key TEXT PRIMARY KEY,
 attempts INTEGER NOT NULL DEFAULT 0,
 expires_at TEXT NOT NULL
);
CREATE INDEX auth_rate_expiry ON auth_rate_limits(expires_at);
