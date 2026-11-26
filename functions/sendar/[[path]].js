// Stage the final Sendar UI on the existing origin. Owner APIs retain their
// original authorization; customer pages only use the separate account APIs.
export async function onRequest({request,env}) {
 const path=new URL(request.url).pathname.replace(/\/$/,'');
 if(!['/sendar','/sendar/index.html','/sendar/design','/sendar/signin','/sendar/signup','/sendar/welcome','/sendar/about'].includes(path))return new Response('Page not found.',{status:404});
 if(!['GET','HEAD'].includes(request.method))return new Response('Method not allowed.',{status:405,headers:{Allow:'GET, HEAD'}});
 // Fetch the directory index directly; Pages canonicalizes explicit .html URLs.
 const asset=new URL('/sendar/',request.url);
 const response=await env.ASSETS.fetch(new Request(asset,{method:request.method}));
 const headers=new Headers(response.headers);headers.set('Cache-Control','no-store');headers.set('X-Content-Type-Options','nosniff');headers.set('X-Frame-Options','DENY');headers.set('Strict-Transport-Security','max-age=31536000');headers.set('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; img-src 'self' data:; font-src 'self' https://fonts.gstatic.com; connect-src 'self'; frame-ancestors 'none'; form-action 'self'; base-uri 'self'; object-src 'none'");
 return new Response(response.body,{status:response.status,headers});
}
