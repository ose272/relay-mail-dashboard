let state, view='Inbox',selected=null,filter='All',query='',leadsPage=0,leadCursor='',leadCursors=[],showArchivedLeads=false,pilotMessages=[],pilotStatus='',pilotSyncing=false,replyRequestIds=new Map(),directSendRunning=false,automaticInboxSyncTimer=null,backgroundStatusTimer=null,lastInboxSyncStartedAt=0,lastAutomaticHealthCheckStartedAt=0,healthCheckRunning=false,healthCheckStatus='',backgroundStatusRefreshing=false,backgroundStatusError='',lastRenderedDay='';
const healthCheckIntervalMs=6*60*60*1000;
const app=document.querySelector('#app'),modal=document.querySelector('#modal');
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const initials=n=>n.split(/[ .@]/).filter(Boolean).slice(0,2).map(x=>x[0]).join('').toUpperCase();
const accountAvailable=a=>!a.paused&&(a.connection===undefined||a.connection==='Verified via IMAP'||a.connection==='Connected');
function localDateKey(date){if(!Number.isFinite(date.getTime()))return '';return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;}
function latestThreadTime(thread){return thread.messages.reduce((latest,message)=>{const time=Date.parse(message.time);return Number.isFinite(time)?Math.max(latest,time):latest;},0);}
function threadMessagesToday(thread){const today=localDateKey(new Date());return thread.messages.filter(message=>localDateKey(new Date(message.time))===today);}
function inboxThreads(){const today=localDateKey(new Date());return state.threads.filter(thread=>state.mode!=='cloudflare'||localDateKey(new Date(latestThreadTime(thread)))===today).sort((a,b)=>latestThreadTime(b)-latestThreadTime(a));}
function formatThreadTime(thread){const time=latestThreadTime(thread);return time?new Date(time).toLocaleTimeString([],{hour:'numeric',minute:'2-digit'}):'';}
async function api(path,body){
 const r=await fetch('/api/'+path,body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
 const contentType=r.headers.get('content-type')||'';
 if(!contentType.includes('application/json')){
  if(r.status===401||r.redirected||new URL(r.url).pathname==='/login'){window.location.assign('/login');throw Error('Your dashboard session expired. Sign in again, then retry.');}
  throw Error(`The server returned a non-JSON response (HTTP ${r.status}). Refresh the dashboard and retry.`);
 }
 let d;
 try{d=await r.json();}catch{throw Error('The server returned an invalid response. Refresh the dashboard and retry.');}
 if(!r.ok){const error=Error(d.error||`Request failed (HTTP ${r.status}).`);error.status=r.status;error.code=d.code;if(r.status===401)window.location.assign('/login');throw error;}
 return d;
}
let toastTimer;function toast(s){const el=document.querySelector('#toast');el.textContent=s;el.style.display='block';clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.style.display='none',5000);}
function resetLeadPage(){leadsPage=0;leadCursor='';leadCursors=[];}
async function refresh(){try{const params=new URLSearchParams({leadScope:showArchivedLeads?'archived':'active',leadOffset:String(leadsPage*100)});if(leadCursor)params.set('leadCursor',leadCursor);state=await api('state?'+params);render();}catch(e){if(e.status===401){window.location.assign('/login');return;}throw e;}}
const button=(label,action,primary=false)=>`<button class="${primary?'primary':''}" data-action="${action}">${label}</button>`;
function render(){lastRenderedDay=localDateKey(new Date());const visibleThreads=inboxThreads(),unread=visibleThreads.filter(t=>t.unread).length,cloud=state.mode==='cloudflare';
app.innerHTML=`<div class="layout"><aside class="sidebar"><div class="brand"><span class="brand-mark">M</span><span class="brand-copy">MyMail<small>Email outreach workspace</small></span></div><div class="eyebrow">Main Menu</div><nav>${[['Inbox','▣'],['Sending','↗'],['Leads','♧'],['Scouting plans','▤'],['Accounts','▦'],['Settings','⚙']].map(([n,i])=>`<button class="nav ${view===n?'active':''}" data-view="${n}"><span class="icon">${i}</span>${n}${n==='Inbox'&&unread?`<small>${unread}</small>`:''}</button>`).join('')}</nav><div class="sidebar-bottom"><div class="profile"><div class="avatar">KW</div><div><p>My workspace</p><small>Personal workspace</small></div></div></div></aside><main class="main"><header class="topbar"><div class="crumb"><span class="menu-glyph">☰</span><span class="crumb-workspace">Workspace</span><strong>/ ${view==='Inbox'?'Inbox':view}</strong></div><div class="top-actions"><span><i class="demo-dot"></i>${cloud?'Connected workspace':'Demo workspace'}</span><span class="avatar">KW</span></div></header><div class="content">${head()}${view==='Inbox'?inbox():view==='Leads'?leads():view==='Scouting plans'?templates():view==='Sending'?sendHistory():view==='Accounts'?accounts():settings()}<footer class="bottom-note"><span>One workspace. Every conversation.</span><span>${cloud?'Connected Gmail accounts · replies send from the receiving account':'Demo interactions · Gmail pilot is read-only · no emails sent'}</span></footer></div></main></div>`;bind();}
function directSendLabel(){const resumable=state.campaigns.some(c=>c.name==='Direct send'&&['Dry run','Sending','Scheduled','Paused','Needs review','User paused'].includes(c.status)&&c.pending>0);return resumable?'Resume sending':'Initiate sending';}
function head(){const titles={Inbox:['All your mail. One place.','Manage every conversation across your connected accounts.'],Sending:['Sending activity','Manage live outreach runs and review delivery status.'],Leads:['Your next conversation starts here.','Import, organize, and prepare the people you want to reach.'],'Scouting plans':['The right words, ready to go.','Create reusable outreach messages with a personal touch.'],Accounts:['All your senders. One workspace.','Manage availability and outreach capacity across your accounts.'],Settings:['Make Relay yours.','Set the defaults for your outreach workspace.']};return `<div class="page-head"><div><h1>${titles[view][0]}</h1><p>${titles[view][1]}</p></div><div class="actions">${view==='Inbox'||view==='Sending'?button('↗ '+directSendLabel(),'start-send',true):view==='Leads'?button('＋ Import leads','import',true):view==='Scouting plans'?button('＋ New scouting plan','template',true):''}</div></div>`;}
function stat(label,value,foot){return `<div class="stat"><div class="stat-label">${label}<span>↗</span></div><div class="stat-value">${value}</div><div class="stat-foot">${foot}</div></div>`;}
function sendProgressMarkup(embedded=false,showCompleted=false){
 const run=state.campaigns.find(campaign=>campaign.name==='Direct send'&&campaign.liveReady);
 if(!run||(!showCompleted&&!(run.pending>0)&&localDateKey(new Date(run.created))!==localDateKey(new Date())))return '';
 const planned=Math.max(0,Number(run.plannedSends||0)),sent=Math.max(0,Number(run.sent||0));
 return `<section class="send-progress${embedded?' send-progress-embedded':''}"><div class="send-progress-top"><div><strong>${embedded?'Delivery progress':`Background sending · ${esc(run.status)}`}</strong><span>${sent.toLocaleString()} sent of ${planned.toLocaleString()}</span></div><span class="send-progress-updated">Updated ${new Date().toLocaleTimeString([],{hour:'numeric',minute:'2-digit'})}</span></div><progress value="${sent}" max="${Math.max(1,planned)}" aria-label="Send progress"></progress><div class="send-progress-counts"><span>${Number(run.pending||0).toLocaleString()} queued</span><span>${Number(run.uncertain||0).toLocaleString()} needs review</span><span>${Number(run.failed||0).toLocaleString()} failed</span></div>${backgroundStatusError?`<small class="error">Live progress could not refresh: ${esc(backgroundStatusError)}</small>`:''}</section>`;
}
function inbox(){
 const cloud=state.mode==='cloudflare',threads=inboxThreads(),unread=threads.filter(thread=>thread.unread).length,needsReply=threads.filter(thread=>thread.status==='Needs reply').length;
 return `<div id="live-send-progress">${sendProgressMarkup()}</div><div class="mail-layout"><aside class="mail-folders"><div class="folder-label">Folders</div>${[['All','▣','Inbox'],['Needs reply','◷','Needs reply'],['Unread','✉','Unread'],['Sent','↗','Sent replies'],['Drafts','▤','Drafts']].map(([f,i,n])=>`<button class="folder ${filter===f?'active':''}" data-filter="${f}"><span>${i}</span>${n}${f==='All'?'<small>'+threads.length+'</small>':''}</button>`).join('')}<div class="folder-label">Your workspace</div><div class="folder-metric"><span>Sender accounts</span><strong>${state.accounts.length}</strong></div><div class="folder-metric"><span>Daily cap / account</span><strong>${state.cap}</strong></div><div class="folder-metric"><span>Awaiting reply</span><strong>${needsReply}</strong></div><div class="mail-note"><span>↗</span><strong>A little more personal.</strong><p>One inbox for every account. Keep your conversations moving.</p><button data-view="Scouting plans">Explore scouting plans →</button></div><div class="folder-label">Workspace status</div><span class="badge amber">${esc(pilotStatus||(cloud?'Gmail not synced yet':'Demo · Gmail not connected'))}</span><button data-action="sync-inbox" ${pilotSyncing?'disabled':''}>${pilotSyncing?'Syncing…':cloud?'↻ Sync connected inboxes':'↻ Sync first Gmail inbox'}</button>${cloud?'<small class="muted">Read-only sync saves messages only from leads in your directory.</small>':''}</aside><section class="panel mail-panel">${selected?`<div class="mail-toolbar"><button data-back aria-label="Back to email list">← Back to inbox</button><span class="muted">Conversation</span></div><div class="conversation">${conversation()}</div>`:`<div class="mail-toolbar"><div class="tabs">${['All','Unread','Needs reply'].map(f=>`<button class="tab ${filter===f?'active':''}" data-filter="${f}">${f==='All'?'All messages':f}</button>`).join('')}</div><span class="mail-count">${threads.length} ${cloud?'conversations today':'demo conversations'}</span></div><div class="search-wrap"><input id="search" class="search" placeholder="Search email, people, or stores…" aria-label="Search conversations" value="${esc(query)}"></div><div id="threads">${threadList()}</div><div class="list-footer">${cloud?'Connected conversations updated today.':'Demo conversations.'}<span>${threads.length} ${cloud?'threads today':'sample threads'}</span></div>`}</section></div>${pilotInbox()}`;
}
function pilotInbox(){if(state.mode==='cloudflare'||!pilotStatus)return '';return `<section class="panel pilot-inbox"><div class="panel-title"><h2>First-account Gmail inbox <span class="muted">read-only pilot</span></h2><small>${esc(pilotStatus)}</small></div>${pilotMessages.length?pilotMessages.map(message=>`<article class="message"><div class="message-meta"><span class="avatar">${initials(message.fromName||message.fromAddress||'?')}</span><div><strong>${esc(message.fromName||message.fromAddress||'Unknown sender')}</strong><br><small>${esc(message.fromAddress)}</small></div><time>${message.unread?'<span class="badge amber">Unread</span>':''} ${esc(message.date||'')}</time></div><h3>${esc(message.subject)}</h3><div class="message-body">${esc(message.text||'No plain-text message body available.')}</div></article>`).join(''):'<div class="empty"><p>No messages returned from the pilot inbox.</p></div>'}</section>`;}
function threadList(){const threads=inboxThreads().filter(t=>(filter==='All'||filter==='Unread'&&t.unread||filter==='Needs reply'&&t.status==='Needs reply'||filter==='Sent'&&(state.mode!=='cloudflare'?t.messages:threadMessagesToday(t)).some(m=>m.direction==='out')||filter==='Drafts'&&sessionStorage.getItem('draft-'+t.id))&&`${t.name} ${t.email} ${t.subject} ${t.store}`.toLowerCase().includes(query.toLowerCase()));return threads.map(t=>`<button class="thread ${t.unread?'unread':''}" data-thread="${t.id}"><span class="avatar">${initials(t.name)}</span><span class="thread-copy"><span class="thread-top"><span>${esc(t.email)} <span class="row-separator">·</span> ${esc(formatThreadTime(t))}</span><span class="unread-dot">${t.unread?'●':''}</span></span><strong>${esc(t.subject)}</strong><p>${esc(t.messages.at(-1).body.replace(/\n/g,' '))}</p><span class="row-bottom"><span class="badge ${t.status==='Needs reply'?'amber':''}">${t.status}</span><span class="sender-label">via ${esc(state.accounts.find(a=>a.id===t.accountId)?.email||'unknown account')}</span></span></span><span class="row-arrow">↗</span></button>`).join('')||`<div class="empty"><h3>${state.mode==='cloudflare'&&!inboxThreads().length?'No conversations from today yet.':'No messages here.'}</h3><p>${state.mode==='cloudflare'?'New conversations will appear here when today’s messages sync.':'Try another folder or search.'}</p></div>`;}
function conversation(){const t=inboxThreads().find(t=>t.id===selected);if(!t)return '<div class="empty"><h3>This conversation is not active today.</h3><p>It will reappear if it receives a message today.</p></div>';const a=state.accounts.find(a=>a.id===t.accountId);return `<div class="conversation-head"><div><h2>${esc(t.subject)}</h2><span class="muted">${esc(t.store)} &nbsp;·&nbsp; ${esc(t.email)}</span></div><span class="badge ${t.status==='Needs reply'?'amber':''}">${t.status}</span></div><div class="messages">${t.messages.map(m=>`<div class="message ${m.direction==='out'?'outgoing':''}"><div class="message-meta"><span class="avatar">${m.direction==='out'?'ME':initials(t.name)}</span><div><strong>${m.direction==='out'?'You':esc(t.name)}</strong><br><small>${m.direction==='out'?esc(a.email):esc(t.email)}</small></div><time>${esc(m.time)}</time></div><div class="message-body">${esc(m.body)}${m.sendState==='uncertain'?'<p class="error">Gmail did not confirm delivery. Check Sent before retrying.</p>':''}</div></div>`).join('')}</div><form id="reply-form" class="reply-box"><div class="reply-from">Replying from &nbsp;<strong>${esc(a.email)}</strong> &nbsp;⌄</div><textarea id="reply" aria-label="Your reply" placeholder="Keep the conversation going…" required>${esc(sessionStorage.getItem('draft-'+t.id)||'')}</textarea><div class="reply-footer"><span>${state.mode==='cloudflare'?'Reply sends from this verified account.':'Demo draft · no email is sent.'}</span><button class="primary" type="submit">${state.mode==='cloudflare'?'Send reply':'Save demo reply'} &nbsp;↗</button></div></form>`;}
function leads(){
 const pageSize=100,page=state.leadPage||{},allLeads=state.leads||[],paged=Boolean(state.leadPage),counts=state.leadCounts||{},filtered=paged?allLeads:allLeads.filter(lead=>(lead.status==='Archived')===showArchivedLeads),rows=paged?allLeads:filtered.slice(leadsPage*pageSize,(leadsPage+1)*pageSize),total=paged?(showArchivedLeads?Number(counts.archived||0):Number(counts.active||0)):filtered.length,start=paged?Number(page.offset||0):leadsPage*pageSize,activeCount=paged?Number(counts.active||0):allLeads.filter(lead=>lead.status!=='Archived').length,archivedCount=paged?Number(counts.archived||0):allLeads.filter(lead=>lead.status==='Archived').length,storage=state.mode==='cloudflare'?'Cloudflare D1':'this computer';
 return `<div class="notice">CSV: include an <strong>email</strong> column; optional <strong>name</strong> and <strong>store</strong> columns. TXT: one email per line. Duplicate addresses are skipped. Imports are stored in ${storage}. Lists up to 10 MB are supported. Editing updates pending sends. Deleting a lead used by a send archives it so history is preserved.</div><section class="panel"><div class="panel-title"><h2>${showArchivedLeads?'Archived leads':'Lead directory'} <span class="muted">${total} leads</span></h2><div class="actions"><button data-lead-scope="active" ${!showArchivedLeads?'disabled':''}>Active (${activeCount})</button><button data-lead-scope="archived" ${showArchivedLeads?'disabled':''}>Archived (${archivedCount})</button>${button('Download sample CSV','sample')}</div></div>${rows.length?`<div class="table-wrap"><table><thead><tr><th>Contact</th><th>Email address</th><th>Store</th><th>Status</th><th>Actions</th></tr></thead><tbody>${rows.map(lead=>`<tr><td>${esc(lead.name)||'—'}</td><td>${esc(lead.email)}</td><td>${esc(lead.store)||'—'}</td><td><span class="badge ${lead.status==='Archived'?'amber':''}">${esc(lead.status)}</span></td><td><div class="actions"><button data-edit-lead="${lead.id}">Edit</button>${lead.status==='Archived'?`<button data-restore-lead="${lead.id}">Restore</button>`:''}<button data-delete-lead="${lead.id}">Delete</button></div></td></tr>`).join('')}</tbody></table></div><div class="panel-title"><span class="muted">Showing ${start+1}–${Math.min(start+rows.length,total)} of ${total}</span><div class="actions"><button data-leads-page="-1" ${leadsPage===0?'disabled':''}>Previous</button><button data-leads-page="1" ${paged?!page.hasMore:start+pageSize>=total?'disabled':''}>Next</button></div></div>`:showArchivedLeads?'<div class="empty"><h3>No archived leads.</h3><p>Leads used by a send will appear here when deleted.</p></div>':'<div class="empty"><div class="preview-count">↥</div><h3>Meet your next opportunity.</h3><p>Bring in a lead list to start sending.</p>'+button('Import your first leads','import',true)+'</div>'}</section>${importBatches()}`;
}
function importBatches(){const batches=state.leadImportBatches||[];return `<section class="panel"><div class="panel-title"><h2>Lead uploads</h2><small>${batches.length} batches</small></div>${batches.length?`<table><thead><tr><th>Uploaded file</th><th>Leads linked</th><th>Import results</th><th>Date</th><th></th></tr></thead><tbody>${batches.map(batch=>`<tr><td>${esc(batch.fileName)}</td><td>${batch.leadCount}</td><td>${batch.importedCount} added · ${batch.duplicateCount} duplicates · ${batch.invalidCount} invalid</td><td>${esc(new Date(batch.createdAt).toLocaleString())}</td><td><button data-delete-import-batch="${batch.id}">Delete batch</button></td></tr>`).join('')}</tbody></table>`:'<div class="empty"><p>No lead uploads yet. Each uploaded file will be tracked separately.</p></div>'}</section>`;}
function templates(){
 const active=state.templates.filter(template=>!template.archivedAt),archived=state.templates.filter(template=>template.archivedAt),card=template=>`<article class="panel template"><span class="badge">${template.archivedAt?'Archived scouting plan':'Scouting plan'}</span><h3>${esc(template.name)}</h3><small>${template.subject?`Subject: ${esc(template.subject)}`:'Body only · no subject line'}</small><p>${esc(template.body)}</p><div class="actions"><button data-edit-template="${template.id}">Edit</button>${template.archivedAt?`<button data-restore-template="${template.id}">Restore</button>`:''}<button data-delete-template="${template.id}">Delete</button></div></article>`;
 return `<div class="notice">Personalize with <strong>{{name}}</strong>, <strong>{{store}}</strong> and <strong>{{email}}</strong>. Subject lines are optional; leave one blank to send body-only email. Edits update pending campaign sends. Deleting a plan used by a campaign archives it to preserve the scheduled sends and history.</div>${active.length?`<div class="grid">${active.map(card).join('')}</div>`:`<section class="panel empty"><h3>No active scouting plans.</h3><p>Create a plan to use in future campaigns.</p>${button('＋ New scouting plan','template',true)}</section>`}${archived.length?`<section class="panel"><div class="panel-title"><h2>Archived plans</h2><small>${archived.length} plans · unavailable to new campaigns</small></div><div class="grid">${archived.map(card).join('')}</div></section>`:''}`;
}
function sendCountSummary(run){let summary=String(run.plannedSends??run.assignments?.length??0);if(run.sent)summary+=` · ${run.sent} sent`;if(run.pending)summary+=` · ${run.pending} pending`;if(run.uncertain)summary+=` · ${run.uncertain} needs review`;if(run.failed)summary+=` · ${run.failed} failed${run.failureCodes?.length?` (${run.failureCodes.join(', ')})`:''}`;return summary;}
function sendStatusLabel(status){return status==='Dry run'?'Preview ready':status==='Superseded'?'Replaced by direct send':status;}
function sendHistory(){
 const runs=state.campaigns||[];
 const latest=runs.find(run=>run.name==='Direct send'&&run.liveReady)||null;
 const sent=Number(latest?.sent||0),pending=Number(latest?.pending||0),failed=Number(latest?.failed||0),uncertain=Number(latest?.uncertain||0);
 const metric=(label,value,foot,icon)=>`<article class="send-stat"><div class="send-stat-label">${label}<span aria-hidden="true">${icon}</span></div><strong>${value.toLocaleString()}</strong><small>${foot}</small></article>`;
 const notice=latest&&(uncertain||['Needs review','User paused'].includes(latest.status)||failed)
  ?`<section class="send-notice ${uncertain||latest.status==='Needs review'?'attention':''}"><span class="send-notice-icon" aria-hidden="true">!</span><div><strong>${uncertain||latest.status==='Needs review'?'Sending is paused for review':latest.status==='User paused'?'Sending is paused':'Some messages were rejected'}</strong><p>${uncertain||latest.status==='Needs review'?'Check unconfirmed messages before resuming the queued work.':latest.status==='User paused'?'Resume the queued work when you are ready.':'Review failed messages; queued work can continue independently.'}</p></div><div class="actions">${uncertain?`<button data-review-run="${latest.id}">Review ${uncertain} messages</button>`:''}${latest.pending&&['Needs review','User paused','Paused','Scheduled'].includes(latest.status)?`<button class="primary" data-resume-run="${latest.id}">Resume queued</button>`:''}</div></section>`
  :'';
 const activity=runs.length
  ?`<div class="table-wrap"><table class="send-runs-table"><thead><tr><th>Send run</th><th>Sender accounts</th><th>Result</th><th>Messages</th><th>Started</th><th>Actions</th></tr></thead><tbody>${runs.slice(0,10).map(run=>{const direct=run.name==='Direct send'&&run.liveReady,active=direct&&['Sending','Scheduled','Paused'].includes(run.status);return `<tr data-send-run="${run.id}"><td><strong>${esc(run.name)}</strong></td><td>${new Set((run.assignments||[]).map(item=>item.accountId)).size}</td><td><span class="badge ${run.status==='Complete'?'':run.status==='Sending'?'sending':''}" data-send-status>${esc(sendStatusLabel(run.status))}</span></td><td data-send-counts>${esc(sendCountSummary(run))}</td><td>${esc(new Date(run.created).toLocaleString())}</td><td><div class="actions">${direct&&run.pending&&['Needs review','User paused','Paused','Scheduled'].includes(run.status)?`<button data-resume-run="${run.id}">Resume queued</button>`:''}${active?`<button data-pause-run="${run.id}">Pause</button>`:''}${direct&&run.uncertain?`<button data-review-run="${run.id}">Review ${run.uncertain}</button>`:''}</div></td></tr>`;}).join('')}</tbody></table></div>`
  :`<div class="empty"><h3>No sends yet.</h3><p>Start sending to your pending leads with one click.</p>${button(state.mode==='cloudflare'?directSendLabel():'Initiate sending','start-send',true)}</div>`;
 const senderCount=new Set((latest?.assignments||[]).map(item=>item.accountId)).size;
 return `<div class="sending-page">${notice}<div class="send-stats">${metric('Sent',sent,'Confirmed by sender','↗')}${metric('Queued',pending,'Waiting to send','◷')}${metric('Failed',failed,'Provider rejected','×')}${metric('Needs review',uncertain,'Unconfirmed delivery','!')}</div><section class="panel sending-run-panel"><header class="sending-run-header"><span class="sending-run-icon" aria-hidden="true">↗</span><div class="sending-run-title"><h2>Direct send</h2><p>Live send · background worker${senderCount?` · ${senderCount} sender accounts`:''}</p></div>${latest?`<span class="badge ${latest.status==='Sending'?'sending':'amber'}">${esc(sendStatusLabel(latest.status))}</span><div class="actions">${latest.pending&&['Needs review','User paused','Paused','Scheduled'].includes(latest.status)?`<button data-resume-run="${latest.id}">Resume</button>`:''}${['Sending','Scheduled','Paused'].includes(latest.status)&&latest.pending?`<button data-pause-run="${latest.id}">Pause</button>`:''}</div>`:''}</header><div id="live-send-progress">${sendProgressMarkup(true,true)}</div><section class="send-activity"><div class="send-activity-header"><div><h3>Recent sending activity</h3><p>Latest runs first</p></div><button data-refresh-sends>Refresh</button></div>${activity}</section><p class="sending-footnote">Unconfirmed messages require review before retry. The background worker continues while this dashboard is closed.</p></section></div>`;
}
function accounts(){
 const connected=state.accounts.filter(a=>a.connection==='Connected').length,imapOnly=state.accounts.filter(a=>a.connection==='IMAP only').length,events=state.healthEvents||[];
 if(state.mode!=='cloudflare')return `<div class="notice">The local demo does not connect to sender accounts or run account-health checks. Use the hosted dashboard for live connection monitoring.</div><section class="panel"><div class="panel-title"><h2>Sender accounts</h2><div class="actions"><small>${state.accounts.length} demo accounts</small>${button('＋ Add sender accounts','add-accounts',true)}</div></div>${state.accounts.length?`<table><thead><tr><th>Account</th><th>Availability</th><th>Outreach cap / 24h</th><th></th></tr></thead><tbody>${state.accounts.map(a=>`<tr><td>${esc(a.email)}</td><td><span class="badge ${a.paused?'amber':''}">${a.paused?'Paused':'Available'}</span></td><td>${Math.min(40,a.cap)} <button data-cap-account="${a.id}">Edit</button></td><td><button data-account="${a.id}">${a.paused?'Resume':'Pause'}</button></td></tr>`).join('')}</tbody></table>`:'<div class="empty"><p>No demo accounts.</p></div>'}</section>`;
 return `<div class="notice">Health checks verify IMAP and SMTP connectivity every 6 hours while the dashboard is open. They can flag provider-reported restrictions and connection problems, but cannot measure sender reputation. Email alerts go to ${esc(state.healthNotificationEmail||'no address configured')}; they are sent through another healthy, verified account when available. ${healthCheckStatus?`<strong>${esc(healthCheckStatus)}</strong>`:''}</div><section class="panel"><div class="panel-title"><h2>Sender account health</h2><small>${connected} connected · ${imapOnly} IMAP only</small></div>${state.accounts.length?`<div class="table-wrap"><table><thead><tr><th>Account</th><th>Connection</th><th>Health</th><th>Outreach cap / 24h</th><th>Availability</th><th></th></tr></thead><tbody>${state.accounts.map(a=>{const health=a.healthStatus||'Unknown';return `<tr><td><div class="account-name"><span class="avatar">${initials(a.email)}</span>${esc(a.email)}</div></td><td><span class="badge ${a.connection==='Connected'?'': 'amber'}">${esc(a.connection??'Pending verification')}${a.lastSyncAt?`<br><small>Last inbox sync ${esc(new Date(a.lastSyncAt).toLocaleString())}</small>`:''}</span></td><td><span class="badge ${health==='Healthy'?'':'amber'}">${esc(health)}</span><br><small>${a.healthCheckedAt?`Checked ${esc(new Date(a.healthCheckedAt).toLocaleString())}`:'Not checked yet'}</small>${a.healthMessage&&health!=='Healthy'?`<br><small class="error">${esc(a.healthMessage)}</small>`:''}</td><td>${Math.min(40,a.cap)} <button data-cap-account="${a.id}">Edit</button></td><td><span class="badge ${a.paused?'amber':''}">${a.paused?'Paused':accountAvailable(a)?'Available':'Unverified'}</span></td><td><button data-health-check="${a.id}" ${healthCheckRunning||!a.hasCredentials?'disabled':''}>Check now</button> <button data-account="${a.id}">${a.paused?'Resume':'Pause'}</button></td></tr>`;}).join('')}</tbody></table></div>`:'<div class="empty"><h3>No sender accounts yet.</h3><p>Connect an email and its Google app password to monitor account health.</p></div>'}</section><section class="panel"><div class="panel-title"><h2>Health alert email</h2><small>${events.filter(event=>!event.readAt).length} unread notifications</small></div><form id="health-email-form"><label for="health-email">Send alerts to</label><input id="health-email" type="email" required value="${esc(state.healthNotificationEmail||'')}" placeholder="you@example.com"><p class="muted">Alerts use a different verified sender account when one is available. If none is healthy, the alert remains in the dashboard.</p><button class="primary" type="submit">Save alert address</button></form></section><section class="panel"><div class="panel-title"><h2>Health notifications</h2></div>${events.length?`<div class="table-wrap"><table><thead><tr><th>Account</th><th>Status</th><th>Details</th><th>Detected</th><th>Alert email</th><th></th></tr></thead><tbody>${events.map(event=>`<tr><td>${esc(event.accountEmail)}</td><td><span class="badge amber">${esc(event.resolvedAt?'Resolved':event.status)}</span></td><td>${esc(event.message)}</td><td>${esc(new Date(event.createdAt).toLocaleString())}</td><td>${event.emailStatus==='sent'?`Sent from ${esc(event.emailSender||'verified account')}`:`${esc(event.emailStatus||'pending')}${event.emailError?`: ${esc(event.emailError)}`:''}`}</td><td>${!event.readAt?`<button data-health-read="${event.id}">Mark read</button>`:''}${['failed','unavailable'].includes(event.emailStatus)?`<button data-health-notify="${event.id}">Retry email</button>`:''}</td></tr>`).join('')}</tbody></table></div>`:'<div class="empty"><p>No health issues detected yet.</p></div>'}</section>`;
}
function settings(){const cloud=state.mode==='cloudflare';return `<section class="panel settings"><h2>Sending defaults</h2><p class="muted">Campaign sends are hard-limited to 40 per account in any rolling 24-hour window; the configured cap can only lower this. Manual replies are tracked separately. Provider restrictions still apply.</p><form id="settings-form"><label for="cap">Default outreach cap</label><input id="cap" type="number" min="1" max="40" value="${Math.min(40,state.cap)}" required><div>${button('Save defaults','save-settings',true)}</div></form><hr><h3>Connection status</h3><p class="muted">${cloud?'Inbox sync runs every 5 minutes while this dashboard is open; use Sync connected inboxes to run it now. Replies send through the same verified Gmail account and are saved in the conversation.':'The local Gmail pilot is read-only. No messages are sent from this demo.'}</p><p class="muted">${cloud?'Account passwords are encrypted in Cloudflare D1.':'This server listens on localhost only. Data is stored on this computer in the project’s data folder.'}</p></section>`;}
function openDialog(html){modal.oncancel=null;modal.innerHTML=html;modal.showModal();modal.querySelector('[data-close]')?.addEventListener('click',()=>modal.close());}
function formDialog(title,description,fields,submit){openDialog(`<form id="dialog-form"><h2>${title}</h2><p class="muted">${description}</p>${fields}<div id="form-error" class="error" role="alert"></div><div class="actions"><button type="button" data-close>Cancel</button><button class="primary" type="submit">${submit}</button></div></form>`);}
function openTemplateForm(template=null){
 const editing=Boolean(template);
 formDialog(editing?'Edit scouting plan':'A new scouting plan.',editing?'Changes apply to pending campaign sends; already-sent messages are unchanged.':'Write your message once. Personalize it for every introduction. The subject line is optional.','<label for="plan-name">Plan name</label><input id="plan-name" required value="'+esc(template?.name||'')+'" placeholder="e.g. Store introduction"><label for="subject">Subject (optional)</label><input id="subject" value="'+esc(template?.subject||'')+'" placeholder="Leave blank for body-only email"><label for="body">Message</label><textarea id="body" required placeholder="Hi {{name}},">'+esc(template?.body||'')+'</textarea>','Save scouting plan');
 modal.querySelector('#dialog-form').onsubmit=async e=>{e.preventDefault();await submitModal(async()=>{await api(editing?'template/update':'template',{id:template?.id,name:document.querySelector('#plan-name').value,subject:document.querySelector('#subject').value,body:document.querySelector('#body').value});return editing?'Scouting plan updated; pending campaigns use the edited content.':'Scouting plan saved';});};
}
function openLeadForm(lead){
 formDialog('Edit lead','Changes apply to pending campaign sends; messages already sent are unchanged.','<label for="lead-email">Email address</label><input id="lead-email" type="email" required value="'+esc(lead.email)+'"><label for="lead-name">Name</label><input id="lead-name" value="'+esc(lead.name||'')+'"><label for="lead-store">Store / company</label><input id="lead-store" value="'+esc(lead.store||'')+'">','Save lead');
 modal.querySelector('#dialog-form').onsubmit=async e=>{e.preventDefault();await submitModal(async()=>{await api('lead/update',{id:lead.id,email:document.querySelector('#lead-email').value,name:document.querySelector('#lead-name').value,store:document.querySelector('#lead-store').value});return 'Lead updated; pending campaigns use the edited details.';});};
}
async function syncCloudInboxes(automatic=false){
 if(pilotSyncing)return;
 const accounts=state.accounts.filter(account=>['Connected','IMAP only'].includes(account.connection));
 if(!accounts.length){pilotStatus='No connected inbox accounts to sync.';render();if(!automatic)toast(pilotStatus);return;}
 pilotSyncing=true;lastInboxSyncStartedAt=Date.now();pilotStatus=automatic?'Auto-syncing inboxes…':`Syncing 0 of ${accounts.length} accounts…`;render();
 let completed=0,imported=0,more=false;const failures=[],mailboxIssues=[];
 try{
  for(let start=0;start<accounts.length;start+=3){
   const results=await Promise.all(accounts.slice(start,start+3).map(async account=>{try{return {account,result:await api('mail/sync',{accountId:account.id})};}catch(error){return {account,error};}}));
   let batchImported=0;
   for(const item of results){completed++;if(item.error)failures.push({account:item.account,error:item.error});else{batchImported+=item.result.imported||0;more=more||item.result.more;if(item.result.inboxError)mailboxIssues.push(`${item.account.email}: ${item.result.inboxError}`);if(item.result.sentError)mailboxIssues.push(`${item.account.email}: ${item.result.sentError}`);}}
   imported+=batchImported;
   pilotStatus=`${automatic?'Auto-syncing':'Syncing'} ${completed} of ${accounts.length} accounts…`;
   render();
  }
  if(failures.some(item=>item.error.status===401)){window.location.assign('/login');return;}
  await refresh();
  const issueCount=failures.length+mailboxIssues.length,issueDetails=[...failures.slice(0,2).map(item=>`${item.account.email}: ${item.error.message}`),...mailboxIssues.slice(0,2)];
  const issues=issueCount?` · ${issueDetails.join('; ')}${issueCount>issueDetails.length?'; more issues':''}`:'';
  pilotStatus=`${automatic?'Auto-sync':'Manual sync'} ${issueCount?`finished with ${issueCount} issue${issueCount===1?'':'s'}`:'complete'} · ${imported} new messages · ${new Date().toLocaleTimeString()}${more?' · more messages remain':''}${issues}`;
  if(!automatic)toast(pilotStatus);
 }catch(error){
  if(error.status===401){window.location.assign('/login');return;}
  pilotStatus=`${automatic?'Auto-sync':'Manual sync'} failed: ${error.message}`;
  if(!automatic)toast(pilotStatus);
 }finally{pilotSyncing=false;render();if(automatic)void runAutomaticHealthChecks();}
}
async function syncPilotInbox(){
 if(state.mode==='cloudflare')return syncCloudInboxes();
 pilotSyncing=true;pilotStatus='Connecting to the pilot inbox…';render();
 try{const result=await api('mail/sync',{});pilotMessages=result.messages;pilotStatus=`Synced ${result.messages.length} messages from ${result.email} · read-only`;}
 catch(error){pilotStatus=`Inbox sync failed: ${error.message}`;toast(error.message);}
 finally{pilotSyncing=false;render();}
}
async function runAutomaticInboxSync(){
 if(state?.mode!=='cloudflare'||document.visibilityState!=='visible'||pilotSyncing||healthCheckRunning||Date.now()-lastInboxSyncStartedAt<300_000)return;
 await syncCloudInboxes(true);
}
async function runAccountHealthChecks(accounts,force=false,automatic=false){
 if(healthCheckRunning||!accounts.length)return;
 healthCheckRunning=true;render();
 const previousEvents=new Set((state.healthEvents||[]).map(event=>event.id)),failures=[],checked=[];
 try{
  for(let start=0;start<accounts.length;start+=3){
   const results=await Promise.all(accounts.slice(start,start+3).map(async account=>{try{return {account,result:await api('account/health/check',{accountId:account.id,force})};}catch(error){return {account,error};}}));
   for(const item of results){if(item.error)failures.push({account:item.account,error:item.error});else if(item.result.checked)checked.push(`${item.account.email}: ${item.result.healthStatus}`);}
  }
  if(failures.some(item=>item.error.status===401)){window.location.assign('/login');return;}
  await refresh();
  const newEvents=(state.healthEvents||[]).filter(event=>!previousEvents.has(event.id)&&!event.readAt);
  const failureText=failures.slice(0,2).map(item=>`${item.account.email}: ${item.error.message}`).join('; ');
  if(newEvents.length){
   healthCheckStatus=`${newEvents.length} new account issue${newEvents.length===1?'':'s'} detected.`;
   toast(`${healthCheckStatus} Review Accounts.`);
  }else if(failures.length){
   healthCheckStatus=`${failures.length} health check${failures.length===1?'':'s'} failed${failureText?`: ${failureText}`:''}`;
   toast(healthCheckStatus);
  }else{
   healthCheckStatus=`Last checked ${new Date().toLocaleString()}.`;
   if(!automatic)toast(checked.join(' · ')||'Health check completed; no new check was due.');
  }
 }catch(error){
  if(error.status===401){window.location.assign('/login');return;}
  healthCheckStatus=`Health check failed: ${error.message}`;
  toast(healthCheckStatus);
 }finally{healthCheckRunning=false;render();}
}
async function runAutomaticHealthChecks(){
 if(state?.mode!=='cloudflare'||document.visibilityState!=='visible'||pilotSyncing||healthCheckRunning)return;
 const now=Date.now();
 if(now-lastAutomaticHealthCheckStartedAt<healthCheckIntervalMs)return;
 const due=state.accounts.filter(account=>account.hasCredentials&&(!account.healthCheckedAt||!Number.isFinite(Date.parse(account.healthCheckedAt))||now-Date.parse(account.healthCheckedAt)>=healthCheckIntervalMs));
 if(due.length){lastAutomaticHealthCheckStartedAt=now;await runAccountHealthChecks(due,false,true);}
}
function runAutomaticSyncCycle(){
 if(document.visibilityState!=='visible')return;
 void (async()=>{await runAutomaticInboxSync();await runAutomaticHealthChecks();})();
}
function startAutomaticInboxSync(){
 if(state?.mode!=='cloudflare'||automaticInboxSyncTimer)return;
 automaticInboxSyncTimer=setInterval(runAutomaticSyncCycle,300_000);
 document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')runAutomaticSyncCycle();});
 runAutomaticSyncCycle();
}
async function action(a){if(a==='import'){formDialog('Bring your leads along.','Choose a CSV or TXT file, up to 10 MB. Addresses are checked for format and duplicates.','<label for="lead-file">Lead file</label><input id="lead-file" type="file" accept=".csv,.txt,text/csv,text/plain" required>','Import leads');modal.querySelector('form').onsubmit=async e=>{e.preventDefault();await submitModal(async()=>{const f=document.querySelector('#lead-file').files[0];if(f.size>10_000_000)throw Error('Maximum file size is 10 MB.');const r=await api('import',{text:await f.text(),fileName:f.name});resetLeadPage();return `${r.imported} imported · ${r.duplicates} duplicates skipped · ${r.invalid} invalid`;});};}
if(a==='add-accounts'){if(state.mode==='cloudflare'){formDialog('Connect a Gmail account','Use a Google app password, not your normal Google password. We verify inbox and reply access without sending a message.','<label for="account-email">Gmail address</label><input id="account-email" type="email" autocomplete="email" required placeholder="name@gmail.com"><label for="account-password">Google app password</label><input id="account-password" type="password" autocomplete="new-password" minlength="16" maxlength="19" required placeholder="16 characters"><p class="muted">The app password is encrypted before it is saved. Spaces are ignored.</p>','Connect account');modal.querySelector('form').onsubmit=async e=>{e.preventDefault();await submitModal(async()=>{const r=await api('account/connect',{email:document.querySelector('#account-email').value,appPassword:document.querySelector('#account-password').value});return r.smtpVerified?'Inbox and reply access verified':'Inbox verified; SMTP reply access could not be verified';});};}else{formDialog('Add sender accounts','Paste one email address per line. This only adds addresses to the local demo.','<label for="account-emails">Email addresses</label><textarea id="account-emails" required placeholder="name@example.com&#10;another@example.com"></textarea>','Add accounts');modal.querySelector('form').onsubmit=async e=>{e.preventDefault();await submitModal(async()=>{const r=await api('account/add',{text:document.querySelector('#account-emails').value});return `${r.added} added · ${r.duplicates} duplicates skipped · ${r.invalid} invalid`;});};}}
if(a==='template')return openTemplateForm();
if(a==='start-send')return initiateSending();
if(a==='sync-inbox')return syncPilotInbox();
if(a==='sample'){const blob=new Blob(['email,name,store\nalex@example.com,Alex,Example Store\nsam@example.com,Sam,Sample Goods'],{type:'text/csv'});const url=URL.createObjectURL(blob);const link=document.createElement('a');link.href=url;link.download='relay-sample-leads.csv';link.click();URL.revokeObjectURL(url);}}
async function submitModal(fn){const b=modal.querySelector('[type=submit]');b.disabled=true;try{const text=await fn();modal.close();await refresh();toast(text);}catch(e){modal.querySelector('#form-error').textContent=e.message;}finally{b.disabled=false;}}
async function initiateSending(){
 if(state.mode!=='cloudflare'){toast('Real email sending is available only in the hosted dashboard. No email was sent in demo mode.');return;}
 if(directSendRunning)return;
 directSendRunning=true;
 try{
  const active=state.campaigns.find(c=>c.name==='Direct send'&&c.liveReady&&['Sending','Scheduled','Paused','Needs review','User paused'].includes(c.status)&&c.pending>0);
  if(active){
   if(['Needs review','User paused','Paused'].includes(active.status)){
    const warning=active.uncertain
     ?`Resume ${active.pending} queued messages? ${active.uncertain} unconfirmed message(s) will remain blocked and will not be retried.`
     :`Resume ${active.pending} queued messages in the background?`;
    if(!window.confirm(warning))return;
   }
   await api('campaign/resume-pending',{campaignId:active.id});
   await refresh();
   toast(`Background sending is active · ${active.pending} queued messages${active.uncertain?` · ${active.uncertain} unconfirmed remain blocked`:''}.`);
  }else{
   const started=await api('sending/start',{});
   await refresh();
   toast(started.resumed
    ?`Background sending is active · ${started.pending} messages queued.`
    :`Background sending started · ${started.plannedSends} messages queued.`);
  }
 }catch(error){toast(error.message);}
 finally{
  directSendRunning=false;
 }
}
async function pauseBackgroundRun(campaignId){
 if(!window.confirm('Pause background sending? Any email already in progress may still finish.'))return;
 try{await api('campaign/pause',{campaignId});await refresh();toast('Background sending paused.');}catch(error){toast(error.message);}
}
async function reviewUncertainRun(campaignId){
 try{
  const result=await api('campaign/uncertain',{campaignId});
  const deliveries=result.deliveries||[];
  if(!deliveries.length){await refresh();toast('No unconfirmed messages remain.');return;}
  openDialog(`<h2>Unconfirmed messages</h2><p class="muted">Check the sender’s Sent folder before retrying. Retrying an unconfirmed email can create a duplicate if the original was delivered.</p><div class="uncertain-list">${deliveries.map(item=>`<article><strong>${esc(item.recipient)}</strong><small>From ${esc(item.sender)} · ${esc(item.started_at?new Date(item.started_at).toLocaleString():'time unavailable')} · ${esc(item.last_error||'No delivery confirmation')}</small><button data-retry-delivery="${item.id}">Retry with duplicate risk</button></article>`).join('')}</div><div class="actions"><button type="button" data-close>Close</button></div>`);
  modal.querySelectorAll('[data-retry-delivery]').forEach(button=>button.onclick=async()=>{
   if(!window.confirm('Retry this message now? It may duplicate an email that was already delivered.'))return;
   button.disabled=true;
   try{await api('campaign/retry-uncertain',{deliveryId:button.dataset.retryDelivery});modal.close();await refresh();toast('Retry queued. The background sender will process it shortly.');}
   catch(error){toast(error.message);button.disabled=false;}
  });
 }catch(error){toast(error.message);}
}
function confirmRecordDelete(kind,id){
 const isLead=kind==='lead',record=(isLead?state.leads:state.templates).find(item=>item.id===id);
 if(!record)return;
 const label=isLead?record.email:record.name;
 openDialog(`<h2>Delete ${isLead?'lead':'scouting plan'}?</h2><p class="muted">Delete <strong>${esc(label)}</strong>? If it is referenced by a campaign, it will be archived instead so queued sends and campaign history remain intact.</p><div id="delete-error" class="error" role="alert"></div><div class="actions"><button type="button" data-close>Cancel</button><button type="button" class="primary" data-confirm-delete>Delete</button></div>`);
 modal.querySelector('[data-confirm-delete]').onclick=async event=>{const button=event.currentTarget;button.disabled=true;try{const result=await api(isLead?'lead/delete':'template/delete',{id});modal.close();await refresh();toast(result.archived?`${isLead?'Lead':'Scouting plan'} archived to preserve campaign history.`:`${isLead?'Lead':'Scouting plan'} deleted.`);}catch(error){modal.querySelector('#delete-error').textContent=error.message;button.disabled=false;}};
}
function confirmImportBatchDelete(batchId){
 const batch=(state.leadImportBatches||[]).find(item=>item.id===batchId);
 if(!batch)return;
 openDialog(`<h2>Delete this upload batch?</h2><p class="muted">Remove <strong>${esc(batch.fileName)}</strong> and its batch record? Leads also present in another upload stay in the directory. Leads referenced by send history are archived; other leads in this batch are deleted.</p><div id="batch-delete-error" class="error" role="alert"></div><div class="actions"><button type="button" data-close>Cancel</button><button type="button" class="primary" data-confirm-batch-delete>Delete batch</button></div>`);
 modal.querySelector('[data-confirm-batch-delete]').onclick=async event=>{const button=event.currentTarget;button.disabled=true;try{const result=await api('import/batch/delete',{batchId});modal.close();await refresh();toast(`Batch deleted · ${result.deleted} leads deleted · ${result.archived} archived · ${result.retained} retained in other uploads.`);}catch(error){modal.querySelector('#batch-delete-error').textContent=error.message;button.disabled=false;}};
}
function confirmUncertainReply(threadId,requestId,text){
 openDialog(`<h2>Retry this reply?</h2><p class="muted">Gmail did not confirm whether the original attempt was delivered. Retrying will send the same reply again and could create a duplicate in the recipient’s inbox.</p><div id="reply-retry-error" class="error" role="alert"></div><div class="actions"><button type="button" data-close>Cancel</button><button type="button" class="primary" data-retry-reply>Send again anyway</button></div>`);
 modal.querySelector('[data-retry-reply]').onclick=async event=>{const button=event.currentTarget;button.disabled=true;try{const result=await api('reply',{id:threadId,text,requestId,retryUncertain:true});sessionStorage.removeItem('draft-'+threadId);sessionStorage.removeItem('reply-request-'+threadId);sessionStorage.removeItem('reply-payload-'+threadId);modal.close();await refresh();toast(`Reply sent from ${result.account}.`);}catch(error){modal.querySelector('#reply-retry-error').textContent=error.message;button.disabled=false;}};
}
function bind(){
 document.querySelector('[data-back]')?.addEventListener('click',()=>{selected=null;render();});
 document.querySelectorAll('[data-view]').forEach(b=>b.onclick=()=>{view=b.dataset.view;query='';render();});
 document.querySelectorAll('[data-action]').forEach(b=>{if(b.dataset.action!=='save-settings')b.onclick=()=>action(b.dataset.action);});
 document.querySelector('[data-refresh-sends]')?.addEventListener('click',async()=>{try{await refresh();}catch(error){toast(error.message);}});
 document.querySelectorAll('[data-pause-run]').forEach(b=>b.onclick=()=>pauseBackgroundRun(b.dataset.pauseRun));
 document.querySelectorAll('[data-review-run]').forEach(b=>b.onclick=()=>reviewUncertainRun(b.dataset.reviewRun));
 document.querySelectorAll('[data-resume-run]').forEach(b=>b.onclick=async()=>{
  const run=state.campaigns.find(item=>item.id===b.dataset.resumeRun);
  if(!run)return;
  const warning=run.uncertain
   ?`Resume ${run.pending} queued messages? ${run.uncertain} unconfirmed message(s) will remain blocked and will not be retried.`
   :`Resume ${run.pending} queued messages in the background?`;
  if(!window.confirm(warning))return;
  b.disabled=true;
  try{await api('campaign/resume-pending',{campaignId:run.id});await refresh();toast('Background sending resumed.');}
  catch(error){toast(error.message);b.disabled=false;}
 });
 bindThreads();
 document.querySelectorAll('[data-filter]').forEach(b=>b.onclick=()=>{filter=b.dataset.filter;selected=null;render();});
 document.querySelectorAll('[data-leads-page]').forEach(b=>b.onclick=async()=>{const direction=Number(b.dataset.leadsPage),page=state.leadPage||{};if(direction>0&&page.nextCursor){leadCursors.push(leadCursor);leadCursor=page.nextCursor;leadsPage++;}else if(direction<0&&leadsPage>0){leadCursor=leadCursors.pop()||'';leadsPage--;}else{return;}try{await refresh();}catch(error){toast(error.message);}});
 document.querySelectorAll('[data-lead-scope]').forEach(b=>b.onclick=async()=>{showArchivedLeads=b.dataset.leadScope==='archived';resetLeadPage();try{await refresh();}catch(error){toast(error.message);}});
 document.querySelectorAll('[data-edit-lead]').forEach(b=>b.onclick=()=>{const lead=state.leads.find(item=>item.id===b.dataset.editLead);if(lead)openLeadForm(lead);});
 document.querySelectorAll('[data-delete-lead]').forEach(b=>b.onclick=()=>confirmRecordDelete('lead',b.dataset.deleteLead));
 document.querySelectorAll('[data-delete-import-batch]').forEach(b=>b.onclick=()=>confirmImportBatchDelete(b.dataset.deleteImportBatch));
 document.querySelectorAll('[data-restore-lead]').forEach(b=>b.onclick=async()=>{try{await api('lead/restore',{id:b.dataset.restoreLead});showArchivedLeads=false;resetLeadPage();await refresh();toast('Lead restored and available for future campaigns.');}catch(error){toast(error.message);}});
 document.querySelectorAll('[data-edit-template]').forEach(b=>b.onclick=()=>{const template=state.templates.find(item=>item.id===b.dataset.editTemplate);if(template)openTemplateForm(template);});
 document.querySelectorAll('[data-delete-template]').forEach(b=>b.onclick=()=>confirmRecordDelete('template',b.dataset.deleteTemplate));
 document.querySelectorAll('[data-restore-template]').forEach(b=>b.onclick=async()=>{try{await api('template/restore',{id:b.dataset.restoreTemplate});await refresh();toast('Scouting plan restored for future campaigns.');}catch(error){toast(error.message);}});
 document.querySelector('#search')?.addEventListener('input',e=>{query=e.target.value;document.querySelector('#threads').innerHTML=threadList();bindThreads();});
 document.querySelector('#reply')?.addEventListener('input',e=>sessionStorage.setItem('draft-'+selected,e.target.value));
 document.querySelector('#reply-form')?.addEventListener('submit',async e=>{
  e.preventDefault();
  const button=e.submitter,threadId=selected,text=document.querySelector('#reply').value.trim(),requestKey='reply-request-'+threadId,payloadKey='reply-payload-'+threadId;
  button.disabled=true;
  try{
   let requestId=state.mode==='cloudflare'?sessionStorage.getItem(requestKey):null;
   const savedText=state.mode==='cloudflare'?sessionStorage.getItem(payloadKey):null;
   if(!requestId||savedText!==null&&savedText!==text){requestId=crypto.randomUUID();if(state.mode==='cloudflare'){sessionStorage.setItem(requestKey,requestId);sessionStorage.setItem(payloadKey,text);}}
   else if(state.mode==='cloudflare'&&savedText===null)sessionStorage.setItem(payloadKey,text);
   const result=await api('reply',{id:threadId,text,requestId});
   sessionStorage.removeItem('draft-'+threadId);sessionStorage.removeItem(requestKey);sessionStorage.removeItem(payloadKey);
   await refresh();toast(state.mode==='cloudflare'?`Reply sent from ${result.account}.`:`Demo reply saved from ${result.account}. No email sent.`);
  }catch(error){
   button.disabled=false;
   if(error.code==='REPLY_UNCERTAIN'&&state.mode==='cloudflare'){
    const requestId=sessionStorage.getItem(requestKey),savedText=sessionStorage.getItem(payloadKey);
    if(requestId&&savedText!==null)confirmUncertainReply(threadId,requestId,savedText);
    else toast(error.message);
   }else toast(error.message);
  }
 });
 document.querySelectorAll('[data-account]').forEach(b=>b.onclick=async()=>{try{await api('account',{id:b.dataset.account});await refresh();}catch(e){toast(e.message);}});
 document.querySelectorAll('[data-cap-account]').forEach(b=>b.onclick=()=>{const account=state.accounts.find(a=>a.id===b.dataset.capAccount);if(!account)return;formDialog('Edit account quota','Maximum campaign outreach per account in a rolling 24-hour window.','<label for="account-cap">Messages per 24 hours</label><input id="account-cap" type="number" min="1" max="40" required value="'+Math.min(40,account.cap)+'">','Save quota');modal.querySelector('#dialog-form').onsubmit=async e=>{e.preventDefault();await submitModal(async()=>{await api('account/cap',{id:account.id,cap:document.querySelector('#account-cap').value});return 'Account quota updated';});};});
 document.querySelectorAll('[data-health-check]').forEach(b=>b.onclick=()=>{const account=state.accounts.find(item=>item.id===b.dataset.healthCheck);if(account)void runAccountHealthChecks([account],true,false);});
 document.querySelectorAll('[data-health-read]').forEach(b=>b.onclick=async()=>{try{await api('account/health/read',{eventId:b.dataset.healthRead});await refresh();}catch(error){toast(error.message);}});
 document.querySelectorAll('[data-health-notify]').forEach(b=>b.onclick=async()=>{b.disabled=true;try{const result=await api('account/health/notify',{eventId:b.dataset.healthNotify});await refresh();toast(result.status==='sent'?`Health alert email sent from ${result.sender}.`:result.status==='unavailable'?'No healthy sender is available; alert remains in the dashboard.':'Health alert remains in the dashboard. Check its recipient configuration.');}catch(error){toast(error.message);b.disabled=false;}});
 document.querySelector('#health-email-form')?.addEventListener('submit',async e=>{e.preventDefault();const form=e.currentTarget,button=form.querySelector('[type=submit]');button.disabled=true;try{await api('account/health/settings',{email:form.querySelector('#health-email').value});await refresh();toast('Health alert email address saved.');}catch(error){toast(error.message);}finally{button.disabled=false;}});
 document.querySelector('#settings-form')?.addEventListener('submit',async e=>{e.preventDefault();try{await api('settings',{cap:document.querySelector('#cap').value});await refresh();toast('Default cap updated for all accounts');}catch(e){toast(e.message);}});
}
function bindThreads(){document.querySelectorAll('[data-thread]').forEach(b=>b.onclick=async()=>{selected=b.dataset.thread;try{const result=await api('thread?id='+encodeURIComponent(selected));const index=state.threads.findIndex(thread=>thread.id===selected);if(index>=0){state.threads[index]=result.thread;await api('read',{id:selected});state.threads[index].unread=false;}render();}catch(e){toast(e.message);}});}
async function refreshSendingStatus(){
 if(state?.mode!=='cloudflare'||document.visibilityState!=='visible'||backgroundStatusRefreshing)return;
 const latest=state.campaigns.find(campaign=>campaign.name==='Direct send'&&campaign.liveReady);
 if(!latest||view!=='Sending'&&!(latest.pending>0))return;
 backgroundStatusRefreshing=true;
 try{
  const result=await api('sending/status');
  for(const update of result.runs||[]){
   const campaign=state.campaigns.find(item=>item.id===update.id);
   if(campaign)Object.assign(campaign,update);
   const row=[...document.querySelectorAll('[data-send-run]')].find(item=>item.dataset.sendRun===update.id);
   if(row){row.querySelector('[data-send-counts]').textContent=sendCountSummary(update);row.querySelector('[data-send-status]').textContent=sendStatusLabel(update.status);}
  }
  backgroundStatusError='';
  if(view==='Sending')render();
 }catch(error){
  if(error.status===401){window.location.assign('/login');return;}
  backgroundStatusError=error.message;
 }finally{
  backgroundStatusRefreshing=false;
  const progress=document.querySelector('#live-send-progress');
  if(progress)progress.innerHTML=sendProgressMarkup();
 }
}
function startBackgroundStatusRefresh(){
 if(backgroundStatusTimer)return;
 backgroundStatusTimer=setInterval(()=>{
  if(document.visibilityState!=='visible')return;
  const day=localDateKey(new Date());
  if(view==='Inbox'&&day!==lastRenderedDay)render();
  void refreshSendingStatus();
 },10_000);
}
refresh().then(()=>{startAutomaticInboxSync();startBackgroundStatusRefresh();}).catch(e=>{app.innerHTML='<div class="empty"><h1>Relay could not load.</h1><p>Please restart the local server and refresh.</p></div>';toast(e.message);});
