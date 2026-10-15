/**
 * 🎭 Demo seed (`@wise/core/demo`): three demo client firms, the demo office and demo colleagues, entered through the
 * same `@wise/db` services the screens call (posting, invoices / purchases, stock, production, bank import + matching,
 * cash vouchers, payroll, ДДВ-04 closes) and typed inserts for plain master data. Ported from the presentation seed
 * (`apps/web/test/demo/prenos-seed.test.ts` + `prezantim-seed.test.ts`, branch of the WISE presentation video).
 *
 * Production-safe: it only ever INSERTS rows of new demo firms (`settings.demo = true` + name „ДЕМО…“) and demo users
 * (`users.demo = true`); it never reads or writes a real firm, a real user or `app_settings` 'office'. It refuses to
 * run while demo firms exist (use `resetDemo`, which deletes them first, in the same transaction).
 *
 * Dates: the year (default: the current year in Skopje, the previous one in January / February) is filled up to the
 * last completed month `M`; ДДВ-04 is closed for the completed periods before `M` (the last one is left for a live close).
 */
import { and, eq, sql } from 'drizzle-orm';
import { randomBytes } from 'node:crypto';
import { parseStatementFile, payDraft, type PayEmp } from '@wise/core';
import { DEMO_FIRM_NAMES, DEMO_OFFICE_NAME, demoPassword } from '@wise/core/demo';
import { kdIndex, kdStatusCode, type KdContract } from '@wise/core/firms/kdog';
import { taskTransition } from '@wise/core/office';
import { todaySkopje } from '@wise/core/office/dates';
import { hashPassword } from '../password';
import { audit, type Tx } from '../audit';
import { postJournal } from '../posting';
import { applyMatches, createDefaultRegisters, loadRegisters, proposeMatches, saveImport, saveVoucher } from '../bank/index';
import { saveInvoice } from '../sales/invoices';
import { savePurchase, type PurchaseInput } from '../sales/purchases';
import type { DocActor } from '../sales/context';
import { closeVatPeriod } from '../vat-service';
import { postRun, saveRun } from '../payroll';
import { posSell, runProductionOrder, saveBom, saveTransfer } from '../stock-docs';
import { saveStoreOut } from '../parity-retail';
import { demoFirmIds } from './filters';
import {
  auditLog, codes, employees, firms, fixedAssets, inboxItems, itemBarcodes, items, officeTasks, partners, serviceContracts, userFirms, users,
  type NewFirm,
} from '../schema/index';

export interface SeedDemoOptions { adminUserId: string; year?: number }
export interface SeedDemoResult { firmIds: string[]; officeFirmId: string; userIds: string[] }

export class DemoSeedError extends Error {}

const [TRG, PROD, USL] = DEMO_FIRM_NAMES;
const r2 = (v: number) => Math.round(v * 100) / 100;
const pad = (n: number) => String(n).padStart(2, '0');
const addDays = (iso: string, d: number) => new Date(Date.parse(iso + 'T12:00:00Z') + d * 864e5).toISOString().slice(0, 10);

/** The demo year and its last completed month. */
export function demoYear(year: number | undefined, today = todaySkopje()): { Y: number; M: number } {
  const ty = Number(today.slice(0, 4)), tm = Number(today.slice(5, 7));
  const Y = year ?? (tm >= 3 ? ty : ty - 1);
  const M = Y < ty ? 12 : Math.max(1, tm - 1);
  return { Y, M };
}

/** camt.053 with one statement per date (as the e-banking export). */
function camt(firm: string, acct: string, Y: number, rows: [date: string, cd: 'CRDT' | 'DBIT', amt: number, name: string, acc: string, purpose: string][]): string {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const byDate = new Map<string, string[]>();
  for (const [dt, cd, amt, name, acc, ref] of [...rows].sort((a, b) => a[0].localeCompare(b[0]))) {
    const party = cd === 'CRDT' ? `<Dbtr><Nm>${esc(name)}</Nm></Dbtr><DbtrAcct><Id><Othr><Id>${acc}</Id></Othr></Id></DbtrAcct>` : `<Cdtr><Nm>${esc(name)}</Nm></Cdtr><CdtrAcct><Id><Othr><Id>${acc}</Id></Othr></Id></CdtrAcct>`;
    byDate.set(dt, [...(byDate.get(dt) ?? []), `<Ntry><Amt Ccy="MKD">${amt.toFixed(2)}</Amt><CdtDbtInd>${cd}</CdtDbtInd><BookgDt><Dt>${dt}</Dt></BookgDt><ValDt><Dt>${dt}</Dt></ValDt>
<NtryDtls><TxDtls><RltdPties>${party}</RltdPties><RmtInf><Ustrd>${esc(ref)}</Ustrd></RmtInf></TxDtls></NtryDtls></Ntry>`]);
  }
  let seq = 0;
  const st = [...byDate].map(([dt, e]) => `<Stmt><Id>S${++seq}</Id><ElctrncSeqNb>${seq}</ElctrncSeqNb><CreDtTm>${dt}T10:00:00</CreDtTm>
<Acct><Id><Othr><Id>${acct}</Id></Othr></Id><Ccy>MKD</Ccy><Ownr><Nm>${esc(firm)}</Nm></Ownr></Acct>${e.join('\n')}</Stmt>`);
  return `<?xml version="1.0" encoding="UTF-8"?><Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.02"><BkToCstmrStmt><GrpHdr><MsgId>1</MsgId><CreDtTm>${Y}-12-31T10:00:00</CreDtTm></GrpHdr>${st.join('\n')}</BkToCstmrStmt></Document>`;
}

