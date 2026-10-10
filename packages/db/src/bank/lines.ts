/**
 * Editing statements and their lines: book a line on a konto (learning rules — legacy change listener
 * `data-bk` 4842 + save wrapper 12645), unlink, flip direction, manual rows, delete, statement header
 * (number, balances, totals, FX rate), numbering, rules, fee clean-up, transit residues, bank accounts.
 * Every mutation checks the period lock, re-posts the affected statements and writes an audit row.
 */
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import {
  assignStatementNumbers, bankDupKey, counterparty, feeFix, fxRate, fxToMkd, learnOsnov, learnRule, statementGaps, statementKey, transitCloseLines, transitResidue,
  type StatementBalance,
} from '@wise/core';
import { audit, type Tx } from '../audit';
import { assertOpenPeriod, missingAccounts, postJournal, unpostSource } from '../posting';
import { bankKontoName } from '@wise/core/bank/parity';
import { accounts } from '../schema/index';
import { loadLedgerLines } from '../ledger-queries';
import { bankAccounts, bankLines, bankRules, bankStatements, partners, type BankLine, type BankStatement } from '../schema/index';
import { BankError, cents, dec, den, loadBankAccounts, loadBankEnv, loadFirm, loadFxSources, syncFirmBanks } from './context';

import { BANK_SOURCE_TYPE } from './open-items';
import { assertStatementOpen, postStatement, postStatements } from './posting';
import { toBankRow, UNBOOKED } from './rows';

const KONTO_RE = /^\d{2,10}$/;

async function lineOf(tx: Tx, firmId: string, lineId: string): Promise<{ line: BankLine; st: BankStatement }> {
  const [line] = await tx.select().from(bankLines).where(and(eq(bankLines.id, lineId), eq(bankLines.firmId, firmId))).limit(1);
  if (!line) throw new BankError('Ставката не постои.');
  const [st] = await tx.select().from(bankStatements).where(eq(bankStatements.id, line.statementId)).limit(1);
  await assertStatementOpen(tx, st!);
  return { line, st: st! };
}

async function statementOf(tx: Tx, firmId: string, id: string): Promise<BankStatement> {
  const [st] = await tx.select().from(bankStatements).where(and(eq(bankStatements.id, id), eq(bankStatements.firmId, firmId))).limit(1);
  if (!st) throw new BankError('Изводот не постои.');
  await assertStatementOpen(tx, st);
  return st;
}

async function upsertRule(tx: Tx, firmId: string, kind: 'desc' | 'osnov', match: string, konto: string, learned: boolean): Promise<void> {
  const [ex] = await tx.select({ id: bankRules.id }).from(bankRules)
    .where(and(eq(bankRules.firmId, firmId), eq(bankRules.kind, kind), sql`lower(${bankRules.match}) = lower(${match})`)).limit(1);
  if (ex) await tx.update(bankRules).set({ konto, learned }).where(eq(bankRules.id, ex.id));
  else await tx.insert(bankRules).values({ firmId, kind, match, konto, learned });
}

/**
 * Book a line directly on a konto (with an optional partner), clearing any document link. With `learn`, the
 * description rule (`learnRule`) and the payment-code rule (`learnOsnov`) are remembered for the next import.
 */
