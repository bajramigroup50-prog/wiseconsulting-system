import { PGlite } from '@electric-sql/pglite';
import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { listBeneficiaries, saveBeneficiary, setMeal } from './meals';
import {
  consentFiles, deleteDonationReceipt, donIdsDeadlineRows, importMembers, issueMealDays, listMembers, markMembersReviewed, mealIssues, membersLastUpdate,
  reissueIfIssued, saveDonationReceipt, saveMealStockSettings, saveMember, setConsent, setDonationIds,
} from './npo';
import { loadRokFirms } from './rokovi';
import * as schema from './schema/index';
import { seedReference } from './seed/reference';

const db = drizzle(new PGlite(), { schema });
let firmId = '', userId = '', donId = '', partnerId = '', bread = '', milk = '';
const A = () => ({ firmId, userId, role: 'admin' });
const K = () => ({ firmId, userId, role: 'klient' });

beforeAll(async () => {
  await migrate(db, { migrationsFolder: fileURLToPath(new URL('../migrations', import.meta.url)) });
  await seedReference(db);
  const [f] = await db.insert(schema.firms).values({ name: 'Хуманитарно здружение Тест', edb: '4012024523759', vatRegistered: false, mods: ['meals'] }).returning();
  firmId = f!.id;
  const [u] = await db.insert(schema.users).values({ username: 'npo', name: 'Здружение', role: 'admin', passwordHash: 'x' }).returning();
  userId = u!.id;
  const [p] = await db.insert(schema.partners).values({ firmId, name: 'КИППЕР МАРКЕТ ДОО Желино', edb: 'MK4028011514916', vatRegistered: true }).returning();
  partnerId = p!.id;
  const [d] = await db.insert(schema.donations).values({ firmId, kind: 'donation', role: 'received', partnerId, number: '1/2026', date: '2026-11-18', amount: '1500000.00', inKind: true, inKindDesc: 'прехранбени производи' }).returning();
  donId = d!.id;
  const I = await db.insert(schema.items).values([
    { firmId, name: 'Леб', type: 'material', unit: 'kg' },
    { firmId, name: 'Млеко', type: 'material', unit: 'l' },
  ]).returning();
  bread = I[0]!.id; milk = I[1]!.id;
}, 120_000);

describe('НПО: consent', () => {
  it('records and clears the consent of a beneficiary, links the scan; foreign ids fail', async () => {
    const id = await db.transaction((tx) => saveBeneficiary(tx, A(), { name: 'Ramush Emini', members: 5 }));
    const [fl] = await db.insert(schema.files).values({ firmId, bucketKey: 'k1', name: 'sog.pdf', mime: 'application/pdf', size: 10, sha256: 'x', status: 'ready' }).returning();
    await db.transaction((tx) => setConsent(tx, A(), id, '2026-11-20', [fl!.id]));
    let [b] = await listBeneficiaries(db, firmId);
    expect(b!.consentDate).toBe('2026-11-20');
    expect((await consentFiles(db, [id])).get(id)).toEqual([fl!.id]);
    await db.transaction((tx) => setConsent(tx, A(), id, null));
    [b] = await listBeneficiaries(db, firmId);
    expect(b!.consentDate).toBeNull();
    await expect(db.transaction((tx) => setConsent(tx, A(), '00000000-0000-4000-8000-000000000000', '2026-11-20'))).rejects.toThrow('не постои');
  });
});

