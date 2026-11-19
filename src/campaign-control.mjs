export async function cancelCampaign(db,campaignId){
 const campaign=await db.prepare('SELECT id,status FROM campaigns WHERE id=?').bind(campaignId).first();
 if(!campaign)throw new Error('Campaign not found.');
 if(campaign.status==='Cancelled')return {cancelled:true};
 if(!['Sending','Scheduled','Paused','User paused','Dry run','Needs review'].includes(campaign.status))throw new Error('This campaign cannot be cancelled while it is preparing or after completion.');
 const now=new Date().toISOString();
 const results=await db.batch([
  db.prepare("UPDATE campaigns SET status='Cancelled',cancelled_at=?,cancelled_count=MAX(0,pending_count-in_flight_count),pending_count=in_flight_count,next_send_at=NULL WHERE id=? AND status IN ('Sending','Scheduled','Paused','User paused','Dry run','Needs review')").bind(now,campaignId),
  db.prepare("DELETE FROM campaign_deliveries WHERE campaign_id=? AND status='queued' AND EXISTS(SELECT 1 FROM campaigns WHERE id=? AND status='Cancelled')").bind(campaignId,campaignId),
  db.prepare("DELETE FROM sender_ready WHERE campaign_id=? AND EXISTS(SELECT 1 FROM campaigns WHERE id=? AND status='Cancelled')").bind(campaignId,campaignId)
 ]);
 if(!results[0].meta?.changes)throw new Error('The campaign changed while cancelling. Refresh and try again.');
 return {cancelled:true};
}
