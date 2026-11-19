import { useCallback, useEffect, useRef, useState } from 'react';
import type { ConnectedAccount, InboxThread, Lead, LeadBatch, NavPage, ScoutingPlan, WorkspaceProfile, WorkspaceSettings, ThreadTag } from './types/maildash';
import { api, ApiError, importWithProgress, type ImportProgress, csv, emptySending, lagosDay, mapAccount, mapLead, mapPlan, mapSending, mapThread } from './lib/api';
import { Sidebar } from './components/layout/Sidebar';
import { TopBar } from './components/layout/TopBar';
import { DashboardPage } from './pages/DashboardPage';
import { InboxPage } from './pages/InboxPage';
import { SendingPage } from './pages/SendingPage';
import { LeadsPage } from './pages/LeadsPage';
import { ScoutingPlansPage } from './pages/ScoutingPlansPage';
import { AccountsPage } from './pages/AccountsPage';
import { SettingsPage } from './pages/SettingsPage';

export default function App() {
 const [activePage,setActivePage]=useState<NavPage>('sending');
 const [theme,setTheme]=useState<'light'|'dark'>(()=>localStorage.getItem('relay-theme') === 'dark' ? 'dark':'light');
 const [mobileMenuOpen,setMobileMenuOpen]=useState(false);
 const [activeWorkspace,setActiveWorkspace]=useState<WorkspaceProfile>({id:'relay',name:'Relay Mail',subtitle:'Production workspace',ownerName:'Workspace owner',ownerEmail:'',avatarUrl:''});
 const [sendingState,setSendingState]=useState(emptySending);
 const [threads,setThreads]=useState<InboxThread[]>([]), [selectedThreadId,setSelectedThreadId]=useState('');
 const [leads,setLeads]=useState<Lead[]>([]), [leadBatches,setLeadBatches]=useState<LeadBatch[]>([]);
 const [plans,setPlans]=useState<ScoutingPlan[]>([]), [accounts,setAccounts]=useState<ConnectedAccount[]>([]);
 const [settings,setSettings]=useState<WorkspaceSettings>({workspaceName:'Relay Mail',timezone:'Africa/Lagos',dailyWorkspaceCap:40,delayBetweenSendsSec:0,maxRetries:3,stopOnReply:true,openTracking:false,linkTracking:false,unsubscribeFooter:false,customTrackingDomain:'',signature:'',notifyOnReply:false,notifyOnBouncePause:false,dailyDigestTime:''});
 const [leadTotal,setLeadTotal]=useState(0), [campaignCount,setCampaignCount]=useState(0),[leadPage,setLeadPage]=useState<any>({});
 const [importProgress,setImportProgress]=useState<ImportProgress|null>(null);
 const [usageBlocked,setUsageBlocked]=useState(false);
 const lastActivityAt=useRef(0);
 const [loaded,setLoaded]=useState(false), [error,setError]=useState(''), [unauthorized,setUnauthorized]=useState(false), [busy,setBusy]=useState(false);
 const selectedThreadRef=useRef('');
 const rawAccounts=useRef<any[]>([]), mutationLock=useRef(false), replyRequests=useRef(new Map<string,string>());
 const report=useCallback((e:unknown)=>{setError(e instanceof Error ? e.message : 'Request failed'); if(e instanceof ApiError && e.status===401) setUnauthorized(true);if(e instanceof ApiError && ['D1_READ_LIMIT','APP_USAGE_BUDGET','APP_USAGE_UNAVAILABLE'].includes(e.code))setUsageBlocked(true);},[]);
 const refresh=useCallback(async(cursor='')=>{
  const data=await api('state?leadScope=active&leadCursor='+encodeURIComponent(cursor));
  rawAccounts.current=data.accounts || [];
  setAccounts(rawAccounts.current.map(mapAccount)); setThreads((data.threads || []).map((t:any)=>mapThread(t,rawAccounts.current)));
  setLeads((data.leads || []).map(mapLead)); setLeadTotal(Number(data.leadCounts?.active || 0)); setLeadPage(data.leadPage || {});
  setLeadBatches((data.leadImportBatches || []).map((b:any)=>({id:b.id,name:b.fileName,sourceLabel:`${b.importedCount} imported · ${b.duplicateCount} duplicates · ${b.invalidCount} invalid`,leadCount:Number(b.leadCount),planName:'Automatic allocation',importedAt:b.createdAt})));
  setPlans((data.templates || []).map(mapPlan)); setCampaignCount((data.campaigns || []).length);
  setSendingState(mapSending((data.campaigns || []).find((c:any)=>c.name==='Direct send')));
  setSettings(prev=>({...prev,healthNotificationEmail:data.healthNotificationEmail || '',workspaceName:data.workspaceName || 'Relay Mail',dailyWorkspaceCap:Number(data.cap)}));
  setActiveWorkspace(prev=>({...prev,name:data.workspaceName || 'Relay Mail'}));
  if(selectedThreadRef.current && data.threads?.some((t:any)=>t.id===selectedThreadRef.current)){
   const detail=await api('thread?id='+encodeURIComponent(selectedThreadRef.current));
   setThreads(prev=>prev.map(t=>t.id===detail.thread.id?{...mapThread(detail.thread,rawAccounts.current),inboundDay:t.inboundDay}:t));
  }
  setLoaded(true); setUnauthorized(false);
 },[]);
 const refreshSending=useCallback(async(activity=true)=>{
  const data=await api(activity?'sending/status':'sending/status?summary=1');
  if(activity)lastActivityAt.current=Date.now();
  setSendingState(prev=>{const next=mapSending(data.runs?.[0],data.deliveries || []);return activity?next:{...next,records:prev.id===next.id?prev.records:[]};});
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
 useEffect(()=>{const timer=setInterval(()=>setThreads(prev=>prev.filter(t=>t.inboundDay===lagosDay(new Date().toISOString()))),60000);return()=>clearInterval(timer);},[]);

 const perform=async(work:()=>Promise<unknown>)=>{if(mutationLock.current)throw new Error('Please wait for the current operation.');mutationLock.current=true;setBusy(true);setError('');try{await work();try{await refresh();await refreshSending();}catch(e){report(new Error('Saved successfully, but refreshing failed. Reload before repeating this action. '+(e as Error).message));}return true;}catch(e){report(e);throw e;}finally{mutationLock.current=false;setBusy(false);}};
 // Catch event-handler rejections centrally; forms still await and retain their drafts on failure.
 const action=(work:()=>Promise<unknown>)=>perform(work);
 useEffect(()=>{const listener=(e:PromiseRejectionEvent)=>{e.preventDefault();report(e.reason);};window.addEventListener('unhandledrejection',listener);return()=>window.removeEventListener('unhandledrejection',listener);},[report]);
 const toggleTheme=()=>setTheme(t=>t==='light'?'dark':'light');
 const handleToggleRunStatus=()=>action(()=>api(sendingState.status==='running'?'campaign/pause':'campaign/resume-pending',{campaignId:sendingState.id}));
 const handleInitiateSending=()=>action(()=>api('sending/start',{}));
 const handleResolveRecord=(deliveryId:string,resolution:string)=>{if(resolution!=='retry')return Promise.resolve();if(!window.confirm('This email may already have been delivered. Check the sender’s Sent folder first. Retry with duplicate risk?'))return Promise.resolve();return action(()=>api('campaign/retry-uncertain',{deliveryId}));};
 const handleSelectThread=async(id:string)=>{selectedThreadRef.current=id;setSelectedThreadId(id);try{const data=await api('thread?id='+encodeURIComponent(id));setThreads(prev=>prev.map(t=>t.id===id?{...mapThread(data.thread,rawAccounts.current),inboundDay:t.inboundDay}:t));}catch(e){report(e);}};
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
 const handleRunDnsCheck=(id:string)=>action(()=>api('account/health/check',{accountId:id,force:true,suppressNotification:true}));
 const saveSettings=(next:WorkspaceSettings)=>action(()=>api('settings',{cap:next.dailyWorkspaceCap,workspaceName:next.workspaceName,healthNotificationEmail:next.healthNotificationEmail || ''}));
 const nextLeadPage=()=>refresh(leadPage.nextCursor).catch(report);
 const syncMail=async()=>{if(mutationLock.current)return;mutationLock.current=true;setBusy(true);setError('');try{let issues:string[]=[];for(let i=0;i<rawAccounts.current.length;i+=3){await Promise.all(rawAccounts.current.slice(i,i+3).filter(a=>a.hasCredentials).map(async a=>{try{const result=await api('mail/sync',{accountId:a.id,manual:true});if(result.errors?.length)issues.push(...result.errors);}catch(e){issues.push(a.email+': '+(e as Error).message);}}));}await refresh();if(issues.length)setError(issues.join('; '));}catch(e){report(e);}finally{mutationLock.current=false;setBusy(false);}};

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
        onNavigate={setActivePage}
        theme={theme}
        onToggleTheme={toggleTheme}
        workspaces={[activeWorkspace]}
        activeWorkspace={activeWorkspace}
        onSelectWorkspace={() => {}}
        unreadInboxCount={unreadInboxCount}
        needsReviewCount={flaggedSendingCount}
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
          {error && <div role="alert" className="mb-5 p-4 rounded-[14px] border border-red-400 text-[var(--color-danger)]">{error}<button className="ml-4 underline" onClick={() => {setError('');setUsageBlocked(false);refresh().catch(report);}}>Retry</button>{unauthorized && <a className="ml-4 underline" href="/login">Sign in</a>}</div>}
          {!loaded && !error && <p role="status">Loading your workspace…</p>}
          {importProgress && <div role="status" className="mb-5 p-4 rounded-[14px] border border-[var(--color-border)] bg-[var(--color-surface)]"><div className="flex justify-between gap-3 text-[13px] mb-3"><strong>Lead import · {importProgress.phase}</strong><span>{importProgress.phase==='complete'?'100%':importProgress.total?Math.min(99,Math.floor(100*importProgress.completed/importProgress.total))+'%':''}</span></div><progress aria-label="Lead import progress" className="w-full h-2 accent-[var(--color-brand)]" max={importProgress.total || 1} value={importProgress.phase==='complete'?(importProgress.total || 1):importProgress.total===null?undefined:importProgress.completed}/><p className="mt-2 text-[12px] text-[var(--color-muted)]">{importProgress.result?`${importProgress.result.imported} imported · ${importProgress.result.duplicates} duplicates · ${importProgress.result.invalid} invalid`:importProgress.error || 'Saving real import records. You can follow this progress from any section.'}</p>{['complete','error'].includes(importProgress.phase)&&<button className="mt-2 underline text-[12px]" onClick={()=>setImportProgress(null)}>Dismiss</button>}</div>}
          {busy && <p role="status" className="mb-3 text-[var(--color-muted)]">Saving changes…</p>}
          <fieldset disabled={busy || usageBlocked} className="min-w-0 contents">
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
            <InboxPage onSync={syncMail}
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
              onInitiateSending={handleInitiateSending}
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
