import { SEND_WINDOW_MS } from './send-window.mjs';
import {senderQueueStatements} from './ready-senders.mjs';
import {assignScoutingPlans} from './domain.mjs';
export function planRebalancedQueue(queued,accounts,blocked=[],startDay=1){
 const eligible=accounts.filter(a=>!a.paused && a.connection==='Connected' && a.credential_ciphertext && a.smtp_verified_at && Math.min(40,a.cap)>0);
 if(!eligible.length)throw new Error('No eligible sender accounts are available.');
 const seen=new Map(eligible.map(a=>[a.id,new Set()]));for(const row of blocked)seen.get(row.account_id)?.add(row.lead_id);
 let day=startDay,cursor=0;let capacity=new Map(eligible.map(a=>[a.id,Math.max(0,Math.min(40,a.cap)-Number(a.used || 0))]));const planned=[];
 for(const delivery of queued){let chosen=null;
  while(!chosen){for(let attempt=0;attempt<eligible.length;attempt++){const index=cursor++%eligible.length,a=eligible[index];if(capacity.get(a.id)>0 && !seen.get(a.id).has(delivery.lead_id)){chosen={account:a,index};break;}}
   if(chosen)break;
   if(!eligible.some(a=>!seen.get(a.id).has(delivery.lead_id)))throw new Error('The queued work cannot be redistributed without repeating a lead on the same account.');
   day++;capacity=new Map(eligible.map(a=>[a.id,Math.min(40,a.cap)]));
  }
  capacity.set(chosen.account.id,capacity.get(chosen.account.id)-1);seen.get(chosen.account.id).add(delivery.lead_id);
  planned.push({...delivery,account_id:chosen.account.id,batch_no:Math.floor(chosen.index/50)+1,day_no:day});
 }
 return planned;
}

