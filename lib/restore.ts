import { runModel, REPLICATE_MOCK } from './replicate';
import { getImageStore } from './imagestore';
import { sanitizeImage } from './imagesafe';

export interface RestoreSteps {
  face?: boolean;
  upscale?: boolean;
  colorize?: boolean;
}

export interface StepResult {
  name: string;
  status: 'done' | 'skipped' | 'failed';
  note: string;
}

export interface RestoreResult {
  after: string;
  steps: StepResult[];
  mock: boolean;
}

const MODELS = {
  face: {
    label: 'Face restore',
    owner: 'tencentarc',
    name: 'gfpgan',
    version: process.env.REPLICATE_GFPGAN_VERSION || '',
    inputKey: 'img',
  },
  upscale: {
    label: 'Upscale',
    owner: 'nightmareai',
    name: 'real-esrgan',
    version: process.env.REPLICATE_REAL_ESRGAN_VERSION || '',
    inputKey: 'image',
  },
  colorize: {
    label: 'Colorize',
    owner: 'piddnad',
    name: 'ddcolor',
    version: process.env.REPLICATE_DDCOLOR_VERSION || '',
    inputKey: 'image',
  },
} as const;

type StepKey = keyof typeof MODELS;
const STEP_ORDER: StepKey[] = ['face', 'upscale', 'colorize'];

function parseDataUrl(dataUrl: string): { bytes: Buffer; contentType: string } {
  const comma = dataUrl.indexOf(',');
  const header = dataUrl.slice(5, comma);
  const contentType = header.split(';')[0] || 'application/octet-stream';
  return { bytes: Buffer.from(dataUrl.slice(comma + 1), 'base64'), contentType };
}

export async function restorePhoto({
  image,
  steps,
}: {
  image: string;
  steps: RestoreSteps;
}): Promise<RestoreResult> {
  const enabled = STEP_ORDER.filter((k) => steps?.[k]);

  if (REPLICATE_MOCK) {
    return {
      after: image,
      steps: enabled.map((k) => ({ name: MODELS[k].label, status: 'done', note: 'mock' })),
      mock: true,
    };
  }

  const store = getImageStore();
  const source = parseDataUrl(image);
  const safeBytes = sanitizeImage(source.bytes, source.contentType);
  let currentUrl = await store.get(await store.put(safeBytes, source.contentType));
  if (!currentUrl) throw new Error('image store did not return a url for the uploaded photo');

  const results: StepResult[] = [];
  for (const key of enabled) {
    const spec = MODELS[key];
    const out = await runModel(
      { owner: spec.owner, name: spec.name, version: spec.version },
      { [spec.inputKey]: currentUrl },
    );
    const outputUrl = out[0];
    if (!outputUrl) throw new Error(`${spec.label}: Replicate returned no output`);

    const fetched = await fetch(outputUrl);
    if (!fetched.ok) throw new Error(`${spec.label}: failed to fetch model output (${fetched.status})`);
    const contentType = fetched.headers.get('content-type') || 'image/png';
    const bytes = Buffer.from(await fetched.arrayBuffer());
    const stored = await store.get(await store.put(bytes, contentType));
    if (!stored) throw new Error(`${spec.label}: image store did not return a url for its output`);

    currentUrl = stored;
    results.push({ name: spec.label, status: 'done', note: 'replicate' });
  }

  return { after: currentUrl, steps: results, mock: false };
}

export { startRestoreJob, getRestoreJob } from './jobs';
export type { RestoreJob } from './jobs';
