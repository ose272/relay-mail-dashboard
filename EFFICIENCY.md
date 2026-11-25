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

## Paid usage hold correction — 21 November 2026

Production APP_USAGE_TIER was confirmed paid. The hold was the application write guard, not Cloudflare Free quota: app accounting recorded 238,313,393 reads and 1,000,852 writes today against 500m/1m daily guards. Raise paid daily writes to 1.5m (46.5m over 31 days, below the 50m paid monthly inclusion); retain the 500m daily read guard and Free limits. Paid read-only state/status/thread/notification APIs remain available during a sending hold; sending/sync/initiation remain blocked at the guard. No usage counters, credentials, campaign history, quota or scheduled times are reset.

Cloudflare account analytics for November 1–21 returned 673,693,036 rows read and 1,738,468 rows written: 2.6948% of 25b reads and 3.4769% of 50m writes. This is calendar-month-to-date D1 usage, not a percentage for all Cloudflare products or proof of billing-cycle consumption. Workers requests/CPU and subscription renewal timing must be assessed separately. D1 storage measured 45,842,432 bytes, approximately 0.917% of the 5 GB included storage. Official pricing: https://developers.cloudflare.com/d1/platform/pricing/ .

Production query insights showed eligibility LEFT JOIN blocker sets averaging 33,256,535 scanned rows, three runs totaling 99,769,605. Replace them with NOT IN membership lists, filtering NULL keys and preserving sent/sending/uncertain delivery and outbound reply suppression. Read-only production count probe of the replacement used 36,555 reads, zero writes (99.89% fewer than the historical average). No campaign or SMTP operation was used for the measurement. A regression disables SQLite automatic indexes to represent the problematic join-planning conditions.

For capacity planning, measure sending, mailbox sync, preparation, dashboard and tracking separately. Today's writes include preparation/index/trigger costs, so dividing aggregate writes by sent messages does not establish steady-state send cost. Mail provider limits and shared-database throughput remain independent constraints. A 1,000-user deployment is not established by these usage percentages alone.

## Measured read-efficiency pass — 23 November 2026

Production analytics for the preceding 24 hours identified four batch-deletion preflight queries consuming 547,758,556 reads (136,939,639 average). Migration 0035 already supplies the missing lead-history seek index. Additional current costs were lead pagination, reply idempotency lookup, and dispatch attempts with no ready sender.

Migration 0036 adds (status,created_at,email,id) lead pagination and a partial non-null message-idempotency index. Identical production read-only probes immediately before/after migration:

| Probe | Before reads | After reads | Read reduction | SQL latency before/after |
|---|---:|---:|---:|---:|
| First 100 Ready leads ordered by created_at/email/id | 5,688 | 100 | 98.24% | 3.296 / 0.1977 ms |
| Missing reply idempotency key | 21,637 | 0 | 100% | 184.7191 / 0.1762 ms |

No contact content was returned by those probes. Pagination returned 100 rows in both cases; idempotency returned zero matches in both cases. Indexes add storage and writes when their indexed data changes; these are not write savings claims.

Preparation preflight now requires at least one enabled due cached sender before permitting 150 dispatch workers. It still opens the gate for stale in-flight sends so uncertainty recovery is not stranded, and automatically opens when rolling quota capacity returns. No counters, credentials, account restrictions, cooldowns or uncertainty records are cleared. A regression verifies blocked, quota-ready, and stale-recovery states.

Validation: 89 tests passed; Pages Functions build passed. These results establish over 90% read reduction for measured hot queries, not a 90% reduction in all Cloudflare usage. Accepted-delivery, quota, indexing and accounting writes remain necessary; an overall write or bill reduction needs a matched-volume production interval, including Workers request/CPU analytics. Historical query totals and a day with different send/import volume cannot establish that percentage.

Provider retry follow-up: live diagnostics found 1,404 queued records with SMTP_550 and 65 SMTP_LIMIT accounts. Explicit daily-limit responses now receive a 24-hour account cooldown; other temporary errors retain 5/15/60-minute retries. Definite provider quota refusals remain queued instead of being marked recipient failures after three attempts. No uncertain delivery is retried. This reduces repeated daily-limit attempts without clearing provider/account restrictions. Final validation: 90 tests passed and Functions build passed.

## Sync speed pass — 23 November 2026

Mailbox sync now pipelines unread verification and mailbox work per account, up to 50 accounts concurrently, with sequential operations within each account. This removes the global unread-phase barrier while preserving mailbox leases and immediate partial updates. Browser regression: 59 of 60 accounts completed while one account's unread check was held; all 60 completed after release; no duplicate requests or live provider calls. Simulated network-failure recovery still passes.

