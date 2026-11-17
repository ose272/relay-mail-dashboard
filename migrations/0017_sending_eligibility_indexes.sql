-- Send-start builds each blocker set once. These indexes support those sets
-- without scanning the full delivery/message tables for every ready lead.
CREATE INDEX idx_campaign_deliveries_status_lead
  ON campaign_deliveries(status, lead_id);

CREATE INDEX idx_messages_direction_state_thread
  ON messages(direction, send_state, thread_id);
