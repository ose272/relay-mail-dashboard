import bcrypt from 'bcryptjs';
import {meteredD1,readUsageDay,usageBudgets} from './usage-budget.js';
const encoder=new TextEncoder(),cookieName='relay_customer',sessionSeconds=7*86400;
const hex=bytes=>Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('');
const digest=async value=>hex(await crypto.subtle.digest('SHA-256',encoder.encode(value)));
// Dummy hash is only a timing equalizer for unknown logins, never a usable account.
const dummyHash='$2b$12$C6UzMDM.H6dfI/f/IKcEe.5hzTdReSQGjkYpUUkN1ngfaYfUJx2Nq';
class AuthError extends Error{constructor(status,message){super(message);this.status=status;}}
function response(status,data,cookie){return new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','Vary':'Cookie',...(cookie?{'Set-Cookie':cookie}:{})}});}
export function readCustomerCookie(request){const value=request.headers.get('Cookie')?.split(';').map(v=>v.trim()).find(v=>v.startsWith(cookieName+'='))?.slice(cookieName.length+1)||'';return /^[a-f0-9]{64}$/.test(value)?value:'';}
function sessionCookie(token,age=sessionSeconds){return `${cookieName}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${age}`;}
async function sessionRow(db,request){const token=readCustomerCookie(request);if(!token)return null;return db.prepare(`SELECT u.id,u.email,u.display_name,u.email_verified_at,w.id AS workspace_id,w.name AS workspace_name,w.status AS workspace_status FROM auth_sessions s JOIN auth_users u ON u.id=s.user_id JOIN auth_workspaces w ON w.owner_user_id=u.id WHERE s.token_hash=? AND s.expires_at>?`).bind(await digest(token),new Date().toISOString()).first();}
export async function customerSession(db,request){return sessionRow(db,request);}
function publicProfile(row){return {user:{id:row.id,email:row.email,name:row.display_name,emailVerified:Boolean(row.email_verified_at)},workspace:{id:row.workspace_id,name:row.workspace_name,status:row.workspace_status},next:'/welcome'};}
async function rateLimit(db,key,limit,seconds){const bucket=Math.floor(Date.now()/(seconds*1000));const hash=await digest(key+':'+bucket);const result=await db.prepare('INSERT INTO auth_rate_limits(key,attempts,expires_at) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET attempts=attempts+1 WHERE attempts<=? RETURNING attempts').bind(hash,new Date((bucket+1)*seconds*1000).toISOString(),limit).first();if(!result||result.attempts>limit)throw new AuthError(429,'Too many attempts. Please wait before trying again.');}
async function newSession(db,userId,statements=[]){const token=hex(crypto.getRandomValues(new Uint8Array(32))),now=new Date();await db.batch([...statements,db.prepare('INSERT INTO auth_sessions(token_hash,user_id,created_at,expires_at) VALUES(?,?,?,?)').bind(await digest(token),userId,now.toISOString(),new Date(+now+sessionSeconds*1000).toISOString())]);return sessionCookie(token);}
async function handle(request,env,db){
 const path=new URL(request.url).pathname;
 if(request.method==='GET'&&path==='/api/auth/session'){const row=await sessionRow(db,request);if(!row)throw new AuthError(401,'Please sign in.');return response(200,publicProfile(row));}
 if(request.method!=='POST')throw new AuthError(405,'Method not allowed.');
 if(request.headers.get('Origin')!==new URL(request.url).origin)throw new AuthError(403,'Cross-origin request blocked.');
 if(!request.headers.get('Content-Type')?.startsWith('application/json'))throw new AuthError(415,'JSON required.');
 const text=await request.text();if(text.length>8192)throw new AuthError(413,'The request is too large.');let body;try{body=JSON.parse(text);}catch{throw new AuthError(400,'Enter valid account details.');}if(!body||typeof body!=='object'||Array.isArray(body))throw new AuthError(400,'Enter valid account details.');
 if(path==='/api/auth/signout'){const token=readCustomerCookie(request);if(token)await db.prepare('DELETE FROM auth_sessions WHERE token_hash=?').bind(await digest(token)).run();return response(200,{ok:true,next:'/signin'},sessionCookie('',0));}
 if(!['/api/auth/signup','/api/auth/signin'].includes(path))throw new AuthError(404,'Not found.');
 if(path==='/api/auth/signup'&&env.REGISTRATION_OPEN!=='1')throw new AuthError(503,'Registrations are not open yet. Please check back soon.');
 const email=typeof body.email==='string'?body.email.trim().toLowerCase():'',password=typeof body.password==='string'?body.password:'';
 if(email.length>254||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))throw new AuthError(400,'Enter a valid email address.');
 if(!password||encoder.encode(password).length>72)throw new AuthError(400,'Use a password no longer than 72 UTF-8 bytes.');
 const signup=path.endsWith('/signup'),ip=request.headers.get('CF-Connecting-IP')||'local';
 await rateLimit(db,ip+(signup?':signup':':signin'),signup?5:20,signup?3600:900);
 if(!signup)await rateLimit(db,email+':signin',8,900);
 await db.batch([db.prepare('DELETE FROM auth_sessions WHERE token_hash IN(SELECT token_hash FROM auth_sessions WHERE expires_at<=? ORDER BY expires_at LIMIT 20)').bind(new Date().toISOString()),db.prepare('DELETE FROM auth_rate_limits WHERE key IN(SELECT key FROM auth_rate_limits WHERE expires_at<=? ORDER BY expires_at LIMIT 20)').bind(new Date().toISOString())]);
 if(signup){
  const name=typeof body.name==='string'?body.name.trim().replace(/\s+/g,' '):'';if(!name||name.length>100)throw new AuthError(400,'Enter your name, up to 100 characters.');if(password.length<12)throw new AuthError(400,'Use a password with at least 12 characters.');
  if(await db.prepare('SELECT id FROM auth_users WHERE email=?').bind(email).first())throw new AuthError(409,'That email is already registered. Please sign in.');
  const id=crypto.randomUUID(),workspaceId=crypto.randomUUID(),stamp=new Date().toISOString(),hash=await bcrypt.hash(password,12);
  let cookie;try{cookie=await newSession(db,id,[db.prepare('INSERT INTO auth_users(id,email,display_name,password_hash,created_at) VALUES(?,?,?,?,?)').bind(id,email,name,hash,stamp),db.prepare("INSERT INTO auth_workspaces(id,owner_user_id,name,status,created_at) VALUES(?,?,?,'pending_setup',?)").bind(workspaceId,id,'Your workspace',stamp)]);}catch(error){if(/UNIQUE.*auth_users.email/i.test(String(error.message)))throw new AuthError(409,'That email is already registered. Please sign in.');throw error;}
  return response(201,publicProfile({id,email,display_name:name,workspace_id:workspaceId,workspace_name:'Your workspace',workspace_status:'pending_setup'}),cookie);
 }
 const user=await db.prepare('SELECT id,password_hash FROM auth_users WHERE email=?').bind(email).first();const valid=await bcrypt.compare(password,user?.password_hash||dummyHash);if(!user||!valid)throw new AuthError(401,'Email or password is incorrect.');
 const cookie=await newSession(db,user.id);const profile=await db.prepare('SELECT u.id,u.email,u.display_name,u.email_verified_at,w.id AS workspace_id,w.name AS workspace_name,w.status AS workspace_status FROM auth_users u JOIN auth_workspaces w ON w.owner_user_id=u.id WHERE u.id=?').bind(user.id).first();return response(200,publicProfile(profile),cookie);
}
export async function customerAuth({request,env}){
 const path=new URL(request.url).pathname;
 if(request.method==='GET'&&path==='/api/auth/config')return response(200,{registrationOpen:env.REGISTRATION_OPEN==='1'});
 if(request.method==='POST'&&request.headers.get('Origin')!==new URL(request.url).origin)return response(403,{error:'Cross-origin request blocked.'});
 if(request.method==='POST'&&!request.headers.get('Content-Type')?.startsWith('application/json'))return response(415,{error:'JSON required.'});
 if(request.method==='POST'&&path==='/api/auth/signup'&&env.REGISTRATION_OPEN!=='1')return response(503,{error:'Registrations are not open yet. Please check back soon.'});
 if(request.method==='GET'&&path==='/api/auth/session'&&!readCustomerCookie(request))return response(401,{error:'Please sign in.'});
 if(!env.DB)return response(503,{error:'Account setup is not available yet.'});
 let meter,day=new Date().toISOString().slice(0,10);
 try{const initial=await readUsageDay(env.DB,day),base=usageBudgets(env),budget=env.APP_USAGE_TIER==='paid'?{...base,writes:base.writes+100000}:base;
  if(request.method==='POST'&&path!=='/api/auth/signout'&&(initial.rows_read>=budget.reads||initial.rows_written>=budget.writes))throw new AuthError(503,'Account service is temporarily busy. Please try again later.');
  meter=meteredD1(env.DB,initial,budget);return await handle(request,env,meter.db);
 }catch(error){if(error instanceof AuthError)return response(error.status,{error:error.message});console.error('Customer account request failed.');return response(503,{error:'Account service is temporarily unavailable. Please try again shortly.'});}
 finally{if(meter)await meter.flush(day).catch(()=>{});}
}
