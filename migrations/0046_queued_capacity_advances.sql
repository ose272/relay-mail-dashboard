-- Audit only unsent assignments brought forward into real available capacity.
CREATE TABLE delivery_schedule_advances(
 delivery_id TEXT NOT NULL REFERENCES campaign_deliveries(id) ON DELETE CASCADE,
 campaign_id TEXT NOT NULL REFERENCES campaigns(id),
 from_day_no INTEGER NOT NULL,
 to_day_no INTEGER NOT NULL,
 advanced_at TEXT NOT NULL,
 PRIMARY KEY(delivery_id,from_day_no,to_day_no)
);
