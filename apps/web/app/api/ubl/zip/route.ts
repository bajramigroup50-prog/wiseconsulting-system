/**
 * P34 — bulk e-Фактура export of the current firm's issued invoices / credit notes: one ZIP with a UBL 2.1 XML per
 * invoice and `lista.csv` (every selected invoice with its status and, for the ones left out, the reason).
 *
 * Selection (`sel`): `period` = all in `from`–`to`; `unsent` = the posted, not cancelled ones in `from`–`to` not yet exported; `ids` = the
 * ticked ones (`id`). Every XML passes the existing checks (seller data, buyer data `einvoiceBuyerProblems`, the
 * structural / arithmetic `ublCheck`) before it goes in; failures stay out of the ZIP and are listed with the reason.
 * The exported invoices get `data.efExport` („извезено за е-фактура“).
 *
 * PREPARATION ONLY: nothing is sent to УЈП (the public e-Фактура system is not open yet).
 * POST (a form on the Е-Фактура screen) — it writes the export marker; the session cookie is `SameSite=Lax`, so other
 * sites cannot post here with it. Needs `write` on the current firm.
 */
import { and, between, eq, inArray, sql } from 'drizzle-orm';
import { can } from '@wise/core';
import { einvoiceBuyerProblems, einvoiceSellerProblems } from '@wise/core/finance';
import { ublCheck } from '@wise/core/sales';
import { audit, invoices, type Invoice } from '@wise/db';
import { FirmChanged, getUser, YearChanged } from '@/lib/auth';
import { currentFirm } from '@/lib/context';
import { db } from '@/lib/db';
import { zipFiles } from '@/lib/docx';
import { isDate } from '@/lib/finance';
import { dmy, toCsv, todayIso } from '@/lib/fmt';
import { buildUbl, firmBank, ublFileName } from '@/lib/ubl';

const MAX = 2000;
const txt = (s: string, status = 400) => new Response(s, { status, headers: { 'content-type': 'text/plain; charset=utf-8' } });

export async function POST(req: Request) {
  const u = await getUser();
  if (!u) return txt('Најавете се повторно.', 401);
  let firm: Awaited<ReturnType<typeof currentFirm>>;
  try { firm = await currentFirm(u); } catch (e) {
    if (e instanceof FirmChanged || e instanceof YearChanged) return txt(e.message, 409);
    throw e;
  }
  if (!firm) return txt('Изберете фирма.');
  if (!can(u.principal, 'write', firm.id)) return txt('Немате право за извоз.', 403);
  const f = await req.formData();
  if (String(f.get('fid') ?? '') !== firm.id) return txt('Во друг прозорец е избрана друга фирма – освежете ја страната.', 409);
  const sel = String(f.get('sel') ?? '');
  const from = String(f.get('from') ?? '');
  const to = String(f.get('to') ?? '');
  const base = and(eq(invoices.firmId, firm.id), inArray(invoices.kind, ['invoice', 'credit']));
  let list: Invoice[];
  if (sel === 'ids') {
    const ids = f.getAll('id').map(String).filter((x) => /^[0-9a-f-]{36}$/i.test(x)).slice(0, MAX);
    if (!ids.length) return txt('Штиклирајте барем една фактура.');
    list = await db().select().from(invoices).where(and(base, inArray(invoices.id, ids)));
  } else if (sel === 'period' || sel === 'unsent') {
    if (!isDate(from) || !isDate(to) || from > to) return txt('Внесете важечки период (од – до).');
    list = await db().select().from(invoices).where(and(base, between(invoices.date, from, to),
      sel === 'unsent' ? and(eq(invoices.status, 'posted'), sql`(${invoices.data} -> 'efExport') is null and (${invoices.data} -> 'cancelled') is null`) : undefined)).limit(MAX + 1);
    if (list.length > MAX) return txt(`Повеќе од ${MAX} фактури – скратете го периодот.`);
  } else return txt('Непознат избор.');
  if (!list.length) return txt(sel === 'unsent' ? 'Нема неизвезени фактури во периодот.' : 'Нема фактури за избраниот период.', 404);
  list.sort((a, b) => a.date.localeCompare(b.date) || a.number.localeCompare(b.number, 'mk', { numeric: true }));

  const seller = einvoiceSellerProblems({ edb: firm.edb, bank: firmBank(firm) });
  const docs = await buildUbl(firm, list);
  const files: { name: string; data: string }[] = [];
  const rows: (string | number)[][] = [['Број', 'Датум', 'Вид', 'Купувач', 'ЕДБ', 'Износ', 'Валута', 'Статус', 'Датотека / причина']];
  const ok: string[] = [];
  for (const { inv, partner, xml } of docs) {
    const E: string[] = [...seller];
    const d = inv.data ?? {};
    if (d.cancelled) E.push('сторнирана');
    else if (inv.status !== 'posted') E.push(inv.status === 'pending' ? 'чека одобрување' : 'не е книжена (нацрт)');
    if (!partner) E.push('нема купувач');
    else if (!partner.foreign) E.push(...einvoiceBuyerProblems(partner).map((x) => 'купувач: ' + x));
    for (const x of ublCheck(xml, { sellerVat: firm.vatRegistered, domesticBuyer: !partner?.foreign })) if (!E.includes(x)) E.push(x);
    const name = ublFileName(inv.number).replace(/\.xml$/, '') + (inv.kind === 'credit' ? '_KO' : '') + '.xml';
    if (!E.length) { files.push({ name, data: xml }); ok.push(inv.id); }
    rows.push([inv.number, dmy(inv.date), inv.kind === 'credit' ? 'Книжно одобрение' : 'Фактура', partner?.name ?? '', partner?.edb ?? '',
      Number(inv.total).toFixed(2), inv.currency, E.length ? 'НЕ Е ИЗВЕЗЕНА' : 'извезена', E.length ? E.join('; ') : name]);
  }
  const at = new Date().toISOString();
  await db().transaction(async (tx) => {
    if (ok.length) {
      await tx.update(invoices).set({
        data: sql`jsonb_set(${invoices.data}, '{efExport}', jsonb_build_object('at', ${at}::text, 'by', ${u.id}::text, 'n', coalesce((${invoices.data}->'efExport'->>'n')::int, 0) + 1))`,
        // the export marker is not an edit of the invoice
        updatedAt: sql`${invoices.updatedAt}`,
      }).where(and(eq(invoices.firmId, firm.id), inArray(invoices.id, ok)));
    }
    await audit(tx, { userId: u.id, firmId: firm.id, action: 'efExport', entityType: 'firm', entityId: firm.id,
      data: { sel, from: sel === 'ids' ? null : from, to: sel === 'ids' ? null : to, selected: docs.length, exported: ok.length, failed: docs.length - ok.length } });
  });
  const zip = zipFiles([...files, { name: 'lista.csv', data: toCsv(rows) }]);
  const nm = `eFaktura_${(firm.edb || firm.name).replace(/[^\p{L}\p{N}]+/gu, '_')}_${sel === 'ids' ? todayIso() : from + '_' + to}.zip`;
  return new Response(new Uint8Array(zip), {
    headers: {
      'content-type': 'application/zip',
      'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(nm)}`,
      'x-ef-exported': String(ok.length), 'x-ef-failed': String(docs.length - ok.length),
    },
  });
}