export async function rebalanceCampaign(db,campaignId){
 const campaign=await db.prepare('SELECT id,status,created_at,in_flight_count,uncertain_count FROM campaigns WHERE id=?').bind(campaignId).first();
 if(!campaign || !['User paused','Paused','Dry run'].includes(campaign.status) || campaign.in_flight_count || campaign.uncertain_count)throw new Error('Pause the campaign and resolve unconfirmed sends before using newly connected accounts.');
 const cutoff=new Date(Date.now()-SEND_WINDOW_MS).toISOString();
 const [queuedResult,accountsResult,blockedResult,templatesResult]=await Promise.all([
  db.prepare(`SELECT d.id,d.account_id,d.lead_id,d.template_id,d.created_at,d.attempt_count,d.retry_after,d.last_error,l.name,l.email,l.store FROM campaign_deliveries d JOIN leads l ON l.id=d.lead_id WHERE d.campaign_id=? AND d.status='queued' ORDER BY d.day_no,d.batch_no,d.id`).bind(campaignId).all(),
  db.prepare(`WITH used AS(SELECT account_id,COUNT(*) AS amount FROM campaign_deliveries WHERE status IN ('sent','sending','uncertain') AND COALESCE(sent_at,started_at)>? GROUP BY account_id)
   SELECT a.id,a.paused,a.connection,MIN(40,a.cap,COALESCE(b.cap,40)) AS cap,a.credential_ciphertext IS NOT NULL AS credential_ciphertext,a.smtp_verified_at,COALESCE(used.amount,0) AS used FROM accounts a LEFT JOIN sender_budget b ON b.account_id=a.id LEFT JOIN used ON used.account_id=a.id ORDER BY a.created_at,a.email`).bind(cutoff).all(),
  db.prepare("SELECT account_id,lead_id,template_id,day_no,batch_no FROM campaign_deliveries WHERE campaign_id=? AND status<>'queued'").bind(campaignId).all(),
  db.prepare('SELECT id,name,subject,body FROM templates').all()
 ]);
 const queued=queuedResult.results || [],blocked=blockedResult.results || [];
 if(!queued.length)throw new Error('There are no queued emails to redistribute.');
 const day=Math.max(1,Math.floor((Date.now()-Date.parse(campaign.created_at))/SEND_WINDOW_MS)+1);
 const plan=planRebalancedQueue(queued,accountsResult.results || [],blocked,day);
 const priorPlan=new Map();for(const row of [...blocked,...queued])if(row.template_id && !priorPlan.has(row.account_id))priorPlan.set(row.account_id,row.template_id);
 const groups=new Map();for(const row of plan){if(!groups.has(row.account_id))groups.set(row.account_id,[]);groups.get(row.account_id).push(row.lead_id);}
 const leads=[...new Map(queued.map(row=>[row.lead_id,{id:row.lead_id,name:row.name,email:row.email,store:row.store}])).values()];
 const templateByAccount=new Map();
 for(const [accountId,leadIds] of groups){const templates=(templatesResult.results || []).filter(t=>!priorPlan.has(accountId) || t.id===priorPlan.get(accountId));const chosen=assignScoutingPlans([{accountId,leadIds:[...new Set(leadIds)]}],templates,leads);if(chosen.missingAccountId)throw new Error('A sender has no scouting plan compatible with its redistributed recipients.');templateByAccount.set(accountId,chosen.assignments[0].templateId);}
 const reserved=await db.prepare("UPDATE campaigns SET status='Preparing' WHERE id=? AND status=? AND in_flight_count=0 AND uncertain_count=0").bind(campaignId,campaign.status).run();
 if(!reserved.meta?.changes)throw new Error('The campaign changed while preparing. Pause it and try again.');
 try{
  const originals=new Map(queued.map(row=>[row.id,row]));
  const statements=[db.prepare("DELETE FROM campaign_deliveries WHERE campaign_id=? AND status='queued'").bind(campaignId)];
  for(let offset=0;offset<plan.length;offset+=150){const rows=plan.slice(offset,offset+150).map(row=>[row.id,campaignId,row.account_id,row.lead_id,row.batch_no,row.day_no,row.created_at,templateByAccount.get(row.account_id),originals.get(row.id).account_id===row.account_id?Number(row.attempt_count || 0):0,originals.get(row.id).account_id===row.account_id?row.retry_after:null,originals.get(row.id).account_id===row.account_id?row.last_error:null]);
   statements.push(db.prepare(`INSERT INTO campaign_deliveries(id,campaign_id,account_id,lead_id,batch_no,day_no,created_at,template_id,attempt_count,retry_after,last_error,status)
    SELECT json_extract(value,'$[0]'),json_extract(value,'$[1]'),json_extract(value,'$[2]'),json_extract(value,'$[3]'),json_extract(value,'$[4]'),json_extract(value,'$[5]'),json_extract(value,'$[6]'),json_extract(value,'$[7]'),json_extract(value,'$[8]'),json_extract(value,'$[9]'),json_extract(value,'$[10]'),'queued' FROM json_each(?)`).bind(JSON.stringify(rows)));
  }
  statements.push(...senderQueueStatements(db,campaignId));
  const summary=new Map();for(const row of [...blocked,...plan]){const key=row.account_id+':'+row.day_no;const item=summary.get(key)||{accountId:row.account_id,day:row.day_no,batch:row.batch_no,count:0};item.count++;summary.set(key,item);}
  statements.push(db.prepare("UPDATE campaigns SET status='User paused',pending_count=?,days=?,allocation_json=? WHERE id=? AND status='Preparing'").bind(plan.length,Math.max(...plan.map(r=>r.day_no)),JSON.stringify([...summary.values()]),campaignId));
  await db.batch(statements);
  return {queued:plan.length,accounts:groups.size,days:Math.max(...plan.map(r=>r.day_no)),status:'User paused'};
 }catch(error){await db.prepare("UPDATE campaigns SET status='User paused' WHERE id=? AND status='Preparing'").bind(campaignId).run().catch(()=>{});throw error;}
}
