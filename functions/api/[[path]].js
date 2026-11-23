import {applyIncomingState,applySentState} from '../../src/thread-state.mjs';
import {finishAttemptSql,reviewDeliveries} from '../../src/campaign-state.mjs';
import {createPreparation,continuePreparation,continueNextPreparation,preparationProgress,PreparationError} from '../../src/campaign-preparation.mjs';
import {cancelCampaign} from '../../src/campaign-control.mjs';
import {rebalanceCampaign} from '../../src/rebalance.mjs';
import {mergeConversation} from '../../src/conversations.mjs';
import {sendFailureHealth,smtpRetryMinutes} from '../../src/send-health.mjs';
import {recordBounceReports} from '../../src/bounces.mjs';
import { meteredD1, usageBudgets, allowBudgetRead } from '../_lib/usage-budget.js';
import { selectReadyDelivery, claimReadyDeliverySql, seedSenderQueue } from '../../src/ready-senders.mjs';
import { SEND_CONCURRENCY } from '../../src/send-limits.mjs';
import { expireStaleDeliveriesSql } from '../../src/send-selection.mjs';
import { allocateRepeatedCampaign, assignScoutingPlans, assessAccountHealth, parseLeads } from '../../src/domain.mjs';
import { eligibleLeadsSql } from '../../src/sending-query.mjs';
import { decryptCredential, encryptCredential } from '../_lib/credentials.js';
import { checkGmailHealth, fetchAccountMail, fetchGmailConversation, sendCampaignMessage, sendThreadReply, verifyGmailCredentials } from '../_lib/gmail.js';

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const encoder = new TextEncoder();

class HttpError extends Error {
  constructor(status, message, code = '') {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function jsonResponse(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
  });
}

async function readJson(request) {
  const text = await request.text();
  if (encoder.encode(text).byteLength > 10_000_000) throw new HttpError(413, 'File too large. Maximum 10 MB.');
  try {
    return JSON.parse(text || '{}');
  } catch {
    throw new HttpError(400, 'Invalid JSON request.');
  }
}

function resultRows(result) {
  return result.results || [];
}

function normalizeSubject(value) {
  return String(value || '').replace(/^\s*(?:(?:re|fwd?)\s*:\s*)+/i, '').trim().toLowerCase();
}

function mailSyncError(scope, error) {
  const code = String(error?.responseCode || error?.code || 'SYNC_ERROR')
    .replace(/[^a-z0-9_-]/gi, '')
    .slice(0, 40) || 'SYNC_ERROR';
  const details = String(error?.response || error?.message || 'Provider connection failed.')
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .slice(0, 180);
  return `${scope} sync failed (${code}): ${details}`;
}

async function reconcileUncertainCampaignDelivery(db, message) {
  const match = /^<([0-9a-f-]{36})@relay-mail-dashboard\.pages\.dev>$/i.exec(String(message.messageId || ''));
  if (!match) return false;
  const delivery = await db.prepare(`
    SELECT d.id, d.campaign_id FROM campaign_deliveries d
    JOIN campaigns c ON c.id = d.campaign_id
    WHERE d.id = ? AND c.name = 'Direct send' AND d.status = 'uncertain'
  `).bind(match[1]).first();
  if (!delivery) return false;
  await db.batch([
    db.prepare(`
      UPDATE campaign_deliveries
      SET status = 'sent', sent_at = ?, retry_after = NULL, last_error = NULL
      WHERE id = ? AND status = 'uncertain'
    `).bind(message.date, delivery.id),
    db.prepare(`
      UPDATE campaigns SET status = 'Sending'
      WHERE id = ? AND status = 'Needs review'
    `).bind(delivery.campaign_id)
  ]);
  return true;
}

const healthIssueStatuses = new Set(['Warning', 'Problem', 'Restricted']);
const healthCheckIntervalMs = 6 * 60 * 60 * 1000;

async function saveAccountHealth(db, accountId, health) {
  const previous = await db.prepare('SELECT health_status FROM accounts WHERE id = ?').bind(accountId).first();
  const previousStatus = previous?.health_status || 'Unknown';
  const wasIssue = healthIssueStatuses.has(previousStatus);
  const isIssue = healthIssueStatuses.has(health.status);
  const now = new Date().toISOString();
  const statements = [
    db.prepare(`
      UPDATE accounts SET health_status = ?, health_checked_at = ?, health_code = ?, health_message = ?
      WHERE id = ?
    `).bind(health.status, now, health.code, health.message, accountId)
  ];
  let eventId = null;

  if (isIssue && (!wasIssue || previousStatus !== health.status)) {
    statements.push(db.prepare(`
      UPDATE account_health_events SET resolved_at = ?
      WHERE account_id = ? AND resolved_at IS NULL
    `).bind(now, accountId));
    eventId = crypto.randomUUID();
    statements.push(db.prepare(`
      INSERT INTO account_health_events (id, account_id, status, code, message, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).bind(eventId, accountId, health.status, health.code, health.message, now));
  } else if (health.status === 'Healthy' && wasIssue) {
    statements.push(db.prepare(`
      UPDATE account_health_events SET resolved_at = ?
      WHERE account_id = ? AND resolved_at IS NULL
    `).bind(now, accountId));
  } else if (isIssue) {
    eventId = (await db.prepare(`
      SELECT id FROM account_health_events
      WHERE account_id = ? AND resolved_at IS NULL
      ORDER BY created_at DESC LIMIT 1
    `).bind(accountId).first())?.id || null;
  }

  await db.batch(statements);
  return eventId;
}

async function sendHealthNotification(db, env, eventId, retry = false) {
  const event = await db.prepare(`
    SELECT e.id, e.account_id, e.status, e.message, e.email_status,
      a.email AS affected_email
    FROM account_health_events e JOIN accounts a ON a.id = e.account_id
    WHERE e.id = ?
  `).bind(eventId).first();
  if (!event || event.email_status === 'sent' || event.email_status === 'sending') {
    return { status: event?.email_status || 'missing' };
  }
  const setting = await db.prepare('SELECT value FROM app_settings WHERE key = ?')
    .bind('healthNotificationEmail').first();
  const recipient = setting?.value || '';
  if (!recipient) return { status: 'pending' };

  const sender = await db.prepare(`
    SELECT id, email, credential_ciphertext FROM accounts
    WHERE id != ? AND connection = 'Connected'
      AND smtp_verified_at IS NOT NULL AND credential_ciphertext IS NOT NULL
      AND health_status IN ('Healthy', 'Unknown')
    ORDER BY CASE WHEN health_status = 'Healthy' THEN 0 ELSE 1 END,
      health_checked_at DESC, created_at, email
    LIMIT 1
  `).bind(event.account_id).first();
  if (!sender) {
    await db.prepare(`
      UPDATE account_health_events SET email_status = 'unavailable',
        email_error = 'No other verified, healthy sender is available.'
      WHERE id = ?
    `).bind(eventId).run();
    return { status: 'unavailable' };
  }

  const retryClause = retry ? "('pending', 'unavailable', 'failed')" : "('pending', 'unavailable')";
  const claim = await db.prepare(`
    UPDATE account_health_events SET email_status = 'sending', email_error = NULL
    WHERE id = ? AND email_status IN ${retryClause}
  `).bind(eventId).run();
  if (!claim.meta?.changes) {
    return { status: (await db.prepare('SELECT email_status FROM account_health_events WHERE id = ?').bind(eventId).first())?.email_status || 'missing' };
  }

  let password;
  try {
    password = await decryptCredential(sender.email, sender.credential_ciphertext, env.CREDENTIALS_ENCRYPTION_KEY);
  } catch (error) {
    const message = String(error.message || 'Sender credentials could not be decrypted.').replace(/\s+/g, ' ').slice(0, 240);
    await db.prepare(`
      UPDATE account_health_events SET email_status = 'failed', email_sender = ?, email_error = ?
      WHERE id = ?
    `).bind(sender.email, message, eventId).run();
    return { status: 'failed', sender: sender.email, error: message };
  }
  try {
    await sendCampaignMessage({
      email: sender.email,
      password,
      to: recipient,
      subject: `[MyMail] Account health: ${event.status} — ${event.affected_email}`,
      text: `Account health check reported ${event.status} for ${event.affected_email}.\n\n${event.message}\n\nReview the account in the MyMail dashboard: https://relay-mail-dashboard.pages.dev`,
      messageId: `<health-${event.id}@relay-mail-dashboard.pages.dev>`
    });
  } catch (error) {
    const message = String(error.message || 'Email notification failed.').replace(/\s+/g, ' ').slice(0, 240);
    await db.prepare(`
      UPDATE account_health_events SET email_status = 'failed', email_sender = ?, email_error = ?
      WHERE id = ?
    `).bind(sender.email, message, eventId).run();
    return { status: 'failed', sender: sender.email, error: message };
  }
  await db.prepare(`
    UPDATE account_health_events SET email_status = 'sent', email_sent_at = ?, email_sender = ?
    WHERE id = ?
  `).bind(new Date().toISOString(), sender.email, eventId).run();
  return { status: 'sent', sender: sender.email };
}

const leadPageSize = 100;
const inboxSummaryLimit = 250;

function replyWindowStartIso(now = new Date()) { return new Date(now.getTime()-86400000).toISOString(); }

function decodeLeadCursor(value) {
  try {
    const parsed = JSON.parse(value || '[]');
    return Array.isArray(parsed) && parsed.length === 3 && parsed.every(item => typeof item === 'string') ? parsed : null;
  } catch {
    return null;
  }
}

function encodeLeadCursor(lead) {
  return JSON.stringify([lead.created_at, lead.email, lead.id]);
}

async function loadThread(db, id) {
  const [thread, messages] = await Promise.all([
    db.prepare('SELECT id, name, store, email, subject, account_id, unread, status, starred, archived, tag,provider_history_before_uid FROM threads WHERE id = ?').bind(id).first(),
    db.prepare('SELECT id, thread_id, direction, body, time, send_state,sender_email,sender_name FROM messages WHERE thread_id = ? ORDER BY time, id').bind(id).all()
  ]);
  if (!thread) return null;
  return {
    id: thread.id, name: thread.name, store: thread.store, email: thread.email,
    starred: Boolean(thread.starred), archived: Boolean(thread.archived), tag: thread.tag,
    historyBeforeUid:thread.provider_history_before_uid,
    subject: thread.subject, accountId: thread.account_id, unread: Boolean(thread.unread), status: thread.status,
    messages: resultRows(messages).map(message => ({ id:message.id,direction: message.direction, body: message.body, time: message.time, sendState: message.send_state,senderEmail:message.sender_email,senderName:message.sender_name }))
  };
}

