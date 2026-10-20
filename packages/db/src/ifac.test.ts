import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { and, eq } from 'drizzle-orm';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { EL_DOS_CAT, elRenewTitle, ethicsTrainingTitle, qcStatus, QC_ACCEPT, QC_REVIEW } from '@wise/core/office/ifac';
import type { Tx } from './audit';
import { addSqmStarter, deleteLetter, ifacReadinessFor, ifacYear, letterOf, qcAuto, saveLetter, saveQc, saveSqm, saveStaff, signEthics, signLetter, sqmYear, staffOf } from './ifac';
import * as schema from './schema/index';

const db = drizzle(new PGlite(), { schema });
const tx = db as unknown as Tx;
let A = '', B = '', firm = '';
const a = (u: string) => ({ userId: u, today: '2026-10-20', office: 'WISE CONSULTING' });

beforeAll(async () => {
  await migrate(db, { migrationsFolder: fileURLToPath(new URL('../migrations', import.meta.url)) });
  const U = await db.insert(schema.users).values([
    { username: 'a', name: 'Ана', role: 'admin', passwordHash: 'x' },
    { username: 'b', name: 'Бесник', role: 'acc', passwordHash: 'x' },
    { username: 'k', name: 'Клиент', role: 'klient', passwordHash: 'x' },
  ]).returning();
  A = U[0]!.id; B = U[1]!.id;
  const [f] = await db.insert(schema.firms).values({ name: 'АЛФА ДООЕЛ', edb: '4028000000000' } as never).returning();
  firm = f!.id;
});

describe('ISRS 4410 letter in the dossier', () => {
  it('numbers per year, keeps one dossier copy, renewal reminder, signing replaces the draft', async () => {
    const r1 = await saveLetter(tx, firm, { year: 2026, svc: ['book', 'vat', 'pay', 'year'], fee: 3000 }, a(A));
    expect(r1.letter.number).toBe('ПА-001/2026');
    const r2 = await saveLetter(tx, firm, { year: 2026, svc: ['book', 'year'], fee: 3500 }, a(A));
    expect(r2.letter.number).toBe('ПА-001/2026');
    let D = await db.select().from(schema.dossierDocs).where(eq(schema.dossierDocs.firmId, firm));
    expect(D.map((d) => [d.category, d.validTo, d.title])).toEqual([[EL_DOS_CAT, '2026-12-31', 'Писмо за ангажман ПА-001/2026 за 2026 (чека потпис)']]);
    const T = await db.select().from(schema.firmDeadlines).where(eq(schema.firmDeadlines.firmId, firm));
    expect(T.map((t) => [t.title, t.due, t.remindDays, t.done])).toEqual([[elRenewTitle(2026), '2026-12-31', 30, false]]);

    const s = await signLetter(tx, firm, 2026, { at: '2026-10-25', name: 'Ана Анева' }, { userId: A, office: 'WISE CONSULTING' });
    expect(s.letter.signed).toMatchObject({ at: '2026-10-25', name: 'Ана Анева' });
    D = await db.select().from(schema.dossierDocs).where(eq(schema.dossierDocs.firmId, firm));
    expect(D).toHaveLength(1);
    expect(D[0]!.title).toBe('Писмо за ангажман ПА-001/2026 за 2026');
    await expect(saveLetter(tx, firm, { year: 2026 }, a(A))).rejects.toThrow(/Потпишаното/);
    await expect(deleteLetter(tx, firm, 2026, A)).rejects.toThrow(/не се брише/);
    expect((await letterOf(tx, firm, 2026))!.letter.fee).toBe(3500);

    // next year's letter: its own number series, the 2026 reminder done
    const n = await saveLetter(tx, firm, { year: 2027 }, a(A));
    expect(n.letter.number).toBe('ПА-001/2027');
    const T2 = await db.select().from(schema.firmDeadlines).where(eq(schema.firmDeadlines.firmId, firm));
    expect(T2.map((t) => [t.title, t.done]).sort()).toEqual([[elRenewTitle(2026), true], [elRenewTitle(2027), false]]);
    await deleteLetter(tx, firm, 2027, A);
    expect(await letterOf(tx, firm, 2027)).toBeNull();
  });
});

