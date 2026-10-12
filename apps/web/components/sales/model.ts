/** Editor models shared by the server pages and the client editors (plain JSON). */
import type { DocKind } from '@wise/core/sales';

export interface EdLine {
  itemId: string; code: string; name: string; unit: string; qty: string; price: string; disc: string; rate: string; account: string;
  /** „🏭 производство“ marker of a sales invoice line (editor only; sent as `production.lines`, not as a line column). */
  prod?: EdLineProd;
}
/**
 * Production of one invoice line: materials warehouse ('' = main), materials (from the normativ or picked from stock),
 * extra costs (labour, energy…), „зачувај како норматив“. `fromBom` = the materials follow the normativ × quantity.
 */
export interface EdLineProd {
  wh: string; extra: string; saveBom: boolean; materials: { itemId: string; qty: string }[]; fromBom: boolean; open: boolean;
  /**
   * Main product of a „🏭 Фактура од производство“: specification / dimensions and the full cost calculation
   * (labour hours × rate or an amount, other direct costs, overhead %) instead of the single `extra` field.
   */
  main?: boolean;
  spec?: EdSpec;
  cost?: EdCostEls;
}
export interface EdSpec { text: string; l: string; w: string; h: string; mode: '' | 'm' | 'm2' | 'm3'; pcs: string }
export interface EdCostEls { hours: string; rate: string; labour: string; other: { label: string; amount: string }[]; ovhPct: string }
export const OTHER_COSTS = ['Енергија', 'Транспорт', 'Монтажа', 'Подизведувачи'];
export const blankSpec = (): EdSpec => ({ text: '', l: '', w: '', h: '', mode: '', pcs: '' });
export const blankCostEls = (): EdCostEls => ({ hours: '', rate: '', labour: '', other: OTHER_COSTS.map((label) => ({ label, amount: '' })), ovhPct: '' });
/** A new main product line of a production invoice (name typed, product created on the fly). */
export const mainProdLine = (account: string, wh = '', rate = '18'): EdLine => ({
  ...blankLine(account, rate), prod: { wh, extra: '', saveBom: false, materials: [], fromBom: false, open: true, main: true, spec: blankSpec(), cost: blankCostEls() },
});
export interface EdInvoice {
  id: string | null; kind: DocKind; number: string; date: string; pdate: string; due: string; partnerId: string; warehouseId: string;
  art32: boolean; advance: boolean; export: boolean; svc: boolean; currency: string; fx: string;
  refInvoiceId: string; creditKind: 'price' | 'gross' | 'ret'; creditGross: string; fromDocId: string; note: string;
  data: Record<string, string>;
  lines: EdLine[];
  advances: { advanceId: string; amount: string }[];
  /** Saving a reviewed AI draft: `ai_documents` id and draft index. */
  scanDocId?: string; scanIndex?: number;
  status?: string;
}

export const blankLine = (account = '', rate = '18'): EdLine => ({ itemId: '', code: '', name: '', unit: 'ком', qty: '1', price: '', disc: '', rate, account });

export const newInvoice = (kind: DocKind, number: string, date: string, account: string): EdInvoice => ({
  id: null, kind, number, date, pdate: date, due: '', partnerId: '', warehouseId: '', art32: false, advance: false, export: false, svc: false,
  currency: 'MKD', fx: '1', refInvoiceId: '', creditKind: 'price', creditGross: '', fromDocId: '', note: '', data: {},
  lines: [blankLine(account)], advances: [],
});

export interface EdGroup { account: string; rate: string; base: string; vat: string }
export interface EdStock { itemId: string; name: string; code: string; barcode: string; unit: string; qty: string; price: string; rab: string; amount: string; cn: string; dep: string; sp: string; type: string; rate: string; isNew?: boolean }
export interface EdCost { amount: string; fx: string; doc: string; date: string; due: string; partnerId: string; byQty: boolean; foreign: boolean; lines: { base: string; rate: string; vat: string }[] }
export const COSTS: [string, string][] = [['car', 'Царина'], ['t1', 'Трошок 1'], ['t2', 'Трошок 2'], ['sped', 'Шпедиција'], ['trans', 'Транспорт'], ['dr', 'Друго'], ['dev', 'Дев. трошок']];
export const blankCost = (): EdCost => ({ amount: '', fx: '', doc: '', date: '', due: '', partnerId: '', byQty: false, foreign: false, lines: [0, 1, 2].map(() => ({ base: '', rate: '18', vat: '' })) });

export interface EdPurchase {
  id: string | null; number: string; date: string; docDate: string; due: string; partnerId: string; supplierName: string; supplierEdb: string;
  ptype: 'stock' | 'cost'; art32: boolean; imp: boolean; cash: boolean; noDed: boolean; warehouseId: string; supplierAccount: string;
  currency: string; fx: string; calcNo: string; distMode: 'val' | 'cn' | 'multi'; cnames: string[];
  groups: EdGroup[]; stock: EdStock[]; costs: Record<string, EdCost>;
  data: Record<string, string>;
  fileIds: string[]; scanned: boolean; shifted: boolean; credit?: boolean;
  scanDocId?: string; scanIndex?: number; status?: string;
}

/**
 * New purchase (legacy `newPur` 7154 / `newPurImp` 7184).
 * FIX (LEGACY-MAP 3.4 item 3): the import supplier konto and the import group konto come from the posting scheme
 * (`supplierFx`, `stock`) instead of the literals '2210' / '6600'.
 */
export const newPurchase = (date: string, imp: boolean, acc: { supplierFx: string; stock: string; purDefault: string }, eurRate = ''): EdPurchase => ({
  id: null, number: '', date, docDate: '', due: '', partnerId: '', supplierName: '', supplierEdb: '', ptype: imp ? 'stock' : 'cost', art32: false, imp,
  cash: false, noDed: false, warehouseId: '', supplierAccount: imp ? acc.supplierFx : '', currency: imp ? 'EUR' : 'MKD', fx: imp ? eurRate : '1', calcNo: '',
  distMode: 'val', cnames: [], groups: [{ account: imp ? acc.stock : acc.purDefault, rate: imp ? '0' : '18', base: '', vat: '' }], stock: [],
  costs: Object.fromEntries(COSTS.map(([k]) => [k, blankCost()])), data: {}, fileIds: [], scanned: false, shifted: false,
});

export const s = (v: unknown) => (v == null ? '' : String(v));
