/**
 * Print a registered HR document exactly as saved (legacy `hrPdf` 7784 / `ctPdf` / `diPdf`) — the office side of
 * `hrDocPrint` (`?word=1` = Word, own template or the program's document; `?builtin=1` = the program's document).
 */
import { HR_LOCK_MSG, hrOfficeLocked } from '@/lib/hr-lock';
import { hrDocPrint } from '@/lib/payroll/hr-print';
import { payRoute } from '@/lib/payroll/server';

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new Response('Not found', { status: 404 });
  const g = await payRoute('hrPdf');
  if (g instanceof Response) return g;
  if (await hrOfficeLocked(g.firm, g.u)) return new Response(HR_LOCK_MSG, { status: 403, headers: { 'content-type': 'text/plain; charset=utf-8' } });
  return hrDocPrint(g.firm, id, new URL(req.url).searchParams);
}
