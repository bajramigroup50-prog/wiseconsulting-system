/**
 * Caddy `forward_auth` target for files.DOMAIN (the S3 store is not behind the app): `proxy.ts` has already refused a
 * revoked / unknown device certificate (fingerprint from Caddy), so reaching this handler means „allowed“.
 */
export const dynamic = 'force-dynamic';

export function GET() {
  return new Response(null, { status: 204 });
}
