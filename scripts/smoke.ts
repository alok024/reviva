import { restorePhoto, startRestoreJob, getRestoreJob } from '../lib/restore';
import { PLANS, createCheckoutOrder, confirmPurchase, finalizePurchase } from '../lib/checkout';
import { getStore } from '../lib/store';
import type { PurchaseRecord } from '../lib/store';
import { RAZORPAY_MOCK, verifyWebhookSignature } from '../lib/razorpay';
import { getImageStore } from '../lib/imagestore';
import { POST as restorePOST } from '../app/api/restore/route';
import { POST as unlockPOST } from '../app/api/unlock/route';
import { POST as webhookPOST } from '../app/api/checkout/webhook/route';

const TINY_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error('ASSERT FAILED: ' + msg);
}

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

  const store = getStore();
  const buyer = store.resolveIdentity({ cookieId: 'smoke-finalize' });
  const order = await createCheckoutOrder('single', buyer.id);
  assert(order.mock === true, 'order should be mock with no Razorpay keys');
  assert('mock_payment' in order && order.mock_payment, 'mock order should include mock_payment');
  const ok = confirmPurchase(order.order_id, order.mock_payment!.payment_id, order.mock_payment!.signature);
  assert(ok === true, 'mock checkout should verify');

  assert(!('unlimited_month' in PLANS), 'unlimited_month subscription plan should be removed');
  assert(Object.keys(PLANS).sort().join(',') === 'album,single', 'only single and album plans should remain');
  assert(
    Object.values(PLANS).every((p) => p.kind === 'one-time' && p.currency === 'INR'),
    'every remaining plan should be one-time INR'
  );

  const pending = store.getPendingOrder(order.order_id);
  assert(pending !== null, 'createCheckoutOrder should record a pending order');
  assert(pending!.planId === 'single', 'pending order should carry the requested plan id');
  assert(pending!.amount === PLANS.single.amount, 'pending order amount should match the plan amount');
  assert(pending!.identityId === buyer.id, 'pending order should carry the identity that created it');

  const creditsBefore = store.getCredits(buyer.id);
  const finalized = finalizePurchase(order.order_id, order.mock_payment!.payment_id, order.mock_payment!.signature);
  assert(finalized.ok === true, 'finalizePurchase should succeed for a fresh order/payment pair');
  assert(finalized.credited === PLANS.single.credits, 'finalizePurchase should credit the plan amount');
  assert(store.getCredits(buyer.id) === creditsBefore + PLANS.single.credits, 'credits should land on the identity that created the order');
  const replay = finalizePurchase(order.order_id, order.mock_payment!.payment_id, order.mock_payment!.signature);
  assert(replay.ok === false && replay.credited === 0, 'a replayed order/payment pair should not credit again');
  assert(store.getCredits(buyer.id) === creditsBefore + PLANS.single.credits, 'replay should not change the balance');

  const webhookBuyer = store.resolveIdentity({ cookieId: 'smoke-webhook' });
  const webhookOrder = await createCheckoutOrder('single', webhookBuyer.id);
  const capturedEvent = (orderId: string, paymentId: string, amount: number) =>
    JSON.stringify({
      event: 'payment.captured',
      payload: { payment: { entity: { id: paymentId, order_id: orderId, amount } } },
    });
  const postWebhook = (body: string) =>
    webhookPOST(
      new Request('http://localhost/api/checkout/webhook', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-razorpay-signature': 'mock-sig' },
        body,
      })
    );

  const webhookRes = await postWebhook(capturedEvent(webhookOrder.order_id, 'pay_webhook_test', PLANS.single.amount));
  const webhookJson = await webhookRes.json();
  assert(webhookJson.ok === true, 'webhook should credit a fresh payment.captured event');
  assert(webhookJson.credited === PLANS.single.credits, 'webhook should credit the plan amount');
  assert(
    store.getCredits(webhookBuyer.id) === PLANS.single.credits,
    'webhook credit should land on the identity that created the order, independent of any browser session'
  );

  const webhookReplayRes = await postWebhook(capturedEvent(webhookOrder.order_id, 'pay_webhook_test', PLANS.single.amount));
  const webhookReplayJson = await webhookReplayRes.json();
  assert(webhookReplayJson.ok === false && webhookReplayJson.credited === 0, 'a replayed webhook delivery should not credit twice');
  assert(store.getCredits(webhookBuyer.id) === PLANS.single.credits, 'replayed webhook should not change the balance');

  const skippedRes = await postWebhook(JSON.stringify({ event: 'payment.failed' }));
  const skippedJson = await skippedRes.json();
  assert(skippedRes.status === 200 && skippedJson.ok === true, 'a non-payment.captured event should be acknowledged, not treated as an error');
  assert(skippedJson.skipped === 'payment.failed', 'a skipped event should report which event it was');

  const malformedRes = await postWebhook(JSON.stringify({ event: 'payment.captured', payload: {} }));
  assert(malformedRes.status === 400, 'a payment.captured event missing payment fields should be rejected');

  const amountBuyer = store.resolveIdentity({ cookieId: 'smoke-webhook-amount' });
  const amountOrder = await createCheckoutOrder('single', amountBuyer.id);
  const badAmountRes = await postWebhook(capturedEvent(amountOrder.order_id, 'pay_bad_amount', 1));
  const badAmountJson = await badAmountRes.json();
  assert(badAmountJson.ok === false, 'a captured amount that does not match the order must not be credited');
  assert(store.getCredits(amountBuyer.id) === 0, 'a mismatched-amount webhook must not grant credits');

  const ledger = store.resolveIdentity({ cookieId: 'smoke-ledger' });
  assert(store.getCredits(ledger.id) === 0, 'a fresh identity should start with zero credits');
  assert(store.consumeCredit(ledger.id) === false, 'consumeCredit should fail when the balance is already zero');
  const granted = store.grantCredits(ledger.id, 2);
  assert(granted === 2, 'grantCredits should return the new balance');
  assert(store.consumeCredit(ledger.id) === true, 'consumeCredit should succeed while credits remain');
  assert(store.consumeCredit(ledger.id) === true, 'consumeCredit should succeed while credits remain');
  assert(store.consumeCredit(ledger.id) === false, 'consumeCredit should fail once credits are exhausted');
  assert(store.getCredits(ledger.id) === 0, 'balance should never go below zero');

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

  const jobId = startRestoreJob({ image: TINY_PNG, steps: { upscale: true } });
  assert(typeof jobId === 'string' && jobId.length > 0, 'startRestoreJob should return a job id');
  const job = await waitForJob(jobId);
  assert(job.status === 'succeeded', 'mock restore job should succeed');
  assert(!!job.result, 'succeeded job should carry a result');
  assert(job.result!.mock === true, 'job result should be mock in keyless mode');
  assert(job.result!.after === TINY_PNG, 'job result should echo the original image in mock mode');

  assert(RAZORPAY_MOCK === true, 'RAZORPAY_MOCK should be true with no keys present');
  assert(verifyWebhookSignature('{}', 'not-a-real-signature') === true, 'webhook signature should verify in explicit keyless mock');

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
