export async function workspaceActivity(db,{now=new Date(),days=7}={}){
 const count=days===14?14:7,today=new Date(now.getTime()+3600000).toISOString().slice(0,10);
 const end=Date.parse(today+'T12:00:00Z');
 const dates=Array.from({length:count},(_,i)=>new Date(end-(count-1-i)*86400000).toISOString().slice(0,10));
 const rows=(await db.prepare('SELECT day,accepted_count,reply_count FROM workspace_daily_activity WHERE day>=? AND day<=? ORDER BY day').bind(dates[0],today).all()).results||[];
 const byDay=new Map(rows.map(r=>[r.day,r]));
 const activity=dates.map(day=>({day,sent:Number(byDay.get(day)?.accepted_count||0),replies:Number(byDay.get(day)?.reply_count||0)}));
 return {timezone:'Africa/Lagos',days:activity,today:activity.at(-1),generatedAt:now.toISOString()};
}
