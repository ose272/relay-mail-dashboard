import {useEffect,useState} from 'react';
import {api} from '../lib/api';
type Metrics={openTracked:number;opens:number;clickTracked:number;clicks:number;replies:number;delivered:number};
type Analytics=Metrics&{configured:boolean;enabled:{opens:boolean;clicks:boolean};plans:(Metrics&{id:string;name:string})[]};
const rate=(n:number,d:number)=>d?(100*n/d).toFixed(1)+'%':'—';
function EngagementMetrics({campaignId,all=false}:{campaignId?:string;all?:boolean}){
 const [data,setData]=useState<Analytics|null>(null),[error,setError]=useState(''),[loading,setLoading]=useState(false);
 const path='analytics?'+(all?'scope=all':campaignId?'campaignId='+encodeURIComponent(campaignId):'');
 useEffect(()=>{let active=true;const load=async()=>{try{const d=await api(path);if(active){setData(d);setError('');}}catch(e){if(active)setError(e instanceof Error?e.message:'Metrics unavailable.');}};setData(null);void load();const timer=setInterval(()=>{if(document.visibilityState==='visible')void load();},30000);return()=>{active=false;clearInterval(timer);};},[path]);
 const refresh=async()=>{setLoading(true);try{setData(await api(path));setError('');}catch(e){setError(e instanceof Error?e.message:'Metrics unavailable.');}finally{setLoading(false);}};
 return <div className="pt-4 space-y-4"><div className="flex justify-end"><button type="button" className="text-[13px] underline" disabled={loading} onClick={()=>void refresh()}>{loading?'Refreshing…':'Refresh metrics'}</button></div>{error&&<p role="status" className="text-[13px] text-[var(--color-danger)]">{error}</p>}{!data&&!error&&<p role="status">Loading engagement metrics…</p>}{data&&<>
 {!data.configured&&<p role="status">Open/click tracking setup is incomplete. A signing secret is required.</p>}
 <div className="grid grid-cols-2 xl:grid-cols-3 gap-4">{[['Open rate',rate(data.opens,data.openTracked)],['Unique opens',data.opens+' / '+data.openTracked],['Click rate',rate(data.clicks,data.clickTracked)],['Unique clicks',data.clicks+' / '+data.clickTracked],['Reply rate',rate(data.replies,data.delivered)],['Replied deliveries',data.replies+' / '+data.delivered]].map(([label,value])=><div key={label}><p className="text-[12px] text-[var(--color-muted)]">{label}</p><p className="text-[24px] font-semibold tabular-nums">{value}</p></div>)}</div>
 <p className="text-[12px] text-[var(--color-muted)]">Future sends: opens {data.enabled.opens?'enabled':'off'} · clicks {data.enabled.clicks?'enabled':'off'}. Open/click rates use tracked confirmed deliveries excluding known bounces. Click rates include messages with tracked links. Earlier untracked emails have no measurable open/click rate.</p>
 {data.plans.length>0&&<div className="overflow-x-auto"><table className="w-full text-left text-[12px]"><thead><tr><th className="py-2 pr-4">Scouting plan</th><th className="pr-4">Opens / tracked</th><th className="pr-4">Open rate</th><th className="pr-4">Clicks / linked</th><th className="pr-4">Click rate</th><th className="pr-4">Replies / delivered</th><th>Reply rate</th></tr></thead><tbody>{data.plans.map(p=><tr key={p.id} className="border-t border-[var(--color-border)]"><td className="py-3 pr-4">{p.name}</td><td>{p.opens} / {p.openTracked}</td><td>{rate(p.opens,p.openTracked)}</td><td>{p.clicks} / {p.clickTracked}</td><td>{rate(p.clicks,p.clickTracked)}</td><td>{p.replies} / {p.delivered}</td><td>{rate(p.replies,p.delivered)}</td></tr>)}</tbody></table></div>}
 <p className="text-[12px] text-[var(--color-muted)]">Reply rate counts confirmed deliveries with at least one synced, campaign-linked incoming reply. Sync Inbox, including Spam if enabled, to update replies. Opens and clicks can be affected by image privacy tools and security scanners.</p>
 </>}</div>;
}
export function TrackingAnalytics(props:{campaignId?:string;all?:boolean}){
 const [open,setOpen]=useState(false);
 return <details className="p-5 sm:p-6 rounded-[18px] border border-[var(--color-border)] bg-[var(--color-surface)]" onToggle={e=>setOpen(e.currentTarget.open)}><summary className="cursor-pointer font-semibold select-none">{props.all?'Email engagement · All campaigns':'Campaign engagement'}<span className="ml-3 text-[12px] font-normal text-[var(--color-muted)]">Open, click and reply rates</span></summary>{open&&<EngagementMetrics {...props}/>}</details>;
}
