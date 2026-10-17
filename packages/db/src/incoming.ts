/**
 * „📥 Пристигнати документи“ (UX P7 / P32 / P33): the inbox rows of `incoming_docs` — register uploads, the automatic
 * import of a bank statement by its account / IBAN, routing a file with one click (scan review, МПИН, dossier),
 * skipping, assigning an office-wide file to a firm. The callers check the permissions; every change is audited.
 *
 * The bank import is THE existing import (`saveImport`): the reconciliation hard block (`statementProblems`), the
 * duplicate check (`skipDuplicates`), the open-period check, booked into the bank nalog of the statement's period.
 * Only the arriving firm's own account imports automatically; another firm the uploader may access is proposed.
 */
import { and, eq, inArray, sql } from 'drizzle-orm';
import { can, type Principal, type Role } from '@wise/core';
import { statementProblems, type Statement } from '@wise/core/bank-parsers';
import { statementAccount } from '@wise/core/bank/statements';
import { isDemoFirm } from '@wise/core/demo';
import { bankMatch, DOS_CAT, INBOX_ROUTE_TARGET, statementBriefs, type FirmAccounts, type InboxRoute } from '@wise/core/office';
import { audit, type Tx } from './audit';
import { aiDocuments, bankAccounts, dossierDocs, fileLinks, files, firms, incomingDocs, mpinInbox, OFFICE_FILE_ENTITY, userFirms, users, type IncomingDoc } from './schema/index';
import { demoFirmIds } from './demo/filters';
import { saveImport } from './bank/import';
import { fileAlreadyUsed } from './sales/purchases';
import { OfficeError } from './office';

const IncomingError = OfficeError;

/** Register files uploaded into the inbox (one row per file); ids of the new rows (the caller enqueues `incoming.detect`). */
export async function addIncoming(tx: Tx, a: { firmId: string | null; fileIds: readonly string[]; userId: string | null; source?: string }): Promise<string[]> {
  if (!a.fileIds.length) return [];
  const F = await tx.select({ id: files.id, firmId: files.firmId }).from(files).where(and(inArray(files.id, [...a.fileIds]), eq(files.status, 'ready')));
  const ok = F.filter((f) => f.firmId === a.firmId);
  if (!ok.length) return [];
  const R = await tx.insert(incomingDocs).values(ok.map((f) => ({ firmId: a.firmId, fileId: f.id, source: a.source ?? 'upload', createdBy: a.userId }))).returning({ id: incomingDocs.id });
  await audit(tx, { userId: a.userId, firmId: a.firmId, action: 'inUpload', entityType: 'incoming_doc', data: { count: R.length } });
  return R.map((r) => r.id);
}

/** The principal of a stored user (as the session builds it): demo → the demo firms; admin / all firms → `*`. */
export async function principalOfUser(tx: Pick<Tx, 'select'>, userId: string | null): Promise<Principal | null> {
  if (!userId) return null;
  const [u] = await tx.select({ id: users.id, role: users.role, allFirms: users.allFirms, demo: users.demo, active: users.active }).from(users).where(eq(users.id, userId)).limit(1);
  if (!u || !u.active) return null;
  if (u.demo) return { id: u.id, role: u.role as Role, firms: await demoFirmIds(tx), demo: true };
  const F = u.allFirms || u.role === 'admin' ? ['*'] : (await tx.select({ f: userFirms.firmId }).from(userFirms).where(eq(userFirms.userId, u.id))).map((r) => r.f);
  return { id: u.id, role: u.role as Role, firms: F };
}

