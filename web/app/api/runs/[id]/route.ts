import { authorizedRun, getPublicRun } from '@/lib/server/workflow';

export const dynamic = 'force-dynamic';

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const run = await authorizedRun(id, request);
  if (!run) {
    return Response.json({ error: 'Run not found or token invalid' }, { status: 404 });
  }
  if (run.expiresAt < Date.now()) {
    return Response.json({ error: 'Run token expired' }, { status: 410 });
  }
  return Response.json(await getPublicRun(run), { headers: { 'Cache-Control': 'no-store' } });
}
