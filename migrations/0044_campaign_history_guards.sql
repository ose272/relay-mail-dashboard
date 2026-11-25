-- Terminal campaign states must never hide outstanding deliveries.
CREATE TRIGGER campaign_terminal_work_guard BEFORE UPDATE OF status ON campaigns
WHEN NEW.status IN ('Complete','Superseded') AND (
 NEW.pending_count>0 OR NEW.in_flight_count>0 OR EXISTS(
  SELECT 1 FROM campaign_deliveries d WHERE d.campaign_id=OLD.id AND d.status IN ('queued','sending')
 )) BEGIN
 SELECT RAISE(ABORT,'Campaign still has pending deliveries; finish or explicitly cancel it.');
END;

-- Campaign deletion cascades to delivery records. Retain these records so past
-- sends and uncertain attempts continue to reserve rolling sender capacity.
CREATE TRIGGER campaign_delete_history_guard BEFORE DELETE ON campaigns
WHEN OLD.pending_count>0 OR OLD.in_flight_count>0 OR EXISTS(
 SELECT 1 FROM campaign_deliveries d WHERE d.campaign_id=OLD.id
) BEGIN
 SELECT RAISE(ABORT,'Campaign delivery history must be retained; explicitly cancel pending work.');
END;

CREATE TRIGGER delivery_delete_history_guard BEFORE DELETE ON campaign_deliveries
WHEN OLD.status IN ('sent','sending','uncertain') BEGIN
 SELECT RAISE(ABORT,'Accepted or unconfirmed delivery history must be retained.');
END;

-- Explicit cancellation may remove queued work, with its count retained on
-- the campaign. Preparing permits the existing atomic queue-rebalance batch.
CREATE TRIGGER delivery_delete_queue_guard BEFORE DELETE ON campaign_deliveries
WHEN OLD.status='queued' AND NOT EXISTS(
 SELECT 1 FROM campaigns c WHERE c.id=OLD.campaign_id AND (
  (c.status='Cancelled' AND c.cancelled_at IS NOT NULL) OR c.status='Preparing'
 )) BEGIN
 SELECT RAISE(ABORT,'Queued delivery requires explicit campaign cancellation.');
END;
