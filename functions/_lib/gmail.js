import {extractBounceReports} from '../../src/bounces.mjs';
import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import nodemailer from 'nodemailer';

const messageLimit = 25;
const messageSizeLimit = 12_000;
const messageSourceLimit = 256_000;

function createImapClient(email, password) {
  return new ImapFlow({
    host: 'imap.gmail.com',
    port: 993,
    secure: true,
    auth: { user: email, pass: password },
    logger: false,
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 20_000,
    maxLiteralSize: 1_000_000,
    maxResponseSize: 12_000_000
  });
}

function createSmtpTransport(email, password) {
  return nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 587,
    secure: false,
    requireTLS: true,
    auth: { user: email, pass: password },
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 20_000
  });
}

export async function verifyGmailCredentials(email, password) {
  const client = createImapClient(email, password);
  let connected = false;
  try {
    await client.connect();
    connected = true;
    const lock = await client.getMailboxLock('INBOX', { readOnly: true, acquireTimeout: 10_000 });
    lock.release();
  } finally {
    if (connected) await client.logout();
  }

  const transport = createSmtpTransport(email, password);
  try {
    await transport.verify();
    return { imap: true, smtp: true };
  } catch {
    return { imap: true, smtp: false };
  } finally {
    transport.close();
  }
}

function connectionErrorDetails(error) {
  return {
    code: String(error.responseCode || error.code || 'CONNECTION_ERROR').slice(0, 40),
    message: String(error.response || error.message || 'Connection failed.').replace(/\s+/g, ' ').slice(0, 240)
  };
}

export async function checkGmailHealth(email, password) {
  const client = createImapClient(email, password);
  let connected = false;
  let imapError = null;
  try {
    await client.connect();
    connected = true;
    const lock = await client.getMailboxLock('INBOX', { readOnly: true, acquireTimeout: 10_000 });
    lock.release();
  } catch (error) {
    imapError = connectionErrorDetails(error);
  } finally {
    if (connected) {
      try {
        await client.logout();
      } catch (error) {
        if (!imapError) imapError = connectionErrorDetails(error);
      }
    }
  }

  const transport = createSmtpTransport(email, password);
  let smtpError = null;
  try {
    await transport.verify();
  } catch (error) {
    smtpError = connectionErrorDetails(error);
  } finally {
    transport.close();
  }

  return { imap: !imapError, smtp: !smtpError, imapError, smtpError };
}

async function fetchRecentMailbox(email, password, mailboxPath, checkpoint, bouncesOnly = false, sharedClient = null, cache = new Map()) {
  const client = sharedClient || createImapClient(email, password);
  let connected = false;
  try {
    if(!sharedClient){await client.connect();connected=true;}
    if (!mailboxPath) {
      const sentFolder = (await client.list()).find(folder => folder.specialUse === '\\Sent');
      if (!sentFolder) throw new Error('Gmail Sent folder was not found.');
      mailboxPath = sentFolder.path;
    }
    const lock = await client.getMailboxLock(mailboxPath, { readOnly: true, acquireTimeout: 10_000 });
    try {
      const total = client.mailbox?.exists ?? 0;
      const uidValidity = String(client.mailbox?.uidValidity ?? 'unknown');
      const latestUid = Math.max(0, (client.mailbox?.uidNext ?? 1) - 1);
      const sameMailbox = checkpoint.uid > 0 && checkpoint.uidValidity === uidValidity;
      const firstUid = checkpoint.uid + 1;
      const lastUid = sameMailbox ? Math.min(latestUid, checkpoint.uid + messageLimit) : latestUid;
      if (sameMailbox && firstUid > latestUid) {
        return { messages: [], checked: 0, uid: checkpoint.uid, uidValidity, more: false };
      }
      if (!total) return { messages: [], checked: 0, uid: latestUid, uidValidity, more: false };

      let bounceUids=[];
      if(bouncesOnly){
        const found=await client.search({...(sameMailbox?{uid:`${firstUid}:${latestUid}`}:{since:new Date(Date.now()-30*86400000)}),or:[{from:'mailer-daemon'},{from:'postmaster'}]},{uid:true});
        bounceUids=(found || []).filter(uid=>!sameMailbox || uid>checkpoint.uid).sort((a,b)=>a-b);
        if(!bounceUids.length)return {messages:[],checked:0,uid:latestUid,uidValidity,more:false};
      }
      let pendingUids=[];
      if(!bouncesOnly && sameMailbox){
        const found=await client.search({uid:`${firstUid}:${latestUid}`},{uid:true});
        pendingUids=(found || []).filter(uid=>uid>=firstUid && uid<=latestUid).sort((a,b)=>a-b);
        if(!pendingUids.length)return {messages:[],checked:0,uid:latestUid,uidValidity,more:false};
      }
      const firstSequence = Math.max(1, total - messageLimit + 1);
      const range = bouncesOnly ? bounceUids.slice(0,messageLimit).join(',') : sameMailbox ? pendingUids.slice(0,messageLimit).join(',') : `${firstSequence}:${total}`;
      const cached=bouncesOnly?bounceUids.slice(0,messageLimit).map(uid=>cache.get(`${mailboxPath}:${uidValidity}:${uid}`)).filter(Boolean):[];
      const missingRange=bouncesOnly?bounceUids.slice(0,messageLimit).filter(uid=>!cache.has(`${mailboxPath}:${uidValidity}:${uid}`)).join(','):range;
      const fetched = missingRange ? await client.fetchAll(missingRange, {
        uid: true,
        threadId: true,
        envelope: true,
        internalDate: true,
        flags: true,
        source: {maxLength:messageSourceLimit}
      }, (sameMailbox || bouncesOnly) ? { uid: true } : undefined) : [];
      const fetchedUid = fetched.reduce((max, item) => Math.max(max, item.uid || 0), 0);
      const syncUid = bouncesOnly ? Math.max(...bounceUids.slice(0,messageLimit)) : sameMailbox ? Math.max(...pendingUids.slice(0,messageLimit)) : fetchedUid;
      const messages = [...cached];
      for (const item of fetched.reverse()) {
        if (!item.source) continue;
        messages.push(await parseMailboxMessage(item,mailboxPath,uidValidity));
      }
      for(const message of messages){const uid=message.externalId.split(':').at(-1);cache.set(`${mailboxPath}:${uidValidity}:${uid}`,message);}
      return {
        messages,
        mailboxPath,
        checked: fetched.length+cached.length,
        uid: syncUid,
        uidValidity,
        more: bouncesOnly ? bounceUids.length>messageLimit : sameMailbox ? pendingUids.length>messageLimit : syncUid < latestUid
      };
    } finally {
      lock.release();
    }
  } finally {
    if (connected) await client.logout();
  }
}

