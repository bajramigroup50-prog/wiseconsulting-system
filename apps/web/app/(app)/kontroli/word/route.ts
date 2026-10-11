/**
 * Word (.docx) export of an inspection case: `?id=<kontrola>&doc=draft` the objection / appeal draft (the edited text
 * if saved, else the generated one), `&doc=analiza` the office's analysis. Same guard as the page (office staff of the
 * firm); the client never gets the drafts.
 */
import { and, asc, eq } from 'drizzle-orm';
import { can } from '@wise/core';
import { kontrolaFindings, kontroli } from '@wise/db';
import { getUser } from '@/lib/auth';
import { currentFirm } from '@/lib/context';
import { db } from '@/lib/db';
import { minimalDocx } from '@/lib/docx';
import { analysisParagraphs, draftParagraphs, kontrolaDraft } from '@/lib/kontrola';

export async function GET(req: Request) {
  const u = await getUser();
  if (!u) return new Response('Unauthorized', { status: 401 });
  const firm = await currentFirm(u, { check: false });
  if (!firm || !can(u.principal, 'office', firm.id)) return new Response('Forbidden', { status: 403 });
  const sp = new URL(req.url).searchParams;
  const id = sp.get('id') ?? '';
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new Response('Not found', { status: 404 });
  const [k] = await db().select().from(kontroli).where(and(eq(kontroli.id, id), eq(kontroli.firmId, firm.id))).limit(1);
  if (!k) return new Response('Not found', { status: 404 });
  const F = await db().select().from(kontrolaFindings).where(eq(kontrolaFindings.kontrolaId, id)).orderBy(asc(kontrolaFindings.no));
  let paras: string[];
  let name: string;
  if (sp.get('doc') === 'analiza') {
    paras = analysisParagraphs(k, F, firm);
    name = 'Analiza';
  } else {
    const saved = (k.data as { draft?: string }).draft;
    const d = saved ? null : await kontrolaDraft(k, F, firm);
    paras = saved ? saved.split(/\r?\n/) : d ? draftParagraphs(d) : [];
    name = 'Prigovor_zhalba';
  }
  const out = minimalDocx(paras.map((t) => [t]));
  return new Response(new Uint8Array(out), {
    headers: {
      'content-type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'content-disposition': `attachment; filename="${name}_${(k.docNo ?? k.docDate ?? '').replace(/\W+/g, '_')}.docx"`,
    },
  });
}
