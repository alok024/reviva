// Stubbed R2/S3-compatible drop-in for '@/lib/imagestore'. R2 and S3 both speak the same API,
// so this is the seam for real durable object storage — this repo has no bucket or
// credentials, so put/get throw rather than pretend to succeed. Wire up a signed PUT/GET
// against https://{R2_ACCOUNT_ID}.r2.cloudflarestorage.com/{R2_BUCKET} (or an S3 endpoint),
// then point getImageStore() at getR2ImageStore() below.

import type { ImageStore } from './index';

const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID || '';
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID || '';
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY || '';
const R2_BUCKET = process.env.R2_BUCKET || '';
const R2_PUBLIC_BASE_URL = process.env.R2_PUBLIC_BASE_URL || '';

export function isR2Configured(): boolean {
  return Boolean(R2_ACCOUNT_ID && R2_ACCESS_KEY_ID && R2_SECRET_ACCESS_KEY && R2_BUCKET);
}

// Matches the ImageStore shape from lib/imagestore/index.ts so it is a literal drop-in:
// swap the import in whatever calls getImageStore() for getR2ImageStore() once real.
export function getR2ImageStore(): ImageStore {
  return {
    async put(): Promise<string> {
      throw new Error(
        `r2-adapter is a stub (bucket=${R2_BUCKET || 'unset'}) — implement the signed S3-compatible ` +
          `PUT before use, or keep using the in-memory default from lib/imagestore/index.ts`,
      );
    },
    async get(): Promise<string | null> {
      throw new Error(
        `r2-adapter is a stub (base url=${R2_PUBLIC_BASE_URL || 'unset'}) — implement the signed ` +
          `S3-compatible GET before use`,
      );
    },
  };
}
