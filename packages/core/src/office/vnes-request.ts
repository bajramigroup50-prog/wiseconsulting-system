/**
 * „📨 Побарај од клиентот“ — the message to the client of what is missing for the year, from „Преглед на внес по
 * месеци“ (`@wise/db` `entryOverview`): bank statements per account and month, months without outgoing / incoming
 * invoices, and (for information) the documents received that are still in processing. The same text is offered on
 * /vnes (Gmail / WhatsApp / copy) and proposed by the autopilot under „Пораки до клиенти“ (type `vnes`).
 */

export interface VnesScans { ready: number; check: number; held: number }
export interface VnesMonth {
  m: number;
  sales: { n: number };
  purchases: { n: number };
  imported: { outVat: number; inVat: number };
  bank: Record<string, number>;
  scanSales: VnesScans; scanPurchases: VnesScans;
}
export interface VnesInput {
  firmName: string;
  officeName?: string | null;
  year: number;
  /** YYYY-MM-DD */
  today: string;
  accounts: { id: string; name: string }[];
  months: VnesMonth[];
}
export interface VnesRequest {
  subject: string;
  body: string;
  /** The requested items, one line each (empty = nothing to ask). */
  items: string[];
  /** Received documents still in processing (information, not a request). */
  inWork: number;
}

export const MONTHS_MK = ['јануари', 'февруари', 'март', 'април', 'мај', 'јуни', 'јули', 'август', 'септември', 'октомври', 'ноември', 'декември'];

/** „јули, август и септември“ */
const monthList = (ms: number[]) => {
  const n = ms.map((m) => MONTHS_MK[m - 1]!);
  return n.length > 1 ? `${n.slice(0, -1).join(', ')} и ${n[n.length - 1]}` : n[0] ?? '';
};

export function vnesRequest(I: VnesInput): VnesRequest {
  const ty = Number(I.today.slice(0, 4)), tm = Number(I.today.slice(5, 7));
  // a month is over when it ended before today's month (a past year: every month)
  const over = (m: number) => I.year < ty || (I.year === ty && m < tm);
  const M = I.months.filter((x) => over(x.m));
  const items: string[] = [];

  // bank: every account that has statements this year, the months over without one (after its first statement)
  for (const a of I.accounts) {
    const first = Math.min(...I.months.filter((x) => x.bank[a.id]).map((x) => x.m));
    if (!Number.isFinite(first)) continue;
    const miss = M.filter((x) => x.m > first && !x.bank[a.id]).map((x) => x.m);
    if (miss.length) items.push(`Изводи од ${a.name} за ${monthList(miss)}`);
  }
  // invoices: months over without any, when other months of the year have some
  const sales = (x: VnesMonth) => x.sales.n > 0 || x.imported.outVat > 0;
  const purch = (x: VnesMonth) => x.purchases.n > 0 || x.imported.inVat > 0;
  if (I.months.some(sales)) {
    const miss = M.filter((x) => !sales(x)).map((x) => x.m);
    if (miss.length) items.push(`Излезни фактури за ${monthList(miss)} (немаме ниту една – ако немало промет, потврдете ни)`);
  }
  if (I.months.some(purch)) {
    const miss = M.filter((x) => !purch(x)).map((x) => x.m);
    if (miss.length) items.push(`Влезни фактури (набавки, трошоци, комунални) за ${monthList(miss)}`);
  }
  const inWork = I.months.reduce((s, x) => s + x.scanSales.ready + x.scanSales.check + x.scanSales.held + x.scanPurchases.ready + x.scanPurchases.check + x.scanPurchases.held, 0);

  const subject = `Документи што недостасуваат – ${I.firmName} (${I.year})`;
  const body = items.length
    ? `Почитувани,\n\nЗа книговодството на ${I.firmName} за ${I.year} година ни недостасува:\n\n${items.map((x, i) => `${i + 1}. ${x}`).join('\n')}\n\n`
      + `Ве молиме испратете ги (слика или PDF – преку порталот, е-пошта или WhatsApp). Без нив изводите, ДДВ и трошоците не можат правилно да се книжат.`
      + (inWork ? `\n\nЗа ваша информација: ${inWork} примени документи се во обработка кај нас.` : '')
      + `\n\nСо почит,\n${I.officeName || 'Канцеларија'}`
    : '';
  return { subject, body, items, inWork };
}

/** Key of the proposed message: once per firm and month, a new one when the list changes. */
export const vnesMessageKey = (firmId: string, today: string, items: readonly string[]) => {
  let h = 0;
  for (const c of items.join('\n')) h = (h * 31 + c.charCodeAt(0)) | 0;
  return `vnes|${firmId}|${today.slice(0, 7)}|${(h >>> 0).toString(36)}`;
};
