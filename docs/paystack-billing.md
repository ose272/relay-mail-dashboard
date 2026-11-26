# Paystack billing preparation

Current policy: free access. No checkout, recurring debit, paid entitlement, or subscription requirement is enabled. Paystack is the selected future provider, replacing Monnify.

Configure PAYSTACK_SECRET_KEY using Cloudflare Pages encrypted secrets, never source control, browser code, chat, or public environment variables. Start with a test-mode key. Keep live charging disabled during free access.

The future subscription implementation must verify webhook signatures against the raw body, verify transactions server-side, deduplicate events, associate customers and plans with authenticated workspace IDs, and process cancellations and renewals. Browser callbacks must never grant paid access on their own.

Plan names, prices, currencies, billing intervals, and plan-specific limits remain undecided. Existing free users must not be subscribed or charged automatically when paid plans launch.

Status: billing placeholder prepared; Paystack account connection and verified test-mode webhook integration are not yet implemented. No API credentials have been requested in chat or installed by this change.
