import {SEND_CONCURRENCY} from './send-limits.mjs';
export const PREPARATION_CHUNK_SIZE=250;
const senderChunkSize=25,leaseMs=60000;
export class PreparationError extends Error{constructor(message,code='PREPARATION_FAILED'){super(message);this.code=code;}}
export async function preparationProgress(db,id){
 const row=await db.prepare(`SELECT c.id,c.status,c.planned_sends,c.pending_count,p.phase,p.total_count,p.prepared_count,p.total_senders,p.prepared_senders,p.error_code,p.lease_until FROM campaigns c LEFT JOIN campaign_preparations p ON p.campaign_id=c.id WHERE c.id=?`).bind(id).first();
 if(!row)return null;
 return {campaignId:id,status:row.status,phase:row.phase || (row.status==='Preparing'?'legacy':'complete'),total:Number(row.total_count ?? row.planned_sends),prepared:Number(row.prepared_count || 0),senders:Number(row.total_senders || 0),readySenders:Number(row.prepared_senders || 0),error:row.error_code || (row.status==='Preparing'&&!row.phase?'LEGACY_PREPARATION_REVIEW':null),busy:Boolean(row.lease_until && row.lease_until>new Date().toISOString())};
}
export async function createPreparation(db,{id,name,templateId,createdAt,remaining=0,days=1,summary,assignments,targetStatus='Sending'}){
 if(!Number.isFinite(Date.parse(createdAt)))throw new PreparationError('Campaign creation time is invalid.','PREPARATION_TIMESTAMP');
 const total=assignments.reduce((n,a)=>n+a.leadIds.length,0);
 if(!total || total>100000)throw new PreparationError('A campaign must contain between 1 and 100,000 planned deliveries.','PREPARATION_SIZE');
 const chunks=[];let rows=[];const unique=new Set();
 const flush=()=>{if(rows.length){chunks.push({kind:'deliveries',rows});rows=[];}};
 for(const a of assignments)for(const lead of a.leadIds){const pair=a.accountId+':'+lead;if(unique.has(pair))throw new PreparationError('A sender was assigned the same lead twice.','PREPARATION_DUPLICATE');unique.add(pair);rows.push([crypto.randomUUID(),id,a.batch,a.day,lead,a.accountId,a.templateId,createdAt]);if(rows.length===PREPARATION_CHUNK_SIZE)flush();}flush();
 const accounts=[...new Set(assignments.map(a=>a.accountId))].sort();
 for(let i=0;i<accounts.length;i+=senderChunkSize)chunks.push({kind:'senders',rows:accounts.slice(i,i+senderChunkSize).map((account,j)=>[account,(i+j)%SEND_CONCURRENCY])});
 const statements=[
  db.prepare(`INSERT INTO campaigns(id,name,template_id,status,created_at,remaining,days,allocation_json,planned_sends) VALUES(?,?,?,'Preparing',?,?,?,?,?)`).bind(id,name,templateId,createdAt,remaining,days,JSON.stringify(summary),total),
  db.prepare(`INSERT INTO campaign_preparations(campaign_id,target_status,total_count,total_senders,chunk_count,heartbeat_at) VALUES(?,?,?,?,?,?)`).bind(id,targetStatus,total,accounts.length,chunks.length,new Date().toISOString()),
  ...chunks.map((chunk,i)=>db.prepare('INSERT INTO campaign_preparation_chunks(campaign_id,chunk_no,kind,row_count,payload) VALUES(?,?,?,?,?)').bind(id,i,chunk.kind,chunk.rows.length,JSON.stringify(chunk.rows)))
 ];
 await db.batch(statements);
 return preparationProgress(db,id);
}
const owned=`EXISTS(SELECT 1 FROM campaign_preparations p JOIN campaigns c ON c.id=p.campaign_id WHERE p.campaign_id=? AND p.lease_token=? AND c.status='Preparing')`;
function queueChunkStatements(db,id,token,payload){
 const accountFilter=`account_id IN(SELECT json_extract(value,'$[0]') FROM json_each(?))`;
 return [
 db.prepare(`INSERT OR IGNORE INTO sender_ready(campaign_id,account_id,lane) SELECT ?,json_extract(value,'$[0]'),json_extract(value,'$[1]') FROM json_each(?) WHERE ${owned}`).bind(id,payload,id,token),
 db.prepare(`UPDATE sender_ready SET next_delivery_id=(SELECT d.id FROM campaign_deliveries d INDEXED BY idx_delivery_cached_queue WHERE d.campaign_id=sender_ready.campaign_id AND d.account_id=sender_ready.account_id AND d.status='queued' ORDER BY d.day_no,COALESCE(d.retry_after,''),d.batch_no,d.rowid LIMIT 1),last_used_at=(SELECT COALESCE(d.sent_at,d.started_at) FROM campaign_deliveries d INDEXED BY idx_delivery_campaign_sender_time WHERE d.campaign_id=sender_ready.campaign_id AND d.account_id=sender_ready.account_id AND d.status IN ('sending','sent','uncertain') ORDER BY COALESCE(d.sent_at,d.started_at) DESC LIMIT 1),busy=EXISTS(SELECT 1 FROM campaign_deliveries d WHERE d.account_id=sender_ready.account_id AND d.status='sending') WHERE campaign_id=? AND ${accountFilter} AND ${owned}`).bind(id,payload,id,token),
 db.prepare(`UPDATE sender_ready SET(enabled,ready_at)=(SELECT enabled,ready_at FROM sender_readiness v WHERE v.campaign_id=sender_ready.campaign_id AND v.account_id=sender_ready.account_id) WHERE campaign_id=? AND ${accountFilter} AND ${owned}`).bind(id,payload,id,token)
 ];
}
export async function continuePreparation(db,id,{maxChunks=2,now=new Date()}={}){
 const token=crypto.randomUUID(),nowIso=now.toISOString();
 const acquired=await db.prepare(`UPDATE campaign_preparations SET lease_token=?,lease_until=?,heartbeat_at=? WHERE campaign_id=? AND phase NOT IN ('complete','cancelled') AND (lease_until IS NULL OR lease_until<=?) AND EXISTS(SELECT 1 FROM campaigns WHERE id=? AND status='Preparing')`).bind(token,new Date(now.getTime()+leaseMs).toISOString(),nowIso,id,nowIso,id).run();
 if(!acquired.meta?.changes){const progress=await preparationProgress(db,id);if(progress?.phase==='legacy')throw new PreparationError('This earlier campaign has no resumable preparation snapshot. Review or cancel it before starting a replacement. Its history has been preserved.','LEGACY_PREPARATION_REVIEW');return {...progress,busy:progress?.status==='Preparing'};}
 try{
  for(let step=0;step<Math.min(16,maxChunks);step++){
   const chunk=await db.prepare('SELECT chunk_no,kind,row_count,payload FROM campaign_preparation_chunks WHERE campaign_id=? AND done=0 ORDER BY chunk_no LIMIT 1').bind(id).first();
   if(!chunk)break;
   const guardArgs=[id,token];
   const statements=chunk.kind==='deliveries'?[
    db.prepare(`INSERT OR IGNORE INTO campaign_deliveries(id,campaign_id,batch_no,day_no,lead_id,account_id,template_id,created_at) SELECT json_extract(value,'$[0]'),json_extract(value,'$[1]'),json_extract(value,'$[2]'),json_extract(value,'$[3]'),json_extract(value,'$[4]'),json_extract(value,'$[5]'),json_extract(value,'$[6]'),json_extract(value,'$[7]') FROM json_each(?) WHERE ${owned}`).bind(chunk.payload,...guardArgs)
   ]:queueChunkStatements(db,id,token,chunk.payload);
   statements.push(
    db.prepare(`UPDATE campaign_preparations SET prepared_count=prepared_count+?,prepared_senders=prepared_senders+?,phase=?,heartbeat_at=?,error_code=NULL,error_at=NULL,lease_until=? WHERE campaign_id=? AND lease_token=? AND ${owned} AND EXISTS(SELECT 1 FROM campaign_preparation_chunks WHERE campaign_id=? AND chunk_no=? AND done=0)`).bind(chunk.kind==='deliveries'?chunk.row_count:0,chunk.kind==='senders'?chunk.row_count:0,chunk.kind==='senders'?'senders':'deliveries',new Date().toISOString(),new Date(Date.now()+leaseMs).toISOString(),id,token,...guardArgs,id,chunk.chunk_no),
    db.prepare(`UPDATE campaign_preparation_chunks SET done=1 WHERE campaign_id=? AND chunk_no=? AND done=0 AND ${owned}`).bind(id,chunk.chunk_no,...guardArgs),
    db.prepare(`UPDATE campaigns SET pending_count=(SELECT prepared_count FROM campaign_preparations WHERE campaign_id=?) WHERE id=? AND ${owned}`).bind(id,id,...guardArgs)
   );
   const result=await db.batch(statements);
   if(!result.at(-2).meta?.changes)break;
  }
  const job=await db.prepare('SELECT total_count,prepared_count,total_senders,prepared_senders,target_status FROM campaign_preparations WHERE campaign_id=? AND lease_token=?').bind(id,token).first();
  if(job && job.total_count===job.prepared_count && job.total_senders===job.prepared_senders){
   const actual=await db.prepare('SELECT COUNT(*) AS count FROM campaign_deliveries WHERE campaign_id=?').bind(id).first();
   const ready=await db.prepare('SELECT COUNT(*) AS count FROM sender_ready WHERE campaign_id=?').bind(id).first();
   if(actual.count!==job.total_count || ready.count!==job.total_senders)throw new PreparationError('Preparation totals need review; no emails were dispatched.','PREPARATION_TOTAL_MISMATCH');
   await db.batch([
    db.prepare(`UPDATE campaigns SET status=?,next_send_at=? WHERE id=? AND status='Preparing' AND ${owned} AND NOT EXISTS(SELECT 1 FROM campaign_preparation_chunks WHERE campaign_id=? AND done=0)`).bind(job.target_status,new Date().toISOString(),id,id,token,id),
    db.prepare(`UPDATE campaign_preparations SET phase='complete',error_code=NULL,error_at=NULL WHERE campaign_id=? AND lease_token=? AND EXISTS(SELECT 1 FROM campaigns WHERE id=? AND status=?)`).bind(id,token,id,job.target_status)
   ]);
  }
 }catch(error){await db.prepare(`UPDATE campaign_preparations SET error_code=?,error_at=? WHERE campaign_id=? AND lease_token=?`).bind(error instanceof PreparationError?error.code:'PREPARATION_STEP_FAILED',new Date().toISOString(),id,token).run().catch(()=>{});if(error instanceof PreparationError)throw error;throw new PreparationError('Campaign preparation was interrupted. Saved progress is safe; resume preparation to retry.','PREPARATION_STEP_FAILED');}
 finally{await db.prepare('UPDATE campaign_preparations SET lease_token=NULL,lease_until=NULL WHERE campaign_id=? AND lease_token=?').bind(id,token).run().catch(()=>{});}
 return preparationProgress(db,id);
}
export async function continueNextPreparation(db){
 const next=await db.prepare(`SELECT p.campaign_id FROM campaign_preparations p JOIN campaigns c ON c.id=p.campaign_id WHERE c.status='Preparing' AND p.phase NOT IN ('complete','cancelled') AND (p.lease_until IS NULL OR p.lease_until<=?) ORDER BY p.heartbeat_at LIMIT 1`).bind(new Date().toISOString()).first();
 const ready=async()=>Boolean(await db.prepare("SELECT 1 FROM campaigns WHERE name='Direct send' AND status IN ('Sending','Scheduled') AND pending_count>0 AND (next_send_at IS NULL OR next_send_at<=?) LIMIT 1").bind(new Date().toISOString()).first());
 if(!next)return {preparing:false,dispatchReady:await ready()};
 const result=await continuePreparation(db,next.campaign_id,{maxChunks:16});
 return {preparing:result.status==='Preparing',dispatchReady:result.status!=='Preparing' && await ready(),preparation:result};
}