export async function setLineKonto(tx: Tx, a: { firmId: string; userId: string | null; lineId: string; konto: string; partnerId?: string | null; learn?: boolean }): Promise<string[]> {
  if (!KONTO_RE.test(a.konto)) throw new BankError('Неважечко конто.');
  const { line, st } = await lineOf(tx, a.firmId, a.lineId);
  // legacy `kontoOpts(…, k => !bankKontos().includes(k))`: a bank account's own konto is not a counter konto
  if ((await loadBankAccounts(tx, a.firmId)).some((x) => x.konto === a.konto)) throw new BankError(`Конто ${a.konto} е конто на банкарска сметка – изберете спротивно конто.`);
  if (a.partnerId) {
    const [p] = await tx.select({ id: partners.id }).from(partners).where(and(eq(partners.id, a.partnerId), eq(partners.firmId, a.firmId))).limit(1);
    if (!p) throw new BankError('Комитентот не постои.');
  }
  await tx.update(bankLines).set({ ...UNBOOKED, konto: a.konto, partnerId: a.partnerId || null, pos: line.pos, own: line.own, conv: line.conv, newPartner: a.partnerId ? null : line.newPartner })
    .where(eq(bankLines.id, line.id));
  const learned: string[] = [];
  if (a.learn !== false) {
    const env = await loadBankEnv(tx, a.firmId);
    const bankK = new Set(env.accounts.map((x) => x.konto));
    if (!bankK.has(a.konto) && !/^(12|22)/.test(a.konto)) {
      if (learnRule(env.rules, line.description, a.konto)) {
        const key = counterparty(line.description);
        await upsertRule(tx, a.firmId, 'desc', key, a.konto, true);
        learned.push(key);
      }
    }
    if (learnOsnov(env.osnovK, { ...toBankRow(line), konto: a.konto, ref: undefined })) {
      const k = String(line.osnov) + '|' + (Number(line.amount) > 0 ? 'in' : 'out');
      await upsertRule(tx, a.firmId, 'osnov', k, a.konto, true);
      learned.push(k);
    }
  }
  await postStatement(tx, st.id, a.userId);
  await audit(tx, { userId: a.userId, firmId: a.firmId, action: 'bankKonto', entityType: 'bank_line', entityId: line.id, data: { konto: a.konto, partnerId: a.partnerId ?? null, learned } });
  return learned;
}

/** Set / change the partner of a line (or create the suggested partner). */
export async function setLinePartner(tx: Tx, a: { firmId: string; userId: string | null; lineId: string; partnerId?: string | null; createName?: string | null }): Promise<string | null> {
  const { line, st } = await lineOf(tx, a.firmId, a.lineId);
  let pid = a.partnerId || null;
  if (!pid && a.createName?.trim()) {
    const name = a.createName.trim();
    const [ex] = await tx.select({ id: partners.id }).from(partners).where(and(eq(partners.firmId, a.firmId), eq(partners.name, name))).limit(1);
    if (ex) pid = ex.id;
    else {
      const [p] = await tx.insert(partners).values({ firmId: a.firmId, name, bankAccount: line.counterAccount }).returning({ id: partners.id });
      pid = p!.id;
      await audit(tx, { userId: a.userId, firmId: a.firmId, action: 'newS', entityType: 'partner', entityId: pid, data: { name, from: 'bank' } });
    }
  }
  if (pid) {
    const [p] = await tx.select({ id: partners.id }).from(partners).where(and(eq(partners.id, pid), eq(partners.firmId, a.firmId))).limit(1);
    if (!p) throw new BankError('Комитентот не постои.');
  }
  await tx.update(bankLines).set({ partnerId: pid, newPartner: pid ? null : line.newPartner }).where(eq(bankLines.id, line.id));
  await postStatement(tx, st.id, a.userId);
  await audit(tx, { userId: a.userId, firmId: a.firmId, action: 'bankPartner', entityType: 'bank_line', entityId: line.id, data: { partnerId: pid } });
  return pid;
}

/** Legacy `unlinkBank`: back to unbooked. */
export async function unlinkLine(tx: Tx, a: { firmId: string; userId: string | null; lineId: string }): Promise<void> {
  const { line, st } = await lineOf(tx, a.firmId, a.lineId);
  await tx.update(bankLines).set(UNBOOKED).where(eq(bankLines.id, line.id));
  await postStatement(tx, st.id, a.userId);
  await audit(tx, { userId: a.userId, firmId: a.firmId, action: 'unlinkBank', entityType: 'bank_line', entityId: line.id,
    data: { konto: line.konto, ref: line.refLabel, partnerId: line.partnerId } });
}