describe('НПО: members register', () => {
  it('saves, imports (updates the same person + organ), tracks the last update and the 2-year deadline', async () => {
    await db.transaction((tx) => saveMember(tx, A(), { name: 'Шкељким Укшини', organ: 'Претседател', role: 'претседател', joined: '2024-03-15' }));
    await expect(db.transaction((tx) => saveMember(tx, A(), { name: 'X', joined: '2025-01-01', left: '2024-01-01' }))).rejects.toThrow('пред датумот');
    const r = await db.transaction((tx) => importMembers(tx, A(), [
      { name: 'Шкељким Укшини', organ: 'Претседател', phone: '070 111 222' },
      { name: 'Ana Ana', organ: 'Собрание', role: 'член' },
    ]));
    expect(r).toEqual({ added: 1, updated: 1 });
    const M = await listMembers(db, firmId);
    expect(M.find((m) => m.name === 'Шкељким Укшини')).toMatchObject({ phone: '070 111 222', joined: '2024-03-15' });
    await db.transaction((tx) => markMembersReviewed(tx, A(), '2099-01-01'));
    expect((await membersLastUpdate(db, [firmId])).get(firmId)).toBe('2099-01-01');
    const [F] = await loadRokFirms(db, { from: '2100-12-01', to: '2101-12-31', firmIds: [firmId] });
    expect(F!.npoReg).toBe('2101-01-01');
  });
});

describe('НПО: УЈП-ИДС/ПР', () => {
  it('fulfilment → deadline row for the calendar; submitted → done; only for received donations', async () => {
    await db.transaction((tx) => setDonationIds(tx, { firmId, userId }, donId, { fulfilledDate: '2026-11-20' }));
    let R = await donIdsDeadlineRows(db, { firmIds: [firmId], from: '2026-12-01', to: '2026-12-31' });
    expect(R).toEqual([{ id: donId, firmId, due: '2026-12-20', done: false, title: 'УЈП-ИДС/ПР – донација 1/2026 од КИППЕР МАРКЕТ ДОО Желино' }]);
    await db.transaction((tx) => setDonationIds(tx, { firmId, userId }, donId, { fulfilledDate: '2026-11-20', idsFiled: '2026-11-25' }));
    R = await donIdsDeadlineRows(db, { firmIds: [firmId], from: '2026-12-01', to: '2026-12-31' });
    expect(R[0]!.done).toBe(true);
    const [g] = await db.insert(schema.donations).values({ firmId, kind: 'donation', role: 'given', partnerId, number: '1/2026', date: '2026-11-18', amount: '100.00' }).returning();
    await expect(db.transaction((tx) => setDonationIds(tx, { firmId, userId }, g!.id, { fulfilledDate: '2026-11-20' }))).rejects.toThrow('примателот');
  });
});

