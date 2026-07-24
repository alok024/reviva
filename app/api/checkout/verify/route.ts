import { finalizePurchase } from '@/lib/checkout';
import { getStore } from '@/lib/store';

// Best-effort caller identity: prefer an identity cookie, fall back to IP.
function identityHint(req: Request): { cookieId?: string; ip?: string } {
  const cookieHeader = req.headers.get('cookie') ?? '';
  const match = cookieHeader.match(/(?:^|;\s*)rv_uid=([^;]+)/);
  const forwardedFor = req.headers.get('x-forwarded-for');
  return {
    cookieId: match ? decodeURIComponent(match[1]) : undefined,
    ip: (forwardedFor ? forwardedFor.split(',')[0].trim() : req.headers.get('x-real-ip')) ?? undefined,
  };
}

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

  const identity = getStore().resolveIdentity(identityHint(req));
  const { ok, credited } = finalizePurchase(identity.id, order_id, payment_id, signature);
  return Response.json({ ok, credited });
}
