/**
 * UX Phase 3 on PGlite: „Преглед за книжење“ (P2/P28 — rules + reference + FIFO in one pass, confidence, bulk
 * confirm), the proposed payment ↔ invoice links (P3/P29 — after import, accept / reject, the owner's switches) and
 * the background re-post (P31 — open periods only, „разлики“). AI is never called by any of it.
 */
import { PGlite } from '@electric-sql/pglite';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { autoSteps, refNumbers, reviewConfidence, type Statement } from '@wise/core';
import { repostDiffs } from '@wise/core/repost';
import {
  acceptLinks, addManualLine, bookingReview, confirmReview, documentPayments, linkProposals, proposeLinks, rejectLinks, reviewAiStep,
  saveAutoSteps, saveBankAccount, saveImport,
} from './bank/index';
import { putAiBudget } from './ai-budget';
import { noteRepostChange, repostState, requestRepost, runFirmRepost } from './auto-repost';
import { oldVatDocs } from './repost';
import { saveInvoice } from './sales/invoices';
import { savePurchase } from './sales/purchases';
import type { DocActor } from './sales/context';
import * as schema from './schema/index';
import { seedReference } from './seed/reference';

const db = drizzle(new PGlite(), { schema });
const T = <R>(f: (tx: typeof db) => Promise<R>) => db.transaction((tx) => f(tx as unknown as typeof db));
const office: DocActor = { userId: null, role: 'acc' };
const ACC = '200000000111111';
const FIRM = 'Ревју ДООЕЛ';

let firmId = '', cust = '', sup = '', alfa = '', mkd = '';
const inv: Record<string, { id: string; number: string }> = {};
let pur1 = '';

async function invoice(key: string, partnerId: string, date: string, price = 1000) {
  const { id } = await T((tx) => saveInvoice(tx, firmId, { kind: 'invoice', date, partnerId, lines: [{ name: 'Услуга', qty: 1, price, rate: 18 }] }, office));
  const [r] = await db.select({ number: schema.invoices.number }).from(schema.invoices).where(eq(schema.invoices.id, id));
  inv[key] = { id, number: r!.number! };
}

/** A manual line with the statement fields the bank gives (name, purpose, reference, payment code). */
async function line(date: string, amount: number, desc: string, x: { name?: string; purpose?: string; bref?: string; osnov?: string } = {}) {
  const id = await T((tx) => addManualLine(tx, { firmId, userId: null, bankAccountId: mkd, date, amount, desc }));
  await db.update(schema.bankLines).set({ name: x.name ?? null, purpose: x.purpose ?? null, bref: x.bref ?? null, osnov: x.osnov ?? null, manual: false }).where(eq(schema.bankLines.id, id));
  return id;
}
const lineRow = async (id: string) => (await db.select().from(schema.bankLines).where(eq(schema.bankLines.id, id)))[0]!;
const pay = (ids: string[]) => T((tx) => documentPayments(tx, firmId, { invoiceIds: ids }));
const review = () => T((tx) => bookingReview(tx, firmId));
const auditCount = async (action: string) => (await db.select({ n: sql<number>`count(*)::int` }).from(schema.auditLog).where(and(eq(schema.auditLog.firmId, firmId), eq(schema.auditLog.action, action))))[0]!.n;
const aiRows = async () => (await db.select({ n: sql<number>`count(*)::int` }).from(schema.aiDocuments))[0]!.n + (await db.select({ n: sql<number>`count(*)::int` }).from(schema.aiUsage))[0]!.n;