Conversation reconciliation now preloads existing message identities in groups of 98 (plus two context bindings), batches writes in groups of 100, and avoids updating already-confirmed messages. Within-batch duplicate IDs are retained only once. Controlled comparison against the prior source, using identical 100-message fixtures: new-message round trips 202 to 5; existing-message round trips 152 to 4; resulting records/import counts identical. Artificial 3 ms latency was injected per call, so these are not production Gmail wall-time claims. These changes reduce round trips by about 97%; they do not imply a 97% reduction in row writes or overall sync duration. Final regressions: 94 passed, zero failed; TypeScript/frontend/Functions builds passed.

## Nonblocking delivery review and 200 sender ceiling — 23 November 2026

An uncertain delivery remains uncertain, consumes its quota slot, and is excluded from automatic selection. Other queued messages continue. Migration 0037 updates the uncertainty trigger to hold the campaign only when no queued/in-flight work remains; existing review-held runs with pending work resume without changing manual pauses/cancellation. Unknown SMTP confirmations return a review-pending result so the scheduler continues, while transport failures stop only the affected lane without retrying that message. Terminal stale in-flight work is still recovered into review even with no queued records.

The shared concurrency ceiling is now 200, enforced atomically by claim SQL; sender lanes are rebalanced modulo 200. SMTP/provider cooldowns, account exclusions, per-account rolling caps, usage guards, and one in-flight delivery per sender remain enforced. This is a ceiling, not a promise of 200 simultaneously active SMTP connections or any particular hourly rate. Validation: 97 tests passed, including 200 atomic in-flight claims with the 201st blocked, continued scheduling after review/transport uncertainty, retained quota for uncertain messages, explicit retry behavior, and manual pause preservation. Frontend, TypeScript, and Functions builds passed.

## Inbox accounting-read failure and indexed duplicate lookup — 23 November 2026

Screenshot error APP_USAGE_UNAVAILABLE is a failed accounting lookup, distinct from APP_USAGE_BUDGET. Production accounting remained readable during diagnostics, but 97 active mailbox leases and query analytics showed heavy sync activity. The largest one-hour read query was Sent duplicate detection: 1,556 calls, 52,497,314 reads, averaging 33,738 reads/call. Its equality predicate did not imply the existing partial index's external_id<>'' condition, so D1 scanned messages. Adding that explicit predicate uses the existing unique index with no new index/storage/write overhead. Identical read-only missing-key probes returned 0 matches in both cases: 33,774 rows read before, 0 after.

Usage lookup now retries transient overload/connection/internal/timeout errors at most twice; permanent failures remain fail-closed. Campaign sending retains the 1.5m write guard. Paid manual inbox sync, conversation reconciliation and read-status updates have a separate 50k write reserve (maximum 1.55m/day; 48.05m over 31 days), without resetting recorded usage. No sending endpoint uses the reserve. A transient unavailable-accounting response no longer permanently disables all browser controls; the server still requires successful accounting before mutations.

HTML responses use no-store so refresh picks up current mobile builds. Updated inbox copy no longer advertises the obsolete 100-request burst. Validation: 101 tests passed, including partial-index query plan, bounded transient retry, permanent failure, and separate inbox/sending budget boundaries. Frontend, TypeScript and Functions builds passed. These checks address the blocking database path; a specific missing mobile reply still requires Gmail conversation evidence to verify its final state.
# Engagement tracking and sync error handling (November 23)

- Campaign sends now register signed open pixels and HTTP/HTTPS click links before SMTP. The original message body remains in conversation history. Earlier uninstrumented sends are excluded from tracking denominators; no historical opens are invented.
- First-open and first-click timestamps are conditional updates. Campaign and scouting-plan counters update through triggers, including SMTP confirmation and known bounces. Dashboard, Sending, and Scouting plans read those counters every 30 seconds while visible, rather than scanning event or delivery history. Link tracking only includes messages with tracked links.
- Tracking links use the existing dedicated signing secret. Arbitrary destination URLs cannot be supplied through the public redirect endpoint. HEAD requests do not count. Image privacy features and security scanners mean these are estimates of engagement.
- A database usage/storage failure stops launching more mailbox sync requests, retains completed results, and defers remaining accounts for manual Retry. In-flight requests finish normally. Shared failures are shown once with expandable details rather than repeated against hundreds of accounts.
- Connection limits and generic rate limits no longer classify an account as Restricted. Explicit provider account restrictions still do. Invalid credentials remain actionable: a phone Gmail session does not validate the dashboard's stored app password.
- Regression coverage includes pre-confirmation event races, duplicate events, signed route access, per-plan attribution, bounce rollbacks, disabled tracking, and messages without links. Local browser checks cover mobile metrics and stopping 120-account sync fanout after a shared storage failure.
# Lower daily usage and campaign controls (November 24)

