/**
 * Statement import: parsed file (`@wise/core` `parseStatementFile` / `parseBankTable`) → preview → save.
 *
 * Replaces the legacy import chain (`importRows`, `importMT940`, `importBankXml`, `importKB`, the `save('bank')`
 * wrappers) with one explicit pipeline: account detection by IBAN / number, owner check, per-day statements,
 * FX amounts at the statement rate (`fxRate` — FIX 4.4 #4, no hard-coded 61.5), duplicate detection
 * (`bankDupKey`, legacy `dupIds` / `_impAsk`), statement numbers (`assignStatementNumbers`), classification of
 * POS / currency conversion / own-account transfers (`classifyImported`, `pairConversions`), then posting.
 */
import { randomUUID } from 'node:crypto';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import {
  assignStatementNumbers, bankDupKey, classifyImported, fxRate, fxToMkd, pairConversions, splitStatementByDate,
  statementAccount, statementKey, statementOwnerMismatch,
  type BankRow, type ImportClass, type Statement,
} from '@wise/core';
import { audit, type Tx } from '../audit';
import { bankLines, bankStatements, partners, type BankAccountRow } from '../schema/index';
import { dec, loadBankEnv, loadFxSources, POS_PARTNER_NAME, type BankEnv } from './context';
import { postStatements } from './posting';
import { toBankRow } from './rows';
import { assertOpenPeriod } from '../posting';

export interface ImportOptions {
  firmId: string;
  userId: string | null;
  statements: Statement[];
  /** Account chosen in the UI, used when the file does not identify one. */
  defaultAccountId?: string | null;
  /** Skip lines already imported (default true). */
  skipDuplicates?: boolean;
  fileName?: string | null;
  fileId?: string | null;
  format?: string | null;
}

export interface PreviewLine {
  date: string;
  valDate?: string;
  /** MKD cents (null = FX line without a rate). */
  amount: number;
  amountCur: number | null;
  mkdFromBank: boolean;
  desc: string;
  name: string;
  purpose: string;
  osnov?: string;
  bref: string;
  counterAccount?: string;
  dup: boolean;
  dupKey: string;
  cls: ImportClass | 'fee';
  konto?: string;
  partner?: string;
  newPartner?: string;
  own?: boolean;
  conv?: boolean;
  pos?: boolean;
}

export interface PreviewDay {
  accountId: string;
  accountName: string;
  cur: string;
  date: string;
  no: string;
  /** Balances in the account currency (cents). */
  opening: number | null;
  closing: number | null;
  rate: number | null;
  /** A statement for this account and date already exists. */
  existingId: string | null;
  lines: PreviewLine[];
  /** Every line of this day was imported before. */
  allDup: boolean;
}

export interface ImportPlan { days: PreviewDay[]; warnings: string[]; errors: string[]; needPosPartner: boolean }

const FOREIGN_FEE_DESC = 'Провизија на странска банка';

