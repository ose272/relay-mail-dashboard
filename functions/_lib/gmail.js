import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import nodemailer from 'nodemailer';

const messageLimit = 25;
const messageSizeLimit = 12_000;

function createImapClient(email, password) {
  return new ImapFlow({
    host: 'imap.gmail.com',
    port: 993,
    secure: true,
    auth: { user: email, pass: password },
    logger: false,
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 20_000,
    maxLiteralSize: 1_000_000,
    maxResponseSize: 12_000_000
  });
}

function createSmtpTransport(email, password) {
  return nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 587,
    secure: false,
    requireTLS: true,
    auth: { user: email, pass: password },
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 20_000
  });
}

export async function verifyGmailCredentials(email, password) {
  const client = createImapClient(email, password);
  let connected = false;
  try {
    await client.connect();
    connected = true;
    const lock = await client.getMailboxLock('INBOX', { readOnly: true, acquireTimeout: 10_000 });
    lock.release();
  } finally {
    if (connected) await client.logout();
  }

  const transport = createSmtpTransport(email, password);
  try {
    await transport.verify();
    return { imap: true, smtp: true };
  } catch {
    return { imap: true, smtp: false };
  } finally {
    transport.close();
  }
}

function connectionErrorDetails(error) {
  return {
    code: String(error.responseCode || error.code || 'CONNECTION_ERROR').slice(0, 40),
    message: String(error.response || error.message || 'Connection failed.').replace(/\s+/g, ' ').slice(0, 240)
  };
}

export async function checkGmailHealth(email, password) {
  const client = createImapClient(email, password);
  let connected = false;
  let imapError = null;
  try {
    await client.connect();
    connected = true;
    const lock = await client.getMailboxLock('INBOX', { readOnly: true, acquireTimeout: 10_000 });
    lock.release();
  } catch (error) {
    imapError = connectionErrorDetails(error);
  } finally {
    if (connected) {
      try {
        await client.logout();
      } catch (error) {
        if (!imapError) imapError = connectionErrorDetails(error);
      }
    }
  }

  const transport = createSmtpTransport(email, password);
  let smtpError = null;
  try {
    await transport.verify();
  } catch (error) {
    smtpError = connectionErrorDetails(error);
  } finally {
    transport.close();
  }

  return { imap: !imapError, smtp: !smtpError, imapError, smtpError };
}

async function fetchRecentMailbox(email, password, mailboxPath, checkpoint) {
  const client = createImapClient(email, password);
  let connected = false;
  try {
    await client.connect();
    connected = true;
    if (!mailboxPath) {
      const sentFolder = (await client.list()).find(folder => folder.specialUse === '\\Sent');
      if (!sentFolder) throw new Error('Gmail Sent folder was not found.');
      mailboxPath = sentFolder.path;
    }
    const lock = await client.getMailboxLock(mailboxPath, { readOnly: true, acquireTimeout: 10_000 });
    try {
      const total = client.mailbox?.exists ?? 0;
      const uidValidity = String(client.mailbox?.uidValidity ?? 'unknown');
      const latestUid = Math.max(0, (client.mailbox?.uidNext ?? 1) - 1);
      const sameMailbox = checkpoint.uid > 0 && checkpoint.uidValidity === uidValidity;
      const firstUid = checkpoint.uid + 1;
      const lastUid = sameMailbox ? Math.min(latestUid, checkpoint.uid + messageLimit) : latestUid;
      if (sameMailbox && firstUid > lastUid) {
        return { messages: [], checked: 0, uid: checkpoint.uid, uidValidity, more: false };
      }
      if (!total) return { messages: [], checked: 0, uid: latestUid, uidValidity, more: false };

      const firstSequence = Math.max(1, total - messageLimit + 1);
      const range = sameMailbox ? `${firstUid}:${lastUid}` : `${firstSequence}:${total}`;
      const fetched = await client.fetchAll(range, {
        uid: true,
        envelope: true,
        internalDate: true,
        flags: true,
        source: true
      }, sameMailbox ? { uid: true } : undefined);
      const fetchedUid = fetched.reduce((max, item) => Math.max(max, item.uid || 0), 0);
      const syncUid = sameMailbox ? lastUid : fetchedUid;
      const messages = [];
      for (const item of fetched.reverse()) {
        if (!item.source) continue;
        const parsed = await simpleParser(item.source, { skipHtml: true, skipImageLinks: true });
        const sender = parsed.from?.value?.[0];
        const fromAddress = sender?.address?.toLowerCase() || '';
        const recipients = [...(parsed.to?.value || []), ...(parsed.cc?.value || [])]
          .map(recipient => recipient.address?.toLowerCase())
          .filter(Boolean);
        messages.push({
          externalId: `${mailboxPath === 'INBOX' ? 'INBOX' : `MAILBOX:${mailboxPath}`}:${uidValidity}:${item.uid}`,
          subject: parsed.subject || item.envelope?.subject || 'No subject',
          fromName: sender?.name || '',
          fromAddress,
          toAddresses: [...new Set(recipients)],
          date: parsed.date?.toISOString() || item.internalDate?.toISOString() || new Date().toISOString(),
          text: (parsed.text || '').slice(0, messageSizeLimit),
          messageId: parsed.messageId || '',
          inReplyTo: parsed.inReplyTo || '',
          references: Array.isArray(parsed.references) ? parsed.references : parsed.references ? [parsed.references] : [],
          unread: !item.flags?.has('\\Seen')
        });
      }
      return {
        messages,
        mailboxPath,
        checked: fetched.length,
        uid: syncUid,
        uidValidity,
        more: syncUid < latestUid
      };
    } finally {
      lock.release();
    }
  } finally {
    if (connected) await client.logout();
  }
}

export async function fetchRecentInbox(email, password, checkpoint) {
  return fetchRecentMailbox(email, password, 'INBOX', checkpoint);
}

export async function fetchRecentSent(email, password, checkpoint) {
  return fetchRecentMailbox(email, password, '', checkpoint);
}

export async function sendThreadReply({ email, password, to, subject, text, inReplyTo, references, messageId }) {
  const transport = createSmtpTransport(email, password);
  try {
    return await transport.sendMail({
      from: email,
      to,
      subject,
      text,
      inReplyTo: inReplyTo || undefined,
      references: references.length ? references : undefined,
      messageId
    });
  } finally {
    transport.close();
  }
}

export function createCampaignMessageOptions({ email, to, subject, text, messageId }) {
  const options = { from: email, to, text, messageId };
  if (subject?.trim()) options.subject = subject.trim();
  return options;
}

export async function sendCampaignMessage({ email, password, to, subject, text, messageId }) {
  const transport = createSmtpTransport(email, password);
  try {
    return await transport.sendMail(createCampaignMessageOptions({ email, to, subject, text, messageId }));
  } finally {
    transport.close();
  }
}
