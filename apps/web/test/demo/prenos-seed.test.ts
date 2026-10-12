/**
 * Demo data for the year-end walkthrough (docs/demo/prenos-2027): „ДЕМО ПРОИЗВОДСТВО ДООЕЛ“, year 2026, entered
 * through the screens' server actions and the @wise/db document services they call — opening balance, partners,
 * sales / purchase invoices, bank statement (camt.053) with automatic matching, cash vouchers, a fixed asset with
 * depreciation, a bank loan, two employees' payroll and the monthly ДДВ-04 closes.
 *
 * Only runs when `WISE_TEST_PGLITE_DIR` points at a PGlite data directory (the dev database of
 * `pnpm --filter @wise/db dev-server`, stopped while seeding) and `DEMO_ADMIN_PASSWORD` is set:
 *
 *   WISE_TEST_PGLITE_DIR=../../packages/db/.pglite DEMO_ADMIN_PASSWORD=… pnpm exec vitest run test/demo/prenos-seed.test.ts
 *
 * The year itself is NOT closed here — that is what the Playwright walkthrough (e2e/prenos-demo.spec.ts) shows.
 */
import { and, eq } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';
import { parseStatementFile } from '@wise/core';
import {
  applyMatches, carryState, closeVatPeriod, createDefaultRegisters, loadRegisters, loadRun, loadYear, proposeMatches, saveImport, saveInvoice,
  savePurchase, saveVoucher, schema, yearFindings, type DocActor,
} from '@wise/db';
import { hashPassword } from '@wise/db/password';
import { act, form, pg, setupDb, useFirm, useYear, jar } from '../harness';
import { createHash, randomBytes } from 'node:crypto';

vi.mock('@/lib/db', () => import('../harness').then((h) => h.dbModule));
vi.mock('next/headers', () => import('../harness').then((h) => h.headersModule));
vi.mock('next/cache', () => import('../harness').then((h) => h.cacheModule));
vi.mock('@wise/db', async (orig) => ({ ...(await orig<object>()), getDb: () => (globalThis as { __wisePg?: unknown }).__wisePg }));

const DIR = process.env.WISE_TEST_PGLITE_DIR;
const PASS = process.env.DEMO_ADMIN_PASSWORD;
const FIRM = 'ДЕМО ПРОИЗВОДСТВО ДООЕЛ';

