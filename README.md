# Reviva

[![CI](https://github.com/alok024/reviva/actions/workflows/ci.yml/badge.svg)](https://github.com/alok024/reviva/actions/workflows/ci.yml) [![Deploy](https://github.com/alok024/reviva/actions/workflows/deploy.yml/badge.svg)](https://github.com/alok024/reviva/actions/workflows/deploy.yml)

Memorial and legacy photo restoration. Reviva takes a faded, torn, or black-and-white
photograph of someone who has passed - or a whole heirloom album - and runs it through
three passes (face restore, upscale, colorize) to bring it back.

**Status: not an operating service.** This is a finished build that was never launched.
It has no customers and takes no payments. The code runs end to end in mock mode, and the
repository is public as engineering reference, not as a product you can buy.

The landing page describes a human-check-before-delivery step and a redo-or-refund policy.
Those were the intended operating policy, not implemented behaviour - there is no review
queue or refund path in this codebase, and nothing here should be read as a live commercial
promise.

## What it does

Upload a photo, pick which passes to run (all on by default), and get a result back:

1. **Face restore** - rebuilds blurred/damaged faces (GFPGAN)
2. **Upscale and clean** - denoise, de-scratch, and enlarge (Real-ESRGAN)
3. **Colorize** - lifelike color for black-and-white photos (DDColor)

Each step's output feeds the next. The client never decides what it's entitled to - every
restore request is gated server-side (see "Entitlement, free previews, and unlock" below).

## Run locally (no API keys)

```bash
npm install
npm run build
npm run smoke   # end-to-end check: restore + mock checkout -> prints SMOKE-OK
```

With no `REPLICATE_API_TOKEN`, restoration runs in **mock mode**: the original image is
echoed back as the "after" and each step is marked done with a "(mock)" note, so the
before/after UI and the full flow work with zero credentials. With no Razorpay keys,
checkout runs in **mock mode** too - the order/verify loop completes locally with no
charge and no modal.

To run the dev server yourself: `npm run dev` (not run by the build tooling).

## Entitlement, free previews, and unlock

Credits and free-preview counts are server state, tracked per visitor (a cookie-bound
identity, `lib/ratelimit.ts` + `lib/store`) - the page never treats a client number as the
source of truth.

1. `GET /api/entitlement` returns `{ credits, freeUsed, freeLimit }` for the caller. The
   landing page fetches this on load and after every restore/purchase to render the
   balance badge.
2. `POST /api/restore { image, steps }` is rate-limited and checked against a daily spend
   cap before anything runs, then branches on the caller's balance:
   - **Has paid credits**: queued as a background job - `202 { mode: 'job', jobId }`. The
     client polls `GET /api/restore/status?id=` until the job's `status` is `succeeded` or
     `failed`; a succeeded job's `result.after` is the full-resolution photo (a credit is
     only consumed once the job actually succeeds).
   - **No credits, free previews left**: runs synchronously and returns
     `200 { mode: 'preview', preview, resultId, steps, mock }`, where `preview` is a
     watermarked version of the result (`lib/watermark.ts`) and `resultId` is an unguessable
     key for the full-resolution image (`lib/imagestore`) - see "Going live" for how long
     that key actually survives.
   - **No credits, no free previews left**: `402 { error, purchaseRequired: true }` - the UI
     points the visitor at the pricing section.
3. `POST /api/unlock { resultId, email?, whatsapp? }` trades an email or WhatsApp number for
   the full-resolution image behind a preview (`{ image }`) - this is how the free tier
   captures a lead instead of just giving away an unlimited full-quality result.

## Pricing and the Razorpay flow

Two per-project plans (defined in `lib/checkout.ts`) - pay once, no subscription:

| Plan | Price (India) | What you get |
| --- | --- | --- |
| `single` | ₹599 one-time | 1 memorial photo, full restoration + human QA |
| `album` | ₹2,999 one-time | Up to 15 photos, full restoration + human QA on each |

Prices are in Indian Rupees, charged via Razorpay. Checkout currently supports India only -
there is no cross-border payment provider wired in.

New visitors get a couple of free, watermarked previews (`FREE_LIMIT` in
`lib/ratelimit.ts`), unlocked with just an email or WhatsApp number - no payment required
for those. The pricing section is for additional restorations or a whole album at once.

Checkout flow (identical mock/real branches, both kept in the code):

1. Client `POST /api/checkout/order { planId }` -> `createCheckoutOrder` looks up the plan,
   calls `createOrder(amount, currency, { planId })`, and records the pending order's
   `{ planId, amount, identityId }` server-side, keyed off the caller's identity cookie, so
   verification never has to trust a client-supplied amount and crediting never has to trust
   whichever cookie happens to call verify.
2. **Mock mode** (no keys): the order response also carries a precomputed `mock_payment`
   (`payment_id` + `signature`), so the browser completes without opening a real modal and
   shows a "Test mode - no real charge" note.
3. **Real mode** (keys present): the browser loads `checkout.razorpay.com/v1/checkout.js`,
   opens the Razorpay modal, and takes `payment_id` + `razorpay_signature` from the handler.
4. Client `POST /api/checkout/verify { order_id, payment_id, signature }` ->
   `finalizePurchase`, which checks the signature, reconstructs the purchase intent from the
   order recorded in step 1 (never a client-supplied amount or identity), confirms the
   stored amount equals the plan's price, and grants credits exactly once per
   `(order_id, payment_id)` pair to the identity that created the order. The UI reads the
   granted `credited` count off the response and re-fetches `/api/entitlement` rather than
   incrementing a local counter.
5. **Webhook (independent of the browser)**: `POST /api/checkout/webhook` verifies
   Razorpay's own HMAC signature on the raw request body (`RAZORPAY_WEBHOOK_SECRET`,
   `lib/razorpay.ts` `verifyWebhookSignature`) and, on a `payment.captured` event, credits
   the same order through the same `(order_id, payment_id)`-deduped path as step 4. This is
   what actually closes the purchase if the buyer's tab closes or the network drops between
   Razorpay's checkout modal and the browser's own call to `/api/checkout/verify` - Razorpay
   fires this webhook from its own servers regardless of what the browser does. Point a
   Razorpay webhook at this URL for the `payment.captured` event and set
   `RAZORPAY_WEBHOOK_SECRET` to the secret Razorpay gives you for it.

