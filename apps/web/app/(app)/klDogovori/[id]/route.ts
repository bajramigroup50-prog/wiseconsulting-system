/** Client portal print / Word of an employment document of the firm (`hrDocPrint`), when „Договори за вработување“ is on. */
import { hrDocPrint } from '@/lib/payroll/hr-print';
import { klDogCtx } from '../guard';

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const g = await klDogCtx();
  if (!g) return new Response('Немате пристап.', { status: 403, headers: { 'content-type': 'text/plain; charset=utf-8' } });
  return hrDocPrint(g.firm, id, new URL(req.url).searchParams);
}
