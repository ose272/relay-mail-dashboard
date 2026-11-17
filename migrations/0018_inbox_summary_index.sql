CREATE INDEX idx_messages_time_thread
  ON messages(time DESC, thread_id);
