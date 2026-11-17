import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const source = fs.readFileSync(path.join(root, 'app password.txt'), 'utf8').replace(/^\uFEFF/, '');
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const records = source.split(/\r?\n/)
  .map((raw, index) => ({ raw: raw.trim(), line: index + 1 }))
  .filter(record => record.raw)
  .map(record => {
    const parts = record.raw.split(/\s+/);
    return { line: record.line, password: parts.slice(0, 4).join(''), email: parts[4] };
  });
const valid = records.filter(record => emailPattern.test(record.email) && record.password.length === 16);
const invalid = records.filter(record => !emailPattern.test(record.email) || record.password.length !== 16);

const dataPath = path.join(root, 'data', 'demo.json');
const data = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
const priorConnections = new Map(data.accounts.map(account => [account.credentialLine, account.connection]));
data.accounts = valid.map((record, index) => ({
  id: `a${index + 1}`,
  email: record.email,
  cap: data.cap ?? 40,
  used: 0,
  paused: false,
  connection: priorConnections.get(record.line) ?? 'Pending verification',
  credentialLine: record.line
}));
data.accountImport = { total: records.length, valid: valid.length, invalidLines: invalid.map(record => record.line) };
fs.writeFileSync(dataPath, JSON.stringify(data, null, 2));
console.log(JSON.stringify({ registered: valid.length, invalidLines: invalid.map(record => record.line) }));
