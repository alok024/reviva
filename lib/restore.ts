import { runModel, REPLICATE_MOCK } from './replicate';

export interface RestoreSteps {
  face?: boolean;
  upscale?: boolean;
  colorize?: boolean;
}

export interface StepResult {
  name: string;
  status: 'done' | 'skipped';
  note: string;
}

export interface RestoreResult {
  after: string;
  steps: StepResult[];
  mock: boolean;
}

// Real Replicate model ids. Production MUST pin a specific version hash (e.g. "owner/model:<hash>")
// so a model update cannot silently change output quality or per-run cost.
const MODELS = {
  face: 'tencentarc/gfpgan', // face restoration
  upscale: 'nightmareai/real-esrgan', // 4x upscale / denoise
  colorize: 'piddnad/ddcolor', // black-and-white colorization
};

// The input key each model expects for the source image.
const IMAGE_INPUT_KEY = 'img'; // gfpgan/real-esrgan use "img"; ddcolor uses "image" (mapped below)

export async function restorePhoto({
  image,
  steps,
}: {
  image: string;
  steps: RestoreSteps;
}): Promise<RestoreResult> {
  const enabled: Array<{ name: string; model: string; key: string }> = [];
  if (steps?.face) enabled.push({ name: 'Face restore', model: MODELS.face, key: IMAGE_INPUT_KEY });
  if (steps?.upscale) enabled.push({ name: 'Upscale', model: MODELS.upscale, key: IMAGE_INPUT_KEY });
  if (steps?.colorize) enabled.push({ name: 'Colorize', model: MODELS.colorize, key: 'image' });

  if (REPLICATE_MOCK) {
    // Echo the original back as the "after" so the before/after UI shows something real.
    return {
      after: image,
      steps: enabled.map((s) => ({ name: s.name, status: 'done', note: 'mock' })),
      mock: true,
    };
  }

  // Real mode: chain steps — each step's output image feeds the next step's input.
  let current = image;
  const results: StepResult[] = [];
  for (const step of enabled) {
    const out = await runModel(step.model, { [step.key]: current });
    const next = out[0];
    if (next) current = next;
    results.push({ name: step.name, status: 'done', note: 'replicate' });
  }

  return { after: current, steps: results, mock: false };
}
