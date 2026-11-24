import {useEffect,useState} from 'react';
import type {SendingState} from '../types/maildash';
import {ProgressTrack} from './ProgressTrack';
export function SendingProgress({run}:{run:SendingState}){
 const [now,setNow]=useState(Date.now());
 useEffect(()=>{if(run.backendStatus!=='Sending')return;const timer=setInterval(()=>{if(!document.hidden)setNow(Date.now());},1000);return()=>clearInterval(timer);},[run.backendStatus]);
 const age=run.updatedAt?Math.max(0,Math.floor((Math.max(now,Date.now())-run.updatedAt)/1000)):null;
 const fresh=age!==null&&age<15,active=run.backendStatus==='Sending'&&fresh;
 const processed=Math.max(0,Math.min(run.plannedTotal,run.plannedTotal-run.queuedCount));
 const percent=Math.min(100,Math.max(0,100*processed/Math.max(1,run.plannedTotal)));
 const status=run.backendStatus==='Sending'?(fresh?(run.inFlight?`${run.inFlight} accounts sending`:'Waiting for the next background batch'):'Waiting for fresh sending status'):run.backendStatus==='Scheduled'&&run.nextSendAt?`Scheduled for ${new Date(run.nextSendAt).toLocaleString('en-GB',{timeZone:'Africa/Lagos'})} Lagos time`:run.runSubtitle;
 return <div className="space-y-3"><div className="flex flex-wrap items-center justify-between gap-2"><span className="text-[11px] font-semibold uppercase tracking-[0.04em] text-[var(--color-muted)]">Campaign progress</span><span className="text-[12px] text-[var(--color-muted)] tabular-nums">{processed.toLocaleString()} of {run.plannedTotal.toLocaleString()} processed ({Number(percent.toFixed(2))}%)</span></div>
  <ProgressTrack value={processed} max={run.plannedTotal} active={active} label="Campaign processing progress"/>
  <p className="text-[12px] text-[var(--color-muted)] tabular-nums">{run.sentCount.toLocaleString()} confirmed · {run.failedCount.toLocaleString()} failed · {run.needsReviewCount.toLocaleString()} awaiting review · {run.queuedCount.toLocaleString()} pending</p>
  {run.id&&<div className="flex flex-wrap items-center justify-between gap-2 text-[12px] text-[var(--color-muted)]"><span className="flex items-center gap-2"><span aria-hidden="true" className="relay-progress-status" data-active={active}/>{status}</span><span className="tabular-nums">{run.updatedAt?(age!==null&&age<5?'Just checked':`Checked ${new Date(run.updatedAt).toLocaleTimeString('en-GB',{timeZone:'Africa/Lagos'})}`):'Waiting for status'}</span></div>}
  <p className="text-[12px] text-[var(--color-muted)]">Processed includes confirmed sends, failures and messages awaiting review. Pending includes in-flight attempts. Status refreshes every 5 seconds while active; bounce reports update with inbox sync.</p>
 </div>;
}
