-- Unique engagement counters; no full delivery scans.
ALTER TABLE delivery_open_tracking ADD COLUMN open_enabled INTEGER NOT NULL DEFAULT 1 CHECK(open_enabled IN(0,1));
ALTER TABLE delivery_open_tracking ADD COLUMN click_enabled INTEGER NOT NULL DEFAULT 0 CHECK(click_enabled IN(0,1));
ALTER TABLE delivery_open_tracking ADD COLUMN first_click_at TEXT;
ALTER TABLE campaigns ADD COLUMN click_tracked_sent_count INTEGER NOT NULL DEFAULT 0 CHECK(click_tracked_sent_count>=0);
ALTER TABLE campaigns ADD COLUMN unique_click_count INTEGER NOT NULL DEFAULT 0 CHECK(unique_click_count>=0);
ALTER TABLE plan_open_metrics ADD COLUMN click_tracked_sent_count INTEGER NOT NULL DEFAULT 0 CHECK(click_tracked_sent_count>=0);
ALTER TABLE plan_open_metrics ADD COLUMN unique_click_count INTEGER NOT NULL DEFAULT 0 CHECK(unique_click_count>=0);
ALTER TABLE campaign_plan_open_metrics ADD COLUMN click_tracked_sent_count INTEGER NOT NULL DEFAULT 0 CHECK(click_tracked_sent_count>=0);
ALTER TABLE campaign_plan_open_metrics ADD COLUMN unique_click_count INTEGER NOT NULL DEFAULT 0 CHECK(unique_click_count>=0);
CREATE TABLE delivery_click_links(id TEXT PRIMARY KEY,delivery_id TEXT NOT NULL REFERENCES delivery_open_tracking(delivery_id) ON DELETE CASCADE,destination_url TEXT NOT NULL);
CREATE INDEX click_links_delivery ON delivery_click_links(delivery_id);
INSERT OR IGNORE INTO app_settings(key,value) VALUES('planOpenTracking','1'),('linkTracking','1');
DROP TRIGGER tracking_rollups;
CREATE TRIGGER tracking_rollups AFTER UPDATE OF eligible,first_open_at,first_click_at ON delivery_open_tracking WHEN NEW.eligible<>OLD.eligible OR (NEW.eligible=1 AND ((OLD.first_open_at IS NULL AND NEW.first_open_at IS NOT NULL) OR (OLD.first_click_at IS NULL AND NEW.first_click_at IS NOT NULL))) BEGIN
INSERT OR IGNORE INTO plan_open_metrics(template_id) VALUES(NEW.template_id);
INSERT OR IGNORE INTO campaign_plan_open_metrics(campaign_id,template_id) VALUES(NEW.campaign_id,NEW.template_id);
UPDATE campaigns SET tracked_sent_count=tracked_sent_count+(NEW.eligible*NEW.open_enabled-OLD.eligible*OLD.open_enabled),unique_open_count=unique_open_count+(NEW.eligible*NEW.open_enabled*(NEW.first_open_at IS NOT NULL)-OLD.eligible*OLD.open_enabled*(OLD.first_open_at IS NOT NULL)),click_tracked_sent_count=click_tracked_sent_count+(NEW.eligible*NEW.click_enabled-OLD.eligible*OLD.click_enabled),unique_click_count=unique_click_count+(NEW.eligible*NEW.click_enabled*(NEW.first_click_at IS NOT NULL)-OLD.eligible*OLD.click_enabled*(OLD.first_click_at IS NOT NULL)) WHERE id=NEW.campaign_id;
UPDATE plan_open_metrics SET tracked_sent_count=tracked_sent_count+(NEW.eligible*NEW.open_enabled-OLD.eligible*OLD.open_enabled),unique_open_count=unique_open_count+(NEW.eligible*NEW.open_enabled*(NEW.first_open_at IS NOT NULL)-OLD.eligible*OLD.open_enabled*(OLD.first_open_at IS NOT NULL)),click_tracked_sent_count=click_tracked_sent_count+(NEW.eligible*NEW.click_enabled-OLD.eligible*OLD.click_enabled),unique_click_count=unique_click_count+(NEW.eligible*NEW.click_enabled*(NEW.first_click_at IS NOT NULL)-OLD.eligible*OLD.click_enabled*(OLD.first_click_at IS NOT NULL)) WHERE template_id=NEW.template_id;
UPDATE campaign_plan_open_metrics SET tracked_sent_count=tracked_sent_count+(NEW.eligible*NEW.open_enabled-OLD.eligible*OLD.open_enabled),unique_open_count=unique_open_count+(NEW.eligible*NEW.open_enabled*(NEW.first_open_at IS NOT NULL)-OLD.eligible*OLD.open_enabled*(OLD.first_open_at IS NOT NULL)),click_tracked_sent_count=click_tracked_sent_count+(NEW.eligible*NEW.click_enabled-OLD.eligible*OLD.click_enabled),unique_click_count=unique_click_count+(NEW.eligible*NEW.click_enabled*(NEW.first_click_at IS NOT NULL)-OLD.eligible*OLD.click_enabled*(OLD.first_click_at IS NOT NULL)) WHERE campaign_id=NEW.campaign_id AND template_id=NEW.template_id;
END;
