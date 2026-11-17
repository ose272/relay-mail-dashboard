CREATE INDEX IF NOT EXISTS idx_threads_account_email
  ON threads(account_id, email);
