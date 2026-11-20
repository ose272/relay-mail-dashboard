import {messageTextOnly} from './message-text';
import type { ConnectedAccount, InboxThread, Lead, ScoutingPlan, SendingState } from '../types/maildash';
export class ApiError extends Error { constructor(message: string, public status: number, public code = '') { super(message); } }
export async function api(path: string, body?: unknown): Promise<any> {
  const response = await fetch(`/api/${path}`, { credentials: 'same-origin', cache: 'no-store', ...(body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) });
  const data = await response.json().catch(() => { throw new ApiError('The server returned an invalid response. Please reload.', response.status); });
  if (!response.ok) throw new ApiError(data.error || 'Request failed', response.status, data.code);
  return data;
}
export const csv = (rows: unknown[][]) => rows.map(row => row.map(value => `"${String(value ?? '').replaceAll('"', '""')}"`).join(',')).join('\n');
export const formatTime = (value?: string) => value ? new Date(value).toLocaleString('en-GB', { timeZone: 'Africa/Lagos', dateStyle: 'medium', timeStyle: 'short' }) : 'Not synced';
export const lagosDay = (value: string) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Lagos', year:'numeric', month:'2-digit', day:'2-digit' }).format(new Date(value));
export function mapAccount(a: any): ConnectedAccount {
 return { id:a.id, email:a.email, displayName:a.email.split('@')[0], provider:'Google Workspace', status:a.paused ? 'Paused' : a.connection === 'Connected' && !['Warning','Problem','Restricted'].includes(a.healthStatus) ? 'Connected' : 'Needs attention', sentToday:Number(a.used || 0), dailyLimit:Number(a.cap), warmupEnabled:false, deliverabilityScore:0, spfValid:false, dkimValid:false, dmarcValid:false, lastSynced:formatTime(a.lastSyncAt), healthStatus:a.healthStatus || 'Unknown', healthMessage:a.healthMessage || '', connection:a.connection, hasCredentials:!!a.hasCredentials };
}
export function mapThread(t: any, accounts: any[]): InboxThread {
 const account = accounts.find(a=>a.id === t.accountId); const latest=t.messages?.at(-1);
 return { id:t.id, historyBeforeUid:t.historyBeforeUid, contactName:t.name || t.email, contactEmail:t.email, company:t.store || '', role:'', accountEmail:account?.email || '', planName:'', subject:t.subject || '(No subject)', snippet:messageTextOnly(latest?.body || ''), timestamp:formatTime(latest?.time), inboundDay:t.inboundDay || (latest?.direction === 'in' ? lagosDay(latest.time) : ''), unread:!!t.unread, starred:!!t.starred, archived:!!t.archived, tag:t.tag || (t.status === 'Needs reply' ? 'Question' : 'Follow up'), messages:(t.messages || []).map((m:any,i:number)=>({ id:m.id || `${t.id}-${i}`, senderName:m.senderName || (m.direction === 'out' ? account?.email || '' : t.name || t.email), senderEmail:m.senderEmail || (m.direction === 'out' ? account?.email || '' : t.email), isOutbound:m.direction === 'out', body:messageTextOnly(m.body || '') || 'No new message text.', timestamp:formatTime(m.time), sendState:m.sendState })) };
}
export const mapLead = (l:any): Lead => ({ id:l.id, name:l.name || '', email:l.email, company:l.store || '', role:'', listName:'', status:l.status === 'Archived' ? 'Paused' : 'Ready', planName:'Unassigned', lastActivity:'', verified:false });
export const mapPlan = (t:any): ScoutingPlan => ({ id:t.id, name:t.name, description:t.body, status:t.archivedAt ? 'Paused' : 'Active', scheduleWindow:'Automatic sender allocation', timezone:'Africa/Lagos', senderAccount:'Workspace senders', enrolledCount:0, sentCount:0, replyRate:0, steps:[{id:`${t.id}-1`, stepNumber:1, dayOffset:0, subject:t.subject || '', preview:t.body, replyRate:0}], nextRun:t.archivedAt ? 'Excluded from new sends' : 'Available for new sends' });
export const emptySending: SendingState = { status:'paused', runTitle:'No active campaign', runSubtitle:'Import leads and create a scouting plan to begin.', sentCount:0, queuedCount:0, failedCount:0, needsReviewCount:0, plannedTotal:0, records:[] };
export function mapSending(run:any, deliveries:any[]=[]): SendingState {
 if (!run) return emptySending;
 return { id:run.id, backendStatus:run.status, inFlight:Number(run.inFlight || 0), nextSendAt:run.nextSendAt, updatedAt:Date.now(), status:['Sending','Scheduled','Preparing'].includes(run.status) ? 'running' : ['Complete','Superseded','Cancelled'].includes(run.status) ? 'completed' : 'paused', runTitle:'Direct send', runSubtitle:run.status, sentCount:Number(run.sent || 0), queuedCount:Number(run.pending || 0), failedCount:Number(run.failed || 0), cancelledCount:Number(run.cancelled || 0), needsReviewCount:Number(run.uncertain || 0), plannedTotal:Number(run.plannedSends || 0), records:deliveries.map(d=>({ id:d.id, recipient:d.recipient, recipientName:d.name || d.recipient, sender:d.sender, subject:d.subject || '', result:d.status === 'sent' ? 'Sent' : d.status === 'failed' ? 'Failed' : ['uncertain','sending'].includes(d.status) ? 'Needs review' : 'Queued', time:formatTime(d.sent_at || d.started_at || d.created_at), timestampMs:Date.parse(d.sent_at || d.started_at || d.created_at) || 0, planName:d.plan_name || '', diagnosticNote:d.last_error || '' })) };
}

export interface ImportProgress { phase:string; completed:number; total:number|null; result?:{imported:number;duplicates:number;invalid:number;batchId:string};error?:string; }
export async function importWithProgress(fileName:string,text:string,onProgress:(event:ImportProgress)=>void) {
 onProgress({phase:'uploading and validating',completed:0,total:null});
 const response=await fetch('/api/import/progress',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({fileName,text})});
 if(!response.ok){const data=await response.json().catch(()=>({}));throw new ApiError(data.error || 'Import failed',response.status);}
 if(!response.body)throw new Error('Import progress is unavailable. Refresh before retrying.');
 const reader=response.body.getReader(),decoder=new TextDecoder();let buffer='',result:ImportProgress['result'];
 const consume=(line:string)=>{if(!line.trim())return;const event:ImportProgress=JSON.parse(line);if(event.phase==='error')throw new Error(event.error);onProgress(event);if(event.phase==='complete')result=event.result;};
 try{for(;;){const {done,value}=await reader.read();if(done)break;buffer+=decoder.decode(value,{stream:true});let newline;while((newline=buffer.indexOf('\n'))>=0){consume(buffer.slice(0,newline));buffer=buffer.slice(newline+1);}}buffer+=decoder.decode();if(buffer.trim())consume(buffer);}finally{reader.releaseLock();}
 if(!result)throw new Error('Import confirmation was interrupted. Refresh the batch list before retrying.');return result;
}