/** Legacy `flipBank`: change direction (inflow ↔ outflow) of a mis-signed line; the booking is cleared. */
export async function flipLine(tx: Tx, a: { firmId: string; userId: string | null; lineId: string }): Promise<void> {
  const { line, st } = await lineOf(tx, a.firmId, a.lineId);
  const amount = -cents(line.amount);
  const amountCur = line.amountCur != null ? -cents(line.amountCur) : null;
  const dupKey = bankDupKey({ ...toBankRow(line), amount, ...(amountCur != null ? { amountCur } : {}) });
  await tx.update(bankLines).set({ ...UNBOOKED, amount: dec(amount), amountCur: amountCur != null ? dec(amountCur) : null, dupKey }).where(eq(bankLines.id, line.id));
  await postStatement(tx, st.id, a.userId);
  await audit(tx, { userId: a.userId, firmId: a.firmId, action: 'flipBank', entityType: 'bank_line', entityId: line.id, data: { amount: den(amount) } });
}

/** Delete one line (FIX 4.4 #13: the UI asks for confirmation; here it is audited with the full row). */
export async function deleteLine(tx: Tx, a: { firmId: string; userId: string | null; lineId: string }): Promise<void> {
  const { line, st } = await lineOf(tx, a.firmId, a.lineId);
  await tx.delete(bankLines).where(eq(bankLines.id, line.id));
  const [{ n }] = (await tx.select({ n: sql<number>`count(*)::int` }).from(bankLines).where(eq(bankLines.statementId, st.id))) as [{ n: number }];
  if (n) await postStatement(tx, st.id, a.userId);
  else {
    await unpostSource(tx, { firmId: a.firmId, sourceType: BANK_SOURCE_TYPE, sourceId: st.id, userId: a.userId });
    await tx.delete(bankStatements).where(eq(bankStatements.id, st.id));
  }
  await audit(tx, { userId: a.userId, firmId: a.firmId, action: 'delBank', entityType: 'bank_line', entityId: line.id,
    data: { date: line.date, amount: Number(line.amount), desc: line.description, statementId: st.id } });
}

/** Delete a whole statement with its lines and journal. */
export async function deleteStatement(tx: Tx, a: { firmId: string; userId: string | null; statementId: string }): Promise<void> {
  const st = await statementOf(tx, a.firmId, a.statementId);
  await unpostSource(tx, { firmId: a.firmId, sourceType: BANK_SOURCE_TYPE, sourceId: st.id, userId: a.userId });
  const [{ n }] = (await tx.select({ n: sql<number>`count(*)::int` }).from(bankLines).where(eq(bankLines.statementId, st.id))) as [{ n: number }];
  await tx.delete(bankStatements).where(eq(bankStatements.id, st.id));
  await audit(tx, { userId: a.userId, firmId: a.firmId, action: 'delStatement', entityType: 'bank_statement', entityId: st.id, data: { date: st.date, number: st.number, lines: n } });
}

/** Legacy `undoImp`: remove every line of one import batch (and statements left empty). */
export async function undoImport(tx: Tx, a: { firmId: string; userId: string | null; batch: string }): Promise<number> {
  const L = await tx.select().from(bankLines).where(and(eq(bankLines.firmId, a.firmId), eq(bankLines.importBatch, a.batch)));
  const S = [...new Set(L.map((l) => l.statementId))];
  for (const id of S) await statementOf(tx, a.firmId, id);
  if (L.length) await tx.delete(bankLines).where(inArray(bankLines.id, L.map((l) => l.id)));
  for (const id of S) {
    const [{ n }] = (await tx.select({ n: sql<number>`count(*)::int` }).from(bankLines).where(eq(bankLines.statementId, id))) as [{ n: number }];
    if (n) await postStatement(tx, id, a.userId);
    else {
      await unpostSource(tx, { firmId: a.firmId, sourceType: BANK_SOURCE_TYPE, sourceId: id, userId: a.userId });
      await tx.delete(bankStatements).where(eq(bankStatements.id, id));
    }
  }
  await audit(tx, { userId: a.userId, firmId: a.firmId, action: 'undoImp', entityType: 'bank_import', entityId: a.batch, data: { lines: L.length, statements: S.length } });
  return L.length;
}

/**
 * Statement header (legacy listeners `data-izv`, `data-izvs`, `data-izvt`, `data-izvr`). Changing the FX rate
 * recomputes the denar amount of every line the bank did not convert itself (`fxItem`) and re-posts.
 */