beforeAll(async () => {
  await migrate(db, { migrationsFolder: fileURLToPath(new URL('../migrations', import.meta.url)) });
  await seedReference(db);
  const [f] = await db.insert(schema.firms).values({ name: FIRM }).returning();
  firmId = f!.id;
  const P = await db.insert(schema.partners).values([{ firmId, name: 'Купувач ДОО', code: '1' }, { firmId, name: 'Добавувач ДООЕЛ', code: '2' }, { firmId, name: 'Алфа ДОО', code: '3' }]).returning();
  cust = P[0]!.id; sup = P[1]!.id; alfa = P[2]!.id;
  mkd = await T((tx) => saveBankAccount(tx, { firmId, userId: null, input: { name: 'Халкбанк', account: ACC, cur: 'MKD', konto: '1000' } }));
  await invoice('A', cust, '2026-02-01');
  await invoice('B', cust, '2026-02-10');
  await invoice('C', cust, '2026-03-01');
  await invoice('D', alfa, '2026-03-05');
  pur1 = (await T((tx) => savePurchase(tx, firmId, { number: 'D-77', date: '2026-03-02', partnerId: sup, ptype: 'cost', groups: [{ account: '4000', rate: 18, base: 500, vat: 90 }] }, office))).id;
  await db.insert(schema.bankRules).values([{ firmId, kind: 'osnov', match: '930|out', konto: '4120', learned: true }, { firmId, kind: 'desc', match: 'телеком', konto: '4460' }]);
}, 60_000);

describe('the switches and the pure rules', () => {
  it('every automatic step is OFF by default', () => {
    expect(autoSteps({})).toEqual({ book: false, link: false, repost: false });
    expect(autoSteps(null)).toEqual({ book: false, link: false, repost: false });
    expect(autoSteps({ autoSteps: { book: 'yes', link: 1 } })).toEqual({ book: false, link: false, repost: false });
  });
  it('confidence: rule types, partner check, new partner / advance at most „веројатно“, no konto „рачно“', () => {
    expect(reviewConfidence({ how: 'osnov', konto: '4120' })).toBe('sure');
    expect(reviewConfidence({ how: 'num', konto: '1200', partnerOk: false })).toBe('likely');
    expect(reviewConfidence({ how: 'num', konto: '1200', partnerOk: true })).toBe('sure');
    expect(reviewConfidence({ how: 'fifo', konto: '1200', partnerOk: true })).toBe('likely');
    expect(reviewConfidence({ how: 'rule', konto: '1200', newPartner: 'Нов' })).toBe('likely');
    expect(reviewConfidence({ how: 'amt', konto: '1200', partnerOk: true, excess: 100 })).toBe('likely');
    expect(reviewConfidence({ how: 'fee', konto: '4460', missing: true })).toBe('manual');
    expect(reviewConfidence({ how: '', konto: '' })).toBe('manual');
    expect(refNumbers({ bref: '45/2026' }).map((k) => [k.n, k.y])).toEqual([[45, 26]]);
  });
  it('„разлики“ lists only the kontos that changed', () => {
    const D = repostDiffs(new Map([['2300', { d: 0, c: 1800 }], ['1200', { d: 11800, c: 0 }]]), new Map([['230018', { d: 0, c: 1800 }], ['1200', { d: 11800, c: 0 }]]));
    expect(D).toEqual([{ konto: '2300', d0: 0, c0: 18, d1: 0, c1: 0 }, { konto: '230018', d0: 0, c0: 0, d1: 0, c1: 18 }]);
  });
});

