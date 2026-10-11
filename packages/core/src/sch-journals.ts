/**
 * Legacy `schEx` 5180–5205 „Шеми како налози“: every posting scheme shown as an example journal (konto, side, Д / П
 * of a sample amount) so the konto is corrected directly in the journal. `CARDS` = legacy `T(…)` calls in order;
 * `key` rows edit the scheme value (the same konto changes everywhere), `k` rows are fixed kontos of the example.
 */
export type JRow = { key?: string; k?: string; d: number | string; p: number | string; opt?: boolean };
export type JCard = { id: string; title: string; rows: JRow[]; wide?: boolean };

/** Legacy `OPT`: rows that may be removed with ✕ („-“ = not used). */
export const J_OPT = new Set(['revGoods_18', 'revGoods_10', 'revGoods_5', 'revService_18', 'revService_10', 'revService_5', 'revRetail_18', 'revRetail_10', 'revRetail_5', 'pay_via', 'pay_eTax', 'pay_ePio', 'pay_eZdr', 'pay_eDop', 'pay_eVrab', 'pay_pio', 'pay_zdr', 'pay_vrab', 'pay_dop', 'pay_tax', 'vatNoDed', 'revGoods0', 'revService0', 'revProduct0']);

/** Legacy `SCH_LBL`: what a removed row means. */
export const J_LBL: Readonly<Record<string, string>> = {
  pay_via: 'Преодно конто за бруто плата (директно Д трошок / П обврски)', pay_pio: 'Обврска ПИО (оди на збирното конто)', pay_zdr: 'Обврска здравство (оди на збирното конто)', pay_vrab: 'Обврска невработеност (оди на збирното конто)', pay_dop: 'Обврска дополнителен придонес (оди на збирното конто)', pay_tax: 'Обврска персонален данок (оди на збирното конто)', pay_eTax: 'Трошок – персонален данок (се книжи заедно со 4200)', pay_ePio: 'Трошок – ПИО (се книжи заедно со 4200)', pay_eZdr: 'Трошок – здравство (заедно со 4200)', pay_eDop: 'Трошок – дополнителен придонес (заедно со 4200)', pay_eVrab: 'Трошок – невработеност (заедно со 4200)', vatNoDed: 'Посебно конто за неодбитлив ДДВ (ДДВ влегува во набавната вредност)', revGoods0: 'Посебно конто за приход без ДДВ (се користи истото како со ДДВ)', revService0: 'Посебно конто за услуги без ДДВ', revProduct0: 'Посебно конто за производи без ДДВ',
};

/** Default card titles (legacy `T` first argument; `names` overrides them). */
export const J_TITLES: Readonly<Record<string, string>> = {
  pur: 'Влезна фактура 1.000 + ДДВ 5% (магацин)', purR: 'Влезна фактура во продавница', imp: 'Увозна фактура 1.000 + ДДВ 18% (царина)', fisk: 'Фискална сметка во готово 118 (18%)',
  inv: 'Излезна фактура 1.000 + ДДВ 18% (стоки)', invS: 'Излезна фактура 1.000 + ДДВ 18% (услуги)', cogs: 'Раздолжување на продадена стока', kasa: 'Дневен промет од каса 1.180 (18%)',
  adv: 'Примен аванс 1.180', noVat: 'Влезна фактура – фирма БЕЗ ДДВ (1.000 + 50)', inv0: 'Излезна фактура 1.000 без ДДВ / ослободена', art32: 'Фактура по член 32-а (1.000)', pay: 'Плата',
  izvPay: 'Извод – исплата на плата и придонеси (истите конта, спротивна страна)', izvSup: 'Извод – плаќање на добавувач / наплата од купувач',
};

const PAYC = ['pay_pio', 'pay_zdr', 'pay_vrab', 'pay_dop', 'pay_tax'];

