'use server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { needsPartner } from '@wise/core';
import { audit, bankAccounts, deleteJournal, firms, isIsoDate, journals, postJournal, resetJournalOverride, saveJournalOverride, syncFirmBanks, updateJournal } from '@wise/db';
import { actionError, firmAction, type ActionState } from '@/lib/books';
import { db } from '@/lib/db';

const amount = z.union([z.string(), z.number()]).transform((v) => String(v).trim().replace(/\s/g, '').replace(',', '.'))
  .refine((s) => s === '' || Number.isFinite(Number(s)), 'Неважечки износ.');
const Row = z.object({
  account: z.string().trim().max(10), partnerId: z.string().trim().max(40).optional().default(''),
  debit: amount, credit: amount, note: z.string().trim().max(500).optional().default(''), doc: z.string().trim().max(100).optional().default(''),
});
const JournalInput = z.object({
  id: z.string().nullish().transform((s) => s ?? ''),
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
    // An opened nalog without amounts is allowed (legacy refused it); its konto rows are kept in `meta.rows` until amounts come.
    const empty = !R.some((r) => Number(r.debit) || Number(r.credit));
    if (empty && !R.some((r) => r.account)) return { error: 'Внесете барем едно конто или износи во колоните Должи / Побарува.' };
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
      // opening balances may carry 12x/22x rows without a partner (saveOpening allows them)
      requirePartner: !(existing && ['open', 'bbimp'].includes(existing.kind)),
      allowEmpty: empty,
      meta: { ...((existing?.meta as Record<string, unknown>) ?? {}), rows: empty ? R.map((r) => ({ account: r.account, partnerId: r.partnerId || null, note: r.note, doc: r.doc })) : undefined },
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

/* ---------------------------------------------------------------- finance parity: document journal corrections */

const OvRowZ = z.object({
  i: z.number().int().min(0).nullable(), account: z.string().trim().max(10), partnerId: z.string().trim().max(40).nullable(),
  debit: z.coerce.number().finite(), credit: z.coerce.number().finite(), note: z.string().max(500), doc: z.string().max(100), del: z.boolean(),
});

/**
 * Manual correction of a nalog created from a document (legacy `nalSave` → `nalSaveRows` 3580, needs `fix`):
 * the line edits are stored as an override of the source document and re-applied on every re-post.
 * New / changed lines on 120–128 / 220–228 need a partner (legacy 12457).
 */
export async function saveOverrideAction(journalId: string, rows: unknown): Promise<ActionState> {
  let target = '';
  try {
    const R = z.array(OvRowZ).max(2000).safeParse(rows);
    if (!R.success) return { error: 'Неважечки редови.' };
    const { u, firm } = await firmAction('nalEdit');
    const bad = R.data.find((r) => !r.del && (r.debit || r.credit) && !/^\d{3,8}$/.test(r.account));
    if (bad) return { error: `Неважечко конто „${bad.account}“.` };
    const np = R.data.find((r) => !r.del && (r.debit || r.credit) && needsPartner(r.account) && !r.partnerId);
    if (np) return { error: `Конто ${np.account} бара комитент.` };
    const res = await db().transaction((tx) => saveJournalOverride(tx, { firmId: firm.id, journalId, rows: R.data, userId: u.id }));
    target = res.number;
  } catch (e) { return actionError(e); }
  revalidatePath('/nalozi');
  redirect(`/nalozi?n=${encodeURIComponent(target)}`);
}

/** „↺ Врати како во документот“ — remove the correction (needs `fix`). */
export async function resetOverrideAction(journalId: string): Promise<ActionState> {
  try {
    const { u, firm } = await firmAction('nalEdit');
    await db().transaction((tx) => resetJournalOverride(tx, { firmId: firm.id, journalId, userId: u.id }));
  } catch (e) { return actionError(e); }
  revalidatePath('/nalozi');
  return { ok: 'Налогот е вратен како во документот.' };
}

/** Legacy „Шифри на налози“ per bank (`data-nb`, `saveNalCodes` 7183): nalog code of each bank account's statements. */
export async function saveBankNalCodes(form: FormData): Promise<void> {
  const { u, firm } = await firmAction('settings');
  const set: Record<string, string | null> = {};
  for (const [k, v] of form.entries()) if (k.startsWith('bc_')) set[k.slice(3)] = String(v).trim().slice(0, 12) || null;
  await db().transaction(async (tx) => {
    for (const [id, nal] of Object.entries(set)) await tx.update(bankAccounts).set({ nal }).where(and(eq(bankAccounts.id, id), eq(bankAccounts.firmId, firm.id)));
    await syncFirmBanks(tx, firm.id);
    await audit(tx, { userId: u.id, firmId: firm.id, action: 'saveNalCodes', entityType: 'firm', entityId: firm.id, data: { banks: set } });
  });
  revalidatePath('/nalozi');
}
