# Authentication contract for the frontend redesign

Public pages are currently independent files: `public/signup.html`, `public/signin.html`, `public/welcome.html`, `public/customer-auth.css`, and `public/customer-auth.js`. They can be restyled or replaced without changing the account API.

Requests use same-origin cookies, with `credentials: 'same-origin'`. POST requests send JSON. No bearer token, password hash or session token belongs in frontend localStorage.

| Endpoint | Input | Successful result |
| --- | --- | --- |
| `GET /api/auth/config` | None | `{ registrationOpen: boolean }` |
| `POST /api/auth/signup` | `{ name, email, password }` | HTTP 201, profile plus secure session cookie |
| `POST /api/auth/signin` | `{ email, password }` | HTTP 200, profile plus secure session cookie |
| `GET /api/auth/session` | Session cookie | HTTP 200, current user's profile; HTTP 401 when signed out/expired |
| `POST /api/auth/signout` | `{}` | HTTP 200, revoked cookie/session |

The profile shape is `{ user: { id, name, email, emailVerified }, workspace: { id, name, status }, next: '/welcome' }`. A newly registered workspace has `status: 'pending_setup'`. API errors return `{ error: string }`. Display errors as text, not HTML. Prevent duplicate submissions and do not automatically retry a registration POST after a dropped response.

Existing mail endpoints, including `/api/state`, `/api/sending/status`, accounts, inbox and campaigns, remain administrator-only. Do **not** point customer dashboards at these shared endpoints. Tenant-scoped mail APIs and OAuth onboarding are required before customers can use sending/inbox features. The current welcome screen accurately shows mailbox connection and billing as unavailable during setup.

`/login` remains the existing administrator sign-in. Customer account credentials do not grant administrator access. Private application paths must stay behind middleware when adding landing pages or changing navigation.