type PartnerRow = [key: string, name: string, edb: string, city: string, acc: string];

/** Seed the demo firms, the demo office, demo colleagues, tasks, inbox, contracts and activity — one transaction. */
export async function seedDemo(db: Tx, opts: SeedDemoOptions): Promise<SeedDemoResult> {
  return db.transaction((tx) => seedDemoTx(tx as unknown as Tx, opts));
}

async function seedDemoTx(tx: Tx, opts: SeedDemoOptions): Promise<SeedDemoResult> {
  const { Y, M } = demoYear(opts.year);
  const adminId = opts.adminUserId;
  const [admin] = await tx.select({ id: users.id, name: users.name }).from(users).where(eq(users.id, adminId)).limit(1);
  if (!admin) throw new DemoSeedError('Демо администраторот не постои.');
  if ((await demoFirmIds(tx, { all: true })).length) throw new DemoSeedError('Демо фирмите веќе постојат – прво избришете ги (resetDemo).');
  const office: DocActor = { userId: adminId, role: 'admin' };
  const d = (m: number, day: number) => `${Y}-${pad(m)}-${pad(day)}`;
  const lastPeriodToClose = M - 1;

  const newFirm = async (v: Omit<NewFirm, 'settings'> & { settings?: Record<string, unknown> }) => {
    const [f] = await tx.insert(firms).values({ ...v, ownerId: adminId, settings: { ...(v.settings ?? {}), demo: true } }).returning();
    await audit(tx, { userId: adminId, firmId: f!.id, action: 'newFirm', entityType: 'firm', entityId: f!.id, data: { name: v.name, demo: true } });
    return f!;
  };
  const partnersOf = async (firmId: string, list: PartnerRow[]) => {
    const R = await tx.insert(partners).values(list.map(([, name, edb, city, acc], i) => ({
      firmId, code: String(i + 1), name, edb, city, country: 'MK', bankAccount: acc, vatRegistered: true, address: 'ул. Демо бр. ' + (i + 1),
    }))).returning({ id: partners.id, name: partners.name });
    return Object.fromEntries(list.map(([k, name]) => [k, R.find((r) => r.name === name)!.id])) as Record<string, string>;
  };
  const opening = (firmId: string, lines: { account: string; debit?: number; credit?: number; partnerId?: string }[]) => postJournal(tx, {
    firmId, date: d(1, 1), kind: 'open', sourceType: 'opening', sourceId: `open-${Y}`, description: `Почетна состојба ${Y}`,
    lines: lines.map((l) => ({ account: l.account, debit: l.debit ?? 0, credit: l.credit ?? 0, partnerId: l.partnerId ?? null })),
    userId: adminId, requirePartner: false, auditAction: 'saveOpen',
  });
  const cash = async (firmId: string, V: [kind: 'in' | 'out', date: string, amt: number, konto: string, note: string, partnerId?: string][]) => {
    await createDefaultRegisters(tx, { firmId, userId: adminId });
    const main = (await loadRegisters(tx, firmId)).find((r) => r.cur === 'MKD')!;
    for (const [kind, date, amt, konto, note, partnerId] of V) await saveVoucher(tx, { firmId, userId: adminId, input: { registerId: main.id, kind, date, amt, konto, note, partnerId: partnerId ?? null } });
  };
  const payroll = async (firmId: string, E: [name: string, embg: string, net: number, position: string][], months: number[]) => {
    const rows = await tx.insert(employees).values(E.map(([name, embg, net, position], i) => ({
      firmId, no: String(i + 1), name, embg, netBase: String(net), coef: '1', leaveDays: 20, start: `${Y - 2}-02-01`, bankAcc: '300000000712345', bank: 'Демо банка', position, active: true,
    }))).returning();
    for (const m of [...new Set(months)].filter((x) => x >= 1)) {
      const month = `${Y}-${pad(m)}`;
      const dr = payDraft(month, rows.map((e) => ({ id: e.id, no: e.no ?? '', name: e.name, embg: e.embg ?? '', netBase: Number(e.netBase), coef: Number(e.coef), start: e.start ?? undefined, active: e.active })));
      const emps: PayEmp[] = dr.emps.map((e) => ({ ...e, lines: e.lines!.map((l) => ({ ...l, cat: 'reg' as const })) }));
      const s = await saveRun(tx, { firmId, month, params: dr.params, emps, userId: adminId, source: 'cal' });
      await postRun(tx, { firmId, runId: s.id, userId: adminId });
    }
  };
  const bankImport = async (firmId: string, firmName: string, acct: string, rows: Parameters<typeof camt>[3]) => {
    if (!rows.length) return;
    const S = parseStatementFile(new TextEncoder().encode(camt(firmName, acct, Y, rows)), `izvodi-demo-${Y}.xml`);
    if (!S?.length) throw new DemoSeedError('Демо изводот не може да се прочита.');
    await saveImport(tx, { firmId, userId: adminId, statements: S, fileName: `izvodi-demo-${Y}.xml`, format: 'camt' });
    const P = await proposeMatches(tx, firmId, Y);
    if (P.length) await applyMatches(tx, { firmId, userId: adminId, year: Y, accept: P.map((p) => p.lineId) });
  };
  const closeVat = async (firmId: string, periods: string[]) => { for (const period of periods) await closeVatPeriod(tx, { firmId, period, userId: adminId }); };
  const months = (to: number) => Array.from({ length: Math.max(0, to) }, (_, i) => i + 1);

  /* ================= 1. ДЕМО ТРГОВИЈА ДООЕЛ — wholesale + shop, monthly VAT ================= */
  const trg = await newFirm({
    name: TRG, legalForm: 'dooel', address: 'бул. Партизански одреди 100', city: 'Скопје', activity: '47.11', edb: '4030026777001', embs: '7777001',
    vatRegistered: true, vatPeriod: 'month', phone: '02 3200 200', email: 'info@demo-trgovija.mk', settings: { nkd: '47.11', bank: '300000000777001' },
  });
  {
    const firmId = trg.id;
    const A = { firmId, userId: adminId };
    const P = await partnersOf(firmId, [
      ['dist', 'ДЕМО ДИСТРИБУЦИЈА ДОО Скопје', '4030026700011', 'Скопје', '210000000700011'],
      ['pek', 'ДЕМО ПЕКАРА ДООЕЛ Тетово', '4028026700012', 'Тетово', '380000000700012'],
      ['hig', 'ДЕМО ХИГИЕНА ДОО Куманово', '4017026700013', 'Куманово', '250000000700013'],
      ['hotel', 'ДЕМО ХОТЕЛ ДОО Охрид', '4020026700014', 'Охрид', '200000000700014'],
      ['kafe', 'ДЕМО КАФЕ БАР ДООЕЛ Скопје', '4030026700015', 'Скопје', '300000000700015'],
      ['mini', 'ДЕМО МИНИМАРКЕТ ДООЕЛ Гостивар', '4007026700016', 'Гостивар', '210000000700016'],
    ]);
    const pinfo: Record<string, [string, string]> = {
      dist: ['ДЕМО ДИСТРИБУЦИЈА ДОО Скопје', '210000000700011'], pek: ['ДЕМО ПЕКАРА ДООЕЛ Тетово', '380000000700012'], hig: ['ДЕМО ХИГИЕНА ДОО Куманово', '250000000700013'],
      hotel: ['ДЕМО ХОТЕЛ ДОО Охрид', '200000000700014'], kafe: ['ДЕМО КАФЕ БАР ДООЕЛ Скопје', '300000000700015'], mini: ['ДЕМО МИНИМАРКЕТ ДООЕЛ Гостивар', '210000000700016'],
    };
    const [shop] = await tx.insert(codes).values({ firmId, cb: 'store', code: '02', name: 'Продавница Центар' }).returning();
    const IL: [code: string, name: string, unit: string, vat: number, cost: number, sp: number, barcode: string][] = [
      ['1001', 'Кафе мелено 500 g', 'ком', 18, 260, 390, '5310000100017'],
      ['1002', 'Чоколадо млечно 100 g', 'ком', 18, 48, 79, '5310000100024'],
      ['1003', 'Детергент за перење 3 kg', 'ком', 18, 310, 489, '5310000100031'],
      ['1004', 'Шампон 400 ml', 'ком', 18, 120, 189, '5310000100048'],
      ['1005', 'Тоалетна хартија 10/1', 'пак', 18, 145, 229, '5310000100055'],
      ['2001', 'Леб бел 500 g', 'ком', 5, 28, 39, '5310000200014'],
      ['2002', 'Масло за јадење 1 l', 'ком', 5, 95, 135, '5310000200021'],
      ['2003', 'Шеќер 1 kg', 'ком', 5, 52, 75, '5310000200038'],
    ];
    const IT = await tx.insert(items).values(IL.map(([code, name, unit, vat, , sp]) => ({ firmId, code, name, unit, type: 'goods' as const, vatRate: vat, price: String(r2(sp / (1 + vat / 100))) }))).returning();
    await tx.insert(itemBarcodes).values(IL.map(([code, , , , , , bc]) => ({ firmId, itemId: IT.find((x) => x.code === code)!.id, barcode: bc, primary: true })));
    const it = (code: string) => IL.find((x) => x[0] === code)!;
    const id = (code: string) => IT.find((x) => x.code === code)!.id;

    await opening(firmId, [
      { account: '1000', debit: 1200000 }, { account: '1020', debit: 25000 }, { account: '1200', partnerId: P.hotel, debit: 64000 },
      { account: '2200', partnerId: P.dist, credit: 52000 }, { account: '9000', credit: 310000 }, { account: '950', credit: 927000 },
    ]);

    const PUR: { number: string; total: number; sup: string; date: string }[] = [];
    const purchase = async (number: string, date: string, sup: string, lines: [string, number][], wh?: string, sp = false) => {
      const g = new Map<number, number>();
      for (const [c, q] of lines) g.set(it(c)[3], (g.get(it(c)[3]) ?? 0) + q * it(c)[4]);
      const input: PurchaseInput = {
        number, date, partnerId: P[sup]!, ptype: 'stock', warehouseId: wh ?? null, costs: {},
        groups: [...g].map(([rate, base]) => ({ account: '6600', rate, base: r2(base), vat: r2(base * rate / 100) })),
        stock: lines.map(([c, q]) => ({ itemId: id(c), qty: q, price: it(c)[4], type: 'goods', ...(sp ? { sp: it(c)[5] } : {}) })) as PurchaseInput['stock'],
      };
      await savePurchase(tx, firmId, input, office);
      PUR.push({ number, sup, date, total: r2(lines.reduce((a, [c, q]) => a + q * it(c)[4] * (1 + it(c)[3] / 100), 0)) });
    };
    const pm = (f: number) => Math.max(1, Math.min(M, Math.round(M * f)));
    await purchase(`ДД-0112/${Y}`, d(1, 8), 'dist', [['1001', 720], ['1002', 2400], ['1003', 480], ['1004', 900], ['1005', 1200]]);
    await purchase(`ПЕК-019/${Y}`, d(1, 9), 'pek', [['2001', 3600], ['2002', 1800], ['2003', 2400]]);
    await purchase(`ДД-0388/${Y}`, d(pm(0.4), 14), 'dist', [['1001', 600], ['1002', 1800], ['1003', 360]]);
    await purchase(`ХИГ-201/${Y}`, d(pm(0.6), 3), 'hig', [['1004', 720], ['1005', 900]]);
    await purchase(`ДД-0711/${Y}`, d(pm(0.8), 19), 'dist', [['1001', 540], ['1002', 1500], ['2002', 1200]]);
    // retail calculation straight into the shop, then a transfer from the warehouse at retail prices
    await purchase(`ПЕК-244/${Y}`, d(M, 3), 'pek', [['2001', 1800], ['2003', 900]], shop!.id, true);
    await saveTransfer(tx, A, { date: d(M, 5), from: 'main', to: shop!.id, note: 'Полнење на продавницата', lines: ['1001', '1002', '1003', '1004', '1005', '2002'].map((c) => ({ itemId: id(c), qty: c === '1002' ? 120 : 30, sp: it(c)[5] })) });

    // sales invoices with stock lines (wholesale price = cost + 35 %), one per month
    const INV: { number: string; total: number; cust: string; date: string }[] = [];
    const carts: [string, [string, number][]][] = [
      ['hotel', [['1001', 30], ['1003', 20], ['1005', 40]]], ['kafe', [['1001', 25], ['1002', 100], ['2003', 50]]],
      ['mini', [['1002', 120], ['2001', 150], ['2002', 80], ['2003', 100]]], ['hotel', [['1004', 50], ['1005', 60], ['1003', 20]]],
      ['kafe', [['1001', 30], ['2003', 60]]], ['mini', [['1002', 150], ['2001', 200], ['2002', 90]]],
    ];
    for (const m of months(M)) {
      const [c, lines] = carts[(m - 1) % carts.length]!;
      const date = d(m, 12 + (m % 10));
      const L = lines.map(([code, q]) => ({ itemId: id(code), name: it(code)[1], unit: it(code)[2], qty: q * 3, price: r2(it(code)[4] * 1.35), rate: it(code)[3] }));
      const r = await saveInvoice(tx, firmId, { kind: 'invoice', date, partnerId: P[c]!, due: addDays(date, 30), lines: L }, office);
      INV.push({ number: r.number, cust: c, date, total: r2(L.reduce((a, l) => a + l.qty * l.price * (1 + l.rate / 100), 0)) });
    }
    // a draft (нацрт) — not booked yet
    await saveInvoice(tx, firmId, { kind: 'invoice', draft: true, date: d(M, 25), partnerId: P.kafe!, lines: [{ itemId: id('1001'), name: it('1001')[1], unit: 'ком', qty: 20, price: 325, rate: 18 }] }, office);

    // till sales in the shop and a retail sale
    for (const [day, cart] of [[6, [['1001', 3], ['1002', 10], ['2001', 25], ['2003', 8]]], [7, [['1003', 2], ['1004', 4], ['2001', 30], ['2002', 6]]]] as [number, [string, number][]][]) {
      await posSell(tx, A, { date: d(M, day), wh: shop!.id, cart: cart.map(([c, q]) => ({ itemId: id(c), qty: q, price: it(c)[5] })) as never, card: 1500 });
    }
    await saveStoreOut(tx, A, { kind: 'sale', date: d(M, 8), wh: shop!.id, note: 'Продажба на мало – ден', lines: [{ itemId: id('2003'), qty: 10, price: it('2003')[5] }, { itemId: id('1002'), qty: 15, price: it('1002')[5] }] } as never);

    await cash(firmId, [
      ['in', d(Math.min(2, M), 20), 15000, '1200', 'Наплата во готово', P.kafe],
      ['out', d(Math.min(3, M), 2), 3800, '4010', 'Канцелариски материјал'],
      ['out', d(pm(0.5), 12), 2400, '4002', 'Средства за чистење'],
      ['out', d(M, 5), 5600, '4130', 'Поправка на ладилник'],
    ]);

    // bank statements: invoice / purchase payments before the last month, matched automatically
    const rows: Parameters<typeof camt>[3] = [];
    const lastDay = d(M, 1);
    for (const p of PUR) { const dt = addDays(p.date, 20); if (dt < lastDay) rows.push([dt, 'DBIT', p.total, pinfo[p.sup]![0], pinfo[p.sup]![1], `Плаќање фактура ${p.number}`]); }
    for (const i of INV) { const dt = addDays(i.date, 25); if (dt < lastDay) rows.push([dt, 'CRDT', i.total, pinfo[i.cust]![0], pinfo[i.cust]![1], `Плаќање по фактура ${i.number}`]); }
    await bankImport(firmId, TRG, '300000000777001', rows);

    await payroll(firmId, [['Елена Стојанова', '1505992455011', 28000, 'Продавач'], ['Марко Трајковски', '2208988450012', 30000, 'Магационер'], ['Сара Ахмети', '0311995455013', 34000, 'Шеф на продавница']], [M - 1, M]);

    await tx.insert(fixedAssets).values([
      { firmId, invNo: '0001', name: 'Ладилна витрина ЛВ-2000', konto: '0121', rate: '20', cost: '185000', date: d(Math.min(3, M), 15), supplier: 'ДЕМО ДИСТРИБУЦИЈА ДОО Скопје', createdBy: adminId },
      { firmId, invNo: '0002', name: 'Доставно возило – комбе', konto: '0130', rate: '25', cost: '690000', date: d(pm(0.5), 20), supplier: 'ДЕМО ДИСТРИБУЦИЈА ДОО Скопје', createdBy: adminId },
      { firmId, invNo: '0003', name: 'Касов систем со фискален апарат', konto: '0121', rate: '25', cost: '48000', date: d(1, 10), supplier: 'ДЕМО ДИСТРИБУЦИЈА ДОО Скопје', createdBy: adminId },
    ]);

    await closeVat(firmId, months(lastPeriodToClose).map((m) => `${Y}-${pad(m)}`));
  }

  /* ================= 2. ДЕМО ПРОИЗВОДСТВО ДООЕЛ — materials, normative, work order, production invoice ================= */
  const prod = await newFirm({
    name: PROD, legalForm: 'dooel', address: 'ул. Индустриска 12', city: 'Скопје', activity: '25.11', edb: '4030026555123', embs: '7555123',
    vatRegistered: true, vatPeriod: 'month', phone: '02 3100 100', email: 'info@demo-proizvodstvo.mk', settings: { nkd: '25.11', bank: '300000000555123' },
  });
  {
    const firmId = prod.id;
    const A = { firmId, userId: adminId };
    const P = await partnersOf(firmId, [
      ['market', 'ДЕМО МАРКЕТ ПЛУС ДООЕЛ Скопје', '4030005100001', 'Скопје', '210000000000101'],
      ['trgbit', 'ДЕМО ТРГОВИЈА БИТ ДОО Битола', '4002005100002', 'Битола', '300000000000202'],
      ['metal', 'ДЕМО МЕТАЛ КОМЕРЦ ДОО Велес', '4004005100004', 'Велес', '200000000000404'],
      ['evn', 'ДЕМО ЕЛЕКТРО СНАБДУВАЊЕ АД Скопје', '4030006600006', 'Скопје', '300000000000606'],
    ]);
    const I = await tx.insert(items).values([
      { firmId, code: '100', name: 'Челичен лим 1 mm', type: 'material', unit: 'm²', vatRate: 18 },
      { firmId, code: '101', name: 'Профил 40×40', type: 'material', unit: 'm', vatRate: 18 },
      { firmId, code: '102', name: 'Завртка М8', type: 'material', unit: 'ком', vatRate: 18 },
      { firmId, code: '103', name: 'Боја прав RAL 7016', type: 'material', unit: 'kg', vatRate: 18 },
      { firmId, code: '200', name: 'Метални полици МП-200', type: 'product', unit: 'ком', vatRate: 18, price: '2600' },
      { firmId, code: '201', name: 'Метален регал по мерка', type: 'product', unit: 'm²', vatRate: 18 },
    ]).returning();
    const byCode = (c: string) => I.find((x) => x.code === c)!.id;
    const [lim, prof, scr, paint, polica, regal] = ['100', '101', '102', '103', '200', '201'].map(byCode) as [string, string, string, string, string, string];

    await opening(firmId, [
      { account: '1000', debit: 450000 }, { account: '1020', debit: 15000 }, { account: '1200', partnerId: P.market, debit: 120000 },
      { account: '3100', debit: 200000 }, { account: '2200', partnerId: P.metal, credit: 80000 }, { account: '9000', credit: 310000 }, { account: '950', credit: 395000 },
    ]);
    const matPurchase = async (number: string, date: string, mult: number) => {
      const st = [{ itemId: lim, qty: 120 * mult, price: 650, type: 'material' }, { itemId: prof, qty: 400 * mult, price: 140, type: 'material' }, { itemId: scr, qty: 3000 * mult, price: 4, type: 'material' }, { itemId: paint, qty: 80 * mult, price: 420, type: 'material' }];
      const base = st.reduce((a, x) => a + x.qty * x.price, 0);
      await savePurchase(tx, firmId, { number, date, partnerId: P.metal!, ptype: 'stock', groups: [{ account: '3100', rate: 18, base, vat: r2(base * 0.18) }], stock: st as PurchaseInput['stock'], costs: {} }, office);
    };
    await matPurchase(`М-118/${Y}`, d(1, 12), 1);
    if (M > 1) await matPurchase(`М-901/${Y}`, d(M, 1), 1);
    for (const m of months(M)) if (m % 2 === 0 || m === M) {
      await savePurchase(tx, firmId, { number: `ЕВН-${pad(m)}/${Y}`, date: d(m, 25), partnerId: P.evn!, ptype: 'cost', groups: [{ account: '4020', rate: 18, base: 24000, vat: 4320 }], costs: {} }, office);
    }
    // normative (BOM) and a work order for stock
    await saveBom(tx, A, { productId: polica, labor: 180, lines: [{ itemId: lim, qty: 1.2 }, { itemId: prof, qty: 4 }, { itemId: scr, qty: 16 }, { itemId: paint, qty: 0.6 }] });
    await runProductionOrder(tx, A, { date: d(M, 3), productId: polica, qty: 30, note: `Работен налог 012/${Y} – полици за залиха` });
    // sales of the product over the year and from the work order
    for (const m of months(M)) if (m % 3 === 1 && m < M) {
      await saveInvoice(tx, firmId, { kind: 'invoice', date: d(m, 18), partnerId: (m % 2 ? P.market : P.trgbit)!, due: d(m, 28), lines: [{ name: 'Метални полици МП-200', qty: 40, price: 2500, rate: 18, unit: 'ком' }] }, office);
    }
    await saveInvoice(tx, firmId, { kind: 'invoice', date: d(M, 10), partnerId: P.market!, due: addDays(d(M, 10), 30), lines: [{ itemId: polica, name: 'Метални полици МП-200', unit: 'ком', qty: 20, price: 2600, rate: 18 }] }, office);
    // „🏭 фактура од производство“: the main product made to measure, with its calculation
    const wo = { number: `014/${Y}`, from: d(M, 1), to: d(M, 28) };
    await saveInvoice(tx, firmId, {
      kind: 'invoice', date: d(M, 15), partnerId: P.market!, due: addDays(d(M, 15), 30),
      lines: [{ itemId: regal, name: 'МЕТАЛЕН РЕГАЛ ПО МЕРКА – магацински, антрацит, 6 × 2,5 m = 15 m²', unit: 'm²', qty: 15, price: 4200, rate: 18 }],
      data: { prod: 'Д', prodInv: '1', woNo: wo.number, woFrom: wo.from, woTo: wo.to },
      production: { mode: 'prodInv', workOrder: wo, lines: [{
        lineNo: 0, productId: regal, qty: 15, main: true, spec: { text: 'Магацински регал, антрацит', mode: 'm2', l: 6, w: 2.5 },
        materials: [{ itemId: lim, qty: 18 }, { itemId: prof, qty: 60 }, { itemId: scr, qty: 240 }, { itemId: paint, qty: 9 }],
        calc: { hours: 24, rate: 450, other: [{ label: 'Транспорт', amount: 3000 }, { label: 'Монтажа', amount: 6000 }], ovhPct: 10 },
      }] },
    } as never, office);

    await cash(firmId, [
      ['out', d(Math.min(4, M), 3), 4200, '4010', 'Канцелариски материјал'],
      ['out', d(M, 2), 6500, '4002', 'Средства за чистење'],
    ]);
    await payroll(firmId, [['Ана Петровска', '0101990455001', 32000, 'Сметководител'], ['Борис Илиевски', '0202985450002', 45000, 'Бравар']], [M]);
    await tx.insert(fixedAssets).values({ firmId, invNo: '0001', name: 'Машина за свиткување лим ХП-40', konto: '0121', rate: '20', cost: '360000', date: d(Math.min(2, M), 20), supplier: 'ДЕМО МЕТАЛ КОМЕРЦ ДОО Велес', invDoc: `М-210/${Y}`, createdBy: adminId });
    await closeVat(firmId, months(lastPeriodToClose).map((m) => `${Y}-${pad(m)}`));
  }

  /* ================= 3. ДЕМО УСЛУГИ ДООЕЛ — services, quarterly VAT ================= */
  const usl = await newFirm({
    name: USL, legalForm: 'dooel', address: 'ул. Македонија 25', city: 'Битола', activity: '69.20', edb: '4002026888002', embs: '7888002',
    vatRegistered: true, vatPeriod: 'quarter', phone: '047 220 220', email: 'kontakt@demo-uslugi.mk', settings: { nkd: '69.20', bank: '210000000888002' },
  });
  {
    const firmId = usl.id;
    const P = await partnersOf(firmId, [
      ['a', 'ДЕМО ГРАДБА ДОО Битола', '4002026800021', 'Битола', '300000000800021'],
      ['b', 'ДЕМО АВТО ДООЕЛ Прилеп', '4021026800022', 'Прилеп', '210000000800022'],
      ['c', 'ДЕМО ЗДРАВЈЕ ПЗУ Битола', '4002026800023', 'Битола', '250000000800023'],
      ['tel', 'ДЕМО ТЕЛЕКОМ АД Скопје', '4030026800024', 'Скопје', '300000000800024'],
      ['zak', 'ДЕМО ИМОТ ДООЕЛ Битола', '4002026800025', 'Битола', '200000000800025'],
    ]);
    const SV = await tx.insert(items).values([
      { firmId, code: 'U1', name: 'Сметководствени услуги – месечно', type: 'service', unit: 'мес', vatRate: 18, price: '12000' },
      { firmId, code: 'U2', name: 'Пресметка на плати', type: 'service', unit: 'мес', vatRate: 18, price: '3000' },
      { firmId, code: 'U3', name: 'Даночно советување', type: 'service', unit: 'час', vatRate: 18, price: '2500' },
    ]).returning();
    const sv = (c: string) => SV.find((x) => x.code === c)!;
    await opening(firmId, [{ account: '1000', debit: 95000 }, { account: '1020', debit: 5000 }, { account: '9000', credit: 5000 }, { account: '950', credit: 95000 }]);
    const INV: { number: string; total: number; cust: string; date: string }[] = [];
    for (const m of months(M)) {
      const date = d(m, 28);
      for (const [c, lines] of [['a', [['U1', 1], ['U2', 1]]], ['b', [['U1', 1]]], ['c', m % 3 === 0 ? [['U1', 1], ['U3', 3]] : [['U1', 1]]]] as [string, [string, number][]][]) {
        const L = lines.map(([code, q]) => ({ itemId: sv(code).id, name: sv(code).name, unit: sv(code).unit, qty: q, price: Number(sv(code).price), rate: 18 }));
        const r = await saveInvoice(tx, firmId, { kind: 'invoice', date, partnerId: P[c]!, due: addDays(date, 15), lines: L }, office);
        INV.push({ number: r.number, cust: c, date, total: r2(L.reduce((a, l) => a + l.qty * l.price * 1.18, 0)) });
      }
      await savePurchase(tx, firmId, { number: `ЗАК-${m}/${Y}`, date: d(m, 5), partnerId: P.zak!, ptype: 'cost', groups: [{ account: '4140', rate: 18, base: 15000, vat: 2700 }], costs: {} }, office);
      await savePurchase(tx, firmId, { number: `ТЕЛ-${m}/${Y}`, date: d(m, 10), partnerId: P.tel!, ptype: 'cost', groups: [{ account: '4110', rate: 18, base: 1800, vat: 324 }], costs: {} }, office);
    }
    await cash(firmId, [['out', d(Math.min(4, M), 8), 1900, '4010', 'Тонер за печатач'], ['out', d(Math.min(6, M), 18), 1200, '4110', 'Поштенски трошоци']]);
    const acc: Record<string, [string, string]> = { a: ['ДЕМО ГРАДБА ДОО Битола', '300000000800021'], b: ['ДЕМО АВТО ДООЕЛ Прилеп', '210000000800022'], c: ['ДЕМО ЗДРАВЈЕ ПЗУ Битола', '250000000800023'] };
    await bankImport(firmId, USL, '210000000888002', INV.filter((i) => addDays(i.date, 10) < d(M, 1)).map((i) => [addDays(i.date, 10), 'CRDT', i.total, acc[i.cust]![0], acc[i.cust]![1], `Плаќање по фактура ${i.number}`]));
    // ДДВ-04 for every completed quarter
    await closeVat(firmId, [1, 2, 3, 4].filter((q) => q * 3 <= M).map((q) => `${Y}-Т${q}`));
  }

  /* ================= 4. the demo office, colleagues, tasks, inbox, contracts, activity ================= */
  const off = await tx.insert(firms).values({
    name: DEMO_OFFICE_NAME, legalForm: 'dooel', address: 'ул. Демо 1', city: 'Скопје', activity: '69.20', edb: '4030026999009', embs: '7999009',
    vatRegistered: true, vatPeriod: 'quarter', ownerId: adminId, email: 'kancelarija@demo.local', phone: '02 3000 000',
    settings: { demo: true, demoOffice: true, nkd: '69.20', bank: '300000000999009', signer: 'Демо Управител' },
  }).returning();
  const officeFirmId = off[0]!.id;
  const demoFirms = [trg, prod, usl];
  const fid = (n: string) => demoFirms.find((f) => f.name === n)!.id;

  const people: [key: string, name: string, role: 'senior' | 'acc' | 'oper', fs: string[]][] = [
    ['marija', 'Марија Николовска', 'senior', [PROD, TRG]],
    ['petar', 'Петар Јовановски', 'acc', [TRG, USL]],
    ['ardita', 'Ардита Бексхети', 'oper', [PROD, USL]],
  ];
  const UID: Record<string, string> = { admin: adminId };
  const userIds: string[] = [];
  for (const [key, name, role, fs] of people) {
    let username = `demo-${key}`;
    const [taken] = await tx.select({ id: users.id }).from(users).where(sql`lower(${users.username}) = ${username}`).limit(1);
    if (taken) username = `demo-${key}-${randomBytes(3).toString('hex')}`;
    const pw = demoPassword((n) => new Uint8Array(randomBytes(n)));
    const [u] = await tx.insert(users).values({
      username, name, role, demo: true, allFirms: false, passwordHash: await hashPassword(pw), mustChangePassword: false, email: `${username}@demo.local`,
    }).returning({ id: users.id });
    await tx.insert(userFirms).values([...fs.map(fid), officeFirmId].map((firmId) => ({ userId: u!.id, firmId })));
    UID[key] = u!.id;
    userIds.push(u!.id);
  }

  const today = todaySkopje();
  const tasks: [title: string, type: string, inst: string, firm: string, who: string, dueIn: number, prio: 'high' | 'normal', st: 'assigned' | 'progress' | 'done'][] = [
    ['ДДВ-04 за претходниот месец – ДЕМО ТРГОВИЈА', 'Поднесување документ', 'УЈП', TRG, 'petar', 10, 'high', 'progress'],
    ['Плати – МПИН', 'Плаќање / уплата', 'УЈП', TRG, 'petar', 5, 'normal', 'assigned'],
    ['Попис на залиха на материјали', 'Друго', 'Друго', PROD, 'ardita', 40, 'normal', 'assigned'],
    ['Работен налог – калкулација на трошоци', 'Друго', 'Друго', PROD, 'marija', -3, 'normal', 'done'],
    ['ДДВ-04 за кварталот – ДЕМО УСЛУГИ', 'Поднесување документ', 'УЈП', USL, 'ardita', 12, 'normal', 'assigned'],
  ];
  for (const [title, type, inst, firm, who, dueIn, prio, st] of tasks) {
    let t = taskTransition({ status: 'new', hist: [] }, 'assigned', admin.name);
    if (st !== 'assigned') t = taskTransition(t, st, people.find((p) => p[0] === who)![1]);
    const [r] = await tx.insert(officeTasks).values({
      title, type, inst, firmId: fid(firm), assigneeId: UID[who]!, due: addDays(today, dueIn), prio, description: '', status: t.status, hist: t.hist, doneAt: t.doneAt ?? null, createdBy: adminId,
    }).returning({ id: officeTasks.id });
    await audit(tx, { userId: adminId, firmId: fid(firm), action: 'tNew', entityType: 'office_task', entityId: r!.id, data: { title } });
  }

  await tx.insert(inboxItems).values([
    { firmId: fid(TRG), fromOffice: false, fromName: 'Сара Ахмети', subject: 'Фактури од добавувачи', note: 'Ви ги праќам влезните фактури за овој месец.', docKind: 'in' },
    { firmId: fid(PROD), fromOffice: false, fromName: 'Демо Управител', subject: 'Извод од банка', note: 'Изводот од банка во прилог.', docKind: 'bank' },
    { firmId: fid(USL), fromOffice: true, fromUserId: UID.ardita!, fromName: 'Ардита Бексхети', subject: 'Потсетник за документи', note: 'Ве молиме доставете ги трошковните фактури до 5-ти во месецот.' },
    { firmId: fid(TRG), fromOffice: false, fromName: 'Елена Стојанова', subject: 'Боледување', note: 'Боледување од 3 дена – дознаката е во прилог.', docKind: 'other', done: true, doneBy: UID.petar!, doneAt: new Date() },
  ]);

  // accounting-service contracts (provider: the demo office), indexed on the firm like the „Договори“ screen
  for (const [i, f] of demoFirms.entries()) {
    const fee = [12000, 18000, 9000][i]!;
    const k: KdContract = {
      number: `ДЕМО-СУ-${String(i + 1).padStart(3, '0')}/${Y}`, date: `${Y - 1}-12-20`, place: 'Скопје', start: `${Y}-01-01`, dur: 'indef', end: '',
      rep: 'Демо Управител', repRole: 'Управител', feeMode: 'net', fee, empFree: 3, feeEmp: 500, feeYear: fee, feeHour: 1500, docDay: 5, payDay: 10, notice: 30, note: '',
      svc: ['book', 'vat', 'pay', 'cash', 'year'], offSig: { at: `${Y - 1}-12-20T10:00`, name: DEMO_OFFICE_NAME }, cliSig: { at: `${Y - 1}-12-21T10:00`, name: f.name },
    };
    const x = kdIndex(k, 18);
    const [c] = await tx.insert(serviceContracts).values({
      firmId: f.id, number: k.number, date: k.date, start: k.start, end: null, fee: (Math.round((Number(x.kdog.gross) || 0) * 100) / 100).toFixed(2),
      status: kdStatusCode(k), data: { ...k, provider: { firmId: officeFirmId, name: DEMO_OFFICE_NAME } } as Record<string, unknown>, createdBy: adminId,
    }).returning({ id: serviceContracts.id });
    const patch = x.accFee ? { kdog: { ...x.kdog, id: c!.id }, accFee: x.accFee } : { kdog: { ...x.kdog, id: c!.id } };
    await tx.update(firms).set({ settings: sql`${firms.settings} || ${JSON.stringify(patch)}::jsonb` }).where(and(eq(firms.id, f.id), sql`${firms.settings} ->> 'demo' = 'true'`));
  }

  // activity history (Дневник на активности → Продуктивност): the last 30 days, working days
  const acts = ['saveInv', 'saveJ', 'bankKonto', 'savePurchase', 'importBank', 'postInvoice', 'blgSave', 'savePay2'];
  const rows: (typeof auditLog.$inferInsert)[] = [];
  let seed = 7;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const start = Date.parse(addDays(today, -30) + 'T00:00:00+02:00');
  for (let t = start; t <= Date.parse(today + 'T00:00:00+02:00'); t += 864e5) {
    const wd = new Date(t + 12 * 3600_000).getUTCDay();
    if (wd === 6 || wd === 0) continue;
    for (const [who, n, fs] of [['marija', 12, [PROD, TRG]], ['petar', 16, [TRG, USL]], ['ardita', 9, [PROD, USL]], ['admin', 3, [PROD, TRG, USL]]] as const) {
      const k = Math.round(n * (0.6 + rnd() * 0.8));
      for (let i = 0; i < k; i++) {
        const at = new Date(t + (8 * 60 + Math.floor(rnd() * 480)) * 60_000);
        if (at.getTime() > Date.now()) continue;
        rows.push({ at, userId: UID[who]!, firmId: fid(fs[Math.floor(rnd() * fs.length)]!), action: acts[Math.floor(rnd() * acts.length)]!, entityType: 'demo', entityId: null, data: { demo: true } });
      }
    }
  }
  for (let i = 0; i < rows.length; i += 500) await tx.insert(auditLog).values(rows.slice(i, i + 500));

  return { firmIds: demoFirms.map((f) => f.id), officeFirmId, userIds };
}
