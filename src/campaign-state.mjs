export const finishAttemptSql=`UPDATE campaigns SET status=CASE WHEN pending_count=0 AND in_flight_count=0 THEN CASE WHEN uncertain_count>0 THEN 'Needs review' ELSE 'Complete' END ELSE 'Sending' END,next_send_at=CASE WHEN pending_count=0 THEN NULL ELSE ? END WHERE id=? AND status IN ('Sending','Scheduled','Dry run','Paused') AND (status<>'Sending' OR (pending_count=0 AND in_flight_count=0))`;
export async function reviewDeliveries(db,{campaignId,deliveryId,action}){
 if(!['retry','dismiss'].includes(action))throw new Error('Choose retry or dismiss.');
 const campaign=await db.prepare('SELECT status FROM campaigns WHERE id=?').bind(campaignId).first();
 if(!campaign)throw new Error('Campaign not found.');
 if(action==='retry' && ['Cancelled','Preparing','Complete','Superseded'].includes(campaign.status))throw new Error('This campaign cannot retry rejected messages in its current state.');
 const filter=deliveryId?' AND id=?':'',args=deliveryId?[campaignId,deliveryId]:[campaignId];
 const sql=action==='retry'?`UPDATE campaign_deliveries SET status='queued',retry_after=NULL,last_error=NULL,review_dismissed_at=NULL WHERE campaign_id=? AND status='failed'${filter}`:`UPDATE campaign_deliveries SET review_dismissed_at=? WHERE campaign_id=? AND (status='failed' OR EXISTS(SELECT 1 FROM delivery_bounces b WHERE b.delivery_id=campaign_deliveries.id))${filter}`;
 const result=await db.prepare(sql).bind(...(action==='dismiss'?[new Date().toISOString(),...args]:args)).run();
 if(!result.meta?.changes && deliveryId)throw new Error('This record is not eligible. Unconfirmed sends require explicit Sent-folder review; accepted bounces cannot be retried here.');
 return {changed:Number(result.meta?.changes || 0)};
}
