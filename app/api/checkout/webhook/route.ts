import { verifyWebhookSignature } from '@/lib/razorpay';
import { finalizePurchaseFromWebhook } from '@/lib/checkout';

interface RazorpayWebhookEvent {
  event?: unknown;
  payload?: {
    payment?: {
      entity?: {
        id?: unknown;
        order_id?: unknown;
        amount?: unknown;
      };
    };
  };
}

export async function POST(req: Request) {
  const rawBody = await req.text();
  const signature = req.headers.get('x-razorpay-signature') || '';

  if (!verifyWebhookSignature(rawBody, signature)) {
    return Response.json({ error: 'invalid webhook signature' }, { status: 400 });
  }

  let event: RazorpayWebhookEvent;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return Response.json({ error: 'invalid JSON body' }, { status: 400 });
  }

  if (event.event !== 'payment.captured') {
    return Response.json({ ok: true, skipped: typeof event.event === 'string' ? event.event : 'unknown' });
  }

  const payment = event.payload?.payment?.entity;
  const orderId = payment?.order_id;
  const paymentId = payment?.id;
  const amount = payment?.amount;
  if (typeof orderId !== 'string' || typeof paymentId !== 'string' || typeof amount !== 'number') {
    return Response.json({ error: 'payment.captured event missing order_id, payment id, or amount' }, { status: 400 });
  }

  const { ok, credited } = finalizePurchaseFromWebhook(orderId, paymentId, amount);
  if (!ok) {
    console.error('checkout/webhook: payment.captured could not be credited', { orderId, paymentId });
  }
  return Response.json({ ok, credited });
}
