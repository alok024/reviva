
import crypto from 'crypto';
import { restorePhoto, type RestoreSteps, type RestoreResult } from './restore';

export interface RestoreJob {
  id: string;
  status: 'queued' | 'running' | 'succeeded' | 'failed';
  result?: RestoreResult;
  error?: string;
}

const jobs = new Map<string, RestoreJob>();

async function run(id: string, args: { image: string; steps: RestoreSteps }): Promise<void> {
  const job = jobs.get(id);
  if (!job) return;
  job.status = 'running';
  try {
    job.result = await restorePhoto(args);
    job.status = 'succeeded';
  } catch (err) {
    job.status = 'failed';
    job.error = err instanceof Error ? err.message : String(err);
  }
}

export function startRestoreJob(args: { image: string; steps: RestoreSteps }): string {
  const id = crypto.randomUUID();
  jobs.set(id, { id, status: 'queued' });
  run(id, args).catch(() => {});
  return id;
}

export function getRestoreJob(id: string): RestoreJob | null {
  return jobs.get(id) ?? null;
}
