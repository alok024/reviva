import { restorePhoto, startRestoreJob, getRestoreJob } from '../lib/restore';
import { PLANS, createCheckoutOrder, confirmPurchase, finalizePurchase } from '../lib/checkout';
import { getStore } from '../lib/store';
import type { PurchaseRecord } from '../lib/store';
import { RAZORPAY_MOCK, verifyWebhookSignature } from '../lib/razorpay';
import { getImageStore } from '../lib/imagestore';
import { POST as restorePOST } from '../app/api/restore/route';
import { POST as unlockPOST } from '../app/api/unlock/route';

// 1x1 PNG data URL used as the source photo.
const TINY_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error('ASSERT FAILED: ' + msg);
}

// startRestoreJob returns before the work finishes, so poll like a real client would.
async function waitForJob(id: string, timeoutMs = 2000) {
  const start = Date.now();
  for (;;) {
    const job = getRestoreJob(id);
    assert(job !== null, 'getRestoreJob should find a job that was just started');
    if (job.status === 'succeeded' || job.status === 'failed') return job;
    assert(Date.now() - start < timeoutMs, 'mock restore job did not settle in time');
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

async function main() {
  const r = await restorePhoto({ image: TINY_PNG, steps: { face: true, upscale: true, colorize: true } });
  assert(r.after === TINY_PNG, 'mock restore should echo the original image as after');
  assert(r.steps.length === 3, 'expected 3 steps');
  assert(r.steps.every((s) => s.status === 'done'), 'every step should be done');
  assert(r.mock === true, 'mock should be true with no REPLICATE_API_TOKEN');

  const order = await createCheckoutOrder('single');
  assert(order.mock === true, 'order should be mock with no Razorpay keys');
  assert('mock_payment' in order && order.mock_payment, 'mock order should include mock_payment');
  const ok = confirmPurchase(order.order_id, order.mock_payment!.payment_id, order.mock_payment!.signature);
  assert(ok === true, 'mock checkout should verify');

  // plans: subscription is gone, only one-time per-project plans remain
  assert(!('unlimited_month' in PLANS), 'unlimited_month subscription plan should be removed');
  assert(Object.keys(PLANS).sort().join(',') === 'album,single', 'only single and album plans should remain');
  assert(
    Object.values(PLANS).every((p) => p.kind === 'one-time' && p.currency === 'INR'),
    'every remaining plan should be one-time INR'
  );

  // createCheckoutOrder must record server-side intent, not trust a client-supplied amount later
  const store = getStore();
  const pending = store.getPendingOrder(order.order_id);
  assert(pending !== null, 'createCheckoutOrder should record a pending order');
  assert(pending!.planId === 'single', 'pending order should carry the requested plan id');
  assert(pending!.amount === PLANS.single.amount, 'pending order amount should match the plan amount');

  // finalizePurchase grants credits once from the stored intent, replay is inert
  const buyer = store.resolveIdentity({ cookieId: 'smoke-finalize' });
  const creditsBefore = store.getCredits(buyer.id);
  const finalized = finalizePurchase(buyer.id, order.order_id, order.mock_payment!.payment_id, order.mock_payment!.signature);
  assert(finalized.ok === true, 'finalizePurchase should succeed for a fresh order/payment pair');
  assert(finalized.credited === PLANS.single.credits, 'finalizePurchase should credit the plan amount');
  assert(store.getCredits(buyer.id) === creditsBefore + PLANS.single.credits, 'credits should land in the store');
  const replay = finalizePurchase(buyer.id, order.order_id, order.mock_payment!.payment_id, order.mock_payment!.signature);
  assert(replay.ok === false && replay.credited === 0, 'a replayed order/payment pair should not credit again');
  assert(store.getCredits(buyer.id) === creditsBefore + PLANS.single.credits, 'replay should not change the balance');

  // store ledger: consumeCredit never goes negative
  const ledger = store.resolveIdentity({ cookieId: 'smoke-ledger' });
  assert(store.getCredits(ledger.id) === 0, 'a fresh identity should start with zero credits');
  assert(store.consumeCredit(ledger.id) === false, 'consumeCredit should fail when the balance is already zero');
  const granted = store.grantCredits(ledger.id, 2);
  assert(granted === 2, 'grantCredits should return the new balance');
  assert(store.consumeCredit(ledger.id) === true, 'consumeCredit should succeed while credits remain');
  assert(store.consumeCredit(ledger.id) === true, 'consumeCredit should succeed while credits remain');
  assert(store.consumeCredit(ledger.id) === false, 'consumeCredit should fail once credits are exhausted');
  assert(store.getCredits(ledger.id) === 0, 'balance should never go below zero');

  // store: recordPurchase is single-use per (orderId, paymentId)
  const purchaseRecord: PurchaseRecord = {
    orderId: 'smoke-order-single-use',
    paymentId: 'smoke-payment-single-use',
    planId: 'single',
    amount: PLANS.single.amount,
    identityId: ledger.id,
    createdAt: Date.now(),
  };
  assert(store.recordPurchase(purchaseRecord) === true, 'recordPurchase should succeed the first time');
  assert(store.recordPurchase(purchaseRecord) === false, 'recordPurchase should reject a replayed order/payment pair');

  // restore engine: async job + poll path resolves to the same shape as the sync mock
  const jobId = startRestoreJob({ image: TINY_PNG, steps: { upscale: true } });
  assert(typeof jobId === 'string' && jobId.length > 0, 'startRestoreJob should return a job id');
  const job = await waitForJob(jobId);
  assert(job.status === 'succeeded', 'mock restore job should succeed');
  assert(!!job.result, 'succeeded job should carry a result');
  assert(job.result!.mock === true, 'job result should be mock in keyless mode');
  assert(job.result!.after === TINY_PNG, 'job result should echo the original image in mock mode');

  // razorpay: keyless mode is explicit mock, webhook verification is permissive only there
  assert(RAZORPAY_MOCK === true, 'RAZORPAY_MOCK should be true with no keys present');
  assert(verifyWebhookSignature('{}', 'not-a-real-signature') === true, 'webhook signature should verify in explicit keyless mock');

  // IDOR fix: a restore result is owned by the identity that created it, and only that
  // identity can unlock it. A fresh identity has 0 credits and 0 free-used, so this takes
  // the free-preview path and gets a resultId back.
  const restoreReq = new Request('http://localhost/api/restore', {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: 'reviva_id=owner-abc' },
    body: JSON.stringify({ image: TINY_PNG, steps: { upscale: true } }),
  });
  const restoreRes = await restorePOST(restoreReq);
  const restoreJson = await restoreRes.json();
  const resultId = restoreJson.resultId;
  assert(typeof resultId === 'string' && resultId.length > 0, 'restore preview response should include a resultId');

  const ownerUnlockReq = new Request('http://localhost/api/unlock', {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: 'reviva_id=owner-abc' },
    body: JSON.stringify({ resultId, email: 'owner@example.com' }),
  });
  const ownerRes = await unlockPOST(ownerUnlockReq);
  const ownerJson = await ownerRes.json();
  assert(ownerRes.status === 200, 'the owner of a resultId should be able to unlock it');
  assert('image' in ownerJson, 'a successful owner unlock should return an image field');

  const attackerUnlockReq = new Request('http://localhost/api/unlock', {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: 'reviva_id=attacker-xyz' },
    body: JSON.stringify({ resultId, email: 'attacker@example.com' }),
  });
  const attackerRes = await unlockPOST(attackerUnlockReq);
  const attackerJson = await attackerRes.json();
  assert(attackerRes.status === 403, 'a non-owner unlocking someone else\'s resultId should be rejected with 403');
  assert(!('image' in attackerJson), 'a non-owner should never receive the image, existing or not');

  // imagestore: keys must be unguessable and non-sequential, not enumerable Date.now()/seq values
  const imageStore = getImageStore();
  const imgKey1 = await imageStore.put(TINY_PNG, 'image/png');
  const imgKey2 = await imageStore.put(TINY_PNG, 'image/png');
  assert(imgKey1 !== imgKey2, 'two put() calls should yield distinct, unguessable keys');
  assert(!/-\d+$/.test(imgKey1), 'image key should be non-sequential, not a numeric-suffix counter');
  assert(!/-\d+$/.test(imgKey2), 'image key should be non-sequential, not a numeric-suffix counter');
  const UUID_KEY_RE = /^mem:\/\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  assert(UUID_KEY_RE.test(imgKey1), 'image key should look like an unguessable UUID key');
  assert(UUID_KEY_RE.test(imgKey2), 'image key should look like an unguessable UUID key');

  console.log('SMOKE-OK');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
