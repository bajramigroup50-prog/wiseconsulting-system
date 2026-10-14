/**
 * 🤖 WISE Робот tools: firm isolation (a tool never reads another firm, even when the model passes its id), free
 * router answers, read-only tools on real books, and the journal draft (balanced + konto in the chart, else refused).
 */
import { PGlite } from '@electric-sql/pglite';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { postJournal } from './posting';
import { robotFirmAccess, robotFreeAnswer, robotThread, robotAskRows, ROBOT_TOOLS, runRobotTool, type RobotCtx } from './robot/index';
import * as schema from './schema/index';
import { seedReference } from './seed/reference';
import type { Tx } from './audit';

const pg = drizzle(new PGlite(), { schema });
const db = pg as unknown as Tx;
let A: typeof schema.firms.$inferSelect, B: typeof schema.firms.$inferSelect;
let user = '', viewer = '', pA = '', pB = '';
const ctxA = (): RobotCtx => ({ db, firm: A, year: 2026, userId: user, today: '2026-10-14' });

beforeAll(async () => {
  await migrate(pg, { migrationsFolder: fileURLToPath(new URL('../migrations', import.meta.url)) });
  await seedReference(pg);
  [A] = (await pg.insert(schema.firms).values({ name: 'Алфа ДООЕЛ', edb: '4030000000011', vatRegistered: true }).returning()) as [typeof A];
  [B] = (await pg.insert(schema.firms).values({ name: 'Бета ДОО', edb: '4030000000022', vatRegistered: true }).returning()) as [typeof B];
  const [u] = await pg.insert(schema.users).values({ username: 'acc1', name: 'Сметководител', role: 'acc', passwordHash: 'x' }).returning();
  const [v] = await pg.insert(schema.users).values({ username: 'acc2', name: 'Друг', role: 'acc', passwordHash: 'x' }).returning();
  user = u!.id; viewer = v!.id;
  await pg.insert(schema.userFirms).values({ userId: user, firmId: A.id });
  const [pa] = await pg.insert(schema.partners).values({ firmId: A.id, name: 'Купувач Алфа', code: '001', edb: '4030999000001' }).returning();
  const [pb] = await pg.insert(schema.partners).values({ firmId: B.id, name: 'Тајна Бета', code: '001', edb: '4030999000002' }).returning();
  pA = pa!.id; pB = pb!.id;
  // A: sale 1.000 to the customer, 300 cash; B: a large amount that must never leak into A's answers
  await pg.transaction((tx) => postJournal(tx, { firmId: A.id, date: '2026-03-10', kind: 'manual', lines: [{ account: '1200', debit: 1000, partnerId: pA }, { account: '7400', credit: 1000 }], userId: null }));
  await pg.transaction((tx) => postJournal(tx, { firmId: A.id, date: '2026-03-11', kind: 'manual', lines: [{ account: '1020', debit: 300 }, { account: '7400', credit: 300 }], userId: null }));
  await pg.transaction((tx) => postJournal(tx, { firmId: B.id, date: '2026-03-10', kind: 'manual', description: 'Тајна Бета налог', lines: [{ account: '1200', debit: 987654.32, partnerId: pB }, { account: '7400', credit: 987654.32 }], userId: null }));
}, 120_000);

describe('firm isolation', () => {
  it('no tool has a firm / year / user input field', () => {
    for (const t of ROBOT_TOOLS) for (const k of Object.keys(t.input_schema.properties)) expect(['firmId', 'firm_id', 'firm', 'year', 'userId']).not.toContain(k);
  });
  it('a firm id passed by the model is ignored: balances, partners and documents stay in the context firm', async () => {
    const bal = await runRobotTool(ctxA(), 'account_balance', { konto: '1200', firmId: B.id, firm_id: B.id, year: 2025 });
    expect(bal.ok).toBe(true);
    expect(bal.data).toMatchObject({ closing: 1000 });
    expect(JSON.stringify(bal)).not.toContain('987');
    const tb = await runRobotTool(ctxA(), 'trial_balance', { konto: '7400', firmId: B.id });
    expect(JSON.stringify(tb.data)).not.toContain('987654');
    const p = await runRobotTool(ctxA(), 'partner_card', { partner: 'Тајна Бета', firmId: B.id });
    expect(p.ok).toBe(false);
    expect(p.summary).toMatch(/Нема комитент/);
    const f = await runRobotTool(ctxA(), 'find_documents', { text: 'Тајна', firmId: B.id });
    expect(JSON.stringify(f.data)).not.toContain('Тајна');
    // a journal draft cannot reference the other firm's partner either
    const j = await runRobotTool(ctxA(), 'propose_journal', { firmId: B.id, date: '2026-05-01', lines: [{ konto: '1200', debit: 10, partner: 'Тајна Бета' }, { konto: '7400', credit: 10 }] });
    expect(j.ok).toBe(false);
  });
  it('firm access: assigned user yes, unassigned user no', async () => {
    expect((await robotFirmAccess(db, user, A.id))?.id).toBe(A.id);
    expect(await robotFirmAccess(db, user, B.id)).toBeNull();
    expect(await robotFirmAccess(db, viewer, A.id)).toBeNull();
  });
});