describe('„Преглед за книжење“: one pass, confidence, bulk confirm', () => {
  type K = 'osnov' | 'rule' | 'own' | 'turn' | 'ref' | 'fifo1' | 'fifo2' | 'amt' | 'unknown';
  const id = {} as Record<K, string>;
  beforeAll(async () => {
    id.osnov = await line('2026-05-05', -1000, 'Закуп', { osnov: '930' });
    id.rule = await line('2026-05-05', -500, 'Македонски Телеком сметка');
    id.own = await line('2026-05-05', -2000, 'Пренос на сметка', { name: FIRM });
    id.turn = await line('2026-05-05', 3000, 'Уплата на дневен пазар');
    id.ref = await line('2026-05-05', 1180, 'Уплата', { name: 'Алфа ДОО', bref: inv.D!.number });
    id.fifo1 = await line('2026-05-05', 3000, 'Уплата по договор', { name: 'Купувач ДОО' });
    id.fifo2 = await line('2026-05-06', 540, 'Уплата остаток', { name: 'Купувач ДОО' });
    id.amt = await line('2026-05-06', -590, 'Плаќање', { name: 'Добавувач ДООЕЛ' });
    id.unknown = await line('2026-05-06', -77, 'Нешто непознато');
  });

  it('each rule type gives the right proposal and confidence, with a reason', async () => {
    const R = await review();
    const by = new Map(R.items.map((i) => [i.lineId, i]));
    expect(by.get(id.osnov)).toMatchObject({ how: 'osnov', konto: '4120', conf: 'sure' });
    expect(by.get(id.rule)).toMatchObject({ how: 'rule', konto: '4460', conf: 'sure' });
    expect(by.get(id.own)).toMatchObject({ how: 'own', konto: '10091', conf: 'sure' });
    expect(by.get(id.turn)).toMatchObject({ how: 'turnover', conf: 'likely' });
    expect(by.get(id.ref)).toMatchObject({ how: 'ref', konto: '1200', partnerId: alfa, conf: 'sure', refs: [{ label: inv.D!.number, amt: 1180 }] });
    expect(by.get(id.amt)).toMatchObject({ how: 'amt', konto: '2200', partnerId: sup, conf: 'sure' });
    expect(by.get(id.unknown)).toMatchObject({ konto: '', conf: 'manual' });
    for (const i of R.items) if (i.konto) expect(i.why, i.how).toBeTruthy();
    expect(R.aiLines).toEqual([id.unknown]);
    expect(R.counts).toEqual({ sure: 5, likely: 3, manual: 1 });
  });

  it('FIFO across 3 open invoices with partial payments', async () => {
    const by = new Map((await review()).items.map((i) => [i.lineId, i]));
    // 3000 → A 1180, B 1180, C 640 (partial); the next 540 closes C
    expect(by.get(id.fifo1)).toMatchObject({ how: 'fifo', konto: '1200', partnerId: cust, conf: 'likely',
      refs: [{ label: inv.A!.number, amt: 1180 }, { label: inv.B!.number, amt: 1180 }, { label: inv.C!.number, amt: 640 }] });
    expect(by.get(id.fifo1)!.why).toMatch(/FIFO/);
    expect(by.get(id.fifo2)).toMatchObject({ how: 'fifo', refs: [{ label: inv.C!.number, amt: 540 }] });
  });

  it('bulk confirm posts only the ticked lines; totals and open items stay consistent; each statement once', async () => {
    const st = (await lineRow(id.fifo1)).statementId;
    const posts0 = await auditCount('postStatement');
    const r = await T((tx) => confirmReview(tx, { firmId, userId: null, lineIds: [id.fifo1, id.osnov, id.unknown] }));
    expect(r).toMatchObject({ booked: 2, statements: 1 });
    expect(await auditCount('postStatement')).toBe(posts0 + 1);
    expect(await auditCount('bankReviewBook')).toBe(1);
    expect(await lineRow(id.fifo1)).toMatchObject({ konto: '1200', partnerId: cust, auto: 'fifo' });
    expect(await lineRow(id.osnov)).toMatchObject({ konto: '4120', auto: 'osnov' });
    for (const k of ['rule', 'own', 'turn', 'ref', 'fifo2', 'amt', 'unknown'] as const) expect((await lineRow(id[k])).konto, k).toBeNull();
    const M = await pay([inv.A!.id, inv.B!.id, inv.C!.id]);
    expect(M.get(inv.A!.id)).toMatchObject({ paid: 1180, remaining: 0 });
    expect(M.get(inv.B!.id)).toMatchObject({ paid: 1180, remaining: 0 });
    expect(M.get(inv.C!.id)).toMatchObject({ paid: 640, remaining: 540 });
    // the statement journal balances and carries exactly the booked lines (3000 in, 1000 out)
    const [j] = await db.select().from(schema.journals).where(and(eq(schema.journals.firmId, firmId), eq(schema.journals.sourceId, st)));
    const JL = await db.select().from(schema.journalLines).where(eq(schema.journalLines.journalId, j!.id));
    const sum = (f: (l: typeof JL[number]) => unknown) => Math.round(JL.reduce((s, l) => s + Number(f(l)) * 100, 0));
    expect(sum((l) => l.debit)).toBe(sum((l) => l.credit));
    expect(JL.filter((l) => l.account === '1000').map((l) => [Number(l.debit), Number(l.credit)]).sort()).toEqual([[0, 1000], [3000, 0]]);
    // the review after: the next payment sees only the open 540 — now an exact amount of the partner („сигурно“)
    expect((await review()).items.find((i) => i.lineId === id.fifo2)).toMatchObject({ how: 'amt', conf: 'sure', refs: [{ label: inv.C!.number, amt: 540 }] });
  });

  it('„✓ Прокнижи ги сигурните“ books the sure lines only; „избраните“ never a „рачно“ one', async () => {
    const r = await T((tx) => confirmReview(tx, { firmId, userId: null, onlySure: true }));
    expect(r.booked).toBe(5); // rule, own, ref, amt, the rest of C
    expect(await lineRow(id.ref)).toMatchObject({ refId: inv.D!.id, konto: '1200', partnerId: alfa });
    expect(await lineRow(id.amt)).toMatchObject({ refId: pur1, konto: '2200' });
    for (const k of ['turn', 'unknown'] as const) expect((await lineRow(id[k])).konto, k).toBeNull();
    const r2 = await T((tx) => confirmReview(tx, { firmId, userId: null, lineIds: [id.turn, id.unknown] }));
    expect(r2.booked).toBe(1); // the turnover („веројатно“, ticked); never the „рачно“ one
    expect((await lineRow(id.turn)).konto).toBeTruthy();
    expect((await pay([inv.C!.id])).get(inv.C!.id)).toMatchObject({ paid: 1180, remaining: 0 });
    expect((await pay([inv.D!.id])).get(inv.D!.id)).toMatchObject({ paid: 1180, remaining: 0 });
    expect((await lineRow(id.unknown)).konto).toBeNull();
  });

  it('the AI step: offered only for what is left, with its cost; the budget pause blocks it; nothing calls AI', async () => {
    const R = await review();
    expect(R.aiLines).toEqual([id.unknown]);
    const s = await T((tx) => reviewAiStep(tx, firmId, R.aiLines.length));
    expect(s).toMatchObject({ lines: 1, paused: false });
    expect(s.estUsd).toBeGreaterThan(0);
    await T((tx) => putAiBudget(tx, { monthlyUsd: 0 }));
    expect(await T((tx) => reviewAiStep(tx, firmId, 1))).toMatchObject({ paused: true });
    expect((await T((tx) => reviewAiStep(tx, firmId, 1))).msg).toMatch(/паузирано/);
    await T((tx) => putAiBudget(tx, { monthlyUsd: 50 }));
    // resolve the last ones by hand → nothing left for AI
    await db.update(schema.bankLines).set({ konto: '4460' }).where(inArray(schema.bankLines.id, [id.unknown]));
    const R2 = await review();
    expect(R2.items).toEqual([]);
    expect(R2.aiLines).toEqual([]);
    expect((await T((tx) => reviewAiStep(tx, firmId, R2.aiLines.length))).lines).toBe(0);
    expect(await aiRows()).toBe(0);
  });

  it('locked periods are untouched: listed, never proposed or booked', async () => {
    const jan = await line('2026-01-20', -590, 'Плаќање', { name: 'Добавувач ДООЕЛ' });
    await db.update(schema.firms).set({ lockDate: '2026-03-31' }).where(eq(schema.firms.id, firmId));
    try {
      const R = await review();
      expect(R.locked).toBe(1);
      expect(R.items.find((i) => i.lineId === jan)).toMatchObject({ conf: 'manual', konto: '' });
      expect(R.items.find((i) => i.lineId === jan)!.locked).toMatch(/заклучен/);
      expect((await T((tx) => confirmReview(tx, { firmId, userId: null, onlySure: true }))).booked).toBe(0);
      expect((await T((tx) => confirmReview(tx, { firmId, userId: null, lineIds: [jan] }))).booked).toBe(0);
      expect(await T((tx) => proposeLinks(tx, { firmId, userId: null, lineIds: [jan] }))).toEqual([]);
      expect((await lineRow(jan)).konto).toBeNull();
    } finally {
      await db.update(schema.firms).set({ lockDate: null }).where(eq(schema.firms.id, firmId));
      await db.delete(schema.bankLines).where(eq(schema.bankLines.id, jan));
    }
  });
});

