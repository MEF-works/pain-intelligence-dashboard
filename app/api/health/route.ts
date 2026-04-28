export const dynamic = 'force-dynamic';

/**
 * Liveness for Traefik / load balancers / Uptime.
 */
export async function GET() {
  return Response.json(
    { ok: true, service: 'pain-intel', at: new Date().toISOString() },
    { status: 200, headers: { 'Cache-Control': 'no-store' } }
  );
}
