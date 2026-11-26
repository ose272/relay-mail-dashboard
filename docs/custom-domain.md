# Sendar custom domain

Verified on 26 November 2026:

- Domain: https://sendar.com.de
- Cloudflare Pages project: relay-mail-dashboard
- Account: the original Relay Mail Cloudflare account
- Apex CNAME target: relay-mail-dashboard-9uo.pages.dev, proxied
- Pages hostname status: active
- Domain verification and certificate validation: active
- HTTPS sign-in page: HTTP 200
- Root and old design entry points redirect to the current Sendar interface
- The deployed live-data frontend bundle is served on the custom domain
- The existing Google site-verification file returns HTTP 200
- Unauthenticated private API access is rejected

No design, responsive-layout, campaign, mailbox credential or sending-history changes were required. The original Pages hostname remains available; no Google warning was bypassed or declared cleared.

The Google OAuth connection-testing callback is now deployed at https://sendar.com.de/api/oauth/google/callback; the provided client lists that callback and origin. Customer campaign/inbox operations remain pending. Google Search Console ownership for the new property must be confirmed separately. See google-oauth.md.

The DNS-edit token used in the local authorization helper was not saved to this repository or printed. The helper's result file contains only sanitized success metadata.
