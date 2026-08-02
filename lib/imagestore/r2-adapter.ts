
import type { ImageStore } from './index';

const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID || '';
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID || '';
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY || '';
const R2_BUCKET = process.env.R2_BUCKET || '';
const R2_PUBLIC_BASE_URL = process.env.R2_PUBLIC_BASE_URL || '';

export function isR2Configured(): boolean {
  return Boolean(R2_ACCOUNT_ID && R2_ACCESS_KEY_ID && R2_SECRET_ACCESS_KEY && R2_BUCKET);
}

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
