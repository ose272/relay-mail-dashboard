import {meteredD1,readUsageDay,usageBudgets} from './usage-budget.js';
import {prepareCustomerCampaign,dispatchCustomerDelivery,settleCampaign} from './customer-sending.js';
export async function customerSendTick({request,env,fetcher=fetch}){
 if(request.method!=='POST'||!env.BACKGROUND_CRON_SECRET||request.headers.get('Authorization')!=='Bearer '+env.BACKGROUND_CRON_SECRET)return Response.json({error:'Not authorized.'},{status:403});
 let meter;const day=new Date().toISOString().slice(0,10);
 try{
  const initial=await readUsageDay(env.DB,day),limits=usageBudgets(env);if(initial.rows_read>=limits.reads||initial.rows_written>=limits.writes)return Response.json({held:true},{status:503});
  meter=meteredD1(env.DB,initial,limits);const db=meter.db,now=new Date().toISOString();let limit=20;try{const body=await request.json();if(Number.isInteger(body.limit))limit=Math.max(1,Math.min(20,body.limit));}catch{};
  const stale=(await db.prepare("SELECT id,workspace_id,campaign_id FROM customer_outbox WHERE status='sending' AND started_at<? ORDER BY started_at LIMIT 50").bind(new Date(Date.now()-600000).toISOString()).all()).results;
  if(stale.length){await db.batch(stale.map(job=>db.prepare("UPDATE customer_outbox SET status='uncertain',last_error='Delivery result was not confirmed. Check Gmail Sent before any retry.' WHERE id=? AND workspace_id=? AND status='sending'").bind(job.id,job.workspace_id)));for(const job of stale)await settleCampaign(db,job.workspace_id,job.campaign_id);}
  const preparing=await db.prepare("SELECT id,workspace_id FROM customer_campaigns WHERE status='Preparing' AND (prepare_until IS NULL OR prepare_until<?) ORDER BY created_at LIMIT 1").bind(now).first();if(preparing)await prepareCustomerCampaign(db,preparing.workspace_id,preparing.id);
  const jobs=(await db.prepare("SELECT d.id,d.workspace_id,d.campaign_id,d.sender_hash FROM customer_outbox d WHERE d.status='queued' AND d.retry_after<=? AND (d.campaign_id IS NULL OR EXISTS(SELECT 1 FROM customer_campaigns c WHERE c.id=d.campaign_id AND c.workspace_id=d.workspace_id AND c.status IN('Sending','Scheduled'))) ORDER BY d.retry_after,d.created_at,d.id LIMIT 200").bind(now).all()).results;
  // One job per sender per tick avoids lease contention and preserves fair rotation.
  const unique=[...new Map(jobs.map(j=>[j.sender_hash,j])).values()].slice(0,limit);let cursor=0,sent=0,uncertain=0,failed=0,deferred=0;
  await Promise.all(Array.from({length:Math.min(20,unique.length)},async()=>{while(cursor<unique.length){const job=unique[cursor++];try{const result=await dispatchCustomerDelivery({env,db,id:job.id,workspaceId:job.workspace_id,fetcher});sent+=Number(!!result.sent);uncertain+=Number(!!result.reviewPending);failed+=Number(!!result.failed);deferred+=Number(!!result.deferred);}catch{deferred++;}}}));
  return Response.json({ok:true,sent,uncertain,failed,deferred,attempted:unique.length,hasMore:jobs.length>unique.length,preparing:!!preparing},{headers:{'Cache-Control':'no-store'}});
 }catch{return Response.json({error:'Customer send tick could not complete; unconfirmed messages are not retried.'},{status:503});}
 finally{if(meter)await meter.flush(day).catch(()=>{});}
}
