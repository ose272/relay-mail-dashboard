import { clearSessionCookie } from '../_lib/auth.js';

export async function onRequestPost({ request }) {
  const origin = request.headers.get('Origin');
  if (!origin || origin !== new URL(request.url).origin) {
    return new Response(JSON.stringify({ error: 'Cross-origin request blocked.' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
    });
  }
  return new Response(JSON.stringify({ ok: true }), {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'Set-Cookie': clearSessionCookie()
    }
  });
}