describe('IESBA declarations and the ISQM 1 checklist', () => {
  it('each employee signs once a year; the ISO training record follows', async () => {
    await signEthics(tx, A, 2026, { office: 'WISE CONSULTING', today: '2026-10-20' });
    await expect(signEthics(tx, A, 2026, { office: 'WISE CONSULTING', today: '2026-10-21' })).rejects.toThrow(/веќе потпишана/);
    let [t] = await db.select().from(schema.isoRecords).where(and(eq(schema.isoRecords.kind, 'training'), eq(schema.isoRecords.title, ethicsTrainingTitle(2026))));
    expect([t!.status, t!.data.who]).toEqual(['progress', 'Ана']);
    await signEthics(tx, B, 2026, { office: 'WISE CONSULTING', today: '2026-10-22' });
    const all = await db.select().from(schema.isoRecords).where(eq(schema.isoRecords.kind, 'training'));
    expect(all).toHaveLength(1);
    [t] = all;
    expect([t!.status, t!.data.who, t!.data.date]).toEqual(['done', 'Ана, Бесник', '2026-10-22']);
  });
  it('the checklist with the system facts; the reviewer is a second person', async () => {
    const X = await qcAuto(tx, firm, 2026);
    expect(X).toEqual({ aml: null, ethics: { signed: 2, total: 2 }, contract: false, letter: 'signed' });
    await expect(saveQc(tx, firm, 2026, { preparedBy: A, reviewedBy: A, reviewedOn: '2027-03-01' }, A)).rejects.toThrow(/второ лице/);
    const acc = Object.fromEntries(QC_ACCEPT.map((x) => [x.k, true])), rev = Object.fromEntries(QC_REVIEW.map((x) => [x.k, true]));
    const q = await saveQc(tx, firm, 2026, { acc, rev, risk: 'low', decision: 'continue', decidedBy: A, decidedOn: '2026-01-10', preparedBy: B, reviewedBy: A, reviewedOn: '2027-03-01' }, A);
    const s = qcStatus(q, X, '2026-10-20');
    expect(s.review.ok).toBe(true);
    // no УФР analysis and no signed contract → acceptance still open
    expect(s.accept.items.filter((x) => !x.ok).map((x) => x.k)).toEqual(['aml', 'contract']);
    const R = await ifacYear(tx, 2026);
    expect(R.map((r) => [r.kind, r.status]).sort()).toEqual([['ethics', 'signed'], ['ethics', 'signed'], ['letter', 'signed'], ['qc', 'reviewed']]);
    // every form keeps who, when and its version
    const qr = R.find((r) => r.kind === 'qc')!;
    expect([qr.data._v, qr.data._by]).toEqual([1, A]);
  });
});

describe('ISQM 1 system, staff and the readiness', () => {
  it('components: starter text once, a new version on each save, sign-off', async () => {
    expect(await addSqmStarter(tx, 2026, 'WISE CONSULTING', A)).toBe(7);
    expect(await addSqmStarter(tx, 2026, 'WISE CONSULTING', A)).toBe(0);
    await saveSqm(tx, 'gov', 2026, { ultimate: 'Ана', operational: 'Бесник', indep: 'Ана', monitorResp: 'Бесник', culture: 'Квалитетот прв', owner: A, signedBy: A, signedOn: '2026-10-20' }, A);
    const S = await sqmYear(tx, 2026);
    expect([S.size, S.get('gov')!.data._v, S.get('gov')!.status]).toEqual([7, 2, 'signed']);
    await expect(saveSqm(tx, 'gov', 2026, { signedBy: A }, A)).rejects.toThrow(/датумот/);
    // next year carries the text over, not the sign-off
    expect(await addSqmStarter(tx, 2027, 'WISE CONSULTING', A)).toBe(7);
    const S2 = await sqmYear(tx, 2027);
    expect([S2.get('gov')!.data.culture, S2.get('gov')!.data.signedOn]).toEqual(['Квалитетот прв', null]);
  });
  it('staff: assessed by another person, CPD hours; readiness reads it all', async () => {
    await expect(saveStaff(tx, B, 2026, { assessedBy: B, assessedOn: '2026-10-01' }, A)).rejects.toThrow(/друго лице/);
    await saveStaff(tx, B, 2026, { met: { 0: true, 1: true, 2: true, 3: true }, licensed: true, licence: 'ИСОС-7', cpd: [{ date: '2026-04-01', topic: 'ДДВ измени', provider: 'ИСОС', hours: 24 }], assessedBy: A, assessedOn: '2026-10-01' }, A);
    expect((await staffOf(tx, B, 2026))!.cpd[0]!.hours).toBe(24);
    const V = await ifacReadinessFor(tx, 2026, { firms: [{ id: firm, name: 'АЛФА ДООЕЛ' }], today: '2026-10-20' });
    const item = (n: RegExp) => V.sections.flatMap((s) => s.items).find((i) => n.test(i.n))!;
    expect(item(/Годишна изјава за етика/).ok).toBe(true);
    expect(item(/проценета од друго лице/)).toMatchObject({ ok: false, info: '1 / 2' });
    expect(item(/часа CPD во годината/)).toMatchObject({ ok: true, info: 'Бесник 24 ч.' });
    expect(item(/Писмо за ангажман за 2026/).ok).toBe(true);
    expect(item(/Управување и лидерство – одговорно лице/).ok).toBe(true);
    expect(V.pct).toBeGreaterThan(0);
    expect(V.pct).toBeLessThan(100);
  });
});
