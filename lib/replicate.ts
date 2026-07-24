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

// A model plus the version pinned for it. `version` comes from a REPLICATE_*_VERSION env var
// (see lib/restore.ts) — never hardcode a hash here, we don't have any.
export interface ReplicateModelRef {
  owner: string;
  name: string;
  version: string;
}

// Run a prediction on a model's own endpoint and poll to completion, returning the output
// (usually image URL(s)). Uses the model-scoped endpoint (/v1/models/{owner}/{name}/predictions)
// rather than the generic /v1/predictions one — the generic endpoint requires a full version
// id and 422s if handed a bare "owner/model" slug as `version`, which this used to send.
export async function runModel(
  model: ReplicateModelRef,
  input: Record<string, unknown>,
  opts: RunOptions = {},
): Promise<string[]> {
  if (REPLICATE_MOCK) {
    const out = opts.mockOutput ?? MOCK_PNG;
    return Array.isArray(out) ? out : [out];
  }

  if (!model.version) {
    throw new Error(`no pinned version for ${model.owner}/${model.name} — set its REPLICATE_*_VERSION env var`);
  }

  const create = await fetch(`https://api.replicate.com/v1/models/${model.owner}/${model.name}/predictions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${REPLICATE_API_TOKEN}`,
      'Content-Type': 'application/json',
      Prefer: 'wait', // ask Replicate to hold the connection briefly for fast models
    },
    body: JSON.stringify({ version: model.version, input }),
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