export async function fetchRecentInbox(email, password, checkpoint) {
  return fetchRecentMailbox(email, password, 'INBOX', checkpoint);
}

export async function fetchRecentBounces(email,password,checkpoint){
 return fetchRecentMailbox(email,password,'INBOX',checkpoint,true);
}

export async function fetchRecentSent(email, password, checkpoint) {
  return fetchRecentMailbox(email, password, '', checkpoint);
}

export async function sendThreadReply({ email, password, to, subject, text, inReplyTo, references, messageId }) {
  const transport = createSmtpTransport(email, password);
  try {
    return await transport.sendMail({
      from: email,
      to,
      subject,
      text,
      inReplyTo: inReplyTo || undefined,
      references: references.length ? references : undefined,
      messageId
    });
  } finally {
    transport.close();
  }
}

export function createCampaignMessageOptions({ email, to, subject, text, messageId, html }) {
  const options = { from: email, to, text, messageId, html };
  if (subject?.trim()) options.subject = subject.trim();
  return options;
}

export async function sendCampaignMessage({ email, password, to, subject, text, messageId, html }) {
  const transport = createSmtpTransport(email, password);
  try {
    return await transport.sendMail(createCampaignMessageOptions({ email, to, subject, text, messageId, html }));
  } finally {
    transport.close();
  }
}

// One authenticated session per account. Sent reconciliation is opt-in, except
// when a known uncertain campaign attempt needs evidence from the Sent folder.
function retryableMailError(error){return /^(?:NOCONNECTION|ETIMEOUT|ETIMEDOUT|ECONNRESET|ECONNREFUSED|EAI_AGAIN|SOCKET|CONNECTIONCLOSED)$/i.test(String(error?.code || ''));}
export async function fetchAccountMail(email,password,checkpoints,{includeSent=false,client,createClient=createImapClient,retryDelayMs=250}={}){
 const result={incoming:null,bounceInbox:null,sent:null,inboxError:null,bounceError:null,sentError:null};
 const cache=new Map();
 for(let attempt=0;attempt<2;attempt++){
  if(attempt)await new Promise(resolve=>setTimeout(resolve,retryDelayMs));
  const current=attempt===0 && client?client:createClient(email,password);let connected=false,broken=null;
  try{
   await current.connect();connected=true;
   for(const [key,errorKey,path,checkpoint,bounces] of [['incoming','inboxError','INBOX',checkpoints.inbox,false],['bounceInbox','bounceError','INBOX',checkpoints.bounces,true],...(includeSent?[['sent','sentError','',checkpoints.sent,false]]:[])]){
    if(result[key])continue;
    if(broken){result[errorKey]=broken;continue;}
    try{result[key]=await fetchRecentMailbox(email,password,path,checkpoint,bounces,current,cache);result[errorKey]=null;}
    catch(error){result[errorKey]=error;if(retryableMailError(error))broken=error;}
   }
  }catch(error){for(const [key,errorKey] of [['incoming','inboxError'],['bounceInbox','bounceError'],...(includeSent?[['sent','sentError']]:[])])if(!result[key])result[errorKey]=error;}
  finally{if(connected)await current.logout().catch(()=>{});current.close?.();}
  if(![result.inboxError,result.bounceError,result.sentError].some(retryableMailError))break;
 }
 return result;
}

