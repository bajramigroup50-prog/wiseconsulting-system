/**
 * Word (.docx) of „🗂 Целосен извештај за фирма“: `?f=<firm>&y=<year>&do=<date>` — the same report as the screen (htmlDocx,
 * like the inspection documents). Office OWNER only; everybody else 403.
 */
import { htmlDocx } from '@/lib/docx';
import { fiAi, fiHtml, fiOwnerUser, fiParams, fiReport } from '../lib';

const translit = (s: string) => s.replace(/[^\w.-]+/g, '_');

export async function GET(req: Request) {
  const u = await fiOwnerUser();
  if (!u) return new Response('Forbidden', { status: 403 });
  const p = fiParams(Object.fromEntries(new URL(req.url).searchParams));
  if (!p.f) return new Response('Not found', { status: 404 });
  const [R, ai] = await Promise.all([fiReport(u, { ...p, f: p.f }), fiAi(p.f, p.y)]);
  if (!R) return new Response('Not found', { status: 404 });
  const out = htmlDocx(fiHtml(R, 'word', ai?.status === 'done' ? ai : null, u.name));
  return new Response(new Uint8Array(out), {
    headers: {
      'content-type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'content-disposition': `attachment; filename="Celosen_izvestaj_${translit(R.to)}.docx"`,
      'cache-control': 'private, no-store',
    },
  });
}
