import { buildId, gitSha } from '@/lib/build-id';

export const dynamic = 'force-dynamic';

/** The running build (`components/version-check.tsx` compares it with the build the page was rendered with). */
export function GET() {
  return Response.json({ build: buildId(), sha: gitSha() }, { headers: { 'cache-control': 'no-store, max-age=0' } });
}
