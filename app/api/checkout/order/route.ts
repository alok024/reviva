import { createCheckoutOrder } from '@/lib/checkout';
import { resolveIdentityFromRequest } from '@/lib/ratelimit';

export async function POST(req: Request) {
  let body: { planId?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const planId = body.planId;
  if (typeof planId !== 'string') {
    return Response.json({ error: 'planId is required' }, { status: 400 });
  }

  const { identity, cookieHeader } = resolveIdentityFromRequest(req);
  const headers = { 'Set-Cookie': cookieHeader };

  try {
    const result = await createCheckoutOrder(planId, identity.id);
    return Response.json(result, { headers });
  } catch (err) {
    console.error('checkout/order failed:', err);
    return Response.json({ error: 'Unable to create order' }, { status: 400, headers });
  }
}
