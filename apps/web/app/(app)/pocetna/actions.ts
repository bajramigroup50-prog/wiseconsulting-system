'use server';
/**
 * Opening balance (legacy `saveOpen` chain 7329 → 10690 → 12229 → 13246 → 17173, `transfer`/`openYear`, `obClearAll`, `bbImpDel`).
 * Journals: kind `open` (source `opening` / `open-<Y>`, the year's opening balance) or kind `bbimp`
 * (source `bbimp` / `bbimp-<Y>`, an imported full-year trial balance for year-end, dated 31.12).
 */
import { revalidatePath } from 'next/cache';
import { and, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { ACCOUNT_CODE_RE, digitsOnly, lineTotals, matchPartner, NEW_ACCOUNT_CODE_RE, normalizeName } from '@wise/core';
import { obBankRows } from '@wise/core/finpar-ob';
import {
  accounts, afterImportedTbDeleted, audit, bankAccounts, isIsoDate, openNextYear, partners, PostingError, postJournal, saveBankAccount, unpostSource, type Tx,
} from '@wise/db';
import { actionError, firmAction, type ActionState } from '@/lib/books';
import { db } from '@/lib/db';
import { todayMk } from '@/lib/yearend';

const amount = z.union([z.string(), z.number()]).transform((v) => Number(String(v).trim().replace(/\s/g, '').replace(',', '.')) || 0);
const Row = z.object({
  account: z.string().trim().max(10), name: z.string().trim().max(300).optional().default(''),
  partnerId: z.string().max(40).optional().default(''), partnerName: z.string().trim().max(300).optional().default(''),
  partnerCode: z.string().trim().max(40).optional().default(''), debit: amount, credit: amount,
  note: z.string().trim().max(300).optional().default(''),
});
const Input = z.object({ full: z.boolean(), date: z.string(), rows: z.array(Row).max(20000) });

const openingSource = (year: number, full: boolean) =>
  full ? { sourceType: 'bbimp', sourceId: `bbimp-${year}` } : { sourceType: 'opening', sourceId: `open-${year}` };

/**
 * Create the partners named in imported rows that don't exist yet.
 * FIX(#7): legacy had two copies of this (saveOpen wrapper 10690 and obMakePartners 12212); this is the only one.
 * EDB is stored only for 13-digit numbers, otherwise the value is kept as the partner code (legacy rule).
 */
async function ensurePartners(tx: Tx, firmId: string, userId: string, rows: z.infer<typeof Row>[]): Promise<number> {
  const need = rows.filter((r) => r.partnerName && !r.partnerId && (r.debit || r.credit));
  if (!need.length) return 0;
  const P = await tx.select({ id: partners.id, name: partners.name, code: partners.code, edb: partners.edb, embs: partners.embs }).from(partners).where(eq(partners.firmId, firmId));
  const made = new Map<string, string>();
  let n = 0;
  for (const r of need) {
    const key = normalizeName(r.partnerName);
    let id = made.get(key) || matchPartner(r.partnerName, r.partnerCode, P);
    if (!id) {
      const c = digitsOnly(r.partnerCode);
      const [p] = await tx.insert(partners).values({ firmId, name: r.partnerName, ...(c.length === 13 ? { edb: c } : r.partnerCode ? { code: r.partnerCode.trim() } : {}) })
        .returning({ id: partners.id, name: partners.name, code: partners.code, edb: partners.edb, embs: partners.embs });
      id = p!.id;
      P.push(p!);
      n++;
      await audit(tx, { userId, firmId, action: 'obMkP', entityType: 'partner', entityId: id, data: { name: r.partnerName } });
    }
    made.set(key, id);
    r.partnerId = id;
  }
  return n;
}

/** Accounts used in the rows that the firm's chart doesn't have yet are added as firm accounts (legacy 7330). */
async function ensureAccounts(tx: Tx, firmId: string, userId: string, rows: z.infer<typeof Row>[]): Promise<number> {
  const codes = [...new Set(rows.map((r) => r.account))];
  const have = await tx.select({ code: accounts.code, firmId: accounts.firmId, hidden: accounts.hidden }).from(accounts)
    .where(and(or(isNull(accounts.firmId), eq(accounts.firmId, firmId)), inArray(accounts.code, codes)));
  let n = 0;
  for (const c of codes) {
    const own = have.find((h) => h.code === c && h.firmId === firmId);
    if (own ? !own.hidden : have.some((h) => h.code === c && !h.firmId)) continue;
    if (!NEW_ACCOUNT_CODE_RE.test(c)) throw new PostingError('unknown_account', `Контото „${c}“ не постои, а ново конто мора да има 3–8 цифри.`);
    const name = rows.find((r) => r.account === c && r.name)?.name || 'Конто ' + c;
    await tx.insert(accounts).values({ firmId, code: c, name })
      .onConflictDoUpdate({ target: [accounts.firmId, accounts.code], targetWhere: sql`${accounts.firmId} is not null`, set: { name, hidden: false } });
    await audit(tx, { userId, firmId, action: 'saveAcc', entityType: 'account', entityId: c, data: { name, from: 'saveOpen' } });
    n++;
  }
  return n;
}

export async function saveOpening(_prev: ActionState, form: FormData): Promise<ActionState> {
  try {
    const parsed = Input.safeParse(JSON.parse(String(form.get('payload') ?? '{}')));
    if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Неважечки податоци.' };
    const { u, firm, year } = await firmAction('write');
    const v = parsed.data;
    const date = v.full ? `${year}-12-31` : v.date;
    if (!isIsoDate(date) || !date.startsWith(String(year))) return { error: `Датумот мора да биде во ${year} година.` };
    const rows = v.rows.filter((r) => r.account && (r.debit || r.credit));
    if (!rows.length) return { error: 'Нема внесени износи.' };
    const bad = rows.find((r) => !ACCOUNT_CODE_RE.test(r.account));
    if (bad) return { error: `Контото „${bad.account}“ не е валидно (3–8 цифри).` };
    const t = lineTotals(rows);
    if (!t.balanced) return { error: `Не е изедначено: должи ${t.D.toFixed(2)} / побарува ${t.P.toFixed(2)} (разлика ${t.diff.toFixed(2)}).` };
    let msg = '';
    await db().transaction(async (tx) => {
      const np = await ensurePartners(tx, firm.id, u.id, rows);
      const na = await ensureAccounts(tx, firm.id, u.id, rows);
      const res = await postJournal(tx, {
        firmId: firm.id, date, kind: v.full ? 'bbimp' : 'open', ...openingSource(year, v.full),
        description: v.full ? `Бруто биланс ${year} (увоз за завршна сметка)` : `Почетна состојба ${year}`,
        lines: rows.map((r) => ({ account: r.account, debit: r.debit, credit: r.credit, partnerId: r.partnerId || null, note: r.note || null })),
        userId: u.id, requirePartner: false, auditAction: 'saveOpen',
      });
      // legacy `obAddBanks` 12222 (after saveOpen 12229): 100x / 103x rows become the firm's bank accounts (103x → EUR)
      let nb = 0;
      if (!v.full) {
        const have = await tx.select({ konto: bankAccounts.konto }).from(bankAccounts).where(eq(bankAccounts.firmId, firm.id));
        for (const r of obBankRows(rows, have.map((h) => h.konto))) {
          await saveBankAccount(tx, { firmId: firm.id, userId: u.id, input: { name: r.name || 'Сметка ' + r.account, cur: /^103/.test(r.account) ? 'EUR' : 'MKD', konto: r.account } });
          nb++;
        }
      }
      msg = `${v.full ? 'Бруто билансот' : 'Почетната состојба'} за ${year} е зачувана (налог ${res.number}, ${rows.length} ставки)`
        + (np ? `; креирани ${np} нови партнери` : '') + (na ? `; додадени ${na} нови конта` : '') + (nb ? `; внесени ${nb} банкарски сметки кај фирмата` : '') + '.';
    });
    revalidatePath('/pocetna');
    return { ok: msg };
  } catch (e) { return actionError(e); }
}

/** Legacy `obClearAll` / `bbImpDel`: delete the saved opening balance or imported trial balance of the year (needs `del`). */
export async function deleteOpening(full: boolean): Promise<ActionState> {
  try {
    const { u, firm, year } = await firmAction('del');
    await db().transaction(async (tx) => {
      await unpostSource(tx, { firmId: firm.id, ...openingSource(year, full), userId: u.id });
      // legacy `ACT.bbImpDel` wrapper 17176: a close rebuilt from this imported trial balance goes with it
      if (full) await afterImportedTbDeleted(tx, { firmId: firm.id, year, userId: u.id });
    });
  } catch (e) { return actionError(e); }
  revalidatePath('/pocetna');
  return { ok: 'Избришано.' };
}

/*
 * Phase 8: the stopgap `closePrevYear` (flat 10 % profit tax, Phase 2) is removed — the previous year is closed on
 * the year-end close screen (`/mbyllja`, ДБ tax, entity-aware, behind the phase gate). The carry-forward below is the
 * same year-end service call as the "Нова година" screen.
 */

/** Legacy `transfer` 7323 → `openYear` 6744: carry the closed previous year into this year's opening balance (needs `close`). */
export async function transferFromPrevYear(): Promise<ActionState> {
  try {
    const { u, firm, year } = await firmAction('transfer');
    const r = await db().transaction((tx) => openNextYear(tx, { firmId: firm.id, year: year - 1, userId: u.id, today: todayMk() }));
    revalidatePath('/pocetna');
    return { ok: `Преносот е направен: почетна состојба за ${year} на 01.01.${year} (${r.lines} ставки).` };
  } catch (e) { return actionError(e); }
}
