import { finalizePurchase } from '@/lib/checkout';
import { resolveIdentityFromRequest } from '@/lib/ratelimit';

export async function POST(req: Request) {
  let body: { order_id?: unknown; payment_id?: unknown; signature?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { order_id, payment_id, signature } = body;
  if (typeof order_id !== 'string' || typeof payment_id !== 'string' || typeof signature !== 'string') {
    return Response.json({ error: 'order_id, payment_id, signature are required' }, { status: 400 });
  }

  const { identity, cookieHeader } = resolveIdentityFromRequest(req);
  const { ok, credited } = finalizePurchase(identity.id, order_id, payment_id, signature);
  return Response.json({ ok, credited }, { headers: { 'Set-Cookie': cookieHeader } });
}
