/**
 * Journal import from the old program (`journal-import.ts`) on PGlite: three months of nalozi with partners by code,
 * ЕДБ and name, unmatched partners, unknown / synthetic kontos, re-import, batch delete, locked period, preview.
 */
import { PGlite } from '@electric-sql/pglite';
import { and, eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { jiGridRows, jiHeaderRow, jiNameDefault, type JiIn } from '@wise/core/journal-import';
import { impAuto } from '@wise/core/retail/import';
import * as schema from './schema/index';
import { seedReference } from './seed/reference';
import { commitJournalImport, deleteJournalImport, listJournalImports, previewJournalImport, type JiInput } from './journal-import';

const db = drizzle(new PGlite(), { schema });
type DB = typeof db;
const tx = <T>(f: (t: DB) => Promise<T>) => db.transaction((t) => f(t as unknown as DB));
const err = async (p: Promise<unknown>) => { try { await p; } catch (e) { return e as Error; } throw new Error('expected an error'); };

async function newFirm(name: string) {
  const [f] = await db.insert(schema.firms).values({ name }).returning();
  const firmId = f!.id;
  const P = await db.insert(schema.partners).values([
    { firmId, code: '1029', name: 'Алфа ДООЕЛ' },
    { firmId, code: '7', name: 'Бета ДОО', edb: '4030001234567' },
    { firmId, code: '8', name: 'Гама ДОО Скопје' },
  ]).returning();
  return { firmId, a: { firmId, userId: null }, alfa: P[0]!.id, beta: P[1]!.id, gama: P[2]!.id };
}

/** Three months: an invoice (partner by code), two statements (by ЕДБ; amount + side, by exact name), an invoice by the normalised name. */
const ROWS: JiIn[] = [
  { r: 2, date: '2026-01-10', type: '40', no: '1', k: '1200', d: 11800, pcode: '1029', doc: 'Ф-1', desc: 'Фактура 1' },
  { r: 3, date: '', type: '', no: '', k: '7400', p: 10000, desc: 'Фактура 1' },
  { r: 4, date: '', type: '', no: '', k: '2300', p: 1800, desc: 'ДДВ' },
  { r: 5, date: '2026-02-05', type: '06', no: '2', k: '1000', d: 11800, desc: 'Извод 2' },
  { r: 6, date: '2026-02-05', type: '06', no: '2', k: '1200', p: 11800, pedb: 'MK4030001234567', partner: 'Нешто друго', desc: 'Наплата' },
  { r: 7, date: '2026-02-20', type: '06', no: '3', k: '2200', amt: 5000, side: 'Д', partner: 'гама доо скопје', desc: 'Плаќање' },
  { r: 8, date: '2026-02-20', type: '06', no: '3', k: '1000', amt: 5000, side: 'П', desc: 'Плаќање' },
  { r: 9, date: '2026-03-15', type: '40', no: '3', k: '1200', d: 2360, partner: 'Гама', desc: 'Фактура 3' },
  { r: 10, date: '2026-03-15', type: '40', no: '3', k: '7400', p: 2000 },
  { r: 11, date: '2026-03-15', type: '40', no: '3', k: '2300', p: 360 },
  { r: 12, k: '', desc: 'Вкупно', d: 30960, p: 30960 },
];
const inp = (o: Partial<JiInput> = {}): JiInput => ({ file: 'stara.xlsx', hash: 'h-' + Math.random(), year: 2026, rows: ROWS, ...o });

beforeAll(async () => {
  await migrate(db, { migrationsFolder: fileURLToPath(new URL('../migrations', import.meta.url)) });
  await seedReference(db);
}, 120_000);

describe('journal import from the old program', () => {
  it('three months, partners by code / ЕДБ / name: imported exactly, the trial balance equals the file', async () => {
    const F = await newFirm('Увоз 1');
    const pv = await tx((t) => previewJournalImport(t, F.firmId, inp()));
    expect(pv.problems).toEqual([]);
    expect(pv.ok).toBe(true);
    expect(pv.nalogs).toBe(4);
    expect(pv.lines).toBe(10);
    expect(pv.D).toBe(30960);
    expect(pv.tbTotal).toEqual({ d: 30960, p: 30960 });
    expect(pv.tb.find((r) => r.k === '1200')).toMatchObject({ d: 14160, p: 11800, s: 2360 });

    const R = await tx((t) => commitJournalImport(t, F.a, inp()));
    expect(R).toMatchObject({ journals: 4, lines: 10, D: 30960, duplicates: 0, newPartners: 0 });
    const J = await db.select().from(schema.journals).where(eq(schema.journals.firmId, F.firmId));
    expect(J.map((j) => j.number).sort()).toEqual(['06/2', '06/3', '40/1', '40/3']);
    expect(J.every((j) => j.sourceType === 'import' && j.sourceId!.startsWith(R.batch + ':'))).toBe(true);
    expect((J.find((j) => j.number === '40/1')!.meta as { imp: { rows: number[]; file: string } }).imp).toMatchObject({ rows: [2, 3, 4], file: 'stara.xlsx' });
    const L = await db.select({ k: schema.journalLines.account, d: schema.journalLines.debit, p: schema.journalLines.credit, pid: schema.journalLines.partnerId, note: schema.journalLines.note })
      .from(schema.journalLines).where(eq(schema.journalLines.firmId, F.firmId));
    const tot = L.reduce((s, l) => [s[0]! + Number(l.d), s[1]! + Number(l.p)], [0, 0]);
    expect(tot).toEqual([30960, 30960]);
    const p1200 = L.filter((l) => l.k === '1200').map((l) => [Number(l.d) || -Number(l.p), l.pid]);
    expect(p1200).toEqual(expect.arrayContaining([[11800, F.alfa], [-11800, F.beta], [2360, F.gama]]));
    expect(L.find((l) => l.k === '2200')!.pid).toBe(F.gama);
    // the trial balance of the books = the file's totals per konto
    const tb = await db.select({ k: schema.journalLines.account, d: sql<string>`sum(debit)`, p: sql<string>`sum(credit)` }).from(schema.journalLines)
      .where(eq(schema.journalLines.firmId, F.firmId)).groupBy(schema.journalLines.account);
    const T = Object.fromEntries(tb.map((r) => [r.k, [Number(r.d), Number(r.p)]]));
    expect(T).toEqual({ '1000': [11800, 5000], '1200': [14160, 11800], '2200': [5000, 0], '2300': [0, 2160], '7400': [0, 12000] });
    const B = await tx((t) => listJournalImports(t, F.firmId, 2026));
    expect(B).toHaveLength(1);
    expect(B[0]).toMatchObject({ batch: R.batch, file: 'stara.xlsx', journals: 4, lines: 10, D: 30960, from: '2026-01-10', to: '2026-03-15', locked: false });
    const au = await db.select().from(schema.auditLog).where(and(eq(schema.auditLog.firmId, F.firmId), eq(schema.auditLog.action, 'impJournalBatch')));
    expect(au).toHaveLength(1);
  });

  it('an unmatched partner on 1200 is listed, never imported silently; „create the missing partners“ creates it from the file', async () => {
    const F = await newFirm('Увоз 2');
    const rows: JiIn[] = [
      { r: 2, date: '2026-04-01', type: '40', no: '9', k: '1200', d: 1180, pcode: '555', pedb: '4030009999999', partner: 'Нов Купувач ДООЕЛ' },
      { r: 3, date: '2026-04-01', type: '40', no: '9', k: '7400', p: 1180 },
    ];
    const pv = await tx((t) => previewJournalImport(t, F.firmId, inp({ rows })));
    expect(pv.ok).toBe(false);
    expect(pv.missingPartners).toEqual([expect.objectContaining({ name: 'Нов Купувач ДООЕЛ', code: '555', edb: '4030009999999', rows: [2], kontos: ['1200'] })]);
    expect(pv.problems.map((p) => p.kind)).toEqual(['partner']);
    expect((await err(tx((t) => commitJournalImport(t, F.a, inp({ rows }))))).message).toMatch(/Нов Купувач ДООЕЛ.*не е најден/);
    expect(await db.select().from(schema.journals).where(eq(schema.journals.firmId, F.firmId))).toHaveLength(0);

    const pv2 = await tx((t) => previewJournalImport(t, F.firmId, inp({ rows, createPartners: true })));
    expect(pv2.ok).toBe(true);
    const R = await tx((t) => commitJournalImport(t, F.a, inp({ rows, createPartners: true })));
    expect(R).toMatchObject({ journals: 1, newPartners: 1 });
    const [p] = await db.select().from(schema.partners).where(and(eq(schema.partners.firmId, F.firmId), eq(schema.partners.code, '555')));
    expect(p).toMatchObject({ name: 'Нов Купувач ДООЕЛ', edb: '4030009999999' });
    const [l] = await db.select().from(schema.journalLines).where(and(eq(schema.journalLines.firmId, F.firmId), eq(schema.journalLines.account, '1200')));
    expect(l!.partnerId).toBe(p!.id);

    // a partner konto without any partner in the file is a problem too
    const pv3 = await tx((t) => previewJournalImport(t, F.firmId, inp({ rows: [{ r: 2, date: '2026-04-02', no: '10', k: '2200', p: 50 }, { r: 3, date: '2026-04-02', no: '10', k: '1000', d: 50 }], createPartners: true })));
    expect(pv3.ok).toBe(false);
    expect(pv3.problems.map((p) => p.kind)).toEqual(['nopartner']);
  });

  it('an unknown konto and a synthetic konto are refused', async () => {
    const F = await newFirm('Увоз 3');
    const rows: JiIn[] = [
      { r: 2, date: '2026-05-01', no: '1', k: '1999999', d: 100 },
      { r: 3, date: '2026-05-01', no: '1', k: '100', p: 100 },
      { r: 4, date: '2026-05-01', no: '1', k: '', d: 5 },
    ];
    const pv = await tx((t) => previewJournalImport(t, F.firmId, inp({ rows })));
    expect(pv.ok).toBe(false);
    expect(pv.problems.map((p) => p.kind).sort()).toEqual(['konto', 'row', 'synthetic']);
    expect(pv.problems.find((p) => p.kind === 'konto')!.msg).toMatch(/1999999 не постои/);
    expect((await err(tx((t) => commitJournalImport(t, F.a, inp({ rows }))))).message).toMatch(/1999999/);
    expect(await db.select().from(schema.journals).where(eq(schema.journals.firmId, F.firmId))).toHaveLength(0);
  });

  it('a re-import adds nothing (same nalozi, same file)', async () => {
    const F = await newFirm('Увоз 4');
    await tx((t) => commitJournalImport(t, F.a, inp({ hash: 'abc' })));
    const pv = await tx((t) => previewJournalImport(t, F.firmId, inp({ hash: 'abc' })));
    expect(pv.sameFile).toMatchObject({ file: 'stara.xlsx' });
    expect(pv.duplicates).toHaveLength(4);
    expect(pv.tbTotal).toEqual({ d: 30960, p: 30960 }); // nothing counted twice
    const R = await tx((t) => commitJournalImport(t, F.a, inp({ hash: 'abc' })));
    expect(R).toMatchObject({ journals: 0, duplicates: 4 });
    // another file with the same nalozi: still nothing
    expect(await tx((t) => commitJournalImport(t, F.a, inp({ hash: 'other', file: 'kopija.xlsx' })))).toMatchObject({ journals: 0, duplicates: 4 });
    expect(await db.select().from(schema.journals).where(eq(schema.journals.firmId, F.firmId))).toHaveLength(4);
  });

  it('the batch delete removes exactly that batch', async () => {
    const F = await newFirm('Увоз 5');
    const b1 = await tx((t) => commitJournalImport(t, F.a, inp({ rows: ROWS.slice(0, 3) })));
    const b2 = await tx((t) => commitJournalImport(t, F.a, inp({ rows: ROWS.slice(3) })));
    expect(b1.journals).toBe(1);
    expect(b2.journals).toBe(3);
    await db.insert(schema.journals).values({ firmId: F.firmId, date: '2026-06-01', kind: 'manual', number: '1021' });
    expect(await tx((t) => deleteJournalImport(t, F.a, b2.batch))).toBe(3);
    const J = await db.select().from(schema.journals).where(eq(schema.journals.firmId, F.firmId));
    expect(J.map((j) => j.number).sort()).toEqual(['1021', '40/1']);
    expect(await tx((t) => listJournalImports(t, F.firmId, 2026))).toEqual([expect.objectContaining({ batch: b1.batch, journals: 1 })]);
    expect((await err(tx((t) => deleteJournalImport(t, F.a, b2.batch)))).message).toMatch(/не постои/);
    // a batch in a locked period cannot be removed
    await db.update(schema.firms).set({ lockDate: '2026-01-31' }).where(eq(schema.firms.id, F.firmId));
    expect((await err(tx((t) => deleteJournalImport(t, F.a, b1.batch)))).message).toMatch(/заклучен/);
    expect(await db.select().from(schema.journals).where(eq(schema.journals.firmId, F.firmId))).toHaveLength(2);
  });

  it('a locked period and dates outside the working year are refused', async () => {
    const F = await newFirm('Увоз 6');
    await db.update(schema.firms).set({ lockDate: '2026-01-31' }).where(eq(schema.firms.id, F.firmId));
    const pv = await tx((t) => previewJournalImport(t, F.firmId, inp()));
    expect(pv.ok).toBe(false);
    expect(pv.problems.map((p) => p.kind)).toEqual(['period']);
    expect(pv.problems[0]!.rows).toEqual([2, 3, 4]);
    expect((await err(tx((t) => commitJournalImport(t, F.a, inp())))).message).toMatch(/заклучен/);
    expect(await db.select().from(schema.journals).where(eq(schema.journals.firmId, F.firmId))).toHaveLength(0);
    const pv2 = await tx((t) => previewJournalImport(t, F.firmId, inp({ year: 2027 })));
    expect(pv2.problems.map((p) => p.kind)).toContain('year');
  });

  it('the preview totals per month', async () => {
    const F = await newFirm('Увоз 7');
    const pv = await tx((t) => previewJournalImport(t, F.firmId, inp()));
    expect(pv.months).toEqual([
      { m: '2026-01', nalogs: 1, journals: 1, lines: 3, D: 11800, P: 11800, problems: 0 },
      { m: '2026-02', nalogs: 2, journals: 2, lines: 4, D: 16800, P: 16800, problems: 0 },
      { m: '2026-03', nalogs: 1, journals: 1, lines: 3, D: 2360, P: 2360, problems: 0 },
    ]);
    expect(pv.skipped).toBe(1); // the „Вкупно“ row
    // a nalog number WISE already uses gets „У“; a bare number too
    await db.insert(schema.journals).values({ firmId: F.firmId, date: '2026-02-01', kind: 'manual', number: '06/2' });
    const pv2 = await tx((t) => previewJournalImport(t, F.firmId, inp({ rows: [...ROWS.slice(3, 5), { r: 20, date: '2026-04-01', no: '5', k: '1000', d: 1 }, { r: 21, date: '2026-04-01', no: '5', k: '9000', p: 1 }] })));
    expect(pv2.list.map((j) => j.number)).toEqual(['У06/2', '5']);
    // unbalanced nalog
    const pv3 = await tx((t) => previewJournalImport(t, F.firmId, inp({ rows: [{ r: 2, date: '2026-04-01', no: '5', k: '1000', d: 2 }, { r: 3, date: '2026-04-01', no: '5', k: '9000', p: 1 }] })));
    expect(pv3.problems.map((p) => p.kind)).toEqual(['unbalanced']);
  });
});

/** The sheet as the screen reads it: header row, columns by heading, numbers / dates parsed (`jiGridRows`). */
const fromGrid = (g: unknown[][]) => { const hi = jiHeaderRow(g); return jiGridRows(g, hi, impAuto('journal', g[hi]!)).rows; };

describe('the old program\'s exports (synthetic fixtures with the real layouts)', () => {
  // „Дневник“: Датум | Налог | Извор | Документ | Конто | Назив | Партнер | Должи | Побарува — the 01.01 opening balance
  const DNEVNIK: unknown[][] = [
    ['Датум', 'Налог', 'Извор', 'Документ', 'Конто', 'Назив', 'Партнер', 'Должи', 'Побарува'],
    ['2026-01-01', '0', 'ПОЧЕТНА СОСТОЈБА', 'Почетна состојба 2026', '100001', 'Жиро сметка', '', 50000, 0],
    ['2026-01-01', '0', 'ПОЧЕТНА СОСТОЈБА', 'Почетна состојба 2026', '1200', 'Купувачи', 'Алфа ДООЕЛ', 30000, 0],
    ['2026-01-01', '0', 'ПОЧЕТНА СОСТОЈБА', 'Почетна состојба 2026', '1200', 'Купувачи', 'Нов Купувач ДОО', 20000, 0],
    ['2026-01-01', '0', 'ПОЧЕТНА СОСТОЈБА', 'Почетна состојба 2026', '2200', 'Добавувачи', '', 0, 10000],
    ['2026-01-01', '0', 'ПОЧЕТНА СОСТОЈБА', 'Почетна состојба 2026', '900', 'Основна главнина', '', 0, 90000],
  ];

  it('„Дневник“ layout: recognised; the 01.01 opening goes to „Почетна состојба“ (nalog 0), or is skipped when it exists', async () => {
    const F = await newFirm('Дневник 1');
    const rows = fromGrid(DNEVNIK);
    expect(rows[0]).toMatchObject({ date: '2026-01-01', no: '0', type: 'ПОЧЕТНА СОСТОЈБА', doc: 'Почетна состојба 2026', k: '100001', kname: 'Жиро сметка', partner: '', d: 50000 });
    const pv = await tx((t) => previewJournalImport(t, F.firmId, inp({ rows })));
    expect(pv.opening).toEqual({ rows: 5, D: 100000, P: 100000, exists: false, skip: false });
    // partner by name only: „Алфа ДООЕЛ“ found, „Нов Купувач ДОО“ listed; 2200 without a partner is allowed on the opening
    expect(pv.missingPartners.map((m) => m.name)).toEqual(['Нов Купувач ДОО']);
    expect(pv.problems.map((p) => p.kind).sort()).toEqual(['partner', 'synthetic']); // 900: listed, not blocking
    expect(pv.ok).toBe(false);
    const R = await tx((t) => commitJournalImport(t, F.a, inp({ rows, createPartners: true })));
    expect(R).toMatchObject({ journals: 1, lines: 5, newPartners: 1, opening: 'posted' });
    const J = await db.select().from(schema.journals).where(eq(schema.journals.firmId, F.firmId));
    expect(J.map((j) => [j.kind, j.number, j.sourceType, j.sourceId])).toEqual([['open', '0', 'opening', 'open-2026']]);
    // again: the opening exists → skipped with the message, nothing added
    const pv2 = await tx((t) => previewJournalImport(t, F.firmId, inp({ rows })));
    expect(pv2.opening).toMatchObject({ exists: true, skip: true });
    expect(pv2.warnings[0]).toMatch(/^Почетната состојба веќе постои – прескокнато \(за промена користете Почетна состојба\)/);
    expect(pv2.ok).toBe(true);
    expect(await tx((t) => commitJournalImport(t, F.a, inp({ rows })))).toMatchObject({ journals: 0, opening: 'exists' });
    expect(await db.select().from(schema.journals).where(eq(schema.journals.firmId, F.firmId))).toHaveLength(1);
  });

  // „NALOG1“: * | Р.бр. | Датум | Содржина | Конто | Должи | Побарува | Документ | Дев.должи | Дев.побарува | О.ед. | Ком.ш. |
  // Комитент | Прекн/Непрекн. | Поч. сос. | … | Курс — Excel serial dates, Latin YUSCII names, no nalog column (one nalog)
  const H1 = ['*', 'Р.бр.', 'Датум', 'Содржина', 'Конто', 'Должи', 'Побарува', 'Документ', 'Дев.должи', 'Дев.побарува', 'О.ед.', 'Ком.ш.', 'Комитент', 'Прекн/Непрекн.', 'Поч. сос.', 'Одобрен Документ', 'Странска валута (шифра)', 'Странска валута (назив)', 'Курс'];
  const ln = (n: number, date: number, doc: string, k: string, d: number, p: number, code = '', name = '') => ['', n, date, doc, k, d, p, '', 0, 0, '', code, name, 0, 'NE', '', '', '', 0];
  const NALOG1: unknown[][] = [
    H1,
    // VAT rounded to whole denars by the old program: WISE computes 11853.36 → not reproducible as an invoice
    ln(1, 46027, 'F-05012026/00546', '1200', 77705, 0, '0184', 'GULERMAK AGIR SANAJI IN[AAT VE TAAHHUT A'),
    ln(2, 46027, 'F-05012026/00546', '230018', 0, 11853), ln(3, 46027, 'F-05012026/00546', '7414', 0, 65852),
    ln(4, 46028, 'F-06012026/00547', '1200', 2360, 0, '0326', 'STORIBOKS TOJS AND BOOKS DOOEL'),
    ln(5, 46028, 'F-06012026/00547', '230018', 0, 360), ln(6, 46028, 'F-06012026/00547', '7414', 0, 2000),
    ln(7, 46112, 'F-31032026/00657', '1200', 11800, 0, '0999', 'KAN INTERNATIONAL DOOEL'),
    ln(8, 46112, 'F-31032026/00657', '230018', 0, 1800), ln(9, 46112, 'F-31032026/00657', '7423', 0, 10000),
    ['', '', '', '', '', 91865, 91865, '', 0, 0, '', '', '', '', '', '', '', '', ''],
  ];
  const nalog = jiNameDefault('1-1-3.xlsx');
  const setup = async (name: string) => {
    const F = await newFirm(name);
    const P = await db.insert(schema.partners).values([
      { firmId: F.firmId, code: '0184', name: 'Гулермак' }, // by code
      { firmId: F.firmId, code: '55', name: 'СТОРИБОКС ТОЈС АНД БООКС ДООЕЛ' }, // Latin ↔ Cyrillic
      { firmId: F.firmId, code: '56', name: 'КАН ИНТЕРНАТИОНАЛ ДООЕЛ' },
    ]).returning();
    return { ...F, P: P.map((p) => p.id) };
  };

  it('„NALOG1“ layout as a journal: serial dates, YUSCII, code / transliterated names, the document on every line, nalog from the file name', async () => {
    expect(nalog).toEqual({ type: '1', no: '1-3' });
    const rows = fromGrid(NALOG1);
    expect(rows[0]).toMatchObject({ r: 2, date: '2026-01-05', desc: 'F-05012026/00546', k: '1200', d: 77705, pcode: '0184', ob: 'NE' });
    const F = await setup('NALOG1 a');
    const pv = await tx((t) => previewJournalImport(t, F.firmId, inp({ rows, nalog })));
    expect(pv.problems).toEqual([]);
    expect(pv.skipped).toBe(1); // the totals row
    expect(pv.matchedBy).toEqual({ code: 1, edb: 0, name: 0, norm: 0, translit: 2 });
    expect(pv.nalogs).toBe(1);
    expect(pv.list.map((j) => [j.number, j.date])).toEqual([['1/1-3', '2026-01-05'], ['1/1-3', '2026-01-06'], ['1/1-3', '2026-03-31']]);
    expect(pv.D).toBe(91865);
    const R = await tx((t) => commitJournalImport(t, F.a, inp({ rows, nalog })));
    expect(R).toMatchObject({ journals: 3, lines: 9, D: 91865 });
    const L = await db.select({ k: schema.journalLines.account, doc: schema.journalLines.doc, pid: schema.journalLines.partnerId })
      .from(schema.journalLines).where(eq(schema.journalLines.firmId, F.firmId));
    expect(L.filter((l) => l.k === '1200').map((l) => l.pid).sort()).toEqual([...F.P].sort());
    expect(L.every((l) => /^F-\d{8}\/\d{5}$/.test(l.doc ?? ''))).toBe(true);
    expect(await tx((t) => commitJournalImport(t, F.a, inp({ rows, nalog })))).toMatchObject({ journals: 0, duplicates: 3 });
  });

  it('„NALOG1“ layout as outgoing invoices: clean groups become invoices with the same lines; a group WISE cannot reproduce stays journal lines', async () => {
    const rows = fromGrid(NALOG1);
    const F = await setup('NALOG1 b');
    const pv = await tx((t) => previewJournalImport(t, F.firmId, inp({ rows, nalog, mode: 'invoices' })));
    expect(pv.ok).toBe(true);
    expect(pv.invoices).toMatchObject({ n: 2, total: 14160, dups: [] });
    expect(pv.invoices!.refused).toEqual([expect.objectContaining({ no: 'F-05012026/00546', rows: [2, 3, 4] })]);
    expect(pv.invoices!.refused[0]!.why).toMatch(/11853\.36/);
    const R = await tx((t) => commitJournalImport(t, F.a, inp({ rows, nalog, mode: 'invoices' })));
    expect(R).toMatchObject({ invoices: 2, invoicesRefused: [], journals: 3, lines: 9, D: 91865, statLines: 4 });
    const I = await db.select().from(schema.invoices).where(eq(schema.invoices.firmId, F.firmId));
    expect(I.map((i) => [i.number, i.date, i.total, i.partnerId]).sort()).toEqual([
      ['F-06012026/00547', '2026-01-06', '2360.00', F.P[1]], ['F-31032026/00657', '2026-03-31', '11800.00', F.P[2]],
    ]);
    // the books are the file's: per konto the same totals as the journal mode
    const tb = await db.select({ k: schema.journalLines.account, d: sql<string>`sum(debit)`, p: sql<string>`sum(credit)` }).from(schema.journalLines)
      .where(eq(schema.journalLines.firmId, F.firmId)).groupBy(schema.journalLines.account);
    // (plus WISE's statistical VAT base of the two invoices, 994018 = 999018)
    expect(Object.fromEntries(tb.map((r) => [r.k, [Number(r.d), Number(r.p)]]))).toEqual({
      '1200': [91865, 0], '230018': [0, 14013], '7414': [0, 67852], '7423': [0, 10000], '994018': [12000, 0], '999018': [0, 12000],
    });
    // again: the invoices exist, the journal of the refused one too → nothing added
    expect(await tx((t) => commitJournalImport(t, F.a, inp({ rows, nalog, mode: 'invoices' })))).toMatchObject({ journals: 0, invoices: 0 });
    expect(await db.select().from(schema.invoices).where(eq(schema.invoices.firmId, F.firmId))).toHaveLength(2);
  });
});
