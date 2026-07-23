import { restorePhoto } from '../lib/restore';
import { createCheckoutOrder, confirmPurchase } from '../lib/checkout';

// 1x1 PNG data URL used as the source photo.
const TINY_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error('ASSERT FAILED: ' + msg);
}

async function main() {
  const r = await restorePhoto({ image: TINY_PNG, steps: { face: true, upscale: true, colorize: true } });
  assert(typeof r.after === 'string' && r.after.length > 0, 'after should be a non-empty string');
  assert(r.steps.length === 3, 'expected 3 steps');
  assert(r.steps.every((s) => s.status === 'done'), 'every step should be done');
  assert(r.mock === true, 'mock should be true with no REPLICATE_API_TOKEN');

  const order = await createCheckoutOrder('pack20');
  assert(order.mock === true, 'order should be mock with no Razorpay keys');
  assert('mock_payment' in order && order.mock_payment, 'mock order should include mock_payment');
  const ok = confirmPurchase(order.order_id, order.mock_payment!.payment_id, order.mock_payment!.signature);
  assert(ok === true, 'mock checkout should verify');

  console.log('SMOKE-OK');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
