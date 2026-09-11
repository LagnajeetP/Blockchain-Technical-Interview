import {
  PendingConfirmationError,
  RunBusyError,
  RunUnavailableError,
  advanceRun,
} from '@/lib/server/workflow';

export const dynamic = 'force-dynamic';

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  try {
    const value = await advanceRun(id, request);
    if (!value)
      return Response.json(
        { error: 'Run not found or token invalid' },
        { status: 404 },
      );
    return Response.json(value, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    if (error instanceof RunBusyError) {
      return Response.json(
        { error: error.message, retryable: true },
        { status: 409 },
      );
    }
    if (error instanceof RunUnavailableError) {
      return Response.json(
        { error: error.message },
        { status: 503, headers: { 'Cache-Control': 'no-store' } },
      );
    }
    if (error instanceof PendingConfirmationError) {
      return Response.json(
        { error: 'Transaction is still pending confirmation', retryable: true },
        {
          status: 202,
          headers: { 'Retry-After': '3', 'Cache-Control': 'no-store' },
        },
      );
    }
    const message =
      error instanceof Error ? error.message : 'Unable to advance run';
    return Response.json(
      { error: message },
      { status: /expired/i.test(message) ? 410 : 500 },
    );
  }
}
