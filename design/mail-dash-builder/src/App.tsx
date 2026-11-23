import {NotificationsPage} from './pages/NotificationsPage';
import {runSyncPool} from './lib/sync-pool';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ConnectedAccount, InboxThread, Lead, LeadBatch, NavPage, ScoutingPlan, WorkspaceProfile, WorkspaceSettings, ThreadTag } from './types/maildash';
import { api, ApiError, importWithProgress, type ImportProgress, csv, emptySending, mapAccount, mapLead, mapPlan, mapSending, mapThread } from './lib/api';
import { Sidebar } from './components/layout/Sidebar';
import { TopBar } from './components/layout/TopBar';
import { DashboardPage } from './pages/DashboardPage';
import { InboxPage } from './pages/InboxPage';
import { SendingPage } from './pages/SendingPage';
import { LeadsPage } from './pages/LeadsPage';
import { ScoutingPlansPage } from './pages/ScoutingPlansPage';
import { AccountsPage } from './pages/AccountsPage';
import { SettingsPage } from './pages/SettingsPage';

const navigationPages:NavPage[]=['dashboard','inbox','sending','leads','scouting-plans','accounts','notifications','settings'];
function pageFromLocation():NavPage{const hash=window.location.hash.slice(1).split('/')[0];if(hash==='conversation')return 'inbox';if(navigationPages.includes(hash as NavPage))return hash as NavPage;const saved=sessionStorage.getItem('relay-active-page');return navigationPages.includes(saved as NavPage)?saved as NavPage:'sending';}
export default function App() {
 const [activePage,setActivePage]=useState<NavPage>(pageFromLocation);
 useEffect(()=>{sessionStorage.setItem('relay-active-page',activePage);if(activePage==='inbox' && window.location.hash.startsWith('#conversation/'))return;if(window.location.hash!=='#'+activePage)window.history.replaceState({...window.history.state,relayConversation:false},'','#'+activePage);},[activePage]);
 useEffect(()=>{const pop=()=>setActivePage(pageFromLocation());window.addEventListener('popstate',pop);return()=>window.removeEventListener('popstate',pop);},[]);
 const [theme,setTheme]=useState<'light'|'dark'>(()=>localStorage.getItem('relay-theme') === 'dark' ? 'dark':'light');
 const [mobileMenuOpen,setMobileMenuOpen]=useState(false);
 const [activeWorkspace,setActiveWorkspace]=useState<WorkspaceProfile>({id:'relay',name:'Relay Mail',subtitle:'Production workspace',ownerName:'Workspace owner',ownerEmail:'',avatarUrl:''});
 const [sendingState,setSendingState]=useState(emptySending);
 const [threads,setThreads]=useState<InboxThread[]>([]), [selectedThreadId,setSelectedThreadId]=useState('');
 const [leads,setLeads]=useState<Lead[]>([]), [leadBatches,setLeadBatches]=useState<LeadBatch[]>([]);
 const [plans,setPlans]=useState<ScoutingPlan[]>([]), [accounts,setAccounts]=useState<ConnectedAccount[]>([]);
 const [settings,setSettings]=useState<WorkspaceSettings>({workspaceName:'Relay Mail',timezone:'Africa/Lagos',dailyWorkspaceCap:40,delayBetweenSendsSec:0,maxRetries:3,stopOnReply:true,openTracking:false,linkTracking:false,unsubscribeFooter:false,customTrackingDomain:'',signature:'',notifyOnReply:false,notifyOnBouncePause:false,dailyDigestTime:'',planOpenTracking:false,includeSpamFolders:false});
 const [leadTotal,setLeadTotal]=useState(0), [campaignCount,setCampaignCount]=useState(0),[leadPage,setLeadPage]=useState<any>({});
 const [importProgress,setImportProgress]=useState<ImportProgress|null>(null);
 const [usageBlocked,setUsageBlocked]=useState(false);
 const [notice,setNotice]=useState('');
 const [syncHadErrors,setSyncHadErrors]=useState(false);
 const failedSyncAccounts=useRef(new Set<string>()),lastSyncIncludeSent=useRef(false);
 const [conversationLoadingId,setConversationLoadingId]=useState('');
 const [preparationRetry,setPreparationRetry]=useState(0);
 const [preparationRequestError,setPreparationRequestError]=useState('');
 const [notifications,setNotifications]=useState<any[]>([]),[notificationCursor,setNotificationCursor]=useState<string|null>(null);
 const [accountAlerts,setAccountAlerts]=useState<any[]>([]);
 const lastActivityAt=useRef(0);
 const [loaded,setLoaded]=useState(false), [error,setError]=useState(''), [unauthorized,setUnauthorized]=useState(false), [busy,setBusy]=useState(false);
 const selectedThreadRef=useRef('');
 const rawAccounts=useRef<any[]>([]), mutationLock=useRef(false), replyRequests=useRef(new Map<string,string>());
 const report=useCallback((e:unknown)=>{setSyncHadErrors(false);setError(e instanceof Error ? e.message : 'Request failed'); if(e instanceof ApiError && e.status===401) setUnauthorized(true);if(e instanceof ApiError && ['D1_READ_LIMIT','APP_USAGE_BUDGET'].includes(e.code))setUsageBlocked(true);},[]);
 const refresh=useCallback(async(cursor='')=>{
  const data=await api('state?leadScope=active&leadCursor='+encodeURIComponent(cursor));
  rawAccounts.current=data.accounts || [];
  setAccountAlerts((data.healthEvents || []).filter((e:any)=>!e.resolvedAt).slice(0,10));
  setNotifications((data.healthEvents || []).filter((e:any)=>!e.deletedAt));
  setAccounts(rawAccounts.current.map(mapAccount)); setThreads((data.threads || []).map((t:any)=>mapThread(t,rawAccounts.current)));
  setLeads((data.leads || []).map(mapLead)); setLeadTotal(Number(data.leadCounts?.active || 0)); setLeadPage(data.leadPage || {});
  setLeadBatches((data.leadImportBatches || []).map((b:any)=>({id:b.id,name:b.fileName,sourceLabel:`${b.importedCount} imported · ${b.duplicateCount} duplicates · ${b.invalidCount} invalid`,leadCount:Number(b.leadCount),planName:'Automatic allocation',importedAt:b.createdAt})));
  setPlans((data.templates || []).map(mapPlan)); setCampaignCount((data.campaigns || []).length);
  setSendingState(mapSending((data.campaigns || []).find((c:any)=>c.name==='Direct send' && c.status !== 'Cancelled')));
  setSettings(prev=>({...prev,healthNotificationEmail:data.healthNotificationEmail || '',workspaceName:data.workspaceName || 'Relay Mail',dailyWorkspaceCap:Number(data.cap),linkTracking:Boolean(data.linkTracking),openTracking:Boolean(data.openTracking),planOpenTracking:Boolean(data.planOpenTracking),includeSpamFolders:Boolean(data.includeSpamFolders)}));
  setActiveWorkspace(prev=>({...prev,name:data.workspaceName || 'Relay Mail'}));
  if(selectedThreadRef.current && data.threads?.some((t:any)=>t.id===selectedThreadRef.current)){
   const detail=await api('thread?id='+encodeURIComponent(selectedThreadRef.current));
   setThreads(prev=>prev.map(t=>t.id===detail.thread.id?{...mapThread(detail.thread,rawAccounts.current)}:t));
  }
  setLoaded(true); setUnauthorized(false);
 },[]);
 const refreshSending=useCallback(async(activity=true)=>{
  const data=await api(activity?'sending/status':'sending/status?summary=1');
  if(activity)lastActivityAt.current=Date.now();
  if(data.accountAlerts)setAccountAlerts(data.accountAlerts);
  setSendingState(prev=>{if(data.runs?.[0]?.status==='Cancelled')return emptySending;const next=mapSending(data.runs?.[0],data.deliveries || []);return activity?next:{...next,records:prev.id===next.id?prev.records:[]};});
 },[]);
 useEffect(()=>{refresh().catch(report);},[refresh,report]);
 useEffect(()=>{document.documentElement.classList.toggle('dark',theme==='dark');localStorage.setItem('relay-theme',theme);},[theme]);
 useEffect(()=>{
  if(!loaded || unauthorized || usageBlocked || !['sending','dashboard'].includes(activePage))return;
  let stopped=false, polling=false;
  const poll=async(initial=false)=>{if(document.hidden || mutationLock.current || polling)return;polling=true;try{
    const activity=activePage==='sending' && (initial || (sendingState.backendStatus==='Sending' && Date.now()-lastActivityAt.current>=30000));
    await refreshSending(activity);
  }catch(e){if(!stopped)report(e);}finally{polling=false;}};
  void poll(true);
  if(activePage!=='sending' || sendingState.status!=='running')return()=>{stopped=true;};
  const timer=setInterval(()=>void poll(),sendingState.backendStatus==='Scheduled'?15000:2000);
  return()=>{stopped=true;clearInterval(timer);};
 },[loaded,unauthorized,usageBlocked,activePage,sendingState.status,sendingState.backendStatus,refreshSending,report]);
 useEffect(()=>{const timer=setInterval(()=>setThreads(prev=>prev.filter(t=>Date.parse(t.inboundAt || '')>=Date.now()-86400000)),60000);return()=>clearInterval(timer);},[]);

 useEffect(()=>{
  if(!loaded || usageBlocked || unauthorized || sendingState.backendStatus!=='Preparing' || !sendingState.id)return;
  if(sendingState.preparation?.error && preparationRetry===0)return;
  let stopped=false,timer:ReturnType<typeof setTimeout>;
  const advance=async()=>{
   if(stopped)return;
   if(document.hidden || mutationLock.current){timer=setTimeout(advance,500);return;}
   try{const result=await api('campaign/prepare',{campaignId:sendingState.id});if(stopped)return;setPreparationRequestError('');await refreshSending(false);if(result.preparation?.status==='Preparing')timer=setTimeout(advance,result.preparation.busy?1000:150);}
   catch(e){if(!stopped){setPreparationRequestError(sendingState.id || '');report(e);await refreshSending(false).catch(()=>{});}}
  };
  void advance();return()=>{stopped=true;clearTimeout(timer);};
 },[loaded,usageBlocked,unauthorized,sendingState.id,sendingState.backendStatus,preparationRetry,refreshSending,report]);

 const perform=async(work:()=>Promise<unknown>)=>{if(mutationLock.current)throw new Error('Please wait for the current operation.');mutationLock.current=true;setBusy(true);setError('');try{await work();try{await refresh();await refreshSending();}catch(e){report(new Error('Saved successfully, but refreshing failed. Reload before repeating this action. '+(e as Error).message));}return true;}catch(e){report(e);throw e;}finally{mutationLock.current=false;setBusy(false);}};
 // Catch event-handler rejections centrally; forms still await and retain their drafts on failure.
 const action=(work:()=>Promise<unknown>)=>perform(work);
 useEffect(()=>{const listener=(e:PromiseRejectionEvent)=>{e.preventDefault();report(e.reason);};window.addEventListener('unhandledrejection',listener);return()=>window.removeEventListener('unhandledrejection',listener);},[report]);
 const toggleTheme=()=>setTheme(t=>t==='light'?'dark':'light');
 const handleToggleRunStatus=()=>action(()=>api(sendingState.status==='running'?'campaign/pause':'campaign/resume-pending',{campaignId:sendingState.id}));
 const handleInitiateSending=()=>action(()=>api('sending/start',{}));
 const handleResolveRecord=(deliveryId:string,resolution:string)=>{
  const record=sendingState.records.find(r=>r.id===deliveryId);
  if(resolution==='retry' && record?.result==='Needs review'){
   if(!window.confirm('This email may already have been delivered. Check the sender’s Sent folder first. Retry with duplicate risk?'))return Promise.resolve();
   return action(()=>api('campaign/retry-uncertain',{deliveryId}));
  }
  return action(()=>api('campaign/review',{campaignId:sendingState.id,deliveryId,action:resolution}));
 };
 const handleSelectThread=async(id:string,loadOlder=false)=>{
  selectedThreadRef.current=id;setSelectedThreadId(id);
  try{
   const local=await api('thread?id='+encodeURIComponent(id));
   setThreads(prev=>prev.map(t=>t.id===id?{...mapThread(local.thread,rawAccounts.current)}:t));
   const account=rawAccounts.current.find(a=>a.id===local.thread.accountId);
   if(!account?.hasCredentials)return;
   setConversationLoadingId(id);
   const result=await api('mail/conversation',{threadId:id,manual:true,loadOlder});
   if(result.busy){setNotice('This account is already syncing. Refresh the conversation when it finishes.');return;}
   if(result.thread)setThreads(prev=>prev.filter(t=>!(result.retiredThreadIds || []).includes(t.id)).map(t=>t.id===id?{...mapThread(result.thread,rawAccounts.current)}:t));
  }catch(e){report(e);}finally{setConversationLoadingId(current=>current===id?'':current);}
 };
 const handleSendReply=(id:string,text:string)=>action(async()=>{const key=id+'\n'+text;let requestId=replyRequests.current.get(key);if(!requestId){requestId=crypto.randomUUID();replyRequests.current.set(key,requestId);}await api('reply',{id,text,requestId});replyRequests.current.delete(key);});
 const updateThread=(id:string,updates:any)=>action(()=>api('thread/update',{id,...updates}));
 const handleUpdateThreadTag=(id:string,tag:ThreadTag)=>updateThread(id,{tag});
 const handleToggleStar=(id:string)=>updateThread(id,{starred:!threads.find(t=>t.id===id)?.starred});
 const handleToggleArchive=(id:string)=>updateThread(id,{archived:!threads.find(t=>t.id===id)?.archived});
 const handleToggleRead=(id:string)=>updateThread(id,{unread:!threads.find(t=>t.id===id)?.unread});
 const handleAddLead=(l:any)=>action(()=>api('import',{fileName:'Manual lead',text:csv([['name','email','store'],[l.name,l.email,l.company]])}));
 const handleImportLeadBatch=(p:any)=>action(async()=>{try{return await importWithProgress(p.batchName,p.rawText,setImportProgress);}catch(e){setImportProgress(prev=>prev?{...prev,phase:'error',error:(e as Error).message}:null);throw e;}});
 const handleDeleteBatches=(ids:string[])=>action(async()=>{for(const batchId of ids)await api('import/batch/delete',{batchId});});
 const handleUpdateLeadStatus=(id:string,status:string)=>{if(status!=='Paused')return Promise.reject(new Error('Only archiving a lead is supported here.'));if(!window.confirm('Remove this lead from the active list? Unused leads are deleted; leads with send history are archived.'))return Promise.resolve();return action(()=>api('lead/delete',{id}));};
 const handleAssignLeadsToPlan=()=>{setError('Plans are assigned automatically to eligible senders when a run starts.');};
 const handleQueueLeadsForSending=()=>{setActivePage('sending');};
 const handleTogglePlanStatus=(id:string)=>action(()=>api('template/status',{id,paused:plans.find(p=>p.id===id)?.status==='Active'}));
 const handleCreateMultiplePlans=(drafts:any[])=>action(async()=>{for(const d of drafts)await api('template',{name:d.name,subject:d.firstSubject,body:d.firstPreview});});
 const handleUpdatePlan=(id:string,u:any)=>action(async()=>{await api('template/update',{id,name:u.name,subject:u.steps[0]?.subject || '',body:u.steps[0]?.preview || u.description});await api('template/status',{id,paused:u.status!=='Active'});});
 const handleDeletePlan=(id:string)=>action(()=>api('template/delete',{id}));
 const handleDuplicatePlan=(id:string)=>action(async()=>{const p=plans.find(p=>p.id===id)!;await api('template',{name:p.name+' (Copy)',subject:p.steps[0]?.subject || '',body:p.steps[0]?.preview || p.description});});
 const handleToggleAccountStatus=(id:string)=>action(()=>api('account',{id}));
 const handleToggleWarmup=()=>setError('Automated warmup is not available.');
 const handleUpdateDailyLimit=(id:string,cap:number)=>action(()=>api('account/cap',{id,cap}));
 const handleConnectAccount=(p:any)=>action(async()=>{const result=await api('account/connect',{email:p.email,appPassword:p.appPassword});await api('account/cap',{id:result.id,cap:p.dailyLimit});});
 const healthCheckLock=useRef(false);
 const [healthChecking,setHealthChecking]=useState(false),[healthProgress,setHealthProgress]=useState('');
 const autoHealthStarted=useRef(false);
 const checkAllHealth=async(uncheckedOnly=false)=>{
  if(healthCheckLock.current)return;healthCheckLock.current=true;setHealthChecking(true);
  const targets=rawAccounts.current.filter(a=>a.hasCredentials && (!uncheckedOnly || !a.healthCheckedAt));let completed=0,saved=0,failed=0;let firstError='';
  const progress=()=>setHealthProgress(`Health checks: ${saved} results saved · ${completed}/${targets.length} processed · ${failed} requests failed${firstError?' · '+firstError:''}`);
  progress();
  try{await runSyncPool(targets,async a=>{try{const result=await api('account/health/check',{accountId:a.id,force:true,suppressNotification:true});if(!result.checked)throw new Error(result.reason || 'Health check was not saved.');saved++;const patch={healthStatus:result.healthStatus,healthCheckedAt:result.healthCheckedAt,healthMessage:result.healthMessage,healthCode:result.healthCode};rawAccounts.current=rawAccounts.current.map(account=>account.id===a.id?{...account,...patch}:account);setAccounts(previous=>previous.map(account=>account.id===a.id?{...account,healthStatus:result.healthStatus,healthMessage:result.healthMessage || ''}:account));}catch(e){failed++;if(!firstError)firstError=(e as Error).message;}finally{completed++;progress();}},25);await refresh();progress();}catch(e){report(e);}finally{healthCheckLock.current=false;setHealthChecking(false);}
 };
 useEffect(()=>{if(!loaded || unauthorized || usageBlocked || activePage!=='accounts' || autoHealthStarted.current)return;if(!rawAccounts.current.some(a=>a.hasCredentials && !a.healthCheckedAt))return;autoHealthStarted.current=true;void checkAllHealth(true);},[loaded,unauthorized,usageBlocked,activePage]);
 const handleRunDnsCheck=(id:string)=>action(()=>api('account/health/check',{accountId:id,force:true,suppressNotification:true}));
 const saveSettings=(next:WorkspaceSettings)=>action(()=>api('settings',{cap:next.dailyWorkspaceCap,workspaceName:next.workspaceName,healthNotificationEmail:next.healthNotificationEmail || '',linkTracking:Boolean(next.linkTracking),openTracking:Boolean(next.openTracking),planOpenTracking:Boolean(next.planOpenTracking),includeSpamFolders:Boolean(next.includeSpamFolders)}));
 const nextLeadPage=()=>refresh(leadPage.nextCursor).catch(report);
 const syncLock=useRef(false);
 const syncMail=async(includeSent=true,retryOnly=false)=>{
  if(syncLock.current)return;syncLock.current=true;setError('');
  const targets=rawAccounts.current.filter(a=>a.hasCredentials && ['Connected','IMAP only'].includes(a.connection) && (!retryOnly || failedSyncAccounts.current.has(a.id)));
  failedSyncAccounts.current=new Set();lastSyncIncludeSent.current=includeSent;setSyncHadErrors(false);
  let completed=0,bounces=0,more=0,alreadySyncing=0;setNotice(`Checking up to 50 accounts at once · 0/${targets.length} completed`);
  try{const issues:string[]=[];let sharedFailure=false,skipped=0;
   const storageFailure=(e:unknown)=>e instanceof ApiError && ['APP_USAGE_UNAVAILABLE','APP_USAGE_BUDGET','D1_READ_LIMIT','APP_STORAGE_UNAVAILABLE'].includes(e.code);
   const recordSharedFailure=(e:unknown)=>{if(!storageFailure(e))return false;if(!sharedFailure)issues.push('Dashboard database issue: '+(e as Error).message);sharedFailure=true;return true;};
   const unreadByAccount=new Map<string,InboxThread[]>();
   if(includeSent){const byEmail=new Map(targets.map(a=>[a.email,a.id]));for(const thread of threads)if(thread.unread){const id=byEmail.get(thread.accountEmail);if(id){const group=unreadByAccount.get(id)||[];group.push(thread);unreadByAccount.set(id,group);}}}
   await runSyncPool(targets,async a=>{
    if(sharedFailure){skipped++;failedSyncAccounts.current.add(a.id);return;}
    for(const thread of unreadByAccount.get(a.id)||[]){try{const result=await api('mail/conversation',{threadId:thread.id,manual:true,reconcileUnread:true});if(result.busy)throw new Error('Mailbox is already syncing; retry when it finishes.');if(result.thread){const mapped=mapThread(result.thread,rawAccounts.current);setThreads(prev=>prev.filter(t=>!(result.retiredThreadIds || []).includes(t.id)).map(t=>t.id===mapped.id?mapped:t));}}catch(e){if(!recordSharedFailure(e))issues.push('Unread conversation '+thread.contactEmail+': '+(e as Error).message);failedSyncAccounts.current.add(a.id);if(sharedFailure)break;}}
    if(sharedFailure){skipped++;failedSyncAccounts.current.add(a.id);return;}
    try{const result=await api('mail/sync',{accountId:a.id,manual:true,includeSent});
     bounces+=Number(result.bounces || 0);if(result.more)more++;if(result.busy){alreadySyncing++;failedSyncAccounts.current.add(a.id);issues.push(a.email+': another sync is still running. Retry when it finishes.');return;}
     const mailErrors=[...new Set([result.inboxError,result.sentError,result.bounceError].filter(Boolean).map((e:string)=>e.replace(/^.*?sync failed/,'Mailbox sync failed')))];if(mailErrors.length){issues.push(a.email+': '+mailErrors.join(' · '));failedSyncAccounts.current.add(a.id);}
     if(result.threads?.length){
      const incoming=result.threads.map((t:any)=>mapThread(t,rawAccounts.current));
      setThreads(prev=>{const merged=new Map(prev.map(t=>[t.id,t]));for(const t of incoming){if(t.id!==selectedThreadRef.current)merged.set(t.id,t);}return [...merged.values()];});
      if(result.threads.some((t:any)=>t.id===selectedThreadRef.current)){const detail=await api('thread?id='+encodeURIComponent(selectedThreadRef.current));const preview=incoming.find((t:InboxThread)=>t.id===detail.thread.id);setThreads(prev=>prev.map(t=>t.id===detail.thread.id?{...mapThread(detail.thread,rawAccounts.current),inboundAt:preview?.inboundAt || t.inboundAt}:t));}
     }
    }catch(e){if(!recordSharedFailure(e))issues.push(a.email+': '+(e as Error).message);failedSyncAccounts.current.add(a.id);}
    finally{completed++;setNotice(`Checking mail: ${completed}/${targets.length} accounts · ${bounces} bounces recorded · Up to 50 accounts at once`);}
   },50);
   try{await refresh();}catch(e){issues.push('Mailbox checks completed, but refreshing the dashboard failed: '+(e as Error).message);}
   try{await refreshSending();}catch(e){issues.push('Refreshing sending statistics failed: '+(e as Error).message);}

   setNotice(`${sharedFailure?'Sync stopped because the dashboard database is unavailable. ':'Manual sync finished: '}${completed} accounts checked · ${bounces} new bounced deliveries recorded.${skipped?` ${skipped} accounts deferred; Retry checks them after recovery.`:''}${alreadySyncing?` ${alreadySyncing} already syncing in another session.`:''}${more?' More messages remain; click Sync again to continue.':''}`);
   if(issues.length){setError(issues.join('; '));setSyncHadErrors(true);}
  }catch(e){report(e);}finally{syncLock.current=false;}
 };

 const reloadSyncStarted=useRef(false);
 useEffect(()=>{if(!loaded || unauthorized || usageBlocked || reloadSyncStarted.current)return;const navigation=performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming|undefined;if(navigation?.type==='reload'){reloadSyncStarted.current=true;void syncMail();}},[loaded,unauthorized,usageBlocked]);
 const loadNotifications=async(append=false)=>{try{const data=await api('notifications'+(append && notificationCursor?'?before='+encodeURIComponent(notificationCursor):''));setNotifications(prev=>append?[...prev,...data.events]:data.events);setNotificationCursor(data.nextCursor || null);}catch(e){report(e);}};
 useEffect(()=>{if(loaded && activePage==='notifications')void loadNotifications();},[loaded,activePage]);
 const deleteNotification=async(id:string)=>{try{await api('notifications/delete',{eventId:id});setNotifications(prev=>prev.filter(n=>n.id!==id));}catch(e){report(e);}};
 const deleteReadNotifications=async()=>{try{await api('notifications/delete-read',{});await loadNotifications();}catch(e){report(e);}};
 const markNotificationRead=async(id:string)=>{try{await api('account/health/read',{eventId:id});setNotifications(prev=>prev.map(n=>n.id===id?{...n,readAt:new Date().toISOString()}:n));}catch(e){report(e);}};

  const unreadInboxCount = threads.filter((t) => t.unread && !t.archived).length;
  const flaggedSendingCount =
    sendingState.failedCount + sendingState.needsReviewCount;
  const connectedAccountsCount = accounts.filter(
    (a) => a.status === 'Connected'
  ).length;

  return (
    <div className="min-h-screen flex bg-[var(--color-canvas)] text-[var(--color-text)]">
      <Sidebar
        activePage={activePage}
        onNavigate={page=>{if(page!=='inbox' && window.location.hash.startsWith('#conversation/'))window.history.replaceState({...window.history.state,relayConversation:false},'',window.location.pathname+window.location.search);setActivePage(page);}}
        theme={theme}
        onToggleTheme={toggleTheme}
        workspaces={[activeWorkspace]}
        activeWorkspace={activeWorkspace}
        onSelectWorkspace={() => {}}
        unreadInboxCount={unreadInboxCount}
        needsReviewCount={flaggedSendingCount}
        hasUnreadNotifications={notifications.some(n=>!n.readAt)}
        mobileOpen={mobileMenuOpen}
        onCloseMobile={() => setMobileMenuOpen(false)}
      />

      <div className="flex-1 min-w-0 flex flex-col min-h-screen">
        <TopBar
          activePage={activePage}
          activeWorkspace={activeWorkspace}
          connectedAccountsCount={connectedAccountsCount}
          onNavigate={setActivePage}
          onOpenMobileMenu={() => setMobileMenuOpen(true)}
          onToggleTheme={toggleTheme}
          theme={theme}
        />

        <main aria-busy={busy} className="flex-1 px-5 sm:px-10 pt-8 pb-6 max-w-[1260px] w-full mx-auto">
          {error && <div role="alert" className="mb-5 p-4 rounded-[14px] border border-red-400 text-[var(--color-danger)]">{syncHadErrors ? <><p>Some mailbox checks could not finish. This does not mean the accounts are restricted. Successful results have been kept.</p><details className="mt-2"><summary className="cursor-pointer underline">View sync error details</summary><p className="mt-2 break-words max-h-64 overflow-y-auto">{error}</p></details></> : error}<button type="button" aria-label="Dismiss error notification" className="ml-4 underline" onClick={()=>{setError('');setSyncHadErrors(false);}}>Dismiss</button><button className="ml-4 underline" onClick={() => {setError('');setUsageBlocked(false);if(syncHadErrors)void syncMail(lastSyncIncludeSent.current,true);else refresh().catch(report);}}>Retry</button>{unauthorized && <a className="ml-4 underline" href="/login">Sign in</a>}</div>}
          {accountAlerts.length>0 && <div role="alert" className="mb-5 p-4 rounded-[14px] border border-amber-400 bg-[var(--color-surface)] text-[13px]"><strong>Sender accounts need attention</strong>{accountAlerts.slice(0,3).map(a=><p key={a.id} className="mt-2 break-words">{a.accountEmail} · {a.status}: {a.message}</p>)}<button className="mt-3 underline" onClick={()=>{setActivePage('accounts');refresh().catch(report);}}>Review accounts</button></div>}
          {notice && <div role="status" className="mb-5 p-4 rounded-[14px] border border-[var(--color-border)] text-[13px]">{notice}{!busy && <button className="ml-3 underline" onClick={()=>setNotice('')}>Dismiss</button>}</div>}
          {!loaded && !error && <p role="status">Loading your workspace…</p>}
          {importProgress && <div role="status" className="mb-5 p-4 rounded-[14px] border border-[var(--color-border)] bg-[var(--color-surface)]"><div className="flex justify-between gap-3 text-[13px] mb-3"><strong>Lead import · {importProgress.phase}</strong><span>{importProgress.phase==='complete'?'100%':importProgress.total?Math.min(99,Math.floor(100*importProgress.completed/importProgress.total))+'%':''}</span></div><progress aria-label="Lead import progress" className="w-full h-2 accent-[var(--color-brand)]" max={importProgress.total || 1} value={importProgress.phase==='complete'?(importProgress.total || 1):importProgress.total===null?undefined:importProgress.completed}/><p className="mt-2 text-[12px] text-[var(--color-muted)]">{importProgress.result?`${importProgress.result.imported} imported · ${importProgress.result.duplicates} duplicates · ${importProgress.result.invalid} invalid`:importProgress.error || 'Saving real import records. You can follow this progress from any section.'}</p>{['complete','error'].includes(importProgress.phase)&&<button className="mt-2 underline text-[12px]" onClick={()=>setImportProgress(null)}>Dismiss</button>}</div>}
          {busy && <p role="status" className="mb-3 text-[var(--color-muted)]">Working…</p>}
          <fieldset disabled={busy || (usageBlocked && activePage!=='inbox')} className="min-w-0 contents">
          {loaded && !unauthorized && activePage==='notifications' && <NotificationsPage onDelete={deleteNotification} onDeleteRead={deleteReadNotifications} events={notifications} hasMore={!!notificationCursor} onRefresh={()=>void loadNotifications()} onLoadMore={()=>void loadNotifications(true)} onMarkRead={markNotificationRead} onReviewAccount={()=>{setActivePage('accounts');refresh().catch(report);}}/>}
          {loaded && !unauthorized && activePage === 'dashboard'  && (
            <DashboardPage leadTotal={leadTotal} campaignCount={campaignCount}
              sendingState={sendingState}
              threads={threads}
              leads={leads}
              plans={plans}
              accounts={accounts}
              onNavigate={setActivePage}
              onSelectThread={handleSelectThread}
            />
          )}
          {loaded && !unauthorized && activePage === 'inbox' && (
            <InboxPage conversationLoadingId={conversationLoadingId} onLoadOlder={id=>void handleSelectThread(id,true)} onSync={syncMail}
              threads={threads}
              selectedThreadId={selectedThreadId}
              onSelectThread={handleSelectThread}
              onSendReply={handleSendReply}
              onUpdateThreadTag={handleUpdateThreadTag}
              onToggleStar={handleToggleStar}
              onToggleArchive={handleToggleArchive}
              onToggleRead={handleToggleRead}
            />
          )}
          {loaded && !unauthorized && activePage === 'sending' && (
            <SendingPage
              sendingState={sendingState}
              accounts={accounts}
              onToggleRunStatus={handleToggleRunStatus}
              onCancel={()=>action(async()=>{await api('campaign/cancel',{campaignId:sendingState.id});setNotice('Campaign cancelled. Import new leads and initiate a new campaign when ready.');})}
              preparationRequestFailed={preparationRequestError===sendingState.id}
              onResumePreparation={()=>{setError('');setPreparationRequestError('');setPreparationRetry(n=>n+1);}}
              onRebalance={()=>action(async()=>{const result=await api('campaign/rebalance',{campaignId:sendingState.id});setNotice(`Queued work updated: ${result.queued} emails across ${result.accounts} accounts. Resume queued when ready.`);})}
              onInitiateSending={handleInitiateSending}
              onResolveAll={resolution=>action(()=>api('campaign/review',{campaignId:sendingState.id,action:resolution}))}
              onResolveRecord={handleResolveRecord}
            />
          )}
          {loaded && !unauthorized && activePage === 'leads' && (
            <LeadsPage totalCount={leadTotal} hasMore={!!leadPage.nextCursor} onNextPage={nextLeadPage} onFirstPage={() => refresh()}
              leads={leads}
              leadBatches={leadBatches}
              plans={plans}
              onAddLead={handleAddLead}
              onImportLeadBatch={handleImportLeadBatch}
              onDeleteBatches={handleDeleteBatches}
              onUpdateLeadStatus={handleUpdateLeadStatus}
              onAssignLeadsToPlan={handleAssignLeadsToPlan}
              onQueueLeadsForSending={handleQueueLeadsForSending}
            />
          )}
          {loaded && !unauthorized && activePage === 'scouting-plans' && (
            <ScoutingPlansPage
              plans={plans}
              accounts={accounts}
              onTogglePlanStatus={handleTogglePlanStatus}
              onCreateMultiplePlans={handleCreateMultiplePlans}
              onUpdatePlan={handleUpdatePlan}
              onDeletePlan={handleDeletePlan}
              onDuplicatePlan={handleDuplicatePlan}
            />
          )}
          {loaded && !unauthorized && activePage === 'accounts' && (
            <AccountsPage
              accounts={accounts}
              onToggleAccountStatus={handleToggleAccountStatus}
              onToggleWarmup={handleToggleWarmup}
              onUpdateDailyLimit={handleUpdateDailyLimit}
              onConnectAccount={handleConnectAccount}
              onRunDnsCheck={handleRunDnsCheck}
              onCheckAllHealth={()=>checkAllHealth()}
              healthChecking={healthChecking}
              healthProgress={healthProgress}
            />
          )}
          {loaded && !unauthorized && activePage === 'settings' && (
            <SettingsPage
              settings={settings}
              onSaveSettings={saveSettings}
              theme={theme}
              onSetTheme={setTheme}
            />
          )}
          </fieldset>
        </main>

        {/* Footer matching Figma export */}
        <footer className="px-5 sm:px-10 py-5 max-w-[1260px] w-full mx-auto flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 text-[11px] text-[var(--color-muted)]">
          <span>One workspace. Every conversation.</span>
          <span>Connected Gmail accounts · background sending</span>
        </footer>
      </div>
    </div>
  );
}
