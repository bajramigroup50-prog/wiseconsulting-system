/** The donation / sponsorship contract (or `?doc=potvrda` the confirmation) as a Word document (.docx). `?id=<donation id>`. */
import { createElement } from 'react';
import { and, eq } from 'drizzle-orm';
import { donations, partners } from '@wise/db';
import { db } from '@/lib/db';
import { minimalDocx } from '@/lib/docx';
import { routeFirm } from '@/lib/parity-fin';
import { DonationConfirmation, DonationContract } from '../contract';

const unesc = (s: string) => s.replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'").replace(/&amp;/g, '&');

export async function GET(req: Request) {
  const c = await routeFirm('donacii');
  if (!c) return new Response('Forbidden', { status: 403 });
  const q = new URL(req.url).searchParams;
  const id = q.get('id') ?? '';
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new Response('Not found', { status: 404 });
  const [d] = await db().select().from(donations).where(and(eq(donations.id, id), eq(donations.firmId, c.firm.id))).limit(1);
  if (!d) return new Response('Not found', { status: 404 });
  const [p] = d.partnerId ? await db().select().from(partners).where(eq(partners.id, d.partnerId)).limit(1) : [];
  const conf = q.get('doc') === 'potvrda' && !!d.confDate;
  const { renderToStaticMarkup } = await import('react-dom/server');
  const html = renderToStaticMarkup(conf ? createElement(DonationConfirmation, { d, firm: c.firm, partner: p }) : createElement(DonationContract, { d, firm: c.firm, partner: p }));
  const paras = [...html.matchAll(/<(h2|p|b|div)[^>]*>([\s\S]*?)<\/\1>/g)]
    .map((m) => unesc(m[2]!.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim())).filter(Boolean);
  const out = minimalDocx(paras.map((t) => [t]));
  const name = (conf ? 'Potvrda_' : d.kind === 'sponsorship' ? 'Dogovor_sponzorstvo_' : 'Dogovor_donacija_') + (d.number ?? '').replace(/\W+/g, '_');
  return new Response(new Uint8Array(out), {
    headers: { 'content-type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'content-disposition': `attachment; filename="${name}.docx"` },
  });
}