/** The active firms the user may book into (`write`), with their bank accounts — never a demo firm for a real user, and the reverse. */
export async function writableFirmAccounts(tx: Pick<Tx, 'select'>, p: Principal | null): Promise<FirmAccounts[]> {
  if (!p) return [];
  const F = (await tx.select({ id: firms.id, name: firms.name, settings: firms.settings, ownerId: firms.ownerId }).from(firms).where(eq(firms.active, true)))
    .filter((f) => (p.demo ? isDemoFirm(f) : !isDemoFirm(f)) && can(p, 'write', f.id) && (p.demo || p.role === 'admin' || p.firms.includes('*') || p.firms.includes(f.id) || f.ownerId === p.id));
  if (!F.length) return [];
  const B = await tx.select({ id: bankAccounts.id, firmId: bankAccounts.firmId, account: bankAccounts.account, iban: bankAccounts.iban, cur: bankAccounts.cur })
    .from(bankAccounts).where(inArray(bankAccounts.firmId, F.map((f) => f.id)));
  return F.map((f) => ({ id: f.id, name: f.name, accounts: B.filter((b) => b.firmId === f.id) }));
}

async function rowOf(tx: Tx, id: string): Promise<IncomingDoc> {
  const [r] = await tx.select().from(incomingDocs).where(eq(incomingDocs.id, id)).for('update').limit(1);
  if (!r) throw new IncomingError('Документот не постои.');
  return r;
}

const setRow = (tx: Tx, id: string, v: Partial<typeof incomingDocs.$inferInsert>) => tx.update(incomingDocs).set(v).where(eq(incomingDocs.id, id));

export interface BankImportOutcome { status: 'done' | 'skipped' | 'read'; result: string; ref?: string | null; numbers?: string[] }

/**
 * Import the statements of an inbox file into `firmId` (the existing import, booked into the bank nalog of each
 * statement's period). A failure (the statement does not reconcile, a locked period…) leaves the file for a decision
 * with the reason; nothing is half-written (savepoint). Audited as `inAuto` (automatic) / `inBank` (the user's click).
 */
export async function incomingBankImport(tx: Tx, a: { id: string; firmId: string; statements: Statement[]; format: string; userId: string | null; auto: boolean }): Promise<BankImportOutcome> {
  const r = await rowOf(tx, a.id);
  const [f] = await tx.select({ name: files.name }).from(files).where(eq(files.id, r.fileId)).limit(1);
  const problems = [...new Set(a.statements.flatMap((s) => statementProblems(s).map((m) => (s.no ? `Извод бр. ${s.no}: ${m}` : m))))];
  const detect = { ...r.detect, statements: statementBriefs(a.statements), format: a.format };
  if (problems.length) {
    const result = `Не е увезен – салдата не се совпаѓаат: ${problems.join(' ')}`;
    await setRow(tx, a.id, { status: 'read', result, detect: { ...detect, problems } });
    return { status: 'read', result };
  }
  const B = await tx.select().from(bankAccounts).where(eq(bankAccounts.firmId, a.firmId));
  const acct = a.statements.map((s) => statementAccount(s, B.map((b) => ({ ...b, account: b.account ?? '' }))))[0] ?? null;
  try {
    const x = await tx.transaction((t) => saveImport(t as unknown as Tx, {
      firmId: a.firmId, userId: a.userId, statements: a.statements, defaultAccountId: acct?.id ?? null, skipDuplicates: true,
      fileName: f?.name ?? null, format: a.format, fileId: r.fileId, book: true, nalog: { number: null, from: null, to: null },
    }));
    if (!x.lines && x.skipped && !x.balances) {
      const result = `Дупликат – изводот е веќе увезен (${x.skipped} ставки), прескокнат.`;
      await setRow(tx, a.id, { firmId: a.firmId, status: 'skipped', route: 'bank', result, detect: { ...detect, import: { dup: true, skipped: x.skipped } }, doneAt: new Date(), doneBy: a.userId });
      await audit(tx, { userId: a.userId, firmId: a.firmId, action: a.auto ? 'inAuto' : 'inBank', entityType: 'incoming_doc', entityId: a.id, data: { dup: true, skipped: x.skipped } });
      return { status: 'skipped', result };
    }
    const sk = x.book?.skipped ?? [];
    const result = `${a.auto ? 'Автоматски увезен' : 'Увезен'}: ${x.statements} извод(и), ${x.lines} ставки${x.skipped ? `, ${x.skipped} дупликати прескокнати` : ''}`
      + `; прокнижени ${x.book?.booked ?? x.posted}${x.numbers?.length ? ` во налог ${x.numbers.join(', ')}` : ''}${sk.length ? `; за довршување ${sk.length}` : ''}.`;
    const ref = `bank_import:${x.batch}`;
    await setRow(tx, a.id, { firmId: a.firmId, status: 'done', route: 'bank', routeRef: ref, result, detect: { ...detect, import: { batch: x.batch, numbers: x.numbers ?? [], lines: x.lines, skipped: x.skipped, open: sk.length } }, doneAt: new Date(), doneBy: a.userId });
    await audit(tx, { userId: a.userId, firmId: a.firmId, action: a.auto ? 'inAuto' : 'inBank', entityType: 'incoming_doc', entityId: a.id, data: { batch: x.batch, lines: x.lines, skipped: x.skipped, numbers: x.numbers } });
    return { status: 'done', result, ref, numbers: x.numbers ?? [] };
  } catch (e) {
    if (!(e instanceof Error) || !['ImportError', 'PostingError', 'BankError', 'DocumentError'].includes(e.name)) throw e;
    const result = `Не е увезен: ${e.message}`;
    await setRow(tx, a.id, { status: 'read', result, detect });
    return { status: 'read', result };
  }
}

