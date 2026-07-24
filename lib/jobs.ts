// Async wrapper around the restore chain — startRestoreJob returns immediately so a single
// serverless request is never held open for the full 3-model duration; getRestoreJob polls
// status/result. Re-exported from lib/restore.ts, which is the module callers import from.

import crypto from 'crypto';
import { restorePhoto, type RestoreSteps, type RestoreResult } from './restore';

export interface RestoreJob {
  id: string;
  status: 'queued' | 'running' | 'succeeded' | 'failed';
  result?: RestoreResult;
  error?: string;
}

// Process-local job table — same caveat as the in-memory image store: fine for a single
// long-lived server or local dev, but a multi-instance deployment needs a durable queue so a
// poll landing on a different instance can still find the job.
const jobs = new Map<string, RestoreJob>();

async function run(id: string, args: { image: string; steps: RestoreSteps }): Promise<void> {
  const job = jobs.get(id);
  if (!job) return;
  job.status = 'running';
  try {
    job.result = await restorePhoto(args);
    job.status = 'succeeded';
  } catch (err) {
    // Structured failure on the job, not a raw throw — nothing is awaiting this call.
    job.status = 'failed';
    job.error = err instanceof Error ? err.message : String(err);
  }
}

export function startRestoreJob(args: { image: string; steps: RestoreSteps }): string {
  const id = crypto.randomUUID();
  jobs.set(id, { id, status: 'queued' });
  run(id, args).catch(() => {}); // run() already catches; this is a defensive backstop
  return id;
}

export function getRestoreJob(id: string): RestoreJob | null {
  return jobs.get(id) ?? null;
}
