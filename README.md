# Reviva

[![CI](https://github.com/alok024/reviva/actions/workflows/ci.yml/badge.svg)](https://github.com/alok024/reviva/actions/workflows/ci.yml) [![Deploy](https://github.com/alok024/reviva/actions/workflows/deploy.yml/badge.svg)](https://github.com/alok024/reviva/actions/workflows/deploy.yml)

Memorial and legacy photo restoration. Reviva takes a faded, torn, or black-and-white
photograph of someone who has passed - or a whole heirloom album - and runs it through
three passes (face restore, upscale, colorize) to bring it back, with a human checking
the result before it's called done.

## Our guarantee

A real person checks every restored face against the original photo before delivery.
If the likeness is not right, we redo it for free or refund you in full.

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
     watermarked version of the result (`lib/watermark.ts`) and `resultId` is a durable key
     for the full-resolution image (`lib/imagestore`).
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

Prices above are for customers in India. Outside India, checkout is handled by a Merchant
of Record and billed in the customer's local currency.

New visitors get a couple of free, watermarked previews (`FREE_LIMIT` in
`lib/ratelimit.ts`), unlocked with just an email or WhatsApp number - no payment required
for those. The pricing section is for additional restorations or a whole album at once.

Checkout flow (identical mock/real branches, both kept in the code):

1. Client `POST /api/checkout/order { planId }` -> `createCheckoutOrder` looks up the plan,
   calls `createOrder(amount, currency, { planId })`, and records the pending order's
   `{ planId, amount }` server-side so verification never has to trust a client-supplied
   amount.
2. **Mock mode** (no keys): the order response also carries a precomputed `mock_payment`
   (`payment_id` + `signature`), so the browser completes without opening a real modal and
   shows a "Test mode - no real charge" note.
3. **Real mode** (keys present): the browser loads `checkout.razorpay.com/v1/checkout.js`,
   opens the Razorpay modal, and takes `payment_id` + `razorpay_signature` from the handler.
4. Client `POST /api/checkout/verify { order_id, payment_id, signature }` ->
   `finalizePurchase`, which checks the signature, reconstructs the purchase intent from the
   order recorded in step 1 (never a client-supplied amount), confirms the stored amount
   equals the plan's price, and grants credits exactly once per `(order_id, payment_id)`
   pair. The UI reads the granted `credited` count off the response and re-fetches
   `/api/entitlement` rather than incrementing a local counter.

Razorpay fails closed: with no live keys, a production deploy (`NODE_ENV=production`)
refuses to hand out mock orders instead of silently accepting unpaid "purchases".

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
- `RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET` - enable real checkout. Optionally
  `RAZORPAY_WEBHOOK_SECRET` for webhook verification.

Without these, both subsystems stay in mock mode and the app still builds and runs. The
in-memory store (`lib/store`) and image store (`lib/imagestore`) are also the local-only
defaults - durable Supabase/Upstash- and R2-backed drop-ins exist as stubs
(`lib/store/supabase-adapter.ts`, `lib/imagestore/r2-adapter.ts`) behind the same interface
for when this needs to survive a restart or run more than one instance.

## Project layout

```
app/page.tsx                     landing + tool (client)
app/api/entitlement/route.ts     GET -> { credits, freeUsed, freeLimit } for the caller
app/api/restore/route.ts         POST { image, steps } -> job (paid) or watermarked preview (free)
app/api/restore/status/route.ts  GET ?id= -> job status/result for the async paid path
app/api/unlock/route.ts          POST { resultId, email|whatsapp } -> full-resolution image
app/api/checkout/order/route.ts  POST { planId } -> order (+ mock_payment locally)
app/api/checkout/verify/route.ts POST { order_id, payment_id, signature } -> { ok, credited }
lib/restore.ts                   chains face -> upscale -> colorize via Replicate
lib/replicate.ts                 Replicate runner (model-scoped endpoint, keyless mock fallback)
lib/jobs.ts                      async job table backing the paid restore path
lib/watermark.ts                 deterministic preview watermarking for the free path
lib/imagesafe.ts                 EXIF/GPS strip + max-dimension check before a real restore
lib/imagestore/                  durable image storage interface (in-memory default + R2 stub)
lib/store/                       store interface: identity, credits, free-tier, leads (in-memory default + Supabase stub)
lib/ratelimit.ts                 identity resolution, rate limit, daily spend circuit breaker
lib/checkout.ts                  plans + create/confirm/finalize checkout
lib/razorpay.ts                  Razorpay orders + signature verification (mock-aware, fails closed)
scripts/smoke.ts                 end-to-end check
```
