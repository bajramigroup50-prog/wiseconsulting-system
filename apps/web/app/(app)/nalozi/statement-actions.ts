'use server';
/**
 * Statement work inside an open bank nalog („Изводи во налогот“): the per-line actions are the ones of /banka
 * (`setKontoAction`, `setPartnerAction`, `linkLineAction`, `flipLineAction`, `deleteLineAction`,
 * `updateStatementAction`); here only what /banka has no action for — the bulk save (re-posting every touched
 * statement once) and the open documents of one line for the in-nalog invoice picker.
 */
import { z } from 'zod';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { bankEffKonto } from '@wise/core';
import {
  acceptLinks, bankAccounts, BankError, bankLines, bankStatements, deleteLine, journalLines, journals, lineOpenDocs, proposeLinks, setLinesBulk, toBankRow, type Tx,
} from '@wise/db';
import { firmAction } from '@/lib/books';
import { bankError, bankRun, str } from '@/lib/bank';
import { db } from '@/lib/db';
import { bankLineOf } from '@/lib/nalog-grid';
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

/* ---------------- nalog grid of a bank nalog: „Бришење (Del)“, „Масовно затворање“ ---------------- */

/** „Бришење (Del)“ on a line of a statement journal: deletes the statement line (needs `del`); the statement is re-posted. */
export async function deleteNalogBankLineAction(journalLineId: number): Promise<FormState> {
  return bankRun('del', P, async ({ tx, u, firm }) => {
    const [x] = await tx.select({ l: journalLines, j: journals }).from(journalLines).innerJoin(journals, eq(journals.id, journalLines.journalId))
      .where(and(eq(journalLines.id, Number(journalLineId)), eq(journalLines.firmId, firm.id))).limit(1);
    if (!x) throw new BankError('Ставката не постои.');
    if (x.j.sourceType !== 'bank_statement' || !x.j.sourceId) throw new BankError('Ставката не е од извод.');
    const [st] = await tx.select().from(bankStatements).where(and(eq(bankStatements.id, x.j.sourceId), eq(bankStatements.firmId, firm.id))).limit(1);
    if (!st) throw new BankError('Изводот не постои.');
    const [acct] = await tx.select({ konto: bankAccounts.konto }).from(bankAccounts).where(eq(bankAccounts.id, st.bankAccountId)).limit(1);
    const BL = await tx.select().from(bankLines).where(eq(bankLines.statementId, st.id));
    const hit = bankLineOf({ account: x.l.account, debit: Number(x.l.debit), credit: Number(x.l.credit), partnerId: x.l.partnerId },
      BL.map((l) => ({ id: l.id, amount: Number(l.amount), partnerId: l.partnerId, konto: l.konto || (l.refId ? bankEffKonto(toBankRow(l)) : '') })), acct?.konto ?? '');
    if ('error' in hit) throw new BankError(hit.error);
    await deleteLine(tx, { firmId: firm.id, userId: u.id, lineId: hit.id });
    return 'Ставката е избришана од изводот; налогот е прекнижан.';
  });
}

const MASS_K = /^(1200|1210|2200|2210)$/;
async function massLines(tx: Tx, firmId: string, statementIds: string[], konto: string) {
  const S = z.array(ID).max(500).parse(statementIds);
  if (!MASS_K.test(konto)) throw new BankError('Неважечко конто.');
  if (!S.length) return [];
  const L = await tx.select().from(bankLines).where(and(eq(bankLines.firmId, firmId), inArray(bankLines.statementId, S), isNull(bankLines.refId)));
  return L.filter((l) => (l.konto ?? '').startsWith(konto) && !!l.partnerId);
}

/**
 * „Масовно затворање 1200 / 1210 / 2200 / 2210“ (preview): the payments of the nalog's statements booked on that konto
 * without a document get link proposals (reference / number → amount → FIFO — the /bkAdv „Поврзување“ logic).
 */
export async function massClosePreviewAction(statementIds: string[], konto: string): Promise<{ error?: string; text?: string; n?: number }> {
  let n = 0;
  const r = await bankRun('write', [], async ({ tx, u, firm }) => {
    const L = await massLines(tx, firm.id, statementIds, konto);
    const prop = L.length ? await proposeLinks(tx, { firmId: firm.id, userId: u.id, lineIds: L.map((l) => l.id) }) : [];
    n = prop.length;
    if (!prop.length) return `Нема плаќања на ${konto} без фактура што може да се затворат (${L.length} без документ).`;
    const by = new Map(L.map((l) => [l.id, l]));
    const rows = prop.slice(0, 30).map((p) => {
      const l = by.get(p.lineId)!;
      return `• ${l.date.split('-').reverse().join('.')} ${(l.name || l.description).slice(0, 40)} ${Math.abs(Number(l.amount)).toFixed(2)} → ${p.refs.map((x) => x.label).join(', ')}${p.excess ? ` (аванс ${p.excess.toFixed(2)})` : ''}`;
    });
    return `Ќе се поврзат ${prop.length} плаќања на ${konto} со отворените фактури:\n${rows.join('\n')}${prop.length > 30 ? `\n… и уште ${prop.length - 30}` : ''}`;
  });
  return r.error ? { error: r.error } : { n, text: r.ok ?? '' };
}

/** „Масовно затворање“ (apply): accepts the proposals of those payments; each statement is re-posted once. */
export async function massCloseAction(statementIds: string[], konto: string): Promise<FormState> {
  return bankRun('write', [...P, '/kartici'], async ({ tx, u, firm }) => {
    const L = await massLines(tx, firm.id, statementIds, konto);
    const prop = L.length ? await proposeLinks(tx, { firmId: firm.id, userId: u.id, lineIds: L.map((l) => l.id) }) : [];
    if (!prop.length) return 'Нема што да се затвори.';
    const r = await acceptLinks(tx, { firmId: firm.id, userId: u.id, lineIds: prop.map((p) => p.lineId) });
    return `Затворени ${r.linked} плаќања на ${konto} (${r.statements} изводи прекнижани).` + (r.skipped.length ? ` Прескокнати ${r.skipped.length}: ${[...new Set(r.skipped.map((s) => s.why))].join('; ')}.` : '');
  });
}
