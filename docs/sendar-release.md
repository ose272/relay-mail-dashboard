# Sendar frontend release candidate

The uploaded Sendar layout and supplied logo are retained. The preview viewport selector and prototype records are removed. Navigation uses URL fragments to retain the current section and conversation on refresh; CSS selects the desktop or mobile layout automatically.

The owner workspace reads existing accounts, saved conversations, lead batches, plans, campaign counters, delivery records, engagement metrics, notifications and settings through the existing authenticated API. Imports stream committed progress. Conversation actions and settings persist on the server. Replies retain their request identifier when a network result is unknown; the interface never automatically retries them.

Daily reporting uses maintained Africa/Lagos totals instead of scanning delivery history on each chart refresh. Summary polling runs only on relevant visible sections. Provider mailbox sync remains manual, with the previously requested one-time sync on a browser reload. Account health checks are explicit. Provider cooldowns, uncertain-delivery protection and rolling capacity history remain enforced.

Legacy entry points redirect to Sendar. The release staging directory contains only the new frontend, headers, routes and the existing Google verification file. Historical source remains available in Git; the old bundles are not included in the new release.

## Deployment prerequisites

- Apply migration 0047 before deploying the matching Functions; deployment preflight verifies it. This migration adds plan descriptions and daily activity totals. It does not clear sending usage or change sender caps.
- Google OAuth onboarding is still pending. New customer registrations remain isolated setup profiles and cannot access the owner's mail APIs. Customer mailbox tenancy must be implemented and tested before public mailbox onboarding is enabled.
- Access remains free. Paystack subscriptions and charging are inactive; see paystack-billing.md.
- The existing Google deceptive-page warning still requires a security review after the overhaul. This frontend change alone does not establish that the warning has been cleared.

The backend-connected owner interface and migration 0047 were deployed on 26 November 2026 after the user reported that the live site still showed the old demo. Deployment: c3040865. Public redirects, the live-data bundle, Google verification and unauthenticated API protection were verified. Google OAuth and public customer mailbox onboarding remain pending.

## Verification

TypeScript checking, production frontend build, Cloudflare Functions compilation, and backend regression tests cover this candidate. Local browser checks exercise real API handlers against an isolated in-memory SQLite database: plan/import/settings persistence, notification deletion, engagement data, both conversation directions, unread changes, mobile layout, and section/conversation reloads. Provider connections and email delivery are disabled during these browser checks. This is not a live OAuth or production SMTP test.

Update 26 November 2026: deployment 1cc1d9d5 disables administrator login and administrator sessions in production. Public routes now offer Sendar customer sign-in only. OAuth mailbox onboarding is still pending. The Google review draft is in google-security-review.txt; submission has not been confirmed.

Custom domain verified 26 November 2026: https://sendar.com.de is active in Cloudflare Pages. HTTPS, the deployed frontend, redirects, site-verification file and private API protection passed checks. No responsive-layout changes were made. See custom-domain.md.

Google connection test deployed 26 November 2026: d92a4baf, migration 0048. Credentials from the authorized local web-client JSON were installed as encrypted Cloudflare secrets without printing them or copying the file. The 150-test backend suite, isolated desktop/mobile OAuth browser checks and production anonymous-boundary checks passed. A real user must now complete Google consent and the read-only Gmail profile check. Full customer campaign/inbox access and production Google verification remain pending. See google-oauth.md.