async function loadState(db, options = {}) {
  const todayStart = replyWindowStartIso();
  const leadScope = options.leadScope === 'archived' ? 'archived' : 'active';
  const cursor = decodeLeadCursor(options.leadCursor);
  const leadStatus = leadScope === 'archived' ? 'Archived' : 'Ready';
  const cursorSql = cursor ? 'AND (created_at, email, id) > (?, ?, ?)' : '';
  const leadBindings = cursor ? [leadStatus, ...cursor, leadPageSize + 1] : [leadStatus, leadPageSize + 1];
  const [settingsResult, healthEmailResult, openTrackingResult, planOpenTrackingResult, includeSpamFoldersResult, accountsResult, leadsResult, leadCountsResult, templatesResult, campaignsResult, recentMessagesResult, healthEventsResult, importBatchesResult] = await Promise.all([
    db.prepare('SELECT value FROM app_settings WHERE key = ?').bind('defaultCap').first(),
    db.prepare('SELECT value FROM app_settings WHERE key = ?').bind('healthNotificationEmail').first(),
    db.prepare('SELECT value FROM app_settings WHERE key = ?').bind('openTracking').first(),
    db.prepare('SELECT value FROM app_settings WHERE key = ?').bind('planOpenTracking').first(),
    db.prepare('SELECT value FROM app_settings WHERE key = ?').bind('includeSpamFolders').first(),
    db.prepare(`
      SELECT id, email, cap,
        (SELECT COUNT(*) FROM campaign_deliveries d WHERE d.account_id = accounts.id AND d.status = 'sent' AND d.sent_at >= ?) AS used,
        paused, connection, imap_verified_at, smtp_verified_at,
        last_sync_at, credential_ciphertext, health_status, health_checked_at, health_code, health_message
      FROM accounts ORDER BY created_at, email
    `).bind(new Date(Date.now() - 86400000).toISOString()).all(),
    db.prepare(`SELECT id, email, name, store, status, created_at FROM leads
      WHERE status = ? ${cursorSql} ORDER BY created_at, email, id LIMIT ?`).bind(...leadBindings).all(),
    db.prepare(`SELECT
      SUM(CASE WHEN status = 'Ready' THEN 1 ELSE 0 END) AS active_count,
      SUM(CASE WHEN status = 'Archived' THEN 1 ELSE 0 END) AS archived_count
      FROM leads`).first(),
    db.prepare('SELECT id, name, subject, body, archived_at FROM templates ORDER BY created_at, id').all(),
    db.prepare(`SELECT id, name, template_id, status, created_at, remaining, days, allocation_json,
      planned_sends, sent_count, pending_count, uncertain_count, failed_count, failure_codes,cancelled_count
      FROM campaigns ORDER BY created_at DESC`).all(),
    db.prepare(`SELECT thread_id, direction, body, time, send_state FROM messages
      WHERE direction = 'in' AND time >= ?
      ORDER BY time DESC, id DESC LIMIT ?`).bind(todayStart, inboxSummaryLimit).all(),
    db.prepare(`
      SELECT e.id, e.account_id, a.email AS account_email, e.status, e.code, e.message,
        e.created_at, e.resolved_at, e.read_at,e.deleted_at, e.email_status, e.email_sent_at,
        e.email_sender, e.email_error
      FROM account_health_events e JOIN accounts a ON a.id = e.account_id
      ORDER BY e.created_at DESC LIMIT 50
    `).all(),
    db.prepare(`
      SELECT b.id, b.file_name, b.created_at, b.imported_count, b.duplicate_count,
        b.invalid_count, COUNT(i.lead_id) AS lead_count
      FROM lead_import_batches b
      LEFT JOIN lead_import_batch_items i ON i.batch_id = b.id
      GROUP BY b.id
      ORDER BY b.created_at DESC
    `).all()
  ]);
  const leadRows = resultRows(leadsResult);
  const hasMoreLeads = leadRows.length > leadPageSize;
  const leads = leadRows.slice(0, leadPageSize);
  const recentMessages = resultRows(recentMessagesResult);
  const threadIds = [...new Set(recentMessages.map(message => message.thread_id))];
  // D1 accepts no more than 100 bound parameters per query. Batch lookups so
  // every reply from the last 24 hours is visible without risking a state-endpoint failure.
  const threadGroups = await Promise.all(Array.from({ length: Math.ceil(threadIds.length / 100) }, (_, index) => {
    const ids = threadIds.slice(index * 100, (index + 1) * 100);
    return db.prepare(`SELECT id, name, store, email, subject, account_id, unread, status, starred, archived, tag FROM threads WHERE id IN (${ids.map(() => '?').join(', ')})`).bind(...ids).all();
  }));
  const threads = threadGroups.flatMap(resultRows);
  const latestMessageByThread = new Map();
  for (const message of recentMessages) {
    if (!latestMessageByThread.has(message.thread_id)) latestMessageByThread.set(message.thread_id, message);
  }
  return {
    workspaceName: (await db.prepare("SELECT value FROM app_settings WHERE key = 'workspaceName'").first())?.value || 'Relay Mail',
    cap: Number(settingsResult?.value || 40),
    openTracking: openTrackingResult?.value === '1',
    planOpenTracking: planOpenTrackingResult?.value === '1',
    includeSpamFolders: includeSpamFoldersResult?.value === '1',
    accounts: resultRows(accountsResult).map(account => ({
      id: account.id,
      email: account.email,
      cap: account.cap,
      used: account.used,
      paused: Boolean(account.paused),
      connection: account.connection,
      imapVerifiedAt: account.imap_verified_at,
      smtpVerifiedAt: account.smtp_verified_at,
      lastSyncAt: account.last_sync_at,
      hasCredentials: Boolean(account.credential_ciphertext),
      healthStatus: account.health_status,
      healthCheckedAt: account.health_checked_at,
      healthCode: account.health_code,
      healthMessage: account.health_message
    })),
    healthNotificationEmail: healthEmailResult?.value || '',
    healthEvents: resultRows(healthEventsResult).map(event => ({
      id: event.id,
      accountId: event.account_id,
      accountEmail: event.account_email,
      status: event.status,
      code: event.code,
      message: event.message,
      createdAt: event.created_at,
      resolvedAt: event.resolved_at,
      readAt: event.read_at,
      deletedAt:event.deleted_at,
      emailStatus: event.email_status,
      emailSentAt: event.email_sent_at,
      emailSender: event.email_sender,
      emailError: event.email_error
    })),
    leads: leads.map(({ created_at, ...lead }) => lead),
    leadCounts: {
      active: Number(leadCountsResult?.active_count || 0),
      archived: Number(leadCountsResult?.archived_count || 0)
    },
    leadPage: {
      scope: leadScope,
      cursor: options.leadCursor || '',
      nextCursor: hasMoreLeads ? encodeLeadCursor(leads.at(-1)) : '',
      hasMore: hasMoreLeads,
      offset: Number(options.leadOffset || 0)
    },
    leadImportBatches: resultRows(importBatchesResult).map(batch => ({
      id: batch.id,
      fileName: batch.file_name,
      createdAt: batch.created_at,
      importedCount: batch.imported_count,
      duplicateCount: batch.duplicate_count,
      invalidCount: batch.invalid_count,
      leadCount: batch.lead_count
    })),
    templates: resultRows(templatesResult).map(template => ({
      ...template,
      archivedAt: template.archived_at
    })),
    campaigns: resultRows(campaignsResult).map(campaign => {
      const assignments = JSON.parse(campaign.allocation_json);
      return {
        id: campaign.id,
        name: campaign.name,
        templateId: campaign.template_id,
        status: campaign.status,
        created: campaign.created_at,
        remaining: campaign.remaining,
        days: campaign.days,
        assignments,
        plannedSends: Number(campaign.planned_sends || assignments.reduce((total, assignment) => total + Number(assignment.count || 0), 0)),
        liveReady: Number(campaign.planned_sends || 0) > 0,
        sent: Number(campaign.sent_count || 0),
        pending: Number(campaign.pending_count || 0),
        uncertain: Number(campaign.uncertain_count || 0),
        failed: Number(campaign.failed_count || 0),
        cancelled:Number(campaign.cancelled_count || 0),
        failureCodes: String(campaign.failure_codes || '').split(',').filter(Boolean)
      };
    }),
    threads: threads.map(thread => ({
      id: thread.id,
      name: thread.name,
      store: thread.store,
      email: thread.email,
      subject: thread.subject,
      accountId: thread.account_id,
      starred: Boolean(thread.starred), archived: Boolean(thread.archived), tag: thread.tag,
      unread: Boolean(thread.unread),
      status: thread.status,
      messages: latestMessageByThread.has(thread.id) ? [latestMessageByThread.get(thread.id)].map(message => ({
        direction: message.direction, body: message.body, time: message.time, sendState: message.send_state
      })) : []
    })),
    mode: 'cloudflare'
  };
}

async function loadSendingStatus(db, summary = false) {
  const result = await db.prepare(`
    SELECT id, status, created_at, planned_sends, sent_count, pending_count,
      uncertain_count, failed_count, failure_codes,cancelled_count, in_flight_count, next_send_at,p.phase AS prep_phase,p.total_count AS prep_total,p.prepared_count,p.total_senders,p.prepared_senders,p.error_code
    FROM campaigns LEFT JOIN campaign_preparations p ON p.campaign_id=campaigns.id
    WHERE name = 'Direct send'
    ORDER BY created_at DESC
    LIMIT ${summary ? 1 : 10}
  `).all();
  return resultRows(result).map(run => ({
    id: run.id,
    status: run.status,
    created: run.created_at,
    plannedSends: Number(run.planned_sends || 0),
    sent: Number(run.sent_count || 0),
    pending: Number(run.pending_count || 0),
    uncertain: Number(run.uncertain_count || 0),
    failed: Number(run.failed_count || 0),
    cancelled:Number(run.cancelled_count || 0),
    inFlight: Number(run.in_flight_count || 0),
    nextSendAt: run.next_send_at,
    failureCodes: String(run.failure_codes || '').split(',').filter(Boolean),
    preparation:run.status==='Preparing'?{phase:run.prep_phase || 'legacy',total:Number(run.prep_total || run.planned_sends || 0),prepared:Number(run.prepared_count || 0),senders:Number(run.total_senders || 0),readySenders:Number(run.prepared_senders || 0),error:run.error_code || (!run.prep_phase?'LEGACY_PREPARATION_REVIEW':null)}:undefined,
    liveReady: true
  }));
}

async function insertLeads(db, leads, onProgress) {
  let inserted = 0;
  for (let offset = 0; offset < leads.length; offset += 1000) {
    const statements = [];
    for (let start = offset; start < Math.min(offset + 1000, leads.length); start += 15) {
      const chunk = leads.slice(start, start + 15);
      const placeholders = chunk.map(() => '(?, ?, ?, ?, ?, ?)').join(', ');
      const values = chunk.flatMap(lead => [lead.id, lead.email, lead.name, lead.store, lead.status, new Date().toISOString()]);
      statements.push(db.prepare(`INSERT OR IGNORE INTO leads (id, email, name, store, status, created_at) VALUES ${placeholders}`).bind(...values));
    }
    const results = await db.batch(statements);
    inserted += results.reduce((total, result) => total + (result.meta?.changes || 0), 0);
    onProgress?.(Math.min(offset + 1000, leads.length));
  }
  return inserted;
}

async function insertLeadImportBatch(db, batch, onProgress) {
  await db.prepare(`
    INSERT INTO lead_import_batches (
      id, file_name, created_at, imported_count, duplicate_count, invalid_count
    ) VALUES (?, ?, ?, ?, ?, ?)
  `).bind(
    batch.id,
    batch.fileName,
    batch.createdAt,
    batch.importedCount,
    batch.duplicateCount,
    batch.invalidCount
  ).run();

  let statements = [], linked = 0;
  const flush = async () => {
    if (!statements.length) return;
    await db.batch(statements);
    statements = [];
    onProgress?.(linked);
  };
  for (let offset = 0; offset < batch.emails.length; offset += 80) {
    const emails = batch.emails.slice(offset, offset + 80);
    const placeholders = emails.map(() => '?').join(', ');
    const leads = resultRows(await db.prepare(`SELECT id FROM leads WHERE email IN (${placeholders})`).bind(...emails).all());
    for (let start = 0; start < leads.length; start += 30) {
      const chunk = leads.slice(start, start + 30);
      const values = chunk.flatMap(lead => [batch.id, lead.id, batch.createdAt]);
      statements.push(db.prepare(`
        INSERT OR IGNORE INTO lead_import_batch_items (batch_id, lead_id, created_at)
        VALUES ${chunk.map(() => '(?, ?, ?)').join(', ')}
      `).bind(...values));
      linked += chunk.length;
      if (statements.length === 100 || (onProgress && statements.length >= 12)) await flush();
    }
  }
  await flush();
}

async function insertAccounts(db, rows) {
  let added = 0;
  for (let offset = 0; offset < rows.length; offset += 100) {
    const statements = [];
    for (let start = offset; start < Math.min(offset + 100, rows.length); start += 20) {
      const chunk = rows.slice(start, start + 20);
      const placeholders = chunk.map(() => '(?, ?, ?, 0, 0, ?, ?)').join(', ');
      const values = chunk.flatMap(account => [account.id, account.email, account.cap, 'Pending connection', account.createdAt]);
      statements.push(db.prepare(`
        INSERT OR IGNORE INTO accounts (id, email, cap, used, paused, connection, created_at)
        VALUES ${placeholders}
      `).bind(...values));
    }
    const results = await db.batch(statements);
    added += results.reduce((total, result) => total + (result.meta?.changes || 0), 0);
  }
  return added;
}

function personalize(value, lead) {
  return value.replace(/{{\s*(name|store|email)\s*}}/g, (_, field) => lead[field] || '');
}

