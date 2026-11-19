-- The inbox is a same-day reply queue, so support the bounded inbound-message
-- query without scanning historic sent mail or old conversations.
CREATE INDEX idx_messages_inbound_received_at
  ON messages(direction, time DESC, thread_id);
