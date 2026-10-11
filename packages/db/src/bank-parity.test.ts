/** Finance parity — statement services on PGlite: bank konto in the chart, partner fix, numbering by neighbour, POS fee, manual FX line. */
import { PGlite } from '@electric-sql/pglite';
import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  addManualLine, applyBankPartnerFix, bankPartnerFixPlan, bookBankPosFee, fillStatementNumbers, ledgerOpenItemsSource, posBalance, saveBankAccount,
  saveFxList, setLineKonto, setOpenItemsSource, statementNoSuggestions,
} from './bank/index';
import { postJournal } from './posting';
import * as schema from './schema/index';
import { seedReference } from './seed/reference';

const db = drizzle(new PGlite(), { schema });
let firmId = '';
let mkd = '';
const T = <R>(f: (tx: typeof db) => Promise<R>) => db.transaction((tx) => f(tx as unknown as typeof db));

beforeAll(async () => {
  setOpenItemsSource(ledgerOpenItemsSource);
  await migrate(db, { migrationsFolder: fileURLToPath(new URL('../migrations', import.meta.url)) });
  await seedReference(db);
  const [f] = await db.insert(schema.firms).values({ name: 'Паритет ДООЕЛ' }).returning();
  firmId = f!.id;
}, 60_000);

describe('bank accounts (legacy addBankAcct 7203)', () => {
  it('creates the analytic konto in the chart and rejects a konto used by another account', async () => {
    mkd = await T((tx) => saveBankAccount(tx, { firmId, userId: null, input: { name: 'Халкбанк', account: '250000000111111', cur: 'MKD', konto: '100077' } }));
    const [a] = await db.select().from(schema.accounts).where(and(eq(schema.accounts.firmId, firmId), eq(schema.accounts.code, '100077')));
    expect(a!.name).toBe('Трансакциска сметка – Халкбанк');
    await expect(T((tx) => saveBankAccount(tx, { firmId, userId: null, input: { name: 'Друга', cur: 'MKD', konto: '100077' } }))).rejects.toThrow(/веќе се користи/);
  });
});

describe('statement lines', () => {
  it('links 12x/22x lines to the partner named in the statement (bkpFix) and suggests numbers by neighbour (izvSugg)', async () => {
    const l1 = await T((tx) => addManualLine(tx, { firmId, userId: null, bankAccountId: mkd, date: '2026-02-03', amount: 500, desc: 'Гама ДОО - уплата аванс' }));
    await T((tx) => setLineKonto(tx, { firmId, userId: null, lineId: l1, konto: '1200', learn: false }));
    await T((tx) => addManualLine(tx, { firmId, userId: null, bankAccountId: mkd, date: '2026-02-04', amount: -10, desc: 'провизија', konto: '4460' }));
    const plan = await T((tx) => bankPartnerFixPlan(tx, firmId, 2026));
    expect(plan.map((x) => x.name)).toEqual(['Гама ДОО']);
    const r = await T((tx) => applyBankPartnerFix(tx, { firmId, userId: null, year: 2026 }));
    expect(r).toEqual({ linked: 1, created: 1 });
    const [ln] = await db.select().from(schema.bankLines).where(eq(schema.bankLines.id, l1));
    expect(ln!.partnerId).toBeTruthy();
    // numbers: manual lines got numbers 1, 2 → clear the second and let the suggestion refill it
    await db.update(schema.bankStatements).set({ number: null }).where(eq(schema.bankStatements.date, '2026-02-04'));
    const S = await T((tx) => statementNoSuggestions(tx, firmId, 2026));
    expect([...S.values()]).toEqual(['2']);
    expect(await T((tx) => fillStatementNumbers(tx, { firmId, userId: null, year: 2026 }))).toBe(1);
  });

  it('rejects the bank konto itself as a counter konto', async () => {
    const l = await T((tx) => addManualLine(tx, { firmId, userId: null, bankAccountId: mkd, date: '2026-02-05', amount: 1, desc: 'x' }));
    await expect(T((tx) => setLineKonto(tx, { firmId, userId: null, lineId: l, konto: '100077' }))).rejects.toThrow(/банкарска сметка/);
  });

  it('converts a manual FX line by the rate list (mbSave → fxItem)', async () => {
    const eur = await T((tx) => saveBankAccount(tx, { firmId, userId: null, input: { name: 'Халкбанк EUR', cur: 'EUR', konto: '103005' } }));
    await T((tx) => saveFxList(tx, { userId: null, date: '2026-01-01', rows: [{ cur: 'EUR', rate: 61.5 }] } as never));
    const id = await T((tx) => addManualLine(tx, { firmId, userId: null, bankAccountId: eur, date: '2026-03-01', amount: 0, amountCur: 100, desc: 'уплата EUR' }));
    const [l] = await db.select().from(schema.bankLines).where(eq(schema.bankLines.id, id));
    expect([l!.amountCur, l!.amount]).toEqual(['100.00', '6150.00']);
  });
});

describe('POS fee (legacy posFee 13078)', () => {
  it('books D 4460 / P POS konto up to the open balance', async () => {
    const [pp] = await db.insert(schema.partners).values({ firmId, name: 'POS терминал' }).returning();
    await T((tx) => postJournal(tx, { firmId, date: '2026-04-01', kind: 'manual', userId: null, lines: [{ account: '1200001', debit: 1000, partnerId: pp!.id }, { account: '7400', credit: 1000 }] }));
    await T((tx) => postJournal(tx, { firmId, date: '2026-04-02', kind: 'manual', userId: null, lines: [{ account: '100077', debit: 980 }, { account: '1200001', credit: 980, partnerId: pp!.id }] }));
    const b = await T((tx) => posBalance(tx, firmId, 2026));
    expect([b.d, b.p, b.s, b.state]).toEqual([100000, 98000, 2000, 'fee']);
    await expect(T((tx) => bookBankPosFee(tx, { firmId, userId: null, year: 2026, amount: 5000, date: '2026-04-02' }))).rejects.toThrow(/најмногу/);
    await T((tx) => bookBankPosFee(tx, { firmId, userId: null, year: 2026, amount: 2000, date: '2026-04-02' }));
    expect((await T((tx) => posBalance(tx, firmId, 2026))).s).toBe(0);
  });
});
