/**
 * Workflow 6 — opening balance (Почетна состојба): manual entry and the Excel import (the editor's SheetJS →
 * `parseOpeningSheet` → `buildOpening` path) saved through `saveOpening`, then the trial balance (Бруто биланс, the
 * page's `aggregatedLines` → `trialBalance`) — debit and credit totals equal, partners and bank accounts created.
 */
import { and, eq } from 'drizzle-orm';
import * as XLSX from 'xlsx';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { buildOpening, parseOpeningSheet, tbTotal, trialBalance } from '@wise/core';
import { schema } from '@wise/db';
import { form, pg, setupDb, signIn, useFirm, useYear } from '../harness';

vi.mock('@/lib/db', () => import('../harness').then((h) => h.dbModule));
vi.mock('next/headers', () => import('../harness').then((h) => h.headersModule));
vi.mock('next/cache', () => import('../harness').then((h) => h.cacheModule));

const { saveOpening } = await import('@/app/(app)/pocetna/actions');
const { aggregatedLines } = await import('@/lib/ledger-agg');

let manual = '', excel = '';
const save = (full: boolean, date: string, rows: Record<string, unknown>[]) => saveOpening({}, form({ payload: JSON.stringify({ full, date, rows }) }));
async function tb(firmId: string) {
  const lines = await aggregatedLines(firmId, '2026-01-01', '2026-12-31', '');
  return trialBalance(lines, { level: 'a', from: '2026-01-01', to: '2026-12-31', withClose: false, partnerId: null });
}

beforeAll(async () => {
  await setupDb();
  const F = await pg.insert(schema.firms).values([{ name: 'ПОЧЕТНА РАЧНО ДООЕЛ' }, { name: 'ПОЧЕТНА EXCEL ДООЕЛ' }]).returning();
  manual = F[0]!.id; excel = F[1]!.id;
  await signIn('admin');
  useYear(2026);
}, 120_000);

describe('flow 6 — opening balance', () => {
  it('refuses an unbalanced entry', async () => {
    useFirm(manual);
    const r = await save(false, '2026-01-01', [{ account: '1000', debit: 100, credit: 0 }, { account: '9000', debit: 0, credit: 90 }]);
    expect(r.error).toMatch(/Не е изедначено/);
  });

  it('manual entry: posts the opening journal, creates partners and the bank account', async () => {
    useFirm(manual);
    const r = await save(false, '2026-01-01', [
      { account: '1000', name: 'Жиро сметка', debit: 50000, credit: 0 },
      { account: '1200', partnerName: 'Купувач А ДООЕЛ', partnerCode: '4030000000101', debit: 30000, credit: 0 },
      { account: '2200', partnerName: 'Добавувач Б ДОО', debit: 0, credit: 20000 },
      { account: '9000', debit: 0, credit: 60000 },
    ]);
    expect(r.error).toBeUndefined();
    expect(r.ok).toMatch(/креирани 2 нови партнери/);
    expect(r.ok).toMatch(/банкарски сметки/);
    const P = await pg.select().from(schema.partners).where(eq(schema.partners.firmId, manual));
    expect(P.find((p) => p.name === 'Купувач А ДООЕЛ')!.edb).toBe('4030000000101');
    const B = await pg.select().from(schema.bankAccounts).where(eq(schema.bankAccounts.firmId, manual));
    expect(B.map((b) => b.konto)).toEqual(['1000']);
    const [j] = await pg.select().from(schema.journals).where(and(eq(schema.journals.firmId, manual), eq(schema.journals.kind, 'open')));
    expect(j).toMatchObject({ date: '2026-01-01', sourceId: 'open-2026' });
    const T = tbTotal((await tb(manual)).rows);
    expect([T.od, T.op, T.vd, T.vp, T.s]).toEqual([80000, 80000, 80000, 80000, 0]);
  });

  it('Excel import: the sheet is read, partners matched / created, and the trial balance agrees with the file', async () => {
    useFirm(excel);
    await pg.insert(schema.partners).values({ firmId: excel, name: 'ПОСТОЕЧКИ КУПУВАЧ ДОО', edb: '4030000000202' });
    const ws = XLSX.utils.aoa_to_sheet([
      ['Аналитички бруто биланс на 31.12.2025'],
      ['Конто', 'Назив на конто', 'Комитент', 'Шифра на комитент / ЕДБ', 'Салдо должи', 'Салдо побарува'],
      ['1000', 'Жиро сметка', '', '', 12500.5, 0],
      ['1200', 'Купувачи', 'ПОСТОЕЧКИ КУПУВАЧ ДОО', '4030000000202', 7000, 0],
      ['1200', 'Купувачи', 'НОВ КУПУВАЧ ДООЕЛ', '4030000000303', 3000, 0],
      ['2200', 'Добавувачи', 'ДОБАВУВАЧ В ДОО', '', 0, 4500.5],
      ['0220', 'Опрема', '', '', 20000, 0],
      ['0290', 'Исправка на опрема', '', '', 0, 6000],
      ['9000', 'Основна главнина', '', '', 0, 32000],
      ['', 'Вкупно', '', '', 42500.5, 42500.5],
    ]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'ББ');
    const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
    const grid = XLSX.utils.sheet_to_json<unknown[]>(XLSX.read(new Uint8Array(buf), { type: 'array' }).Sheets['ББ']!, { header: 1, raw: true, defval: '' });
    const R = parseOpeningSheet(grid, 'excel');
    expect(R).not.toBeNull();
    const partners = await pg.select({ id: schema.partners.id, name: schema.partners.name, code: schema.partners.code, edb: schema.partners.edb, embs: schema.partners.embs }).from(schema.partners).where(eq(schema.partners.firmId, excel));
    const b = buildOpening(R!, { full: false, partners });
    expect(b.rows).toHaveLength(7); // the total row is not an item
    expect(b.rows.find((r) => r.partnerName === 'ПОСТОЕЧКИ КУПУВАЧ ДОО' || r.partnerId === partners[0]!.id)!.partnerId).toBe(partners[0]!.id);
    const r = await save(false, '2026-01-01', b.rows.map((x) => ({ account: x.account, name: x.name, partnerId: x.partnerId ?? '', partnerName: x.partnerName ?? '', partnerCode: x.partnerCode ?? '', debit: x.debit, credit: x.credit })));
    expect(r.error).toBeUndefined();
    expect(r.ok).toMatch(/креирани 2 нови партнери/);
    const T = (await tb(excel)).rows;
    const tot = tbTotal(T);
    expect([tot.od, tot.op]).toEqual([42500.5, 42500.5]);
    expect(T.find((x) => x.k === '1200')!.s).toBe(10000);
    expect(T.find((x) => x.k === '0290')!.s).toBe(-6000);
    // partner cards: 1200 per customer
    const L = await pg.select().from(schema.journalLines).where(and(eq(schema.journalLines.firmId, excel), eq(schema.journalLines.account, '1200')));
    expect(L.map((l) => [Number(l.debit), !!l.partnerId]).sort()).toEqual([[3000, true], [7000, true]]);
  });
});