/**
 * After the type is known: a structured statement is matched to a firm by its account / IBAN (`bankMatch`) — the
 * file's own firm → imported automatically; another firm the uploader may book into → proposed; none → waits.
 */
export async function incomingBankAuto(tx: Tx, a: { id: string; statements: Statement[]; format: string }): Promise<BankImportOutcome & { proposed?: { id: string; name: string }[] }> {
  const r = await rowOf(tx, a.id);
  const p = await principalOfUser(tx, r.createdBy);
  const F = await writableFirmAccounts(tx, p);
  const m = bankMatch(a.statements, r.firmId, F);
  const detect = { ...r.detect, statements: statementBriefs(a.statements), format: a.format };
  if (m.mode === 'import') return incomingBankImport(tx, { id: a.id, firmId: m.firmId, statements: a.statements, format: a.format, userId: r.createdBy, auto: true });
  if (m.mode === 'propose') {
    const result = `Сметката од изводот е на: ${m.firms.map((f) => f.name).join(', ')} – потврдете во која фирма да се увезе.`;
    await setRow(tx, a.id, { status: 'read', result, detect: { ...detect, proposed: m.firms } });
    return { status: 'read', result, proposed: m.firms };
  }
  const result = r.firmId ? 'Сметката од изводот не е меѓу сметките на фирмата – одлучете (увези ја сметката или прескокни).' : 'Сметката од изводот не е пронајдена кај ниедна фирма – одлучете.';
  await setRow(tx, a.id, { status: 'read', result, detect });
  return { status: 'read', result };
}

export interface IncomingRouteResult { go: string | null; aiDocIds: string[]; mpinRowIds: string[]; ref: string | null; skipped: string[] }

/**
 * One-click routing of an inbox file of `firmId`: purchases / issued invoices → the scan review (an `ai_documents`
 * read, multi-invoice split included; the caller enqueues `ai.read-document`), an МПИН → the МПИН list (`mpin.read`),
 * the rest → the firm dossier under its category. The bank route is the import (`incomingBankImport`, via the job).
 */