export async function updateStatement(tx: Tx, a: {
  firmId: string; userId: string | null; statementId: string;
  number?: string | null; opening?: number | null; closing?: number | null; statedDebit?: number | null; statedCredit?: number | null; rate?: number | null;
}): Promise<void> {
  const st = await statementOf(tx, a.firmId, a.statementId);
  const patch: Partial<typeof bankStatements.$inferInsert> = {};
  const m = (v: number | null | undefined) => (v == null || Number.isNaN(v) ? null : dec(cents(v)));
  if (a.number !== undefined) patch.number = a.number?.trim() || null;
  if (a.opening !== undefined) patch.opening = m(a.opening);
  if (a.closing !== undefined) patch.closing = m(a.closing);
  if (a.statedDebit !== undefined) patch.statedDebit = m(a.statedDebit);
  if (a.statedCredit !== undefined) patch.statedCredit = m(a.statedCredit);
  let rateChanged = false;
  if (a.rate !== undefined) {
    if (a.rate != null && !(a.rate > 0)) throw new BankError('Курсот мора да е позитивен.');
    patch.rate = a.rate == null ? null : String(a.rate);
    rateChanged = (st.rate == null ? null : Number(st.rate)) !== a.rate;
  }
  await tx.update(bankStatements).set(patch).where(eq(bankStatements.id, st.id));
  if (rateChanged && a.rate) {
    const L = await tx.select().from(bankLines).where(eq(bankLines.statementId, st.id));
    for (const l of L) {
      if (l.mkdFromBank || l.amountCur == null) continue;
      const amount = fxToMkd(cents(l.amountCur), a.rate);
      // a document link keeps settling the same document amount; the difference becomes an FX difference
      await tx.update(bankLines).set({ amount: dec(amount) }).where(eq(bankLines.id, l.id));
    }
  }
  await postStatement(tx, st.id, a.userId);
  await audit(tx, { userId: a.userId, firmId: a.firmId, action: 'izvSave', entityType: 'bank_statement', entityId: st.id, data: { ...patch } });
}

/** Legacy `mbSave`: a line typed in by hand (statement of that account and date is created if needed). */
export async function addManualLine(tx: Tx, a: {
  firmId: string; userId: string | null; bankAccountId: string; date: string; amount: number; amountCur?: number | null;
  desc: string; konto?: string | null; partnerId?: string | null;
}): Promise<string> {
  const f = await loadFirm(tx, a.firmId);
  assertOpenPeriod(f, a.date);
  const [acct] = await tx.select().from(bankAccounts).where(and(eq(bankAccounts.id, a.bankAccountId), eq(bankAccounts.firmId, a.firmId))).limit(1);
  if (!acct) throw new BankError('Банкарската сметка не постои.');
  if (a.konto && !KONTO_RE.test(a.konto)) throw new BankError('Неважечко конто.');
  const fx = acct.cur !== 'MKD';
  let [st] = await tx.select().from(bankStatements).where(and(eq(bankStatements.bankAccountId, acct.id), eq(bankStatements.date, a.date))).limit(1);
  if (!st) {
    const S = await tx.select({ date: bankStatements.date, number: bankStatements.number }).from(bankStatements).where(eq(bankStatements.bankAccountId, acct.id));
    const add = assignStatementNumbers(Object.fromEntries(S.filter((s) => s.number).map((s) => [statementKey(acct.id, s.date), s.number!])), acct.id, [a.date]);
    [st] = await tx.insert(bankStatements).values({ firmId: a.firmId, bankAccountId: acct.id, date: a.date, number: Object.values(add)[0] ?? null, format: 'manual', createdBy: a.userId }).returning();
  } else await assertStatementOpen(tx, st);
  const amountCur = fx ? cents(a.amountCur ?? 0) : null;
  // legacy `mbSave` 13280 → `fxItem`: an FX line entered in its currency gets the denar value by the statement rate
  let amount = cents(a.amount);
  if (fx && !amount && amountCur) {
    const rate = st!.rate != null ? Number(st!.rate) : fxRate(acct.cur, a.date, await loadFxSources(tx, a.firmId));
    if (rate) amount = fxToMkd(amountCur, rate);
  }
  const [{ mx }] = (await tx.select({ mx: sql<number>`coalesce(max(${bankLines.lineNo}), 0)::int` }).from(bankLines).where(eq(bankLines.statementId, st!.id))) as [{ mx: number }];
  const row = { id: 'n', acct: acct.id, date: a.date, amount, desc: a.desc, ...(amountCur != null ? { amountCur } : {}) };
  const [l] = await tx.insert(bankLines).values({
    firmId: a.firmId, statementId: st!.id, bankAccountId: acct.id, lineNo: mx + 1, date: a.date, amount: dec(amount),
    amountCur: amountCur != null ? dec(amountCur) : null, cur: fx ? acct.cur : null, description: a.desc, konto: a.konto || null,
    partnerId: a.partnerId || null, manual: true, dupKey: bankDupKey(row),
  }).returning({ id: bankLines.id });
  await postStatement(tx, st!.id, a.userId);
  await audit(tx, { userId: a.userId, firmId: a.firmId, action: 'mbSave', entityType: 'bank_line', entityId: l!.id, data: { date: a.date, amount: den(amount), desc: a.desc } });
  return l!.id;
}

