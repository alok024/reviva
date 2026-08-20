
import crypto from 'crypto';

const KEY_ID = process.env.RAZORPAY_KEY_ID || process.env.RAZORPAY_TEST_KEY_ID || '';
const KEY_SECRET = process.env.RAZORPAY_KEY_SECRET || process.env.RAZORPAY_TEST_KEY_SECRET || '';
const WEBHOOK_SECRET = process.env.RAZORPAY_WEBHOOK_SECRET || '';

export const RAZORPAY_MOCK = !KEY_ID || !KEY_SECRET;

export interface CreatedOrder {
  order_id: string;
  amount: number;
  currency: string;
  key: string;
  mock: boolean;
}

export async function createOrder(
  amount: number,
  currency: string,
  notes: Record<string, string>,
): Promise<CreatedOrder> {
  if (RAZORPAY_MOCK) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('Razorpay is not configured: set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET');
    }
    const id = 'order_mock_' + crypto.randomBytes(8).toString('hex');
    return { order_id: id, amount, currency, key: 'rzp_test_mock', mock: true };
  }

  const Razorpay = ((await import('razorpay')) as any).default;
  const rzp = new Razorpay({ key_id: KEY_ID, key_secret: KEY_SECRET });
  const order = await rzp.orders.create({ amount, currency, notes });
  return { order_id: order.id, amount: Number(order.amount), currency: order.currency, key: KEY_ID, mock: false };
}

function hexEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'hex');
  const bufB = Buffer.from(b, 'hex');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

export function verifyPaymentSignature(orderId: string, paymentId: string, signature: string): boolean {
  if (RAZORPAY_MOCK) {
    if (process.env.NODE_ENV === 'production') return false;
    return signature === mockSignature(orderId, paymentId);
  }
  const expected = crypto.createHmac('sha256', KEY_SECRET).update(`${orderId}|${paymentId}`).digest('hex');
  return hexEqual(expected, signature);
}

export function verifyWebhookSignature(rawBody: Buffer | string, signature: string): boolean {
  if (RAZORPAY_MOCK) return process.env.NODE_ENV !== 'production';
  if (!WEBHOOK_SECRET) return false;
  const expected = crypto.createHmac('sha256', WEBHOOK_SECRET).update(rawBody).digest('hex');
  return hexEqual(expected, signature);
}

export function mockSignature(orderId: string, paymentId: string): string {
  return crypto.createHmac('sha256', 'mock_secret').update(`${orderId}|${paymentId}`).digest('hex');
}
