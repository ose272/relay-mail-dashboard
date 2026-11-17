const encoder = new TextEncoder();
const cookieName = 'relay_session';
const sessionSeconds = 12 * 60 * 60;

function encodeBase64Url(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function decodeBase64Url(value) {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
  return Uint8Array.from(atob(padded), char => char.charCodeAt(0));
}

async function importSigningKey(secret) {
  return crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

export async function createSession(secret) {
  const expires = Math.floor(Date.now() / 1000) + sessionSeconds;
  const nonce = encodeBase64Url(crypto.getRandomValues(new Uint8Array(16)));
  const payload = `${expires}.${nonce}`;
  const key = await importSigningKey(secret);
  const signature = new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(payload)));
  const token = `${payload}.${encodeBase64Url(signature)}`;
  return {
    token,
    maxAge: sessionSeconds
  };
}

export async function verifySession(token, secret) {
  if (!token || !secret) return false;
  const [expires, nonce, signature, extra] = token.split('.');
  if (!expires || !nonce || !signature || extra !== undefined || Number(expires) <= Math.floor(Date.now() / 1000)) return false;
  try {
    const key = await importSigningKey(secret);
    return await crypto.subtle.verify('HMAC', key, decodeBase64Url(signature), encoder.encode(`${expires}.${nonce}`));
  } catch (error) {
    if (error instanceof TypeError || error instanceof DOMException) return false;
    throw error;
  }
}

export function readSessionCookie(request) {
  const cookies = request.headers.get('Cookie') || '';
  const entry = cookies.split(';').map(value => value.trim()).find(value => value.startsWith(`${cookieName}=`));
  return entry ? entry.slice(cookieName.length + 1) : '';
}

export function sessionCookie(token, maxAge) {
  return `${cookieName}=${token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${maxAge}`;
}

export function clearSessionCookie() {
  return `${cookieName}=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0`;
}

export async function matchesSecret(candidate, expected) {
  const left = encoder.encode(candidate);
  const right = encoder.encode(expected);
  let difference = left.length ^ right.length;
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index++) difference |= (left[index] || 0) ^ (right[index] || 0);
  return difference === 0;
}

export async function hashClientAddress(address) {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(address || 'unknown')));
  return encodeBase64Url(digest);
}
