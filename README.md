# Relay mail workspace

First milestone: a local, persistent demo of the outreach and unified-inbox workflows, with a read-only Gmail pilot sync. Requires Node.js 22+.

## Run

```powershell
cd 'D:\custom mail dashboard'
npm install
npm start
```

Open http://127.0.0.1:3000. Run `npm test` for allocation and import checks.

## Available now

- Responsive unified inbox with conversation search and filters.
- On-demand, read-only sync of the 10 latest messages from the first valid account in the local app-password file. Message content stays in memory and is not written to `data/demo.json`.
- Demo reply composer bound to the receiving account, with browser-session drafts.
- CSV/TXT import with quoted CSV fields, format checks, deduplication and a 10 MB limit; each uploaded file is tracked as a deletable batch, and lead tables paginate to stay responsive with lists of 12,000.
- Scouting-plan creation and required personalization checks.
- Campaign previews split connected senders into groups of 50. Leads are assigned once across groups first, then spare capacity is filled from previously assigned leads without repeating a lead from the same sender.
- One-click live sending in the Cloudflare app. A scheduled Worker sends eligible, previously unsent leads in the background, using randomly selected compatible scouting plans. Sending continues when the dashboard tab is closed, pauses at sender quotas, and resumes on later ticks. The Sending view shows background progress and refreshes it every 10 seconds while open.
- Pause/resume demo accounts and configure the default outreach cap.
- Local persistence in `data/demo.json` (excluded from version control).

The seed workspace has 82 fictional sender addresses and three sample conversations; existing local account and lead data is preserved. Saving a demo reply does not contact anyone. Local campaign previews never send messages. The app-password file is ignored by version control and is never published as a static asset.

Campaign previews use consecutive 24-hour windows and a maximum of 40 messages per sender (or its lower configured cap). With 3,000 leads and 100 connected sender accounts, the first 50-account group receives the first 2,000 leads. The second group gets the remaining 1,000 plus 1,000 leads reallocated from the first group, for 4,000 planned messages total. With 4,000 leads, each group gets 2,000 unique leads and there are no repeats. The same lead is never sent twice from the same sender within one campaign. If the unique lead list exceeds the total available 24-hour capacity, remaining leads continue in the next window.

## Cloudflare Pages deployment

The Cloudflare build uses Pages Functions and D1, not the local JSON-file server. It supports private login, Gmail app-password connections, global and per-account caps, multiple scouting plans (with optional subject lines), lead imports up to 10 MB, and direct live sending. There is no configured scouting-plan count cap; all plans are loaded and displayed together, so keep the list manageable. On each direct send, compatible scouting plans are chosen randomly per sender and remain fixed for that run. Multiple accounts may receive the same plan, and plans requiring lead fields that are missing from a sender's assigned recipients are excluded for that sender. App passwords are encrypted with AES-GCM using a separate Pages secret before being stored in D1. Connection checks authenticate with IMAP and SMTP but do not send mail. Inbox and Sent-folder sync is read-only and runs only when the user clicks Sync connected inboxes. Automatic requests are rejected before any database reads. Successful Inbox or Sent sync results are saved even if the other mailbox fails, and sync progress is shown as each account batch completes. The hosted Inbox lists conversations whose latest message is from the current local day; an older conversation returns when it receives a new message that day, while its full thread remains available. Replies and campaign messages are sent through verified accounts and saved to conversations. Local JSON data is not uploaded.

Live sending starts when you select **Initiate sending**; no preview or campaign-name step is required. Only active leads with no confirmed prior send are selected, including leads not previously contacted from another sender. A scheduled Cloudflare Worker targets up to 45 messages per minute with at most three in-flight sends across distinct accounts, preferring the sender used least recently. Atomic database claims preserve sender quotas, pause/review stops and duplicate protection. Sending continues when the dashboard tab is closed. Each sender is limited to 40 messages per rolling 24-hour window (or its lower configured cap); queued messages resume automatically when capacity returns. Explicit SMTP 4xx or quota/rate-limit rejections receive at most three delayed retries; permanent SMTP rejections and exhausted retries are recorded as failed, and the run continues with other queued messages. Network or delivery-confirmation failures remain blocked as unconfirmed until you check the sender's Sent folder; **Retry with duplicate risk** is an explicit manual action. **Pause** and **Resume queued** are available in Sending activity, and resuming queued work leaves unconfirmed messages blocked. A lead may be sent by multiple sender accounts within the same run under the existing allocation rules.

The hosted dashboard checks connected accounts' IMAP and SMTP access every six hours while it is open, and also offers a manual **Check now** action. It records provider-reported restrictions and connectivity problems in **Accounts → Health notifications**; these checks do not measure Gmail sender reputation or send probe messages. Configure an alert recipient in **Accounts → Health alert email**. Alerts are sent through another verified sender with healthy or not-yet-checked status when one is available; otherwise, the dashboard retains the alert and allows a manual retry.

Leads and scouting plans can be edited or deleted from their respective sections. Edits apply to pending sends; already-sent messages are unchanged. Deleting an item referenced by a send archives it instead, preserving queued sends and history. Archived leads and plans can be restored. Lead uploads are tracked individually; deleting an upload removes its links, retains leads present in other uploads, archives leads used by send history, and deletes other batch-only leads.