Razorpay fails closed: with no live keys, a production deploy (`NODE_ENV=production`)
refuses to hand out mock orders instead of silently accepting unpaid "purchases". The
webhook route fails closed the same way - with `RAZORPAY_WEBHOOK_SECRET` unset in
production, every webhook call is rejected rather than accepted unverified.

## Real cost-per-use math

Per photo, all three passes on Replicate (verify current pricing at replicate.com/pricing
before launch):

- GFPGAN (face restore): ~$0.004
- Real-ESRGAN (upscale): ~$0.005
- DDColor (colorize): ~$0.006
- **Total: ~$0.015 / photo in Replicate compute** - this does not include the time for the
  human QA pass every photo also gets before delivery; price that separately once you know
  your own reviewer rate.

At ₹599 for a single photo or ₹2,999 for an album of up to 15, compute cost is a small
fraction of the price either way - the price is mostly paying for the human check, not GPU
time. The free tier (a couple of previews per visitor) costs a few cents of compute if a
visitor unlocks every one; treat it as paid customer acquisition, not a giveaway.

## Going live (real API keys)

Set these in the environment (see `.env.example` for names):

- `REPLICATE_API_TOKEN` - enables real restoration. The app calls each model's own
  model-scoped predictions endpoint (`/v1/models/{owner}/{model}/predictions`), not the
  generic `/v1/predictions` one, and needs a pinned version id per model from its own
  Replicate page: `REPLICATE_GFPGAN_VERSION`, `REPLICATE_REAL_ESRGAN_VERSION`,
  `REPLICATE_DDCOLOR_VERSION`. No version is hardcoded - without one set, that model's step
  fails loudly instead of silently running an unpinned/wrong version.
- `RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET` - enable real checkout.
- `RAZORPAY_WEBHOOK_SECRET` - required for `/api/checkout/webhook` (see "Pricing and the
  Razorpay flow" above) to accept anything in production; without it the route rejects
  every request rather than trusting an unverified body.

Without these, both subsystems stay in mock mode and the app still builds and runs.

The in-memory store (`lib/store/index.ts`) and image store (`lib/imagestore/index.ts`) are
the only storage this app actually runs on - both live in process memory and are wiped on
every restart, and neither is shared across more than one instance. `lib/store/supabase-adapter.ts`
and `lib/imagestore/r2-adapter.ts` are **not working alternatives** - every method on them
throws immediately. They exist only as a typed starting point: same `Store` / `ImageStore`
interface as the in-memory default, function bodies still to write. Building them out (and
switching `getStore()` / `getImageStore()` to return them) is the real prerequisite for this
app surviving a restart or running more than one instance - not a config flip. The env vars
below are what those unfinished adapters read once someone does write that code; setting
them today does nothing.
  - `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`
  - `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, `R2_PUBLIC_BASE_URL`

## Project layout

```
app/page.tsx                       landing + tool (client)
app/api/entitlement/route.ts       GET -> { credits, freeUsed, freeLimit } for the caller
app/api/restore/route.ts           POST { image, steps } -> job (paid) or watermarked preview (free)
app/api/restore/status/route.ts    GET ?id= -> job status/result for the async paid path
app/api/unlock/route.ts            POST { resultId, email|whatsapp } -> full-resolution image
app/api/checkout/order/route.ts    POST { planId } -> order (+ mock_payment locally)
app/api/checkout/verify/route.ts   POST { order_id, payment_id, signature } -> { ok, credited }
app/api/checkout/webhook/route.ts  Razorpay payment.captured webhook -> { ok, credited }, independent of the browser
lib/restore.ts                     chains face -> upscale -> colorize via Replicate
lib/replicate.ts                   Replicate runner (model-scoped endpoint, keyless mock fallback)
lib/jobs.ts                        async job table backing the paid restore path
lib/watermark.ts                   deterministic preview watermarking for the free path
lib/imagesafe.ts                   EXIF/GPS strip + max-dimension check before a real restore
lib/imagestore/                    image storage interface (in-memory default; R2 adapter is a throw-stub)
lib/store/                         store interface: identity, credits, free-tier, leads, pending orders (in-memory default; Supabase adapter is a throw-stub)
lib/ratelimit.ts                   identity resolution, rate limit, daily spend circuit breaker
lib/checkout.ts                    plans + create/confirm/finalize checkout (client and webhook paths)
lib/razorpay.ts                    Razorpay orders + payment/webhook signature verification (mock-aware, fails closed)
scripts/smoke.ts                   end-to-end check
```
