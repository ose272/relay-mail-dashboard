ALTER TABLE campaigns ADD COLUMN capacity_next_check_at TEXT;
ALTER TABLE campaigns ADD COLUMN wait_reason TEXT NOT NULL DEFAULT '';
-- A rolling quota can stay full while its earliest release moves forward.
-- Refresh readiness on that change too, otherwise claims spin against an old expiry.
DROP TRIGGER sender_budget_ready_change;
CREATE TRIGGER sender_budget_ready_change AFTER UPDATE ON sender_budget
WHEN NEW.cap<>OLD.cap OR NEW.used_count<OLD.used_count OR NEW.expires_at IS NOT OLD.expires_at BEGIN
 UPDATE sender_ready SET(enabled,ready_at)=(SELECT enabled,ready_at FROM sender_readiness v
 WHERE v.campaign_id=sender_ready.campaign_id AND v.account_id=sender_ready.account_id)
 WHERE account_id=NEW.account_id;
END;
UPDATE sender_ready SET(enabled,ready_at)=(SELECT enabled,ready_at FROM sender_readiness v
 WHERE v.campaign_id=sender_ready.campaign_id AND v.account_id=sender_ready.account_id)
 WHERE (enabled,ready_at) IS NOT (SELECT enabled,ready_at FROM sender_readiness v
 WHERE v.campaign_id=sender_ready.campaign_id AND v.account_id=sender_ready.account_id);
UPDATE campaigns SET capacity_next_check_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
 WHERE status IN('Sending','Scheduled') AND pending_count>0 AND in_flight_count=0;
