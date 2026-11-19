# Cloudflare efficiency and safe sending

## Current release state

The cached ready-sender queue, quota reservations, 150-account concurrency,
early-header sender transport, live progress, manual bounce reconciliation and
account alerts are deployed. Migrations 0026–0031 are applied. Workers Paid was
activated on November 19, 2026 and the once-per-minute scheduler is registered.
The campaign's user pause or review state is preserved. GitHub publishing does
not automatically deploy this project (Cloudflare Git Provider is disabled).

## Why reads were high

D1 measures rows examined, not just SQL request count. Earlier selection queries
repeated sender quota/history work for thousands of queued deliveries. Another
stale-send recovery UPDATE examined all 8,880 campaign rows on every request.
Indexes and bounded lookups reduced a profiled successful send from about 50,000
rows read to about 550. This was a measured improvement, not a claim of 10 rows.
Already-consumed daily quota cannot be reclaimed by an optimization.

## Cached sender state

`src/ready-senders.mjs` uses an indexed `sender_ready` entry instead of scanning
all 74 accounts per email. `sender_budget` stores used quota, effective cap and
the earliest possible rolling expiry. Database triggers reserve a slot atomically
and advance the sender's queue cursor. Concurrent requests cannot reuse a delivery
or send two messages from the same account. Campaign in-flight count is maintained
atomically and limited to 150.

Normal sending does not recount sender history. History is reconciled through a
bounded indexed query when the cached expiry arrives. This preserves a rolling
24-hour cap rather than resetting a counter after every 40 sends. Permanent
rejections release a reservation; uncertain delivery holds it and stops new claims
until reviewed. Account pause/cap edits immediately update readiness.

Migrations 0023–0025 support bounded selection, one in-flight delivery per account
and indexed stale-send recovery. Migration 0026 adds and backfills cached state
without resetting existing usage or resending completed deliveries.

## Application usage guard

Migration 0027 stores daily API row-read and row-write accounting from D1 metadata.
By default, the application stops starting work at 4,000,000 reads or 80,000 writes, below the
Free allowance of 5,000,000 reads and 100,000 writes per UTC day. The headroom is
for in-flight requests, accounting and external operations. An already-started
send is always allowed to record confirmation.

This guard tracks this API's operations; it does not include Wrangler commands,
Cloudflare dashboard queries or unrelated services. It is a conservative safety
control, not a guarantee about the account's total bill or daily quota. Large
imports are checked against the remaining write budget before insertion. Measure
both reads and writes on production after reset before claiming a per-send cost.
Cached state trades some writes for fewer reads.

## UI consumption

Mailbox checks are manual-only. Requests without the explicit manual flag are
rejected before database access. Sending counters poll only on the Sending screen
while a run is active; other screens do not continuously fetch activity. Counter
polls use summary-only responses, activity refreshes at most every 30 seconds,
and scheduled runs poll more slowly. Polling stops on quota/budget errors. Local
thread day-boundary filtering does not query Gmail or D1.

## Validation and release

Run:

```powershell
npm ci
npm --prefix design/mail-dash-builder ci
npm test
node design/mail-dash-builder/node_modules/typescript/bin/tsc --noEmit -p design/mail-dash-builder/tsconfig.json
npm run pages:build
npm run frontend:build
```

Tests cover an 8,880-delivery fixture, queue indexes, slot reservations, exact
rolling expiry, quota backfill, cap/pause edits, uncertain delivery, 150 concurrent
senders, summary-only polling and the application usage guard. Local browser
checks must not contact real mail providers or send test messages.

For a new deployment, keep cron disabled until required migrations are applied:

```powershell
node node_modules/wrangler/bin/wrangler.js d1 migrations apply relay-mail-dashboard --remote --config wrangler.production.jsonc
npm run pages:deploy
```

The deployment script fails closed until migrations 0026 through 0028 are present.
It uses the ignored production binding temporarily and restores the placeholder
Wrangler configuration in a finally block. Verify cached counts/readiness and a
small sample of real D1 metadata, then restore the authorized existing campaign:

```powershell
node node_modules/wrangler/bin/wrangler.js triggers deploy --config wrangler.scheduler.production.jsonc
```

