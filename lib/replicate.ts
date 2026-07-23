// Standalone Replicate helper — added fresh (Replicate is NOT wired into Vachix).
// Handles image/media generation via the Replicate HTTP API. Keyless MOCK fallback returns
// a placeholder so local dev + tests run without a REPLICATE_API_TOKEN.
//
// Real per-unit costs (verify current pricing at replicate.com/pricing before launch):
//   SDXL ~ $0.0011-0.011 / image, FLUX schnell ~ $0.003 / image, upscalers/rembg cheap.
// Price the product well above this — see each product README's cost math.

const REPLICATE_API_TOKEN = process.env.REPLICATE_API_TOKEN || '';
export const REPLICATE_MOCK = !REPLICATE_API_TOKEN;

// A 1x1 transparent PNG data URI, used as the mock generation output.
const MOCK_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

export interface RunOptions {
  // Poll settings for the prediction lifecycle.
  pollIntervalMs?: number;
  timeoutMs?: number;
  mockOutput?: string | string[]; // override the placeholder in mock mode
}

// Run a model version with input, poll to completion, return the output (usually image URL(s)).
// `versionOrModel` accepts a pinned version hash (e.g. "stability-ai/sdxl:<hash>") — pin versions
// in production so a model update can't silently change output/cost.
export async function runModel(
  versionOrModel: string,
  input: Record<string, unknown>,
  opts: RunOptions = {},
): Promise<string[]> {
  if (REPLICATE_MOCK) {
    const out = opts.mockOutput ?? MOCK_PNG;
    return Array.isArray(out) ? out : [out];
  }

  const version = versionOrModel.includes(':') ? versionOrModel.split(':')[1] : versionOrModel;
  const create = await fetch('https://api.replicate.com/v1/predictions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${REPLICATE_API_TOKEN}`,
      'Content-Type': 'application/json',
      Prefer: 'wait', // ask Replicate to hold the connection briefly for fast models
    },
    body: JSON.stringify({ version, input }),
  });
  if (!create.ok) {
    const body = await create.text().catch(() => '');
    throw new Error(`Replicate create ${create.status}: ${body.slice(0, 300)}`);
  }
  let pred = (await create.json()) as { id: string; status: string; output?: unknown; error?: string; urls?: { get: string } };

  const interval = opts.pollIntervalMs ?? 1500;
  const deadline = Date.now() + (opts.timeoutMs ?? 120_000);
  while (pred.status !== 'succeeded' && pred.status !== 'failed' && pred.status !== 'canceled') {
    if (Date.now() > deadline) throw new Error('Replicate prediction timed out');
    await new Promise((r) => setTimeout(r, interval));
    const poll = await fetch(pred.urls!.get, { headers: { Authorization: `Bearer ${REPLICATE_API_TOKEN}` } });
    pred = (await poll.json()) as typeof pred;
  }
  if (pred.status !== 'succeeded') throw new Error(`Replicate prediction ${pred.status}: ${pred.error ?? ''}`);

  const output = pred.output;
  if (Array.isArray(output)) return output.map(String);
  if (typeof output === 'string') return [output];
  return [JSON.stringify(output)];
}
