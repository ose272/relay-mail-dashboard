# Cloudflare efficiency and safe sending

## Current release state

The source changes in this repository include a cached ready-sender queue and
quota reservations. These latest changes are **not yet deployed to production**.
D1 rejected database operations with Free-tier error 7500 on November 19, 2026.
The scheduler cron is disabled. The user chose to wait for the daily quota reset
at 01:00 Africa/Lagos on November 20 before applying migrations and resuming.
GitHub publishing does not deploy this project automatically (Cloudflare Git
Provider is disabled). Do not enable the scheduler before migrations and API
verification succeed.

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
atomically and limited to 10.

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
The application stops starting work at 4,000,000 reads or 80,000 writes, below the
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
rolling expiry, quota backfill, cap/pause edits, uncertain delivery, 10 concurrent
senders, summary-only polling and the application usage guard. Local browser
checks must not contact real mail providers or send test messages.

After the quota reset, keep cron disabled and apply the migrations:

```powershell
node node_modules/wrangler/bin/wrangler.js d1 migrations apply relay-mail-dashboard --remote --config wrangler.production.jsonc
npm run pages:deploy
```

The deployment script fails closed until migrations 0026 and 0027 are present.
It uses the ignored production binding temporarily and restores the placeholder
Wrangler configuration in a finally block. Verify cached counts/readiness and a
small sample of real D1 metadata, then restore the authorized existing campaign:

```powershell
node node_modules/wrangler/bin/wrangler.js triggers deploy --config wrangler.scheduler.production.jsonc
```

Keep production credentials and bindings in ignored configuration/secrets. No
credential files, secret values or production database exports belong in Git.


Paid-plan deployment: set the non-secret Pages variable APP_USAGE_TIER=paid after upgrading. Application daily guards become 500 million reads and 1 million writes; defaults retain Free guards. These cover this API only and are not a Cloudflare billing cap. Migrations 0026 and 0027 were applied after the November 19 upgrade.
