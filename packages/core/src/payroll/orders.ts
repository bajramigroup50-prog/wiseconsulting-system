/**
 * Payment orders for a payroll run (legacy ACT `payOrders` 7795 + `ppNew`/`PP_LAY` field names 15767):
 * one ПП30 per employee for the net pay, one ПП50 per contribution fund and the personal income tax.
 *
 * DELIBERATE FIX (LEGACY-MAP 6.4 #19): legacy read `firm.ppAcc` — which no screen ever wrote — so the
 * payment accounts and revenue codes were always blank, and it labelled the contribution order "ПП53".
 * Here the accounts/codes come from the firm's payroll settings (edited on the parameters screen), the
 * public-revenue orders are ПП50 (the form used for public revenues), and every missing account or code
 * is reported in `missing` instead of printing an empty order silently.
 */
import { mpinRows, type PayEmp } from './calc';
import type { PayParams } from './params';

/** Per-fund payment settings: payment account (уплатна сметка) and revenue code (приходна шифра и програма). */
export type PayFundKey = 'pio' | 'zdr' | 'dop' | 'vrab' | 'tax';
export const PAY_FUNDS: readonly (readonly [PayFundKey, string])[] = [
  ['pio', 'Придонес за пензиско и инвалидско осигурување'],
  ['zdr', 'Придонес за задолжително здравствено осигурување'],
  ['dop', 'Дополнителен придонес за здравствено осигурување'],
  ['vrab', 'Придонес за осигурување во случај на невработеност'],
  ['tax', 'Персонален данок на доход од плата'],
];

export interface PayOrderSettings {
  /** Treasury account of the budget (default NBRM 100000000063095). */
  trezor?: string;
  funds?: Partial<Record<PayFundKey, { uplSm?: string; prihod?: string }>>;
}

/** Treasury account of the Budget of North Macedonia at NBRM (legacy `ppNew('pp50')`). */
export const PP_TREZOR = '100000000063095';

export interface PayOrder {
  kind: 'pp30' | 'pp50';
  payer: string;
  payerAcc: string;
  payerBank: string;
  payerTax: string;
  place: string;
  date: string;
  valDate: string;
  purpose: string;
  amount: number;
  recip: string;
  recipAcc: string;
  recipBank: string;
  /** ПП30 payment code (101 = нето плата). */
  code?: string;
  /** 1 МИПС, 2 клиринг, 3 иста банка. */
  nacin: string;
  uplSm?: string;
  prihod?: string;
  refDebit?: string;
  refCredit?: string;
  /** Employee id (ПП30) or fund (ПП50). */
  ref: string;
}

export interface PayOrdersFirm {
  name?: string | null;
  address?: string | null;
  city?: string | null;
  edb?: string | null;
  bankAccount?: string | null;
  bankName?: string | null;
}

const dig = (v: unknown) => String(v ?? '').replace(/\D/g, '');

/** All orders of the run. `date` = payment date (default the run date). */
export function payrollPaymentOrders(
  run: { month: string; emps: readonly PayEmp[] },
  P: PayParams,
  employees: readonly { id: string; embg?: string; bankAcc?: string; bank?: string; name?: string }[],
  firm: PayOrdersFirm,
  settings: PayOrderSettings = {},
  date: string,
): { orders: PayOrder[]; missing: string[]; totals: Record<PayFundKey | 'net', number> } {
  const R = mpinRows(run.emps, P, employees);
  const mm = run.month.split('-').reverse().join('/');
  const payerAcc = dig(firm.bankAccount);
  const base = {
    payer: [firm.name, [firm.address, firm.city].filter(Boolean).join(', ')].filter(Boolean).join('\n'),
    payerAcc,
    payerBank: firm.bankName || '',
    payerTax: firm.edb || '',
    place: firm.city || '',
    date,
    valDate: date,
  };
  const missing: string[] = [];
  if (payerAcc.length !== 15) missing.push('Жиро сметка на фирмата (налогодавач)');
  const orders: PayOrder[] = [];
  R.forEach((r, i) => {
    const acc = dig(r.bankAcc);
    if (acc.length !== 15) missing.push(`Сметка за плата: ${r.name}`);
    const e = run.emps[i]!;
    orders.push({
      ...base,
      kind: 'pp30',
      purpose: `Нето плата ${mm}`,
      amount: r.net,
      recip: r.name,
      recipAcc: acc,
      recipBank: r.bank,
      code: '101',
      nacin: acc && payerAcc && acc.slice(0, 3) === payerAcc.slice(0, 3) ? '3' : '2',
      refCredit: r.embg,
      ref: e.empId,
    });
  });
  const totals = { pio: 0, zdr: 0, dop: 0, vrab: 0, tax: 0, net: 0 } as Record<PayFundKey | 'net', number>;
  for (const r of R) {
    totals.pio += r.pio;
    totals.zdr += r.zdr;
    totals.dop += r.dop;
    totals.vrab += r.vrab;
    totals.tax += r.tax;
    totals.net += r.net;
  }
  const [y, m] = run.month.split('-') as [string, string];
  const last = new Date(Date.UTC(+y, +m, 0)).getUTCDate();
  const per = `01${m}${y}-${String(last).padStart(2, '0')}${m}${y}`;
  for (const [k, name] of PAY_FUNDS) {
    if (!totals[k]) continue;
    const F = settings.funds?.[k] || {};
    if (!F.uplSm) missing.push(`Уплатна сметка: ${name}`);
    if (!F.prihod) missing.push(`Приходна шифра: ${name}`);
    orders.push({
      ...base,
      kind: 'pp50',
      purpose: `${name} за ${mm}`,
      amount: totals[k],
      recip: 'Буџет на Република Северна Македонија',
      recipAcc: dig(settings.trezor) || PP_TREZOR,
      recipBank: 'Народна банка на РСМ',
      nacin: '1',
      uplSm: F.uplSm || '',
      prihod: F.prihod || '',
      refDebit: per,
      ref: k,
    });
  }
  return { orders, missing, totals };
}
