/**
 * Statement lines that are never partners (PGlite, synthetic data): bank provisions / card purchases at import, the
 * suggestions for salaries, the Treasury and the Ministry of Finance, „Поврзи ги со комитентот од изводот“, an inflow
 * left on 2200, the partner dropped on 1020 / 4460 and „+ Ново конто“ from the line form.
 */
import { PGlite } from '@electric-sql/pglite';
import { asc, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Statement, StatementLine } from '@wise/core';
import { bankPartnerFixPlan, createLineKonto, saveImport, setLineKonto, statementSuggestions } from './bank/index';
import * as schema from './schema/index';
import { seedReference } from './seed/reference';

const db = drizzle(new PGlite(), { schema });
const T = <R>(f: (tx: typeof db) => Promise<R>) => db.transaction((tx) => f(tx as unknown as typeof db));
const err = async (p: Promise<unknown>) => { try { await p; } catch (e) { return e as Error; } throw new Error('expected an error'); };

const ACC = '210000000000123';
const ln = (amount: number, counterparty: string, purpose: string): StatementLine => ({ date: '2026-07-10', amount, counterparty, ref: '', purpose, desc: `${counterparty} – ${purpose}` });

let firmId = '';
const lines = async () => {
  const [s] = await db.select().from(schema.bankStatements).where(eq(schema.bankStatements.firmId, firmId));
  return db.select().from(schema.bankLines).where(eq(schema.bankLines.statementId, s!.id)).orderBy(asc(schema.bankLines.lineNo));
};

beforeAll(async () => {
  await migrate(db, { migrationsFolder: fileURLToPath(new URL('../migrations', import.meta.url)) });
  await seedReference(db);
  firmId = (await db.insert(schema.firms).values({ name: 'Тест Фирма ДООЕЛ' }).returning())[0]!.id;
  await db.insert(schema.partners).values([{ firmId, name: 'VENG HAUS DOO SKOPJE' }, { firmId, name: 'НЛБ БАНКА АД', code: '0209' }]);
  const st: Statement = {
    format: 'halk-xml', account: ACC, no: '7', date: '2026-07-10', currency: 'MKD', opening: null, closing: null, debit: null, credit: null, lines: [
      ln(-150_00, 'НЛБ Банка', 'Провизии'),
      ln(-300_00, 'НЛБ Банка', 'ПРОВИЗИЈА ЗА ЕЛЕКТРОНСКО БАНКАРСТВО'),
      ln(-1_234_00, 'MBDP:8330:4111', 'KAFE BAR SKOPJE'),
      ln(-26_046_00, 'Цана Деа', '9102026074061273115724+ 07-2026'),
      ln(-5_000_00, 'Трезор на РМ', 'Penziski 07-2026'),
      ln(-8_000_00, 'МИНИСТЕРСТВО ЗА ФИНАНСИИ', 'уплата мдб 06/2026'),
      ln(-120_00, 'МИНИСТЕРСТВО ЗА ФИНАНСИИ', 'камата'),
      ln(3_540_00, 'ВЕНГ ХАУС ДОО Скопје', 'уплата'),
    ],
  };
  await T((tx) => saveImport(tx, { firmId, userId: null, statements: [st] }));
}, 120_000);

describe('import & suggestions', () => {
  it('provisions → 4460, card → 1020, without a partner; nothing proposed as a new partner', async () => {
    const L = await lines();
    expect(L.every((l) => !l.partnerId && !l.newPartner)).toBe(true);
    const S = await T((tx) => statementSuggestions(tx, firmId, [L[0]!.statementId]));
    expect(L.slice(0, 3).map((l) => [S.get(l.id)!.konto, S.get(l.id)!.partnerId ?? null, S.get(l.id)!.newPartner ?? null]))
      .toEqual([['4460', null, null], ['4460', null, null], ['1020', null, null]]);
  });

  it('salary → net-salary konto, Treasury → pension, Ministry of Finance → 2330 / 44792; the customer → 1200 with VENG HAUS', async () => {
    const L = await lines();
    const S = await T((tx) => statementSuggestions(tx, firmId, [L[0]!.statementId]));
    const k = (i: number) => S.get(L[i]!.id);
    expect(k(3)).toMatchObject({ konto: '2401' });
    expect(k(4)).toMatchObject({ konto: '2341' });
    expect(k(5)).toMatchObject({ konto: '2330' });
    expect(k(6)).toMatchObject({ konto: '44792' });
    for (const i of [3, 4, 5, 6]) { expect(k(i)!.partnerId).toBeUndefined(); expect(k(i)!.newPartner).toBeUndefined(); }
    expect(k(7)).toMatchObject({ konto: '1200' });
  });

  it('„Поврзи ги со комитентот од изводот“ lists none of the bank / Treasury / Ministry / employee lines', async () => {
    const plan = await T((tx) => bankPartnerFixPlan(tx, firmId, 2026));
    expect(plan.map((x) => x.name)).toEqual(['ВЕНГ ХАУС ДОО Скопје']);
  });

  it('an inflow left on 2200 (no invoice) is re-proposed on 1200', async () => {
    const L = await lines();
    await db.update(schema.bankLines).set({ konto: '2200' }).where(eq(schema.bankLines.id, L[7]!.id));
    const S = await T((tx) => statementSuggestions(tx, firmId, [L[0]!.statementId]));
    expect(S.get(L[7]!.id)).toMatchObject({ konto: '1200' });
  });
});

describe('line form', () => {
  it('a card line booked on 1020 with the bank as partner drops the partner', async () => {
    const L = await lines();
    const [nlb] = await db.select().from(schema.partners).where(eq(schema.partners.code, '0209'));
    await T((tx) => setLineKonto(tx, { firmId, userId: null, lineId: L[2]!.id, konto: '1020', partnerId: nlb!.id, learn: false, post: false }));
    expect((await lines())[2]!.partnerId).toBeNull();
  });

  it('„+ Ново конто“: created under its synthetic with the parent name; a code without a parent is refused', async () => {
    expect(await T((tx) => createLineKonto(tx, { firmId, userId: null, code: '44799' }))).toBe('44799');
    const [a] = await db.select().from(schema.accounts).where(eq(schema.accounts.code, '44799'));
    const [p] = await db.select().from(schema.accounts).where(eq(schema.accounts.code, '4479'));
    expect(a!.name).toBe(p!.name);
    expect((await err(T((tx) => createLineKonto(tx, { firmId, userId: null, code: '123456789' })))).message).toContain('4–8 цифри');
  });
});
