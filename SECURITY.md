# Security review status — 26 November 2026

The user supplied the current Search Console report: Deceptive pages, example https://relay-mail-dashboard-9uo.pages.dev/login. This is a Google security classification, not evidence of an SSL failure. The exact detection mechanism has not been established.

Deployment 1cc1d9d5 replaced the legacy public administrator entry with customer-only Sendar sign-in. ADMIN_LOGIN_DISABLED=1 disables the legacy login endpoint and rejects administrator sessions at middleware, while authenticated scheduler requests retain their existing authorization. The flagged /login URL redirects to /sendar/signin. Saved mail, accounts, delivery history, provider cooldowns and quota history were not deleted or reset.

Live checks verified /login redirects to /sendar/signin, /api/login returns HTTP 410 without issuing a cookie, the customer sign-in bundle has no administrator option, and the public Google verification file returns HTTP 200. Customer-only signup/signout and desktop/mobile forms passed isolated browser checks; customer authentication and disabled administrator boundaries passed backend tests.

These checks do not prove that every route or stored tracking destination is harmless or that Google has cleared the warning. No authenticated Google review has been submitted through the available tools. The prepared factual request is in docs/google-security-review.txt. Submit it using the verified property's Security Issues report after reviewing the current examples and confirming the deployed fixes. Do not claim a review was submitted or approved before confirmation.

Google OAuth mailbox-connection testing is deployed with session-bound state, PKCE, verified Google identities and encrypted customer-specific tokens. Full customer campaign/inbox operations remain pending; registrations remain isolated setup profiles. No live user consent or Google review approval is claimed by deployment. Access is free and Paystack charging is inactive.

A custom domain can provide a user-controlled launch address and ownership verification. It is not a substitute for addressing the report and must not be used to evade a safety classification.

Official guidance: https://support.google.com/webmasters/answer/9044101
