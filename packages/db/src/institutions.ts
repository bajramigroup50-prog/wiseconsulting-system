/**
 * „🏛 Институции – барања и плаќања“ — services (`@wise/core/office/institutions` holds the rules):
 * - `saveInstItem` / `setInstStatus` / `deleteInstItem`: the register of what institutions send / demand, audited;
 * - `startInstReads` / `applyInstReads`: the attached scan read by AI (`ai_documents` kind `inst`) fills the blank
 *   fields of the item (never overwrites what the office typed);
 * - `matchInstPayments`: an item with an amount is marked paid when a booked or imported bank-statement line of the
 *   firm pays it (amount + „повикување на број“ / account, `instPaymentMatch`), with the evidence note;
 * - `instFromIncoming`: a file of „📥 Пристигнати документи“ becomes an item (and is read).
 * The deadlines go to the deadline calendar (`rokovi` type `inst`, `loadRokFirms`) and to the autopilot (Известувања).
 */
import { and, eq, gte, inArray, isNull, lt, sql } from 'drizzle-orm';
import {
  instFromRead, instGuess, instPaidNote, instPaymentMatch, isInstId, isInstStatus, isInstType, type InstBankLine, type InstStatus,
} from '@wise/core/office/institutions';
import { addDays, todaySkopje } from '@wise/core/office/dates';
import { audit, type Tx } from './audit';
import { OfficeError } from './office';
import { aiDocuments, bankLines, bankStatements, fileLinks, files, INST_FILE_ENTITY, instItems, type InstItem } from './schema/index';

export interface InstInput {
  id?: string | null;
  inst: string; instName?: string | null; type: string; refNo?: string | null; docDate?: string | null; received?: string | null; due?: string | null;
  subject?: string | null; amount?: number | null; payRecip?: string | null; payAccount?: string | null; payUplSm?: string | null; payPrihod?: string | null;
  payRef?: string | null; payPurpose?: string | null; status?: string | null; assigneeId?: string | null; note?: string | null; source?: string | null;
  incomingId?: string | null;
}

const isDate = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
const t = (s: string | null | undefined, n = 500) => { const v = (s ?? '').trim(); return v ? v.slice(0, n) : null; };

/** Create / update an item of the firm; returns its id. */
export async function saveInstItem(tx: Tx, firmId: string, a: InstInput, userId: string | null): Promise<string> {
  if (!isInstId(a.inst)) throw new OfficeError('Изберете институција.');
  if (!isInstType(a.type)) throw new OfficeError('Изберете вид на документот.');
  const status = a.status && isInstStatus(a.status) ? a.status : undefined;
  if (a.amount != null && (!Number.isFinite(a.amount) || a.amount < 0)) throw new OfficeError('Неважечки износ.');
  if (a.due && a.received && isDate(a.due) && isDate(a.received) && a.due < a.received) throw new OfficeError('Рокот е пред датумот на прием.');
  const row = {
    inst: a.inst, instName: t(a.instName, 200), type: a.type, refNo: t(a.refNo, 80), docDate: isDate(a.docDate) ? a.docDate : null,
    received: isDate(a.received) ? a.received : null, due: isDate(a.due) ? a.due : null, subject: t(a.subject, 1000),
    amount: a.amount != null && a.amount > 0 ? a.amount.toFixed(2) : null, payRecip: t(a.payRecip, 200), payAccount: t(a.payAccount, 40), payUplSm: t(a.payUplSm, 40),
    payPrihod: t(a.payPrihod, 40), payRef: t(a.payRef, 80), payPurpose: t(a.payPurpose, 140), assigneeId: a.assigneeId || null, note: t(a.note, 4000),
    updatedBy: userId,
  };
  if (a.id) {
    const [r] = await tx.update(instItems).set({ ...row, ...(status ? { status } : {}) }).where(and(eq(instItems.id, a.id), eq(instItems.firmId, firmId))).returning({ id: instItems.id });
    if (!r) throw new OfficeError('Записот не постои.');
    await audit(tx, { userId, firmId, action: 'instSave', entityType: 'inst_item', entityId: r.id, data: { inst: row.inst, type: row.type, refNo: row.refNo, due: row.due, amount: row.amount } });
    return r.id;
  }
  const [r] = await tx.insert(instItems).values({ ...row, firmId, status: status ?? 'new', source: a.source ?? 'manual', incomingId: a.incomingId ?? null, createdBy: userId })
    .returning({ id: instItems.id });
  await audit(tx, { userId, firmId, action: 'instSave', entityType: 'inst_item', entityId: r!.id, data: { new: true, inst: row.inst, type: row.type, refNo: row.refNo, due: row.due, amount: row.amount } });
  return r!.id;
}

