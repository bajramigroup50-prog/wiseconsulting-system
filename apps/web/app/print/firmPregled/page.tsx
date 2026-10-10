/**
 * Legacy `invStylePrev` (7070): preview of the invoice look with the editor's unsaved values (style, colour, note,
 * legal footer, logo / signature / stamp, signer, bank). Legacy printed the firm's last invoice or a sample line;
 * here the last invoice of the firm when there is one, otherwise the sample.
 */
import { notFound } from 'next/navigation';
import { desc, eq } from 'drizzle-orm';
import { can } from '@wise/core';
import { invoicePrintHtml } from '@wise/core/sales';
import { firms, invoices, loadInvoicePrintData } from '@wise/db';
import { requireUser } from '@/lib/auth';
import { db } from '@/lib/db';

export const metadata = { title: 'Преглед на изгледот' };
const KEYS = ['invStyle', 'invColor', 'invNote', 'legalFoot', 'logo', 'sign', 'stamp', 'signer', 'signerRole', 'bank', 'bankName'] as const;

export default async function FirmPregled({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const u = await requireUser();
  const id = sp.firm ?? '';
  if (!/^[0-9a-f-]{36}$/i.test(id) || !can(u.principal, 'saveFirm', id)) notFound();
  const [f] = await db().select().from(firms).where(eq(firms.id, id)).limit(1);
  if (!f) notFound();
  const settings: Record<string, unknown> = { ...(f.settings ?? {}) };
  for (const k of KEYS) if (sp[k] !== undefined) settings[k] = sp[k];
  settings.qr = sp.qr === '1';
  const [last] = await db().select({ id: invoices.id }).from(invoices).where(eq(invoices.firmId, id)).orderBy(desc(invoices.date)).limit(1);
  const d = last ? await loadInvoicePrintData(db(), last.id, undefined) : null;
  const today = new Date().toISOString().slice(0, 10);
  const input = d ? { ...d.input, firm: { ...d.input.firm, settings } } : {
    kind: 'invoice' as const,
    doc: { kind: 'invoice', number: `001/${today.slice(0, 4)}`, date: today, due: today, currency: 'MKD', fx: 1 },
    firm: { name: f.name, address: f.address, city: f.city, phone: f.phone, email: f.email, edb: f.edb, embs: f.embs, vatRegistered: f.vatRegistered, settings },
    partner: { name: 'Купувач ДООЕЛ', city: 'Скопје' },
    lines: [{ name: 'Пример услуга', unit: 'ком', qty: 1, price: 1000, disc: 0, rate: 18 }],
  };
  return (
    <>
      <p className="noprint note" style={{ textAlign: 'center' }}>Зачувајте ја фирмата за изгледот да важи за сите фактури.</p>
      <div style={{ display: 'contents' }} dangerouslySetInnerHTML={{ __html: invoicePrintHtml(input) }} />
    </>
  );
}
