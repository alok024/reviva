import { getStore } from '@/lib/store';
import { startRestoreJob, restorePhoto, getRestoreJob, type RestoreSteps, type RestoreResult } from '@/lib/restore';
import { getImageStore } from '@/lib/imagestore';
import { watermarkPreview } from '@/lib/watermark';
import {
  resolveIdentityFromRequest,
  checkRestoreRateLimit,
  isDailySpendCapped,
  recordSpend,
  FREE_LIMIT,
} from '@/lib/ratelimit';

const MAX_BYTES = 10 * 1024 * 1024;

function dataUrlBytes(dataUrl: string): number {
  const comma = dataUrl.indexOf(',');
  const b64 = comma >= 0 ? dataUrl.slice(comma + 1) : '';
  return Math.floor((b64.length * 3) / 4);
}

function guessContentType(dataUrl: string): string {
  const m = /^data:([a-zA-Z0-9.+-]+\/[a-zA-Z0-9.+-]+);base64,/.exec(dataUrl);
  return m ? m[1] : 'image/png';
}

const SETTLE_POLL_MS = 1000;
const SETTLE_MAX_ATTEMPTS = 300;

async function settleCreditOnSuccess(jobId: string, identityId: string) {
  try {
    for (let i = 0; i < SETTLE_MAX_ATTEMPTS; i++) {
      const job = getRestoreJob(jobId);
      if (!job) return;
      if (job.status === 'succeeded') {
        getStore().consumeCredit(identityId);
        return;
      }
      if (job.status === 'failed') return;
      await new Promise((resolve) => setTimeout(resolve, SETTLE_POLL_MS));
    }
  } catch (err) {
    console.error('settleCreditOnSuccess failed', err);
  }
}

export async function POST(req: Request) {
  try {
    const { identity, cookieHeader } = resolveIdentityFromRequest(req);
    const identityId = identity.id;
    const headers = { 'Set-Cookie': cookieHeader };

    if (!checkRestoreRateLimit(identityId)) {
      return Response.json({ error: 'rate limit exceeded, try again shortly' }, { status: 429, headers });
    }
    if (isDailySpendCapped()) {
      return Response.json({ error: 'daily capacity reached, try again tomorrow' }, { status: 429, headers });
    }

    let body: { image?: unknown; steps?: unknown };
    try {
      body = await req.json();
    } catch {
      return Response.json({ error: 'Invalid JSON body' }, { status: 400, headers });
    }

    const image = body.image;
    if (typeof image !== 'string' || !/^data:image\/[a-zA-Z0-9.+-]+;base64,/.test(image)) {
      return Response.json({ error: 'image must be a base64 data: image URL' }, { status: 400, headers });
    }
    if (dataUrlBytes(image) > MAX_BYTES) {
      return Response.json({ error: 'image too large (max ~10MB)' }, { status: 413, headers });
    }

    const s = (body.steps || {}) as Record<string, unknown>;
    const steps: RestoreSteps = {
      face: s.face !== false,
      upscale: s.upscale !== false,
      colorize: s.colorize !== false,
    };
    if (!steps.face && !steps.upscale && !steps.colorize) {
      return Response.json({ error: 'select at least one step' }, { status: 400, headers });
    }

    const store = getStore();
    const credits = store.getCredits(identityId);

    if (credits > 0) {
      recordSpend(1);
      const jobId = startRestoreJob({ image, steps });
      void settleCreditOnSuccess(jobId, identityId);
      return Response.json({ mode: 'job', jobId, status: 'queued' }, { status: 202, headers });
    }

    const freeUsed = store.getFreeUsed(identityId);
    if (freeUsed >= FREE_LIMIT) {
      return Response.json(
        {
          error: 'free previews used up',
          reason: 'no_credits',
          purchaseRequired: true,
          freeUsed,
          freeLimit: FREE_LIMIT,
        },
        { status: 402, headers }
      );
    }

    recordSpend(1);
    let result: RestoreResult;
    try {
      result = await restorePhoto({ image, steps });
    } catch (err) {
      return Response.json({ error: (err as Error).message || 'restoration failed' }, { status: 502, headers });
    }

    const resultId = await getImageStore().put(result.after, guessContentType(result.after));
    store.recordResultOwner(resultId, identityId);
    const preview = watermarkPreview(result.after);
    const newFreeUsed = store.incFreeUsed(identityId);

    return Response.json(
      {
        mode: 'preview',
        preview,
        resultId,
        steps: result.steps,
        mock: result.mock,
        freeUsed: newFreeUsed,
        freeLimit: FREE_LIMIT,
      },
      { headers }
    );
  } catch (err) {
    return Response.json({ error: (err as Error).message || 'unexpected error' }, { status: 500 });
  }
}