/** Status change („Во работа“, „Одговорено“, „Платено“ by hand with the date, „Затворено“, back to „Ново“). */
export async function setInstStatus(tx: Tx, a: { firmId: string; id: string; status: string; userId: string | null; paidOn?: string | null; note?: string | null }): Promise<void> {
  if (!isInstStatus(a.status)) throw new OfficeError('Непознат статус.');
  const s: InstStatus = a.status;
  const set: Partial<typeof instItems.$inferInsert> = { status: s, updatedBy: a.userId };
  if (s === 'paid') { set.paidOn = isDate(a.paidOn) ? a.paidOn : todaySkopje(); if (a.note) set.paidNote = a.note.slice(0, 300); }
  // back to open from „Платено“: the manual payment goes; an automatic match (bank line) stays as evidence
  const [r] = await tx.update(instItems).set(set).where(and(eq(instItems.id, a.id), eq(instItems.firmId, a.firmId))).returning({ id: instItems.id });
  if (!r) throw new OfficeError('Записот не постои.');
  await audit(tx, { userId: a.userId, firmId: a.firmId, action: 'instStatus', entityType: 'inst_item', entityId: a.id, data: { status: s, paidOn: set.paidOn ?? null } });
}

export async function deleteInstItem(tx: Tx, a: { firmId: string; id: string; userId: string | null }): Promise<void> {
  const [r] = await tx.delete(instItems).where(and(eq(instItems.id, a.id), eq(instItems.firmId, a.firmId))).returning();
  if (!r) throw new OfficeError('Записот не постои.');
  await tx.delete(fileLinks).where(and(eq(fileLinks.entityType, INST_FILE_ENTITY), eq(fileLinks.entityId, a.id)));
  await audit(tx, { userId: a.userId, firmId: a.firmId, action: 'instDelete', entityType: 'inst_item', entityId: a.id, data: { inst: r.inst, type: r.type, refNo: r.refNo, amount: r.amount } });
}

/* ---------------- AI reading of the attached document ---------------- */

const READABLE = /pdf|^image\/(jpeg|png|webp|gif)|wordprocessingml|^text\/plain/i;
type ReadRef = { id: string; applied?: boolean };
export const instReadsOf = (i: Pick<InstItem, 'data'>): ReadRef[] => (Array.isArray((i.data as { reads?: unknown }).reads) ? ((i.data as { reads: ReadRef[] }).reads) : []);

/** Queue AI reads of attached files of an item (PDF, image, Word, TXT); the caller enqueues `ai.read-document`. */
export async function startInstReads(tx: Tx, a: { firmId: string; userId: string | null; id: string; fileIds: readonly string[] }): Promise<string[]> {
  if (!a.fileIds.length) return [];
  const F = await tx.select({ id: files.id, mime: files.mime, name: files.name }).from(files)
    .where(and(eq(files.firmId, a.firmId), inArray(files.id, [...a.fileIds]), eq(files.status, 'ready')));
  const ok = F.filter((f) => READABLE.test(f.mime) || /\.(pdf|jpe?g|png|webp|docx|txt)$/i.test(f.name));
  if (!ok.length) return [];
  const R = await tx.insert(aiDocuments).values(ok.map((f) => ({ firmId: a.firmId, fileId: f.id, kind: 'inst' as const, options: { instId: a.id }, createdBy: a.userId })))
    .returning({ id: aiDocuments.id });
  const [i] = await tx.select({ data: instItems.data }).from(instItems).where(and(eq(instItems.id, a.id), eq(instItems.firmId, a.firmId))).limit(1);
  if (i) await tx.update(instItems).set({ data: { ...i.data, reads: [...instReadsOf(i), ...R.map((r) => ({ id: r.id }))] } }).where(eq(instItems.id, a.id));
  return R.map((r) => r.id);
}

