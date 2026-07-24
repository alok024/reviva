import { getStore } from '@/lib/store';
import { resolveIdentityFromRequest, FREE_LIMIT } from '@/lib/ratelimit';

export async function GET(req: Request) {
  try {
    const { identity, cookieHeader } = resolveIdentityFromRequest(req);
    const store = getStore();

    return Response.json(
      {
        identityId: identity.id,
        credits: store.getCredits(identity.id),
        freeUsed: store.getFreeUsed(identity.id),
        freeLimit: FREE_LIMIT,
      },
      { headers: { 'Set-Cookie': cookieHeader } }
    );
  } catch (err) {
    return Response.json({ error: (err as Error).message || 'entitlement lookup failed' }, { status: 500 });
  }
}
