import { readSessionCookie, verifySession } from './_lib/auth.js';

const publicPaths = new Set(['/login', '/login.html', '/login.js', '/styles.css', '/favicon.ico']);
const publicAssetPattern = /\.(?:css|js|mjs|map|ico|svg|png|jpe?g|webp|avif|woff2?|ttf)$/i;

function jsonResponse(status, error) {
  return new Response(JSON.stringify({ error }), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
  });
}

export async function onRequest({ request, env, next }) {
  const url = new URL(request.url);
  if (
    publicPaths.has(url.pathname) ||
    (!url.pathname.startsWith('/api/') && publicAssetPattern.test(url.pathname)) ||
    url.pathname === '/api/login'
  ) return next();
  if (
    url.pathname === '/api/internal/send-tick' &&
    env.BACKGROUND_CRON_SECRET &&
    request.headers.get('Authorization') === `Bearer ${env.BACKGROUND_CRON_SECRET}`
  ) return next();

  if (!env.DASHBOARD_PASSWORD || env.DASHBOARD_PASSWORD.length < 10 || !env.DB) {
    if (url.pathname.startsWith('/api/')) return jsonResponse(503, 'Dashboard setup is incomplete.');
    return new Response('Dashboard setup is incomplete. Set the Pages secrets and D1 binding, then redeploy.', { status: 503 });
  }

  const token = readSessionCookie(request);
  if (!await verifySession(token, env.DASHBOARD_PASSWORD)) {
    if (url.pathname.startsWith('/api/')) return jsonResponse(401, 'Please sign in.');
    return Response.redirect(new URL('/login', url), 302);
  }
  return next();
}