/** The example journals for the current scheme values (`v(key)`), legacy order. */
export function journalCards(v: (key: string) => string, flag: (key: string) => boolean, bank = '1000'): JCard[] {
  const e = (key: string, d: number | string, p: number | string): JRow => ({ key, d, p, opt: J_OPT.has(key) });
  const r = (k: string, d: number | string, p: number | string): JRow => ({ k, d, p });
  const RV = (b: string) => ((v(b + '_18') || '-') !== '-' ? e(b + '_18', 0, 1000) : e(b, 0, 1000));
  const ro = flag('retailMethod');
  const anyOff = PAYC.some((k) => v(k) === '-');
  const C: [string, JRow[], string?][] = [
    ['pur', [e('stock', 1000, 0), e('VI5', 50, 0), e('supplier', 0, 1050)]],
    ['purR', ro ? [e('retailStock', 1365, 0), e('VI5', 50, 0), e('supplier', 0, 1050), e('retailMarg', 0, 300), e('retailVat', 0, 65)] : [e('stock', 1000, 0), e('VI5', 50, 0), e('supplier', 0, 1050)], ro ? 'Влезна фактура во продавница (МПЦ 1.365 со ДДВ 5%)' : undefined],
    ['imp', [e('stock', 1000, 0), e('VM18', 180, 0), e('supplierFx', 0, 1180)]],
    ['fisk', [r('4000', 100, 0), e('VI18', 18, 0), e('cash', 0, 118)]],
    ['inv', [e('customer', 1180, 0), RV('revGoods'), e('VO18', 0, 180)]],
    ['invS', [e('customer', 1180, 0), RV('revService'), e('VO18', 0, 180)]],
    ['cogs', [e('cogs', 700, 0), e('stock', 0, 700)]],
    ['kasa', [e('kasaCash', 1180, 0), RV('revRetail'), e('VO18', 0, 180)]],
    ['adv', [r(bank, 1180, 0), e('advance', 0, 1000), e('VO18', 0, 180)]],
    ['noVat', [e('stock', v('vatNoDed') === '-' ? 1050 : 1000, 0), e('vatNoDed', 50, 0), e('supplier', 0, 1050)]],
    ['inv0', [e('customer', 1000, 0), e('revGoods0', 0, 1000)]],
    ['art32', [e('stock', 1000, 0), e('r32in', 180, 0), e('r32out', 0, 180), e('supplier', 0, 1000)]],
    ['pay', [e('pay_gross', 'бруто', 0), e('pay_via', 0, 'бруто'), ...(v('pay_via') !== '-' ? [r(v('pay_via'), 'бруто (распоред)', 0)] : []), e('pay_net', 0, 'нето'), e('pay_pio', 0, 'ПИО'), e('pay_zdr', 0, 'здравство'), e('pay_vrab', 0, 'невработеност'), e('pay_dop', 0, 'дополнително'), e('pay_tax', 0, 'данок'), ...(anyOff ? [e('pay_contrib', 0, 'отстранетите заедно')] : [])]],
    ['izvPay', [e('pay_net', 'нето', 0), e('pay_pio', 'ПИО', 0), e('pay_zdr', 'здравство', 0), e('pay_vrab', 'невработеност', 0), e('pay_dop', 'дополнително', 0), e('pay_tax', 'данок', 0), ...(anyOff ? [e('pay_contrib', 'отстранетите заедно', 0)] : []), r(bank, 0, 'вкупно платено')]],
    ['izvSup', [e('supplier', 1050, 0), r(bank, 0, 1050), r(bank, 1180, 0), e('customer', 0, 1180)]],
  ];
  return C.map(([id, rows, t]) => ({ id, title: t ?? J_TITLES[id]!, rows, ...(id === 'izvPay' ? { wide: true } : {}) }));
}

/**
 * Legacy footer of a journal card: numeric rows → „изедначен“ / „не е изедначен“ with the totals; rows with text
 * amounts (payroll) → only „Налогот мора да има и Д и П страна“ when one side is missing. Removed („-“) rows don't count.
 */
export function journalBalance(rows: readonly { d: number | string; p: number | string }[]): { nums: boolean; ok: boolean; d: number; p: number } {
  const nums = rows.every((x) => typeof x.d !== 'string' && typeof x.p !== 'string');
  if (!nums) return { nums, ok: rows.some((x) => x.d) && rows.some((x) => x.p), d: 0, p: 0 };
  const d = rows.reduce((a, x) => a + (Number(x.d) || 0), 0), p = rows.reduce((a, x) => a + (Number(x.p) || 0), 0);
  return { nums, ok: Math.abs(d - p) < 0.01, d, p };
}

/** Form field name of a scheme key (VAT kontos `VI18` / `VM18` / `VO18` keep their name, the rest `s_<key>`). */
export const jField = (key: string) => (/^V[IMO]\d+$/.test(key) ? key : 's_' + key);
