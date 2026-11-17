# Multi-account mail dashboard

Status: Cloudflare Pages dashboard is live with 74 Gmail accounts authenticated for IMAP and SMTP and app passwords encrypted in D1. A local read-only pilot fetched two messages without saving them or changing read flags. No emails have been sent. Google account security notices about app-password activity appeared in that pilot inbox; review them before enabling sends.

## Scope

A private web dashboard for importing leads, assigning outreach across 82+ owned Gmail accounts, and handling conversations from one inbox. Treat the requested 40-message cap as 40 automated outreach messages per account per rolling 24 hours, configurable globally and per account. Human replies are tracked separately and still subject to provider limits.

## First release

- Accounts: connection status, encrypted credentials, sender name/signature, cap, pause switch and last inbox sync.
- Leads: CSV column mapping; TXT with one email per line; preview, syntax checks, duplicate detection and suppression checks. Preserve store/name/website fields for personalization. Syntax checking does not prove deliverability.
- Templates: multiple scouting plans with subject/body, supported variables, previews and explicit account or campaign assignment. Missing required variables block sending.
- Campaigns: select leads/accounts/templates, preview allocation and messages, schedule, launch, pause and cancel pending work.
- Allocation: balanced round-robin across eligible accounts based on remaining capacity. One initial outreach per lead; persist its sender and template. Never shift a throttled message to another account to evade restrictions.
- Sending: durable queue, atomic capacity reservations, bounded retries for known transient failures, backoff on throttling and reconciliation for uncertain SMTP outcomes before retrying. Record provider acceptance separately from delivery. Prevent duplicate jobs across restarts and workers.
- Unified inbox: background incremental synchronization, threaded conversations, account/campaign filters, unread/needs-reply labels, search and manual replies using the receiving account. Preserve Message-ID, In-Reply-To and References headers.
- Suppression: workspace-wide unsubscribe and hard-bounce list checked again immediately before sending; stop pending follow-ups when someone replies or opts out.
- Reporting: queued, provider-accepted, failed, bounced and replied counts, account health and actionable error logs. No promised inbox placement or open-rate accuracy.

## Deployment status (2026-11-16)

The Cloudflare Pages project `relay-mail-dashboard` is deployed at https://relay-mail-dashboard.pages.dev, with the D1 schema and password/encryption secrets configured. Pages Functions provide private login and D1-backed dashboard APIs. The application has no fixed account-count cap; adding accounts through the dashboard is one at a time and remains subject to Cloudflare and Google limits. All 74 owner-authorized, locally IMAP-verified mailboxes have passed IMAP and SMTP authentication on Cloudflare and their app passwords are encrypted in D1. Connection checks sent no messages. Local leads and demo conversations have not been uploaded.

The Pages build supports encrypted app-password storage, read-only inbox synchronization limited to saved leads, replies through the receiving account, global and per-account caps, multiple scouting plans, lead imports up to 10 MB and dry-run allocation. Initial inbox sync checks the latest 25 messages; subsequent syncs use UID checkpoints and bounded batches. Campaign sending and scheduled background synchronization remain disabled. The local Node.js/JSON implementation remains separate.

## Original architecture proposal

TypeScript web app with Next.js frontend/server routes, PostgreSQL for accounts/leads/campaigns/conversations/send jobs, and a separate background worker. PostgreSQL-backed durable jobs keep deployment simpler initially. SMTP sends and IMAP receives for accounts that support app-password access; keep the mail adapter replaceable with Gmail API/OAuth. All provider connections originate on the server.

Private authenticated access, encrypted secrets with a deployment-managed key outside the database, redacted logs, secret files excluded from version control, and sanitized received HTML. Disable remote images by default. Scheduled sending and inbox synchronization require an always-on worker; a local computer must remain running if it hosts the system.

## Build sequence and acceptance

1. Dashboard foundation with mock data, schema, lead import, templates and dry-run allocation. Verify 2,000 leads across 82 fresh accounts becomes 32 accounts with 25 leads and 50 with 24; verify a 12,000-lead import and multi-day plans honor account eligibility and per-day caps.
2. Connect one test account, send to controlled test recipients, synchronize a reply, and reply from the same account in the same thread.
3. Implement durable scheduling, quota concurrency checks, pause/cancel, suppression and failure recovery. Verify restart, duplicate-job and ambiguous-send handling.
4. Pilot a few accounts, then onboard remaining accounts after connection and sync checks. Review allocation before launching real campaigns.

## Assumptions to confirm

- The cap means automated outreach per rolling 24 hours, rather than per campaign.
- Gmail accounts are owned/authorized; confirm personal Gmail versus Google Workspace and administrator restrictions.
- First release is for one operator; follow-ups and team roles can be added later.
- Multiple templates are distributed evenly unless specific assignments are supplied.
- Decide local-only hosting versus an always-on private hosted installation before deployment.

## Provider constraints

Forty messages is an application cap, not an assurance against Google restrictions or spam filtering. Scraped/published addresses are not evidence of opt-in. Google advises against sending to people who did not sign up; recipient eligibility and opt-out handling must be considered before campaigns launch.

Google recommends Sign in with Google over app passwords. Existing app passwords can support an initial SMTP/IMAP integration where permitted; validate on one account first and keep OAuth as the preferred longer-term connection option.

Sources checked 2026-11-16:
- https://support.google.com/mail/answer/185833?hl=en
- https://support.google.com/mail/answer/81126?hl=en
- https://support.google.com/mail/answer/14229414?hl=en
