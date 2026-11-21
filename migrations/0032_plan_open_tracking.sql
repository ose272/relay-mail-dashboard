-- 0032_plan_open_tracking.sql: Open tracking by scouting plan

-- Add open tracking columns to campaigns table
ALTER TABLE campaigns ADD COLUMN tracked_sent_count INTEGER NOT NULL DEFAULT 0 CHECK(tracked_sent_count>=0);
ALTER TABLE campaigns ADD COLUMN unique_open_count INTEGER NOT NULL DEFAULT 0 CHECK(unique_open_count>=0);

-- Enable open tracking feature
INSERT OR IGNORE INTO app_settings(key,value) VALUES('openTracking','1');

-- Table to track per-delivery open status
CREATE TABLE delivery_open_tracking(
    delivery_id TEXT PRIMARY KEY REFERENCES campaign_deliveries(id) ON DELETE CASCADE,
    campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
    template_id TEXT NOT NULL REFERENCES templates(id),
    first_open_at TEXT,
    eligible INTEGER NOT NULL DEFAULT 0 CHECK(eligible IN (0,1))
);

-- Per-plan metrics across all campaigns
CREATE TABLE plan_open_metrics(
    template_id TEXT PRIMARY KEY REFERENCES templates(id),
    tracked_sent_count INTEGER NOT NULL DEFAULT 0 CHECK(tracked_sent_count>=0),
    unique_open_count INTEGER NOT NULL DEFAULT 0 CHECK(unique_open_count>=0)
);

-- Per-campaign, per-plan metrics
CREATE TABLE campaign_plan_open_metrics(
    campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
    template_id TEXT NOT NULL REFERENCES templates(id),
    tracked_sent_count INTEGER NOT NULL DEFAULT 0 CHECK(tracked_sent_count>=0),
    unique_open_count INTEGER NOT NULL DEFAULT 0 CHECK(unique_open_count>=0),
    PRIMARY KEY(campaign_id, template_id)
);

-- Trigger: Update open tracking eligibility when delivery status changes
CREATE TRIGGER tracking_delivery_status
AFTER UPDATE OF status ON campaign_deliveries
WHEN NEW.status <> OLD.status BEGIN
    UPDATE delivery_open_tracking 
    SET eligible = (NEW.status = 'sent' AND NOT EXISTS(
        SELECT 1 FROM delivery_bounces b WHERE b.delivery_id = NEW.id
    ))
    WHERE delivery_id = NEW.id;
END;

-- Trigger: Mark delivery as non-eligible when bounce is recorded
CREATE TRIGGER tracking_bounce
AFTER INSERT ON delivery_bounces BEGIN
    UPDATE delivery_open_tracking 
    SET eligible = 0 
    WHERE delivery_id = NEW.delivery_id;
END;

-- Trigger: Maintain rollup counts for campaigns and plans
CREATE TRIGGER tracking_rollups
AFTER UPDATE OF eligible, first_open_at ON delivery_open_tracking
WHEN NEW.eligible <> OLD.eligible 
     OR (OLD.first_open_at IS NULL AND NEW.first_open_at IS NOT NULL AND NEW.eligible = 1) BEGIN
    -- Update campaign-level counts
    UPDATE campaigns 
    SET 
        tracked_sent_count = tracked_sent_count + NEW.eligible - OLD.eligible,
        unique_open_count = unique_open_count + CASE WHEN NEW.eligible = 1 AND NEW.first_open_at IS NOT NULL THEN 1 ELSE 0 END 
                           - CASE WHEN OLD.eligible = 1 AND OLD.first_open_at IS NOT NULL THEN 1 ELSE 0 END
    WHERE id = NEW.campaign_id;

    -- Update per-plan metrics
    INSERT INTO plan_open_metrics(template_id, tracked_sent_count, unique_open_count)
    VALUES(NEW.template_id, NEW.eligible - OLD.eligible, 
           CASE WHEN NEW.eligible = 1 AND NEW.first_open_at IS NOT NULL THEN 1 ELSE 0 END 
           - CASE WHEN OLD.eligible = 1 AND OLD.first_open_at IS NOT NULL THEN 1 ELSE 0 END)
    ON CONFLICT(template_id) DO UPDATE SET
        tracked_sent_count = tracked_sent_count + excluded.tracked_sent_count,
        unique_open_count = unique_open_count + excluded.unique_open_count;

    -- Update per-campaign, per-plan metrics
    INSERT INTO campaign_plan_open_metrics(campaign_id, template_id, tracked_sent_count, unique_open_count)
    VALUES(NEW.campaign_id, NEW.template_id, NEW.eligible - OLD.eligible, 
           CASE WHEN NEW.eligible = 1 AND NEW.first_open_at IS NOT NULL THEN 1 ELSE 0 END 
           - CASE WHEN OLD.eligible = 1 AND OLD.first_open_at IS NOT NULL THEN 1 ELSE 0 END)
    ON CONFLICT(campaign_id, template_id) DO UPDATE SET
        tracked_sent_count = tracked_sent_count + excluded.tracked_sent_count,
        unique_open_count = unique_open_count + excluded.unique_open_count;
END;