import { getUser } from '@/lib/auth';
import { currentFirm, currentYear } from '@/lib/context';

/**
 * The firm and year of the session now (`components/firm-guard.tsx` compares them with what its tab was rendered for
 * when the window gets the focus). Only the caller's own selection; ids, no names.
 */
export async function GET() {
  const u = await getUser();
  if (!u) return Response.json({ error: 'Најавете се.' }, { status: 401 });
  const [f, year] = await Promise.all([currentFirm(u, { check: false }), currentYear({ check: false })]);
  return Response.json({ firm: f?.id ?? '', year: String(year) }, { headers: { 'cache-control': 'no-store' } });
}