export async function planImport(tx: Tx, o: ImportOptions, env0?: BankEnv): Promise<ImportPlan> {
  const env = env0 ?? (await loadBankEnv(tx, o.firmId));
  const fxs = await loadFxSources(tx, o.firmId);
  const warnings: string[] = [];
  const errors: string[] = [];
  const days: PreviewDay[] = [];
  let needPosPartner = false;
  if (!o.statements.length) errors.push('Во датотеката нема ставки од извод.');
  const accts = env.accountRows;
  const byId = new Map(accts.map((a) => [a.id, a]));
  const numbers = new Map<string, Record<string, string>>();
  const numsFor = async (a: BankAccountRow) => {
    let m = numbers.get(a.id);
    if (!m) {
      const S = await tx.select({ date: bankStatements.date, number: bankStatements.number }).from(bankStatements).where(eq(bankStatements.bankAccountId, a.id));
      m = Object.fromEntries(S.filter((s) => s.number).map((s) => [statementKey(a.id, s.date), s.number!]));
      numbers.set(a.id, m);
    }
    return m;
  };
  for (const st of o.statements) {
    const hit = statementAccount(st, accts.map((a) => ({ ...a, account: a.account ?? '' })));
    const acct = hit ? byId.get(hit.id)! : o.defaultAccountId ? byId.get(o.defaultAccountId) : undefined;
    if (!acct) { errors.push(`Не е пронајдена банкарска сметка за изводот${st.account ? ' ' + st.account : ''} – додадете ја сметката или изберете ја.`); continue; }
    if (!hit && (st.account || st.iban)) warnings.push(`Сметката од датотеката (${st.iban || st.account}) не е меѓу сметките на фирмата – увезено во „${acct.name}“.`);
    const fx = (acct.cur || 'MKD') !== 'MKD';
    if (st.currency && st.currency !== (acct.cur || 'MKD') && !(st.currency === 'MKD' && !fx)) warnings.push(`Валутата на изводот (${st.currency}) е различна од валутата на сметката „${acct.name}“ (${acct.cur}).`);
    if (statementOwnerMismatch(st.owner, env.firm.name)) warnings.push(`Изводот е на „${st.owner}“, а работите во фирмата „${env.firm.name}“. Проверете дали е вистинската фирма.`);
    const nums = await numsFor(acct);
    for (const day of splitStatementByDate(st)) {
      const [ex] = await tx.select().from(bankStatements).where(and(eq(bankStatements.bankAccountId, acct.id), eq(bankStatements.date, day.date))).limit(1);
      const rate = fx ? (ex?.rate != null ? Number(ex.rate) : fxRate(acct.cur, day.date, fxs) || null) : null;
      if (fx && !rate) warnings.push(`Нема курс за ${acct.cur} на ${day.date} – внесете го курсот на изводот.`);
      const lines: PreviewLine[] = [];
      for (const l of day.lines) {
        const mk = (amtCur: number, mkdBank?: number) => (fx ? (rate || mkdBank ? fxToMkd(amtCur, rate || 0, mkdBank) : 0) : amtCur);
        const base = {
          date: l.date || day.date, ...(l.valDate ? { valDate: l.valDate } : {}), name: l.counterparty || '', purpose: l.purpose || '',
          ...(l.osnov ? { osnov: l.osnov } : {}), bref: l.ref || '', ...(l.iban ? { counterAccount: l.iban } : {}),
        };
        const parts: { amt: number; mkdBank?: number; desc: string; fee?: boolean }[] = [];
        // Halk: a foreign bank deducted fees → book the gross inflow and the fee separately (legacy importBankXml 12636).
        if (l.nominal && l.nominal > l.amount && l.amount > 0) {
          parts.push({ amt: l.nominal, desc: l.desc });
          parts.push({ amt: l.amount - l.nominal, desc: FOREIGN_FEE_DESC, fee: true });
        } else parts.push({ amt: l.amount, ...(l.amountMkd ? { mkdBank: l.amountMkd } : {}), desc: l.desc });
        for (const p of parts) {
          const amount = mk(p.amt, p.mkdBank);
          const row: BankRow = {
            id: 'new', acct: acct.id, date: base.date, amount, desc: p.desc, ...(base.name ? { name: base.name } : {}),
            ...(base.purpose ? { purpose: base.purpose } : {}), ...(base.osnov ? { osnov: base.osnov } : {}),
            ...(fx ? { amountCur: p.amt, cur: acct.cur } : {}),
          };
          const dupKey = bankDupKey(row);
          let cls: PreviewLine['cls'] = null;
          let booked: BankRow = row;
          let newPartner: string | undefined;
          if (p.fee) { cls = 'fee'; booked = { ...row, konto: env.konta.fee }; }
          else {
            const c = classifyImported(row, { accounts: env.accounts, partners: env.partners, invoices: [], purchases: [], firmName: env.firm.name, posPartner: env.posPartner, konta: env.konta });
            cls = c.cls; booked = c.row; newPartner = c.newPartner;
            if (c.needPosPartner) needPosPartner = true;
          }
          lines.push({
            ...base, amount, amountCur: fx ? p.amt : null, mkdFromBank: !!p.mkdBank, desc: p.desc, dup: false, dupKey, cls,
            ...(booked.konto ? { konto: booked.konto } : {}), ...(booked.partner ? { partner: booked.partner } : {}),
            ...(newPartner ? { newPartner } : {}), ...(booked.own ? { own: true } : {}), ...(booked.conv ? { conv: true } : {}), ...(booked.pos ? { pos: true } : {}),
          });
        }
      }
      const keys = [...new Set(lines.map((l) => l.dupKey))];
      const seen = keys.length
        ? new Set((await tx.select({ k: bankLines.dupKey }).from(bankLines).where(and(eq(bankLines.firmId, o.firmId), inArray(bankLines.dupKey, keys)))).map((r) => r.k))
        : new Set<string>();
      for (const l of lines) l.dup = seen.has(l.dupKey);
      const allDup = lines.length > 0 && lines.every((l) => l.dup);
      let no = ex?.number || '';
      if (!no && !allDup) {
        const add = assignStatementNumbers(nums, acct.id, [day.date], day.no || undefined);
        no = Object.values(add)[0] ?? day.no ?? '';
        Object.assign(nums, add);
      }
      if (allDup) warnings.push(`Изводот ${no ? 'бр. ' + no + ' ' : ''}од ${day.date} („${acct.name}“) веќе е увезен.`);
      days.push({
        accountId: acct.id, accountName: acct.name, cur: acct.cur || 'MKD', date: day.date, no,
        opening: day.opening, closing: day.closing, rate, existingId: ex?.id ?? null, lines, allDup,
      });
    }
  }
  return { days, warnings: [...new Set(warnings)], errors, needPosPartner };
}

export interface ImportResult { batch: string; statements: number; lines: number; skipped: number; posted: number; drafts: number; plan: ImportPlan }

