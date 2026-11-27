import {customerSession,readCustomerCookie} from './customer-auth.js';
import {encryptCredential,decryptCredential} from './credentials.js';
import {googleScopes,randomToken,digest,pkceChallenge,providerJson,verifyGoogleIdentity} from './google-identity.js';
import {meteredD1,readUsageDay,usageBudgets} from './usage-budget.js';

const callbackPath='/api/oauth/google/callback';
const gmailScopes=googleScopes.filter(s=>s.startsWith('https://www.googleapis.com/auth/gmail.'));
const noStore={'Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff','Vary':'Cookie'};
class OAuthError extends Error{constructor(status,code,message){super(message);this.status=status;this.code=code;}}
const json=(status,body)=>new Response(JSON.stringify(body),{status,headers:{...noStore,'Content-Type':'application/json; charset=utf-8'}});
const configured=env=>Boolean(env.GOOGLE_CLIENT_ID&&env.GOOGLE_CLIENT_SECRET&&env.GOOGLE_OAUTH_ENCRYPTION_KEY);
function origin(env){const url=new URL(env.GOOGLE_OAUTH_ORIGIN||'https://sendar.com.de');if(url.protocol!=='https:'||url.pathname!=='/'||url.search||url.hash||url.username||url.password)throw Error('Invalid configured OAuth origin.');return url.origin;}
const destination=(env,result,reference)=>new Response(null,{status:303,headers:{...noStore,Location:origin(env)+'/sendar/welcome?google='+result+(reference?'&reference='+reference:'')}});
const tokenContext=row=>'google-mailbox:'+row.workspace_id+':'+row.google_sub;
function failureCode(stage,error){
 if(stage==='authorization_verifier')return 'oauth_key_mismatch';
 if(stage==='token_exchange'){
  if(error.providerCode==='invalid_client')return 'google_client_rejected';
  if(error.providerCode==='invalid_grant')return 'google_code_rejected';
  if(error.providerCode==='access_denied')return 'google_access_denied';
  if(error.status===429||error.status>=500)return 'google_temporary_error';
  return 'google_token_request_failed';
 }
 if(stage==='identity_validation'){
  if(error.status)return 'google_signing_keys_failed';
  if(error.message==='Invalid Google signature.')return 'google_identity_signature';
  if(error.message==='Google identity audience mismatch.')return 'google_identity_audience';
  if(error.message==='Google identity nonce mismatch.')return 'google_identity_nonce';
  return 'google_identity_invalid';
 }
 return stage==='connection_save'?'connection_save_failed':'connection_failed';
}
async function recordFailure(db,workspaceId,stage,error){
 const reference=crypto.randomUUID(),code=failureCode(stage,error),status=Number.isInteger(error.status)&&error.status>=100&&error.status<600?error.status:0;
 try{await db.batch([
  db.prepare('INSERT INTO customer_google_oauth_errors(id,workspace_id,stage,error_code,provider_status,created_at) VALUES(?,?,?,?,?,?)').bind(reference,workspaceId,stage,code,status,new Date().toISOString()),
  db.prepare('DELETE FROM customer_google_oauth_errors WHERE id IN(SELECT id FROM customer_google_oauth_errors WHERE created_at<? ORDER BY created_at,id LIMIT 20)').bind(new Date(Date.now()-7*86400000).toISOString())
 ]);}catch{console.warn('OAUTH_SAFE_DIAGNOSTIC',JSON.stringify({reference,stage,code,status}));}
 return {reference,code};
}
async function readBody(request){
 if(request.headers.get('Origin')!==new URL(request.url).origin)throw new OAuthError(403,'CROSS_ORIGIN','Cross-origin request blocked.');
 if(!request.headers.get('Content-Type')?.startsWith('application/json'))throw new OAuthError(415,'JSON_REQUIRED','JSON required.');
 const text=await request.text();if(text.length>4096)throw new OAuthError(413,'TOO_LARGE','Request too large.');
 try{const body=JSON.parse(text);if(!body||typeof body!=='object'||Array.isArray(body))throw Error();return body;}catch{throw new OAuthError(400,'INVALID_JSON','Invalid request.');}
}
async function activeCustomer(db,request){const customer=await customerSession(db,request);if(!customer)throw new OAuthError(401,'SIGN_IN_REQUIRED','Please sign in with your Sendar account.');return customer;}
async function start(request,env,db,customer){
 if(!configured(env))throw new OAuthError(503,'OAUTH_NOT_CONFIGURED','Google connection is not configured yet.');
 const canonical=origin(env);if(new URL(request.url).origin!==canonical)throw new OAuthError(400,'USE_CUSTOM_DOMAIN','Connect Google from '+canonical+'.');
 const stamp=new Date(),expires=new Date(+stamp+600000).toISOString(),old=new Date(+stamp-600000).toISOString();
 const count=await db.prepare('SELECT COUNT(*) AS total FROM customer_google_oauth_states WHERE user_id=? AND created_at>?').bind(customer.id,old).first();
 if(Number(count?.total)>=10)throw new OAuthError(429,'OAUTH_RATE_LIMIT','Too many connection attempts. Wait a few minutes before trying again.');
 const state=randomToken(),verifier=randomToken(),nonce=randomToken(),hash=await digest(state);
 const encrypted=await encryptCredential('oauth-state:'+hash,verifier,env.GOOGLE_OAUTH_ENCRYPTION_KEY);
 await db.batch([
  db.prepare('DELETE FROM customer_google_oauth_states WHERE state_hash IN(SELECT state_hash FROM customer_google_oauth_states WHERE expires_at<=? ORDER BY expires_at LIMIT 20)').bind(stamp.toISOString()),
  db.prepare('INSERT INTO customer_google_oauth_states(state_hash,session_hash,user_id,workspace_id,verifier_ciphertext,nonce_hash,created_at,expires_at) VALUES(?,?,?,?,?,?,?,?)').bind(hash,await digest(readCustomerCookie(request)),customer.id,customer.workspace_id,encrypted,await digest(nonce),stamp.toISOString(),expires)
 ]);
 const url=new URL('https://accounts.google.com/o/oauth2/v2/auth');
 url.search=new URLSearchParams({client_id:env.GOOGLE_CLIENT_ID,redirect_uri:canonical+callbackPath,response_type:'code',scope:googleScopes.join(' '),state,nonce,code_challenge:await pkceChallenge(verifier),code_challenge_method:'S256',access_type:'offline',prompt:'consent select_account',include_granted_scopes:'true'}).toString();
 return json(200,{url:url.href});
}
async function callback(request,env,db,customer,fetcher){
 const url=new URL(request.url),state=url.searchParams.get('state');
 if(url.origin!==origin(env))return destination(env,'wrong_origin');
 if(!configured(env))return destination(env,'not_configured');
 if(!state||!/^[A-Za-z0-9_-]{43}$/.test(state))return destination(env,'expired');
 const saved=await db.prepare('DELETE FROM customer_google_oauth_states WHERE state_hash=? AND session_hash=? AND user_id=? AND workspace_id=? AND expires_at>? RETURNING *').bind(await digest(state),await digest(readCustomerCookie(request)),customer.id,customer.workspace_id,new Date().toISOString()).first();
 if(!saved)return destination(env,'expired');
 if(url.searchParams.has('error'))return destination(env,'denied');
 const code=url.searchParams.get('code');if(!code||code.length>4096)return destination(env,'failed');
 let stage='authorization_verifier';
 try{
  const verifier=await decryptCredential('oauth-state:'+saved.state_hash,saved.verifier_ciphertext,env.GOOGLE_OAUTH_ENCRYPTION_KEY);
  stage='token_exchange';
  const tokens=await providerJson(fetcher,'https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:env.GOOGLE_CLIENT_ID,client_secret:env.GOOGLE_CLIENT_SECRET,code,code_verifier:verifier,redirect_uri:origin(env)+callbackPath,grant_type:'authorization_code'})});
  stage='identity_validation';
  const identity=await verifyGoogleIdentity(tokens.id_token,{clientId:env.GOOGLE_CLIENT_ID,nonceHash:saved.nonce_hash,fetcher});
  const scopes=typeof tokens.scope==='string'?tokens.scope.split(/\s+/):[];
  if(gmailScopes.some(scope=>!scopes.includes(scope)))return destination(env,'permissions');
  if(typeof tokens.access_token!=='string'||!tokens.access_token||tokens.access_token.length>16000)return destination(env,'failed');
  stage='connection_save';
  const prior=await db.prepare("SELECT id,workspace_id,google_sub,refresh_ciphertext FROM customer_google_mailboxes WHERE google_sub=? AND status<>'disconnected'").bind(identity.sub).first();
  if(prior&&prior.workspace_id!==customer.workspace_id)return destination(env,'account_conflict');
  const context=tokenContext({workspace_id:customer.workspace_id,google_sub:identity.sub});
  const refresh=typeof tokens.refresh_token==='string'&&tokens.refresh_token.length>0&&tokens.refresh_token.length<=16000?await encryptCredential(context,tokens.refresh_token,env.GOOGLE_OAUTH_ENCRYPTION_KEY):prior?.refresh_ciphertext;
  if(!refresh)return destination(env,'offline_access');
  const access=await encryptCredential(context,tokens.access_token,env.GOOGLE_OAUTH_ENCRYPTION_KEY),now=new Date().toISOString(),expiry=new Date(Date.now()+Math.max(1,Math.min(86400,Number(tokens.expires_in)||3600))*1000).toISOString();
  if(prior){
   const updated=await db.prepare("UPDATE customer_google_mailboxes SET email=?,refresh_ciphertext=?,access_ciphertext=?,access_expires_at=?,granted_scopes=?,status='connected',updated_at=?,checked_at=NULL,last_check_status=NULL WHERE id=? AND workspace_id=? AND status<>'disconnected'").bind(identity.email,refresh,access,expiry,scopes.join(' '),now,prior.id,customer.workspace_id).run();
   if(!updated.meta?.changes)throw Error('Connection changed during authorization.');
  }else{
   await db.prepare('INSERT INTO customer_google_mailboxes(id,workspace_id,google_sub,email,refresh_ciphertext,access_ciphertext,access_expires_at,granted_scopes,connected_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)').bind(crypto.randomUUID(),customer.workspace_id,identity.sub,identity.email,refresh,access,expiry,scopes.join(' '),now,now).run();
  }
  return destination(env,'connected');
 }catch(error){
  // Never log authorization codes, provider responses, tokens or credential data.
  const diagnostic=await recordFailure(db,customer.workspace_id,stage,error);
  return destination(env,diagnostic.code,diagnostic.reference);
 }
}
async function ownedMailbox(db,customer,id){
 if(typeof id!=='string'||id.length>100)throw new OAuthError(400,'INVALID_MAILBOX','Choose a connected mailbox.');
 const row=await db.prepare("SELECT * FROM customer_google_mailboxes WHERE id=? AND workspace_id=? AND status<>'disconnected'").bind(id,customer.workspace_id).first();
 if(!row)throw new OAuthError(404,'MAILBOX_NOT_FOUND','Mailbox not found.');return row;
}
export async function refreshAccess(env,db,row,fetcher){
 const refresh=await decryptCredential(tokenContext(row),row.refresh_ciphertext,env.GOOGLE_OAUTH_ENCRYPTION_KEY);
 let tokens;try{tokens=await providerJson(fetcher,'https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:env.GOOGLE_CLIENT_ID,client_secret:env.GOOGLE_CLIENT_SECRET,refresh_token:refresh,grant_type:'refresh_token'})});}
 catch(error){if(error.providerCode==='invalid_grant')await db.prepare("UPDATE customer_google_mailboxes SET status='reconnect_required',last_check_status='authorization_expired' WHERE id=? AND workspace_id=?").bind(row.id,row.workspace_id).run();throw new OAuthError(502,'GOOGLE_REFRESH_FAILED',error.providerCode==='invalid_grant'?'Google authorization expired or was revoked. Reconnect this mailbox.':'Google authorization could not be refreshed. Retry later; no mail was sent.');}
 if(typeof tokens.access_token!=='string'||!tokens.access_token||tokens.access_token.length>16000)throw new OAuthError(502,'GOOGLE_REFRESH_FAILED','Google did not return a valid access token.');
 const expires=new Date(Date.now()+Math.max(1,Math.min(86400,Number(tokens.expires_in)||3600))*1000).toISOString();
 const access=await encryptCredential(tokenContext(row),tokens.access_token,env.GOOGLE_OAUTH_ENCRYPTION_KEY);
 const refreshCipher=typeof tokens.refresh_token==='string'&&tokens.refresh_token&&tokens.refresh_token.length<=16000?await encryptCredential(tokenContext(row),tokens.refresh_token,env.GOOGLE_OAUTH_ENCRYPTION_KEY):row.refresh_ciphertext;
 await db.prepare("UPDATE customer_google_mailboxes SET access_ciphertext=?,refresh_ciphertext=?,access_expires_at=?,updated_at=? WHERE id=? AND workspace_id=? AND status<>'disconnected'").bind(access,refreshCipher,expires,new Date().toISOString(),row.id,row.workspace_id).run();
 return tokens.access_token;
}
async function checkMailbox(env,db,row,fetcher){
 if(row.status==='reconnect_required')throw new OAuthError(409,'RECONNECT_REQUIRED','Reconnect this mailbox to refresh Google authorization.');
 if(row.last_check_status==='ok'&&Date.parse(row.checked_at)>Date.now()-60000)return json(200,{ok:true,cached:true,checkedAt:row.checked_at,message:'Gmail profile access was verified within the last minute. No email was sent.'});
 let access=Date.parse(row.access_expires_at)>Date.now()+60000?await decryptCredential(tokenContext(row),row.access_ciphertext,env.GOOGLE_OAUTH_ENCRYPTION_KEY):await refreshAccess(env,db,row,fetcher);
 const profile=()=>providerJson(fetcher,'https://gmail.googleapis.com/gmail/v1/users/me/profile',{headers:{Authorization:'Bearer '+access}});
 let result;try{result=await profile();}catch(error){if(error.status!==401)throw new OAuthError(502,'GOOGLE_CHECK_FAILED','Gmail access could not be checked. Confirm the Gmail API is enabled and required permissions are granted, then retry.');access=await refreshAccess(env,db,row,fetcher);result=await profile().catch(()=>{throw new OAuthError(502,'GOOGLE_CHECK_FAILED','Gmail access could not be checked. Retry or reconnect the mailbox.');});}
 if(typeof result.emailAddress!=='string'||result.emailAddress.toLowerCase()!==row.email)throw new OAuthError(502,'GOOGLE_IDENTITY_MISMATCH','The Gmail profile did not match this mailbox. Reconnect it.');
 const stamp=new Date().toISOString();await db.prepare("UPDATE customer_google_mailboxes SET checked_at=?,last_check_status='ok' WHERE id=? AND workspace_id=? AND status<>'disconnected'").bind(stamp,row.id,row.workspace_id).run();
 return json(200,{ok:true,checkedAt:stamp,message:'Gmail profile access verified. No email was sent.'});
}
async function disconnect(env,db,row,fetcher){
 let refresh='';try{if(row.refresh_ciphertext)refresh=await decryptCredential(tokenContext(row),row.refresh_ciphertext,env.GOOGLE_OAUTH_ENCRYPTION_KEY);}catch{}
 await db.prepare("UPDATE customer_google_mailboxes SET status='disconnected',refresh_ciphertext='',access_ciphertext='',updated_at=? WHERE id=? AND workspace_id=?").bind(new Date().toISOString(),row.id,row.workspace_id).run();
 let revoked=false;try{if(refresh){const response=await fetcher('https://oauth2.googleapis.com/revoke',{method:'POST',redirect:'manual',signal:AbortSignal.timeout(20000),headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({token:refresh})});revoked=response.ok;}}catch{}
 return json(200,{ok:true,revoked,message:revoked?'Disconnected from Google.':'Disconnected locally. You can also remove Sendar access in your Google account to revoke the grant.'});
}
export async function customerGoogleOAuth({request,env,fetcher=fetch}){
 const path=new URL(request.url).pathname,action=path.slice('/api/oauth/google/'.length),isCallback=action==='callback'&&request.method==='GET';
 if(action==='config'&&request.method==='GET')return json(200,{configured:configured(env),origin:origin(env),callback:origin(env)+callbackPath});
 const methods={start:'POST',callback:'GET',mailboxes:'GET',check:'POST',disconnect:'POST'};
 if(!methods[action])return json(404,{error:'Not found.'});if(request.method!==methods[action])return json(405,{error:'Method not allowed.'});
 let meter;const day=new Date().toISOString().slice(0,10);
 try{
  if(!env.DB)throw new OAuthError(503,'DATABASE_UNAVAILABLE','Account service is unavailable.');
  const body=request.method==='POST'?await readBody(request):null;
  if(!readCustomerCookie(request))throw new OAuthError(401,'SIGN_IN_REQUIRED','Please sign in with your Sendar account.');
  const initial=await readUsageDay(env.DB,day),base=usageBudgets(env),budgets=env.APP_USAGE_TIER==='paid'?{...base,writes:base.writes+100000}:base;
  if(!['mailboxes','disconnect'].includes(action)&&(initial.rows_read>=budgets.reads||initial.rows_written>=budgets.writes))throw new OAuthError(503,'ACCOUNT_USAGE_BUDGET','Account service is temporarily busy. Retry later.');
  meter=meteredD1(env.DB,initial,budgets);const db=meter.db,customer=await activeCustomer(db,request);
  if(action==='start')return await start(request,env,db,customer);
  if(isCallback)return await callback(request,env,db,customer,fetcher);
  if(action==='mailboxes'){
   const before=new URL(request.url).searchParams.get('before');
   const cursor=before?await db.prepare("SELECT connected_at,id FROM customer_google_mailboxes WHERE id=? AND workspace_id=? AND status<>'disconnected'").bind(before,customer.workspace_id).first():null;
   if(before&&!cursor)throw new OAuthError(400,'INVALID_CURSOR','Refresh the mailbox list before loading more.');
   const sql="SELECT id,email,status,connected_at,checked_at,last_check_status FROM customer_google_mailboxes WHERE workspace_id=? AND status<>'disconnected' "+(cursor?'AND (connected_at,id)<(?,?) ':'')+'ORDER BY connected_at DESC,id DESC LIMIT 101';
   const rows=(await (cursor?db.prepare(sql).bind(customer.workspace_id,cursor.connected_at,cursor.id):db.prepare(sql).bind(customer.workspace_id)).all()).results||[];
   const count=await db.prepare("SELECT COUNT(*) AS total FROM customer_google_mailboxes WHERE workspace_id=? AND status<>'disconnected'").bind(customer.workspace_id).first();
   return json(200,{mailboxes:rows.slice(0,100).map(r=>({id:r.id,email:r.email,status:r.status,connectedAt:r.connected_at,checkedAt:r.checked_at,lastCheckStatus:r.last_check_status})),total:Number(count?.total||0),nextCursor:rows.length>100?rows[99].id:null});
  }
  if(!configured(env))throw new OAuthError(503,'OAUTH_NOT_CONFIGURED','Google connection is not configured yet.');
  const row=await ownedMailbox(db,customer,body.mailboxId);
  return action==='check'?await checkMailbox(env,db,row,fetcher):await disconnect(env,db,row,fetcher);
 }catch(error){
  if(isCallback)return error instanceof OAuthError&&error.status===401?new Response(null,{status:303,headers:{...noStore,Location:origin(env)+'/sendar/signin?google=signin_required'}}):destination(env,'failed');
  return error instanceof OAuthError?json(error.status,{error:error.message,code:error.code}):json(503,{error:'Google connection service is temporarily unavailable. No email was sent.',code:'OAUTH_UNAVAILABLE'});
 }finally{if(meter)await meter.flush(day).catch(()=>{});}
}
