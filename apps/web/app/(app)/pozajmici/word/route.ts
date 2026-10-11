/** Legacy ACT `lnWord` 16754: the loan contract as a Word document (.docx). `?id=<loan id>`. */
import { createElement } from 'react';
import { and, eq } from 'drizzle-orm';
import { loans, partners } from '@wise/db';
import { db } from '@/lib/db';
import { minimalDocx } from '@/lib/docx';
import { routeFirm } from '@/lib/parity-fin';
import { LoanContract } from '../contract';

const unesc = (s: string) => s.replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'").replace(/&amp;/g, '&');

export async function GET(req: Request) {
  const c = await routeFirm('pozajmici');
  if (!c) return new Response('Forbidden', { status: 403 });
  const id = new URL(req.url).searchParams.get('id') ?? '';
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new Response('Not found', { status: 404 });
  const [l] = await db().select().from(loans).where(and(eq(loans.id, id), eq(loans.firmId, c.firm.id))).limit(1);
  if (!l) return new Response('Not found', { status: 404 });
  const [p] = l.partnerId ? await db().select().from(partners).where(eq(partners.id, l.partnerId)).limit(1) : [];
  const { renderToStaticMarkup } = await import('react-dom/server');
  const html = renderToStaticMarkup(createElement(LoanContract, { l, firm: c.firm, partner: p }));
  // one Word paragraph per heading / paragraph / signature block of the contract
  const paras = [...html.matchAll(/<(h2|p|b|div)[^>]*>([\s\S]*?)<\/\1>/g)]
    .map((m) => unesc(m[2]!.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim())).filter(Boolean);
  const out = minimalDocx(paras.map((t) => [t]));
  return new Response(new Uint8Array(out), {
    headers: { 'content-type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'content-disposition': `attachment; filename="Dogovor_pozajmica_${(l.number ?? '').replace(/\W+/g, '_')}.docx"` },
  });
}
