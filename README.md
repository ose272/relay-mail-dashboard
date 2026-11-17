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

The Cloudflare build uses Pages Functions and D1, not the local JSON-file server. It supports private login, Gmail app-password connections, global and per-account caps, multiple scouting plans (with optional subject lines), lead imports up to 10 MB, and direct live sending. There is no configured scouting-plan count cap; all plans are loaded and displayed together, so keep the list manageable. On each direct send, compatible scouting plans are chosen randomly per sender and remain fixed for that run. Multiple accounts may receive the same plan, and plans requiring lead fields that are missing from a sender's assigned recipients are excluded for that sender. App passwords are encrypted with AES-GCM using a separate Pages secret before being stored in D1. Connection checks authenticate with IMAP and SMTP but do not send mail. Inbox and Sent-folder sync is read-only and runs automatically every five minutes while the dashboard is open, with manual sync still available. Successful Inbox or Sent sync results are saved even if the other mailbox fails, and sync progress is shown as each account batch completes. The hosted Inbox lists conversations whose latest message is from the current local day; an older conversation returns when it receives a new message that day, while its full thread remains available. Replies and campaign messages are sent through verified accounts and saved to conversations. Local JSON data is not uploaded.

Live sending starts when you select **Initiate sending**; no preview or campaign-name step is required. Only active leads with no confirmed prior send are selected, including leads not previously contacted from another sender. A scheduled Cloudflare Worker processes up to 15 messages sequentially per minute, preferring the sender used least recently, so sending continues when the dashboard tab is closed. Sends are not parallelized. Each sender is limited to 40 messages per rolling 24-hour window (or its lower configured cap); queued messages resume automatically when capacity returns. Explicit SMTP 4xx or quota/rate-limit rejections receive at most three delayed retries; permanent SMTP rejections and exhausted retries are recorded as failed, and the run continues with other queued messages. Network or delivery-confirmation failures remain blocked as unconfirmed until you check the sender's Sent folder; **Retry with duplicate risk** is an explicit manual action. **Pause** and **Resume queued** are available in Sending activity, and resuming queued work leaves unconfirmed messages blocked. A lead may be sent by multiple sender accounts within the same run under the existing allocation rules.

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
