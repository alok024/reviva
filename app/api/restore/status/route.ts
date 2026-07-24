import { getRestoreJob } from '@/lib/restore';

export async function GET(req: Request) {
  try {
    const id = new URL(req.url).searchParams.get('id');
    if (!id) {
      return Response.json({ error: 'id is required' }, { status: 400 });
    }

    const job = getRestoreJob(id);
    if (!job) {
      return Response.json({ error: 'job not found' }, { status: 404 });
    }

    return Response.json(job);
  } catch (err) {
    return Response.json({ error: (err as Error).message || 'status lookup failed' }, { status: 500 });
  }
}
