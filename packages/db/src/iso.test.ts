import { PGlite } from '@electric-sql/pglite';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { bcpStatus, isoNo, isoReview, type IsoKind, type IsoRow, type IsoStatus } from '@wise/core/office/iso';
import type { Tx } from './audit';
import { addIsoStarterDocs, addIsoStarters, confirmSoaAll, isoClientCounts, isoEvidence, isoGdprLinks, loadSoa, saveIsoRecord, saveIsoStaff, saveSoa, setIsoStatus, signIsoRecord } from './iso';
import * as schema from './schema/index';

const db = drizzle(new PGlite(), { schema });
let uid = '';
beforeAll(async () => {
  await migrate(db, { migrationsFolder: fileURLToPath(new URL('../migrations', import.meta.url)) });
  const [u] = await db.insert(schema.users).values({ username: 'iso', name: 'Управител', role: 'admin', passwordHash: 'x' }).returning();
  uid = u!.id;
});
const tx = db as unknown as Tx;

describe('ISO registers', () => {
  it('numbers per register and year, keeps only the register fields, closes and reviews', async () => {
    const a = await saveIsoRecord(tx, { kind: 'complaint', title: 'Задоцнета пријава', data: { from: 'Клиент', satisfied: 'да', action: 'Одговорено', junk: 'x' } }, uid, '2026-03-01');
    const b = await saveIsoRecord(tx, { kind: 'complaint', title: 'Грешка во фактура', data: {} }, uid, '2026-03-05');
    await saveIsoRecord(tx, { kind: 'risk', title: 'Губење податоци', data: { p: '2', i: '5' } }, uid, '2026-03-05');
    const R0 = await db.select().from(schema.isoRecords);
    const ca = R0.find((r) => r.id === a)!, cb = R0.find((r) => r.id === b)!;
    expect([isoNo('complaint', ca.no, ca.year), isoNo('complaint', cb.no, cb.year)]).toEqual(['ПП-1/26', 'ПП-2/26']);
    expect(ca.data).toEqual({ from: 'Клиент', satisfied: 'да', action: 'Одговорено' });
    await setIsoStatus(tx, a, 'done', uid);
    const R = (await db.select().from(schema.isoRecords)).map((r): IsoRow => ({ id: r.id, kind: r.kind as IsoKind, no: r.no, year: r.year, title: r.title, status: r.status as IsoStatus, due: r.due, created: r.createdAt.toISOString(), closed: r.closedAt?.toISOString() ?? null, data: r.data }));
    const V = isoReview(R, 2026);
    expect(V.complaints).toMatchObject({ n: 2, closed: 1, satisfied: 100 });
    expect(V.risks.list[0]!.sc).toEqual({ s: 10, cls: 'mid' });
  });
  it('starting documents once, the system evidence', async () => {
    expect(await addIsoStarterDocs(tx, 'WISE CONSULTING', uid, '2026-03-01')).toBe(24);
    expect(await addIsoStarterDocs(tx, 'WISE CONSULTING', uid, '2026-03-01')).toBe(0);
    const ev = await isoEvidence(tx, new Date('2026-01-01'));
    expect(ev.users.length).toBe(1);
    expect(ev.changes).toBeGreaterThan(5);
  });
  it('ISO 27701: processing activities once, a request due in a month, a breach due in 72 h, the ЗЗЛП register linked', async () => {
    expect(await addIsoStarters(tx, 'processing', 'WISE', uid, '2026-03-01')).toBe(5);
    expect(await addIsoStarters(tx, 'processing', 'WISE', uid, '2026-03-01')).toBe(0);
    const d = await saveIsoRecord(tx, { kind: 'dsr', title: 'Пристап – вработен', data: { type: 'пристап до податоците', received: '2026-03-10' } }, uid, '2026-03-11');
    const i = await saveIsoRecord(tx, { kind: 'incident', title: 'Погрешно испратена платна листа', data: { personal: 'да', found: '2026-03-11T15:30' } }, uid, '2026-03-11');
    const own = await saveIsoRecord(tx, { kind: 'dsr', title: 'Со рок', due: '2026-03-20', data: {} }, uid, '2026-03-11');
    const R = await db.select().from(schema.isoRecords);
    expect(R.find((r) => r.id === d)!.due).toBe('2026-04-10');
    expect(R.find((r) => r.id === i)!.due).toBe('2026-03-14');
    expect(R.find((r) => r.id === own)!.due).toBe('2026-03-20');
    const [f] = await db.insert(schema.firms).values({ name: 'Клиент ДООЕЛ', edb: '4030000000001' } as typeof schema.firms.$inferInsert).returning();
    await db.insert(schema.gdprRecords).values([
      { kind: 'dpa', firmId: f!.id, subject: 'Договор', date: '2026-01-05', status: 'signed' },
      { kind: 'activity', firmId: f!.id, subject: 'Плати', date: '2026-01-05', status: 'signed' },
      { kind: 'request', firmId: f!.id, subject: 'Бришење', date: '2026-02-01', due: '2026-03-03', status: 'open' },
    ]);
    expect(await isoGdprLinks(tx, 2026, '2026-03-11')).toMatchObject({ dpa: 1, activities: 1, activityFirms: 1, requests: { n: 1, open: 1, late: 1 }, breaches: { n: 0 } });
  });
  it('ISO 22301: the starting scenarios keep RTO / RPO, a restore test refers to its scenario', async () => {
    expect(await addIsoStarters(tx, 'bcp', 'WISE', uid, '2026-03-01')).toBe(6);
    const [p] = await db.select().from(schema.isoRecords).where(eq(schema.isoRecords.title, 'Серверот / програмата не работи'));
    expect(p!.data).toMatchObject({ rto: 4, rpo: 24, every: 6 });
    const t = await saveIsoRecord(tx, { kind: 'bctest', title: 'Враќање на копија од 01.03', data: { plan: p!.id, type: 'тест на враќање од резервна копија', date: '2026-03-02', took: '2', lost: '20', result: 'успешно' } }, uid, '2026-03-02');
    const R = (await db.select().from(schema.isoRecords)).map((r): IsoRow => ({ id: r.id, kind: r.kind as IsoKind, no: r.no, year: r.year, title: r.title, status: r.status as IsoStatus, due: r.due, created: r.createdAt.toISOString(), closed: r.closedAt?.toISOString() ?? null, data: r.data }));
    expect(isoNo('bctest', R.find((r) => r.id === t)!.no, 2026)).toBe('ТВ-1/26');
    const b = bcpStatus(R, '2026-03-05').find((x) => x.r.id === p!.id)!;
    expect(b).toMatchObject({ lastTest: '2026-03-02', next: '2026-09-02', rtoMet: true, rpoMet: true, state: 'ok' });
  });
  it('certifier rules: a corrective action closes only when effective; sign-off drops on change; a document keeps its versions', async () => {
    const n = await saveIsoRecord(tx, { kind: 'nc', title: 'Пропуштен рок ДДВ', ownerId: uid, data: { correction: 'Поднесено', cause: 'Отсуство', corrective: 'Замена по клиент' } }, uid, '2026-04-01');
    await expect(setIsoStatus(tx, n, 'done', uid)).rejects.toThrow(/датум на проверка/);
    await saveIsoRecord(tx, { id: n, kind: 'nc', title: 'Пропуштен рок ДДВ', ownerId: uid, data: { correction: 'Поднесено', cause: 'Отсуство', corrective: 'Замена по клиент', verifiedOn: '2026-05-01', effective: 'не – нова мерка' } }, uid, '2026-05-01');
    await expect(setIsoStatus(tx, n, 'done', uid)).rejects.toThrow(/ефективна/);
    const ok = { correction: 'Поднесено', cause: 'Отсуство', corrective: 'Замена по клиент', verifiedOn: '2026-05-01', effective: 'да' };
    await saveIsoRecord(tx, { id: n, kind: 'nc', title: 'Пропуштен рок ДДВ', ownerId: uid, data: ok }, uid, '2026-05-01');
    await setIsoStatus(tx, n, 'done', uid);
    await signIsoRecord(tx, n, { id: uid, name: 'Управител', admin: true });
    const get = async (id: string) => (await db.select().from(schema.isoRecords).where(eq(schema.isoRecords.id, id)))[0]!;
    expect((await get(n)).data._sign).toMatchObject({ by: uid, name: 'Управител' });
    // saving the same content keeps the sign-off, a change drops it
    await saveIsoRecord(tx, { id: n, kind: 'nc', title: 'Пропуштен рок ДДВ', ownerId: uid, status: 'done', data: ok }, uid, '2026-05-02');
    expect((await get(n)).data._sign).toBeTruthy();
    await saveIsoRecord(tx, { id: n, kind: 'nc', title: 'Пропуштен рок ДДВ', ownerId: uid, status: 'done', data: { ...ok, corrective: 'Замена + потсетник' } }, uid, '2026-05-02');
    expect((await get(n)).data._sign).toBeUndefined();
    // a document cannot be in force without approval; versions are recorded
    await expect(saveIsoRecord(tx, { kind: 'policy', title: 'Тест политика', status: 'done', data: { docNo: 'ПЛ-99', version: '1.0' } }, uid, '2026-05-03')).rejects.toThrow(/одобрил/);
    const d = await saveIsoRecord(tx, { kind: 'policy', title: 'Тест политика', data: { docNo: 'ПЛ-99', version: '1.0' } }, uid, '2026-05-03');
    await saveIsoRecord(tx, { id: d, kind: 'policy', title: 'Тест политика', status: 'done', data: { docNo: 'ПЛ-99', version: '1.1', changeNote: 'нов рок', approvedBy: 'Управител', approvedOn: '2026-05-04' } }, uid, '2026-05-04');
    expect((await get(d)).data._rev).toEqual([{ v: '1.0', on: '2026-05-03', by: uid }, { v: '1.1', on: '2026-05-04', by: uid, note: 'нов рок' }]);
  });
  it('the Statement of Applicability: one control confirmed, then the rest from the proposal', async () => {
    await expect(saveSoa(tx, 'A.7.6', { applicable: false, justification: ' ', status: 'не се применува', evidence: '' }, uid, '2026-05-05')).rejects.toThrow(/оправдување/);
    await saveSoa(tx, 'A.7.6', { applicable: false, justification: 'Нема безбедни зони', status: 'спроведено', evidence: '' }, uid, '2026-05-05');
    expect((await loadSoa(tx)).get('A.7.6')).toMatchObject({ applicable: false, status: 'не се применува' });
    expect(await confirmSoaAll(tx, uid, '2026-05-05')).toBe(92);
    expect((await loadSoa(tx)).size).toBe(93);
    // the statement is not a register: no ISO number clash, not in the counts
    expect(await confirmSoaAll(tx, uid, '2026-05-05')).toBe(0);
  });
  it('a staff row per employee, merged; client counts', async () => {
    const e = { id: '00000000-0000-4000-8000-000000000001', name: 'Ана Анева' };
    const a = await saveIsoStaff(tx, e, { contractOn: '2026-05-06' }, uid, '2026-05-06');
    const b = await saveIsoStaff(tx, e, { ackOn: '2026-05-07', ackDocs: 'ПЛ-01 в1.0' }, uid, '2026-05-07');
    expect(b).toBe(a);
    const [r] = await db.select().from(schema.isoRecords).where(eq(schema.isoRecords.id, a));
    expect(r!.data).toMatchObject({ employeeId: e.id, contractOn: '2026-05-06', ackOn: '2026-05-07', ackDocs: 'ПЛ-01 в1.0' });
    expect(await isoClientCounts(tx)).toMatchObject({ clients: 1, withContract: 0 });
  });
});
