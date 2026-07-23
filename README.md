# Reviva

Restore and colorize old photos. Reviva takes a faded, scratched, or black-and-white
photo and runs it through three passes - face restore, upscale, and colorize - to bring
the people you love back to life.

## What it does

Upload a photo, pick which passes to run (all on by default), and download the result:

1. **Face restore** - rebuilds blurred/damaged faces (GFPGAN)
2. **Upscale and clean** - denoise, de-scratch, and enlarge (Real-ESRGAN)
3. **Colorize** - lifelike color for black-and-white photos (DDColor)

Each step's output feeds the next. Everything runs client-to-server through
`/api/restore`, which calls `lib/restore.ts`.

## Run locally (no API keys)

```bash
npm install
npm run build
npm run smoke   # end-to-end check: restore + mock checkout -> prints SMOKE-OK
```

With no `REPLICATE_API_TOKEN`, restoration runs in **mock mode**: the original image is
echoed back as the "after" and each step is marked done with a "(mock)" note, so the
before/after UI and the full flow work with zero credentials. With no Razorpay keys,
checkout runs in **mock mode** too - the order/verify/unlock loop completes locally with
no charge and no modal.

To run the dev server yourself: `npm run dev` (not run by the build tooling).

## Pricing and the Razorpay flow

Two plans (defined in `lib/checkout.ts`):

| Plan | Price | What you get |
| --- | --- | --- |
| `pack20` | $4.99 one-time | 20 photo restorations |
| `unlimited_month` | $9/mo | Unlimited restorations |

New visitors get **3 free photos**. When they run out, the pricing section's Buy buttons
start checkout.

Checkout flow (identical mock/real branches, both kept in the code):

1. Client `POST /api/checkout/order { planId }` -> `createCheckoutOrder` looks up the plan
   and calls `createOrder(amount, currency, { planId })`.
2. **Mock mode** (no keys): the order response also carries a precomputed `mock_payment`
   (`payment_id` + `signature`), so the browser completes without opening a real modal and
   shows a "Test mode - no real charge" note.
3. **Real mode** (keys present): the browser loads `checkout.razorpay.com/v1/checkout.js`,
   opens the Razorpay modal, and takes `payment_id` + `razorpay_signature` from the handler.
4. Client `POST /api/checkout/verify { order_id, payment_id, signature }` ->
   `verifyPaymentSignature`. When `ok`, the UI unlocks credits.

Because `RAZORPAY_MOCK` is true without keys, `verifyPaymentSignature` accepts exactly the
`mockSignature` the order route produced, proving the loop end-to-end locally.

## Real cost-per-use math

Per photo, all three passes on Replicate (verify current pricing at replicate.com/pricing
before launch):

- GFPGAN (face restore): ~$0.004
- Real-ESRGAN (upscale): ~$0.005
- DDColor (colorize): ~$0.006
- **Total: ~$0.015 / photo**

Effective sell price: the 20-photo pack at $4.99 is ~$0.25/photo.

- Revenue per photo: ~$0.25
- Cost per photo: ~$0.015
- **Gross margin: ~94%**

Even the free tier (3 photos, ~$0.045 of cost) is cheap customer acquisition.

## Going live (real API keys)

Set these in the environment (see `.env.example` for names):

- `REPLICATE_API_TOKEN` - enables real restoration. Production must **pin a version hash**
  for each model (`owner/model:<hash>`) so a model update can't silently change output
  quality or per-run cost. Models: `tencentarc/gfpgan`, `nightmareai/real-esrgan`,
  `piddnad/ddcolor`.
- `RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET` - enable real checkout. Optionally
  `RAZORPAY_WEBHOOK_SECRET` for webhook verification.

Without these, both subsystems stay in mock mode and the app still builds and runs.

## Project layout

```
app/page.tsx                     landing + tool (client)
app/api/restore/route.ts         POST { image, steps } -> restored result
app/api/checkout/order/route.ts  POST { planId } -> order (+ mock_payment locally)
app/api/checkout/verify/route.ts POST { order_id, payment_id, signature } -> { ok }
lib/restore.ts                   chains face -> upscale -> colorize via Replicate
lib/replicate.ts                 Replicate runner with keyless mock fallback
lib/checkout.ts                  plans + create/confirm checkout
lib/razorpay.ts                  Razorpay orders + signature verification (mock-aware)
scripts/smoke.ts                 end-to-end check
```