/** Legacy `numIzv`: give every statement of the year without a number the next free number of its account. */
export async function numberStatements(tx: Tx, a: { firmId: string; userId: string | null; year: number }): Promise<number> {
  const A = await loadBankAccounts(tx, a.firmId);
  let n = 0;
  for (const acct of A) {
    const S = await tx.select().from(bankStatements).where(eq(bankStatements.bankAccountId, acct.id)).orderBy(asc(bankStatements.date));
    const cur = Object.fromEntries(S.filter((s) => s.number).map((s) => [statementKey(acct.id, s.date), s.number!]));
    for (const s of S.filter((s) => !s.number && s.date.startsWith(String(a.year)))) {
      const add = assignStatementNumbers(cur, acct.id, [s.date]);
      Object.assign(cur, add);
      await tx.update(bankStatements).set({ number: Object.values(add)[0] }).where(eq(bankStatements.id, s.id));
      await postStatement(tx, s.id, a.userId);
      n++;
    }
  }
  if (n) await audit(tx, { userId: a.userId, firmId: a.firmId, action: 'numIzv', entityType: 'bank_statement', data: { year: a.year, numbered: n } });
  return n;
}

/** Statement gaps of the year (legacy `izvGaps`): closing balance ≠ next opening balance — a missing statement. */
export async function statementGapsFor(tx: Tx, firmId: string, year: number) {
  const A = await loadBankAccounts(tx, firmId);
  const S = await tx.select().from(bankStatements).where(and(eq(bankStatements.firmId, firmId), sql`${bankStatements.date} between ${year + '-01-01'} and ${year + '-12-31'}`));
  const sal: Record<string, StatementBalance> = {};
  for (const s of S) if (s.opening != null && s.closing != null) sal[statementKey(s.bankAccountId, s.date)] = { o: cents(s.opening), c: cents(s.closing), ...(s.number ? { no: s.number } : {}) };
  return statementGaps(sal, A.map((x) => ({ id: x.id, konto: x.konto, cur: x.cur })), year)
    .map((g) => ({ accountId: g.acct, accountName: A.find((x) => x.id === g.acct)?.name ?? '', from: g.a, to: g.b, diff: den(g.diff) }));
}

/* ---------------- rules ---------------- */

export async function addRule(tx: Tx, a: { firmId: string; userId: string | null; match: string; konto: string }): Promise<void> {
  const match = a.match.trim().toLowerCase();
  if (match.length < 2) throw new BankError('Внесете текст од описот (барем 2 знака).');
  if (!KONTO_RE.test(a.konto)) throw new BankError('Неважечко конто.');
  await upsertRule(tx, a.firmId, 'desc', match, a.konto, false);
  await audit(tx, { userId: a.userId, firmId: a.firmId, action: 'addRule', entityType: 'bank_rule', data: { match, konto: a.konto } });
}

