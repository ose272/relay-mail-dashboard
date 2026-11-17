import fs from 'node:fs';
import tls from 'node:tls';

const source = fs.readFileSync('app password.txt', 'utf8').replace(/^\uFEFF/, '');
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const record = source.split(/\r?\n/)
  .map(line => line.trim())
  .filter(Boolean)
  .map(line => {
    const parts = line.split(/\s+/);
    return { password: parts.slice(0, 4).join(''), email: parts[4] };
  })
  .find(item => emailPattern.test(item.email) && item.password.length === 16);

if (!record) throw new Error('No valid app-password/email record found.');

const encode = value => Buffer.from(value).toString('base64');
const socket = tls.connect({ host: 'smtp.gmail.com', port: 465, servername: 'smtp.gmail.com' });
socket.setTimeout(20_000);
let buffer = '';
let stage = 'greeting';
let settled = false;

function finish(code, message) {
  if (settled) return;
  settled = true;
  console.log(JSON.stringify({ connected: code === 0, message }));
  socket.end();
  process.exitCode = code;
}

socket.on('timeout', () => finish(1, 'Timed out connecting to Gmail SMTP.'));
socket.on('error', () => finish(1, 'Could not establish an encrypted Gmail SMTP connection.'));
socket.on('data', chunk => {
  buffer += chunk.toString('utf8');
  const lines = buffer.split('\r\n');
  buffer = lines.pop();
  for (const line of lines) {
    if (stage === 'greeting' && line.startsWith('220 ')) {
      stage = 'ehlo';
      socket.write('EHLO relay.local\r\n');
    } else if (stage === 'ehlo' && line.startsWith('250 ')) {
      stage = 'auth';
      socket.write('AUTH LOGIN\r\n');
    } else if (stage === 'auth' && line.startsWith('334 ')) {
      stage = 'username';
      socket.write(`${encode(record.email)}\r\n`);
    } else if (stage === 'username' && line.startsWith('334 ')) {
      stage = 'password';
      socket.write(`${encode(record.password)}\r\n`);
    } else if (stage === 'password') {
      if (line.startsWith('235 ')) {
        stage = 'quit';
        socket.write('QUIT\r\n');
      } else if (/^(4|5)\d\d /.test(line)) finish(1, 'Gmail rejected SMTP authentication.');
    } else if (stage === 'quit' && line.startsWith('221 ')) {
      finish(0, 'Encrypted Gmail SMTP authentication succeeded. No message was sent.');
    }
  }
});
