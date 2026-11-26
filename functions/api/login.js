import { createSession, hashClientAddress, matchesSecret, sessionCookie } from '../_lib/auth.js';

const encoder = new TextEncoder();

function jsonResponse(status, body, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers }
  });
}

async function readJson(request) {
  const text = await request.text();
  if (encoder.encode(text).byteLength > 4096) throw new Error('Request is too large.');
  return JSON.parse(text || '{}');
}

export async function onRequestPost({ request, env }) {
  if(env.ADMIN_LOGIN_DISABLED==='1')return jsonResponse(410,{error:'Administrator login is disabled. Use your Sendar account to sign in.'});
  const origin = request.headers.get('Origin');
  if (!origin || origin !== new URL(request.url).origin) return jsonResponse(403, { error: 'Cross-origin request blocked.' });
  if (!request.headers.get('Content-Type')?.startsWith('application/json')) return jsonResponse(415, { error: 'JSON required.' });
  if (!env.DASHBOARD_PASSWORD || env.DASHBOARD_PASSWORD.length < 10 || !env.DB) return jsonResponse(503, { error: 'Dashboard setup is incomplete.' });

  let body;
  try {
    body = await readJson(request);
  } catch {
    return jsonResponse(400, { error: 'Invalid login request.' });
  }
  if (typeof body.password !== 'string' || body.password.length > 1024) return jsonResponse(400, { error: 'Enter the dashboard password.' });

  const addressHash = await hashClientAddress(request.headers.get('CF-Connecting-IP'));
  const attempt = await env.DB.prepare('SELECT failures, locked_until FROM login_attempts WHERE ip_hash = ?').bind(addressHash).first();
  const now = Math.floor(Date.now() / 1000);
  if (attempt?.locked_until > now) return jsonResponse(429, { error: 'Too many attempts. Try again later.' }, { 'Retry-After': String(attempt.locked_until - now) });

  if (!await matchesSecret(body.password, env.DASHBOARD_PASSWORD)) {
    await env.DB.prepare(`
      INSERT INTO login_attempts (ip_hash, failures, locked_until) VALUES (?, 1, 0)
      ON CONFLICT(ip_hash) DO UPDATE SET
        failures = failures + 1,
        locked_until = CASE WHEN failures + 1 >= 5 THEN ? ELSE locked_until END
    `).bind(addressHash, now + 600).run();
    return jsonResponse(401, { error: 'Invalid password.' });
  }

  await env.DB.prepare('DELETE FROM login_attempts WHERE ip_hash = ?').bind(addressHash).run();
  const session = await createSession(env.DASHBOARD_PASSWORD);
  return jsonResponse(200, { ok: true }, { 'Set-Cookie': sessionCookie(session.token, session.maxAge) });
}
