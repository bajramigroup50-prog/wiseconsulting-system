'use server';
/**
 * „Нова услужна калкулација“ like the old program (Helix): the dialog of the Излез list saves the HEADER of an outgoing
 * invoice — „Во ред (F9)“ on a new one opens an unissued draft (header first, no lines yet: `saveInvoice` with
 * `draft`) and its lines are entered in the editor („Содржина“); „Промена (Ent)“ changes the header of an existing
 * invoice and keeps its lines (re-booked in place when it was booked). Header fields WISE has no column for are kept in
 * the invoice's `data` (ОЕ, По документ, Архивски број, Денови, Обработка, Платен аванс, Начин на плаќање, Салдо,
 * Раб. налог, Прилог, Опис, Група 1 / 2, Тип на трошок, Забелешка за финансово, налог за книжење, шема).
 */
import { revalidatePath } from 'next/cache';
import { and, asc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { addDays, nextDocNumber } from '@wise/core/sales';
import { invoiceAdvances, invoiceLines, invoices, PostingError, saveInvoice, type InvoiceData } from '@wise/db';
import { actionError, firmAction, type ActionState } from '@/lib/books';
import { db } from '@/lib/db';
import { actorOf } from '@/lib/sales';

const date = z.string().trim().regex(/^(\d{4}-\d{2}-\d{2})?$/, 'Неважечки датум.');
const txt = (n: number) => z.string().trim().max(n).default('');

/** The header fields of the dialog (FormData names). */
const Head = z.object({
  id: z.string().trim().max(40).default(''),
  number: txt(40), nalogNo: txt(40), oe: txt(40), partnerId: z.string().trim().max(40).default(''),
  refDoc: txt(60), archNo: txt(60), date: date.refine((s) => !!s, 'Внесете датум.'), days: z.string().trim().regex(/^\d{0,4}$/, 'Деновите се цел број.').default(''),
  due: date.default(''), procDate: date.default(''), scheme: z.string().trim().regex(/^\d{0,3}$/).default(''),
  currency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/, 'Неважечка валута.').default('MKD'), fx: z.string().trim().max(20).default('1'),
  advPaid: z.string().trim().max(20).default(''), payMethod: txt(40), saldo: z.enum(['Д', 'Н']).default('Н'), tip: z.enum(['final', 'advance']).default('final'),
  note1: txt(500), note2: txt(500), note3: txt(500), workOrder: txt(60), attachNote: txt(200), descr: txt(2000),
  grp1: txt(60), grp2: txt(60), costType: txt(60), finNote: txt(500), art32: z.string().optional(), svc: z.string().optional(),
});
type HeadIn = z.infer<typeof Head>;

/** The `data` keys written by the dialog (others on the invoice are kept). */
const DATA_KEYS = ['nalogNo', 'oe', 'refDoc', 'archNo', 'days', 'procDate', 'scheme', 'advPaid', 'payMethod', 'saldo', 'workOrder', 'attachNote', 'descr', 'grp1', 'grp2', 'costType', 'finNote'] as const;

const headData = (h: HeadIn): Record<string, string> => {
  const d: Record<string, string> = {};
  for (const k of DATA_KEYS) if (h[k]) d[k] = h[k];
  // „Салдо“ is always written (Да / Не)
  d.saldo = h.saldo;
  return d;
};

/** „Напомена“ of the old program: three lines → the invoice note. */
const noteOf = (h: HeadIn) => [h.note1, h.note2, h.note3].map((x) => x.trim()).filter(Boolean).join('\n');

/** F5 „генератор“: the next free invoice number of the year of `date`. */
export async function nextInvoiceNumberAction(date: string): Promise<{ no?: string; error?: string }> {
  try {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { error: 'Внесете датум.' };
    const { firm } = await firmAction('saveInv');
    const yr = date.slice(0, 4);
    const used = (await db().select({ n: invoices.number }).from(invoices)
      .where(and(eq(invoices.firmId, firm.id), eq(invoices.kind, 'invoice'), sql`${invoices.date} between ${yr + '-01-01'} and ${yr + '-12-31'}`))).map((r) => r.n);
    return { no: nextDocNumber(used, yr) };
  } catch (e) { return actionError(e); }
}

