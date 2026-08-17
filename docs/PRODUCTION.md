# Production deployment — owner checklist

This is the exact list of external configuration and manual actions required before this
codebase can serve a real paying beta user. Everything else (auth, ownership, quota, Stripe
integration, Customer Portal, mail sending, route protection) is already implemented in code —
this document covers only what an owner must *configure or do outside the code*.

Target deployment shape: **one Next.js app + one persistent PostgreSQL/pgvector database +
an HTTPS reverse proxy**. No Kubernetes, no Redis, no queue, no separate backend/worker.

---

## A. Database

- Provision a persistent PostgreSQL 17 instance with the `pgvector` extension (the local dev
  stack uses `pgvector/pgvector:pg17` via `docker-compose.yml` — the same image works in
  production).
- Create the database and a role with full privileges on it.
- Set `DATABASE_URL` (and `POSTGRES_DB`/`POSTGRES_USER`/`POSTGRES_PASSWORD` if you keep the
  same env-var shape as `docker-compose.yml`).
- Attach a persistent volume to the database container/instance — data must survive
  redeploys.

## B. App secrets

Generate real values for every secret below. Never commit them; set them as environment
variables in your hosting platform.

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Postgres connection string |
| `BETTER_AUTH_SECRET` | Session/token signing secret. Generate with `openssl rand -base64 32`. **Required** — a fixed insecure fallback is used automatically if absent, which is safe for local dev only (see `src/lib/auth/auth.ts`). |
| `APP_BASE_URL` | The real HTTPS origin the app is served from, e.g. `https://app.example.com` |

## C. Better Auth secret / base URL

- Set `BETTER_AUTH_SECRET` (see above) and `APP_BASE_URL` to the real production origin.
  `APP_BASE_URL` is also used as the sole entry in `trustedOrigins` — auth requests from any
  other origin are rejected.
- No social login, no organizations/teams are configured — email/password only, by design.

## D. Mail provider

Password reset and email verification require a real transactional mail provider. The app
uses a minimal Resend-compatible HTTP adapter (`src/lib/mail/send.ts`).

1. Create an account with Resend (or any Resend-API-compatible provider) and verify a sending
   domain.
2. Set `MAIL_API_KEY` (the provider API key) and `MAIL_FROM` (a verified sender address, e.g.
   `Velantis <noreply@example.com>`).
3. Without these two variables, the app still builds and runs — password-reset/verification
   requests are accepted (anti-enumeration: the UI never confirms whether an account exists)
   but no email is actually sent; this is logged server-side as `[mail] not configured`, never
   presented to the user as a fake success.

## E. Stripe TEST setup

1. Create a Stripe account (or use an existing one) and switch to **TEST mode**.
2. Copy the TEST **Secret key** into `STRIPE_SECRET_KEY`.

## F. Stripe Products/Prices

1. In Stripe (TEST mode), create two Products: **BASIC** and **PLUS**, each with one
   recurring monthly Price (PLN, matching the display prices in
   `src/lib/billing/plans.ts` — 14.99 PLN and 29.99 PLN respectively; the actual Stripe Price
   amount is authoritative for billing, the app's `displayPrice` string is presentation-only
   and must be kept in sync manually if you change the Stripe price).
3. Copy the two Price IDs into `STRIPE_PRICE_BASIC` and `STRIPE_PRICE_PLUS`.

## G. Webhook registration

1. In the Stripe Dashboard (TEST mode) → Developers → Webhooks, add an endpoint pointing to:
   `https://<APP_BASE_URL>/api/auth/stripe/webhook`
   (this path is registered automatically by the `@better-auth/stripe` plugin under the
   existing Better Auth route handler — there is no separate webhook route to deploy).
2. Subscribe to at least: `checkout.session.completed`, `customer.subscription.created`,
   `customer.subscription.updated`, `customer.subscription.deleted`,
   `invoice.payment_failed`.
3. Copy the endpoint's **Signing secret** into `STRIPE_WEBHOOK_SECRET`. Signature
   verification is handled entirely by the Stripe plugin — an invalid/missing signature is
   rejected before any state changes.
