# Sendar original-design candidate

The uploaded `src/App.tsx` and `src/index.css` are now restored byte-for-byte.
The custom dashboard shell is no longer rendered. `/sendar/design` directly
previews the original, explicitly labelled demo without mailbox API calls.
Desktop and Mobile controls live outside the uploaded interface. The preview
defaults to a 1440px desktop iframe, with a 390px mobile option and a responsive
option; narrow browser panes can therefore show either original layout. Only
the public design route allows same-origin framing. Private and sign-in pages
remain protected against framing.
Its original sample data and browser-local actions are design-only. The existing
production dashboard remains available while this exact design is connected.
The account pages were not in the ZIP and remain a separate implementation.

The following notes describe the prior integration candidate, retained in Git
for the next wiring step; they do not claim the restored prototype is live mail.

Separate release candidate for the supplied Sendar SaaS Workspace design and logo.
The interface uses the existing authenticated backend; prototype campaigns,
people, simulated replies, billing and browser-local business records are not
used. Existing mailbox, campaign, import, notification and quota workflows were
carried forward into this separate source directory.

Install with `npm ci` in this directory. Run `npm run build` and
`npm run typecheck`. From the repository root, `npm run sendar:build` stages the
candidate at `/sendar/` together with the existing site and Google verification
file. It does not replace the existing dashboard.

Candidate routes:

- `/sendar/`: existing administrator workspace; requires the owner session.
- `/sendar/signin?access=administrator`: owner sign-in using the existing owner
  password endpoint. This is not a Google password form.
- `/sendar/signup`, `/sendar/signin`, `/sendar/welcome`: isolated customer
  account creation, sign-in and setup profile using the account APIs.
- `/sendar/about`: independent-service and account-safety information.

Customer sessions do not authorize administrator mail APIs. Customer mailbox
access, Google OAuth and billing remain separate backend work; the candidate
shows their actual setup state instead of pretending they are connected.
OAuth client secrets must stay in server-side secret storage, never this bundle.

The original frontend remains available while the new interface and OAuth
connection are tested. Cutover and removal of the old frontend happen after
those checks. Google security review has not been requested.
