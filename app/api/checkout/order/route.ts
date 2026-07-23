import { createCheckoutOrder } from '@/lib/checkout';

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

  try {
    const result = await createCheckoutOrder(planId);
    return Response.json(result);
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 400 });
  }
}
