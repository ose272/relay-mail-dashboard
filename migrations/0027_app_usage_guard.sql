-- Conservative application-side allowance accounting. External Wrangler/dashboard
-- operations are not included; limits deliberately reserve headroom for them.
CREATE TABLE app_usage_days(
 day TEXT PRIMARY KEY,
 rows_read INTEGER NOT NULL DEFAULT 0,
 rows_written INTEGER NOT NULL DEFAULT 0
);
