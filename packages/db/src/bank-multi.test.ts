/**
 * A PDF with several daily statements (synthetic Комерцијална export, `@wise/core/noai/bank-multi.fixtures`) read
 * without AI → import on PGlite: one statement per day with the BANK's number (161 / 162 / 163 — never 1, 2 and a
 * range „161-163“), the same file again is skipped as duplicates, and a wrong number of an imported statement is
 * corrected on the statement header: the journal description, the line notes / documents and „Изв. бр.“ follow.
 */
import { PGlite } from '@electric-sql/pglite';
import { and, asc, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { statementsFromRead } from '@wise/core/ai/bank';
import { statementFromPdfItems } from '@wise/core/noai/bank';
import { MULTI_ACCOUNT, multiStatementItems } from '@wise/core/noai/bank-multi.fixtures';
import { planImport, saveBankAccount, saveImport, updateStatement } from './bank/index';
import * as schema from './schema/index';
import { seedReference } from './seed/reference';

const db = drizzle(new PGlite(), { schema });
const T = <R>(f: (tx: typeof db) => Promise<R>) => db.transaction((tx) => f(tx as unknown as typeof db));
const statements = (firmId: string) => db.select().from(schema.bankStatements).where(eq(schema.bankStatements.firmId, firmId)).orderBy(asc(schema.bankStatements.date));
const journalOf = async (stId: string) => {
  const [j] = await db.select().from(schema.journals).where(and(eq(schema.journals.sourceType, 'bank_statement'), eq(schema.journals.sourceId, stId)));
  if (!j) return null;
  const L = await db.select().from(schema.journalLines).where(eq(schema.journalLines.journalId, j.id)).orderBy(asc(schema.journalLines.lineNo));
  return { ...j, lines: L };
};

beforeAll(async () => {
  await migrate(db, { migrationsFolder: fileURLToPath(new URL('../migrations', import.meta.url)) });
  await seedReference(db);
}, 60_000);

describe('one PDF, three daily statements', () => {
  let firmId = '';
  // the read as the worker stores it (JSON) and the import maps it
  const read = () => statementsFromRead(JSON.parse(JSON.stringify(statementFromPdfItems(multiStatementItems()))));
  beforeAll(async () => {
    firmId = (await db.insert(schema.firms).values({ name: 'ПРИМЕР КЛИЕНТ ДООЕЛ Скопје', edb: '4000000000000' }).returning())[0]!.id;
    await T((tx) => saveBankAccount(tx, { firmId, userId: null, input: { name: 'Комерцијална', account: MULTI_ACCOUNT, cur: 'MKD', konto: '' } }));
  });

  it('preview: three days with the bank numbers and balances', async () => {
    const plan = await T((tx) => planImport(tx, { firmId, userId: null, statements: read() }));
    expect(plan.errors).toEqual([]);
    expect(plan.days.map((d) => [d.date, d.no, d.opening, d.closing, d.lines.length])).toEqual([
      ['2026-10-07', '161', 500000, 950000, 2], ['2026-10-09', '162', 950000, 750000, 1], ['2026-10-10', '163', 750000, 744000, 1],
    ]);
    expect(plan.days[0]!.lines[0]).toMatchObject({ osnov: '220', counterAccount: '300000009990001', bref: '0105/2026 / 0105/2026' });
  });

  it('import: 3 statements numbered 161 / 162 / 163, posted with their numbers', async () => {
    const x = await T((tx) => saveImport(tx, { firmId, userId: null, statements: read(), format: 'ai', fileName: 'Izvodi.pdf' }));
    expect(x).toMatchObject({ statements: 3, lines: 4, skipped: 0 });
    const S = await statements(firmId);
    expect(S.map((s) => [s.date, s.number, Number(s.opening), Number(s.closing)])).toEqual([
      ['2026-10-07', '161', 5000, 9500], ['2026-10-09', '162', 9500, 7500], ['2026-10-10', '163', 7500, 7440],
    ]);
    for (const s of S) {
      const j = await journalOf(s.id);
      if (!j) continue; // a statement whose lines still need a konto has no journal yet
      expect(j.description).toContain(`Извод бр. ${s.number} од`);
      expect((j.meta as { statementNo?: string }).statementNo).toBe(s.number);
    }
  });

  it('the same file again: duplicates skipped with a message, numbers unchanged', async () => {
    const plan = await T((tx) => planImport(tx, { firmId, userId: null, statements: read() }));
    expect(plan.days.every((d) => d.allDup)).toBe(true);
    expect(plan.warnings).toEqual(expect.arrayContaining([expect.stringMatching(/Изводот бр\. 161 од 2026-10-07 .* веќе е увезен/), expect.stringMatching(/Изводот бр\. 163 од 2026-10-10/)]));
    const x = await T((tx) => saveImport(tx, { firmId, userId: null, statements: read(), format: 'ai' }));
    expect(x).toMatchObject({ statements: 0, lines: 0, skipped: 4 });
    expect((await statements(firmId)).map((s) => s.number)).toEqual(['161', '162', '163']);
  });

  it('a wrong number (1 / 2 / „161-163“ from an earlier import) is corrected on the statement: journal re-posted', async () => {
    const S = await statements(firmId);
    const withJ = [];
    for (const s of S) if (await journalOf(s.id)) withJ.push(s);
    expect(withJ.length).toBeGreaterThan(0);
    const s = withJ[0]!;
    // the state an earlier import left („161-163“): the import of the file names the bank's number
    await T((tx) => updateStatement(tx, { firmId, userId: null, statementId: s.id, number: '161-163' }));
    expect((await journalOf(s.id))!.description).toContain('Извод бр. 161-163 од');
    const plan = await T((tx) => planImport(tx, { firmId, userId: null, statements: read() }));
    expect(plan.warnings.join(' ')).toContain(`е веќе внесен со број 161-163, а банката го води како бр. ${s.number}`);
    await T((tx) => updateStatement(tx, { firmId, userId: null, statementId: s.id, number: s.number }));
    const j = (await journalOf(s.id))!;
    expect(j.description).toContain(`Извод бр. ${s.number} од`);
    expect((j.meta as { statementNo?: string }).statementNo).toBe(s.number);
    const head = j.lines.filter((l) => /^Извод бр\./.test(l.note ?? ''));
    expect(head.length).toBeGreaterThan(0);
    for (const l of head) { expect(l.note).toContain(`Извод бр. ${s.number} од`); expect(l.doc).toBe(s.number); }
  });
});