export async function saveImport(tx: Tx, o: ImportOptions): Promise<ImportResult> {
  const env = await loadBankEnv(tx, o.firmId);
  const plan = await planImport(tx, o, env);
  if (plan.errors.length) throw new ImportError(plan.errors.join(' '));
  const skip = o.skipDuplicates !== false;
  const batch = randomUUID();
  let posPartner = env.posPartner;
  if (plan.needPosPartner && !posPartner && plan.days.some((d) => d.lines.some((l) => l.pos && !(skip && l.dup)))) {
    // legacy `posEnsure`: the POS konto (1200001) is a partner konto, so card inflows need this partner.
    const [p] = await tx.insert(partners).values({ firmId: o.firmId, name: POS_PARTNER_NAME, vatRegistered: false, data: { pos: true } }).returning({ id: partners.id });
    posPartner = p!.id;
    await audit(tx, { userId: o.userId, firmId: o.firmId, action: 'posEnsure', entityType: 'partner', entityId: posPartner, data: { name: POS_PARTNER_NAME } });
  }
  const touched = new Set<string>();
  let nLines = 0;
  let skipped = 0;
  for (const d of plan.days) {
    const L = d.lines.filter((l) => !(skip && l.dup));
    skipped += d.lines.length - L.length;
    if (!L.length) continue;
    assertOpenPeriod(env.firm, d.date);
    const toDec = (c: number | null) => (c == null ? null : dec(c));
    let stId = d.existingId;
    if (stId) {
      const [ex] = await tx.select().from(bankStatements).where(eq(bankStatements.id, stId)).limit(1);
      await tx.update(bankStatements).set({
        number: ex!.number || d.no || null,
        opening: ex!.opening ?? toDec(d.opening), closing: ex!.closing ?? toDec(d.closing),
        rate: ex!.rate ?? (d.rate != null ? String(d.rate) : null),
      }).where(eq(bankStatements.id, stId));
    } else {
      const [s] = await tx.insert(bankStatements).values({
        firmId: o.firmId, bankAccountId: d.accountId, date: d.date, number: d.no || null,
        opening: toDec(d.opening), closing: toDec(d.closing), rate: d.rate != null ? String(d.rate) : null,
        format: o.format ?? null, fileName: o.fileName ?? null, fileId: o.fileId ?? null, importBatch: batch, createdBy: o.userId,
      }).returning({ id: bankStatements.id });
      stId = s!.id;
    }
    const [{ mx }] = (await tx.select({ mx: sql<number>`coalesce(max(${bankLines.lineNo}), 0)::int` }).from(bankLines).where(eq(bankLines.statementId, stId))) as [{ mx: number }];
    await tx.insert(bankLines).values(L.map((l, i) => ({
      firmId: o.firmId, statementId: stId!, bankAccountId: d.accountId, lineNo: mx + i + 1, date: l.date, valDate: l.valDate ?? null,
      amount: dec(l.amount), amountCur: l.amountCur != null ? dec(l.amountCur) : null, cur: d.cur !== 'MKD' ? d.cur : null, mkdFromBank: l.mkdFromBank,
      description: l.desc, name: l.name || null, purpose: l.purpose || null, osnov: l.osnov ?? null, bref: l.bref || null, counterAccount: l.counterAccount ?? null,
      konto: l.konto ?? null, partnerId: l.partner ?? (l.pos ? posPartner ?? null : null), own: !!l.own, conv: !!l.conv, pos: !!l.pos,
      auto: l.cls ?? null, newPartner: l.newPartner ?? null, dupKey: l.dupKey, importBatch: batch,
    })));
    nLines += L.length;
    touched.add(stId);
  }
  // Currency purchase/sale: pair the FX side with the denar side of the same day (legacy `convPair`).
  if (touched.size) {
    const dates = [...new Set(plan.days.map((d) => d.date))];
    const R = await tx.select().from(bankLines).where(and(eq(bankLines.firmId, o.firmId), inArray(bankLines.date, dates))).orderBy(asc(bankLines.date));
    for (const u of pairConversions(R.map(toBankRow), env.accounts, env.konta)) {
      const [row] = await tx.update(bankLines).set({ konto: u.konto ?? null, conv: true, own: true, auto: 'conv' }).where(eq(bankLines.id, u.id)).returning({ st: bankLines.statementId });
      if (row) touched.add(row.st);
    }
  }
  const res = await postStatements(tx, touched, o.userId);
  const posted = [...res.values()].filter((r) => r.status === 'posted').length;
  await audit(tx, {
    userId: o.userId, firmId: o.firmId, action: 'importBank', entityType: 'bank_import', entityId: batch,
    data: { file: o.fileName ?? null, format: o.format ?? null, statements: touched.size, lines: nLines, skipped },
  });
  return { batch, statements: touched.size, lines: nLines, skipped, posted, drafts: touched.size - posted, plan };
}

export class ImportError extends Error {
  constructor(m: string) { super(m); this.name = 'ImportError'; }
}

