'use server';
/**
 * Statement work inside an open bank nalog („Изводи во налогот“): the per-line actions are the ones of /banka
 * (`setKontoAction`, `setPartnerAction`, `linkLineAction`, `flipLineAction`, `deleteLineAction`,
 * `updateStatementAction`); here only what /banka has no action for — the bulk save (re-posting every touched
 * statement once) and the open documents of one line for the in-nalog invoice picker.
 */
import { z } from 'zod';
import { lineOpenDocs, setLinesBulk } from '@wise/db';
import { firmAction } from '@/lib/books';
import { bankError, bankRun, str } from '@/lib/bank';
import { db } from '@/lib/db';
import type { FormState } from '@/components/bank-form';

const P = ['/nalozi', '/banka', '/devizni', '/bkAdv'];
const ID = z.string().regex(/^[0-9a-f-]{36}$/i);
const Items = z.array(z.object({
  lineId: ID,
  konto: z.string().trim().max(10).nullish(),
  partnerId: ID.nullish().or(z.literal('').transform(() => null)),
})).min(1).max(1000);

/** „Зачувај ги сите промени“: the edited lines only (konto / partner), each statement re-posted once. */
export async function saveStatementLinesAction(_p: FormState, form: FormData): Promise<FormState> {
  let items: z.infer<typeof Items>;
  try { items = Items.parse(JSON.parse(str(form.get('items')) || '[]')); } catch { return { error: 'Нема променети ставки.' }; }
  return bankRun('write', P, async ({ tx, u, firm }) => {
    const r = await setLinesBulk(tx, {
      firmId: firm.id, userId: u.id,
      items: items.map((i) => ({ lineId: i.lineId, konto: i.konto ? i.konto.split(/\s/)[0]! : null, partnerId: i.partnerId ?? null })),
    });
    return `Зачувани ${r.lines} ставки; прекнижани ${r.statements} изводи.`;
  });
}

export interface LineDoc { id: string; number: string; date: string; partnerId: string | null; konto: string; open: number; fifo: boolean }

/** Open invoices a line can close (the picker of /banka „Затвори фактури“), loaded only when the picker is opened. */
export async function lineDocsAction(lineId: string): Promise<{ error?: string; docs?: LineDoc[]; type?: string }> {
  try {
    const { firm, year } = await firmAction('write');
    const D = await db().transaction((tx) => lineOpenDocs(tx, firm.id, year, lineId));
    return {
      type: D.type,
      docs: D.docs.map((d) => ({ id: d.doc.id, number: d.doc.number ?? '', date: d.doc.date, partnerId: d.doc.partner ?? null, konto: d.doc.konto ?? '', open: d.open / 100, fifo: D.fifo.includes(d.doc.id) })),
    };
  } catch (e) {
    if (e instanceof Error && 'digest' in e) throw e;
    return bankError(e);
  }
}
