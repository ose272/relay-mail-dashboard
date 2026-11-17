import fs from 'node:fs';
import path from 'node:path';
import tls from 'node:tls';

const root = path.resolve(import.meta.dirname, '..');
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const source = fs.readFileSync(path.join(root, 'app password.txt'), 'utf8').replace(/^\uFEFF/, '');
const records = source.split(/\r?\n/)
  .map((raw, index) => ({ raw: raw.trim(), line: index + 1 }))
  .filter(record => record.raw)
  .map(record => {
    const parts = record.raw.split(/\s+/);
    return { line: record.line, password: parts.slice(0, 4).join(''), email: parts[4] };
  })
  .filter(record => emailPattern.test(record.email) && record.password.length === 16);

function verify({ email, password, line }) {
  return new Promise(resolve => {
    const socket = tls.connect({ host: 'imap.gmail.com', port: 993, servername: 'imap.gmail.com' });
    socket.setTimeout(20_000);
    let buffer = '';
    let stage = 'greeting';
    let settled = false;
    const done = (ok, reason) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve({ line, ok, reason });
    };
    socket.on('timeout', () => done(false, 'timeout'));
    socket.on('error', () => done(false, 'connection_error'));
    socket.on('data', chunk => {
      buffer += chunk.toString('utf8');
      const lines = buffer.split('\r\n');
      buffer = lines.pop();
      for (const response of lines) {
        if (stage === 'greeting' && response.startsWith('* OK')) {
          stage = 'login';
          socket.write(`a1 LOGIN "${email}" "${password}"\r\n`);
        } else if (stage === 'login' && response.startsWith('a1 ')) {
          done(response.startsWith('a1 OK'), response.startsWith('a1 OK') ? 'verified' : 'rejected');
        }
      }
    });
  });
}

const start = Number.parseInt(process.argv[2] ?? '0', 10);
const requested = Number.parseInt(process.argv[3] ?? '10', 10);
const batch = records.slice(start, start + requested);
if (!batch.length) throw new Error('This verification batch is outside the available account range.');

const results = [];
for (const record of batch) {
  results.push(await verify(record));
  await new Promise(resolve => setTimeout(resolve, 750));
}
const verifiedLines = results.filter(result => result.ok).map(result => result.line);
const failed = results.filter(result => !result.ok).map(({ line, reason }) => ({ line, reason }));
const statePath = path.join(root, 'data', 'demo.json');
const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
const previous = state.accountVerification ?? { outcomes: {} };
const outcomes = { ...(previous.outcomes ?? {}) };
for (const result of results) outcomes[result.line] = result.ok ? 'verified' : result.reason;
for (const account of state.accounts) {
  const outcome = outcomes[account.credentialLine];
  account.connection = outcome === 'verified' ? 'Verified via IMAP' : outcome ? 'Connection failed' : 'Pending verification';
}
const outcomeEntries = Object.entries(outcomes);
const cumulativeVerified = outcomeEntries.filter(([, result]) => result === 'verified').map(([line]) => Number(line));
const cumulativeFailed = outcomeEntries
  .filter(([, result]) => result !== 'verified')
  .map(([line, reason]) => ({ line: Number(line), reason }));
state.accountVerification = {
  checked: outcomeEntries.length,
  verified: cumulativeVerified.length,
  verifiedLines: cumulativeVerified,
  failed: cumulativeFailed,
  outcomes,
  checkedAt: new Date().toISOString()
};
fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
console.log(JSON.stringify({ batch: { start, checked: results.length }, verified: verifiedLines.length, failed }));
