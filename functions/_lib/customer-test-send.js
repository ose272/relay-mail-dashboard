import {digest,base64url,providerJson} from './google-identity.js';
import {decryptCredential} from './credentials.js';
import {refreshAccess} from './customer-google-oauth.js';
import {SEND_WINDOW_MS} from '../../src/send-window.mjs';

const json=(status,body)=>Response.json(body,{status,headers:{'Cache-Control':'no-store'}});
const email=/^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;
// There is deliberately no API that creates these privileged jobs. Their content is fixed,
// their capability is short-lived, and the atomic queued->sending claim is never reset.
export async function customerTestSend({request,env,fetcher=fetch}){
 if(request.method!=='POST')return json(405,{error:'Method not allowed.'});
 const authorization=request.headers.get('Authorization')||'';
 if(!/^Bearer [A-Za-z0-9_-]{43}$/.test(authorization))return json(403,{error:'Not authorized.'});
 let id;try{const text=await request.text();if(text.length>200)throw Error();id=JSON.parse(text).id;}catch{return json(400,{error:'Invalid request.'});}
 if(typeof id!=='string'||!/^[0-9a-f-]{36}$/.test(id))return json(400,{error:'Invalid job.'});
 const db=env.DB,hash=await digest(authorization.slice(7)),now=new Date().toISOString();
 const job=await db.prepare('SELECT id,workspace_id,mailbox_id,recipient,status,expires_at,error_code FROM customer_test_deliveries WHERE id=? AND capability_hash=? AND expires_at>?').bind(id,hash,now).first();
 if(!job)return json(403,{error:'Not authorized.'});
 if(job.status!=='queued')return json(200,{id,status:job.status,errorCode:job.error_code});
 const claim=await db.prepare("UPDATE customer_test_deliveries SET status='sending',started_at=? WHERE id=? AND capability_hash=? AND expires_at>? AND status='queued' AND NOT EXISTS(SELECT 1 FROM customer_test_deliveries busy WHERE busy.mailbox_id=customer_test_deliveries.mailbox_id AND busy.status='sending')").bind(now,id,hash,now).run();
 if(!claim.meta?.changes)return json(409,{id,error:'Job is already claimed or mailbox is busy. Do not create another job.'});
 let dispatchStarted=false;
 const finish=async(status,code)=>{await db.prepare('UPDATE customer_test_deliveries SET status=?,error_code=? WHERE id=? AND status=\'sending\'').bind(status,code,id).run();return json(status==='sent'?200:409,{id,status,errorCode:code});};
 try{
  const row=await db.prepare("SELECT * FROM customer_google_mailboxes WHERE id=? AND workspace_id=? AND status='connected'").bind(job.mailbox_id,job.workspace_id).first();
  if(!row||row.paused||!row.granted_scopes.split(/\s+/).includes('https://www.googleapis.com/auth/gmail.send'))return await finish('blocked','MAILBOX_NOT_READY');
  if(!email.test(row.email)||!email.test(job.recipient))return await finish('blocked','INVALID_ADDRESS');
  const cutoff=new Date(Date.now()-SEND_WINDOW_MS).toISOString();
  const legacy=await db.prepare('SELECT id,cap,paused,send_retry_after FROM accounts WHERE lower(email)=?').bind(row.email.toLowerCase()).first();
  if(legacy){
   if(legacy.paused||legacy.send_retry_after&&legacy.send_retry_after>now)return await finish('blocked','EXISTING_PROVIDER_HOLD');
   const busy=await db.prepare("SELECT 1 AS busy FROM campaign_deliveries WHERE account_id=? AND status IN('queued','sending') LIMIT 1").bind(legacy.id).first();
   if(busy)return await finish('blocked','EXISTING_CAMPAIGN_ACTIVE');
  }
  const used=await db.prepare("SELECT COUNT(*) AS total FROM customer_test_deliveries WHERE mailbox_id IN(SELECT id FROM customer_google_mailboxes WHERE google_sub=?) AND status IN('sending','sent','uncertain') AND started_at>?").bind(row.google_sub,cutoff).first();
  const history=legacy?await db.prepare("SELECT COUNT(*) AS total FROM campaign_deliveries WHERE account_id=? AND status IN('sending','sent','uncertain') AND COALESCE(sent_at,started_at)>?").bind(legacy.id,cutoff).first():{total:0};
  const retained=await db.prepare('SELECT COUNT(*) AS total FROM customer_retained_send_usage WHERE sender_hash=? AND used_at>?').bind(await digest(row.email.toLowerCase()),cutoff).first();
  if(Number(used.total)+Number(history.total)+Number(retained.total)>Math.min(40,row.cap,legacy?.cap??40))return await finish('blocked','SENDER_CAPACITY');
  const context='google-mailbox:'+row.workspace_id+':'+row.google_sub;
  let access=Date.parse(row.access_expires_at)>Date.now()+60000?await decryptCredential(context,row.access_ciphertext,env.GOOGLE_OAUTH_ENCRYPTION_KEY):await refreshAccess(env,db,row,fetcher);
  const profile=()=>providerJson(fetcher,'https://gmail.googleapis.com/gmail/v1/users/me/profile',{headers:{Authorization:'Bearer '+access}});
  let identity;try{identity=await profile();}catch(error){if(error.status!==401)throw error;access=await refreshAccess(env,db,row,fetcher);identity=await profile();}
  if(identity.emailAddress?.toLowerCase()!==row.email.toLowerCase())return await finish('blocked','GMAIL_IDENTITY_MISMATCH');
  const message=['From: '+row.email,'To: '+job.recipient,'Subject: Sendar OAuth connection test','Date: '+new Date().toUTCString(),'Message-ID: <'+id+'@sendar.com.de>','MIME-Version: 1.0','Content-Type: text/plain; charset=UTF-8','Content-Transfer-Encoding: 7bit','','This is the test email you requested from Sendar to verify sending through the connected Google mailbox.','','No action is required.',''].join('\r\n');
  dispatchStarted=true;
  // Exactly one POST. Network/5xx/ambiguous outcomes remain uncertain, never auto-retried.
  const result=await providerJson(fetcher,'https://gmail.googleapis.com/gmail/v1/users/me/messages/send',{method:'POST',headers:{Authorization:'Bearer '+access,'Content-Type':'application/json'},body:JSON.stringify({raw:base64url(new TextEncoder().encode(message))})});
  if(typeof result.id!=='string'||!result.id)throw Error('Unconfirmed Google send.');
  await db.prepare("UPDATE customer_test_deliveries SET status='sent',provider_message_id=?,sent_at=?,error_code=NULL WHERE id=? AND status='sending'").bind(result.id,new Date().toISOString(),id).run();
  return json(200,{id,status:'sent'});
 }catch(error){
  const rejected=dispatchStarted&&[400,401,403,404,413,422,429].includes(error.status);
  return await finish(dispatchStarted&&!rejected?'uncertain':'failed',dispatchStarted?(rejected?'GMAIL_REJECTED_'+error.status:'SEND_UNCONFIRMED'):(error.code||'GMAIL_CHECK_FAILED_'+(Number(error.status)||0)));
 }
}
