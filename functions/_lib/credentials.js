const encoder = new TextEncoder();

function encodeBase64Url(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function decodeBase64Url(value) {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
  return Uint8Array.from(atob(padded), char => char.charCodeAt(0));
}

async function importKey(secret) {
  if (!secret) throw new Error('Credential encryption is not configured.');
  const raw = decodeBase64Url(secret);
  if (raw.length !== 32) throw new Error('Credential encryption key must be 32 bytes.');
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

export async function encryptCredential(email, password, secret) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await importKey(secret);
  const cipher = await crypto.subtle.encrypt({
    name: 'AES-GCM',
    iv,
    additionalData: encoder.encode(email.toLowerCase())
  }, key, encoder.encode(password));
  return `${encodeBase64Url(iv)}.${encodeBase64Url(new Uint8Array(cipher))}`;
}

export async function decryptCredential(email, encrypted, secret) {
  const [encodedIv, encodedCipher, extra] = encrypted.split('.');
  if (!encodedIv || !encodedCipher || extra !== undefined) throw new Error('Stored account credential is invalid.');
  const key = await importKey(secret);
  const plaintext = await crypto.subtle.decrypt({
    name: 'AES-GCM',
    iv: decodeBase64Url(encodedIv),
    additionalData: encoder.encode(email.toLowerCase())
  }, key, decodeBase64Url(encodedCipher));
  return new TextDecoder().decode(plaintext);
}
