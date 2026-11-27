import {SEND_WINDOW_MS} from '../../../src/send-window.mjs';
export async function onRequest({request,env}){
 if(request.method!=='POST'||!env.BACKGROUND_CRON_SECRET||request.headers.get('Authorization')!=='Bearer '+env.BACKGROUND_CRON_SECRET)return Response.json({error:'Not authorized.'},{status:403});
 const now=new Date().toISOString(),cutoff=new Date(Date.now()-SEND_WINDOW_MS).toISOString();
 const results=await env.DB.batch([
  env.DB.prepare('DELETE FROM customer_retained_send_usage WHERE id IN(SELECT id FROM customer_retained_send_usage WHERE used_at<=? ORDER BY used_at,id LIMIT 1000)').bind(cutoff),
  env.DB.prepare('DELETE FROM auth_google_login_states WHERE state_hash IN(SELECT state_hash FROM auth_google_login_states WHERE expires_at<=? ORDER BY expires_at LIMIT 1000)').bind(now)
 ]);
 return Response.json({ok:true,deleted:results.reduce((n,r)=>n+Number(r.meta?.changes||0),0)},{headers:{'Cache-Control':'no-store'}});
}