describe('payment ↔ invoice links (P3/P29)', () => {
  const st = (no: string, date: string, lines: Statement['lines']): Statement => {
    const net = lines.reduce((s, l) => s + l.amount, 0);
    return { format: 'camt.053', account: ACC, no, date, currency: 'MKD', opening: 1_000_000, closing: 1_000_000 + net,
      debit: -lines.filter((l) => l.amount < 0).reduce((s, l) => s + l.amount, 0), credit: lines.filter((l) => l.amount > 0).reduce((s, l) => s + l.amount, 0), lines };
  };
  const L = (amount: number, counterparty: string, o: { ref?: string; purpose?: string; desc?: string; osnov?: string } = {}) =>
    ({ date: '', amount, counterparty, ref: o.ref ?? '', purpose: o.purpose ?? '', desc: o.desc ?? `${counterparty} – ${o.purpose ?? 'уплата'}`, ...(o.osnov ? { osnov: o.osnov } : {}) });
  const imp = async (s: Statement) => {
    s.lines.forEach((l) => { l.date = s.date; });
    const r = await T((tx) => saveImport(tx, { firmId, userId: null, statements: [s], format: 'camt' }));
    const lines = await db.select().from(schema.bankLines).where(inArray(schema.bankLines.statementId, r.statementIds ?? [])).orderBy(asc(schema.bankLines.lineNo));
    return { r, lines };
  };

  it('after import: proposed links with confidence; switches off → nothing is booked', async () => {
    await invoice('E', alfa, '2026-06-01');
    await invoice('F', cust, '2026-06-02');
    const { r, lines } = await imp(st('31', '2026-06-10', [
      L(118_000, 'Алфа ДОО', { ref: inv.E!.number }),
      L(50_000, 'Купувач ДОО', { purpose: 'уплата' }),
      L(-15_000, 'Халкбанк АД', { purpose: 'Провизија за платен промет', osnov: '666' }),
    ]));
    expect(r.auto).toEqual({ proposed: 2, linked: 0, booked: 0 });
    const [e, f, fee] = lines;
    expect(e!.konto).toBeNull();
    expect(fee!.konto).toBeNull(); // a sure fee line stays for the person to confirm
    expect((e!.data as { link?: unknown }).link).toMatchObject({ how: 'ref', conf: 'sure', refs: [{ id: inv.E!.id, amt: 1180 }] });
    expect((f!.data as { link?: unknown }).link).toMatchObject({ how: 'fifo', conf: 'likely', refs: [{ id: inv.F!.id, amt: 500 }] });
    const P = await T((tx) => linkProposals(tx, firmId, 2026));
    expect(P.rows.map((x) => x.lineId)).toEqual([e!.id, f!.id]);
  });

  it('bulk reject stays rejected; bulk accept links against the current open amounts', async () => {
    const P = (await T((tx) => linkProposals(tx, firmId, 2026))).rows;
    const [e, f] = P;
    expect(await T((tx) => rejectLinks(tx, { firmId, userId: null, lineIds: [f!.lineId] }))).toBe(1);
    await T((tx) => proposeLinks(tx, { firmId, userId: null, year: 2026 }));
    const P2 = await T((tx) => linkProposals(tx, firmId, 2026));
    expect(P2.rows.map((x) => x.lineId)).toEqual([e!.lineId]);
    expect(P2.rejected).toBe(1);
    const a = await T((tx) => acceptLinks(tx, { firmId, userId: null, lineIds: [e!.lineId, f!.lineId] }));
    expect(a.linked).toBe(1);
    expect(a.skipped).toEqual([{ lineId: f!.lineId, why: 'нема предлог' }]);
    expect(await lineRow(e!.lineId)).toMatchObject({ refId: inv.E!.id, konto: '1200', partnerId: alfa, auto: 'ref' });
    expect((await pay([inv.E!.id, inv.F!.id]))).toEqual(new Map([
      [inv.E!.id, { type: 'invoice', total: 1180, paid: 1180, remaining: 0 }], [inv.F!.id, { type: 'invoice', total: 1180, paid: 0, remaining: 1180 }],
    ]));
    expect(await auditCount('bankLinkAccept')).toBe(1);
    expect(await auditCount('bankLinkReject')).toBe(1);
  });

  it('a paid document is skipped on accept (no double payment)', async () => {
    await invoice('G', alfa, '2026-06-03');
    const { lines } = await imp(st('32', '2026-06-11', [L(118_000, 'Алфа ДОО', { ref: inv.G!.number })]));
    // paid meanwhile by another line linked by hand
    const other = await line('2026-06-11', 1180, 'Алфа рачно', { name: 'Алфа ДОО' });
    await db.update(schema.bankLines).set({ konto: '1200', partnerId: alfa, refType: 'invoice', refId: inv.G!.id, refLabel: inv.G!.number }).where(eq(schema.bankLines.id, other));
    const a = await T((tx) => acceptLinks(tx, { firmId, userId: null, lineIds: [lines[0]!.id] }));
    expect(a).toMatchObject({ linked: 0, skipped: [{ why: 'фактурите се веќе платени' }] });
    expect((await pay([inv.G!.id])).get(inv.G!.id)).toMatchObject({ paid: 1180, remaining: 0 });
  });

  it('the owner switched „автоматски“ on: the sure links and lines are confirmed after import (audited)', async () => {
    await T((tx) => saveAutoSteps(tx, { firmId, userId: null, steps: { book: true, link: true, repost: false } }));
    await invoice('H', alfa, '2026-06-04');
    await invoice('I', cust, '2026-06-05', 2000);
    const { r, lines } = await imp(st('33', '2026-06-12', [
      L(118_000, 'Алфа ДОО', { ref: inv.H!.number }),
      L(30_000, 'Купувач ДОО', { purpose: 'аванс' }),
      L(-15_000, 'Халкбанк АД', { purpose: 'Провизија за платен промет', osnov: '666' }),
    ]));
    expect(r.auto).toMatchObject({ linked: 1 });
    expect(lines[0]).toMatchObject({ refId: inv.H!.id, konto: '1200' });
    expect(lines[2]).toMatchObject({ konto: '4460' }); // the sure fee line
    expect(lines[1]!.konto).toBeNull(); // FIFO is „веројатно“: waits for a person
    const [stRow] = await db.select().from(schema.bankStatements).where(eq(schema.bankStatements.id, lines[0]!.statementId));
    expect(stRow!.status).toBe('draft');
    const A = await db.select().from(schema.auditLog).where(and(eq(schema.auditLog.firmId, firmId), eq(schema.auditLog.action, 'bankLinkAccept')));
    expect(A.some((x) => (x.data as { auto?: boolean }).auto === true)).toBe(true);
    await T((tx) => saveAutoSteps(tx, { firmId, userId: null, steps: { book: false, link: false, repost: false } }));
  });
});