async function parseMailboxMessage(item,mailboxPath,uidValidity){
        const parsed = await simpleParser(item.source, { skipHtml: true, skipImageLinks: true });
        const sender = parsed.from?.value?.[0];
        const fromAddress = sender?.address?.toLowerCase() || '';
        const recipients = [...(parsed.to?.value || []), ...(parsed.cc?.value || [])]
          .map(recipient => recipient.address?.toLowerCase())
          .filter(Boolean);
        return {
          providerThreadId:item.threadId?String(item.threadId):'',
          externalId: `${mailboxPath === 'INBOX' ? 'INBOX' : `MAILBOX:${mailboxPath}`}:${uidValidity}:${item.uid}`,
          subject: parsed.subject || item.envelope?.subject || 'No subject',
          fromName: sender?.name || '',
          fromAddress,
          toAddresses: [...new Set(recipients)],
          date: parsed.date?.toISOString() || item.internalDate?.toISOString() || new Date().toISOString(),
          text: (parsed.text || '').slice(0, messageSizeLimit),
          messageId: parsed.messageId || '',
          inReplyTo: parsed.inReplyTo || '',
          references: Array.isArray(parsed.references) ? parsed.references : parsed.references ? [parsed.references] : [],
          bounceReports: mailboxPath==='INBOX' ? extractBounceReports({fromAddress,text:parsed.text || '',attachments:parsed.attachments,inReplyTo:parsed.inReplyTo,references:Array.isArray(parsed.references)?parsed.references:[]}) : [],
          unread: !item.flags?.has('\\Seen')
        };
}

export async function fetchGmailConversation(email,password,{providerThreadId,messageId,beforeUid=0,afterUid=0,uidValidity:previousValidity},{client=createImapClient(email,password)}={}){
 let connected=false;
 try{
  await client.connect();connected=true;
  const folder=(await client.list()).find(f=>f.specialUse==='\\All');
  if(!folder)throw new Error('The Gmail All Mail folder is unavailable. Enable it in Gmail IMAP settings to load the complete conversation.');
  const lock=await client.getMailboxLock(folder.path,{readOnly:true,acquireTimeout:10000});
  try{
   const uidValidity=String(client.mailbox.uidValidity);
   if(beforeUid && previousValidity && previousValidity!==uidValidity)beforeUid=0;
   let threadId=providerThreadId;
   if(!threadId){
    if(!messageId)throw new Error('No message identifier is available for this conversation. Sync the inbox first.');
    const matches=await client.search({header:{'Message-ID':messageId}},{uid:true});
    if(!matches?.length)throw new Error('This conversation was not found in Gmail All Mail.');
    const message=await client.fetchOne(matches.at(-1),{threadId:true},{uid:true});threadId=message.threadId?String(message.threadId):'';
   }
   if(!threadId)throw new Error('Gmail did not return a conversation identifier.');
   const found=await client.search({threadId},{uid:true});
   const all=(found || []).sort((a,b)=>a-b);
   const eligible=all.filter(uid=>beforeUid?uid<beforeUid:previousValidity===uidValidity && afterUid?uid>afterUid:true);
   const chosen=eligible.slice(-100);
   const messages=[];for(let start=0;start<chosen.length;start+=25)messages.push(...await client.fetchAll(chosen.slice(start,start+25).join(','),{uid:true,threadId:true,envelope:true,internalDate:true,flags:true,source:{maxLength:messageSourceLimit}},{uid:true}));
   const parsed=[];for(const item of messages){if(item.source)parsed.push(await parseMailboxMessage(item,folder.path,uidValidity));}
   return {providerThreadId:threadId,uidValidity,lastUid:all.at(-1)||0,messages:parsed.sort((a,b)=>a.date.localeCompare(b.date)),more:eligible.length>chosen.length,beforeUid:eligible.length>chosen.length?chosen[0]:null};
  }finally{lock.release();}
 }finally{if(connected)await client.logout().catch(()=>{});else client.close?.();}
}
