'use server';
/**
 * „Обврски за плата од декември“ on Почетна состојба: the previous year's December payroll liabilities that the
 * January bank statement paid but the opening balance does not hold (`missingPayLiabilities`) – added to the opening
 * journal on Побарува 2340–2344 / 2401 against the chosen konto (default 950, the retained result), in one click.
 */
import { revalidatePath } from 'next/cache';
import { and, asc, eq } from 'drizzle-orm';
import { journalLines, journals, postJournal } from '@wise/db';
import { payLiabGaps } from './paylib-gaps';
import { actionError, firmAction, type ActionState } from '@/lib/books';
import { db } from '@/lib/db';

export async function addPayLiabToOpeningAction(_p: ActionState, form: FormData): Promise<ActionState> {
  try {
    const { u, firm, year } = await firmAction('write');
    const off = String(form.get('off') ?? '950').trim();
    if (!/^\d{3,8}$/.test(off)) return { error: 'Внесете конто за противставка (на пр. 950).' };
    const msg = await db().transaction(async (tx) => {
      const G = await payLiabGaps(tx, firm.id, year);
      if (!G.length) return null;
      const [ex] = await tx.select().from(journals).where(and(eq(journals.firmId, firm.id), eq(journals.sourceType, 'opening'), eq(journals.sourceId, `open-${year}`))).limit(1);
      const old = ex ? await tx.select().from(journalLines).where(eq(journalLines.journalId, ex.id)).orderBy(asc(journalLines.lineNo)) : [];
      const lines = old.map((l) => ({ account: l.account, debit: Number(l.debit), credit: Number(l.credit), partnerId: l.partnerId, note: l.note, doc: l.doc, locationId: l.locationId }));
      const tot = Math.round(G.reduce((a, g) => a + g.missing, 0) * 100) / 100;
      for (const g of G) lines.push({ account: g.account, debit: 0, credit: g.missing, partnerId: null, note: `Плата 12/${year - 1} (платено во ${year})`, doc: null, locationId: null });
      lines.push({ account: off, debit: tot, credit: 0, partnerId: null, note: `Обврски за плата 12/${year - 1}`, doc: null, locationId: null });
      const r = await postJournal(tx, {
        firmId: firm.id, date: ex?.date ?? `${year}-01-01`, kind: 'open', sourceType: 'opening', sourceId: `open-${year}`,
        description: ex?.description ?? `Почетна состојба ${year}`, lines, userId: u.id, requirePartner: false, auditAction: 'obPayLiab',
      });
      return `Додадени обврски за плата 12/${year - 1}: ${G.map((g) => `${g.account} ${g.missing.toLocaleString('mk-MK')}`).join(', ')} (вкупно ${tot.toLocaleString('mk-MK')} ден., противставка ${off}) – налог ${r.number}.`;
    });
    if (!msg) return { error: 'Нема обврски за плата што недостасуваат.' };
    revalidatePath('/pocetna');
    return { ok: msg };
  } catch (e) { return actionError(e); }
}
