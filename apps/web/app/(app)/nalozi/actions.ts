'use server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { audit, deleteJournal, firms, isIsoDate, journals, postJournal, updateJournal } from '@wise/db';
import { actionError, firmAction, type ActionState } from '@/lib/books';
import { db } from '@/lib/db';

const amount = z.union([z.string(), z.number()]).transform((v) => String(v).trim().replace(/\s/g, '').replace(',', '.'))
  .refine((s) => s === '' || Number.isFinite(Number(s)), 'Неважечки износ.');
const Row = z.object({
  account: z.string().trim().max(10), partnerId: z.string().trim().max(40).optional().default(''),
  debit: amount, credit: amount, note: z.string().trim().max(500).optional().default(''), doc: z.string().trim().max(100).optional().default(''),
});
const JournalInput = z.object({
  id: z.string().optional().default(''),
  number: z.string().trim().max(30).optional().default(''),
  date: z.string().refine(isIsoDate, 'Неважечки датум.'),
  description: z.string().trim().max(500).optional().default(''),
  periodFrom: z.string().optional().default(''),
  periodTo: z.string().optional().default(''),
  rows: z.array(Row).max(2000),
});

/** Kinds whose journals belong to a source document and are edited through that document, not here. */
const fromDocument = (sourceType: string | null) => !!sourceType && !['opening', 'bbimp', 'yearClose'].includes(sourceType);

/**
 * Save a manual journal (legacy `saveJ` 7258 + checks 12981 + period 13463/13464 + number 13475/13476).
 * New manual journals need `write`; correcting an existing non-manual journal needs `nalEdit` (`fix`).
 * FIX(#9): existing manual journals are edited in place (same id and number) instead of creating a new one.
 */
export async function saveJournal(_prev: ActionState, form: FormData): Promise<ActionState> {
  let target = '';
  try {
    const parsed = JournalInput.safeParse(JSON.parse(String(form.get('payload') ?? '{}')));
    if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Неважечки податоци.' };
    const v = parsed.data;
    if (v.periodFrom && !isIsoDate(v.periodFrom)) return { error: 'Неважечки датум „период од“.' };
    if (v.periodTo && !isIsoDate(v.periodTo)) return { error: 'Неважечки датум „период до“.' };
    if (v.periodFrom && v.periodTo && v.periodTo < v.periodFrom) return { error: 'Периодот „до“ е пред „од“.' };
    const R = v.rows.filter((r) => r.account || Number(r.debit) || Number(r.credit));
    if (!R.some((r) => Number(r.debit) || Number(r.credit))) return { error: 'Внесете износи во колоните Должи / Побарува.' };
    if (R.some((r) => (Number(r.debit) || Number(r.credit)) && !r.account)) return { error: 'Изберете конто во секој ред со износ.' };

    const existing = v.id
      ? (await db().select().from(journals).where(eq(journals.id, v.id)).limit(1))[0]
      : undefined;
    if (v.id && !existing) return { error: 'Налогот не постои.' };
    const { u, firm } = await firmAction(existing && existing.kind !== 'manual' ? 'nalEdit' : 'write');
    if (existing && existing.firmId !== firm.id) return { error: 'Налогот не е од избраната фирма.' };
    if (existing && fromDocument(existing.sourceType)) return { error: 'Налогот е креиран од документ – поправете го самиот документ.' };

    const input = {
      firmId: firm.id, date: v.date, kind: existing?.kind ?? 'manual', description: v.description || 'Рачен налог',
      number: v.number || (existing ? existing.number : null), periodFrom: v.periodFrom || null, periodTo: v.periodTo || null,
      lines: R.map((r) => ({ account: r.account, debit: r.debit, credit: r.credit, partnerId: r.partnerId || null, note: r.note, doc: r.doc })),
      userId: u.id, auditAction: existing ? 'nalSave' : 'saveJ',
    };
    const res = await db().transaction((tx) => (existing ? updateJournal(tx, existing.id, input) : postJournal(tx, input)));
    target = res.number;
  } catch (e) { return actionError(e); }
  revalidatePath('/nalozi');
  redirect(`/nalozi?n=${encodeURIComponent(target)}`);
}

/** Delete one journal (legacy `nalDel`, needs `del`). Journals created from documents are removed with their document. */
export async function deleteJournalAction(id: string): Promise<ActionState> {
  try {
    const { u, firm } = await firmAction('nalDel');
    const [j] = await db().select().from(journals).where(and(eq(journals.id, id), eq(journals.firmId, firm.id))).limit(1);
    if (!j) return { error: 'Налогот не постои.' };
    if (fromDocument(j.sourceType)) return { error: 'Налогот е креиран од документ – избришете го документот.' };
    await db().transaction((tx) => deleteJournal(tx, { firmId: firm.id, journalId: id, userId: u.id }));
  } catch (e) { return actionError(e); }
  revalidatePath('/nalozi');
  return { ok: 'Налогот е избришан.' };
}

/**
 * Numbering settings (legacy `nalogMode` / `nalogPer` / `nalPayPer` / `nalCodes`, saved with `saveFirmPatch`).
 * Needs `settings`. Numbers already posted never change (they are persisted).
 */
export async function saveNalogSettings(form: FormData): Promise<void> {
  const { u, firm } = await firmAction('settings');
  const s = { ...(firm.settings ?? {}) } as Record<string, unknown>;
  const mode = form.get('nalogMode') === 'doc' ? 'doc' : 'period';
  const per = form.get('nalogPer') === 'month' ? 'month' : 'quarter';
  const pay = form.get('nalPayPer') === 'year' ? 'year' : 'month';
  const codes: Record<string, string> = {};
  for (const [k, v] of form.entries()) if (k.startsWith('nc_') && String(v).trim()) codes[k.slice(3)] = String(v).trim().slice(0, 12);
  Object.assign(s, { nalogMode: mode, nalogPer: per, nalPayPer: pay, nalCodes: codes });
  await db().transaction(async (tx) => {
    await tx.update(firms).set({ settings: s }).where(eq(firms.id, firm.id));
    await audit(tx, { userId: u.id, firmId: firm.id, action: 'saveNalCodes', entityType: 'firm', entityId: firm.id, data: { nalogMode: mode, nalogPer: per, nalPayPer: pay, nalCodes: codes } });
  });
  revalidatePath('/nalozi');
}

/**
 * Period lock (legacy `lockYear` 7382 / `firmUnlock` 17021).
 * FIX(#11): legacy let anyone lock (no ACT_NEED, no audit) while only admin could unlock, one year back.
 * Locking and unlocking now both need the `close` permission and are audited.
 */
export async function setLockDate(form: FormData): Promise<void> {
  const { u, firm } = await firmAction('close');
  const d = String(form.get('lockDate') ?? '').trim();
  const lockDate = d && isIsoDate(d) ? d : null;
  await db().transaction(async (tx) => {
    await tx.update(firms).set({ lockDate }).where(eq(firms.id, firm.id));
    await audit(tx, { userId: u.id, firmId: firm.id, action: lockDate && (!firm.lockDate || lockDate > firm.lockDate) ? 'lockYear' : 'firmUnlock',
      entityType: 'firm', entityId: firm.id, data: { from: firm.lockDate, to: lockDate } });
  });
  revalidatePath('/', 'layout');
}
