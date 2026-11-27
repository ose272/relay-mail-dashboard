import test from 'node:test';
import assert from 'node:assert/strict';
import {createTestDb} from '../scripts/test-d1.mjs';
import {encryptCredential} from '../functions/_lib/credentials.js';
import {base64url,digest} from '../functions/_lib/google-identity.js';
import {syncCustomerMailbox,updateCustomerThread,customerThreads} from '../functions/_lib/customer-gmail-inbox.js';
import {customerGoogleOAuth} from '../functions/_lib/customer-google-oauth.js';
const text=value=>base64url(new TextEncoder().encode(value));
async function fixture(){
 const db=createTestDb(),now=new Date().toISOString(),key=base64url(crypto.getRandomValues(new Uint8Array(32)));
 for(const id of ['a','b']){db.sqlite.prepare('INSERT INTO auth_users(id,email,display_name,password_hash,created_at) VALUES(?,?,?,?,?)').run(id,id+'@invalid.test',id,'unit',now);db.sqlite.prepare('INSERT INTO auth_workspaces(id,owner_user_id,name,created_at) VALUES(?,?,?,?)').run(id,id,id,now);}
 const encrypted=await encryptCredential('google-mailbox:a:unit-sub','unit-access',key);
 db.sqlite.prepare('INSERT INTO customer_google_mailboxes(id,workspace_id,google_sub,email,refresh_ciphertext,access_ciphertext,access_expires_at,granted_scopes,connected_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)').run('m','a','unit-sub','sender@invalid.test',encrypted,encrypted,new Date(Date.now()+3600000).toISOString(),'https://www.googleapis.com/auth/gmail.modify',now,now);
 const env={DB:db,GOOGLE_OAUTH_ENCRYPTION_KEY:key},user={id:'a',workspace_id:'a'},ctx={calls:[],mutation:'ok',nextPage:false,reply:false};
 const message=(id,from,body,out,age)=>({id,internalDate:String(Date.now()-age),labelIds:out?['SENT']:['INBOX','UNREAD'],payload:{mimeType:'text/plain',headers:[{name:'From',value:from},{name:'Subject',value:'Conversation'},{name:'Message-ID',value:'<'+id+'@invalid.test>'}],body:{data:text(body)}}});
 const fetcher=async(url,init={})=>{ctx.calls.push({url,method:init.method||'GET',body:init.body});assert.equal(init.redirect,'manual');const u=new URL(url);
  if(u.pathname.endsWith('/threads'))return Response.json({threads:[{id:'t1'}],...(ctx.nextPage?{nextPageToken:'page-two'}:{})});
  if(u.pathname.endsWith('/threads/t1')&&!init.method)return Response.json({id:'t1',messages:[message('msg1','sender@invalid.test','My original message',true,180000),message('msg2','client@invalid.test','Client reply',false,120000),...(ctx.reply?[message('msg3','sender@invalid.test','Replied on phone',true,60000)]:[])]});
  if(u.pathname.endsWith('/trash')||u.pathname.endsWith('/modify')){if(ctx.mutation==='timeout')throw Error('Unconfirmed socket');if(ctx.mutation==='reject')return Response.json({error:'unit'},{status:403});return Response.json({id:'t1'});}
  throw Error('Unexpected provider URL');
 };
 const sync=(extra={},who=user)=>syncCustomerMailbox({env,db,user:who,fetcher,body:{accountId:'m',manual:true,includeSent:true,...extra}});
 const update=body=>updateCustomerThread({env,db,user,fetcher,body});
 return {db,env,user,ctx,fetcher,sync,update};
}
test('manual Gmail sync stores both sides once, keeps mobile reply status and resumes bounded pages',async()=>{
 const f=await fixture();try{
  f.ctx.nextPage=true;assert.equal((await f.sync()).hasMore,true);
  let threads=await customerThreads(f.db,'a');assert.equal(threads.length,1);let full=(await customerThreads(f.db,'a',threads[0].id))[0];assert.equal(full.messages.length,2);assert.equal(full.unread,1);
  f.ctx.reply=true;await f.sync();full=(await customerThreads(f.db,'a',threads[0].id))[0];assert.equal(full.unread,0);assert.equal(full.messages.length,3);assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) AS n FROM customer_mail_messages').get().n,3);
  const lists=f.ctx.calls.filter(c=>new URL(c.url).pathname.endsWith('/threads'));assert.equal(new URL(lists[1].url).searchParams.get('pageToken'),'page-two');assert.equal(new URL(lists[0].url).searchParams.get('includeSpamTrash'),'false');
  f.db.sqlite.exec("INSERT INTO customer_workspace_settings(workspace_id,key,value) VALUES('a','includeSpamFolders','true')");await f.sync();const latest=f.ctx.calls.filter(c=>new URL(c.url).pathname.endsWith('/threads')).at(-1);assert.equal(new URL(latest.url).searchParams.get('includeSpamTrash'),'true');assert.equal(new URL(latest.url).searchParams.has('pageToken'),false);
  assert.deepEqual(await customerThreads(f.db,'b'),[]);
 }finally{f.db.sqlite.close();}
});
test('foreign mailboxes, automatic scans and overlapping syncs never reach Google',async()=>{
 const f=await fixture();try{await assert.rejects(f.sync({}, {id:'b',workspace_id:'b'}),/not found/);await assert.rejects(f.sync({manual:false}),/explicitly triggered/);assert.equal(f.ctx.calls.length,0);f.db.sqlite.prepare('UPDATE customer_google_mailboxes SET sync_lease_until=?').run(new Date(Date.now()+60000).toISOString());assert.equal((await f.sync()).busy,true);assert.equal(f.ctx.calls.length,0);}finally{f.db.sqlite.close();}
});
test('Trash requires confirmation, the modify grant and ownership; only the Gmail trash endpoint is called',async()=>{
 const f=await fixture();try{
  await f.sync();const id=(await customerThreads(f.db,'a'))[0].id;f.ctx.calls=[];
  await assert.rejects(f.update({id,trashed:true}),/Confirm/);assert.equal(f.ctx.calls.length,0);
  await assert.rejects(updateCustomerThread({env:f.env,db:f.db,user:{workspace_id:'b'},fetcher:f.fetcher,body:{id,trashed:true,confirmation:'TRASH'}}),/not found/);
  f.db.sqlite.exec("UPDATE customer_google_mailboxes SET granted_scopes='https://www.googleapis.com/auth/gmail.readonly'");await assert.rejects(f.update({id,trashed:true,confirmation:'TRASH'}),/Reconnect/);assert.equal(f.ctx.calls.length,0);
  f.db.sqlite.exec("UPDATE customer_google_mailboxes SET granted_scopes='https://www.googleapis.com/auth/gmail.modify'");await f.update({id,trashed:true,confirmation:'TRASH'});assert.deepEqual(await customerThreads(f.db,'a'),[]);assert.equal(f.ctx.calls.length,1);assert.match(f.ctx.calls[0].url,/\/threads\/t1\/trash$/);assert.equal(f.ctx.calls[0].method,'POST');await f.update({id,trashed:true,confirmation:'TRASH'});assert.equal(f.ctx.calls.length,1);
 }finally{f.db.sqlite.close();}
});
test('unconfirmed Trash is retained as uncertain without hiding the conversation or retrying',async()=>{
 const f=await fixture();try{await f.sync();const id=(await customerThreads(f.db,'a'))[0].id;f.ctx.calls=[];f.ctx.mutation='timeout';await assert.rejects(f.update({id,trashed:true,confirmation:'TRASH'}),/may have completed/);assert.equal((await customerThreads(f.db,'a')).length,1);assert.equal(f.db.sqlite.prepare('SELECT status FROM customer_mail_actions').get().status,'uncertain');assert.equal(f.ctx.calls.length,1);}finally{f.db.sqlite.close();}
});
test('read and archive changes use label modification and preserve local state until Gmail confirms',async()=>{
 const f=await fixture();try{await f.sync();const id=(await customerThreads(f.db,'a'))[0].id;await f.update({id,unread:false,archived:true});const action=f.ctx.calls.at(-1);assert.match(action.url,/\/modify$/);assert.deepEqual(JSON.parse(action.body).removeLabelIds,['UNREAD','INBOX']);const row=(await customerThreads(f.db,'a',id))[0];assert.equal(row.unread,0);assert.equal(row.archived,1);}finally{f.db.sqlite.close();}
});
test('unverified new scopes cannot be started by general production users',async()=>{
 const f=await fixture();try{const now=new Date().toISOString();f.db.sqlite.prepare('INSERT INTO auth_sessions(token_hash,user_id,created_at,expires_at) VALUES(?,?,?,?)').run(await digest('a'.repeat(64)),'a',now,new Date(Date.now()+3600000).toISOString());const env={...f.env,GOOGLE_CLIENT_ID:'unit',GOOGLE_CLIENT_SECRET:'unit',GOOGLE_OAUTH_ORIGIN:'https://sendar.invalid',GOOGLE_MODIFY_REVIEW_EMAIL:'support.sendar@gmail.com'};const r=await customerGoogleOAuth({env,request:new Request('https://sendar.invalid/api/oauth/google/start',{method:'POST',headers:{Origin:'https://sendar.invalid','Content-Type':'application/json',Cookie:'relay_customer='+'a'.repeat(64)},body:'{}'})});assert.equal(r.status,403);assert.equal((await r.json()).code,'REVIEW_TEST_ONLY');}finally{f.db.sqlite.close();}
});