## Deploy to the new Cloudflare account

The checked-in Wrangler files are deliberately safe templates. They cannot target the former Cloudflare D1 database or Pages URL. Do not add a real database ID, Pages URL, passwords, encryption key, or app-password file to Git.

1. In the new account, create a D1 database named `relay-mail-dashboard` and create a Pages project named `relay-mail-dashboard` (or choose your own names).
2. Copy `wrangler.production.example.jsonc` to the ignored `wrangler.production.jsonc`, then replace its database name and ID. Copy `wrangler.scheduler.production.example.jsonc` to the ignored `wrangler.scheduler.production.jsonc`, then replace its dashboard URL after the first Pages deployment.
3. Apply the schema to the new database: `npx wrangler d1 migrations apply YOUR_D1_DATABASE_NAME --remote --config wrangler.production.jsonc`.
4. Create the Pages project once: `npx wrangler pages project create relay-mail-dashboard --production-branch main`, then deploy: `npx wrangler pages deploy ./public --project-name relay-mail-dashboard --config wrangler.production.jsonc`.
5. Set `DASHBOARD_PASSWORD` and a securely generated, backed-up 32-byte base64url `CREDENTIALS_ENCRYPTION_KEY` as Pages secrets. Set the same securely generated `BACKGROUND_CRON_SECRET` on both the Pages project and scheduler Worker. Do not commit any of them.
6. Deploy the scheduler with `npx wrangler deploy --config wrangler.scheduler.production.jsonc`. It runs every minute but has no credentials or queued work until accounts and a campaign are created.
7. Test login, an account connection, inbox/sent sync, a test reply, and the Sending status endpoint before importing the 74 account credentials. Keep sending paused until the tests pass.

In the dashboard, open **Accounts → Connect email account** to add another Gmail address and its 16-character Google app password. There is no application-set account-count maximum; add accounts one at a time. Cloudflare plan quotas and Google account policies still apply. Never use your normal Google password. To check for replies and phone-sent messages, connect the account and select **Sync connected inboxes** in the Inbox; sync also runs automatically while the dashboard is open. Sync is read-only, leaves Gmail read flags unchanged, and saves incoming messages for known leads and sent messages that match a known lead or conversation. The first sync checks recent messages; later syncs check new arrivals in batches. The local credential file is not automatically uploaded; only accounts explicitly connected through the form or authorized import are stored.

Cloudflare Free plan limits apply to Pages Functions and D1. D1's daily row-read quota can temporarily block dashboard data and inbox sync after it is exhausted; progress polling uses campaign counters rather than rescanning every delivery, and the API reports this quota condition explicitly. The send-start eligibility query has been rewritten to form indexed blocker sets once, rather than running correlated delivery and message scans per ready lead. Migration `0017_sending_eligibility_indexes.sql` creates the supporting indexes. The regression suite seeds thousands of leads and verifies both the query plan and the suppression rules. For the local-only Node prototype, use the `npm start` instructions above; its credentials and JSON data are not used by the Pages deployment.


## Mail Dash React production frontend (2026-11-18)

The production UI now comes from `design/mail-dash-builder/src`. It uses the existing
Pages API through `src/lib/api.ts`; the legacy public app scripts are no longer part
of the release package. The supplied React design tokens, layout, icons, fonts and
light/dark styling are retained. Unsupported analytics and controls are omitted or
explicitly unavailable rather than populated with examples.

- Dashboard: real counts and latest campaign progress; no estimated charts or inbox-placement scores.
- Inbox: inbound replies since midnight in Africa/Lagos, full-thread detail, persistent tags/star/archive/read controls, explicit and five-minute read-only sync, replies through the receiving account. Failed reply drafts are retained. Unconfirmed replies show their delivery state.
- Sending: real persisted counters refreshed every ten seconds while visible, latest 50 deliveries per status, real pause/resume and an explicit duplicate-risk confirmation for retrying unconfirmed deliveries. Starting a send uses all eligible imported leads and automatic compatible-plan allocation; the UI does not offer an unsupported selected-recipient/sender override.
- Leads: raw CSV/TXT goes to the backend parser, server-side cursor pages of 100, tracked imports and confirmed batch deletion. Search/export operate on the displayed page. No sample-load action remains.
- Plans: persisted name/body/optional subject, create/edit/duplicate/delete and active/paused state. A plan contains one message; cadence scheduling is unavailable. Per-plan analytics are unavailable.
- Accounts: real connection/health/caps, pause/resume, app-password connection and connection checks. Credentials are never returned by the state API. DNS, reputation scoring and automated warmup are unavailable. Manual health checks suppress email notifications.
- Settings: persisted workspace name, default per-sender cap and health-alert recipient; locally persisted theme. Saving the default cap applies it to all senders, matching the existing backend.

Validation: `npm test` (25 tests), TypeScript no-emit check, `npm run pages:build`,
`npm run frontend:build`, and local browser checks at 1440/768/390 pixels. The local
QA server uses an in-memory database and rejects all email-delivery/provider-connect
requests. QA fixtures never enter the production package or database.