describe('НПО: kitchen stock', () => {
  it('a donation receipt enters stock with value, lot and expiry (Д залиха / П 7672), linked to the contract', async () => {
    const r = await db.transaction((tx) => saveDonationReceipt(tx, A(), {
      donationId: donId, date: '2026-11-19', account: '7672', lines: [
        { itemId: bread, qty: 20, price: 50, lot: 'L-11', expiry: '2026-11-30' },
        { itemId: milk, qty: 30, price: 60 },
      ],
    }));
    expect(r.number).toBe('1/2026');
    const mv = await db.select().from(schema.stockMoves).where(and(eq(schema.stockMoves.firmId, firmId), eq(schema.stockMoves.sourceType, 'don_receipt')));
    expect(mv).toHaveLength(2);
    expect(mv.find((m) => m.itemId === bread)).toMatchObject({ lot: 'L-11', expiry: '2026-11-30', value: '1000.00', partnerId });
    const lots = await db.select().from(schema.stockLots).where(eq(schema.stockLots.sourceType, 'don_receipt'));
    expect(lots).toMatchObject([{ itemId: bread, lot: 'L-11', expiry: '2026-11-30' }]);
    const J = await db.select().from(schema.journalLines).where(and(eq(schema.journalLines.firmId, firmId), eq(schema.journalLines.account, '7672')));
    expect(J.reduce((s, l) => s + Number(l.credit), 0)).toBe(2800);
  });

  it('issues portions × normative once per day, idempotent, follows the ticks, skips a day without stock', async () => {
    await db.transaction((tx) => saveMealStockSettings(tx, A(), { konto: '4000', norm: { b: [{ itemId: bread, qty: 0.2 }, { itemId: milk, qty: 0.25 }], l: [{ itemId: bread, qty: 0.3 }] } }));
    const [b] = await listBeneficiaries(db, firmId); // 5 members
    await db.transaction((tx) => setMeal(tx, A(), b!.id, '2026-11-20', 'b', true));
    await db.transaction((tx) => setMeal(tx, A(), b!.id, '2026-11-20', 'l', true));
    let r = await db.transaction((tx) => issueMealDays(tx, A(), '2026-11-01', '2026-11-30'));
    expect(r).toMatchObject({ issued: ['2026-11-20'], removed: [], same: 0, short: [] });
    let I = await mealIssues(db, firmId, '2026-11-20', '2026-11-20');
    // bread 5 × 0.2 + 5 × 0.3 = 2.5 kg at 50 = 125; milk 5 × 0.25 = 1.25 l at 60 = 75
    expect(I.get('2026-11-20')!.sort((x, y) => x.qty - y.qty)).toEqual([{ itemId: milk, qty: 1.25, value: 75 }, { itemId: bread, qty: 2.5, value: 125 }]);
    r = await db.transaction((tx) => issueMealDays(tx, A(), '2026-11-01', '2026-11-30'));
    expect(r).toMatchObject({ issued: [], same: 1 });
    // a tick removed → the issued day follows
    await db.transaction(async (tx) => { await setMeal(tx, A(), b!.id, '2026-11-20', 'l', false); await reissueIfIssued(tx, A(), '2026-11-20'); });
    I = await mealIssues(db, firmId, '2026-11-20', '2026-11-20');
    expect(I.get('2026-11-20')!.find((x) => x.itemId === bread)!.qty).toBe(1);
    // more than the stock → the day is skipped and reported
    await db.update(schema.mealBeneficiaries).set({ members: 200 }).where(eq(schema.mealBeneficiaries.id, b!.id));
    await db.transaction((tx) => setMeal(tx, A(), b!.id, '2026-11-21', 'b', true));
    r = await db.transaction((tx) => issueMealDays(tx, A(), '2026-11-21', '2026-11-21'));
    expect(r.issued).toEqual([]);
    expect(r.short.map((x) => x.item).sort()).toEqual(['Леб', 'Млеко']);
    // a day without meals loses its document
    await db.transaction((tx) => setMeal(tx, A(), b!.id, '2026-11-20', 'b', false));
    r = await db.transaction((tx) => issueMealDays(tx, A(), '2026-11-20', '2026-11-20'));
    expect(r.removed).toEqual(['2026-11-20']);
    expect((await mealIssues(db, firmId, '2026-11-20', '2026-11-20')).size).toBe(0);
  });

  it('respects the locked period and the module for client users', async () => {
    const [b] = await listBeneficiaries(db, firmId);
    await db.update(schema.mealBeneficiaries).set({ members: 1 }).where(eq(schema.mealBeneficiaries.id, b!.id));
    await db.transaction((tx) => setMeal(tx, A(), b!.id, '2026-11-10', 'b', true));
    await db.update(schema.firms).set({ lockDate: '2026-11-15' }).where(eq(schema.firms.id, firmId));
    const r = await db.transaction((tx) => issueMealDays(tx, A(), '2026-11-01', '2026-11-30'));
    expect(r.locked).toEqual(['2026-11-10']);
    await db.update(schema.firms).set({ lockDate: null, mods: [] }).where(eq(schema.firms.id, firmId));
    await expect(db.transaction((tx) => issueMealDays(tx, K(), '2026-11-10', '2026-11-10'))).rejects.toThrow();
    await db.update(schema.firms).set({ mods: ['meals'] }).where(eq(schema.firms.id, firmId));
  });

  it('deletes a donation receipt with its moves, lots and posting', async () => {
    const [r] = await db.select().from(schema.donationReceipts).where(eq(schema.donationReceipts.firmId, firmId));
    await db.transaction((tx) => deleteDonationReceipt(tx, A(), r!.id));
    expect(await db.select().from(schema.stockMoves).where(eq(schema.stockMoves.sourceType, 'don_receipt'))).toHaveLength(0);
    expect(await db.select().from(schema.stockLots).where(eq(schema.stockLots.sourceType, 'don_receipt'))).toHaveLength(0);
  });
});