/** Fill the blank fields of an item from a finished read; returns the names of the fields filled. */
export async function applyInstRead(tx: Tx, a: { firmId: string; id: string; result: unknown; userId: string | null }): Promise<string[]> {
  const [i] = await tx.select().from(instItems).where(and(eq(instItems.id, a.id), eq(instItems.firmId, a.firmId))).for('update').limit(1);
  if (!i) return [];
  const r = instFromRead(a.result, i.received);
  const set: Partial<typeof instItems.$inferInsert> = {};
  const fill = <K extends keyof typeof set>(k: K, v: (typeof set)[K] | null | undefined) => { if (v != null && v !== '' && (i[k as keyof InstItem] == null || i[k as keyof InstItem] === '')) set[k] = v; };
  // the institution and kind only when still the defaults of an item made from a file
  if (i.inst === 'other' && r.inst !== 'other') set.inst = r.inst;
  if (i.type === 'drugo' && r.type !== 'drugo') set.type = r.type;
  fill('instName', r.instName); fill('refNo', r.refNo); fill('docDate', r.date); fill('due', r.due); fill('subject', r.subject);
  fill('amount', r.amount != null ? r.amount.toFixed(2) : null); fill('payRecip', r.payRecip); fill('payAccount', r.payAccount); fill('payUplSm', r.payUplSm);
  fill('payPrihod', r.payPrihod); fill('payRef', r.payRef);
  const keys = Object.keys(set);
  if (keys.length) {
    await tx.update(instItems).set({ ...set, updatedBy: a.userId }).where(eq(instItems.id, i.id));
    await audit(tx, { userId: a.userId, firmId: a.firmId, action: 'instRead', entityType: 'inst_item', entityId: i.id, data: { fields: keys } });
  }
  return keys;
}

/**
 * Apply every finished `inst` read of the given firms to its item (idempotent: the read is marked `saved`, so a
 * second call does nothing). Runs when the screen opens and in the morning job. Returns how many reads were applied.
 */
export async function applyInstReads(db: Tx, o: { firmIds: readonly string[] }): Promise<number> {
  if (!o.firmIds.length) return 0;
  const D = await db.select({ id: aiDocuments.id, firmId: aiDocuments.firmId, result: aiDocuments.result, options: aiDocuments.options, createdBy: aiDocuments.createdBy })
    .from(aiDocuments).where(and(inArray(aiDocuments.firmId, [...o.firmIds]), eq(aiDocuments.kind, 'inst'), eq(aiDocuments.status, 'done')));
  let n = 0;
  for (const d of D) {
    const instId = (d.options as { instId?: string } | null)?.instId;
    await db.transaction(async (tx) => {
      const [x] = await tx.update(aiDocuments).set({ status: 'saved' }).where(and(eq(aiDocuments.id, d.id), eq(aiDocuments.status, 'done'))).returning({ id: aiDocuments.id });
      if (!x || !instId) return;
      await applyInstRead(tx, { firmId: d.firmId, id: instId, result: d.result, userId: d.createdBy });
      const [i] = await tx.select({ data: instItems.data }).from(instItems).where(eq(instItems.id, instId)).limit(1);
      if (i) await tx.update(instItems).set({ data: { ...i.data, reads: instReadsOf(i).map((r) => (r.id === d.id ? { ...r, applied: true } : r)) } }).where(eq(instItems.id, instId));
      n++;
    });
  }
  return n;
}

/** Reads of the items still running / failed (for the screen: „се чита…“, the error). */
export async function instReadStates(db: Tx, itemIds: readonly string[]): Promise<Map<string, { id: string; status: string; error: string | null }[]>> {
  const out = new Map<string, { id: string; status: string; error: string | null }[]>();
  if (!itemIds.length) return out;
  const R = await db.select({ id: aiDocuments.id, status: aiDocuments.status, error: aiDocuments.error, instId: sql<string>`${aiDocuments.options}->>'instId'` })
    .from(aiDocuments).where(and(eq(aiDocuments.kind, 'inst'), inArray(sql<string>`${aiDocuments.options}->>'instId'`, [...itemIds]), inArray(aiDocuments.status, ['queued', 'reading', 'error'])));
  for (const r of R) out.set(r.instId, [...(out.get(r.instId) ?? []), { id: r.id, status: r.status, error: r.error }]);
  return out;
}

/* ---------------- from „📥 Пристигнати документи“ ---------------- */

