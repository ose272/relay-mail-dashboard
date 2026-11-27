import {newSession} from './customer-auth.js';
import {encryptCredential,decryptCredential} from './credentials.js';
import {randomToken,digest,pkceChallenge,providerJson,verifyGoogleIdentity} from './google-identity.js';
const cookieName='__Host-sendar_google_login';
const cookie=(token,age)=>`${cookieName}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${age}`;
const headers={'Cache-Control':'no-store','Referrer-Policy':'no-referrer'};
function origin(env){const u=new URL(env.GOOGLE_OAUTH_ORIGIN||'https://sendar.com.de');if(u.protocol!=='https:'||u.pathname!=='/'||u.search||u.hash)throw Error('Invalid origin');return u.origin;}
const callback='/api/oauth/google/callback';
export async function googleLoginStart({request,env}){
 const fail=(error,status)=>Response.json({error},{status,headers});
 if(request.method!=='POST')return fail('Method not allowed.',405);
 if(request.headers.get('Origin')!==origin(env)||new URL(request.url).origin!==origin(env))return fail('Start Google sign-in from sendar.com.de.',403);
 if(!env.GOOGLE_CLIENT_ID||!env.GOOGLE_CLIENT_SECRET||!env.GOOGLE_OAUTH_ENCRYPTION_KEY)return fail('Google sign-in is not configured.',503);
 const db=env.DB,now=new Date().toISOString(),ip=request.headers.get('CF-Connecting-IP')||'local',bucket=Math.floor(Date.now()/600000),key=await digest('google-login:'+ip+':'+bucket);
 const count=await db.prepare('INSERT INTO auth_rate_limits(key,attempts,expires_at) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET attempts=attempts+1 WHERE attempts<=20 RETURNING attempts').bind(key,new Date((bucket+1)*600000).toISOString()).first();
 if(!count||count.attempts>20)return fail('Too many sign-in attempts. Wait a few minutes.',429);
 const state='login_'+randomToken(),browser=randomToken(),verifier=randomToken(),nonce=randomToken(),hash=await digest(state);
 await db.batch([
  db.prepare('DELETE FROM auth_google_login_states WHERE state_hash IN(SELECT state_hash FROM auth_google_login_states WHERE expires_at<=? ORDER BY expires_at LIMIT 20)').bind(now),
  db.prepare('INSERT INTO auth_google_login_states(state_hash,browser_hash,verifier_ciphertext,nonce_hash,created_at,expires_at) VALUES(?,?,?,?,?,?)').bind(hash,await digest(browser),await encryptCredential('google-login:'+hash,verifier,env.GOOGLE_OAUTH_ENCRYPTION_KEY),await digest(nonce),now,new Date(Date.now()+600000).toISOString())
 ]);
 const url=new URL('https://accounts.google.com/o/oauth2/v2/auth');url.search=new URLSearchParams({client_id:env.GOOGLE_CLIENT_ID,redirect_uri:origin(env)+callback,response_type:'code',scope:'openid email profile',state,nonce,code_challenge:await pkceChallenge(verifier),code_challenge_method:'S256',prompt:'select_account'}).toString();
 return Response.json({url:url.href},{headers:{...headers,'Set-Cookie':cookie(browser,600)}});
}
export async function googleLoginCallback({request,env,fetcher=fetch}){
 const target=code=>new Response(null,{status:303,headers:{...headers,Location:origin(env)+(code?'/sendar/signin?googleLogin='+code:'/sendar/'),'Set-Cookie':cookie('',0)}});
 const url=new URL(request.url),state=url.searchParams.get('state'),browser=request.headers.get('Cookie')?.split(';').map(s=>s.trim()).find(s=>s.startsWith(cookieName+'='))?.slice(cookieName.length+1);
 if(url.origin!==origin(env)||!/^login_[A-Za-z0-9_-]{43}$/.test(state||'')||!/^[A-Za-z0-9_-]{43}$/.test(browser||''))return target('expired');
 const db=env.DB;
 const saved=await db.prepare('DELETE FROM auth_google_login_states WHERE state_hash=? AND browser_hash=? AND expires_at>? RETURNING *').bind(await digest(state),await digest(browser),new Date().toISOString()).first();
 if(!saved)return target('expired');if(url.searchParams.has('error'))return target('denied');
 const code=url.searchParams.get('code');if(!code||code.length>4096)return target('failed');
 try{
  const verifier=await decryptCredential('google-login:'+saved.state_hash,saved.verifier_ciphertext,env.GOOGLE_OAUTH_ENCRYPTION_KEY);
  const tokens=await providerJson(fetcher,'https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:env.GOOGLE_CLIENT_ID,client_secret:env.GOOGLE_CLIENT_SECRET,code,code_verifier:verifier,redirect_uri:origin(env)+callback,grant_type:'authorization_code'})});
  const identity=await verifyGoogleIdentity(tokens.id_token,{clientId:env.GOOGLE_CLIENT_ID,nonceHash:saved.nonce_hash,fetcher});
  const user=await db.prepare('SELECT user_id FROM auth_google_identities WHERE google_sub=?').bind(identity.sub).first();let session;
  if(!user){
   // An email match alone never links a Google identity into a password account.
   if(await db.prepare('SELECT id FROM auth_users WHERE email=?').bind(identity.email).first())return target('existing_account');
   if(env.REGISTRATION_OPEN!=='1')return target('registration_closed');
   const id=crypto.randomUUID(),workspaceId=crypto.randomUUID(),stamp=new Date().toISOString();
   session=await newSession(db,id,[
    db.prepare('INSERT INTO auth_users(id,email,display_name,password_hash,created_at,email_verified_at) VALUES(?,?,?,?,?,?)').bind(id,identity.email,identity.email.split('@')[0],'!google-only',stamp,stamp),
    db.prepare("INSERT INTO auth_workspaces(id,owner_user_id,name,status,created_at) VALUES(?,?,?,'ready',?)").bind(workspaceId,id,'Your workspace',stamp),
    db.prepare('INSERT INTO auth_google_identities(google_sub,user_id,created_at) VALUES(?,?,?)').bind(identity.sub,id,stamp)
   ]);
  }else session=await newSession(db,user.user_id);
  const response=target(null);response.headers.append('Set-Cookie',session);return response;
 }catch{return target('failed');}
}