describe('background re-post (P31): open periods only, „разлики“', () => {
  let fid = '';
  beforeAll(async () => {
    const [f] = await db.insert(schema.firms).values({ name: 'Прекнижување 2 ДООЕЛ', vatRegistered: true, vatPeriod: 'quarter' }).returning();
    fid = f!.id;
    const [c] = await db.insert(schema.partners).values([{ firmId: fid, name: 'Купувач', code: '1' }]).returning();
    await T((tx) => saveInvoice(tx, fid, { kind: 'invoice', date: '2026-01-10', partnerId: c!.id, lines: [{ name: 'Услуга', qty: 1, price: 1000, rate: 18 }] }, office));
    await T((tx) => saveInvoice(tx, fid, { kind: 'invoice', date: '2026-04-10', partnerId: c!.id, lines: [{ name: 'Услуга', qty: 2, price: 500, rate: 18 }] }, office));
    // an old booking: VAT on the summary konto
    const J = await db.select({ id: schema.journals.id }).from(schema.journals).where(eq(schema.journals.firmId, fid));
    for (const j of J) await db.update(schema.journalLines).set({ account: '2300' }).where(and(eq(schema.journalLines.journalId, j.id), eq(schema.journalLines.account, '230018')));
    await db.update(schema.firms).set({ lockDate: '2026-03-31' }).where(eq(schema.firms.id, fid));
  });

  it('switch off (default): only a „Прекнижи“ suggestion, nothing queued or re-posted', async () => {
    const n = await T((tx) => noteRepostChange(tx, { firmIds: [fid], reason: 'schemes', year: 2026, userId: null }));
    expect(n).toEqual({ queue: [], due: 1 });
    expect((await T((tx) => repostState(tx, fid))).due).toMatchObject({ reason: 'schemes', year: 2026 });
    expect(await T((tx) => oldVatDocs(tx, fid, 2026))).toBe(2);
  });

  it('switch on: queued; the job re-posts open periods only and reports the differences', async () => {
    await T((tx) => saveAutoSteps(tx, { firmId: fid, userId: null, steps: { book: false, link: false, repost: true } }));
    const jan = (await db.select().from(schema.journals).where(and(eq(schema.journals.firmId, fid), eq(schema.journals.date, '2026-01-10'))))[0]!;
    const janBefore = await db.select().from(schema.journalLines).where(eq(schema.journalLines.journalId, jan.id));
    const n = await T((tx) => noteRepostChange(tx, { firmIds: [fid], reason: 'schemes', year: 2026, userId: null }));
    expect(n.queue).toHaveLength(1);
    expect((await T((tx) => repostState(tx, fid))).due).toBeNull();
    expect(await runFirmRepost(db, fid, 'other-run')).toBe(false);
    expect(await runFirmRepost(db, fid, n.queue[0]!.runId)).toBe(true);
    const s = await T((tx) => repostState(tx, fid));
    expect(s.run).toMatchObject({ status: 'done', auto: true, result: { docs: 1, locked: 1, failed: 0 } });
    expect(s.run!.result!.diffs).toEqual([
      { konto: '2300', d0: 0, c0: 360, d1: 0, c1: 180 },
      { konto: '230018', d0: 0, c0: 0, d1: 0, c1: 180 },
    ]);
    // the locked January journal is exactly as before
    const janAfter = await db.select().from(schema.journalLines).where(eq(schema.journalLines.journalId, jan.id));
    expect(janAfter.map((l) => [l.account, l.debit, l.credit]).sort()).toEqual(janBefore.map((l) => [l.account, l.debit, l.credit]).sort());
    expect(await T((tx) => oldVatDocs(tx, fid, 2026))).toBe(1);
    // a second run of the same id does nothing
    expect(await runFirmRepost(db, fid, n.queue[0]!.runId)).toBe(false);
  });

  it('„Прекнижи“ on the suggestion queues a run confirmed by a person', async () => {
    await T((tx) => saveAutoSteps(tx, { firmId: fid, userId: null, steps: { book: false, link: false, repost: false } }));
    await T((tx) => noteRepostChange(tx, { firmIds: [fid], reason: 'bankKonta', year: 2026, userId: null }));
    const runId = await T((tx) => requestRepost(tx, { firmId: fid, userId: null, year: 2026 }));
    expect(runId).toBeTruthy();
    const s = await T((tx) => repostState(tx, fid));
    expect(s.due).toBeNull();
    expect(s.run).toMatchObject({ status: 'queued', auto: false, reason: 'bankKonta' });
    expect(await runFirmRepost(db, fid, runId!)).toBe(true);
    expect((await T((tx) => repostState(tx, fid))).run).toMatchObject({ status: 'done', result: { diffs: [] } });
  });
});
