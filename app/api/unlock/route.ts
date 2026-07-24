import { getStore } from '@/lib/store';
import { getImageStore } from '@/lib/imagestore';
import { resolveIdentityFromRequest } from '@/lib/ratelimit';

export async function POST(req: Request) {
  try {
    const { identity, cookieHeader } = resolveIdentityFromRequest(req);
    const headers = { 'Set-Cookie': cookieHeader };

    let body: { resultId?: unknown; email?: unknown; whatsapp?: unknown };
    try {
      body = await req.json();
    } catch {
      return Response.json({ error: 'Invalid JSON body' }, { status: 400, headers });
    }

    const resultId = body.resultId;
    if (typeof resultId !== 'string' || !resultId) {
      return Response.json({ error: 'resultId is required' }, { status: 400, headers });
    }

    // Ownership is server-authoritative and checked before any image access, so a non-owner
    // gets the same 403 whether or not resultId exists (no existence oracle).
    if (!getStore().ownsResult(resultId, identity.id)) {
      return Response.json({ error: 'forbidden' }, { status: 403, headers });
    }

    const email = typeof body.email === 'string' ? body.email : undefined;
    const whatsapp = typeof body.whatsapp === 'string' ? body.whatsapp : undefined;
    if (!email && !whatsapp) {
      return Response.json({ error: 'email or whatsapp is required' }, { status: 400, headers });
    }

    const full = await getImageStore().get(resultId);
    if (!full) {
      return Response.json({ error: 'result not found or expired' }, { status: 404, headers });
    }

    getStore().recordLead(identity.id, { email, whatsapp });

    return Response.json({ resultId, image: full }, { headers });
  } catch (err) {
    return Response.json({ error: (err as Error).message || 'unlock failed' }, { status: 500 });
  }
}
