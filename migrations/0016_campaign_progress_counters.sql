ALTER TABLE campaigns ADD COLUMN planned_sends INTEGER NOT NULL DEFAULT 0
  CHECK (planned_sends >= 0);
ALTER TABLE campaigns ADD COLUMN sent_count INTEGER NOT NULL DEFAULT 0
  CHECK (sent_count >= 0);
ALTER TABLE campaigns ADD COLUMN pending_count INTEGER NOT NULL DEFAULT 0
  CHECK (pending_count >= 0);
ALTER TABLE campaigns ADD COLUMN uncertain_count INTEGER NOT NULL DEFAULT 0
  CHECK (uncertain_count >= 0);
ALTER TABLE campaigns ADD COLUMN failed_count INTEGER NOT NULL DEFAULT 0
  CHECK (failed_count >= 0);
ALTER TABLE campaigns ADD COLUMN failure_codes TEXT NOT NULL DEFAULT '';

UPDATE campaigns SET
  planned_sends = COALESCE((
    SELECT COUNT(*) FROM campaign_deliveries d WHERE d.campaign_id = campaigns.id
  ), 0),
  sent_count = COALESCE((
    SELECT COUNT(*) FROM campaign_deliveries d
    WHERE d.campaign_id = campaigns.id AND d.status = 'sent'
  ), 0),
  pending_count = COALESCE((
    SELECT COUNT(*) FROM campaign_deliveries d
    WHERE d.campaign_id = campaigns.id AND d.status IN ('queued', 'sending')
  ), 0),
  uncertain_count = COALESCE((
    SELECT COUNT(*) FROM campaign_deliveries d
    WHERE d.campaign_id = campaigns.id AND d.status = 'uncertain'
  ), 0),
  failed_count = COALESCE((
    SELECT COUNT(*) FROM campaign_deliveries d
    WHERE d.campaign_id = campaigns.id AND d.status = 'failed'
  ), 0),
  failure_codes = COALESCE((
    SELECT GROUP_CONCAT(DISTINCT d.last_error) FROM campaign_deliveries d
    WHERE d.campaign_id = campaigns.id AND d.status = 'failed' AND d.last_error IS NOT NULL
  ), '');

CREATE TRIGGER campaign_delivery_status_progress
AFTER UPDATE OF status ON campaign_deliveries
WHEN NEW.status <> OLD.status
BEGIN
  UPDATE campaigns SET
    pending_count = MAX(0, pending_count
      + CASE WHEN NEW.status IN ('queued', 'sending') THEN 1 ELSE 0 END
      - CASE WHEN OLD.status IN ('queued', 'sending') THEN 1 ELSE 0 END),
    sent_count = MAX(0, sent_count
      + CASE WHEN NEW.status = 'sent' THEN 1 ELSE 0 END
      - CASE WHEN OLD.status = 'sent' THEN 1 ELSE 0 END),
    uncertain_count = MAX(0, uncertain_count
      + CASE WHEN NEW.status = 'uncertain' THEN 1 ELSE 0 END
      - CASE WHEN OLD.status = 'uncertain' THEN 1 ELSE 0 END),
    failed_count = MAX(0, failed_count
      + CASE WHEN NEW.status = 'failed' THEN 1 ELSE 0 END
      - CASE WHEN OLD.status = 'failed' THEN 1 ELSE 0 END),
    failure_codes = CASE
      WHEN NEW.status = 'failed' AND COALESCE(NEW.last_error, '') <> ''
        AND instr(',' || failure_codes || ',', ',' || NEW.last_error || ',') = 0
      THEN CASE WHEN failure_codes = '' THEN NEW.last_error ELSE failure_codes || ',' || NEW.last_error END
      ELSE failure_codes
    END
  WHERE id = NEW.campaign_id;
END;