/**
 * „Во ред (F9)“: a new header → an unissued draft invoice (`?edit=<id>&drafted=1` opens its lines); an existing one →
 * its header changed, lines / advances kept. A production invoice („🏭“) is changed in the invoice itself.
 */
export async function saveInvoiceHeadAction(_p: ActionState, form: FormData): Promise<ActionState & { id?: string; number?: string; warn?: string }> {
  try {
    const p = Head.safeParse(Object.fromEntries([...form.entries()].map(([k, v]) => [k, String(v)])));
    if (!p.success) return { error: p.error.issues[0]?.message ?? 'Неважечки податоци.' };
    const h = p.data;
    if (!h.partnerId) return { error: 'Изберете комитент (F8).' };
    const due = h.due || (h.days ? addDays(h.date, h.days) : '');
    const fx = h.currency === 'MKD' ? '1' : h.fx.replace(',', '.');
    const id = h.id || null;
    const { u, firm } = await firmAction(id ? 'editInv' : 'saveInv');
    const res = await db().transaction(async (tx) => {
      if (!id) {
        return saveInvoice(tx, firm.id, {
          kind: 'invoice', number: h.number || null, date: h.date, pdate: h.date, due: due || null, partnerId: h.partnerId,
          currency: h.currency, fx, art32: h.art32 === '1', advance: h.tip === 'advance', svc: h.svc === '1', note: noteOf(h) || null,
          data: headData(h) as InvoiceData, lines: [], draft: true,
        }, actorOf(u));
      }
      const [inv] = await tx.select().from(invoices).where(and(eq(invoices.id, id), eq(invoices.firmId, firm.id))).limit(1);
      if (!inv || inv.kind !== 'invoice') throw new PostingError('not_found', 'Документот не постои.');
      const D = (inv.data ?? {}) as InvoiceData;
      if (D.prodRun?.orders?.length || D.prodRun?.lines?.length) {
        throw new PostingError('not_found', 'Фактура со производство (🏭): заглавјето се менува во самата фактура – „Содржина (F10)“.');
      }
      const [L, A] = await Promise.all([
        tx.select().from(invoiceLines).where(eq(invoiceLines.invoiceId, id)).orderBy(asc(invoiceLines.lineNo)),
        tx.select().from(invoiceAdvances).where(eq(invoiceAdvances.invoiceId, id)),
      ]);
      // the dialog's keys replace the old ones (an emptied field is removed); everything else on the invoice is kept
      const kept = Object.fromEntries(Object.entries(D).filter(([k]) => !(DATA_KEYS as readonly string[]).includes(k)));
      return saveInvoice(tx, firm.id, {
        id, kind: 'invoice', number: h.number || inv.number, date: h.date, pdate: inv.pdate && inv.pdate !== inv.date ? inv.pdate : h.date, due: due || null,
        partnerId: h.partnerId, warehouseId: inv.warehouseId, art32: h.art32 === '1', advance: h.tip === 'advance', export: inv.export, svc: inv.svc,
        currency: h.currency, fx, fromDocId: inv.fromDocId, note: noteOf(h) || null, scanned: inv.scanned,
        data: { ...kept, ...headData(h) } as InvoiceData,
        lines: L.map((l) => ({ itemId: l.itemId, code: l.code, name: l.name, unit: l.unit, qty: l.qty, price: l.price, disc: l.disc, rate: l.rate, account: l.account, vatFix: l.vatFix })),
        advances: A.map((a) => ({ advanceId: a.advanceId, amount: a.amount })),
        draft: inv.status === 'draft',
      }, actorOf(u));
    });
    revalidatePath('/', 'layout');
    return {
      ok: id ? `Податоците на фактурата ${res.number} се зачувани.` : `Отворена е фактура ${res.number} – внесете ги ставките.`,
      id: res.id, number: res.number, ...(res.warnings.length ? { warn: res.warnings.join(' | ') } : {}),
    };
  } catch (e) { return actionError(e); }
}
