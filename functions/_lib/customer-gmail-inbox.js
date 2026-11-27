import {decryptCredential} from './credentials.js';
import {refreshAccess} from './customer-google-oauth.js';
import {providerJson} from './google-identity.js';
export class MailError extends Error{constructor(status,message){super(message);this.status=status;}}
const modify='https://www.googleapis.com/auth/gmail.modify';
const providerId=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{1,200}$/.test(value);
export async function mailboxAccess(env,db,workspaceId,mailboxId,fetcher=fetch,needsModify=false){
 const row=await db.prepare("SELECT * FROM customer_google_mailboxes WHERE id=? AND workspace_id=? AND status='connected'").bind(mailboxId,workspaceId).first();
 if(!row)throw new MailError(404,'Connected mailbox not found.');
 const scopes=row.granted_scopes.split(/\s+/);
 if(needsModify&&!scopes.includes(modify))throw new MailError(409,'Reconnect this mailbox and grant Gmail modification permission first.');
 if(!scopes.includes(modify)&&!scopes.includes('https://www.googleapis.com/auth/gmail.readonly'))throw new MailError(409,'Reconnect this mailbox to grant Gmail read access.');
 let access=Date.parse(row.access_expires_at)>Date.now()+60000?await decryptCredential('google-mailbox:'+row.workspace_id+':'+row.google_sub,row.access_ciphertext,env.GOOGLE_OAUTH_ENCRYPTION_KEY):await refreshAccess(env,db,row,fetcher);
 const call=async(path,init={})=>{
  if(!path.startsWith('threads')&&!path.startsWith('profile')&&path!=='messages/send')throw new MailError(400,'Unsupported Gmail operation.');
  const perform=()=>providerJson(fetcher,'https://gmail.googleapis.com/gmail/v1/users/me/'+path,{...init,headers:{...(init.headers||{}),Authorization:'Bearer '+access}});
  // A read may refresh once. Mutations never automatically repeat after dispatch.
  try{return await perform();}catch(e){if((init.method||'GET')==='GET'&&e.status===401){access=await refreshAccess(env,db,row,fetcher);return perform();}throw e;}
 };
 return {row,call};
}
function header(message,key){return message.payload?.headers?.find(h=>h.name?.toLowerCase()===key)?.value||'';}
function address(value){const match=value.match(/<([^<>]+)>/);const email=(match?match[1]:value).trim().toLowerCase();return /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email)?email:'';}
function decoded(data){if(typeof data!=='string'||data.length>1500000)return '';try{return new TextDecoder().decode(Uint8Array.from(atob(data.replaceAll('-','+').replaceAll('_','/')),c=>c.charCodeAt(0)));}catch{return '';}}
function bodyText(payload){
 if(!payload)return '';if(payload.mimeType==='text/plain')return decoded(payload.body?.data);
 const plain=(payload.parts||[]).map(bodyText).filter(Boolean).join('\n');if(plain)return plain;
 if(payload.mimeType==='text/html')return decoded(payload.body?.data).replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi,'').replace(/<br\s*\/?>|<\/(?:p|div)>/gi,'\n').replace(/<[^>]*>/g,'').replaceAll('&nbsp;',' ').replaceAll('&lt;','<').replaceAll('&gt;','>').replaceAll('&amp;','&');return '';
}
export function normalizeGmailThread(thread,mailboxEmail){
 if(!providerId(thread.id)||!Array.isArray(thread.messages))throw new MailError(502,'Gmail returned an invalid conversation.');
 const messages=thread.messages.filter(m=>providerId(m.id)&&!m.labelIds?.includes('DRAFT')).map(m=>{const from=address(header(m,'from')),time=Number(m.internalDate);return {providerId:m.id,senderEmail:from,direction:from===mailboxEmail?'out':'in',body:bodyText(m.payload).slice(0,100000),time:Number.isFinite(time)?new Date(time).toISOString():null,messageId:header(m,'message-id').replace(/[\r\n]/g,'').slice(0,500),subject:header(m,'subject').slice(0,500),unread:!!m.labelIds?.includes('UNREAD'),inbox:!!m.labelIds?.includes('INBOX'),trashed:!!m.labelIds?.includes('TRASH'),starred:!!m.labelIds?.includes('STARRED')};}).filter(m=>m.senderEmail&&m.time).sort((a,b)=>a.time.localeCompare(b.time));
 const incoming=messages.filter(m=>m.direction==='in'),latest=incoming.at(-1);if(!latest)return null;
 const last=messages.at(-1);return {providerId:thread.id,email:latest.senderEmail,name:latest.senderEmail,subject:messages.find(m=>m.subject)?.subject||'',inboundAt:latest.time,unread:latest.unread&&!(last.direction==='out'&&last.time>=latest.time),archived:!messages.some(m=>m.inbox),trashed:messages.every(m=>m.trashed),starred:messages.some(m=>m.starred),messages};
}
export async function storeGmailThread(db,workspaceId,mailboxId,thread,mailboxEmail){
 // Reconcile exact Message-IDs even in Sent-only threads, which have no incoming
 // reply and therefore are intentionally absent from the reply inbox.
 for(const message of thread.messages||[]){
  const match=header(message,'message-id').match(/^<([a-f0-9-]{36})@sendar\.com\.de>$/),time=Number(message.internalDate);
  if(match&&message.labelIds?.includes('SENT')&&address(header(message,'from'))===mailboxEmail&&Number.isFinite(time)){
   await db.prepare("UPDATE customer_outbox SET status='sent',sent_at=?,provider_message_id=?,provider_thread_id=?,last_error=NULL WHERE id=? AND workspace_id=? AND mailbox_id=? AND recipient=? AND status='uncertain' AND started_at<=?").bind(new Date(time).toISOString(),message.id,thread.id,match[1],workspaceId,mailboxId,address(header(message,'to')),new Date(time+120000).toISOString()).run();
  }
 }
 await db.prepare("UPDATE customer_campaigns SET status='Complete',next_send_at=NULL WHERE workspace_id=? AND status='Needs review' AND prepared_count>=planned_sends AND pending_count=0 AND in_flight=0 AND uncertain_count=0").bind(workspaceId).run();
 const data=normalizeGmailThread(thread,mailboxEmail);if(!data)return null;
 let prior=await db.prepare('SELECT id FROM customer_mail_threads WHERE mailbox_id=? AND provider_id=? AND workspace_id=?').bind(mailboxId,data.providerId,workspaceId).first();const id=prior?.id||crypto.randomUUID(),now=new Date().toISOString();
 await db.batch([
  db.prepare('INSERT INTO customer_mail_threads(id,workspace_id,mailbox_id,provider_id,email,name,subject,unread,archived,trashed,starred,inbound_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(mailbox_id,provider_id) DO UPDATE SET email=excluded.email,name=excluded.name,subject=excluded.subject,unread=excluded.unread,archived=excluded.archived,trashed=excluded.trashed,starred=excluded.starred,inbound_at=excluded.inbound_at,updated_at=excluded.updated_at').bind(id,workspaceId,mailboxId,data.providerId,data.email,data.name,data.subject,Number(data.unread),Number(data.archived),Number(data.trashed),Number(data.starred),data.inboundAt,now)
 ]);
 // The mailbox sync lease serializes imports for this mailbox.
 if(!prior)prior=await db.prepare('SELECT id FROM customer_mail_threads WHERE mailbox_id=? AND provider_id=? AND workspace_id=?').bind(mailboxId,data.providerId,workspaceId).first();const savedId=prior?.id||id;
 for(let i=0;i<data.messages.length;i+=50)await db.batch(data.messages.slice(i,i+50).map(m=>db.prepare('INSERT INTO customer_mail_messages(id,workspace_id,thread_id,provider_id,sender_email,direction,body,sent_at,message_id) VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(thread_id,provider_id) DO UPDATE SET body=excluded.body').bind(crypto.randomUUID(),workspaceId,savedId,m.providerId,m.senderEmail,m.direction,m.body,m.time,m.messageId)));
 return savedId;
}
export async function customerThreads(db,workspaceId,id){
 const rows=(await db.prepare('SELECT t.id,t.mailbox_id AS accountId,t.email,t.name,t.subject,t.unread,t.archived,t.starred,t.tag,t.inbound_at AS inboundAt,m.id AS preview_id,m.sender_email AS preview_sender,m.direction AS preview_direction,m.body AS preview_body,m.sent_at AS preview_time FROM customer_mail_threads t LEFT JOIN customer_mail_messages m ON m.id=(SELECT last.id FROM customer_mail_messages last WHERE last.workspace_id=t.workspace_id AND last.thread_id=t.id ORDER BY last.sent_at DESC,last.id DESC LIMIT 1) WHERE t.workspace_id=? AND t.trashed=0 '+(id?'AND t.id=? ':'AND t.inbound_at>? ')+'ORDER BY t.inbound_at DESC,t.id LIMIT 100').bind(workspaceId,id||new Date(Date.now()-86400000).toISOString()).all()).results;
 for(const row of rows){row.messages=row.preview_id?[{id:row.preview_id,senderEmail:row.preview_sender,direction:row.preview_direction,body:row.preview_body,time:row.preview_time}]:[];for(const k of Object.keys(row))if(k.startsWith('preview_'))delete row[k];}
 if(id&&rows[0])rows[0].messages=(await db.prepare('SELECT id,sender_email AS senderEmail,direction,body,sent_at AS time FROM customer_mail_messages WHERE workspace_id=? AND thread_id=? ORDER BY sent_at DESC,id DESC LIMIT 200').bind(workspaceId,id).all()).results.reverse();
 if(id&&rows[0]){
  const pending=(await db.prepare("SELECT id,body,status AS sendState,created_at AS time FROM customer_outbox WHERE workspace_id=? AND thread_id=? AND status IN('queued','sending','uncertain','failed') ORDER BY created_at DESC LIMIT 5").bind(workspaceId,id).all()).results;
  for(const p of pending)rows[0].messages.push({...p,direction:'out'});
 }
 return rows;
}
export async function syncCustomerMailbox({env,db,user,body,fetcher=fetch}){
 if(body.manual!==true)throw new MailError(400,'Mailbox sync must be explicitly triggered.');
 const mailboxId=body.accountId;if(typeof mailboxId!=='string'||mailboxId.length>100)throw new MailError(400,'Choose a connected mailbox.');
 const owned=await db.prepare("SELECT id FROM customer_google_mailboxes WHERE id=? AND workspace_id=? AND status='connected'").bind(mailboxId,user.workspace_id).first();if(!owned)throw new MailError(404,'Connected mailbox not found.');
 const lease=crypto.randomUUID(),now=new Date().toISOString();
 const claim=await db.prepare("UPDATE customer_google_mailboxes SET sync_lease=?,sync_lease_until=? WHERE id=? AND workspace_id=? AND (sync_lease_until IS NULL OR sync_lease_until<?)").bind(lease,new Date(Date.now()+300000).toISOString(),mailboxId,user.workspace_id,now).run();if(!claim.meta?.changes)return {busy:true};
 try{
  const {row,call}=await mailboxAccess(env,db,user.workspace_id,mailboxId,fetcher),settings=await db.prepare("SELECT value FROM customer_workspace_settings WHERE workspace_id=? AND key='includeSpamFolders'").bind(user.workspace_id).first(),spam=settings?.value==='true';
  const query='newer_than:2d -in:trash'+(spam?'':' -in:spam')+(body.includeSent===false?' -in:sent':'');
  const url=new URLSearchParams({maxResults:'20',q:query,includeSpamTrash:String(spam)});if(row.sync_query===query&&row.sync_cursor)url.set('pageToken',row.sync_cursor);
  const listed=await call('threads?'+url);if(!Array.isArray(listed.threads)&&listed.threads!==undefined)throw new MailError(502,'Gmail returned an invalid mailbox list.');
  let count=0;for(const thread of listed.threads||[]){if(!providerId(thread.id))continue;const full=await call('threads/'+encodeURIComponent(thread.id)+'?format=full');if(await storeGmailThread(db,user.workspace_id,row.id,full,row.email))count++;}
  await db.prepare('UPDATE customer_google_mailboxes SET last_sync_at=?,sync_cursor=?,sync_query=? WHERE id=? AND workspace_id=? AND sync_lease=?').bind(now,typeof listed.nextPageToken==='string'?listed.nextPageToken:null,query,row.id,user.workspace_id,lease).run();
  return {ok:true,synced:count,bounces:0,hasMore:!!listed.nextPageToken,message:listed.nextPageToken?'More conversations are available. Sync again to continue.':'Recent conversations synced.'};
 }finally{await db.prepare('UPDATE customer_google_mailboxes SET sync_lease=NULL,sync_lease_until=NULL WHERE id=? AND workspace_id=? AND sync_lease=?').bind(mailboxId,user.workspace_id,lease).run();}
}
export async function updateCustomerThread({env,db,user,body,fetcher=fetch}){
 const thread=await db.prepare('SELECT id,mailbox_id,provider_id,trashed FROM customer_mail_threads WHERE id=? AND workspace_id=?').bind(body.id||'',user.workspace_id).first();if(!thread)throw new MailError(404,'Conversation not found.');
 if(body.tag!==undefined){if(!['Question','Interested','Follow up','Not now'].includes(body.tag))throw new MailError(400,'Invalid tag.');await db.prepare('UPDATE customer_mail_threads SET tag=? WHERE id=? AND workspace_id=?').bind(body.tag,thread.id,user.workspace_id).run();return {ok:true};}
 if(body.trashed!==undefined&&(body.trashed!==true||body.confirmation!=='TRASH'))throw new MailError(400,'Confirm moving this entire conversation to Gmail Trash.');
 if(body.unread!==undefined&&typeof body.unread!=='boolean'||body.archived!==undefined&&typeof body.archived!=='boolean')throw new MailError(400,'Invalid conversation change.');
 const trash=body.trashed===true;if(!trash&&body.unread===undefined&&body.archived===undefined)throw new MailError(400,'Choose a conversation action.');
 if(trash&&thread.trashed)return {ok:true,alreadyTrashed:true};
 const {call}=await mailboxAccess(env,db,user.workspace_id,thread.mailbox_id,fetcher,true);
 const actionId=crypto.randomUUID();await db.prepare("INSERT INTO customer_mail_actions(id,workspace_id,thread_id,kind,status,created_at) VALUES(?,?,?,?,'pending',?)").bind(actionId,user.workspace_id,thread.id,trash?'trash':'labels',new Date().toISOString()).run();
 let result;try{
  const add=[],remove=[];if(body.unread!==undefined)(body.unread?add:remove).push('UNREAD');if(body.archived!==undefined)(body.archived?remove:add).push('INBOX');
  result=await call('threads/'+encodeURIComponent(thread.provider_id)+(trash?'/trash':'/modify'),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(trash?{}:{addLabelIds:add,removeLabelIds:remove})});
  if(result.id!==thread.provider_id)throw Error('Unconfirmed Gmail action.');
 }catch(e){await db.prepare("UPDATE customer_mail_actions SET status=? WHERE id=? AND workspace_id=?").bind(e.status>=400&&e.status<500?'failed':'uncertain',actionId,user.workspace_id).run();throw new MailError(502,'Gmail did not confirm this change. Sync before trying again; the action may have completed.');}
 const changes=[],values=[];for(const [field,value] of [['trashed',trash?true:undefined],['unread',body.unread],['archived',body.archived]])if(value!==undefined){changes.push(field+'=?');values.push(Number(value));}
 await db.batch([db.prepare('UPDATE customer_mail_threads SET '+changes.join(',')+' WHERE id=? AND workspace_id=?').bind(...values,thread.id,user.workspace_id),db.prepare("UPDATE customer_mail_actions SET status='confirmed',confirmed_at=? WHERE id=? AND workspace_id=?").bind(new Date().toISOString(),actionId,user.workspace_id)]);
 return {ok:true,trashed:trash};
}
