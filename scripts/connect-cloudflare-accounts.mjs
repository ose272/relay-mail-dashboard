import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const dashboardUrl = String(process.env.DASHBOARD_URL || '').replace(/\/$/, '');
const dashboardPassword = process.env.DASHBOARD_PASSWORD || '';
if (!dashboardUrl || !dashboardPassword) {
  throw new Error('Set DASHBOARD_URL and DASHBOARD_PASSWORD before running this utility.');
}

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const credentials = fs.readFileSync(path.join(root, 'app password.txt'), 'utf8').replace(/^\uFEFF/, '')
  .split(/\r?\n/)
  .map((raw, index) => ({ raw: raw.trim(), line: index + 1 }))
  .filter(record => record.raw)
  .map(record => {
    const parts = record.raw.split(/\s+/);
    return { line: record.line, password: parts.slice(0, 4).join(''), email: parts[4] };
  })
  .filter(record => emailPattern.test(record.email) && record.password.length === 16);
const byLine = new Map(credentials.map(record => [record.line, record]));
const local = JSON.parse(fs.readFileSync(path.join(root, 'data', 'demo.json'), 'utf8'));
const approved = (local.accounts || [])
  .filter(account => account.connection === 'Verified via IMAP' || account.connection === 'Connected')
  .map(account => byLine.get(account.credentialLine))
  .filter(Boolean);

const start = Math.max(0, Number.parseInt(process.argv[2] || '0', 10) || 0);
const requested = Math.max(1, Number.parseInt(process.argv[3] || String(approved.length), 10) || approved.length);
const batch = approved.slice(start, start + requested);
if (!batch.length) throw new Error('This batch is outside the approved account range.');

async function request(pathname, options = {}) {
  const response = await fetch(`${dashboardUrl}${pathname}`, options);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
  return { response, body };
}

const login = await request('/api/login', {
  method: 'POST',
  headers: { Origin: dashboardUrl, 'Content-Type': 'application/json' },
  body: JSON.stringify({ password: dashboardPassword })
});
const cookies = typeof login.response.headers.getSetCookie === 'function'
  ? login.response.headers.getSetCookie().map(value => value.split(';', 1)[0]).join('; ')
  : String(login.response.headers.get('set-cookie') || '').split(';', 1)[0];
if (!cookies) throw new Error('Dashboard login did not create a session.');

const summary = { requested: batch.length, connected: 0, imapOnly: 0, failed: 0, failures: [] };
for (const record of batch) {
  try {
    const result = await request('/api/account/connect', {
      method: 'POST',
      headers: { Origin: dashboardUrl, Cookie: cookies, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: record.email, appPassword: record.password })
    });
    if (result.body.smtpVerified) summary.connected++;
    else summary.imapOnly++;
  } catch (error) {
    summary.failed++;
    summary.failures.push({ line: record.line, reason: String(error.message || 'connection failed').slice(0, 160) });
  }
  await new Promise(resolve => setTimeout(resolve, 750));
}
console.log(JSON.stringify(summary));
