CREATE UNIQUE INDEX idx_one_active_direct_send
  ON campaigns(name)
  WHERE name = 'Direct send'
    AND status IN ('Preparing', 'Dry run', 'Sending', 'Scheduled', 'Paused');
