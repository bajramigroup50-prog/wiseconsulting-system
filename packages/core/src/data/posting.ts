/**
 * Posting-scheme reference data (legacy `index.html` 3174, 3176, 4333, 6509, 13090).
 * A scheme maps a role key ("customer", "revGoods", "vbin18d", …) to a konto. `'-'` means "off".
 */

/**
 * Default posting scheme (legacy `SCH0`, 3174 — 73 keys, values verbatim).
 * Known irregularities kept on purpose because posted history uses them (LEGACY-MAP 2.4 item 18):
 * `vbimp18p:'9990018'`, `vbimp10d/p:'99400'/'99900'`, `vbin*` = `vbout*`, `whStock:'660'`.
 */
export const SCH0 = {
  supplier: '2200', supplierFx: '2210', cash: '1020', customer: '1200', advance: '2220', stock: '6600', material: '3100', product: '6300',
  cogs: '7010', cogsP: '7000', revGoods: '7410', revService: '7400', revProduct: '7400', revRetail: '7411', ddvPay: '23008', ddvClaim: '1308',
  vbin18d: '994018', vbin18p: '999018', vbin10d: '994010', vbin10p: '999010', vbin5d: '99405', vbin5p: '99905',
  vbimp18d: '99408', vbimp18p: '9990018', vbimp10d: '99400', vbimp10p: '99900', vbimp5d: '99402', vbimp5p: '99902',
  vbout18d: '994018', vbout18p: '999018', vbout10d: '994010', vbout10p: '999010', vbout5d: '99405', vbout5p: '99905',
  revGoods_18: '741018', revGoods_10: '741010', revGoods_5: '74105', revService_18: '740018', revService_10: '740010', revService_5: '74005',
  revRetail_18: '741118', revRetail_10: '741110', revRetail_5: '74115', r32in: '1309', r32out: '2309', revGoods0: '74102', revService0: '74002',
  revProduct0: '74002', vatNoDed: '-', kasaCash: '1020', retailMethod: false, retailStock: '6630', retailMarg: '6694', retailVat: '6640',
  whSaleMethod: false, whStock: '660', whMarg: '6690', whVat: '6640', pay_gross: '4210', pay_via: '2400', pay_eTax: '-', pay_ePio: '-',
  pay_eZdr: '-', pay_eDop: '-', pay_eVrab: '-', pay_net: '2401', pay_contrib: '2349', pay_ded: '2492', pay_pio: '2341', pay_zdr: '2342',
  pay_vrab: '2344', pay_dop: '2343', pay_tax: '2340',
} as const satisfies Record<string, string | boolean>;

/**
 * Keys added by the rebuild for kontos that legacy hard-coded inside the posting functions.
 * Defaults equal the legacy literals, so default output is unchanged; firms can now override them.
 */
export const SCH_EXTRA = {
  /** Purchase group without konto (legacy `'4000'`, and `'4100'` — rail transport — for art. 32-a groups; unified, see posting.ts). */
  purDefault: '4000',
  /** Invoice / cash-sale line without konto (legacy `'7400'` literal in `calcLines`/`saleEntries`). */
  revDefault: '7400',
  /** Bank settle difference: positive FX difference (legacy literal `'7810'` in `bankEntries`). */
  fxGain: '7810',
  /** Bank settle difference: negative FX difference (legacy literal `'4810'`). */
  fxLoss: '4810',
  /** Default bank konto when the account has none (legacy `'1000'`). */
  bank: '1000',
  /** Supplier discount (credit) row without konto (legacy `'7690'` in `scrEntries` — "membership income", kept as default). */
  supDisc: '7690',
  /** Cash-in voucher counter-konto without konto (legacy `'1000'` in `blgEntries`). */
  blgInOther: '1000',
  /** Fiscal report cash konto (legacy `fkCashK` default `'1009'`). */
  fiskCash: '1009',
  /** Card receivables from the POS terminal (legacy `posKDef` default `'1200001'`; firm `posK` still wins). */
  posCard: '1200001',
  /** Fiscal "trgNoVat" scheme: margin and retail stock (legacy literals `'6690'`/`'6630'` in `fiskEntries` 13097). */
  fiskMarg: '6690',
  fiskStock: '6630',
} as const;

/**
 * Old defaults (legacy `SCH_OLD`, 3176). Legacy `sch()` treated a stored value equal to these as
 * *unset*, which made deliberate choices impossible (LEGACY-MAP 2.4 item 2). The rebuild honours
 * explicit values; use `migrateLegacyScheme` once at import time to drop stale stored defaults.
 */
export const SCH_OLD = {
  ddvPay: '2300', pay_net: '2400', pay_gross: '4200', pay_eTax: '4201', pay_ePio: '42020', pay_eZdr: '42021', pay_eDop: '42022',
  pay_eVrab: '42023', pay_pio: '2410', pay_zdr: '2411', pay_vrab: '2412', pay_dop: '2413', pay_tax: '2420', retailMarg: '6690',
  retailVat: '6691', advance: '2270',
} as const satisfies Record<string, string>;

/** Revenue keys that have per-rate sub-kontos `<key>_<rate>` (legacy `REV_RATE`, 3346). */
export const REV_RATE_KEYS = ['revGoods', 'revService', 'revProduct', 'revRetail'] as const;

/** Landed-cost slots of a purchase (legacy `COSTS`, 4333). `dev` is in foreign currency (× fx). */
export const PURCHASE_COST_SLOTS = [
  ['car', 'Царина'], ['t1', 'Трошок 1'], ['t2', 'Трошок 2'], ['sped', 'Шпедиција'], ['trans', 'Транспорт'], ['dr', 'Друго'], ['dev', 'Дев. трошок'],
] as const;

/** Fiscal-report posting schemes (legacy `FK_SC`, 13090): [label, default revenue konto]. */
export const FISCAL_SCHEMES = {
  trgNoVat: ['Трговија – фирма без ДДВ (Д 1009 / П 7410; Д 6690 / П 6630)', '7410'],
  usl: ['Само услуги, без стока (Д 1009 / П 230018 / П 7414)', '7414'],
  trg: ['Трговија – ДДВ обврзник (П 7411 + ДДВ, излез на стока)', ''],
} as const;

/** Cash-register expense categories with candidate kontos, first existing wins (legacy `BLG_CAT`, 6509). */
export const CASH_EXPENSE_CATEGORIES: Readonly<Record<string, readonly [string, readonly string[]]>> = {
  fuel: ['Гориво', ['4033', '4024', '4032', '4023', '4020', '4000']],
  toll: ['Патарина / тунел / траект', ['4406', '400004', '4490', '4400']],
  parking: ['Паркинг', ['41930', '400004', '4406']],
  accommodation: ['Ноќевање / хотел', ['44011', '4401', '44010', '440']],
  food: ['Храна / исхрана на терен', ['4410', '4441', '4440', '444']],
  vehicle: ['Сервис / делови за возило', ['4040', '404', '400004']],
  transport: ['Превоз / такси', ['44021', '4402', '4104', '44020']],
  office: ['Канцелариски материјал', ['4011', '4010', '4000']],
  post: ['Пошта / телефон', ['4110', '411']],
  other: ['Друго', ['4499', '449', '4490', '4190', '4100', '4000']],
};
