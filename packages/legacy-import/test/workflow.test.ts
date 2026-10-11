/**
 * Workflow 10 — legacy import as the worker runs it (`legacy.import`: every uploaded file → `parseBackupFile`, merged,
 * `importBundle`): a small synthetic firm backup together with an office settings file in the format of
 * `wise-postavki-shemi.json` (`{kind:'wise-legacy-export', v:1, at, firms:[], settings:{appsettings/schemes,
 * appsettings/office, applaw:[…]}}`). The schemes and office are stored, the law changes are listed, the firm's trial
 * balance matches the legacy ledger, and a document posted afterwards uses the imported office scheme.
 */
import { and, eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { saveInvoice, schema, type Tx } from '@wise/db';
import { mergeBundles, parseBackupFile } from '../src/format';
import { importBundle, type FileSink } from '../src/writer';
import { fixtureBackup } from './fixture';
import { testDb } from '../src/testing';

let db: Tx;
const sink: FileSink = { async put() {} };
const enc = (o: unknown) => new TextEncoder().encode(JSON.stringify(o));

/** Same shape as uvoz-stara/wise-postavki-shemi.json (values invented). */
const SETTINGS = {
  kind: 'wise-legacy-export', v: 1, at: '2026-10-10T15:30:00.000Z', firms: [],
  settings: {
    'appsettings/schemes': {
      by: 'admin', updated: '2026-10-01T10:00:00.000Z',
      sch: { customer: '1209', supplier: '2209', revGoods: '7410', revService: '7400' },
      vatIn: { 5: '13005', 10: '130010', 18: '130018' }, vatOut: { 5: '23005', 10: '230010', 18: '230018' }, vatImp: { 18: '130118' },
    },
    'appsettings/office': { name: 'ТЕСТ КАНЦЕЛАРИЈА ДООЕЛ', address: 'ул. Канцелариска 1', city: 'Скопје', edb: '4030000000999', embs: '7000999', fee: 3000, feeMode: 'month', rep: 'Сметководител', vatOn: true },
    applaw: [
      { id: 'law-1', inst: 'UJP', title: 'Измена на ЗДДВ – нова стапка за услуги', what: 'Стапката за … се менува', who: 'ДДВ обврзници', impact: ['ddv'], date: '2026-09-01', from: '2027-01-01', urls: ['https://ujp.gov.mk/x'], prog: 'ddv', verified: true, at: '2026-09-02', by: 'robot' },
      { id: 'law-2', inst: 'Собрание', title: 'Закон за платежни услуги – благајна', date: '2026-08-15', impact: ['kasa'], verified: false },
      { id: '', title: 'без клуч – се прескокнува' },
    ],
  },
};

beforeAll(async () => { db = await testDb(); }, 120_000);

describe('flow 10 — legacy import with the office settings file', () => {
  let firmId = '';

  it('the settings file and the firm backup are read like the worker reads uploaded files', async () => {
    const S = parseBackupFile('wise-postavki-shemi.json', enc(SETTINGS));
    expect(S.firms).toHaveLength(0);
    expect(Object.keys(S.glob).sort()).toEqual(['applaw', 'appsettings/office', 'appsettings/schemes']);
    const F = parseBackupFile('TEST_mf1abc.json', enc(fixtureBackup()));
    const B = mergeBundles([S, F]);
    const r = await importBundle(db, B, { userId: null, files: sink });
    expect(r.settings).toEqual(expect.arrayContaining(['Глобална шема за книжење: увезено.', 'Податоци за канцеларијата: увезено.', 'Законски промени: 2 увезени.']));
    expect(r.firms).toHaveLength(1);
    const f = r.firms[0]!;
    expect(f.error).toBeUndefined();
    expect(f.trialBalance.ok, JSON.stringify(f.trialBalance.diffs)).toBe(true);
    firmId = f.firmId!;
  });

  it('schemes and office are stored; law changes are listed', async () => {
    const A = await db.select().from(schema.appSettings);
    const by = Object.fromEntries(A.map((a) => [a.key, a.value as Record<string, unknown>]));
    expect((by.schemes!.sch as Record<string, string>).customer).toBe('1209');
    expect(by.office).toMatchObject({ name: 'ТЕСТ КАНЦЕЛАРИЈА ДООЕЛ', edb: '4030000000999' });
    const L = await db.select().from(schema.lawChanges);
    expect(L.map((l) => [l.key, l.inst, l.from, l.verified]).sort()).toEqual([['law-1', 'UJP', '2027-01-01', true], ['law-2', 'Собрание', null, false]]);
  });

  it('a new invoice of the imported firm books the customer on the imported office scheme', async () => {
    const [p] = await db.select().from(schema.partners).where(and(eq(schema.partners.firmId, firmId), eq(schema.partners.name, 'Купувач ДОО')));
    const r = await db.transaction((tx) => saveInvoice(tx as unknown as Tx, firmId, { kind: 'invoice', date: '2026-06-10', partnerId: p!.id, lines: [{ name: 'Услуга', qty: 1, price: 1000, rate: 18 }] }, { userId: null, role: 'acc' }));
    const [j] = await db.select().from(schema.journals).where(and(eq(schema.journals.sourceType, 'invoice'), eq(schema.journals.sourceId, r.id)));
    const L = await db.select().from(schema.journalLines).where(eq(schema.journalLines.journalId, j!.id));
    expect(L.find((l) => Number(l.debit) === 1180)!.account).toBe('1209');
  });

  it('importing the settings again keeps what is on the server', async () => {
    const r = await importBundle(db, parseBackupFile('wise-postavki-shemi.json', enc({ ...SETTINGS, settings: { ...SETTINGS.settings, 'appsettings/office': { name: 'ДРУГО' } } })), { userId: null });
    expect(r.settings).toEqual(expect.arrayContaining(['Податоци за канцеларијата: постои на серверот – не е заменето.']));
    const [o] = await db.select().from(schema.appSettings).where(eq(schema.appSettings.key, 'office'));
    expect((o!.value as { name: string }).name).toBe('ТЕСТ КАНЦЕЛАРИЈА ДООЕЛ');
    expect(await db.select().from(schema.lawChanges)).toHaveLength(2);
  });
});
