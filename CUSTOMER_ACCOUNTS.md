# Customer account foundation

Routes: `/signup`, `/signin`, `/welcome`; the existing administrator uses `/login`.

Customer creation is controlled by the Pages variable `REGISTRATION_OPEN=1`. It is closed when the variable is absent or `0`. Apply migration `0043_customer_accounts.sql` before opening registration. No new authentication provider account or client secret is needed for the email/password flow.

Passwords use bcrypt with cost 12 and random salts; passwords beyond bcrypt's 72-byte limit are rejected instead of silently truncated. Sessions use 256-bit opaque tokens; only SHA-256 token hashes are stored in D1. Cookies are Secure, HttpOnly, SameSite=Lax and expire after seven days. Sign-out deletes that session. POST endpoints require same-origin JSON. Registration and sign-in have per-IP rate limits; sign-in also has a per-email limit.

Each customer owns a separate `auth_workspaces` setup record. This does **not** expose the existing administrator's mail database through customer sessions. Existing mailbox APIs continue requiring the administrator session. New customers can create accounts, sign in, view their own setup profile, and sign out; they cannot use mailbox/campaign APIs yet. Do not mark a workspace ready or issue administrator cookies to customers as an onboarding shortcut.

Before a paid public launch:

1. Implement tenant-scoped mailbox/campaign data and authorization for every API, cache, job and quota counter. The current mail engine still serves the original administrator workspace.
2. Finish Gmail OAuth, encrypted refresh-token storage, disconnect/revocation, consent and the applicable Google verification process.
3. Add email verification and password recovery using a transactional email provider, plus production anti-bot protection (for example Turnstile) before opening registration broadly.
4. Implement a selected payment provider's server-verified webhooks, subscription entitlements, cancellation and idempotent billing handling. A customer browser must never set its own paid status.
5. Add user-facing terms/privacy/deletion policies and enforce per-customer limits, along with recipient opt-out/suppression controls for public sending.

The setup page deliberately labels Gmail connections and subscriptions as not yet available. It does not pretend to connect or charge a user. Its HTML/CSS are independent of the React dashboard so a frontend redesign can replace the presentation without changing the account API.

Auth usage is metered. Anonymous session checks without a cookie and registration-config reads do no D1 work. Paid account operations use a bounded reserve above the mail send guard; they do not raise sender quotas or reset usage history. Public assets are excluded from the Pages Functions route so static files avoid unnecessary middleware invocations.

Validation: `src/customer-auth.test.mjs` covers hashing, profile/workspace separation, mailbox API denial, expiry, logout, CSRF/origin checks, malformed input, duplicate addresses and rate limits. The provider-disabled browser test exercises signup, login failures/success, HttpOnly cookies, logout and mobile/desktop layout.