describe.skipIf(!DIR || !PASS)('demo seed — ДЕМО ПРОИЗВОДСТВО ДООЕЛ 2026', () => {
  it('fills 2026', async () => {
    await setupDb();
    const { saveFirm } = await import('@/app/(app)/firmi/actions');
    const { savePartner } = await import('@/app/(app)/partneri/actions');
    const { saveOpening } = await import('@/app/(app)/pocetna/actions');
    const { saveJournal } = await import('@/app/(app)/nalozi/actions');
    const { saveAsset, runDepAction } = await import('@/app/(app)/os/actions');
    const { saveLoanAction } = await import('@/app/(app)/pozajmici/actions');
    const { saveEmployee } = await import('@/app/(app)/vraboteni/actions');
    const { createRun, saveRunAction } = await import('@/app/(app)/plati/actions');
    const { setKontoAction } = await import('@/app/(app)/banka/actions');

    // the administrator who logs in in the browser (real password hash)
    let [admin] = await pg.select().from(schema.users).where(eq(schema.users.username, 'admin'));
    if (!admin) {
      [admin] = await pg.insert(schema.users).values({ username: 'admin', name: 'Администратор', role: 'admin', allFirms: true, passwordHash: await hashPassword(PASS!), mustChangePassword: false }).returning();
    }
    const token = randomBytes(24).toString('base64url');
    await pg.insert(schema.sessions).values({ id: createHash('sha256').update(token).digest('hex'), userId: admin!.id, expiresAt: new Date(Date.now() + 864e5) });
    jar.set('wc_sess', token);
    useYear(2026);

    const old = await pg.select().from(schema.firms).where(eq(schema.firms.name, FIRM));
    expect(old, 'the demo firm exists already — use a fresh database').toHaveLength(0);

    /* ---------- firm (Фирми → Нова фирма) ---------- */
    const fr = await act(saveFirm({}, form({
      name: FIRM, legalForm: 'dooel', address: 'ул. Индустриска 12', city: 'Скопје', activity: '25.11', edb: '4030026555123', embs: '7555123',
      vatRegistered: true, vatPeriod: 'month', bank: '300000000555123', phone: '02 3100 100', email: 'info@demo-proizvodstvo.mk',
    })));
    expect((fr as { error?: string }).error).toBeUndefined();
    const [firm] = await pg.select().from(schema.firms).where(eq(schema.firms.name, FIRM));
    const firmId = firm!.id;
    useFirm(firmId);
    const office: DocActor = { userId: admin!.id, role: 'admin' };

    /* ---------- partners (Комитенти) ---------- */
    const P: Record<string, string> = {};
    const partners: [string, string, string, string, string][] = [
      ['market', 'МАРКЕТ ПЛУС ДООЕЛ Скопје', '4030005100001', 'Скопје', '210000000000101'],
      ['trgbit', 'ТРГОВИЈА БИТ ДОО Битола', '4002005100002', 'Битола', '300000000000202'],
      ['agro', 'АГРО ЕКСПОРТ ДОО Струмица', '4027005100003', 'Струмица', '250000000000303'],
      ['metal', 'МЕТАЛ КОМЕРЦ ДОО Велес', '4004005100004', 'Велес', '200000000000404'],
      ['pako', 'ПАКОМАК ДООЕЛ Куманово', '4017005100005', 'Куманово', '380000000000505'],
      ['evn', 'ЕВН МАКЕДОНИЈА АД Скопје', '4030006600006', 'Скопје', '300000000000606'],
      ['bank', 'СТОПАНСКА БАНКА АД Скопје', '4030996100007', 'Скопје', '200000000000707'],
    ];
    for (const [k, name, edb, city, acc] of partners) {
      const r = await act(savePartner({}, form({ name, edb, city, country: 'MK', bankAccount: acc, vatRegistered: true, active: true })));
      expect((r as { error?: string }).error, name).toBeUndefined();
      const [p] = await pg.select().from(schema.partners).where(and(eq(schema.partners.firmId, firmId), eq(schema.partners.name, name)));
      P[k] = p!.id;
    }

    /* ---------- opening balance 01.01.2026 (Почетна состојба) ---------- */
    const op = await saveOpening({}, form({ payload: JSON.stringify({ full: false, date: '2026-01-01', rows: [
      { account: '1000', name: 'Жиро сметка', debit: 450000, credit: 0 },
      { account: '1020', name: 'Главна благајна', debit: 15000, credit: 0 },
      { account: '1200', partnerId: P.market, debit: 120000, credit: 0 },
      { account: '1200', partnerId: P.agro, debit: 45000, credit: 0 },
      { account: '3100', name: 'Суровини и материјали', debit: 200000, credit: 0 },
      { account: '2200', partnerId: P.metal, debit: 0, credit: 80000 },
      { account: '9000', name: 'Основна главнина', debit: 0, credit: 310000 },
      { account: '950', name: 'Задржана добивка', debit: 0, credit: 440000 },
    ] }) }));
    expect(op.error, op.error).toBeUndefined();

    const J = async (date: string, description: string, rows: { account: string; debit?: number; credit?: number; partnerId?: string; doc?: string }[]) => {
      const r = await act(saveJournal({}, form({ payload: JSON.stringify({ date, description, rows: rows.map((x) => ({ account: x.account, debit: x.debit ?? 0, credit: x.credit ?? 0, partnerId: x.partnerId ?? '', note: '', doc: x.doc ?? '' })) }) })));
      expect((r as { error?: string }).error, description + ': ' + (r as { error?: string }).error).toBeUndefined();
    };
    const tx = <T>(f: (t: typeof pg) => Promise<T>) => pg.transaction((t) => f(t as unknown as typeof pg));

    /* ---------- sales invoices (Излезни фактури) ---------- */
    const INV: Record<string, { id: string; number: string; total: number }> = {};
    const sales: [string, string, string, number, number][] = [
      // key, date, customer, qty, price (Метални полици, 18 %)
      ['i1', '2026-01-20', 'market', 40, 2500],
      ['i2', '2026-02-12', 'trgbit', 30, 2500],
      ['i3', '2026-03-18', 'agro', 60, 2400],
      ['i4', '2026-05-07', 'market', 50, 2500],
      ['i5', '2026-06-22', 'trgbit', 20, 2600],
      ['i6', '2026-09-15', 'agro', 45, 2600],
      ['i7', '2026-11-10', 'market', 70, 2600],
      ['i8', '2026-12-08', 'trgbit', 25, 2600],
    ];
    for (const [k, date, c, qty, price] of sales) {
      const r = await tx((t) => saveInvoice(t, firmId, { kind: 'invoice', date, partnerId: P[c]!, due: date.slice(0, 8) + '28', lines: [{ name: 'Метални полици МП-200', qty, price, rate: 18, unit: 'ком' }] }, office));
      INV[k] = { id: r.id, number: r.number, total: Math.round(qty * price * 1.18 * 100) / 100 };
    }
    // the first invoice of 2027 (so the customer's 2027 card shows the carried balance and a new movement)
    await tx((t) => saveInvoice(t, firmId, { kind: 'invoice', date: '2027-01-15', partnerId: P.market!, due: '2027-02-15', lines: [{ name: 'Метални полици МП-200', qty: 30, price: 2650, rate: 18, unit: 'ком' }] }, office));

    /* ---------- purchases (Влезни фактури) ---------- */
    const PUR: Record<string, { id: string; total: number; number: string }> = {};
    const purch: [string, string, string, string, string, number][] = [
      ['p1', 'М-118/2026', '2026-01-12', 'metal', '4000', 60000],
      ['p2', 'ПК-33/2026', '2026-02-05', 'pako', '4001', 18000],
      ['p3', 'М-402/2026', '2026-04-14', 'metal', '4000', 85000],
      ['p4', 'ЕВН-06/2026', '2026-06-30', 'evn', '4020', 24000],
      ['p5', 'М-771/2026', '2026-08-19', 'metal', '4000', 70000],
      ['p6', 'ПК-129/2026', '2026-10-09', 'pako', '4001', 15000],
      ['p7', 'ЕВН-12/2026', '2026-12-31', 'evn', '4020', 26000],
    ];
    for (const [k, number, date, s, account, base] of purch) {
      const r = await tx((t) => savePurchase(t, firmId, { number, date, partnerId: P[s]!, ptype: 'cost', groups: [{ account, rate: 18, base, vat: base * 0.18 }], costs: {} }, office));
      PUR[k] = { id: r.id, total: base * 1.18, number };
    }
    // the fixed asset purchase (Опрема 0121) — then the asset card and the depreciation
    const ma = await tx((t) => savePurchase(t, firmId, { number: 'М-210/2026', date: '2026-02-20', partnerId: P.metal!, ptype: 'cost', groups: [{ account: '0121', rate: 18, base: 360000, vat: 64800 }], costs: {} }, office));
    PUR.asset = { id: ma.id, total: 424800, number: 'М-210/2026' };
    const as = await saveAsset({}, form({ name: 'Машина за свиткување лим ХП-40', konto: '0121', rate: '20', cost: '360000', date: '2026-02-20', supplier: 'МЕТАЛ КОМЕРЦ ДОО Велес', invDoc: 'М-210/2026', disposed: '' }));
    expect(as.error, as.error).toBeUndefined();

    /* ---------- cash (Благајна) ---------- */
    await tx((t) => createDefaultRegisters(t, { firmId, userId: admin!.id }));
    const R = await tx((t) => loadRegisters(t, firmId));
    const main = R.find((r) => r.cur === 'MKD')!;
    await tx((t) => saveVoucher(t, { firmId, userId: admin!.id, input: { registerId: main.id, kind: 'in', date: '2026-03-25', amt: 50000, konto: '1200', partnerId: P.agro, docNo: INV.i3!.number, note: 'Делумна наплата во готово' } as never }));
    await tx((t) => saveVoucher(t, { firmId, userId: admin!.id, input: { registerId: main.id, kind: 'out', date: '2026-04-03', amt: 4200, konto: '4010', note: 'Канцелариски материјал' } as never }));
    await tx((t) => saveVoucher(t, { firmId, userId: admin!.id, input: { registerId: main.id, kind: 'out', date: '2026-09-02', amt: 6500, konto: '4002', note: 'Средства за чистење' } as never }));

    /* ---------- bank loan contract (Позајмици и кредити) — the money moves through the bank statements below ---------- */
    const ln = await act(saveLoanAction({}, form({ dir: 'received', partnerId: P.bank, date: '2026-03-05', amount: '600000', rate: '5.5', termDate: '2027-12-31', installments: '20', number: 'КР-2026/118', purpose: 'Обртни средства', konto: '2620', signed: '1' })));
    expect((ln as { error?: string }).error).toBeUndefined();

    /* ---------- manual journal (Налози): raw material used per the year-end stock count ---------- */
    await J('2026-12-31', 'Потрошок суровини по попис 31.12.2026', [{ account: '4000', debit: 150000 }, { account: '3100', credit: 150000 }]);

    /* ---------- payroll: two employees, November and December ---------- */
    for (const [name, embg, net] of [['Ана Петровска', '0101990455001', '32000'], ['Борис Илиевски', '0202985450002', '45000']] as const) {
      const r = await act(saveEmployee({}, form({ name, embg, netBase: net, start: '2021-03-01', bankAcc: '210000000000074', bank: 'НЛБ', active: true, position: name.startsWith('Ана') ? 'Сметководител' : 'Бравар' })));
      expect(r).toEqual({ redirect: '/vraboteni' });
    }
    const posted: Record<string, { account: string; credit: number; partnerId: string | null }[]> = {};
    for (const month of ['2026-11', '2026-12']) {
      expect(await act(createRun({}, form({ month, mode: 'cal' })))).toEqual({ redirect: `/plati/${month}` });
      const run = (await loadRun(pg as never, firmId, { month }))!;
      const r = await saveRunAction({ month, runId: run.id, params: run.params, emps: run.emps, post: true });
      expect(r.error, r.error).toBeUndefined();
      const [rr] = await pg.select().from(schema.payrollRuns).where(eq(schema.payrollRuns.id, run.id));
      const L = await pg.select().from(schema.journalLines).where(eq(schema.journalLines.journalId, rr!.journalId!));
      // what is owed after the month: the net credit per liability konto (gross 2400 is cleared inside the same journal)
      const net = new Map<string, number>();
      for (const l of L) if (!l.account.startsWith('99') && !l.account.startsWith('4')) net.set(l.account, (net.get(l.account) ?? 0) + Number(l.credit) - Number(l.debit));
      posted[month] = [...net].filter(([, v]) => v > 0.005).map(([account, v]) => ({ account, credit: Math.round(v * 100) / 100, partnerId: null }));
    }
    console.log('payroll 11', JSON.stringify(posted['2026-11']));

    /* ---------- depreciation (Основни средства → Амортизација) ---------- */
    const d = await runDepAction();
    expect(d.error, d.error).toBeUndefined();
    console.log(d.ok);

    /* ---------- VAT: ДДВ-04 per month, closed; paid the month after (December is due in January 2027) ---------- */
    const vatPay: { period: string; acc: string; v: number }[] = [];
    for (let m = 1; m <= 12; m++) {
      const period = `2026-${String(m).padStart(2, '0')}`;
      const r = await tx((t) => closeVatPeriod(t, { firmId, period, userId: admin!.id }));
      if (!r.journal || m === 12) continue;
      const VL = await pg.select().from(schema.journalLines).where(eq(schema.journalLines.journalId, r.journal.id));
      // the net line of the close: „Обврска за плаќање ДДВ“ (payable) or „Побарување за ДДВ“ (carried forward, not paid out)
      const pl = VL.find((l) => /Обврска за плаќање ДДВ/.test(l.note ?? ''));
      if (pl) vatPay.push({ period, acc: pl.account, v: -Number(pl.credit) });
    }
    console.log('vat', JSON.stringify(vatPay));

    /* ---------- bank statements (Банка → увоз camt.053): automatic matching, the rest booked per line ---------- */
    type BL = [date: string, cd: 'CRDT' | 'DBIT', amt: number, name: string, acc: string, purpose: string, konto?: string, partner?: string];
    const UJP: [string, string] = ['УЈП – ТРЕЗОРСКА СМЕТКА', '100000000063095'];
    const pay: BL[] = [
      ['2026-01-30', 'DBIT', 80000, 'МЕТАЛ КОМЕРЦ ДОО Велес', '200000000000404', 'Плаќање почетно салдо', '2200', 'metal'],
      ['2026-02-10', 'CRDT', 120000, 'МАРКЕТ ПЛУС ДООЕЛ Скопје', '210000000000101', 'Плаќање почетно салдо 2025', '1200', 'market'],
      ['2026-02-15', 'CRDT', INV.i1!.total, 'МАРКЕТ ПЛУС ДООЕЛ Скопје', '210000000000101', `Плаќање по фактура ${INV.i1!.number}`],
      ['2026-02-25', 'DBIT', PUR.p1!.total, 'МЕТАЛ КОМЕРЦ ДОО Велес', '200000000000404', 'Плаќање фактура М-118/2026'],
      ['2026-03-05', 'CRDT', INV.i2!.total, 'ТРГОВИЈА БИТ ДОО Битола', '300000000000202', `Плаќање по фактура ${INV.i2!.number}`],
      ['2026-03-05', 'CRDT', 600000, 'СТОПАНСКА БАНКА АД Скопје', '200000000000707', 'Пуштање кредит КР-2026/118', '2620', 'bank'],
      ['2026-03-10', 'DBIT', PUR.p2!.total, 'ПАКОМАК ДООЕЛ Куманово', '380000000000505', 'Плаќање фактура ПК-33/2026'],
      ['2026-04-20', 'CRDT', 45000, 'АГРО ЕКСПОРТ ДОО Струмица', '250000000000303', 'Плаќање почетно салдо', '1200', 'agro'],
      ['2026-04-30', 'DBIT', PUR.asset!.total, 'МЕТАЛ КОМЕРЦ ДОО Велес', '200000000000404', 'Плаќање фактура М-210/2026'],
      ['2026-05-25', 'DBIT', PUR.p3!.total, 'МЕТАЛ КОМЕРЦ ДОО Велес', '200000000000404', 'Плаќање фактура М-402/2026'],
      ['2026-06-10', 'CRDT', INV.i4!.total, 'МАРКЕТ ПЛУС ДООЕЛ Скопје', '210000000000101', `Плаќање по фактура ${INV.i4!.number}`],
      ['2026-07-15', 'DBIT', PUR.p4!.total, 'ЕВН МАКЕДОНИЈА АД Скопје', '300000000000606', 'Плаќање фактура ЕВН-06/2026'],
      ['2026-07-20', 'CRDT', INV.i5!.total, 'ТРГОВИЈА БИТ ДОО Битола', '300000000000202', `Плаќање по фактура ${INV.i5!.number}`],
      ['2026-10-20', 'CRDT', 100000, 'АГРО ЕКСПОРТ ДОО Струмица', '250000000000303', `Делумно плаќање ${INV.i6!.number}`, '1200', 'agro'],
    ];
    for (const m of ['04', '05', '06', '07', '08', '09', '10', '11', '12']) {
      pay.push([`2026-${m}-05`, 'DBIT', 30000, 'СТОПАНСКА БАНКА АД Скопје', '200000000000707', `Рата главнина КР-2026/118 ${m}/2026`, '2620', 'bank']);
      pay.push([`2026-${m}-05`, 'DBIT', 2400, 'СТОПАНСКА БАНКА АД Скопје', '200000000000707', `Камата КР-2026/118 ${m}/2026`, '4740']);
    }
    for (const x of vatPay) {
      const m = Number(x.period.slice(5)) + 1;
      const dt = `2026-${String(m).padStart(2, '0')}-24`;
      if (x.v < 0) pay.push([dt, 'DBIT', -x.v, ...UJP, `ДДВ за ${x.period.slice(5)}/2026`, x.acc]);
      else pay.push([dt, 'CRDT', x.v, ...UJP, `Поврат ДДВ ${x.period.slice(5)}/2026`, x.acc]);
    }
    // November salaries and contributions paid on 10.12 (December's are paid in January 2027 → carried as liabilities)
    posted['2026-11']!.forEach((l, i) => pay.push(['2026-12-10', 'DBIT', l.credit, ...UJP, `Плата 11/2026 ставка ${i + 1} (${l.account})`, l.account, undefined]));
    pay.push(['2026-12-31', 'DBIT', 1850, 'СТОПАНСКА БАНКА АД Скопје', '200000000000707', 'Провизија за водење сметка 2026', '4810']);
    pay.sort((a, b) => a[0].localeCompare(b[0]));
    const ntry = pay.map(([dt, cd, amt, name, acc, ref]) => `<Ntry><Amt Ccy="MKD">${amt.toFixed(2)}</Amt><CdtDbtInd>${cd}</CdtDbtInd><BookgDt><Dt>${dt}</Dt></BookgDt><ValDt><Dt>${dt}</Dt></ValDt>
<NtryDtls><TxDtls><RltdPties>${cd === 'CRDT' ? `<Dbtr><Nm>${name}</Nm></Dbtr><DbtrAcct><Id><Othr><Id>${acc}</Id></Othr></Id></DbtrAcct>` : `<Cdtr><Nm>${name}</Nm></Cdtr><CdtrAcct><Id><Othr><Id>${acc}</Id></Othr></Id></CdtrAcct>`}</RltdPties>
<RmtInf><Ustrd>${ref}</Ustrd></RmtInf></TxDtls></NtryDtls></Ntry>`);
    // one statement per date (the bank sends a daily statement)
    const byDate = new Map<string, string[]>();
    pay.forEach((p, i) => byDate.set(p[0], [...(byDate.get(p[0]) ?? []), ntry[i]!]));
    let seq = 0;
    const stmts = [...byDate].map(([dt, e]) => `<Stmt><Id>S${++seq}</Id><ElctrncSeqNb>${seq}</ElctrncSeqNb><CreDtTm>${dt}T10:00:00</CreDtTm>
<Acct><Id><Othr><Id>300000000555123</Id></Othr></Id><Ccy>MKD</Ccy><Ownr><Nm>${FIRM}</Nm></Ownr></Acct>${e.join('\n')}</Stmt>`);
    const xml = `<?xml version="1.0" encoding="UTF-8"?><Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.02"><BkToCstmrStmt><GrpHdr><MsgId>1</MsgId><CreDtTm>2026-12-31T10:00:00</CreDtTm></GrpHdr>${stmts.join('\n')}</BkToCstmrStmt></Document>`;
    const S = parseStatementFile(new TextEncoder().encode(xml), 'izvodi-2026.xml');
    expect(S?.length).toBe(byDate.size);
    await tx((t) => saveImport(t, { firmId, userId: admin!.id, statements: S!, fileName: 'izvodi-2026.xml', format: 'camt' }));
    // automatic matching (Банка → „Поврзи автоматски“): only lines without a konto of their own
    const withKonto = new Set(pay.filter((p) => p[6]).map((p) => p[5]));
    const BL0 = await pg.select().from(schema.bankLines).where(eq(schema.bankLines.firmId, firmId));
    const own = new Set(BL0.filter((l) => [...withKonto].some((x) => `${l.purpose ?? ''} ${l.description}`.includes(x))).map((l) => l.id));
    const M = (await tx((t) => proposeMatches(t, firmId, 2026))).filter((m) => !own.has(m.lineId));
    await tx((t) => applyMatches(t, { firmId, userId: admin!.id, year: 2026, accept: M.map((p) => p.lineId) }));
    const BLs = await pg.select().from(schema.bankLines).where(eq(schema.bankLines.firmId, firmId));
    let booked = 0;
    for (const l of BLs) {
      if (l.konto || l.refId) continue;
      const p = pay.find((x) => `${l.purpose ?? ''} ${l.description}`.includes(x[5]));
      if (!p) { console.log('UNBOOKED', l.description, l.purpose); continue; }
      // an invoice payment the matcher did not pair: booked on the partner's 1200 / 2200 by hand
      const [konto, pk] = p[6] ? [p[6], p[7]] : [p[1] === 'CRDT' ? '1200' : '2200', partners.find((x) => x[1] === p[3])?.[0]];
      const r = await setKontoAction({}, form({ line: l.id, konto, partner: pk ? P[pk] : '' }));
      expect((r as { error?: string }).error, String(p[5]) + ' ' + (r as { error?: string }).error).toBeUndefined();
      booked++;
    }
    console.log('bank lines', BLs.length, 'auto', M.length, 'booked', booked);

    /* ---------- the year's state before the close ---------- */
    const L = await loadYear(pg as never, firmId, 2026);
    const F = await yearFindings(pg as never, L, '2027-02-15');
    console.log('findings', JSON.stringify(F.open.map((x) => [x.key, (x as { t?: string; msg?: string }).t ?? (x as { msg?: string }).msg ?? x])));
    console.log('profit', L.Y.co.zs.profit, 'tax', L.Y.co.db.tax);
    expect(F.open).toEqual([]);
    // the planned carry-over: the statistical VAT bases (994 / 999) left out
    const C = await carryState(pg as never, firmId, 2026, L);
    // (before the close the plan differs by the year's profit, still in classes 4 / 7)
    expect(Math.round((C.plan.credit - C.plan.debit + L.Y.co.zs.profit) * 100)).toBe(0);
    expect(C.plan.lines.some((l) => /^99[49]/.test(l.account))).toBe(false);
    expect(C.evidence.rows.filter((r) => r.rule === 'stat').map((r) => r.account)).toEqual(['994018', '999018']);
  }, 600_000);
});