/** An item made from an inbox file (institution / kind unknown until the read fills them); returns its id. */
export async function instFromFile(tx: Tx, a: { firmId: string; fileId: string; fileName: string; userId: string | null; received: string; source: 'incoming' | 'upload' | 'mail'; incomingId?: string | null }): Promise<string> {
  const id = await saveInstItem(tx, a.firmId, {
    inst: instGuess(a.fileName), type: 'drugo', received: a.received, subject: a.fileName.replace(/\.[a-z0-9]{2,5}$/i, '').slice(0, 200), source: a.source, incomingId: a.incomingId ?? null,
  }, a.userId);
  await tx.insert(fileLinks).values({ fileId: a.fileId, entityType: INST_FILE_ENTITY, entityId: id }).onConflictDoNothing();
  return id;
}

/* ---------------- paid from the bank statements ---------------- */

export interface InstMatchResult { checked: number; paid: number }

/**
 * Mark items paid from the firms' bank-statement lines (booked or only imported): open / answered items with an
 * amount and no payment yet. A line pays one item only. Never touches a status set to „Затворено“.
 */
export async function matchInstPayments(db: Tx, o: { firmIds?: readonly string[]; today?: string } = {}): Promise<InstMatchResult> {
  const I = await db.select().from(instItems).where(and(
    o.firmIds ? inArray(instItems.firmId, [...o.firmIds, '00000000-0000-0000-0000-000000000000']) : undefined,
    inArray(instItems.status, ['new', 'work', 'answered']), isNull(instItems.paidOn), sql`${instItems.amount} > 0`,
  ));
  if (!I.length) return { checked: 0, paid: 0 };
  const ids = [...new Set(I.map((i) => i.firmId))];
  const today = o.today ?? todaySkopje();
  const from = I.map((i) => i.received ?? i.docDate ?? addDays(today, -120)).sort()[0]!;
  const L = await db.select({
    id: bankLines.id, firmId: bankLines.firmId, date: bankLines.date, amount: bankLines.amount, payRef: bankLines.payRef, description: bankLines.description, purpose: bankLines.purpose,
    bref: bankLines.bref, name: bankLines.name, counterAccount: bankLines.counterAccount, statementNo: bankStatements.number,
  }).from(bankLines).innerJoin(bankStatements, eq(bankStatements.id, bankLines.statementId))
    .where(and(inArray(bankLines.firmId, ids), gte(bankLines.date, addDays(from, -3)), lt(bankLines.amount, '0')));
  const used = await db.select({ id: instItems.bankLineId }).from(instItems).where(and(inArray(instItems.firmId, ids), sql`${instItems.bankLineId} is not null`));
  const taken = new Set(used.map((u) => u.id!));
  let paid = 0;
  for (const i of I.sort((a, b) => String(a.received ?? '').localeCompare(String(b.received ?? '')))) {
    const lines: InstBankLine[] = L.filter((l) => l.firmId === i.firmId).map((l) => ({ ...l, amount: Number(l.amount) }));
    const m = instPaymentMatch({ ...i, amount: i.amount }, lines, taken);
    if (!m) continue;
    const u = await db.update(instItems).set({ status: 'paid', paidOn: m.date, paidNote: instPaidNote(m), bankLineId: m.id })
      .where(and(eq(instItems.id, i.id), isNull(instItems.paidOn))).returning({ id: instItems.id });
    if (!u.length) continue;
    taken.add(m.id);
    paid++;
    await audit(db, { userId: null, firmId: i.firmId, action: 'instPaid', entityType: 'inst_item', entityId: i.id, data: { line: m.id, date: m.date, amount: m.amount, auto: true } });
  }
  return { checked: I.length, paid };
}

/** Open items with a deadline in `[from, to]` of the firms (the deadline calendar rows). */
export async function instDeadlineRows(db: Tx, o: { firmIds: readonly string[]; from: string; to: string }) {
  if (!o.firmIds.length) return [];
  return db.select({ id: instItems.id, firmId: instItems.firmId, inst: instItems.inst, instName: instItems.instName, type: instItems.type, refNo: instItems.refNo, subject: instItems.subject, due: instItems.due, status: instItems.status })
    .from(instItems).where(and(inArray(instItems.firmId, [...o.firmIds]), gte(instItems.due, o.from), sql`${instItems.due} <= ${o.to}`));
}