Release commands:

```powershell
npm test
npm run pages:build
npm run frontend:build
npm run pages:deploy
```

`frontend:build` prepares `.pages-release` using only the compiled React JS/CSS,
index, existing login files and security/routing headers. `pages:deploy` temporarily
uses the ignored production binding, deploys this package with Pages Functions, and
restores the placeholder `wrangler.jsonc` in a `finally` block. Build the frontend
before every deployment. The production binding and secrets must never be committed.

Migrations 0021 and 0022 add thread preferences and indexed, bounded activity polling.
The existing due-time scheduler and 100-parameter thread batching protections remain.

Production release: `89a9dce9` on 2026-11-18. Live assets and authentication redirects
were verified; read-only D1 checks confirmed 74 accounts, 0 leads, 0 campaigns. The
signed-in production API and actual Gmail send/reply/connection operations were not
exercised in this session because no authenticated browser was available and test
email delivery was not authorized. No production account/lead/campaign deletions or
email sends were performed.

## Import progress and scheduler repair (2026-11-19)

Lead imports now use `/api/import/progress`, a streamed NDJSON response. Progress
advances after lead insertion and import-batch link writes commit. Validation is
indeterminate; 100% is shown only after server completion. The progress panel is
owned by App, so it remains visible when navigating from Leads to Sending.
Sending progress uses two decimal places so a small confirmed count does not round
to zero. Regression coverage now includes 26 backend tests and a browser check
that observed 1,000 / 4,402 work units, navigated to Sending, and confirmed 2,201
saved local test leads before completion. No QA leads were imported into production.

Investigation found no registered cron schedules on the production sender Worker.
Cloudflare also required account Workers onboarding before accepting a schedule.
After explicit user approval to begin the existing queued campaign, the account
subdomain was registered as `relay-mail-ose272.workers.dev` and the `* * * * *`
trigger was registered. `workers_dev` remains false for the scheduler. No new
campaign was created and no separate test emails were sent. New cron registrations
may take up to 15 minutes to propagate, according to Cloudflare documentation.

When deploying the scheduler to another account, finish Workers account onboarding
and run `wrangler deploy --config wrangler.scheduler.production.jsonc`; confirm
that the deployment output includes the intended minute-by-minute schedule.

Post-repair verification on 2026-11-19: the restored cron executed successfully,
and production counters showed 19 confirmed sends, 8,861 pending, 0 uncertain and
0 failed. The latest confirmed send in that check was 07:56:13 UTC (08:56 Lagos).
These were approved deliveries from the existing campaign, not separate test mail.
Progress UI/API release: `a0376584`. Correct JS/CSS content types and placeholder
Wrangler restoration were verified after deployment.


## Low-read sending and manual mailbox checks (2026-11-19)

- Sender selection now seeks one candidate per sender, then checks quota only for
  the preferred sender. A bounded fallback checks other candidates when necessary.
- Migration 0023 adds partial queue, quota-time and sender-history indexes. The
  production candidate query measured 445 rows read instead of tens of thousands.
- Live numeric profiling exposed an additional 8,881-row stale-send UPDATE scan
  per request. Migration 0025 and indexed in-flight-ID recovery remove that scan.
  Successful profiled sends then read approximately 550 rows in total, about 99%
  fewer than the original per-send cost. Cloudflare's 08:24 UTC minute reported
  24,733 reads, down from roughly 800,000/min before optimization; analytics lag.
- Migration 0024 uniquely locks each sending account. Atomic claims also enforce
  a maximum of three in-flight campaign deliveries and the rolling quota. A stale
  selection cannot send a duplicate or override a user pause / review stop.
- The scheduler uses three concurrent request loops, targeting up to 45 confirmed
  or permanently rejected deliveries per tick, with at most 90 attempts. Only
  explicit claim contention is retried; unknown network confirmation stops the run.
  Live complete-minute samples showed 33–41 confirmed sends/minute with zero
  failures or uncertain sends during verification. Provider latency affects rate.
- Full quotas now schedule the earliest rolling reset automatically rather than
  leaving the campaign permanently paused.
- Reply checks are manual-only in React and the legacy startup. The API requires
  an explicit manual flag before reading D1, so older tabs cannot silently sync.
- 31 backend tests pass. Browser verification advanced six minutes with no mailbox
  requests, then observed exactly one request after clicking Sync (local fixture).
- No production leads, campaigns, accounts or history were deleted. The existing
  campaign was temporarily paused during the urgent fix and resumed afterward.
  Per-sender caps remain 40 per rolling 24 hours or the lower configured cap.


## Pending efficiency release and GitHub source

See [EFFICIENCY.md](EFFICIENCY.md) for the cached sender queue, stored rolling quota
reservations, conservative read/write guard, polling reductions and release steps.
Migrations 0026 and 0027 are pending production application because D1 Free quota
is exhausted. Cron is disabled. The user chose to wait for the November 20 reset
at 01:00 Africa/Lagos. Publishing source to GitHub does not apply those migrations
or restart sending. No exact 10-read-per-send production result has been claimed
for the staged cache implementation.