describe('free router (no AI)', () => {
  it('„салдо на конто 1200“ is answered by the tool with the exact amount and a link to the screen', async () => {
    const r = await robotFreeAnswer(ctxA(), 'Салдо на конто 1200');
    expect(r?.tool).toBe('account_balance');
    expect(r!.out.summary).toContain('1.000,00 ден.');
    expect(r!.out.sources[0]!.href).toMatch(/^\/kkart\?k=1200/);
  });
  it('cash, deadlines and the health check answer without the model', async () => {
    const c = await robotFreeAnswer(ctxA(), 'Состојба на благајна');
    expect(c?.tool).toBe('cash_bank');
    expect(c!.out.summary).toContain('300,00');
    const d = await robotFreeAnswer(ctxA(), 'рокови оваа недела');
    expect(d?.tool).toBe('deadlines');
    expect(d!.out.data).toMatchObject({ from: '2026-10-14', to: '2026-10-21' });
    // ДДВ-04 for Т3 is due 25.10 → outside one week, inside 14 days
    const d14 = await runRobotTool(ctxA(), 'deadlines', { days: 14 });
    expect(d14.summary).toContain('25.10.2026 – ДДВ-04 за 2026-Т3');
    const h = await robotFreeAnswer(ctxA(), 'Провери ја фирмата');
    expect(h?.tool).toBe('health_check');
    expect(h!.out.ok).toBe(true);
    expect(h!.out.summary).toMatch(/ЗДДВ чл\. 41/);
    // owner-only areas (accounting contracts…) are never reported
    expect(JSON.stringify(h!.out)).not.toContain('kdogovori');
    expect(await robotFreeAnswer(ctxA(), 'Зошто ми е голема добивката?')).toBeNull();
  });
  it('VAT summary compares the books with the ledger', async () => {
    const v = await runRobotTool(ctxA(), 'vat_summary', { period: '2026-Т1' });
    expect(v.ok).toBe(true);
    expect(v.data).toMatchObject({ period: '2026-Т1', due: '2026-04-25' });
    const out = await runRobotTool(ctxA(), 'vat_summary', { period: '2025-Т1' });
    expect(out.ok).toBe(false);
  });
  it('law search returns the article id', async () => {
    const r = await runRobotTool(ctxA(), 'law_search', { q: 'регистрација за ДДВ 2.000.000' });
    expect(r.summary).toContain('ЗДДВ чл. 51');
    const g = await runRobotTool(ctxA(), 'law_search', { q: 'готовинско плаќање над 1.000 €' });
    expect(g.summary).toMatch(/чл\. 58/);
  });
});

describe('proposals are drafts only', () => {
  it('a balanced journal on existing kontos becomes an open draft; nothing is posted', async () => {
    const before = (await pg.select().from(schema.journals).where(eq(schema.journals.firmId, A.id))).length;
    const r = await runRobotTool(ctxA(), 'propose_journal', { date: '2026-10-01', description: 'Наплата', lines: [{ konto: '1020', debit: 500 }, { konto: '1200', credit: 500, partner: 'Купувач Алфа' }] });
    expect(r.ok).toBe(true);
    const [p] = await pg.select().from(schema.robotProposals).where(eq(schema.robotProposals.id, r.proposalId!));
    expect(p).toMatchObject({ kind: 'journal', status: 'open', firmId: A.id, userId: user });
    expect((p!.payload as { lines: { partnerId: string }[] }).lines[1]!.partnerId).toBe(pA);
    expect((await pg.select().from(schema.journals).where(eq(schema.journals.firmId, A.id))).length).toBe(before);
  });
  it('an unbalanced journal, an unknown konto, a missing partner or another year are refused', async () => {
    const un = await runRobotTool(ctxA(), 'propose_journal', { date: '2026-10-01', lines: [{ konto: '1020', debit: 500 }, { konto: '7400', credit: 400 }] });
    expect(un.ok).toBe(false);
    expect(un.summary).toMatch(/не е изедначен/);
    const bad = await runRobotTool(ctxA(), 'propose_journal', { date: '2026-10-01', lines: [{ konto: '9999999', debit: 5 }, { konto: '7400', credit: 5 }] });
    expect(bad.summary).toMatch(/не постои во контниот план/);
    const np = await runRobotTool(ctxA(), 'propose_journal', { date: '2026-10-01', lines: [{ konto: '1200', debit: 5 }, { konto: '7400', credit: 5 }] });
    expect(np.summary).toMatch(/бара комитент/);
    const y = await runRobotTool(ctxA(), 'propose_journal', { date: '2025-10-01', lines: [{ konto: '1020', debit: 5 }, { konto: '7400', credit: 5 }] });
    expect(y.summary).toMatch(/работната година/);
    expect((await pg.select().from(schema.robotProposals).where(eq(schema.robotProposals.status, 'open'))).length).toBe(1);
  });
  it('dunning draft lists only this firm\'s overdue customers', async () => {
    await pg.insert(schema.invoices).values({ firmId: A.id, kind: 'invoice', number: '1/2026', date: '2026-03-10', due: '2026-04-10', partnerId: pA, total: '1000', base: '1000' });
    const r = await runRobotTool(ctxA(), 'propose_dunning', {});
    expect(r.ok).toBe(true);
    expect(r.summary).toContain('Купувач Алфа');
    expect(r.summary).not.toContain('Бета');
  });
  it('the thread shows only the user\'s own firm', async () => {
    const { answerId } = await robotAskRows(db, { userId: user, firmId: A.id, year: 2026, text: 'тест', deep: false });
    const T = await robotThread(db, user, A.id);
    expect(T.messages.map((m) => m.role)).toEqual(['user', 'assistant']);
    expect(T.messages[1]!.id).toBe(answerId);
    expect((await robotThread(db, user, B.id)).messages).toHaveLength(0);
  });
});
