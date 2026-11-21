# Campaign preparation incident recovery — 21 November 2026

## A. Confirmed cause and limits of historical evidence

The inspected local 50-row INSERT used eight bindings per delivery: 400 parameters, above D1's limit of 100 per statement. An isolated initiation reproduction failed with a parameter-limit error and returned HTTP 500; its old failure handler removed the campaign. Cloudflare documents that batching does not remove individual statement limits: https://developers.cloudflare.com/d1/platform/limits/ .

The earlier implementation also inserted an entire campaign within one request, initialized counters and sender queues only at the end, and lacked checkpoints and ownership leases. Interruption could strand a Preparing campaign. Timestamp/NaN-based deletion cannot safely recover that state and has been removed. The exact historical failure at approximately 17,000 of 17,680 inserts cannot be independently reconstructed: that partial campaign is absent from the current database and historical failed request logs were unavailable. Deployment commit labels alone do not identify which dirty local changes prior agents deployed.

## B. Production findings

Before and after migration/deployment, the sole campaign f492066c-9fe5-47c6-a532-145bf94ec105 is Cancelled: planned 8,880; pending 0; accepted net of bounces 2,131; failed/bounced 93; uncertain 0; in flight 0. There are 2,224 physical delivery records with sent status and 93 linked permanent bounces. These figures reconcile; the physical status records original acceptance. Sender-ready entries: 0. New preparation jobs/chunks: 0. No live campaign was created, cancelled, or deleted during this recovery. Only additive migration 0034 was applied; earlier migrations through 0033 were already present.

## C. Source changes

- src/campaign-preparation.mjs: immutable snapshot, JSON-bound delivery chunks, progress journal, bounded continuation, lease ownership and activation checks.
- migrations/0034_resumable_campaign_preparation.sql: additive preparation journal/chunks/indexes and soft review-dismissal field.
- functions/api/[[path]].js: asynchronous start/reuse, preparation/status endpoints, no stale timestamp deletion, safe errors, completion and review integration. Preserves prior settings persistence work.
- src/send-scheduler.js and functions/_middleware.js: authenticated preparation preflight; no dispatch without explicit readiness; idle gate avoids opening 150 empty send requests each minute.
- src/campaign-control.mjs: explicit cancellation of preparation invalidates ownership and preserves accepted/uncertain delivery history.
- src/campaign-state.mjs: terminal completion and safe known-failure retry/dismissal. Uncertain sends still require separate explicit review.
- design/mail-dash-builder/src/App.tsx, src/lib/api.ts, src/types/maildash.ts, src/pages/SendingPage.tsx: saved preparation progress, reload continuation, interruption/resume control, preparation cancellation and existing individual/bulk review controls.
- design/mail-dash-builder/tsconfig.json: exclude unused legacy fixture that conflicts with newer settings types.
- scripts/test-d1.mjs, scripts/qa-server.mjs, src/campaign-preparation.test.mjs, src/domain.test.mjs, package.json: serialized D1 test transactions, SMTP-disabled browser fixture, preparation/concurrency/cancellation/scheduler regressions.
- scripts/deploy-maildash.mjs: require migration 0034 before releasing the API.
- public/index.html and its referenced production assets: rebuilt dashboard.

Prior uncommitted DashboardPage, InboxPage, SettingsPage, Gmail HTML helper, open-tracking helper/route, and migrations 0032/0033 remain included. No credentials or production-specific Wrangler configuration are published.

## D. Reliability and efficiency

A start atomically saves stable delivery IDs and immutable chunk payloads, returning HTTP 202. It does not connect to SMTP. Each continuation processes at most two chunks from the dashboard, or sixteen from the scheduler. Delivery chunks contain 250 records bound as JSON rather than hundreds of separate parameters; sender queues initialize in groups of 25. Each transaction updates its progress checkpoint together with its inserts. A 60-second ownership lease prevents competing workers, and guarded writes prevent cancelled or superseded owners from continuing. A replacement worker can reclaim expired ownership. Lost responses do not double-insert or double-count committed chunks.

Activation requires all checkpoints plus matching actual delivery and sender-queue totals. Legacy Preparing jobs without a snapshot require explicit review/cancellation and are never auto-deleted. Campaigns currently accept at most 100,000 planned deliveries. Existing quotas, account exclusion, cached ready-sender selection, suppression and uncertainty holds remain enforced. Closing the browser does not prevent the scheduled preparation worker from continuing.

## E. Validation

Final npm test: 84 executed, 84 passed, 0 failed. Includes a complete 17,680-record preparation across 442 accounts; failed transactions; lost responses; concurrent initiation/leases; expired lease recovery; sender-queue failure/resume; invalid timestamps; cancellation races; safe errors; tracking/settings helper regressions; idle/unconfirmed scheduler gate; existing allocation/quota/bounce/sync/notification regressions.

TypeScript noEmit passed. Frontend production build passed. Pages Functions build passed. Mobile Chrome browser verification passed: initiate 1,600 records/40 senders, injected network interruption, persist 250 saved rows across refresh, explicit resume to complete preparation, zero browser errors, and zero SMTP sends. An initial browser failure exposed a missing Resume button for network errors; corrected and verified. Builds emit only the existing Vite __dirname migration warning.

## F. Deployment

Pages production: b090cd1c-e1a8-4ec3-9ca0-19a4e15fa086.
Canonical URL: https://relay-mail-dashboard-9uo.pages.dev
Deployment URL: https://b090cd1c.relay-mail-dashboard-9uo.pages.dev
Scheduler version: 083732e8-bc72-4bcf-868f-e9cb4d9c295f.
Existing schedule retained: * * * * *.
Production migration: 0034_resumable_campaign_preparation.sql, applied successfully.

## G. Production verification

Canonical login returns 200; current JS/CSS assets return 200 with correct MIME types. Unauthenticated state/sending APIs return expected 401, and root redirects to login. D1 remote reads verify the existing binding and unchanged business record counts. Scheduler deployment confirmed the once-per-minute trigger. Production initiation is deliberately not exercised: it would create real dispatchable work. Automated SMTP/provider operations were disabled, and no live sends were requested during testing.

## H. Remaining limits

A controlled live test with an authorized account and consented recipient requires user approval. Until then, real SMTP throughput and provider confirmation after this deployment remain unverified; deployment/build success alone does not establish them. The exact earlier partial-campaign failure remains unprovable from retained production evidence. New tracking/spam settings and their existing helper/schema work were preserved, but full tracking-pixel insertion and Spam-folder ingestion are not wired end-to-end in the inherited API; this incident repair does not claim to complete those separate features or create missing secrets. Snapshot storage adds bounded writes/storage per campaign; retention cleanup is not automatic and must not delete history without explicit authorization.

Publication note: origin/main had advanced to 17d6ac5 through three commits, including replacements of core source with one-line placeholders (for example, // app content). The merge retains that upstream history and its unrelated test.txt while restoring the validated complete source for the eight conflicted paths. No force push is used. A bounded sanitized post-deployment log observation yielded no request events; therefore no claim of a live observed cron execution or measured send throughput is made. The deployed schedule and idle gate are verified by configuration and local regressions; live SMTP remains approval-gated.
