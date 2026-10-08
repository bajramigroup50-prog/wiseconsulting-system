/** Shared fixtures for the stock golden tests (legacy document shapes). */
import type { StockContext } from '../../../src/stock';
import { toPortLocations, toPortMoves, type LegacyFixture } from './legacy';

export const ITEMS = [
  { id: 'A', name: 'Кафе 200г', code: '001', unit: 'ком', type: 'goods', price: 100, rate: 18, cost: 50 },
  { id: 'B', name: 'Ориз', code: '002', unit: 'кг', type: 'goods', price: 40, rate: 5 },
  { id: 'C', name: 'Сок 1л', code: '003', unit: 'ком', type: 'goods', price: 60, rate: 10, sp: { s1: 75 } },
  { id: 'M', name: 'Брашно', code: '100', unit: 'кг', type: 'material', price: 0, rate: 5 },
  { id: 'P', name: 'Леб', code: '200', unit: 'ком', type: 'product', price: 30, rate: 5 },
  { id: 'R', name: 'Амбалажа', code: '300', unit: 'ком', type: 'material', price: 10, rate: 18, rawK: '3110', costPrice: 2.35 },
  { id: 'SV', name: 'Услуга', type: 'service', price: 500, rate: 18 },
];

export const CODES = [
  { id: 's1', cb: 'store', code: '02', name: 'Продавница 1' },
  { id: 'w2', cb: 'warehouse', code: '03', name: 'Магацин 2' },
  { id: 's2', cb: 'store', code: '04', name: 'Продавница 2', konto: '6631', kMarg: '6695', kVat: '6641' },
];

/** Receipts and issues across three locations, several dates, one transfer, fractional quantities. */
export const MOVES = [
  { id: 'pur-1-0-A', date: '2026-01-05', item: 'A', qty: 10, value: 600, type: 'in', src: 'pur-1', wh: 'main', lines: [] },
  { id: 'pur-2-0-A', date: '2026-01-10', item: 'A', qty: 5, value: 330, type: 'in', src: 'pur-2', wh: 'main', lines: [] },
  {
    id: 'inv-1-0-A-sale', date: '2026-01-12', item: 'A', qty: -3, value: -186, type: 'sale', src: 'inv-1-0', wh: 'main',
    lines: [{ k: '7010', d: 186, p: 0 }, { k: '6600', d: 0, p: 186 }],
  },
  { id: 'pur-3-0-A', date: '2026-01-08', item: 'A', qty: 4, value: 260, type: 'in', src: 'pur-3', wh: 'w2', lines: [] },
  { id: 'prn-1-A-transfer', date: '2026-02-01', item: 'A', qty: -2, value: -124, type: 'transfer', src: 'prn-1', wh: 'main', lines: [] },
  { id: 'prn-1-A-in', date: '2026-02-01', item: 'A', qty: 2, value: 124, type: 'transfer-in', src: 'prn-1', wh: 's1', lines: [] },
  { id: 'pur-1-1-B', date: '2026-01-03', item: 'B', qty: 12.5, value: 437.5, type: 'in', src: 'pur-1', wh: 'main', lines: [] },
  { id: 'pur-4-0-B', date: '2026-01-20', item: 'B', qty: 7.25, value: 290.35, type: 'in', src: 'pur-4', wh: 'main', lines: [] },
  {
    id: 'inv-2-0-B-sale', date: '2026-01-21', item: 'B', qty: -3.333, value: -121, type: 'sale', src: 'inv-2-0', wh: 'main',
    lines: [{ k: '7010', d: 121, p: 0 }, { k: '6600', d: 0, p: 121 }],
  },
  { id: 'pur-5-0-C', date: '2026-01-15', item: 'C', qty: 24, value: 1080, type: 'in', src: 'pur-5', wh: 's1', lines: [] },
  { id: 'pur-6-0-C', date: '2026-01-16', item: 'C', qty: 6, value: 300, type: 'in', src: 'pur-6', wh: 's2', lines: [] },
  { id: 'pur-1-2-M', date: '2026-01-02', item: 'M', qty: 50, value: 1250, type: 'in', src: 'pur-1', wh: 'main', lines: [] },
];

/** A client-submitted (pending) receipt: ignored by every computation. */
export const PEND_MOVE = { id: 'pend-1-B', date: '2026-01-04', item: 'B', qty: 100, value: 1, type: 'in', src: 'pend-1', wh: 'main', pend: true };

export function portCtx(fx: LegacyFixture): StockContext {
  return {
    moves: toPortMoves(fx.moves),
    items: fx.items ?? [],
    locations: toPortLocations(fx.codes),
    scheme: fx.firm?.sch ?? {},
    levellings: (fx.docs ?? []).filter((d) => d.type === 'nivel'),
    vatRegistered: fx.firm?.ddv ?? true,
  } as StockContext;
}
