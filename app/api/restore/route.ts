import { restorePhoto } from '@/lib/restore';

const MAX_BYTES = 10 * 1024 * 1024; // ~10MB

// Rough byte size of a data: URL's base64 payload.
function dataUrlBytes(dataUrl: string): number {
  const comma = dataUrl.indexOf(',');
  const b64 = comma >= 0 ? dataUrl.slice(comma + 1) : '';
  return Math.floor((b64.length * 3) / 4);
}

export async function POST(req: Request) {
  let body: { image?: unknown; steps?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const image = body.image;
  if (typeof image !== 'string' || !/^data:image\/[a-zA-Z0-9.+-]+;base64,/.test(image)) {
    return Response.json({ error: 'image must be a base64 data: image URL' }, { status: 400 });
  }
  if (dataUrlBytes(image) > MAX_BYTES) {
    return Response.json({ error: 'image too large (max ~10MB)' }, { status: 413 });
  }

  const s = (body.steps || {}) as Record<string, unknown>;
  const steps = {
    face: s.face !== false,
    upscale: s.upscale !== false,
    colorize: s.colorize !== false,
  };
  if (!steps.face && !steps.upscale && !steps.colorize) {
    return Response.json({ error: 'select at least one step' }, { status: 400 });
  }

  const result = await restorePhoto({ image, steps });
  return Response.json(result);
}
