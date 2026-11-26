ALTER TABLE templates ADD COLUMN description TEXT NOT NULL DEFAULT '';
-- Maintained daily totals keep the live dashboard graph to at most 14 reads.
CREATE TABLE workspace_daily_activity(
 day TEXT PRIMARY KEY,
 accepted_count INTEGER NOT NULL DEFAULT 0 CHECK(accepted_count>=0),
 reply_count INTEGER NOT NULL DEFAULT 0 CHECK(reply_count>=0)
);
INSERT INTO workspace_daily_activity(day,accepted_count)
 SELECT date(sent_at,'+1 hour'),COUNT(*) FROM campaign_deliveries
 WHERE status='sent' AND date(sent_at,'+1 hour') IS NOT NULL GROUP BY date(sent_at,'+1 hour');
INSERT INTO workspace_daily_activity(day,reply_count)
 SELECT date(time,'+1 hour'),COUNT(*) FROM messages
 WHERE direction='in' AND date(time,'+1 hour') IS NOT NULL GROUP BY date(time,'+1 hour')
 ON CONFLICT(day) DO UPDATE SET reply_count=excluded.reply_count;
CREATE TRIGGER daily_delivery_insert AFTER INSERT ON campaign_deliveries
 WHEN NEW.status='sent' AND date(NEW.sent_at,'+1 hour') IS NOT NULL BEGIN
 INSERT INTO workspace_daily_activity(day,accepted_count) VALUES(date(NEW.sent_at,'+1 hour'),1)
 ON CONFLICT(day) DO UPDATE SET accepted_count=accepted_count+1;
END;
CREATE TRIGGER daily_delivery_update AFTER UPDATE OF status,sent_at ON campaign_deliveries
 WHEN OLD.status IS NOT NEW.status OR OLD.sent_at IS NOT NEW.sent_at BEGIN
 UPDATE workspace_daily_activity SET accepted_count=MAX(0,accepted_count-1)
 WHERE OLD.status='sent' AND day=date(OLD.sent_at,'+1 hour');
 INSERT INTO workspace_daily_activity(day,accepted_count)
 SELECT date(NEW.sent_at,'+1 hour'),1 WHERE NEW.status='sent' AND date(NEW.sent_at,'+1 hour') IS NOT NULL
 ON CONFLICT(day) DO UPDATE SET accepted_count=accepted_count+1;
END;
CREATE TRIGGER daily_reply_insert AFTER INSERT ON messages
 WHEN NEW.direction='in' AND date(NEW.time,'+1 hour') IS NOT NULL BEGIN
 INSERT INTO workspace_daily_activity(day,reply_count) VALUES(date(NEW.time,'+1 hour'),1)
 ON CONFLICT(day) DO UPDATE SET reply_count=reply_count+1;
END;
CREATE TRIGGER daily_reply_update AFTER UPDATE OF direction,time ON messages
 WHEN OLD.direction IS NOT NEW.direction OR OLD.time IS NOT NEW.time BEGIN
 UPDATE workspace_daily_activity SET reply_count=MAX(0,reply_count-1)
 WHERE OLD.direction='in' AND day=date(OLD.time,'+1 hour');
 INSERT INTO workspace_daily_activity(day,reply_count)
 SELECT date(NEW.time,'+1 hour'),1 WHERE NEW.direction='in' AND date(NEW.time,'+1 hour') IS NOT NULL
 ON CONFLICT(day) DO UPDATE SET reply_count=reply_count+1;
END;
CREATE TRIGGER daily_reply_delete AFTER DELETE ON messages WHEN OLD.direction='in' BEGIN
 UPDATE workspace_daily_activity SET reply_count=MAX(0,reply_count-1) WHERE day=date(OLD.time,'+1 hour');
END;
