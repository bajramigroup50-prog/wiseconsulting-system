'use server';
/**
 * „Масовно доделување“ of the old program (Специјални опции of Излез / Влез): the ticked documents get the same
 * Терк (шема за книжење) and налог, комитент, датум and валута (рок) at once. Only the fields filled in the dialog
 * change; a booked document is re-booked (its nalog follows). Outgoing invoices are re-saved through `saveInvoice`
 * (stock, VAT, nalog together); incoming calculations change their header and are re-posted – their date only when they
 * move no stock (a stock calculation's date is changed in the calculation itself). Each document that cannot be changed
 * is reported with the reason; the others are saved.
 */
import { revalidatePath } from 'next/cache';
import { and, asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { audit, invoiceAdvances, invoiceLines, invoices, partners, purchaseStockLines, purchases, repostPurchase, saveInvoice, type InvoiceData } from '@wise/db';
import { actionError, firmAction, type ActionState } from '@/lib/books';
import { db } from '@/lib/db';
import { actorOf } from '@/lib/sales';

const Patch = z.object({
  nalogNo: z.string().trim().max(40).optional(),
  scheme: z.string().trim().regex(/^\d{0,3}$/, 'Теркот е број (1, 2, 3…).').optional(),
  partnerId: z.string().trim().max(40).optional(),
  date: z.string().trim().regex(/^(\d{4}-\d{2}-\d{2})?$/, 'Неважечки датум.').optional(),
  due: z.string().trim().regex(/^(\d{4}-\d{2}-\d{2})?$/, 'Неважечка валута (рок).').optional(),
});
export type MassPatch = z.input<typeof Patch>;

/** Fields actually given (an empty field = not changed). */
const given = (p: z.infer<typeof Patch>) => Object.fromEntries(Object.entries(p).filter(([, v]) => v != null && v !== '')) as Partial<Record<keyof z.infer<typeof Patch>, string>>;

export async function massAssignAction(kind: 'invoice' | 'purchase', ids: string[], patch: MassPatch): Promise<ActionState & { n?: number; skipped?: string[] }> {
  try {
    const parsed = Patch.safeParse(patch);
    if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Неважечки податоци.' };
    const P = given(parsed.data);
    if (!Object.keys(P).length) return { error: 'Пополнете барем едно поле (терк, налог, комитент, датум или валута).' };
    const list = [...new Set(ids.filter((x) => /^[0-9a-f-]{36}$/i.test(x)))].slice(0, 500);
    if (!list.length) return { error: 'Штиклирајте ги документите (клик на квадратчето или „+“).' };
    const { u, firm } = await firmAction(kind === 'invoice' ? 'editInv' : 'editPur');
    if (P.partnerId) {
      const [p] = await db().select({ id: partners.id }).from(partners).where(and(eq(partners.id, P.partnerId), eq(partners.firmId, firm.id))).limit(1);
      if (!p) return { error: 'Комитентот не постои.' };
    }
    let n = 0;
    const skipped: string[] = [];
    for (const id of list) {
      try {
        await db().transaction(async (tx) => {
          if (kind === 'invoice') {
            const [inv] = await tx.select().from(invoices).where(and(eq(invoices.id, id), eq(invoices.firmId, firm.id))).limit(1);
            if (!inv) throw new Skip('не постои');
            const D = (inv.data ?? {}) as InvoiceData & Record<string, unknown>;
            if (D.prodRun?.orders?.length || D.prodRun?.lines?.length) throw new Skip(`${inv.number}: фактура со производство – се менува во самата фактура`);
            const [L, A] = await Promise.all([
              tx.select().from(invoiceLines).where(eq(invoiceLines.invoiceId, id)).orderBy(asc(invoiceLines.lineNo)),
              tx.select().from(invoiceAdvances).where(eq(invoiceAdvances.invoiceId, id)),
            ]);
            const data = { ...D, ...(P.nalogNo ? { nalogNo: P.nalogNo } : {}), ...(P.scheme ? { scheme: P.scheme } : {}) } as InvoiceData;
            const date = P.date ?? inv.date;
            await saveInvoice(tx, firm.id, {
              id, kind: inv.kind, number: inv.number, date, pdate: P.date ? (inv.pdate && inv.pdate !== inv.date ? inv.pdate : date) : inv.pdate, due: P.due ?? inv.due,
              partnerId: P.partnerId ?? inv.partnerId, warehouseId: inv.warehouseId, art32: inv.art32, advance: inv.advance, export: inv.export, svc: inv.svc,
              currency: inv.currency, fx: inv.fx, fromDocId: inv.fromDocId, note: inv.note, scanned: inv.scanned, data,
              lines: L.map((l) => ({ itemId: l.itemId, code: l.code, name: l.name, unit: l.unit, qty: l.qty, price: l.price, disc: l.disc, rate: l.rate, account: l.account, vatFix: l.vatFix })),
              advances: A.map((a) => ({ advanceId: a.advanceId, amount: a.amount })),
              draft: inv.status === 'draft',
            } as Parameters<typeof saveInvoice>[2], actorOf(u));
            await audit(tx, { userId: u.id, firmId: firm.id, action: 'massAssign', entityType: 'invoice', entityId: id, data: { number: inv.number, ...P } });
          } else {
            const [pur] = await tx.select().from(purchases).where(and(eq(purchases.id, id), eq(purchases.firmId, firm.id))).limit(1);
            if (!pur) throw new Skip('не постои');
            if (P.date && P.date !== pur.date) {
              const [st] = await tx.select({ id: purchaseStockLines.id }).from(purchaseStockLines).where(eq(purchaseStockLines.purchaseId, id)).limit(1);
              if (st) throw new Skip(`${pur.number}: калкулација со залиха – датумот се менува во самата калкулација`);
            }
            const D = (pur.data ?? {}) as Record<string, unknown>;
            await tx.update(purchases).set({
              ...(P.partnerId ? { partnerId: P.partnerId } : {}), ...(P.date ? { date: P.date } : {}), ...(P.due ? { due: P.due } : {}),
              ...(P.nalogNo || P.scheme ? { data: { ...D, ...(P.nalogNo ? { nalogNo: P.nalogNo } : {}), ...(P.scheme ? { scheme: Number(P.scheme) } : {}) } as typeof pur.data } : {}),
            }).where(eq(purchases.id, id));
            await repostPurchase(tx, firm, id, u.id);
            await audit(tx, { userId: u.id, firmId: firm.id, action: 'massAssign', entityType: 'purchase', entityId: id, data: { number: pur.number, ...P } });
          }
        });
        n++;
      } catch (e) {
        if (e instanceof Skip) { skipped.push(e.message); continue; }
        const m = actionError(e).error;
        skipped.push(m ?? 'грешка');
      }
    }
    revalidatePath(kind === 'invoice' ? '/izlez' : '/vlez');
    revalidatePath('/nalozi');
    const what = Object.keys(P).map((k) => ({ nalogNo: 'налог', scheme: 'терк', partnerId: 'комитент', date: 'датум', due: 'валута' } as Record<string, string>)[k]).join(', ');
    return { ok: `Доделено (${what}) на ${n} ${n === 1 ? 'документ' : 'документи'}.${skipped.length ? ` Не се променети ${skipped.length}.` : ''}`, n, skipped };
  } catch (e) { return actionError(e); }
}

class Skip extends Error {}