Keep production credentials and bindings in ignored configuration/secrets. No
credential files, secret values or production database exports belong in Git.


Paid-plan deployment: set the non-secret Pages variable APP_USAGE_TIER=paid after upgrading. Application daily guards become 500 million reads and 1 million writes; defaults retain Free guards. These cover this API only and are not a Cloudflare billing cap. Migrations 0026 and 0027 were applied after the November 19 upgrade.

Sending now supports 150 concurrent distinct accounts, with a 2,250-result scheduler batch and at most 4,500 attempts including contention. Per-account exclusion, rolling 40-send caps, manual-only reply checks, and stop-on-uncertain behavior remain enforced. Batch throughput depends on available quota and provider latency.

Visible Sending-page counters refresh every 2 seconds during Sending (15 seconds while Scheduled). Poll requests do not overlap and pause when hidden; activity remains throttled to 30 seconds. Summaries read stored campaign counters, including in-flight accounts and the next scheduled time; they do not scan delivery history or check inboxes.

Internal send-tick replies stream headers immediately and deliver their JSON confirmation only after SMTP/database work finishes, avoiding the six waiting-for-headers slots. Clients must check httpStatus in the body as well as HTTP status. A definite temporary SMTP rejection defers that sender only; its ready queue is held until retry time while other senders continue. Unknown confirmations still stop sending and require review.

Migration 0028 adds idempotent post-acceptance bounce records and incremental failure counters while preserving SMTP-accepted quota. Manual sync pages through at most 25 daemon/postmaster reports per account (last 30 days), using a separate UID checkpoint. It never automatically scans mail. Dashboard alerts use a bounded unresolved-event index; two-second counter polls do not load alerts, accounts, or delivery history. Confirmed authentication/restriction errors pause the sender; temporary sending limits remain warnings and use persistent per-account retry readiness.


## Account scaling, sync and conversations

Sending is capped at 150 distinct in-flight accounts per campaign. An indexed
lane selects ready senders directly rather than walking an increasing OFFSET.
A scheduler batch targets at most 2,250 confirmed results/deferrals with 4,500
bounded attempts; this is a ceiling, not guaranteed SMTP throughput. Per-account
40-send rolling caps, provider backoff and uncertain-send holds still apply.

Manual mailbox sync uses a rolling pool of at most 100 accounts and one IMAP
login per account. Unchanged UID checkpoints skip message downloads. Inbox and
bounce checks share the session and cached messages; Sent-folder scans are
optional except for known uncertain sends. Dropped read sessions reconnect once;
authentication failures do not loop. Retry in the UI targets failed accounts.
Per-account leases avoid overlapping syncs from different tabs. Raw message
fetches are capped at 256 KB and conversation FETCH batches at 25 messages to
stay below the connection's response limits; displayed text remains capped at
12 KB per message, matching the prior dashboard's text limit.

A user browser reload refreshes data and triggers exactly one pooled email sync.
The page route and mobile conversation URL survive reload. There is no recurring
mailbox timer. Opening/refreshing a conversation explicitly loads its Gmail
thread from All Mail, including older incoming mail and sent/mobile messages.
Message IDs deduplicate across Inbox, Sent and All Mail. UID checkpoints skip
already imported context; older history is available in 100-message pages.
Mobile uses separate inbox and reader screens with Back navigation and retained
in-memory reply drafts. Desktop retains the split view.

## Campaign and notification controls

Use newly connected accounts redistributes only queued work for a paused campaign
in an atomic batch and rebuilds cached lanes, preserving accepted history,
recipient totals, sender/lead uniqueness, quotas and the pause. Existing campaigns
do not automatically assign their old queued work to newly imported accounts.
Cancel campaign stops new claims, removes queued work, and retains accepted,
failed and uncertain history; any already-in-flight attempt can still finish
recording its outcome. Cancellation is idempotent and cannot resume.

The allocation policy remains repeated campaigns: 500 fresh accounts at cap 40
with 3,000 leads plan 20,000 sends, reusing recipients across different accounts.
This is the explicitly retained policy, not a six-per-account one-send policy.

Notifications have indexed history pagination, unread/read indicators, individual
deletion and bulk deletion of read notifications. Deletion hides feed entries
without changing account health or removing the underlying event audit.
