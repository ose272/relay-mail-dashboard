import {readCustomerCookie,customerSession} from './_lib/customer-auth.js';
import {customerWorkspace} from './_lib/customer-workspace.js';
import { readSessionCookie, verifySession } from './_lib/auth.js';

const publicPaths = new Set(['/login', '/login.html', '/login.js', '/styles.css', '/favicon.ico', '/track/open','/signup','/signup.html','/signin','/signin.html','/welcome','/welcome.html','/api/auth/config','/api/auth/signup','/api/auth/signin','/api/auth/session','/api/auth/signout']);
const publicAssetPattern = /\.(?:css|js|mjs|map|ico|svg|png|jpe?g|webp|avif|woff2?|ttf)$/i;

function jsonResponse(status, error) {
  return new Response(JSON.stringify({ error }), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
  });
}

export async function onRequest({ request, env, next }) {
  const url = new URL(request.url);
  // The public product homepage is separate from the authenticated dashboard.
  if(url.pathname==='/')return next();
  // OAuth endpoints validate the customer session themselves. Owner cookies never authorize them.
  if(url.pathname.startsWith('/api/oauth/google/'))return next();
  // Recipient-bound operator jobs authenticate a short-lived capability themselves.
  if(url.pathname==='/api/internal/customer-test-send')return next();
  if(['/sendar/manifest.webmanifest','/sendar/offline','/sendar/offline/'].includes(url.pathname)&&['GET','HEAD'].includes(request.method))return next();
  if(url.pathname==='/api/auth/google/start')return next();
  if(['/sendar/welcome','/sendar/welcome/','/welcome','/welcome.html'].includes(url.pathname)&&['GET','HEAD'].includes(request.method))return Response.redirect(new URL('/sendar/'+url.search+(url.search?'#page=Accounts':''),url),302);
  if(['GET','HEAD'].includes(request.method)&&url.pathname.replace(/\/$/,'')==='/sendar/signin'&&url.searchParams.get('access')==='administrator')return Response.redirect(new URL('/sendar/signin',url),302);
  const legacy={'/privacy':'/sendar/privacy','/terms':'/sendar/terms','/delete-account':'/sendar/delete-account','/':'/sendar/','/index.html':'/sendar/','/login':'/sendar/signin','/login.html':'/sendar/signin','/signin':'/sendar/signin','/signin.html':'/sendar/signin','/signup':'/sendar/signup','/signup.html':'/sendar/signup','/welcome':'/sendar/welcome','/welcome.html':'/sendar/welcome','/about':'/sendar/about','/about.html':'/sendar/about','/sendar/design':'/sendar/','/sendar/design/':'/sendar/'};
  if(['GET','HEAD'].includes(request.method)&&legacy[url.pathname])return Response.redirect(new URL(legacy[url.pathname],url),302);
  if (['/sendar/signin','/sendar/signup','/sendar/welcome','/sendar/about','/sendar/privacy','/sendar/terms','/sendar/delete-account'].includes(url.pathname.replace(/\/$/,''))) return next();
  if (['/about','/about.html','/googleae5c9c582107a548.html','/googleae5c9c582107a548'].includes(url.pathname)) return next();
  if (
    publicPaths.has(url.pathname) || url.pathname.startsWith('/track/open/') || url.pathname.startsWith('/track/click/') ||
    (!url.pathname.startsWith('/api/') && publicAssetPattern.test(url.pathname)) ||
    url.pathname === '/api/login'
  ) return next();
  if (
    ['/api/internal/send-tick','/api/internal/prepare-tick','/api/internal/privacy-cleanup','/api/internal/customer-send-tick'].includes(url.pathname) &&
    env.BACKGROUND_CRON_SECRET &&
    request.headers.get('Authorization') === `Bearer ${env.BACKGROUND_CRON_SECRET}`
  ) return next();

  if(readCustomerCookie(request)){
    if(url.pathname.startsWith('/api/'))return customerWorkspace({request,env});
    try{if(env.DB&&await customerSession(env.DB,request))return next();}catch{return new Response('Workspace temporarily unavailable. Retry shortly.',{status:503,headers:{'Cache-Control':'no-store'}});}
    return Response.redirect(new URL('/sendar/signin',url),302);
  }
  if(env.ADMIN_LOGIN_DISABLED==='1'){
    if(url.pathname.startsWith('/api/'))return jsonResponse(401,'Administrator access is disabled. Sign in with your Sendar account.');
    return Response.redirect(new URL(readCustomerCookie(request)?'/sendar/welcome':'/sendar/signin',url),302);
  }

  if (!env.DASHBOARD_PASSWORD || env.DASHBOARD_PASSWORD.length < 10 || !env.DB) {
    if (url.pathname.startsWith('/api/')) return jsonResponse(503, 'Dashboard setup is incomplete.');
    return new Response('Dashboard setup is incomplete. Set the Pages secrets and D1 binding, then redeploy.', { status: 503 });
  }

  const token = readSessionCookie(request);
  if (!await verifySession(token, env.DASHBOARD_PASSWORD)) {
    if (url.pathname.startsWith('/api/')) return jsonResponse(401, 'Please sign in.');
    const destination=url.pathname.startsWith('/sendar')?(readCustomerCookie(request)?'/sendar/welcome':'/sendar/signin'):(readCustomerCookie(request)?'/welcome':'/signin');
    return Response.redirect(new URL(destination, url), 302);
  }
  return next();
}
