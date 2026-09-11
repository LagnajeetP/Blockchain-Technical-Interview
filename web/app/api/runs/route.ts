import { RunBusyError, createRun } from '@/lib/server/workflow';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    return Response.json(await createRun(body), {
      status: 201,
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    const status = error instanceof RunBusyError ? 429 : 400;
    return Response.json(
      { error: error instanceof Error ? error.message : 'Unable to create run' },
      { status, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