export async function removeRule(tx: Tx, a: { firmId: string; userId: string | null; ruleId: string }): Promise<void> {
  const [r] = await tx.delete(bankRules).where(and(eq(bankRules.id, a.ruleId), eq(bankRules.firmId, a.firmId))).returning();
  if (r) await audit(tx, { userId: a.userId, firmId: a.firmId, action: 'rmRule', entityType: 'bank_rule', entityId: r.id, data: { match: r.match, konto: r.konto, kind: r.kind } });
}

/** Legacy ACT `feeFix` (FIX 4.4 #2): bank fees booked on 2200 / 4400 without a document → fee konto (4460). */
export async function applyFeeFix(tx: Tx, a: { firmId: string; userId: string | null; year: number }): Promise<number> {
  const env = await loadBankEnv(tx, a.firmId);
  const L = await tx.select().from(bankLines).where(and(eq(bankLines.firmId, a.firmId), sql`${bankLines.date} between ${a.year + '-01-01'} and ${a.year + '-12-31'}`));
  const fix = feeFix(L.map(toBankRow), a.year, env.konta);
  const st = new Set<string>();
  for (const r of fix) {
    const l = L.find((x) => x.id === r.id)!;
    const [s] = await tx.select().from(bankStatements).where(eq(bankStatements.id, l.statementId)).limit(1);
    await assertStatementOpen(tx, s!);
    await tx.update(bankLines).set({ konto: r.konto!, partnerId: null, auto: 'fee' }).where(eq(bankLines.id, r.id));
    st.add(l.statementId);
  }
  await postStatements(tx, st, a.userId, env);
  if (fix.length) await audit(tx, { userId: a.userId, firmId: a.firmId, action: 'feeFix', entityType: 'bank_lines', data: { lines: fix.length } });
  return fix.length;
}

/* ---------------- transit residues (own transfers / conversions) ---------------- */

/** Legacy `trResid`: per-day residue on the transit kontos (1039 / 1009) after a currency purchase or sale. */
export async function transitResidues(tx: Tx, firmId: string, year: number) {
  const env = await loadBankEnv(tx, firmId);
  const L = await loadLedgerLines(tx, firmId, `${year}-01-01`, `${year}-12-31`);
  return transitResidue(L.map((l) => ({ k: l.account, date: l.date, d: cents(l.debit), p: cents(l.credit) })), env.konta)
    .map((x) => ({ konto: x.k, date: x.date, residue: den(x.r) }));
}

/** Legacy ACT `trClose`: book a transit residue as an FX difference (journal kind `kr`). */
export async function closeTransit(tx: Tx, a: { firmId: string; userId: string | null; konto: string; date: string }): Promise<string> {
  const env = await loadBankEnv(tx, a.firmId);
  const R = await transitResidues(tx, a.firmId, +a.date.slice(0, 4));
  const x = R.find((r) => r.konto === a.konto && r.date === a.date);
  if (!x) throw new BankError('Нема остаток на преодното конто за тој ден.');
  const L = transitCloseLines({ k: x.konto, r: cents(x.residue) }, env.konta);
  const j = await postJournal(tx, {
    firmId: a.firmId, date: a.date, kind: 'kr', sourceType: 'transit_close', sourceId: `${a.konto}:${a.date}`, userId: a.userId,
    description: 'Курсна разлика – преодна сметка ' + a.konto, lines: L.map((l) => ({ account: l.k, debit: den(l.d), credit: den(l.p), note: 'Курсна разлика' })),
    auditAction: 'trClose',
  });
  return j.number;
}

/* ---------------- bank accounts ---------------- */

export interface BankAccountInput { id?: string | null; name: string; account?: string | null; iban?: string | null; cur: string; konto: string; nal?: string | null }

