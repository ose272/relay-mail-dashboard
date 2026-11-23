import {verifyClickToken,safeDestination} from '../../_lib/engagement.js';
export async function onRequest({request,env}){
 const headers={'Cache-Control':'private, no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff'};
 if(!['GET','HEAD'].includes(request.method))return new Response(null,{status:405,headers});
 const m=new URL(request.url).pathname.match(/^\/track\/click\/([a-f0-9-]{36})\.([a-f0-9]{64})$/i);
 if(!m||!await verifyClickToken(m[1],m[2],env.OPEN_TRACKING_SECRET))return new Response('Invalid tracking link.',{status:404,headers});
 try{const link=await env.DB.prepare('SELECT delivery_id,destination_url FROM delivery_click_links WHERE id=?').bind(m[1]).first(),destination=link&&safeDestination(link.destination_url);if(!destination)return new Response('Link unavailable.',{status:404,headers});
 if(request.method==='GET'){try{const r=await env.DB.prepare('UPDATE delivery_open_tracking SET first_click_at=? WHERE delivery_id=? AND click_enabled=1 AND first_click_at IS NULL').bind(new Date().toISOString(),link.delivery_id).run();await env.DB.prepare('INSERT INTO app_usage_days(day,rows_read,rows_written) VALUES(?,?,?) ON CONFLICT(day) DO UPDATE SET rows_read=rows_read+excluded.rows_read,rows_written=rows_written+excluded.rows_written').bind(new Date().toISOString().slice(0,10),Number(r.meta?.rows_read||1)+4,Number(r.meta?.rows_written||r.meta?.changes*6||0)+3).run();}catch{/* Analytics failure must not prevent a valid destination redirect. */}}
 return new Response(null,{status:302,headers:{...headers,Location:destination}});
 }catch{return new Response('Link temporarily unavailable. Please retry.',{status:503,headers});}
}
