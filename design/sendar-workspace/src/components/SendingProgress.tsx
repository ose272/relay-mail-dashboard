import {useEffect,useState} from 'react';
import type {SendingState} from '../types/maildash';
import {ProgressTrack} from './ProgressTrack';
export function SendingProgress({run}:{run:SendingState}){
 const [now,setNow]=useState(Date.now());
 useEffect(()=>{if(!['Sending','Scheduled'].includes(run.backendStatus || ''))return;const timer=setInterval(()=>{if(!document.hidden)setNow(Date.now());},1000);return()=>clearInterval(timer);},[run.backendStatus]);
 const age=run.updatedAt?Math.max(0,Math.floor((Math.max(now,Date.now())-run.updatedAt)/1000)):null;
 const fresh=age!==null&&age<15,active=run.backendStatus==='Sending'&&fresh;
 const retryAt=run.nextSendAt?Date.parse(run.nextSendAt):NaN;
 const remaining=Number.isFinite(retryAt)?Math.max(0,Math.ceil((retryAt-Math.max(now,Date.now()))/60000)):null;
 const countdown=remaining===null?'Checking account availability automatically':remaining===0?'Checking sender availability now…':remaining>=60?`Earliest retry in ${Math.floor(remaining/60)}h ${remaining%60}m`:`Earliest retry in ${remaining}m`;
 const processed=Math.max(0,Math.min(run.plannedTotal,run.plannedTotal-run.queuedCount));
 const percent=Math.min(100,Math.max(0,100*processed/Math.max(1,run.plannedTotal)));
 const status=run.backendStatus==='Sending'?(fresh?(run.inFlight?`${run.inFlight} accounts sending`:'Waiting for the next background batch'):'Waiting for fresh sending status'):run.backendStatus==='Scheduled'&&run.nextSendAt?`Scheduled for ${new Date(run.nextSendAt).toLocaleString('en-GB',{timeZone:'Africa/Lagos'})} Lagos time`:run.runSubtitle;
 return <div className="space-y-3"><div className="flex flex-wrap items-center justify-between gap-2"><span className="text-[11px] font-semibold uppercase tracking-[0.04em] text-[var(--color-muted)]">Campaign progress</span><span className="text-[12px] text-[var(--color-muted)] tabular-nums">{processed.toLocaleString()} of {run.plannedTotal.toLocaleString()} processed ({Number(percent.toFixed(2))}%)</span></div>
  {run.backendStatus==='Scheduled'&&run.waitReason==='sender_capacity'&&<div role="status" className="p-4 rounded-[12px] border border-amber-300 bg-[var(--color-subtle)] space-y-2"><strong className="text-[14px]">Waiting for sender capacity</strong><p className="text-[13px]">The remaining emails are queued while account quotas or provider cooldowns recover. Sending resumes automatically when verified accounts become eligible.</p><p className="text-[12px] tabular-nums">{countdown}{run.nextSendAt?' · '+new Date(run.nextSendAt).toLocaleString('en-GB',{timeZone:'Africa/Lagos'})+' Lagos time':''}</p></div>}
  <ProgressTrack value={processed} max={run.plannedTotal} active={active} label="Campaign processing progress"/>
  <p className="text-[12px] text-[var(--color-muted)] tabular-nums">{run.sentCount.toLocaleString()} confirmed · {run.failedCount.toLocaleString()} failed · {run.needsReviewCount.toLocaleString()} awaiting review · {run.queuedCount.toLocaleString()} pending</p>
  {run.id&&<div className="flex flex-wrap items-center justify-between gap-2 text-[12px] text-[var(--color-muted)]"><span className="flex items-center gap-2"><span aria-hidden="true" className="relay-progress-status" data-active={active}/>{status}</span><span className="tabular-nums">{run.updatedAt?(age!==null&&age<5?'Just checked':`Checked ${new Date(run.updatedAt).toLocaleTimeString('en-GB',{timeZone:'Africa/Lagos'})}`):'Waiting for status'}</span></div>}
  <p className="text-[12px] text-[var(--color-muted)]">Processed includes confirmed sends, failures and messages awaiting review. Pending includes in-flight attempts. Status refreshes every 5 seconds while active; bounce reports update with inbox sync.</p>
 </div>;
}
