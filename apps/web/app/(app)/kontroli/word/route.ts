/**
 * Word (.docx) export of an inspection case: `?id=<kontrola>&doc=draft` the external document (забелешки / приговор /
 * жалба / тужба — the office's edited or accepted text if saved, else the generated one), `&doc=analiza` the internal
 * analysis; `&v=<version id>` a stored version instead of the current text. Same guard as the page (office staff of
 * the firm): a client (portal) never gets either document.
 */
import { and, eq } from 'drizzle-orm';
import { can } from '@wise/core';
import { docHtml, SUBMISSION_LBL, textHtml, versionsOf } from '@wise/core/compliance';
import { kontrolaTexts, kontroli } from '@wise/db';
import { getUser } from '@/lib/auth';
import { currentFirm } from '@/lib/context';
import { db } from '@/lib/db';
import { htmlDocx } from '@/lib/docx';
import { kontrolaCaseDocs } from '@/lib/kontrola';

const translit = (s: string) => s.replace(/[^\w.-]+/g, '_');

export async function GET(req: Request) {
  const u = await getUser();
  if (!u) return new Response('Unauthorized', { status: 401 });
  if (u.role === 'klient') return new Response('Forbidden', { status: 403 });
  const firm = await currentFirm(u, { check: false });
  if (!firm || !can(u.principal, 'office', firm.id)) return new Response('Forbidden', { status: 403 });
  const sp = new URL(req.url).searchParams;
  const id = sp.get('id') ?? '';
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new Response('Not found', { status: 404 });
  const [k] = await db().select().from(kontroli).where(and(eq(kontroli.id, id), eq(kontroli.firmId, firm.id))).limit(1);
  if (!k) return new Response('Not found', { status: 404 });
  const internal = sp.get('doc') === 'analiza';
  const vid = sp.get('v');
  let html: string;
  let name: string;
  if (vid) {
    const v = versionsOf(k.data).find((x) => x.id === vid);
    if (!v) return new Response('Not found', { status: 404 });
    html = textHtml(internal ? v.internal : v.external);
    name = internal ? 'Vnatreshna_analiza' : SUBMISSION_FILE[v.type];
  } else {
    const t = kontrolaTexts(k);
    const saved = internal ? t.internalDraft : t.draft;
    const D = saved ? null : await kontrolaCaseDocs(firm.id, id);
    if (!saved && !D) return new Response('Not found', { status: 404 });
    html = saved ? textHtml(saved) : docHtml(internal ? D!.internal : D!.external);
    name = internal ? 'Vnatreshna_analiza' : SUBMISSION_FILE[D?.external.choice.type ?? 'zhalba'];
  }
  const out = htmlDocx(html);
  return new Response(new Uint8Array(out), {
    headers: {
      'content-type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'content-disposition': `attachment; filename="${name}_${translit(k.docNo ?? k.docDate ?? '')}.docx"`,
      'cache-control': 'private, no-store',
    },
  });
}

const SUBMISSION_FILE: Record<keyof typeof SUBMISSION_LBL, string> = { zabeleski: 'Zabeleshki_na_zapisnik', prigovor: 'Prigovor', zhalba: 'Zhalba', tuzhba: 'Tuzhba' };
