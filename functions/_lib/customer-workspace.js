import {customerSession,readCustomerCookie} from './customer-auth.js';
import {deleteCustomerWorkspace} from './delete-customer-workspace.js';
import {customerGoogleOAuth} from './customer-google-oauth.js';
import {parseLeads} from '../../src/domain.mjs';
import {meteredD1,readUsageDay,usageBudgets} from './usage-budget.js';
import {digest} from './google-identity.js';
import {SEND_WINDOW_MS} from '../../src/send-window.mjs';
const json=(status,body)=>Response.json(body,{status,headers:{'Cache-Control':'no-store','Vary':'Cookie'}});
class WorkspaceError extends Error{constructor(status,message){super(message);this.status=status;}}
const required=(value,max=100)=>{if(typeof value!=='string'||!value.trim()||value.length>max)throw new WorkspaceError(400,'Check the required fields.');return value.trim();};
const optional=(value,max)=>{if(value===undefined)return '';if(typeof value!=='string'||value.length>max)throw new WorkspaceError(400,'A field is too long.');return value;};
async function state(db,user,url){
 const ws=user.workspace_id,settings=Object.fromEntries((await db.prepare('SELECT key,value FROM customer_workspace_settings WHERE workspace_id=?').bind(ws).all()).results.map(r=>[r.key,r.value]));
 const mailboxes=(await db.prepare("SELECT id,email,google_sub,status,checked_at,last_check_status,connected_at,cap,paused FROM customer_google_mailboxes WHERE workspace_id=? AND status<>'disconnected' ORDER BY connected_at DESC LIMIT 1000").bind(ws).all()).results;
 const cutoff=new Date(Date.now()-SEND_WINDOW_MS).toISOString();
 const usage=(await db.prepare("SELECT m.google_sub,COUNT(*) AS used FROM customer_test_deliveries d JOIN customer_google_mailboxes m ON m.id=d.mailbox_id WHERE d.workspace_id=? AND d.status IN('sending','sent','uncertain') AND d.started_at>? GROUP BY m.google_sub").bind(ws,cutoff).all()).results;
 const hashes=await Promise.all(mailboxes.map(r=>digest(r.email.toLowerCase()))),retainedUsage=new Map();
 for(let i=0;i<hashes.length;i+=80){const chunk=hashes.slice(i,i+80),rows=(await db.prepare('SELECT sender_hash,COUNT(*) AS total FROM customer_retained_send_usage WHERE sender_hash IN('+chunk.map(()=>'?').join(',')+') AND used_at>? GROUP BY sender_hash').bind(...chunk,cutoff).all()).results;for(const r of rows)retainedUsage.set(r.sender_hash,Number(r.total));}
 const accounts=mailboxes.map((row,i)=>({id:row.id,email:row.email,cap:row.cap,used:Number(usage.find(u=>u.google_sub===row.google_sub)?.used||0)+(retainedUsage.get(hashes[i])||0),paused:!!row.paused,connection:row.status==='connected'?'Connected':'Reconnect required',hasCredentials:row.status==='connected',healthStatus:row.last_check_status==='ok'?'Healthy':row.status==='reconnect_required'?'Needs attention':'Unknown',healthCheckedAt:row.checked_at,healthMessage:row.status==='reconnect_required'?'Reconnect this mailbox to restore access.':'',lastSyncAt:null}));

 const templates=(await db.prepare('SELECT id,name,subject,body,description,archived_at AS archivedAt FROM customer_plans WHERE workspace_id=? ORDER BY created_at DESC,id LIMIT 1000').bind(ws).all()).results;
 const cursor=url.searchParams.get('leadCursor');const leads=(await db.prepare('SELECT id,email,name,store,status FROM customer_leads WHERE workspace_id=? '+(cursor?'AND id>? ':'')+'ORDER BY id LIMIT 101').bind(ws,...(cursor?[cursor]:[])).all()).results;
 const count=await db.prepare('SELECT COUNT(*) AS active FROM customer_leads WHERE workspace_id=?').bind(ws).first();
 const batches=(await db.prepare('SELECT id,file_name AS fileName,created_at AS createdAt,imported_count AS importedCount,duplicate_count AS duplicateCount,invalid_count AS invalidCount,status,(SELECT COUNT(*) FROM customer_leads l WHERE l.workspace_id=b.workspace_id AND l.batch_id=b.id) AS leadCount FROM customer_lead_batches b WHERE workspace_id=? ORDER BY created_at DESC LIMIT 100').bind(ws).all()).results;
 return {customerWorkspace:true,capabilities:{campaignSending:false,inbox:false},workspaceName:user.workspace_name,profileName:user.display_name,cap:Number(settings.cap||40),includeSpamFolders:settings.includeSpamFolders==='true',openTracking:false,linkTracking:false,healthNotificationEmail:settings.healthNotificationEmail||'',accounts,templates,campaigns:[],threads:[],healthEvents:[],leadImportBatches:batches,leads:leads.slice(0,100),leadCounts:{active:count.active,archived:0},leadPage:{hasMore:leads.length>100,nextCursor:leads.length>100?leads[99].id:null}};
}
async function importLeads(db,user,body,flush){
 const text=optional(body.text,2000000),name=required(body.fileName,200),parsed=parseLeads(text);
 if(parsed.leads.length>20000)throw new WorkspaceError(400,'Import at most 20,000 leads per file.');
 const id=crypto.randomUUID(),ws=user.workspace_id,stamp=new Date().toISOString();
 await db.prepare('INSERT INTO customer_lead_batches(id,workspace_id,file_name,created_at,duplicate_count,invalid_count) VALUES(?,?,?,?,?,?)').bind(id,ws,name,stamp,parsed.duplicates,parsed.invalid).run();
 const encoder=new TextEncoder();
 const stream=new ReadableStream({async start(controller){
  const emit=e=>controller.enqueue(encoder.encode(JSON.stringify(e)+'\n'));let imported=0;
  try{
   emit({phase:'importing',completed:0,total:parsed.leads.length});
   for(let i=0;i<parsed.leads.length;i+=50){const chunk=parsed.leads.slice(i,i+50);const results=await db.batch(chunk.map(l=>db.prepare('INSERT INTO customer_leads(id,workspace_id,batch_id,email,name,store,created_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(workspace_id,email) DO NOTHING').bind(l.id,ws,id,l.email,l.name.slice(0,200),l.store.slice(0,500),stamp)));imported+=results.reduce((n,r)=>n+Number(r.meta?.changes||0),0);emit({phase:'importing',completed:Math.min(i+50,parsed.leads.length),total:parsed.leads.length});}
   const duplicates=parsed.duplicates+parsed.leads.length-imported;
   await db.prepare("UPDATE customer_lead_batches SET status='complete',imported_count=?,duplicate_count=? WHERE id=? AND workspace_id=?").bind(imported,duplicates,id,ws).run();
   emit({phase:'complete',completed:parsed.leads.length,total:parsed.leads.length,result:{batchId:id,imported,duplicates,invalid:parsed.invalid}});
  }catch{await db.prepare("UPDATE customer_lead_batches SET status='failed',imported_count=? WHERE id=? AND workspace_id=?").bind(imported,id,ws).run().catch(()=>{});emit({phase:'error',completed:imported,total:parsed.leads.length,error:'Import interrupted. The saved batch remains visible; refresh before retrying.'});}finally{await flush();try{controller.close();}catch{}}
 }});
 return new Response(stream,{headers:{'Content-Type':'application/x-ndjson','Cache-Control':'no-store'}});
}
export async function customerWorkspace({request,env,fetcher=fetch}){
 let meter,streaming=false;const day=new Date().toISOString().slice(0,10);
 try{
  if(!env.DB)return json(503,{error:'Workspace unavailable.'});
  const url=new URL(request.url),path=url.pathname.slice('/api/'.length),write=request.method==='POST';
  if(!['GET','POST'].includes(request.method))throw new WorkspaceError(405,'Method not allowed.');
  if(write&&(request.headers.get('Origin')!==url.origin||!request.headers.get('Content-Type')?.startsWith('application/json')))throw new WorkspaceError(403,'Same-origin JSON required.');
  const user=await customerSession(env.DB,request);if(!user)return json(401,{error:'Please sign in.'});
  const initial=await readUsageDay(env.DB,day),budgets=usageBudgets(env);if(initial.rows_read>=budgets.reads||write&&initial.rows_written>=budgets.writes)return json(503,{error:'Application safety budget reached. Retry after reset.'});
  meter=meteredD1(env.DB,initial,budgets);const db=meter.db,ws=user.workspace_id;
  let body={};if(write){const raw=await request.text();if(raw.length>2100000)throw new WorkspaceError(413,'Request too large.');try{body=JSON.parse(raw);}catch{throw new WorkspaceError(400,'Invalid request.');}if(!body||typeof body!=='object'||Array.isArray(body))throw new WorkspaceError(400,'Invalid request.');}
  if(path==='state'&&!write)return json(200,await state(db,user,url));
  if(path==='account/delete'&&write){
   if(body.confirmation!=='DELETE')throw new WorkspaceError(400,'Type DELETE to confirm account deletion.');
   const session=await db.prepare('SELECT created_at FROM auth_sessions WHERE token_hash=? AND user_id=?').bind(await digest(readCustomerCookie(request)),user.id).first();
   if(!session||Date.parse(session.created_at)<Date.now()-900000)throw new WorkspaceError(409,'Sign out and sign in again before deleting your account.');
   if(await db.prepare("SELECT 1 AS busy FROM customer_test_deliveries WHERE workspace_id=? AND status='sending' LIMIT 1").bind(ws).first())throw new WorkspaceError(409,'An email is still in flight. Wait for its result before deleting your account.');
   const rows=(await db.prepare("SELECT id FROM customer_google_mailboxes WHERE workspace_id=? AND status<>'disconnected' LIMIT 1001").bind(ws).all()).results;
   if(rows.length>1000)throw new WorkspaceError(409,'Contact support to delete this large workspace.');
   // Revoke in bounded groups; token values never leave the OAuth handler.
   for(let i=0;i<rows.length;i+=10)await Promise.all(rows.slice(i,i+10).map(async row=>{const r=await customerGoogleOAuth({env,fetcher,request:new Request(url.origin+'/api/oauth/google/disconnect',{method:'POST',headers:request.headers,body:JSON.stringify({mailboxId:row.id})})});if(!r.ok)throw new WorkspaceError(503,'A Google connection could not be removed. Retry deletion shortly.');}));
   await deleteCustomerWorkspace(db,user);
   return new Response(JSON.stringify({ok:true}),{headers:{'Content-Type':'application/json','Cache-Control':'no-store','Set-Cookie':'relay_customer=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0'}});
  }
  if(path==='workspace/activity'&&!write){const days=Array.from({length:14},(_,i)=>({day:new Date(Date.now()+(i-13)*86400000+3600000).toISOString().slice(0,10),sent:0,replies:0}));const sent=(await db.prepare("SELECT substr(datetime(sent_at,'+1 hour'),1,10) AS day,COUNT(*) AS total FROM customer_test_deliveries WHERE workspace_id=? AND status='sent' AND sent_at>? GROUP BY 1").bind(ws,new Date(Date.now()-14*86400000).toISOString()).all()).results;for(const d of days)d.sent=Number(sent.find(s=>s.day===d.day)?.total||0);return json(200,{generatedAt:new Date().toISOString(),timezone:'Africa/Lagos',days,today:days.at(-1)});}
  if(path==='sending/status'&&!write)return json(200,{runs:[],deliveries:[]});
  if(path==='notifications'&&!write)return json(200,{events:[],nextCursor:null});
  if(path==='analytics'&&!write)return json(200,{plans:[],totals:{sent:0,opens:0,clicks:0,replies:0},trackingAvailable:false});
  if(path==='usage'&&!write)return json(403,{error:'Infrastructure usage is private to the service owner.'});
  if(path==='import/progress'&&write){const response=await importLeads(db,user,body,()=>meter.flush(day).catch(()=>{}));streaming=true;return response;}
  if(['template','template/update','template/status','template/delete'].includes(path)&&write){
   const id=path==='template'?crypto.randomUUID():required(body.id),prior=path==='template'?null:await db.prepare('SELECT id FROM customer_plans WHERE id=? AND workspace_id=?').bind(id,ws).first();if(path!=='template'&&!prior)throw new WorkspaceError(404,'Plan not found.');
   if(path==='template/status')await db.prepare('UPDATE customer_plans SET archived_at=? WHERE id=? AND workspace_id=?').bind(body.paused?new Date().toISOString():null,id,ws).run();
   else if(path==='template/delete')await db.prepare('DELETE FROM customer_plans WHERE id=? AND workspace_id=?').bind(id,ws).run();
   else{const fields=[required(body.name,200),optional(body.subject,200),required(body.body,20000),optional(body.description,500)];if(prior)await db.prepare('UPDATE customer_plans SET name=?,subject=?,body=?,description=? WHERE id=? AND workspace_id=?').bind(...fields,id,ws).run();else await db.prepare('INSERT INTO customer_plans(id,workspace_id,name,subject,body,description,created_at) VALUES(?,?,?,?,?,?,?)').bind(id,ws,...fields,new Date().toISOString()).run();}
   return json(200,{ok:true,id});
  }
  if(path==='import/batch/delete'&&write){const id=required(body.batchId);const prior=await db.prepare('SELECT id FROM customer_lead_batches WHERE id=? AND workspace_id=?').bind(id,ws).first();if(!prior)throw new WorkspaceError(404,'Batch not found.');await db.batch([db.prepare('DELETE FROM customer_leads WHERE batch_id=? AND workspace_id=?').bind(id,ws),db.prepare('DELETE FROM customer_lead_batches WHERE id=? AND workspace_id=?').bind(id,ws)]);return json(200,{ok:true});}
  if(['settings','settings/features'].includes(path)&&write){
   if(body.openTracking||body.linkTracking)throw new WorkspaceError(409,'Tracking will be available when customer campaign sending is enabled.');
   const changes=[];
   if(body.workspaceName!==undefined)changes.push(db.prepare('UPDATE auth_workspaces SET name=? WHERE id=? AND owner_user_id=?').bind(required(body.workspaceName),ws,user.id));
   if(body.profileName!==undefined)changes.push(db.prepare('UPDATE auth_users SET display_name=? WHERE id=?').bind(required(body.profileName),user.id));
   for(const key of ['cap','includeSpamFolders','healthNotificationEmail'])if(body[key]!==undefined){if(key==='cap'&&(!Number.isInteger(body[key])||body[key]<1||body[key]>40))throw new WorkspaceError(400,'Cap must be between 1 and 40.');if(key==='includeSpamFolders'&&typeof body[key]!=='boolean')throw new WorkspaceError(400,'Invalid preference.');if(key==='healthNotificationEmail')optional(body[key],254);changes.push(db.prepare('INSERT INTO customer_workspace_settings(workspace_id,key,value) VALUES(?,?,?) ON CONFLICT(workspace_id,key) DO UPDATE SET value=excluded.value').bind(ws,key,String(body[key])));}
   if(changes.length)await db.batch(changes);return json(200,{ok:true});
  }
  if(path==='account/health/check'&&write||path==='account/disconnect'&&write){const action=path.endsWith('disconnect')?'disconnect':'check';return customerGoogleOAuth({env,fetcher,request:new Request(url.origin+'/api/oauth/google/'+action,{method:'POST',headers:request.headers,body:JSON.stringify({mailboxId:body.accountId||body.id})})});}
  if(['account/cap','account/pause','account'].includes(path)&&write){const id=required(body.id);if(path==='account/cap'&&(!Number.isInteger(body.cap)||body.cap<1||body.cap>40))throw new WorkspaceError(400,'Cap must be between 1 and 40.');if(path!=='account/cap'&&typeof body.paused!=='boolean')throw new WorkspaceError(400,'Invalid pause preference.');const r=await db.prepare('UPDATE customer_google_mailboxes SET '+(path==='account/cap'?'cap':'paused')+'=? WHERE id=? AND workspace_id=?').bind(path==='account/cap'?body.cap:Number(body.paused),id,ws).run();if(!r.meta?.changes)throw new WorkspaceError(404,'Mailbox not found.');return json(200,{ok:true});}
  if(['sending/start','campaign/prepare','campaign/resume-pending','mail/sync','reply'].includes(path))throw new WorkspaceError(409,'Customer campaign sending and inbox sync are not enabled yet. No email was sent.');
  return json(404,{error:'Not found in your workspace.'});
 }catch(e){return json(e instanceof WorkspaceError?e.status:503,{error:e instanceof WorkspaceError?e.message:'Workspace request could not complete. Retry shortly.'});}
 finally{if(meter&&!streaming)await meter.flush(day).catch(()=>{});}
}