async function handlePost(request, env, path) {
  const origin = request.headers.get('Origin');
  if (!origin || origin !== new URL(request.url).origin) throw new HttpError(403, 'Cross-origin request blocked.');
  if (!request.headers.get('Content-Type')?.startsWith('application/json')) throw new HttpError(415, 'JSON required.');
  const body = await readJson(request);
  const db = env.DB;

  if(path==='/api/internal/prepare-tick')return jsonResponse(200,{ok:true,...await continueNextPreparation(db)});
  if(path==='/api/campaign/prepare'){
    if(typeof body.campaignId!=='string')throw new HttpError(400,'Choose a campaign to prepare.');
    const current=await preparationProgress(db,body.campaignId);
    if(!current)throw new HttpError(404,'Campaign not found.');
    return jsonResponse(200,{ok:true,preparation:await continuePreparation(db,body.campaignId)});
  }

  if (path === '/api/internal/send-tick') {
    const activeRun = await db.prepare(`
      SELECT c.id FROM campaigns c
      WHERE c.name = 'Direct send' AND c.status IN ('Sending', 'Scheduled')
        AND (c.next_send_at IS NULL OR c.next_send_at <= ?)
        AND EXISTS (
          SELECT 1 FROM campaign_deliveries d
          WHERE d.campaign_id = c.id AND d.status = 'queued'
        )
      ORDER BY c.created_at LIMIT 1
    `).bind(new Date().toISOString()).first();
    if (!activeRun) return jsonResponse(200, { ok: true, done: true });
    body.campaignId = activeRun.id;
    path = '/api/campaign/send';
  }

  if (path === '/api/import' || path === '/api/import/progress') {
    if (typeof body.text !== 'string') throw new HttpError(400, 'Choose a CSV or TXT file.');
    const runImport = async (emit = () => {}) => {
      emit({ phase: 'validating', completed: 0, total: null });
      const existing = resultRows(await db.prepare('SELECT email FROM leads').all());
      const parsed = parseLeads(body.text, existing);
      const batchLeads = parseLeads(body.text, []);
      if(db.remainingBudget){
        const left=db.remainingBudget();
        if(left.writes < parsed.leads.length*4+batchLeads.leads.length*4+20)throw new HttpError(400,'This import exceeds the remaining application write budget. Split the file or wait for the next daily reset.');
      }
      const total = parsed.leads.length + batchLeads.leads.length;
      emit({ phase: 'saving leads', completed: 0, total });
      const imported = await insertLeads(db, parsed.leads, completed => emit({ phase: 'saving leads', completed, total }));
      const createdAt = new Date().toISOString();
      const batchId = crypto.randomUUID();
      const fileName = String(body.fileName || 'Imported leads').replace(/[\\/]/g, '').trim().slice(0, 255) || 'Imported leads';
      await insertLeadImportBatch(db, {
        id: batchId, fileName, createdAt, importedCount: imported,
        duplicateCount: parsed.duplicates + parsed.leads.length - imported,
        invalidCount: parsed.invalid, emails: batchLeads.leads.map(lead => lead.email)
      }, completed => emit({ phase: 'saving batch', completed: parsed.leads.length + completed, total }));
      const result = { imported, duplicates: parsed.duplicates + parsed.leads.length - imported, invalid: parsed.invalid, batchId };
      emit({ phase: 'complete', completed: total, total, result });
      return result;
    };
    if (path === '/api/import') return jsonResponse(200, await runImport());
    const stream = new ReadableStream({
      start(controller) {
        const emit = event => controller.enqueue(encoder.encode(JSON.stringify(event) + '\n'));
        return runImport(emit).then(() => controller.close()).catch(error => {
          emit({ phase: 'error', error: error instanceof HttpError ? error.message : 'Import interrupted. Refresh the batch list before retrying to check what was saved.' });
          controller.close();
        });
      }
    });
    return new Response(stream, { headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store, no-transform', 'X-Content-Type-Options': 'nosniff' } });
  }

  if (path === '/api/import/batch/delete') {
    const batchId = typeof body.batchId === 'string' ? body.batchId : '';
    const batch = batchId
      ? await db.prepare('SELECT id FROM lead_import_batches WHERE id = ?').bind(batchId).first()
      : null;
    if (!batch) throw new HttpError(404, 'Lead upload batch not found.');
    const counts = await db.prepare(`
      SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN EXISTS (
          SELECT 1 FROM lead_import_batch_items other
          WHERE other.lead_id = item.lead_id AND other.batch_id != item.batch_id
        ) THEN 1 ELSE 0 END) AS retained,
        SUM(CASE WHEN NOT EXISTS (
          SELECT 1 FROM lead_import_batch_items other
          WHERE other.lead_id = item.lead_id AND other.batch_id != item.batch_id
        ) AND EXISTS (
          SELECT 1 FROM campaign_deliveries d WHERE d.lead_id = item.lead_id
        ) THEN 1 ELSE 0 END) AS archived,
        SUM(CASE WHEN NOT EXISTS (
          SELECT 1 FROM lead_import_batch_items other
          WHERE other.lead_id = item.lead_id AND other.batch_id != item.batch_id
        ) AND NOT EXISTS (
          SELECT 1 FROM campaign_deliveries d WHERE d.lead_id = item.lead_id
        ) THEN 1 ELSE 0 END) AS deleted
      FROM lead_import_batch_items item
      WHERE item.batch_id = ?
    `).bind(batchId).first();
    await db.batch([
      db.prepare(`
        UPDATE leads SET status = 'Archived'
        WHERE id IN (SELECT lead_id FROM lead_import_batch_items WHERE batch_id = ?)
          AND NOT EXISTS (
            SELECT 1 FROM lead_import_batch_items other
            WHERE other.lead_id = leads.id AND other.batch_id != ?
          )
          AND EXISTS (
            SELECT 1 FROM campaign_deliveries d WHERE d.lead_id = leads.id
          )
      `).bind(batchId, batchId),
      db.prepare(`
        DELETE FROM leads
        WHERE id IN (SELECT lead_id FROM lead_import_batch_items WHERE batch_id = ?)
          AND NOT EXISTS (
            SELECT 1 FROM lead_import_batch_items other
            WHERE other.lead_id = leads.id AND other.batch_id != ?
          )
          AND NOT EXISTS (
            SELECT 1 FROM campaign_deliveries d WHERE d.lead_id = leads.id
          )
      `).bind(batchId, batchId),
      db.prepare('DELETE FROM lead_import_batches WHERE id = ?').bind(batchId)
    ]);
    return jsonResponse(200, {
      ok: true,
      retained: Number(counts?.retained || 0),
      archived: Number(counts?.archived || 0),
      deleted: Number(counts?.deleted || 0)
    });
  }

  if (path === '/api/lead/update') {
    const id = typeof body.id === 'string' ? body.id : '';
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    const store = typeof body.store === 'string' ? body.store.trim() : '';
    if (!id || !emailPattern.test(email)) throw new HttpError(400, 'Enter a valid email address.');
    if (!await db.prepare('SELECT id FROM leads WHERE id = ?').bind(id).first()) {
      throw new HttpError(404, 'Lead not found.');
    }
    if (await db.prepare('SELECT id FROM leads WHERE email = ? AND id != ?').bind(email, id).first()) {
      throw new HttpError(409, 'Another lead already uses this email address.');
    }
    await db.prepare('UPDATE leads SET email = ?, name = ?, store = ? WHERE id = ?')
      .bind(email, name, store, id).run();
    return jsonResponse(200, { ok: true });
  }

  if (path === '/api/lead/delete') {
    const id = typeof body.id === 'string' ? body.id : '';
    const lead = id ? await db.prepare('SELECT id FROM leads WHERE id = ?').bind(id).first() : null;
    if (!lead) throw new HttpError(404, 'Lead not found.');
    const used = await db.prepare('SELECT 1 FROM campaign_deliveries WHERE lead_id = ? LIMIT 1').bind(id).first();
    if (used) {
      await db.prepare("UPDATE leads SET status = 'Archived' WHERE id = ?").bind(id).run();
      return jsonResponse(200, { ok: true, archived: true });
    }
    await db.prepare('DELETE FROM leads WHERE id = ?').bind(id).run();
    return jsonResponse(200, { ok: true, archived: false });
  }

  if (path === '/api/lead/restore') {
    const id = typeof body.id === 'string' ? body.id : '';
    const result = await db.prepare("UPDATE leads SET status = 'Ready' WHERE id = ? AND status = 'Archived'").bind(id).run();
    if (!result.meta?.changes) throw new HttpError(404, 'Archived lead not found.');
    return jsonResponse(200, { ok: true });
  }

  if (path === '/api/template' || path === '/api/template/update') {
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    const subject = typeof body.subject === 'string' ? body.subject.trim() : '';
    const message = typeof body.body === 'string' ? body.body : '';
    if (!name || !message.trim()) throw new HttpError(400, 'Enter a plan name and message body.');
    if (/{{\s*(?!name\s*}}|store\s*}}|email\s*}})[^}]+}}/.test(message + subject)) {
      throw new HttpError(400, 'Use only {{name}}, {{store}} or {{email}}.');
    }
    if (path === '/api/template/update') {
      const id = typeof body.id === 'string' ? body.id : '';
      if (!id || !await db.prepare('SELECT id FROM templates WHERE id = ?').bind(id).first()) {
        throw new HttpError(404, 'Scouting plan not found.');
      }
      await db.prepare('UPDATE templates SET name = ?, subject = ?, body = ? WHERE id = ?')
        .bind(name, subject, message, id).run();
      return jsonResponse(200, { ok: true });
    }
    const id = crypto.randomUUID();
    await db.prepare('INSERT INTO templates (id, name, subject, body, created_at) VALUES (?, ?, ?, ?, ?)')
      .bind(id, name, subject, message, new Date().toISOString()).run();
    return jsonResponse(200, { ok: true, id });
  }

  if (path === '/api/template/delete') {
    const id = typeof body.id === 'string' ? body.id : '';
    const template = id
      ? await db.prepare('SELECT id, archived_at FROM templates WHERE id = ?').bind(id).first()
      : null;
    if (!template) throw new HttpError(404, 'Scouting plan not found.');
    const used = await db.prepare(`
      SELECT 1 FROM campaigns WHERE template_id = ?
      UNION ALL
      SELECT 1 FROM campaign_deliveries WHERE template_id = ?
      LIMIT 1
    `).bind(id, id).first();
    if (used) {
      await db.prepare('UPDATE templates SET archived_at = COALESCE(archived_at, ?) WHERE id = ?')
        .bind(new Date().toISOString(), id).run();
      return jsonResponse(200, { ok: true, archived: true });
    }
    await db.prepare('DELETE FROM templates WHERE id = ?').bind(id).run();
    return jsonResponse(200, { ok: true, archived: false });
  }

  if (path === '/api/template/status') {
    if (typeof body.id !== 'string' || typeof body.paused !== 'boolean') throw new HttpError(400, 'Choose a plan and status.');
    const result = await db.prepare('UPDATE templates SET archived_at = ? WHERE id = ?').bind(body.paused ? new Date().toISOString() : null, body.id).run();
    if (!result.meta?.changes) throw new HttpError(404, 'Scouting plan not found.');
    return jsonResponse(200, { ok: true });
  }

  if (path === '/api/thread/update') {
    if (typeof body.id !== 'string') throw new HttpError(400, 'Choose a conversation.');
    const values = [], assignments = [];
    for (const key of ['unread', 'starred', 'archived']) {
      if (typeof body[key] === 'boolean') { assignments.push(`${key} = ?`); values.push(Number(body[key])); }
    }
    if (body.tag !== undefined) {
      if (!['Interested','Follow up','Question','Not now'].includes(body.tag)) throw new HttpError(400, 'Invalid tag.');
      assignments.push('tag = ?'); values.push(body.tag);
    }
    if (!assignments.length) throw new HttpError(400, 'No changes provided.');
    const result = await db.prepare(`UPDATE threads SET ${assignments.join(', ')} WHERE id = ?`).bind(...values, body.id).run();
    if (!result.meta?.changes) throw new HttpError(404, 'Conversation not found.');
    return jsonResponse(200, { ok: true });
  }

  if (path === '/api/template/restore') {
    const id = typeof body.id === 'string' ? body.id : '';
    const result = await db.prepare('UPDATE templates SET archived_at = NULL WHERE id = ? AND archived_at IS NOT NULL')
      .bind(id).run();
    if (!result.meta?.changes) throw new HttpError(404, 'Archived scouting plan not found.');
    return jsonResponse(200, { ok: true });
  }

  if (path === '/api/account/add') {
    const emails = Array.isArray(body.emails)
      ? body.emails
      : typeof body.text === 'string' ? body.text.split(/\r?\n/) : [];
    if (emails.length > 1000) throw new HttpError(400, 'Add no more than 1,000 account addresses at a time.');
    const seen = new Set();
    const valid = [];
    let invalid = 0, duplicateInput = 0;
    for (const value of emails) {
      const email = String(value).trim().toLowerCase();
      if (!email) continue;
      if (!emailPattern.test(email)) {
        invalid++;
        continue;
      }
      if (seen.has(email)) {
        duplicateInput++;
        continue;
      }
      seen.add(email);
      valid.push(email);
    }
    const existing = new Set(resultRows(await db.prepare('SELECT email FROM accounts').all()).map(account => account.email.toLowerCase()));
    const duplicates = duplicateInput + valid.filter(email => existing.has(email)).length;
    const defaultCap = Number((await db.prepare('SELECT value FROM app_settings WHERE key = ?').bind('defaultCap').first())?.value || 40);
    const rows = valid.filter(email => !existing.has(email)).map(email => ({
      id: crypto.randomUUID(),
      email,
      cap: defaultCap,
      createdAt: new Date().toISOString()
    }));
    const added = await insertAccounts(db, rows);
    return jsonResponse(200, { added, duplicates: duplicates + rows.length - added, invalid });
  }

  if (path === '/api/account/connect') {
    const email = String(body.email || '').trim().toLowerCase();
    const password = String(body.appPassword || '').replace(/\s/g, '');
    if (!emailPattern.test(email)) throw new HttpError(400, 'Enter a valid Gmail address.');
    if (!/^[a-z0-9]{16}$/i.test(password)) throw new HttpError(400, 'Enter the 16-character Google app password.');
    if (!env.CREDENTIALS_ENCRYPTION_KEY) throw new HttpError(503, 'Secure account storage is not configured.');

    const encrypted = await encryptCredential(email, password, env.CREDENTIALS_ENCRYPTION_KEY);
    let verification;
    try {
      verification = await verifyGmailCredentials(email, password);
    } catch {
      throw new HttpError(422, 'Gmail IMAP authentication failed. Check the email, app password and IMAP access.');
    }

    const now = new Date().toISOString();
    const existing = await db.prepare('SELECT id FROM accounts WHERE email = ?').bind(email).first();
    const id = existing?.id || crypto.randomUUID();
    const defaultCap = Number((await db.prepare('SELECT value FROM app_settings WHERE key = ?').bind('defaultCap').first())?.value || 40);
    const connection = verification.smtp ? 'Connected' : 'IMAP only';
    await db.prepare(`
      INSERT INTO accounts (
        id, email, cap, used, paused, connection, created_at, credential_ciphertext,
        imap_verified_at, smtp_verified_at
      ) VALUES (?, ?, ?, 0, 0, ?, ?, ?, ?, ?)
      ON CONFLICT(email) DO UPDATE SET
        credential_ciphertext = excluded.credential_ciphertext,
        connection = excluded.connection,
        imap_verified_at = excluded.imap_verified_at,
        smtp_verified_at = excluded.smtp_verified_at
    `).bind(id, email, defaultCap, connection, now, encrypted, now, verification.smtp ? now : null).run();
    return jsonResponse(200, {
      id,
      email,
      connection,
      smtpVerified: verification.smtp
    });
  }

  if (path === '/api/account') {
    const result = await db.prepare('UPDATE accounts SET paused = CASE paused WHEN 1 THEN 0 ELSE 1 END WHERE id = ?').bind(body.id).run();
    if (!result.meta?.changes) throw new HttpError(404, 'Account not found.');
    return jsonResponse(200, { ok: true });
  }

  if (path === '/api/account/cap') {
    const cap = Number(body.cap);
    if (!Number.isInteger(cap) || cap < 1 || cap > 40) throw new HttpError(400, 'Enter a cap from 1 to 40.');
    const result = await db.prepare('UPDATE accounts SET cap = ? WHERE id = ?').bind(cap, body.id).run();
    if (!result.meta?.changes) throw new HttpError(404, 'Account not found.');
    return jsonResponse(200, { ok: true });
  }

  if (path === '/api/account/health/settings') {
    const email = String(body.email || '').trim().toLowerCase();
    if (!emailPattern.test(email)) throw new HttpError(400, 'Enter a valid alert email address.');
    await db.prepare(`
      INSERT INTO app_settings (key, value) VALUES ('healthNotificationEmail', ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `).bind(email).run();
    return jsonResponse(200, { ok: true, email });
  }

  if (path === '/api/account/health/check') {
    if (typeof body.accountId !== 'string') throw new HttpError(400, 'Choose an account to check.');
    const account = await db.prepare(`
      SELECT id, email, connection, credential_ciphertext, health_status, health_checked_at
      FROM accounts WHERE id = ?
    `).bind(body.accountId).first();
    if (!account) throw new HttpError(404, 'Account not found.');
    if (!account.credential_ciphertext) {
      return jsonResponse(200, { ok: true, skipped: true, reason: 'Reconnect this account before running a health check.' });
    }

    const checkedAt = account.health_checked_at ? Date.parse(account.health_checked_at) : 0;
    if (body.force !== true && checkedAt && Date.now() - checkedAt < healthCheckIntervalMs) {
      const activeEvent = await db.prepare(`
        SELECT id FROM account_health_events
        WHERE account_id = ? AND resolved_at IS NULL
        ORDER BY created_at DESC LIMIT 1
      `).bind(account.id).first();
      const notification = activeEvent && !body.suppressNotification ? await sendHealthNotification(db, env, activeEvent.id) : null;
      return jsonResponse(200, {
        ok: true,
        skipped: true,
        healthStatus: account.health_status,
        emailStatus: notification?.status || null
      });
    }
    if (!env.CREDENTIALS_ENCRYPTION_KEY) throw new HttpError(503, 'Secure account storage is not configured.');

    let result;
    let password;
    try {
      password = await decryptCredential(account.email, account.credential_ciphertext, env.CREDENTIALS_ENCRYPTION_KEY);
    } catch {
      result = {
        status: 'Problem',
        code: 'CREDENTIALS_UNAVAILABLE',
        message: 'Stored credentials could not be verified. Reconnect this account and run the health check again.'
      };
    }
    if (password) result = assessAccountHealth(await checkGmailHealth(account.email, password));
    const eventId = await saveAccountHealth(db, account.id, result);
    const notification = eventId && !body.suppressNotification && healthIssueStatuses.has(result.status)
      ? await sendHealthNotification(db, env, eventId)
      : null;
    return jsonResponse(200, {
      ok: true,
      checked: true,
      healthStatus: result.status,
      healthCheckedAt: new Date().toISOString(),
      healthCode: result.code,
      healthMessage: result.message,
      eventId,
      emailStatus: notification?.status || null
    });
  }

  if(path==='/api/notifications/delete'){
    if(typeof body.eventId!=='string')throw new HttpError(400,'Choose a notification.');
    await db.prepare('UPDATE account_health_events SET deleted_at=COALESCE(deleted_at,?) WHERE id=?').bind(new Date().toISOString(),body.eventId).run();
    return jsonResponse(200,{ok:true});
  }
  if(path==='/api/notifications/delete-read'){
    const result=await db.prepare('UPDATE account_health_events SET deleted_at=? WHERE deleted_at IS NULL AND read_at IS NOT NULL').bind(new Date().toISOString()).run();
    return jsonResponse(200,{ok:true,deleted:result.meta?.changes || 0});
  }

  if (path === '/api/account/health/read') {
    if (typeof body.eventId !== 'string') throw new HttpError(400, 'Choose a health notification.');
    const result = await db.prepare(`
      UPDATE account_health_events SET read_at = COALESCE(read_at, ?)
      WHERE id = ?
    `).bind(new Date().toISOString(), body.eventId).run();
    if (!result.meta?.changes) throw new HttpError(404, 'Health notification not found.');
    return jsonResponse(200, { ok: true });
  }

  if (path === '/api/account/health/notify') {
    if (typeof body.eventId !== 'string') throw new HttpError(400, 'Choose a health notification.');
    const notification = await sendHealthNotification(db, env, body.eventId, true);
    if (notification.status === 'missing') throw new HttpError(404, 'Health notification not found.');
    if (notification.status === 'failed') throw new HttpError(502, `Email alert failed: ${notification.error}`);
    return jsonResponse(200, { ok: notification.status === 'sent', ...notification });
  }

  if (path === '/api/settings') {
    const cap = Number(body.cap);
    const healthEmail = typeof body.healthNotificationEmail === 'string' ? body.healthNotificationEmail.trim().toLowerCase() : undefined;
    if (healthEmail && !emailPattern.test(healthEmail)) throw new HttpError(400, 'Enter a valid health-alert email address.');
    if (!Number.isInteger(cap) || cap < 1 || cap > 40) throw new HttpError(400, 'Enter a cap from 1 to 40.');
    await db.batch([
      ...(healthEmail !== undefined ? [db.prepare("INSERT INTO app_settings (key, value) VALUES ('healthNotificationEmail', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(healthEmail)] : []),
      ...(typeof body.workspaceName === 'string' ? [db.prepare("INSERT INTO app_settings (key, value) VALUES ('workspaceName', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(body.workspaceName.trim().slice(0, 100) || 'Relay Mail')] : []),
      ...(body.openTracking !== undefined ? [db.prepare("INSERT INTO app_settings (key, value) VALUES ('openTracking', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(body.openTracking ? '1' : '0')] : []),
      ...(body.planOpenTracking !== undefined ? [db.prepare("INSERT INTO app_settings (key, value) VALUES ('planOpenTracking', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(body.planOpenTracking ? '1' : '0')] : []),
      ...(body.includeSpamFolders !== undefined ? [db.prepare("INSERT INTO app_settings (key, value) VALUES ('includeSpamFolders', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(body.includeSpamFolders ? '1' : '0')] : []),
      db.prepare('INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').bind('defaultCap', String(cap)),
      db.prepare('UPDATE accounts SET cap = ?').bind(cap)
    ]);
    return jsonResponse(200, { ok: true });
  }

  if (path === '/api/sending/start') {
    const activeDirectSend = await db.prepare(`
      SELECT c.id, c.status, c.created_at, c.planned_sends AS planned,
        c.sent_count AS sent, c.pending_count AS pending
      FROM campaigns c
      WHERE c.name = 'Direct send'
        AND c.status IN ('Preparing', 'Dry run', 'Sending', 'Scheduled', 'Paused', 'Needs review', 'User paused')
        AND (c.status IN ('Preparing', 'Needs review', 'User paused') OR c.pending_count > 0)
      ORDER BY c.created_at DESC LIMIT 1
    `).first();
    if (activeDirectSend) {
      if(activeDirectSend.status==='Preparing'){
        const progress=await preparationProgress(db,activeDirectSend.id);
        if(progress.phase==='legacy')throw new HttpError(409,'An earlier campaign has no resumable preparation snapshot. Review or cancel it before starting a replacement. No history was removed.','LEGACY_PREPARATION_REVIEW');
        return jsonResponse(202,{ok:true,id:activeDirectSend.id,plannedSends:progress.total,pending:Number(activeDirectSend.pending),preparing:true,preparation:progress,resumed:true});
      }
      if (activeDirectSend.status === 'Needs review') {
        throw new HttpError(409, 'This send has an unconfirmed email. Review it in Sending activity before continuing.');
      }
      if (activeDirectSend.status === 'User paused') {
        throw new HttpError(409, 'This send is paused. Resume it from Sending activity.');
      }
      return jsonResponse(200, {
        ok: true,
        id: activeDirectSend.id,
        plannedSends: Number(activeDirectSend.planned),
        sent: Number(activeDirectSend.sent),
        pending: Number(activeDirectSend.pending),
        resumed: true
      });
    }

    const otherActiveSend = await db.prepare(`
      SELECT c.id FROM campaigns c
      WHERE c.status = 'Sending' AND c.pending_count > 0
      LIMIT 1
    `).first();
    if (otherActiveSend) {
      throw new HttpError(409, 'Another send is already in progress. Pause or finish it before starting a new direct send.');
    }

    const [leadsResult, accountsResult, settings, usageResult, templatesResult] = await Promise.all([
      db.prepare(eligibleLeadsSql).all(),
      db.prepare(`
        SELECT id, cap, paused, connection, credential_ciphertext, smtp_verified_at
        FROM accounts ORDER BY created_at, email
      `).all(),
      db.prepare('SELECT value FROM app_settings WHERE key = ?').bind('defaultCap').first(),
      db.prepare(`
        SELECT account_id, COUNT(*) AS used
        FROM campaign_deliveries
        WHERE status IN ('sending', 'sent', 'uncertain')
          AND COALESCE(sent_at, started_at) > ?
        GROUP BY account_id
      `).bind(new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()).all(),
      db.prepare('SELECT id, name, subject, body FROM templates WHERE archived_at IS NULL ORDER BY created_at, id').all()
    ]);
    const leads = resultRows(leadsResult);
    if (!leads.length) throw new HttpError(400, 'There are no unsent leads ready to send.');
    const templates = resultRows(templatesResult);
    if (!templates.length) throw new HttpError(400, 'Create an active scouting plan before sending.');
    const usedByAccount = new Map(resultRows(usageResult).map(row => [row.account_id, Number(row.used)]));
    const accounts = resultRows(accountsResult).map(account => ({
      ...account,
      used: usedByAccount.get(account.id) || 0,
      connection: account.smtp_verified_at && account.credential_ciphertext ? account.connection : 'Pending connection'
    }));
    const allocation = allocateRepeatedCampaign(leads, accounts, Number(settings?.value || 40));
    if (!allocation.assignments.length) throw new HttpError(400, 'No verified, available sender capacity.');
    const planned = assignScoutingPlans(allocation.assignments, templates, leads);
    if (planned.missingAccountId) {
      const account = accounts.find(item => item.id === planned.missingAccountId);
      throw new HttpError(400, `No scouting plan has complete personalization for every recipient assigned to ${account?.email || 'a sender account'}.`);
    }
    const summary = planned.assignments.map(assignment => ({
      batch: assignment.batch,
      day: assignment.day,
      accountId: assignment.accountId,
      templateId: assignment.templateId,
      templateName: assignment.templateName,
      count: assignment.leadIds.length
    }));
    const id = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    try{
      const preparation=await createPreparation(db,{id,name:'Direct send',templateId:planned.assignments[0].templateId,createdAt,remaining:allocation.remaining,days:allocation.days,summary,assignments:planned.assignments,targetStatus:'Sending'});
      return jsonResponse(202,{ok:true,id,plannedSends:allocation.sends,sent:0,pending:0,preparing:true,preparation,resumed:false});
    }catch(error){
      const competing=await db.prepare("SELECT id,status FROM campaigns WHERE name='Direct send' AND status IN ('Preparing','Dry run','Sending','Scheduled','Paused','Needs review','User paused') ORDER BY created_at DESC LIMIT 1").first();
      if(competing?.status==='Preparing'){const progress=await preparationProgress(db,competing.id);return jsonResponse(202,{ok:true,id:competing.id,preparing:true,preparation:progress,resumed:true});}
      if(competing)throw new HttpError(409,'A campaign started in another tab. Refresh to see its current state.','CAMPAIGN_CONFLICT');
      if(error instanceof PreparationError)throw new HttpError(400,error.message,error.code);
      console.error('Campaign preparation snapshot could not be saved:',error);
      throw new HttpError(503,'Campaign preparation could not be saved. Retry initiation; existing campaign history is unchanged.','PREPARATION_SAVE_FAILED');
    }
  }

  if (path === '/api/campaign') {
    if (!body.name?.trim()) throw new HttpError(400, 'Enter a campaign name.');
    const [leadsResult, accountsResult, settings, usageResult, templatesResult] = await Promise.all([
      db.prepare("SELECT id, email, name, store, status FROM leads WHERE status = 'Ready' ORDER BY created_at, email").all(),
      db.prepare(`
        SELECT id, cap, paused, connection, credential_ciphertext, smtp_verified_at
        FROM accounts ORDER BY created_at, email
      `).all(),
      db.prepare('SELECT value FROM app_settings WHERE key = ?').bind('defaultCap').first(),
      db.prepare(`
        SELECT account_id, COUNT(*) AS used
        FROM campaign_deliveries
        WHERE status IN ('sending', 'sent', 'uncertain')
          AND COALESCE(sent_at, started_at) > ?
        GROUP BY account_id
      `).bind(new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()).all(),
      db.prepare('SELECT id, name, subject, body FROM templates WHERE archived_at IS NULL ORDER BY created_at, id').all()
    ]);
    const leads = resultRows(leadsResult);
    if (!leads.length) throw new HttpError(400, 'Import leads before creating a dry run.');
    const templates = resultRows(templatesResult);
    if (!templates.length) throw new HttpError(400, 'Create a scouting plan before creating a campaign.');
    const usedByAccount = new Map(resultRows(usageResult).map(row => [row.account_id, Number(row.used)]));
    const accounts = resultRows(accountsResult).map(account => ({
      ...account,
      used: usedByAccount.get(account.id) || 0,
      connection: account.smtp_verified_at && account.credential_ciphertext ? account.connection : 'Pending connection'
    }));
    const allocation = allocateRepeatedCampaign(leads, accounts, Number(settings?.value || 40));
    if (!allocation.assignments.length) throw new HttpError(400, 'No verified, available account capacity.');
    const planned = assignScoutingPlans(allocation.assignments, templates, leads);
    if (planned.missingAccountId) {
      const account = accounts.find(item => item.id === planned.missingAccountId);
      throw new HttpError(400, `No scouting plan has complete personalization for every recipient assigned to ${account?.email || 'a sender account'}.`);
    }
    const summary = planned.assignments.map(assignment => ({
      batch: assignment.batch,
      day: assignment.day,
      accountId: assignment.accountId,
      templateId: assignment.templateId,
      templateName: assignment.templateName,
      count: assignment.leadIds.length
    }));
    const id = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    const preparation=await createPreparation(db,{id,name:body.name.trim(),templateId:planned.assignments[0].templateId,createdAt,remaining:allocation.remaining,days:allocation.days,summary,assignments:planned.assignments,targetStatus:'Dry run'});
    return jsonResponse(202,{ok:true,id,sends:allocation.sends,remaining:allocation.remaining,days:allocation.days,batches:allocation.batches,assignments:summary,preparing:true,preparation});
  }

  if (path === '/api/read') {
    await db.prepare('UPDATE threads SET unread = 0 WHERE id = ?').bind(body.id).run();
    return jsonResponse(200, { ok: true });
  }

  if(path==='/api/mail/conversation'){
    if(body.manual!==true)throw new HttpError(400,'Open or refresh a conversation to sync its Gmail history.');
    if(typeof body.threadId!=='string')throw new HttpError(400,'Choose a conversation.');
    const thread=await db.prepare('SELECT id,account_id,provider_thread_id,provider_uid_validity,provider_last_uid,provider_history_before_uid FROM threads WHERE id=?').bind(body.threadId).first();
    if(!thread)throw new HttpError(404,'Conversation not found.');
    const account=await db.prepare('SELECT id,email,connection,credential_ciphertext FROM accounts WHERE id=?').bind(thread.account_id).first();
    if(!account?.credential_ciphertext || !['Connected','IMAP only'].includes(account.connection))throw new HttpError(409,'Reconnect the sending account to sync this conversation.');
    const leaseToken=crypto.randomUUID(),now=new Date().toISOString();
    const lease=await db.prepare('UPDATE accounts SET sync_lease_token=?,sync_lease_until=? WHERE id=? AND (sync_lease_until IS NULL OR sync_lease_until<=?)').bind(leaseToken,new Date(Date.now()+180000).toISOString(),account.id,now).run();
    if(!lease.meta?.changes)return jsonResponse(200,{ok:true,busy:true,thread:await loadThread(db,thread.id)});
    try{
      const original=await db.prepare("SELECT message_id FROM messages WHERE thread_id=? AND message_id<>'' ORDER BY time DESC LIMIT 1").bind(thread.id).first();
      const password=await decryptCredential(account.email,account.credential_ciphertext,env.CREDENTIALS_ENCRYPTION_KEY);
      let history;
      try{history=await fetchGmailConversation(account.email,password,{providerThreadId:thread.provider_thread_id,messageId:original?.message_id,beforeUid:body.loadOlder===true?Number(thread.provider_history_before_uid || 0):0,afterUid:Number(thread.provider_last_uid || 0),uidValidity:thread.provider_uid_validity});}
      catch(error){throw new HttpError(502,mailSyncError('Conversation history',error),'MAIL_SYNC_FAILED');}
      for(const message of history.messages){if(message.fromAddress.toLowerCase()===account.email.toLowerCase())await reconcileUncertainCampaignDelivery(db,message);}
      const merged=await mergeConversation(db,thread,account,history.messages);
      const before=body.loadOlder===true?history.beforeUid:history.more?Math.max(Number(thread.provider_history_before_uid || 0),Number(history.beforeUid || 0)):thread.provider_history_before_uid;
      await db.prepare('UPDATE threads SET provider_thread_id=?,provider_uid_validity=?,provider_last_uid=?,provider_history_before_uid=? WHERE id=?').bind(history.providerThreadId,history.uidValidity,history.lastUid,before || null,thread.id).run();
      return jsonResponse(200,{ok:true,thread:await loadThread(db,thread.id),imported:merged.imported,retiredThreadIds:await Promise.all(merged.movedThreadIds.map(async id=>(await db.prepare("SELECT 1 FROM messages WHERE thread_id=? AND direction='in' AND time>=? LIMIT 1").bind(id,replyWindowStartIso()).first())?null:id)).then(ids=>ids.filter(Boolean))});
    }finally{await db.prepare('UPDATE accounts SET sync_lease_token=NULL,sync_lease_until=NULL WHERE id=? AND sync_lease_token=?').bind(account.id,leaseToken).run().catch(()=>{});}
  }

  if (path === '/api/mail/sync') {
    if(body.manual !== true) throw new HttpError(400, 'Automatic mailbox checks are disabled. Refresh the dashboard and click Sync connected inboxes.');
    if (typeof body.accountId !== 'string') throw new HttpError(400, 'Choose a connected account to sync.');
    const account = await db.prepare(`
      SELECT id, email, connection, credential_ciphertext, last_sync_uid, last_sync_uid_validity,
        last_sent_sync_uid, last_sent_sync_uid_validity, last_bounce_sync_uid, last_bounce_sync_uid_validity
      FROM accounts WHERE id = ?
    `).bind(body.accountId).first();
    if (!account?.credential_ciphertext || !['Connected', 'IMAP only'].includes(account.connection)) {
      throw new HttpError(409, 'Reconnect this account before syncing its inbox.');
    }
    const leaseToken=crypto.randomUUID(),leaseNow=new Date().toISOString();
    const lease=await db.prepare('UPDATE accounts SET sync_lease_token=?,sync_lease_until=? WHERE id=? AND (sync_lease_until IS NULL OR sync_lease_until<=?)')
      .bind(leaseToken,new Date(Date.now()+180000).toISOString(),account.id,leaseNow).run();
    if(!lease.meta?.changes)return jsonResponse(200,{ok:true,busy:true,imported:0,checked:0,bounces:0});
    try{
    const [hasLeads, hasThreads] = await Promise.all([
      db.prepare('SELECT 1 FROM leads LIMIT 1').first(),
      db.prepare('SELECT 1 FROM threads WHERE account_id = ? LIMIT 1').bind(account.id).first()
    ]);
    if (!hasLeads && !hasThreads) {
      return jsonResponse(200, { ok: true, email: account.email, imported: 0, checked: 0 });
    }
    const password = await decryptCredential(account.email, account.credential_ciphertext, env.CREDENTIALS_ENCRYPTION_KEY);
    const uncertain=await db.prepare("SELECT 1 FROM campaign_deliveries WHERE account_id=? AND status='uncertain' LIMIT 1").bind(account.id).first();
    let fetched;
    try{fetched=await fetchAccountMail(account.email,password,{
      inbox:{uid:account.last_sync_uid,uidValidity:account.last_sync_uid_validity},
      bounces:{uid:account.last_bounce_sync_uid,uidValidity:account.last_bounce_sync_uid_validity},
      sent:{uid:account.last_sent_sync_uid,uidValidity:account.last_sent_sync_uid_validity}
    },{includeSent:body.includeSent===true || Boolean(uncertain)});}
    catch(error){throw new HttpError(502,mailSyncError('Mailbox connection',error),'MAIL_SYNC_FAILED');}
    const {incoming,sent,bounceInbox}=fetched;
    const inboxError=fetched.inboxError?mailSyncError('Inbox',fetched.inboxError):null;
    const bounceError=fetched.bounceError?mailSyncError('Bounce reports',fetched.bounceError):null;
    const sentError=fetched.sentError?mailSyncError('Sent folder',fetched.sentError):null;
    if (!incoming && !sent && !bounceInbox) {
      throw new HttpError(502, [inboxError, sentError, bounceError].filter(Boolean).join(' · '), 'MAIL_SYNC_FAILED');
    }

    const incomingMessages = incoming?.messages || [];
    const bounces=await recordBounceReports(db,account.id,[...incomingMessages,...(bounceInbox?.messages || [])]);
    const senderEmails = [...new Set(incomingMessages.map(message => message.fromAddress).filter(Boolean))];
    let relevantMessages = [];
    if (senderEmails.length) {
      const placeholders = senderEmails.map(() => '?').join(', ');
      const [leadSendersResult, threadSendersResult] = await Promise.all([
        db.prepare(`SELECT email FROM leads WHERE email IN (${placeholders})`).bind(...senderEmails).all(),
        db.prepare(`SELECT email FROM threads WHERE account_id = ? AND email IN (${placeholders})`).bind(account.id, ...senderEmails).all()
      ]);
      const allowedSenders = new Set([
        ...resultRows(leadSendersResult).map(lead => lead.email.toLowerCase()),
        ...resultRows(threadSendersResult).map(thread => thread.email.toLowerCase())
      ]);
      relevantMessages = incomingMessages.filter(message => allowedSenders.has(message.fromAddress));
    }

    let imported = 0;
    const changedThreadIds = new Set();
    for (const message of relevantMessages) {
      const externalId = `${account.id}:${message.externalId}`;
      const duplicate = message.messageId?await db.prepare('SELECT m.id FROM messages m JOIN threads t ON t.id=m.thread_id WHERE t.account_id=? AND m.message_id=? LIMIT 1').bind(account.id,message.messageId).first():await db.prepare('SELECT id FROM messages WHERE external_id=?').bind(externalId).first();
      if (duplicate) continue;

      const references = [...new Set([message.inReplyTo, ...message.references].filter(Boolean))].slice(-20);
      let thread=message.providerThreadId?await db.prepare('SELECT id,subject FROM threads WHERE account_id=? AND provider_thread_id=? LIMIT 1').bind(account.id,message.providerThreadId).first():null;
      if (!thread && references.length) {
        const placeholders = references.map(() => '?').join(', ');
        thread = await db.prepare(`
          SELECT t.id, t.subject FROM threads t
          JOIN messages m ON m.thread_id = t.id
          WHERE t.account_id = ? AND m.message_id IN (${placeholders})
          ORDER BY m.time DESC LIMIT 1
        `).bind(account.id, ...references).first();
      }
      if (!thread && message.fromAddress) {
        const candidates = resultRows(await db.prepare(`
          SELECT id, subject,provider_thread_id FROM threads WHERE account_id = ? AND email = ?
          ORDER BY id DESC LIMIT 30
        `).bind(account.id, message.fromAddress).all());
        thread = candidates.find(candidate => normalizeSubject(candidate.subject) === normalizeSubject(message.subject) && (!message.providerThreadId || !candidate.provider_thread_id || candidate.provider_thread_id===message.providerThreadId));
      }

      const threadId = thread?.id || crypto.randomUUID();
      if (!thread) {
        await db.prepare(`
          INSERT INTO threads (id, name, store, email, subject, account_id, unread, status)
          VALUES (?, ?, '', ?, ?, ?, ?, 'Needs reply')
        `).bind(threadId, message.fromName || message.fromAddress || 'Unknown sender', message.fromAddress, message.subject, account.id,Number(message.unread!==false)).run();
      } else {
        await applyIncomingState(db,threadId,message);
      }
      if(message.providerThreadId)await db.prepare('UPDATE threads SET provider_thread_id=? WHERE id=? AND provider_thread_id IS NULL').bind(message.providerThreadId,threadId).run();
      const result = await db.prepare(`
        INSERT OR IGNORE INTO messages (
          id, thread_id, direction, body, time, message_id, in_reply_to,
          references_json, external_id, send_state
        ) VALUES (?, ?, 'in', ?, ?, ?, ?, ?, ?, 'received')
      `).bind(
        crypto.randomUUID(),
        threadId,
        message.text,
        message.date,
        message.messageId,
        message.inReplyTo,
        JSON.stringify(message.references),
        externalId
      ).run();
      imported += result.meta?.changes || 0;
      if (result.meta?.changes) changedThreadIds.add(threadId);
    }
    const sentRecipientEmails = [...new Set((sent?.messages || []).flatMap(message => message.toAddresses || []))];
    const leadsByEmail = new Map();
    for (let offset = 0; offset < sentRecipientEmails.length; offset += 80) {
      const emails = sentRecipientEmails.slice(offset, offset + 80);
      const placeholders = emails.map(() => '?').join(', ');
      const leads = resultRows(await db.prepare(`SELECT id, email, name, store FROM leads WHERE email IN (${placeholders})`).bind(...emails).all());
      for (const lead of leads) leadsByEmail.set(lead.email.toLowerCase(), lead);
    }

    for (const message of sent?.messages || []) {
      const externalId = `${account.id}:${message.externalId}`;
      await reconcileUncertainCampaignDelivery(db, message);
      const existingSent=await db.prepare('SELECT id,thread_id FROM messages WHERE external_id = ?').bind(externalId).first();
      if(existingSent){await applySentState(db,existingSent.thread_id,message.date);changedThreadIds.add(existingSent.thread_id);continue;}
      const existingMessage=message.messageId ? await db.prepare(`
        SELECT m.id,m.thread_id FROM messages m JOIN threads t ON t.id = m.thread_id
        WHERE t.account_id = ? AND m.message_id = ? LIMIT 1
      `).bind(account.id, message.messageId).first():null;
      if(existingMessage){await applySentState(db,existingMessage.thread_id,message.date);changedThreadIds.add(existingMessage.thread_id);continue;}

      const references = [...new Set([message.inReplyTo, ...message.references].filter(Boolean))].slice(-20);
      let thread=message.providerThreadId?await db.prepare('SELECT id,name,store,email,subject FROM threads WHERE account_id=? AND provider_thread_id=? LIMIT 1').bind(account.id,message.providerThreadId).first():null;
      if (!thread && references.length) {
        const placeholders = references.map(() => '?').join(', ');
        thread = await db.prepare(`
          SELECT t.id, t.name, t.store, t.email, t.subject FROM threads t
          JOIN messages m ON m.thread_id = t.id
          WHERE t.account_id = ? AND m.message_id IN (${placeholders})
          ORDER BY m.time DESC LIMIT 1
        `).bind(account.id, ...references).first();
      }

      const recipientEmails = (message.toAddresses || []).filter(Boolean).slice(0, 80);
      let candidates = [];
      if (!thread && recipientEmails.length) {
        const placeholders = recipientEmails.map(() => '?').join(', ');
        candidates = resultRows(await db.prepare(`
          SELECT id, name, store, email, subject FROM threads
          WHERE account_id = ? AND email IN (${placeholders})
          ORDER BY id DESC LIMIT 100
        `).bind(account.id, ...recipientEmails).all());
        thread = candidates.find(candidate => normalizeSubject(candidate.subject) === normalizeSubject(message.subject));
      }

      let recipient = thread?.email ||
        recipientEmails.find(email => leadsByEmail.has(email)) ||
        recipientEmails.find(email => candidates.some(candidate => candidate.email.toLowerCase() === email));
      const lead = recipient ? leadsByEmail.get(recipient) : null;
      const candidate = recipient ? candidates.find(item => item.email.toLowerCase() === recipient) : null;
      if (!thread && !lead && !candidate) continue;

      const threadId = thread?.id || crypto.randomUUID();
      if (!thread) {
        await db.prepare(`
          INSERT INTO threads (id, name, store, email, subject, account_id, unread, status)
          VALUES (?, ?, ?, ?, ?, ?, 0, 'Contacted')
        `).bind(
          threadId,
          lead?.name || candidate?.name || recipient,
          lead?.store || candidate?.store || '',
          recipient,
          message.subject,
          account.id
        ).run();
      }
      const result = await db.prepare(`
        INSERT OR IGNORE INTO messages (
          id, thread_id, direction, body, time, message_id, in_reply_to,
          references_json, external_id, send_state
        ) VALUES (?, ?, 'out', ?, ?, ?, ?, ?, ?, 'sent')
      `).bind(
        crypto.randomUUID(),
        threadId,
        message.text,
        message.date,
        message.messageId,
        message.inReplyTo,
        JSON.stringify(message.references),
        externalId
      ).run();
      if (result.meta?.changes) {
        if(thread)await applySentState(db,threadId,message.date);
        imported += result.meta.changes;
        changedThreadIds.add(threadId);
      }
    }
    const checkpointStatements = [];
    if (incoming) {
      checkpointStatements.push(db.prepare(`
        UPDATE accounts SET last_sync_uid = ?, last_sync_uid_validity = ? WHERE id = ?
      `).bind(incoming.uid, incoming.uidValidity, account.id));
    }
    if(bounceInbox){checkpointStatements.push(db.prepare('UPDATE accounts SET last_bounce_sync_uid=?,last_bounce_sync_uid_validity=? WHERE id=?').bind(bounceInbox.uid,bounceInbox.uidValidity,account.id));}
    if (sent) {
      checkpointStatements.push(db.prepare(`
        UPDATE accounts SET last_sent_sync_uid = ?, last_sent_sync_uid_validity = ? WHERE id = ?
      `).bind(sent.uid, sent.uidValidity, account.id));
    }
    checkpointStatements.push(db.prepare(`
      UPDATE accounts SET last_sync_at = ? WHERE id = ?
    `).bind(new Date().toISOString(), account.id));
    await db.batch(checkpointStatements);
    const changedThreads=[];
    for(const id of changedThreadIds){
      const thread=await db.prepare('SELECT id,name,store,email,subject,account_id,unread,status,starred,archived,tag FROM threads WHERE id=?').bind(id).first();
      const latest=await db.prepare("SELECT direction,body,time,send_state FROM messages WHERE thread_id=? AND direction='in' AND time>=? ORDER BY time DESC LIMIT 1").bind(id,replyWindowStartIso()).first();
      if(thread && latest)changedThreads.push({...thread,accountId:thread.account_id,inboundDay:new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Lagos',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(latest.time)),messages:[{direction:latest.direction,body:latest.body,time:latest.time,sendState:latest.send_state}]});
    }
    return jsonResponse(200, {
      ok: true,
      email: account.email,
      imported,
      changedThreadIds: [...changedThreadIds].slice(0, 100),
      threads:changedThreads,
      checked: (incoming?.checked || 0) + (sent?.checked || 0) + (bounceInbox?.checked || 0),
      more: Boolean(incoming?.more || sent?.more || bounceInbox?.more),
      bounces,
      bounceError,
      inboxError,
      sentError
    });
    }finally{await db.prepare('UPDATE accounts SET sync_lease_token=NULL,sync_lease_until=NULL WHERE id=? AND sync_lease_token=?').bind(account.id,leaseToken).run().catch(()=>{});}
  }

  if(path==='/api/campaign/cancel'){
    if(typeof body.campaignId!=='string')throw new HttpError(400,'Choose a campaign.');
    try{return jsonResponse(200,{ok:true,...await cancelCampaign(db,body.campaignId)});}
    catch(error){if(/Campaign not found|cannot be cancelled|campaign changed/i.test(error.message))throw new HttpError(409,error.message);throw error;}
  }

  if(path==='/api/campaign/rebalance'){
    if(typeof body.campaignId!=='string')throw new HttpError(400,'Choose a paused campaign.');
    try{return jsonResponse(200,{ok:true,...await rebalanceCampaign(db,body.campaignId)});}
    catch(error){if(/Pause the campaign|No eligible|cannot be redistributed|no scouting plan|campaign changed|no queued/i.test(error.message))throw new HttpError(409,error.message);throw error;}
  }

  if (path === '/api/campaign/pause') {
    if (typeof body.campaignId !== 'string') throw new HttpError(400, 'Campaign not found.');
    const result = await db.prepare(`
      UPDATE campaigns SET status = 'User paused', next_send_at = NULL
      WHERE id = ? AND status IN ('Dry run', 'Sending', 'Scheduled', 'Paused')
    `).bind(body.campaignId).run();
    if (!result.meta?.changes) throw new HttpError(409, 'This campaign cannot be paused.');
    return jsonResponse(200, { ok: true, status: 'User paused' });
  }

  if (path === '/api/campaign/resume-pending') {
    const campaignId = typeof body.campaignId === 'string' ? body.campaignId : '';
    const campaign = campaignId
      ? await db.prepare('SELECT id, name, status FROM campaigns WHERE id = ?').bind(campaignId).first()
      : null;
    if (!campaign || campaign.name !== 'Direct send') throw new HttpError(404, 'Direct send run not found.');
    const counts = await db.prepare(`
      SELECT
        SUM(CASE WHEN status = 'queued' THEN 1 ELSE 0 END) AS queued,
        SUM(CASE WHEN status = 'uncertain' THEN 1 ELSE 0 END) AS uncertain
      FROM campaign_deliveries WHERE campaign_id = ?
    `).bind(campaignId).first();
    const queued = Number(counts?.queued || 0);
    if (!queued) throw new HttpError(409, 'There are no queued messages to resume.');
    const result = await db.prepare(`
      UPDATE campaigns SET status = 'Sending', next_send_at = ?
      WHERE id = ? AND status IN ('Needs review', 'User paused', 'Paused', 'Scheduled', 'Sending')
    `).bind(new Date().toISOString(), campaignId).run();
    if (!result.meta?.changes) throw new HttpError(409, 'This send cannot be resumed from its current status.');
    return jsonResponse(200, { ok: true, queued, uncertain: Number(counts?.uncertain || 0) });
  }

  if (path === '/api/campaign/uncertain') {
    const campaignId = typeof body.campaignId === 'string' ? body.campaignId : '';
    const rows = resultRows(await db.prepare(`
      SELECT d.id, d.started_at, d.attempt_count, d.last_error,
        l.email AS recipient, a.email AS sender
      FROM campaign_deliveries d
      JOIN campaigns c ON c.id = d.campaign_id
      JOIN leads l ON l.id = d.lead_id
      JOIN accounts a ON a.id = d.account_id
      WHERE d.campaign_id = ? AND c.name = 'Direct send' AND d.status = 'uncertain'
      ORDER BY d.started_at, d.id LIMIT 50
    `).bind(campaignId).all());
    return jsonResponse(200, { ok: true, deliveries: rows });
  }

  if(path==='/api/campaign/review'){
    if(typeof body.campaignId!=='string')throw new HttpError(400,'Choose a campaign.');
    try{return jsonResponse(200,{ok:true,...await reviewDeliveries(db,{campaignId:body.campaignId,deliveryId:body.deliveryId,action:body.action})});}
    catch(error){throw new HttpError(409,'The selected review action is not eligible. Unconfirmed deliveries need an explicit Sent-folder check.','REVIEW_NOT_ELIGIBLE');}
  }

  if (path === '/api/campaign/retry-uncertain') {
    const deliveryId = typeof body.deliveryId === 'string' ? body.deliveryId : '';
    const delivery = deliveryId
      ? await db.prepare(`
        SELECT d.id, d.campaign_id FROM campaign_deliveries d
        JOIN campaigns c ON c.id = d.campaign_id
        WHERE d.id = ? AND c.name = 'Direct send' AND d.status = 'uncertain'
      `).bind(deliveryId).first()
      : null;
    if (!delivery) throw new HttpError(404, 'Unconfirmed delivery not found or already resolved.');
    if(await db.prepare("SELECT 1 FROM campaigns WHERE id=? AND status='Cancelled'").bind(delivery.campaign_id).first())throw new HttpError(409,'A cancelled campaign cannot retry deliveries. Sync the Sent folder to resolve this unconfirmed attempt.');
    await db.batch([
      db.prepare(`
        UPDATE campaign_deliveries
        SET status = 'queued', retry_after = NULL, last_error = NULL
        WHERE id = ? AND status = 'uncertain'
      `).bind(deliveryId),
      db.prepare(`
        UPDATE campaigns SET status = 'Sending', next_send_at = ?
        WHERE id = ? AND status = 'Needs review'
      `).bind(new Date().toISOString(), delivery.campaign_id)
    ]);
    return jsonResponse(200, { ok: true, campaignId: delivery.campaign_id });
  }

  if (path === '/api/campaign/send') {
    const campaignId = String(body.campaignId || '');
    const campaign = await db.prepare(`
      SELECT id, status, created_at, template_id, pending_count, sent_count,
        uncertain_count, failed_count
      FROM campaigns WHERE id = ?
    `).bind(campaignId).first();
    if (!campaign) throw new HttpError(404, 'Campaign not found.');
    if (campaign.status === 'Complete') throw new HttpError(409, 'This campaign has already finished.');
    if (campaign.status === 'Needs review') {
      throw new HttpError(409, 'A previous message may have been sent without confirmation. Review the sender’s Sent folder before continuing.');
    }
    if (!['Dry run', 'Sending', 'Scheduled', 'Paused'].includes(campaign.status)) {
      throw new HttpError(409, 'This campaign is not ready to send.');
    }

    const now = new Date();
    const nowIso = now.toISOString();
    const cutoff = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
    const currentDay = Math.floor((now.getTime() - Date.parse(campaign.created_at)) / (24 * 60 * 60 * 1000)) + 1;
    const stale = await db.prepare(expireStaleDeliveriesSql)
      .bind(campaignId, new Date(now.getTime() - 2 * 60 * 1000).toISOString()).run();
    if (stale.meta?.changes) {
      await db.prepare("UPDATE campaigns SET status = 'Needs review' WHERE id = ?").bind(campaignId).run();
      return jsonResponse(200, {
        ok: true,
        needsReview: true,
        reason: 'A prior send did not finish recording. Check the sender’s Sent folder before continuing.'
      });
    }

    const candidate = await selectReadyDelivery(db,{campaignId,nowIso,candidateOffset:Number.isInteger(body.senderSlot) && body.senderSlot>=0 && body.senderSlot<SEND_CONCURRENCY ? body.senderSlot : 0});
    const delivery = candidate.id ? await db.prepare(`
      SELECT d.id, d.batch_no, d.day_no, d.attempt_count, l.id AS lead_id, l.email AS recipient,
        l.name AS lead_name, l.store AS lead_store,
        a.id AS account_id, a.email AS sender, a.cap AS account_cap,
        a.credential_ciphertext, t.subject, t.body
      FROM campaign_deliveries d
      JOIN leads l ON l.id = d.lead_id JOIN accounts a ON a.id = d.account_id
      JOIN campaigns c ON c.id = d.campaign_id
      JOIN templates t ON t.id = COALESCE(d.template_id, c.template_id)
      WHERE d.id = ? AND d.status = 'queued'
    `).bind(candidate.id).first() : null;

    if (!delivery) {
      const active = await db.prepare("SELECT 1 FROM campaign_deliveries WHERE campaign_id=? AND status='sending' LIMIT 1").bind(campaignId).first();
      if (active) return jsonResponse(200, {ok:true,busy:true});
      // The campaign counters are maintained by a trigger. Only inspect the
      // next queued delivery here; never aggregate every campaign delivery on
      // each scheduler tick.
      const nextQueued = candidate.nextQuotaAt ? {day_no:0,retry_after:candidate.nextQuotaAt} : await db.prepare(`
        SELECT day_no, retry_after
        FROM campaign_deliveries
        WHERE campaign_id = ? AND status = 'queued'
        ORDER BY day_no,
          CASE WHEN retry_after IS NULL THEN 0 ELSE 1 END,
          retry_after,
          batch_no
        LIMIT 1
      `).bind(campaignId).first();
      const queued = Number(campaign.pending_count || 0);
      const sending = 0;
      const uncertain = Number(campaign.uncertain_count || 0);
      if (!queued && !sending) {
        const status = uncertain ? 'Needs review' : 'Complete';
        await db.prepare("UPDATE campaigns SET status = ? WHERE id = ? AND status IN ('Sending','Scheduled','Dry run','Paused')").bind(status, campaignId).run();
        return jsonResponse(200, {
          ok: true,
          done: !uncertain,
          needsReview: Boolean(uncertain),
          sent: Number(campaign.sent_count || 0),
          failed: Number(campaign.failed_count || 0),
          pending: 0,
          status
        });
      }

      const nextDay = Number(nextQueued?.day_no || 0);
      const scheduledAt = nextDay > currentDay
        ? new Date(Date.parse(campaign.created_at) + (nextDay - 1) * 24 * 60 * 60 * 1000).toISOString()
        : null;
      const retryAt = nextQueued?.retry_after && Date.parse(nextQueued.retry_after) > now.getTime()
        ? nextQueued.retry_after
        : null;
      const nextSendAt = scheduledAt || retryAt || candidate.nextQuotaAt;
      const status = nextSendAt ? 'Scheduled' : 'Paused';
      await db.prepare("UPDATE campaigns SET status = ?, next_send_at = ? WHERE id = ? AND status IN ('Sending','Scheduled','Dry run','Paused')")
        .bind(status, nextSendAt, campaignId).run();
      return jsonResponse(200, {
        ok: true,
        paused: true,
        status,
        pending: queued + sending,
        sent: Number(campaign.sent_count || 0),
        nextSendAt,
        reason: scheduledAt
          ? 'The next 24-hour sending window has not started yet.'
          : retryAt
            ? 'A temporary sender limit was reached. The background sender will retry after the displayed time.'
          : candidate.nextQuotaAt ? 'Sender quotas are full. Sending will resume automatically when rolling capacity returns.'
          : 'No assigned sender has capacity right now. Resume after a sender’s rolling 24-hour limit resets.'
      });
    }

    let password;
    try {
      password = await decryptCredential(delivery.sender, delivery.credential_ciphertext, env.CREDENTIALS_ENCRYPTION_KEY);
    } catch {
      throw new HttpError(409, 'Sender credentials could not be decrypted. Reconnect this account before sending.');
    }

    const claim = await db.prepare(claimReadyDeliverySql)
      .bind(nowIso, delivery.id, nowIso).run();
    if (!claim.meta?.changes) {
      return jsonResponse(200, { ok: true, busy: true, reason: 'Delivery claim changed; select another available sender.' });
    }

    const text = personalize(delivery.body, {
      name: delivery.lead_name,
      store: delivery.lead_store,
      email: delivery.recipient
    });
    const subject = personalize(delivery.subject, {
      name: delivery.lead_name,
      store: delivery.lead_store,
      email: delivery.recipient
    }).trim();
    const messageId = `<${delivery.id}@relay-mail-dashboard.pages.dev>`;
    try {
      await sendCampaignMessage({
        email: delivery.sender,
        password,
        to: delivery.recipient,
        subject,
        text,
        messageId
      });
    } catch (error) {
      const health=sendFailureHealth(error);
      if(health){await saveAccountHealth(db,delivery.account_id,health);if(health.pause)await db.prepare('UPDATE accounts SET paused=1 WHERE id=?').bind(delivery.account_id).run();}
      const responseCode = Number(error.responseCode || 0);
      const attemptNumber = Number(delivery.attempt_count || 0) + 1;
      const diagnostic = Number.isInteger(responseCode) && responseCode > 0
        ? `SMTP_${responseCode}`
        : /^[A-Z0-9_]{1,32}$/i.test(String(error.code || '')) ? String(error.code).toUpperCase() : 'SMTP_UNCONFIRMED';
      const responseText = String(error.response || '');
      const quotaRejected = responseCode >= 500 && responseCode < 600 &&
        /\b(?:quota|rate.?limit|too many|sending limit)\b/i.test(responseText);
      const transientRejection = (responseCode >= 400 && responseCode < 500) || quotaRejected;
      if (transientRejection && (quotaRejected || attemptNumber <= 3)) {
        const delayMinutes = smtpRetryMinutes(error,attemptNumber);
        const retryAt = new Date(Date.now() + delayMinutes * 60 * 1000).toISOString();
        await db.batch([
          db.prepare(`
            UPDATE campaign_deliveries
            SET status = CASE WHEN EXISTS(SELECT 1 FROM campaigns c WHERE c.id=campaign_deliveries.campaign_id AND c.status='Cancelled') THEN 'failed' ELSE 'queued' END, retry_after = ?, last_error = ?
            WHERE id = ? AND status = 'sending'
          `).bind(retryAt, diagnostic, delivery.id),
          db.prepare("UPDATE accounts SET send_retry_after=MAX(COALESCE(send_retry_after,''),?) WHERE id=?").bind(retryAt,delivery.account_id),
          db.prepare(`
            UPDATE campaigns SET
              status = CASE WHEN EXISTS(SELECT 1 FROM sender_ready r WHERE r.campaign_id=campaigns.id
                AND r.enabled=1 AND r.next_delivery_id IS NOT NULL AND r.ready_at<=?) THEN 'Sending' ELSE 'Scheduled' END,
              next_send_at=(SELECT MIN(ready_at) FROM sender_ready r WHERE r.campaign_id=campaigns.id
                AND r.enabled=1 AND r.next_delivery_id IS NOT NULL)
            WHERE id=? AND status IN ('Sending','Scheduled','Dry run','Paused')
          `).bind(nowIso,campaignId)
        ]);
        return jsonResponse(200, {
          ok: true,
          deferred: true,
          retryAt,
          reason: 'Gmail temporarily limited this send. It will be retried automatically.'
        });
      }
      if (responseCode >= 400 && responseCode < 600) {
        await db.batch([
          db.prepare(`
            UPDATE campaign_deliveries
            SET status = 'failed', retry_after = NULL, last_error = ?
            WHERE id = ? AND status = 'sending'
          `).bind(diagnostic, delivery.id),
          db.prepare(finishAttemptSql).bind(nowIso, campaignId)
        ]);
        return jsonResponse(200, {
          ok: true,
          failed: true,
          reason: responseCode >= 500
            ? 'Gmail rejected this message permanently; the run will continue with the next queued message.'
            : 'Gmail kept temporarily rejecting this message after the retry limit; the run will continue with the next queued message.'
        });
      }
      await db.batch([
        db.prepare("UPDATE campaign_deliveries SET status = 'uncertain', last_error = ? WHERE id = ?").bind(diagnostic, delivery.id),
        db.prepare("UPDATE campaigns SET status = 'Needs review' WHERE id = ?").bind(campaignId)
      ]);
      throw new HttpError(502, 'Gmail did not confirm delivery. Check the sender’s Sent folder before retrying.');
    }

    const sentAt = new Date().toISOString();
    await db.batch([
      db.prepare(`
        INSERT INTO threads (id, name, store, email, subject, account_id, unread, status)
        VALUES (?, ?, ?, ?, ?, ?, 0, 'Contacted')
      `).bind(delivery.id, delivery.lead_name || delivery.recipient, delivery.lead_store, delivery.recipient, subject || 'No subject', delivery.account_id),
      db.prepare(`
        INSERT INTO messages (
          id, thread_id, direction, body, time, message_id, send_state, idempotency_key
        ) VALUES (?, ?, 'out', ?, ?, ?, 'sent', ?)
      `).bind(crypto.randomUUID(), delivery.id, text, sentAt, messageId, `campaign:${delivery.id}`),
      db.prepare("UPDATE campaign_deliveries SET status = 'sent', sent_at = ? WHERE id = ? AND status = 'sending'")
        .bind(sentAt, delivery.id),
      db.prepare(finishAttemptSql)
        .bind(sentAt, campaignId)
    ]);
    return jsonResponse(200, { ok: true, sent: true, sender: delivery.sender });
  }

  if (path === '/api/reply') {
    if (typeof body.id !== 'string') throw new HttpError(400, 'Conversation not found.');
    const requestId = String(body.requestId || '');
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId)) {
      throw new HttpError(400, 'Invalid reply request.');
    }
    const text = typeof body.text === 'string' ? body.text.trim() : '';
    if (!text || text.length > 50_000) throw new HttpError(400, 'Write a reply of no more than 50,000 characters.');
    const thread = await db.prepare(`
      SELECT t.id, t.email AS recipient, t.subject, t.account_id,
        a.email AS sender, a.credential_ciphertext, a.smtp_verified_at
      FROM threads t JOIN accounts a ON a.id = t.account_id
      WHERE t.id = ?
    `).bind(body.id).first();
    if (!thread) throw new HttpError(404, 'Conversation not found.');
    if (!thread.smtp_verified_at || !thread.credential_ciphertext) {
      throw new HttpError(409, 'This sender has not passed SMTP verification. Reconnect it in Accounts before replying.');
    }
    let password;
    try {
      password = await decryptCredential(thread.sender, thread.credential_ciphertext, env.CREDENTIALS_ENCRYPTION_KEY);
    } catch {
      throw new HttpError(409, 'Sender credentials could not be decrypted. Reconnect this account before replying.');
    }

    const priorRequest = await db.prepare(`
      SELECT id, thread_id, send_state, body, message_id, in_reply_to, references_json, time
      FROM messages WHERE idempotency_key = ?
    `).bind(requestId).first();
    if (priorRequest) {
      if (priorRequest.thread_id !== thread.id) throw new HttpError(409, 'This reply request belongs to a different conversation.');
      if (priorRequest.send_state === 'sent') return jsonResponse(200, { ok: true, account: thread.sender });
      const staleSending = priorRequest.send_state === 'sending' &&
        Date.now() - Date.parse(priorRequest.time) >= 2 * 60 * 1000;
      if (body.retryUncertain !== true || (priorRequest.send_state !== 'uncertain' && !staleSending)) {
        const code = priorRequest.send_state === 'sending' ? 'REPLY_STILL_SENDING' : 'REPLY_UNCERTAIN';
        const message = priorRequest.send_state === 'sending'
          ? 'A reply is still marked as sending. Wait a few minutes, then review the conversation before retrying.'
          : 'A reply with this request ID may already have been sent. Check the sender’s Sent folder before retrying.';
        throw new HttpError(409, message, code);
      }
      if (priorRequest.body !== text) {
        throw new HttpError(409, 'The saved reply text differs from this retry. Start a new reply instead.', 'REPLY_TEXT_MISMATCH');
      }
      const retryClaim = await db.prepare(`
        UPDATE messages SET send_state = 'sending', time = ?
        WHERE id = ? AND (
          send_state = 'uncertain' OR (send_state = 'sending' AND time < ?)
        )
      `).bind(new Date().toISOString(), priorRequest.id, new Date(Date.now() - 2 * 60 * 1000).toISOString()).run();
      if (!retryClaim.meta?.changes) {
        throw new HttpError(409, 'A reply is still marked as sending. Wait a few minutes, then review the conversation before retrying.', 'REPLY_STILL_SENDING');
      }
    }

    let latestMessageId = priorRequest?.in_reply_to || '';
    let references = [];
    if (priorRequest) {
      try {
        references = JSON.parse(priorRequest.references_json || '[]');
      } catch {
        references = [];
      }
    } else {
      const priorMessages = resultRows(await db.prepare(`
        SELECT message_id, references_json FROM messages
        WHERE thread_id = ? ORDER BY time, id
      `).bind(thread.id).all());
      latestMessageId = [...priorMessages].reverse().find(message => message.message_id)?.message_id || '';
      references = [...new Set(priorMessages.flatMap(message => {
        let saved = [];
        try {
          saved = JSON.parse(message.references_json || '[]');
        } catch {
          saved = [];
        }
        return [...saved, message.message_id].filter(Boolean);
      }))].slice(-20);
    }
    const messageId = priorRequest?.message_id || `<${requestId}@relay-mail-dashboard.pages.dev>`;
    const replySubject = thread.subject === 'No subject'
      ? 'Re: No subject'
      : /^re\s*:/i.test(thread.subject) ? thread.subject : `Re: ${thread.subject}`;
    const messageRecordId = priorRequest?.id || crypto.randomUUID();
    if (!priorRequest) {
      await db.prepare(`
        INSERT INTO messages (
          id, thread_id, direction, body, time, message_id, in_reply_to,
          references_json, send_state, idempotency_key
        ) VALUES (?, ?, 'out', ?, ?, ?, ?, ?, 'sending', ?)
      `).bind(
        messageRecordId,
        thread.id,
        text,
        new Date().toISOString(),
        messageId,
        latestMessageId,
        JSON.stringify(references),
        requestId
      ).run();
    }

    try {
      await sendThreadReply({
        email: thread.sender,
        password,
        to: thread.recipient,
        subject: replySubject,
        text,
        inReplyTo: latestMessageId,
        references,
        messageId
      });
    } catch {
      await db.prepare("UPDATE messages SET send_state = 'uncertain' WHERE id = ?").bind(messageRecordId).run();
      throw new HttpError(502, 'Gmail did not confirm the reply. Check the sender’s Sent folder before retrying.');
    }
    await db.batch([
      db.prepare("UPDATE messages SET send_state = 'sent' WHERE id = ?").bind(messageRecordId),
      db.prepare("UPDATE threads SET status = 'Replied', unread = 0 WHERE id = ?").bind(thread.id)
    ]);
    return jsonResponse(200, { ok: true, account: thread.sender });
  }

  throw new HttpError(404, 'Not found.');
}

async function handleRequest({ request, env }) {
  const url = new URL(request.url);
  const path = url.pathname;
  try {
    if (request.method === 'GET' && path === '/api/state') return jsonResponse(200, await loadState(env.DB, {
      leadScope: url.searchParams.get('leadScope'),
      leadCursor: url.searchParams.get('leadCursor'),
      leadOffset: url.searchParams.get('leadOffset')
    }));
    if (request.method === 'GET' && path === '/api/thread') {
      const id = url.searchParams.get('id');
      if (!id) throw new HttpError(400, 'Choose a conversation.');
      const thread = await loadThread(env.DB, id);
      if (!thread) throw new HttpError(404, 'Conversation not found.');
      return jsonResponse(200, { thread });
    }
    if(request.method==='GET' && path==='/api/notifications'){
      const before=url.searchParams.get('before');
      const cursor=before?await env.DB.prepare('SELECT created_at,id FROM account_health_events WHERE id=?').bind(before).first():null;
      const sql=`SELECT e.id,e.account_id AS accountId,a.email AS accountEmail,e.status,e.code,e.message,e.created_at AS createdAt,e.resolved_at AS resolvedAt,e.read_at AS readAt FROM account_health_events e JOIN accounts a ON a.id=e.account_id WHERE e.deleted_at IS NULL ${cursor?'AND (e.created_at,e.id)<(?,?)':''} ORDER BY e.created_at DESC,e.id DESC LIMIT 51`;
      const rows=resultRows(await (cursor?env.DB.prepare(sql).bind(cursor.created_at,cursor.id):env.DB.prepare(sql)).all());
      return jsonResponse(200,{events:rows.slice(0,50),nextCursor:rows.length>50?rows[49].id:null});
    }
    if (request.method === 'GET' && path === '/api/sending/status') {
      const runs = await loadSendingStatus(env.DB, url.searchParams.get('summary') === '1');
      let deliveries = [];
      if (runs[0] && url.searchParams.get('summary') !== '1') {
        // Bounded activity queries use the campaign/status index. Include review
        // records independently so they cannot disappear behind recent successes.
        const db = env.DB;
        const groups = await Promise.all(['uncertain', 'failed', 'sent', 'queued'].map(status => db.prepare(`
          SELECT d.id, d.status, d.started_at, d.sent_at, d.created_at, d.last_error,
            l.email AS recipient, l.name, a.email AS sender, t.subject, t.name AS plan_name
          FROM campaign_deliveries d JOIN leads l ON l.id = d.lead_id
          JOIN accounts a ON a.id = d.account_id LEFT JOIN templates t ON t.id = d.template_id
          WHERE d.campaign_id = ? AND d.status = ? AND (d.status='uncertain' OR d.review_dismissed_at IS NULL) AND NOT EXISTS(SELECT 1 FROM delivery_bounces b WHERE b.delivery_id=d.id) ORDER BY d.created_at DESC, d.id DESC LIMIT 50
        `).bind(runs[0].id, status).all()));
        const bounced=await db.prepare(`SELECT d.id,'failed' AS status,d.started_at,b.received_at AS sent_at,d.created_at,b.code AS last_error,
          l.email AS recipient,l.name,a.email AS sender,t.subject,t.name AS plan_name
          FROM (SELECT delivery_id,code,received_at FROM delivery_bounces WHERE campaign_id=? ORDER BY received_at DESC,delivery_id DESC LIMIT 50) b
          JOIN campaign_deliveries d ON d.id=b.delivery_id AND d.review_dismissed_at IS NULL JOIN leads l ON l.id=d.lead_id JOIN accounts a ON a.id=d.account_id LEFT JOIN templates t ON t.id=d.template_id`).bind(runs[0].id).all();
        const seen=new Map();
        deliveries=[...groups.flatMap(resultRows),...resultRows(bounced)].sort((a,b)=>String(b.sent_at || b.started_at || b.created_at).localeCompare(String(a.sent_at || a.started_at || a.created_at))).filter(d=>{const count=(seen.get(d.status)||0)+1;seen.set(d.status,count);return count<=50;});
      }
      const accountAlerts=url.searchParams.get('summary')==='1'?undefined:resultRows(await env.DB.prepare(`SELECT e.id,e.account_id AS accountId,a.email AS accountEmail,e.status,e.message FROM account_health_events e JOIN accounts a ON a.id=e.account_id WHERE e.resolved_at IS NULL ORDER BY e.created_at DESC LIMIT 10`).all());
      return jsonResponse(200, { runs, deliveries, ...(accountAlerts?{accountAlerts}:{}) });
    }
    if (request.method !== 'POST') return jsonResponse(405, { error: 'Method not allowed.' });
    return await handlePost(request, env, path);
  } catch (error) {
    if(error instanceof PreparationError)return jsonResponse(503,{error:error.message,code:error.code});
    if (error instanceof HttpError) return jsonResponse(error.status, {
      error: error.message,
      ...(error.code ? { code: error.code } : {})
    });
    console.error('Pages API request failed:', error);
    if (/daily row read limit/i.test(String(error?.message || ''))) {
      return jsonResponse(503, {
        error: 'Cloudflare D1 has reached its daily row-read limit. Dashboard data and sync will recover after the quota resets or the plan is upgraded.',
        code: 'D1_READ_LIMIT'
      });
    }
    return jsonResponse(500, { error: 'The request could not be completed.' });
  }
}


export async function onRequest(context) {
 const {request,env}=context,url=new URL(request.url);
 // Old browser timers must not cause even a usage-table lookup.
 if(request.method==='POST' && ['/api/mail/sync','/api/mail/conversation'].includes(url.pathname)){
   const body=await request.clone().json().catch(()=>({}));
   if(body.manual!==true)return jsonResponse(400,{error:'Automatic mailbox checks are disabled. Refresh the dashboard and click Sync connected inboxes.'});
 }
 const day=new Date().toISOString().slice(0,10);
 const resetAt=new Date(Date.parse(day+'T00:00:00Z')+86400000).toISOString();
 let initial;
 try{initial=await env.DB.prepare('SELECT rows_read,rows_written FROM app_usage_days WHERE day=?').bind(day).first() || {rows_read:0,rows_written:0};}
 catch(error){
   if(/daily row read limit/i.test(String(error?.message||'')))return jsonResponse(503,{error:'Cloudflare D1 daily read quota is exhausted. It resets at 1:00 AM Africa/Lagos.',code:'D1_READ_LIMIT',resetAt});
   return jsonResponse(503,{error:'Database usage accounting is unavailable. Sending is held.',code:'APP_USAGE_UNAVAILABLE'});
 }
 const budgets=usageBudgets(env);
 if((initial.rows_read>=budgets.reads || initial.rows_written>=budgets.writes) && !allowBudgetRead(env,request.method,url.pathname)){
   if(url.pathname==='/api/internal/send-tick'){
     await env.DB.prepare(`UPDATE campaigns SET status='Scheduled',next_send_at=? WHERE name='Direct send'
       AND status IN ('Sending','Scheduled','Paused') AND (next_send_at IS NULL OR next_send_at<?)`)
       .bind(resetAt,resetAt).run().catch(()=>{});
   }
   return jsonResponse(503,{error:'The application usage safety budget is reached. Sending is held until the next daily reset.',code:'APP_USAGE_BUDGET',resetAt});
 }
 const meter=meteredD1(env.DB,initial,budgets);
 // Send headers immediately so the scheduler's 50 logical requests are not
 // serialized by the runtime's six waiting-for-headers connection slots.
 // The JSON body remains pending until SMTP and database confirmation finish.
 if(request.method==='POST' && url.pathname==='/api/internal/send-tick'){
   const encoder=new TextEncoder();
   return new Response(new ReadableStream({async start(controller){
     controller.enqueue(encoder.encode(' '));
     try{
       const result=await handleRequest({...context,env:{...env,DB:meter.db}});
       const data=await result.json();
       await meter.flush(day).catch(()=>{});
       controller.enqueue(encoder.encode(JSON.stringify({...data,httpStatus:result.status})));
       controller.close();
     }catch(error){controller.error(error);}
   }}),{headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}});
 }
 const response=await handleRequest({...context,env:{...env,DB:meter.db}});
 const finish=()=>meter.flush(day).catch(()=>{});
 if(response.headers.get('Content-Type')?.includes('application/x-ndjson') && response.body){
   const reader=response.body.getReader();
   return new Response(new ReadableStream({async start(controller){try{for(;;){const r=await reader.read();if(r.done)break;controller.enqueue(r.value);}await finish();controller.close();}catch(error){await finish();controller.error(error);}finally{reader.releaseLock();}}}),{status:response.status,headers:response.headers});
 }
 await finish();return response;
}