- Production query insights identified full lead counts (~21,147 rows per workspace load), batch membership counts (~5,502 rows per load), repeated account-setting fanout, and redundant sender trigger writes. Lead and batch counts now use transactionally maintained counters, seeded once by migration 0039. New imports pay a small counter-write cost instead of every dashboard reload scanning all their rows.
- Sender status transitions combine campaign progress and in-flight counters into one update, combine sender busy/queue updates, and skip unchanged quota updates. Normal Sending runs skip redundant finish-status writes until completion. An isolated 40-send comparison reduced bookkeeping table changes from 600 to 361 (39.8%), with matching quota, sent/pending/in-flight counts and final status. This is a local table-update measurement, not a claimed 39.8% reduction in the total Cloudflare bill; index writes and other operations also contribute.
- Redundant message indexes were removed; the inbox time index now covers only inbound messages. A partial inbound thread/time index supports mobile-reply reconciliation without indexing outbound mail. The retained unique idempotency index is used explicitly by retry checks.
- Sending status summaries poll every 5 seconds while active (previously 2), and every minute while Scheduled (previously 15 seconds). Delivery activity still refreshes every 30 seconds during Sending. Sending concurrency and scheduler cadence are unchanged.
- Sending has open/click tracking toggles. Inbox has a Spam sync toggle beside Sync. Feature-only saves update only the requested flags, avoiding default-cap triggers and updates to all 442 sender accounts. Accepted sends and tracking history are unchanged.
- Sending also shows today's application-counted reads/writes and daily safety-budget percentages, with manual refresh and an optional persisted one-minute auto-refresh switch. Refresh reads the usage gate snapshot; it does not reset usage records, Gmail rolling quotas or campaign history. The existing daily budget window resets automatically at 1:00 AM Africa/Lagos. Cloudflare monthly totals remain separate.
# Campaign progress, engagement and waiting senders (November 24)

- Application usage controls now appear only in Settings, as a separate component that can be removed from the customer interface at launch. Sending keeps tracking toggles and a collapsed engagement section. Engagement performs no analytics requests while collapsed.
- Campaign progress means processed deliveries (planned minus pending), with confirmed, failed, review and pending totals shown separately. Known bounces cannot make campaign completion progress run backwards. Fill transitions use transforms and reduced-motion support; local activity feedback does not add database polling or invent sends.
- Synced campaign-linked replies are attributed to an account/recipient and campaign message ancestry. First replies and non-bounced delivery denominators have cached campaign and scouting-plan rollups. Replies are updated on Inbox sync; unrelated conversations, outgoing/mobile messages, and messages before the send do not count. Reply rollups add bounded writes when delivery/reply/bounce state changes instead of scanning delivery history on every analytics refresh.
- A stalled queue can transfer up to 200 due, queued deliveries to verified accounts with real rolling quota and no provider cooldown. Original delivery IDs, recipients and scouting plans stay fixed; audit rows record sender changes. Sent, in-flight and uncertain deliveries never move, quotas are never reset, sender/lead duplicates are excluded, and the scheduler still enforces its atomic claims. Expired quota caches refresh before availability checks. Empty capacity checks are throttled for five minutes; successful transfers can continue at the next normal scheduler tick.
- Sender-attention banner dismissal is local to the browser and persists by notification ID. It does not change health, erase notifications, or suppress newly created issues.
# Quota-expiry wake-up (November 25)

- Sender readiness now updates when the quota expiry changes even if the full quota count stays the same. This prevents repeated claim attempts against a stale release timestamp.
- Idle recovery records its next capacity check and can wake at an earlier verified account's quota/cooldown release, instead of waiting out the full five-minute maintenance backoff. Actual sender usage, provider cooldowns, paused accounts and uncertain delivery history remain authoritative.
- Scheduled campaigns show a sender-capacity waiting notice and an automatic retry countdown. The countdown is local; waiting status still uses the normal low-frequency database refresh. Application-budget holds are identified separately.
- Regression tests cover a full quota whose expiry advances without a count change, early wake-up on an unassigned account's quota release, retained historical usage, and mobile countdown rendering without additional polling.