export async function routeIncoming(tx: Tx, a: { id: string; firmId: string; route: InboxRoute; category?: string | null; userId: string }): Promise<IncomingRouteResult> {
  const r = await rowOf(tx, a.id);
  if (r.firmId !== a.firmId) throw new IncomingError('Документот не е во оваа фирма.');
  if (r.status === 'done') throw new IncomingError('Документот е веќе обработен.');
  const T = INBOX_ROUTE_TARGET[a.route];
  if (!T || a.route === 'bank') throw new IncomingError('Непозната цел.');
  const [f] = await tx.select({ id: files.id, name: files.name, firmId: files.firmId }).from(files).where(eq(files.id, r.fileId)).limit(1);
  if (!f || f.firmId !== a.firmId) throw new IncomingError('Датотеката не е во оваа фирма.');
  const out: IncomingRouteResult = { go: T.go, aiDocIds: [], mpinRowIds: [], ref: null, skipped: [] };
  if (T.ai) {
    const used = await fileAlreadyUsed(tx, a.firmId, [f.id]);
    if (used) throw new IncomingError(`„${f.name}“ е веќе прикачен на ${used.entityType === 'purchase' ? 'влезна фактура' : 'излезна фактура'}.`);
    const [d] = await tx.insert(aiDocuments).values({ firmId: a.firmId, fileId: f.id, kind: T.ai, createdBy: a.userId, options: { incomingId: r.id } }).returning({ id: aiDocuments.id });
    out.aiDocIds.push(d!.id);
    out.ref = `ai_document:${d!.id}`;
  } else if (T.mpin) {
    const [m] = await tx.insert(mpinInbox).values({ fileId: f.id, name: f.name, firmId: a.firmId, createdBy: a.userId }).returning({ id: mpinInbox.id });
    out.mpinRowIds.push(m!.id);
    out.ref = `mpin_inbox:${m!.id}`;
  } else {
    const cat = a.category && (DOS_CAT as readonly string[]).includes(a.category) ? a.category : T.dossier ?? 'Друго';
    const [d] = await tx.insert(dossierDocs).values({ firmId: a.firmId, category: cat, title: `${cat} – ${f.name}`.slice(0, 200), date: r.createdAt.toISOString().slice(0, 10), createdBy: a.userId })
      .returning({ id: dossierDocs.id });
    await tx.insert(fileLinks).values({ fileId: f.id, entityType: OFFICE_FILE_ENTITY.dossier, entityId: d!.id }).onConflictDoNothing();
    out.ref = `dossier_doc:${d!.id}`;
  }
  await setRow(tx, a.id, { status: 'done', route: a.route, routeRef: out.ref, doneBy: a.userId, doneAt: new Date(), result: null });
  await audit(tx, { userId: a.userId, firmId: a.firmId, action: 'inRoute', entityType: 'incoming_doc', entityId: a.id, data: { route: a.route, ref: out.ref } });
  return out;
}

/** „Прескокни“ / „Врати“. */
export async function skipIncoming(tx: Tx, a: { id: string; firmId: string | null; userId: string; skip: boolean }): Promise<void> {
  const r = await rowOf(tx, a.id);
  if (r.firmId !== a.firmId) throw new IncomingError('Документот не е во оваа фирма.');
  if (r.status === 'done') throw new IncomingError('Документот е веќе обработен.');
  await setRow(tx, a.id, a.skip ? { status: 'skipped', doneBy: a.userId, doneAt: new Date() } : { status: 'read', doneBy: null, doneAt: null });
  await audit(tx, { userId: a.userId, firmId: a.firmId, action: a.skip ? 'inSkip' : 'inUnskip', entityType: 'incoming_doc', entityId: a.id });
}

/**
 * Give a file to another firm (an office-wide upload, or a statement proposed for another firm): the row and its file
 * move — only a file attached to nothing yet. The caller checked `write` on both firms (`from` null = office-wide).
 */
export async function assignIncomingFirm(tx: Tx, a: { id: string; from: string | null; to: string; userId: string }): Promise<void> {
  const r = await rowOf(tx, a.id);
  if (r.firmId !== a.from) throw new IncomingError('Документот не е во оваа фирма.');
  if (r.status === 'done') throw new IncomingError('Документот е веќе обработен.');
  const [{ n }] = (await tx.select({ n: sql<number>`count(*)::int` }).from(fileLinks).where(eq(fileLinks.fileId, r.fileId))) as [{ n: number }];
  if (n) throw new IncomingError('Датотеката е веќе прикачена на документ – не може да се премести.');
  await tx.update(files).set({ firmId: a.to }).where(eq(files.id, r.fileId));
  await setRow(tx, a.id, { firmId: a.to, status: r.status === 'skipped' ? 'read' : r.status, detect: { ...r.detect, movedFrom: a.from } });
  await audit(tx, { userId: a.userId, firmId: a.to, action: 'inFirm', entityType: 'incoming_doc', entityId: a.id, data: { from: a.from } });
}
