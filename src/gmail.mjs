import { readFile } from 'node:fs/promises';
import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const messageLimit = 10;
const messageSizeLimit = 12_000;

export function parseCredentialFile(source) {
  return source.replace(/^\uFEFF/, '').split(/\r?\n/)
    .map((raw, index) => ({ raw: raw.trim(), line: index + 1 }))
    .filter(record => record.raw)
    .map(record => {
      const parts = record.raw.split(/\s+/);
      return { line: record.line, password: parts.slice(0, 4).join(''), email: parts[4] };
    })
    .filter(record => emailPattern.test(record.email) && record.password.length === 16);
}

export async function syncFirstInbox(credentialPath, accounts) {
  const source = await readFile(credentialPath, 'utf8');
  const credential = parseCredentialFile(source)[0];
  if (!credential) throw new Error('No valid app-password/email record was found.');
  const account = accounts.find(item => item.email.toLowerCase() === credential.email.toLowerCase());
  if (!account) throw new Error('The first credentials-file account is not registered in the dashboard.');

  const client = new ImapFlow({
    host: 'imap.gmail.com',
    port: 993,
    secure: true,
    auth: { user: credential.email, pass: credential.password },
    logger: false,
    connectionTimeout: 20_000,
    greetingTimeout: 20_000,
    socketTimeout: 30_000,
    maxLiteralSize: 1_000_000,
    maxResponseSize: 12_000_000
  });

  await client.connect();
  try {
    const lock = await client.getMailboxLock('INBOX', { readOnly: true, acquireTimeout: 10_000 });
    try {
      const total = client.mailbox?.exists ?? 0;
      if (!total) return { accountId: account.id, email: credential.email, messages: [] };
      const firstSequence = Math.max(1, total - messageLimit + 1);
      const fetched = await client.fetchAll(`${firstSequence}:*`, {
        uid: true,
        envelope: true,
        internalDate: true,
        flags: true,
        source: true
      });
      const messages = [];
      for (const item of fetched.reverse()) {
        if (!item.source) continue;
        const parsed = await simpleParser(item.source);
        const sender = parsed.from?.value?.[0];
        messages.push({
          uid: item.uid,
          subject: parsed.subject || item.envelope?.subject || 'No subject',
          fromName: sender?.name || '',
          fromAddress: sender?.address || '',
          date: parsed.date?.toISOString() || item.internalDate?.toISOString() || null,
          text: (parsed.text || '').slice(0, messageSizeLimit),
          messageId: parsed.messageId || '',
          inReplyTo: parsed.inReplyTo || '',
          references: parsed.references || [],
          unread: !item.flags?.has('\\Seen')
        });
      }
      return { accountId: account.id, email: credential.email, messages };
    } finally {
      lock.release();
    }
  } finally {
    await client.logout();
  }
}