4. For local testing without a public URL, use the Stripe CLI: `stripe listen --forward-to
   localhost:3000/api/auth/stripe/webhook`.

## H. Customer Portal setup

In the Stripe Dashboard (TEST mode) → Settings → Billing → Customer portal, enable the
portal and configure at minimum: allow subscription cancellation, allow payment method
update. The app opens this portal via a real server action
(`src/lib/billing/actions.ts#createBillingPortalSession`) — no separate portal config is
needed in code.

## I. Migrations

```
pnpm db:generate   # only when you've changed src/db/schema.ts
pnpm db:migrate     # applies pending migrations to DATABASE_URL
```

Migrations are plain, reviewable SQL files under `drizzle/`. Run `pnpm db:migrate` as an
explicit deploy step (before starting the new app version) — never auto-migrate on app boot.

## J. Build/start

```
pnpm install --frozen-lockfile
pnpm build
pnpm start          # or: docker build -t velantis . && docker run -p 3000:3000 --env-file .env velantis
```

The provided `Dockerfile` is a multi-stage build producing a Next.js `standalone` output,
running as a non-root user (`nextjs`), exposing port 3000.

## K. HTTPS / domain

Terminate HTTPS at a reverse proxy (e.g. Caddy, nginx, or your hosting platform's built-in
TLS) in front of the Next.js container. Point `APP_BASE_URL` at the final HTTPS origin —
Better Auth's cookies are `Secure`-flagged in production (`NODE_ENV=production`), so they
will not be sent over plain HTTP.

## L. Backup

- Back up the PostgreSQL volume/database on a regular schedule (e.g. `pg_dump` to
  off-instance storage, or your managed Postgres provider's built-in backup feature).
- Restore procedure: provision a fresh Postgres instance, restore the dump
  (`pg_restore`/`psql < backup.sql`), point `DATABASE_URL` at it, redeploy the app — no
  application-level migration step is needed for a restore of an already-migrated backup.
- Stripe and mail-provider state (customers, subscriptions, sent emails) live in those
  external systems, not in this database — a database restore does not need to "replay"
  Stripe state, since the webhook-backed `subscription` table is resynchronized by Stripe's
  own event history on the next relevant event, and `auth.api.listActiveSubscriptions` always
  reflects Stripe's live state, not just the local cache.

## M. TEST MODE end-to-end verification

Before inviting a real beta user, manually verify (see also `Local E2E / smoke` in the
milestone's final report):

1. Register a real test account, verify login/logout.
2. Confirm `/explorer` is inaccessible when logged out (redirects to `/login`).
3. Run one Explorer query, confirm quota decreases by 1 on Account.
4. From `/explorer/plan`, start BASIC Checkout with a Stripe TEST card
   (`4242 4242 4242 4242`, any future expiry, any CVC).
5. Confirm the webhook fires (Stripe Dashboard → Webhooks → recent deliveries, or `stripe
   listen` output) and the Account page shows BASIC with the new limit (40).
6. Open the Customer Portal from Account, confirm it shows the real TEST subscription.
7. Cancel the subscription via the Portal, confirm entitlement falls back to FREE once the
   webhook is processed.

## N. Switch to Stripe LIVE only after explicit owner decision

This milestone deliberately uses **TEST mode only**. Do not switch `STRIPE_SECRET_KEY`,
`STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_BASIC`, `STRIPE_PRICE_PLUS` to LIVE-mode values until
the owner has explicitly decided to accept real payments — LIVE Stripe credentials were never
used or requested during this milestone's implementation.

---

## Legal copy

The content on `/terms`, `/privacy`, `/legal` is a concise DRAFT written for this milestone
(see `LEGAL_COPY_REQUIRES_OWNER_REVIEW` in `src/lib/legal-shell/config.ts`) — it has **not**
been reviewed or approved by a lawyer or the business owner. Review it before real users rely
on it. Set `COMPANY_NAME` and `CONTACT_EMAIL` to real values (never invented ones) before
launch — real company registration/VAT/address data must be supplied by the owner, not
fabricated.
