# Security investigation: 2026-11-26

Google's public Safe Browsing site-status report currently classifies
`https://relay-mail-dashboard-9uo.pages.dev` as unsafe for deceptive content.
This is a reputation/security classification, not an SSL certificate error.
The authenticated Search Console Security Issues report has not yet been
inspected, and no Google security-review request has been submitted.

## Changes deployed

- Correct the administrator login's legacy MyMail branding to Relay Mail.
- Clearly identify Relay Mail sign-in passwords as separate from Google/Gmail
  account passwords, and distinguish customer setup from mailbox connections.
- Add a public `/about` page explaining the independent service and account safety.
- Add Strict-Transport-Security with a one-year lifetime. Existing content
  security, frame, referrer and content-type protections remain in place.

## Checks and limits

Anonymous live checks of `/`, `/signin`, `/signup` and `/login` showed same-site
login scripts and same-site redirection; no external JavaScript was observed on
those entry pages. The production dependency audit reported zero known npm
vulnerabilities. Tracking redirects require valid signed tokens and reject
non-HTTP destinations and embedded URL credentials. Customer sessions do not
authorize the administrator mail APIs, as covered by the authentication tests.

These checks do not establish why Google flagged the site, prove that every
route or stored outbound link is safe, or remove the browser warning. Do not
describe the warning as cleared until Google's current status confirms it.

## Remaining investigation

1. Open the verified URL-prefix property in Google Search Console, then
   Security & Manual Actions > Security issues. Record its category and example
   URLs; do not invent a verification token or bypass sign-in requirements.
2. Investigate every example URL, including tracking destinations if identified.
3. Address the reported cause and verify the fixes before requesting Google's
   review. Do not submit an unsupported claim that all issues are fixed.
4. Recheck the public Safe Browsing status after review. Do not bypass browser
   safety warnings or rotate domains to evade the classification.

Official guidance: https://support.google.com/webmasters/answer/9044101
