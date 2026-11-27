# Customer Google mailbox connection

The testing connector was deployed on 26 November 2026 (deployment d92a4baf) at https://sendar.com.de. Migration 0048 adds separate customer mailbox and OAuth-state tables. It does not migrate or expose legacy administrator mail.

## Configuration

Production Pages secrets: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_OAUTH_ENCRYPTION_KEY. The authorized local Google JSON was processed in memory to set these bindings; its contents were not printed or copied into the project. The dedicated encryption key is generated only when absent. Do not replace it after connections exist without a token re-encryption migration.

Canonical origin: https://sendar.com.de. Callback: https://sendar.com.de/api/oauth/google/callback. Both match the provided web-client configuration. Sign in to a Sendar customer account before connecting Google; this is mailbox authorization, not a replacement for the Sendar sign-in flow.

## Security boundaries

- A short-lived, one-use OAuth state is bound to the exact Sendar customer session and workspace. PKCE protects the authorization-code exchange.
- Google ID tokens are checked against Google's RSA signing keys, issuer, client audience, expiry, nonce and verified email. Provider endpoints are fixed; arbitrary redirects and token endpoints are not accepted.
- Access and refresh tokens are encrypted at rest with AES-GCM and workspace/identity-associated data. The API returns only connection metadata.
- Each active Google identity belongs to one customer workspace. A different workspace cannot silently claim it. An explicit disconnect clears local tokens and requests Google revocation.
- Start, check and disconnect are same-origin POST operations. Legacy administrator cookies cannot authorize customer mailbox routes.
- Provider responses, authorization codes, token values and encrypted credential data are never logged. Callback redirects discard authorization parameters and send Referrer-Policy: no-referrer.

## Testing flow

1. Keep the Google project in External / Testing mode. Add the first test Gmail account under Audience / Test users.
2. Create or sign into a Sendar customer account at /sendar/signin.
3. On /sendar/welcome, select Connect Google mailbox and authorize the chosen test account on Google's consent screen.
4. After returning, check the saved mailbox entry and select Check Gmail access. The check reads only the Gmail profile and sends no email. Repeated successful checks are cached briefly.

Requested mailbox scopes are gmail.readonly and gmail.send, alongside openid/email for verified mailbox identity. No test email is dispatched by onboarding. The Google project needs the Gmail API enabled. Google's testing-user and token-expiry restrictions still apply.

## Verification and remaining work

The initial 150-test backend suite passed, including OAuth state/session-swap, replay, forged identity, partial grant, expiration, cross-workspace access, refresh, revocation and legacy-data isolation cases. Desktop/mobile browser checks used real local APIs with an isolated database and mocked Google responses. Production checks confirmed the configured callback, anonymous-access rejection, token-free callback redirects, customer UI and disabled administrator login.

A real user's Google consent and Gmail profile check still require the user to complete the flow. No live mailbox connection is claimed by deployment alone.

This is the isolated mailbox-connection testing phase. Customer campaign, lead and inbox operations are not yet enabled by this connector. They must be scoped to customer-owned records and tested before public mailbox operations launch. Public homepage/privacy disclosures, the existing Google security review, and any required Gmail-scope production verification also remain release prerequisites. Paystack charging remains inactive.

## Callback compatibility update — 27 November 2026

Deployment c4ee99a1 accepts both the Boolean true and exact string "true" for Google's signed email_verified claim. Google's documented token example uses the string form. The previous validator rejected that form; the rejection was reproduced inside the Cloudflare/D1 local runtime, and the corrected flow connected the synthetic mailbox successfully. Signature, nonce, issuer, audience and expiry verification remain required. Other truthy strings, numbers, null and unverified values remain rejected. This establishes a compatibility defect, not proof that it caused every previously failed live attempt.

The 153-test regression suite and isolated desktop/mobile checks passed. A new user consent attempt is needed to confirm the real connection.

Migration 0049 stores fixed callback-stage/error codes, numeric provider status and an opaque support reference for the customer workspace. It never stores provider payloads, authorization codes, OAuth state, email addresses or token/ciphertext data. Expired diagnostic rows are removed in bounded indexed batches. Generic callback failures now return actionable fixed messages and a reference; operators should inspect only these safe metadata fields, never dump OAuth-state or mailbox-token rows.

Reference: https://developers.google.com/identity/openid-connect/openid-connect#an-id-tokens-payload

## Cloudflare native-fetch correction — 27 November 2026

A production diagnostic isolated the reported connection failure to token_exchange with provider status 0. An actual Workerd fetch probe reproduced the cause: redirect: "error" throws a TypeError before any outbound request because this runtime supports only "follow" and "manual". The earlier mocked provider tests did not exercise that native option validation.

Provider requests now use "manual" and explicitly reject every 3xx response without following it, preserving the boundary against forwarding credentials. Google revocation also uses manual mode. Native Cloudflare-runtime verification now retrieves Google's public signing keys and receives an expected HTTP 400 for a deliberately invalid synthetic token request, proving that the transport reaches the provider. No real credentials were used in these transport probes.

The 154-test suite passes, including a regression test that redirects are not followed and credentials are not forwarded. A fresh real-user consent attempt is required because prior one-use callback states were consumed. No test email was sent, and existing tokens, secrets, sender quotas and mail history were not changed.