export async function saveBankAccount(tx: Tx, a: { firmId: string; userId: string | null; input: BankAccountInput }): Promise<string> {
  const v = a.input;
  if (!v.name.trim()) throw new BankError('Внесете назив на банката.');
  if (!KONTO_RE.test(v.konto)) throw new BankError('Неважечко конто.');
  const cur = (v.cur || 'MKD').toUpperCase();
  if (!/^[A-Z]{3}$/.test(cur)) throw new BankError('Неважечка валута.');
  const data = { name: v.name.trim(), account: v.account?.trim() || null, iban: v.iban?.replace(/\s+/g, '').toUpperCase() || null, cur, konto: v.konto, nal: v.nal?.trim() || null };
  let id = v.id ?? null;
  // legacy `addBankAcct` 7204: one konto per bank account
  const [dupK] = await tx.select({ id: bankAccounts.id, name: bankAccounts.name }).from(bankAccounts)
    .where(and(eq(bankAccounts.firmId, a.firmId), eq(bankAccounts.konto, v.konto))).limit(2);
  if (dupK && dupK.id !== id) throw new BankError(`Ова конто веќе се користи за друга сметка („${dupK.name}“).`);
  // legacy 7203 / 4846: a konto that is not in the chart is created („Трансакциска сметка – банка“ / „Девизна сметка EUR – банка“)
  if ((await missingAccounts(tx, a.firmId, [v.konto])).length) {
    await tx.insert(accounts).values({ firmId: a.firmId, code: v.konto, name: bankKontoName(data.name, cur) })
      .onConflictDoUpdate({ target: [accounts.firmId, accounts.code], targetWhere: sql`${accounts.firmId} is not null`, set: { hidden: false } });
    await audit(tx, { userId: a.userId, firmId: a.firmId, action: 'saveAcc', entityType: 'account', entityId: v.konto, data: { name: bankKontoName(data.name, cur), from: 'addBankAcct' } });
  }
  if (id) {
    const [before] = await tx.select().from(bankAccounts).where(and(eq(bankAccounts.id, id), eq(bankAccounts.firmId, a.firmId))).limit(1);
    if (!before) throw new BankError('Сметката не постои.');
    const [{ n }] = (await tx.select({ n: sql<number>`count(*)::int` }).from(bankLines).where(eq(bankLines.bankAccountId, id))) as [{ n: number }];
    if (n && before.cur !== cur) throw new BankError('Сметката има ставки од изводи – валутата не може да се менува.');
    await tx.update(bankAccounts).set(data).where(eq(bankAccounts.id, id));
    await audit(tx, { userId: a.userId, firmId: a.firmId, action: 'saveBankAcct', entityType: 'bank_account', entityId: id, data });
    // legacy change listener 4846: a new konto re-books every statement of the account on it
    if (n && before.konto !== v.konto) {
      await syncFirmBanks(tx, a.firmId);
      const St = await tx.select({ id: bankStatements.id }).from(bankStatements).where(eq(bankStatements.bankAccountId, id));
      await postStatements(tx, St.map((s) => s.id), a.userId);
    }
  } else {
    const [{ mx }] = (await tx.select({ mx: sql<number>`coalesce(max(${bankAccounts.sort}), 0)::int` }).from(bankAccounts).where(eq(bankAccounts.firmId, a.firmId))) as [{ mx: number }];
    const [r] = await tx.insert(bankAccounts).values({ firmId: a.firmId, ...data, sort: mx + 1 }).returning({ id: bankAccounts.id });
    id = r!.id;
    await audit(tx, { userId: a.userId, firmId: a.firmId, action: 'addBankAcct', entityType: 'bank_account', entityId: id, data });
  }
  await syncFirmBanks(tx, a.firmId);
  return id;
}

/** FIX(4.4 #9): legacy `rmBankAcct` orphaned the account's rows (re-booked silently to the first account). */
export async function removeBankAccount(tx: Tx, a: { firmId: string; userId: string | null; id: string }): Promise<void> {
  const [{ n }] = (await tx.select({ n: sql<number>`count(*)::int` }).from(bankStatements).where(eq(bankStatements.bankAccountId, a.id))) as [{ n: number }];
  if (n) throw new BankError(`Сметката има ${n} изводи и не може да се отстрани.`);
  const [r] = await tx.delete(bankAccounts).where(and(eq(bankAccounts.id, a.id), eq(bankAccounts.firmId, a.firmId))).returning();
  if (!r) throw new BankError('Сметката не постои.');
  await syncFirmBanks(tx, a.firmId);
  await audit(tx, { userId: a.userId, firmId: a.firmId, action: 'rmBankAcct', entityType: 'bank_account', entityId: r.id, data: { name: r.name, konto: r.konto } });
}

