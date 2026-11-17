import fs from 'node:fs';
import tls from 'node:tls';

const source = fs.readFileSync('app password.txt', 'utf8').replace(/^\uFEFF/, '');
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const records = source.split(/\r?\n/)
  .map(line => line.trim())
  .filter(Boolean)
  .map(line => {
    const parts = line.split(/\s+/);
    return { password: parts.slice(0, 4).join(''), email: parts[4] };
  })
  .filter(record => emailPattern.test(record.email) && record.password.length === 16);

if (!records.length) throw new Error('No valid app-password/email records found.');

const account = records[0];
const socket = tls.connect({ host: 'imap.gmail.com', port: 993, servername: 'imap.gmail.com' });
socket.setTimeout(20_000);
let buffer = '';
let stage = 'greeting';

const finish = (code, message) => {
  console.log(JSON.stringify({ connected: code === 0, message }));
  socket.end();
  process.exitCode = code;
};

socket.on('secureConnect', () => {});
socket.on('timeout', () => finish(1, 'Timed out connecting to Gmail IMAP.'));
socket.on('error', () => finish(1, 'Could not establish an encrypted Gmail IMAP connection.'));
socket.on('data', chunk => {
  buffer += chunk.toString('utf8');
  const lines = buffer.split('\r\n');
  buffer = lines.pop();
  for (const line of lines) {
    if (stage === 'greeting' && line.startsWith('* OK')) {
      stage = 'login';
      socket.write(`a1 LOGIN "${account.email}" "${account.password}"\r\n`);
    } else if (stage === 'login' && line.startsWith('a1 ')) {
      if (line.startsWith('a1 OK')) {
        stage = 'logout';
        socket.write('a2 LOGOUT\r\n');
      } else finish(1, 'Gmail rejected this account or app password.');
    } else if (stage === 'logout' && line.startsWith('a2 ')) {
      finish(0, 'Encrypted Gmail IMAP login succeeded for the first valid account.');
    }
  }
});
