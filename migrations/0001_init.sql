CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

INSERT OR IGNORE INTO app_settings (key, value) VALUES ('defaultCap', '40');

CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL COLLATE NOCASE UNIQUE,
  cap INTEGER NOT NULL DEFAULT 40 CHECK (cap BETWEEN 1 AND 500),
  used INTEGER NOT NULL DEFAULT 0 CHECK (used >= 0),
  paused INTEGER NOT NULL DEFAULT 0 CHECK (paused IN (0, 1)),
  connection TEXT NOT NULL DEFAULT 'Pending connection',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS leads (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL COLLATE NOCASE UNIQUE,
  name TEXT NOT NULL DEFAULT '',
  store TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'Ready',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS templates (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL
);

INSERT OR IGNORE INTO templates (id, name, subject, body, created_at)
VALUES (
  'seed-intro',
  'A thoughtful introduction',
  'A quick idea for {{store}}',
  'Hi {{name}},\n\nI came across {{store}} and wanted to introduce myself. I have an idea that could be relevant to your business.\n\nWould you be open to a quick conversation?\n\nBest regards',
  '2026-01-01T00:00:00.000Z'
);

CREATE TABLE IF NOT EXISTS campaigns (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  template_id TEXT NOT NULL REFERENCES templates(id),
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  remaining INTEGER NOT NULL DEFAULT 0,
  days INTEGER NOT NULL DEFAULT 0,
  allocation_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS threads (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  store TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL,
  subject TEXT NOT NULL,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  unread INTEGER NOT NULL DEFAULT 0 CHECK (unread IN (0, 1)),
  status TEXT NOT NULL DEFAULT 'Needs reply'
);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
  direction TEXT NOT NULL CHECK (direction IN ('in', 'out')),
  body TEXT NOT NULL,
  time TEXT NOT NULL,
  message_id TEXT NOT NULL DEFAULT '',
  in_reply_to TEXT NOT NULL DEFAULT '',
  references_json TEXT NOT NULL DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS login_attempts (
  ip_hash TEXT PRIMARY KEY,
  failures INTEGER NOT NULL DEFAULT 0,
  locked_until INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_leads_status ON leads(status);
CREATE INDEX IF NOT EXISTS idx_messages_thread ON messages(thread_id);
