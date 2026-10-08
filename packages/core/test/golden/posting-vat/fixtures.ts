/**
 * Shared fixtures: one legacy firm/state and its equivalent `PostingContext`.
 * Legacy documents are written in the legacy shape; small adapters turn them into the new input types.
 */
import type {
  InvoiceDoc, PostingContext, PurchaseDoc, PurchaseStockLine, StockLocation,
} from '../../../src/posting';
import type { LegacyState } from './legacy';

export const PARTNERS = [
  { id: 'POS', name: 'POS терминал (плаќања со картички)', pos: true },
  { id: 'P1', name: 'Купувач ДООЕЛ', edb: '4030000000001' },
  { id: 'P2', name: 'Добавувач ДОО', edb: '4030000000002' },
  { id: 'P3', name: 'Шпедиција ДОО', edb: '4030000000003' },
  { id: 'P4', name: 'Foreign GmbH', edb: '' },
];

export const ITEMS = [
  { id: 'I1', name: 'Стока А', type: 'goods', rate: 18, price: 100, sp: { S1: 177 } },
  { id: 'I2', name: 'Материјал Б', type: 'material', rate: 18, price: 50 },
  { id: 'I3', name: 'Стока В', type: 'goods', rate: 5, price: 80, sp: { S1: 105 } },
];

export const CODES = [
  { id: 'S1', cb: 'store', code: '02', name: 'Продавница 1' },
  { id: 'W2', cb: 'warehouse', code: '03', name: 'Магацин 2', konto: '66001' },
];
export const LOCS: Record<string, StockLocation> = {
  S1: { kind: 'store' },
  W2: { kind: 'warehouse', konto: '66001' },
};

/** Legacy firm record of the main fixture firm. */
export const FIRM = {
  name: 'Тест ДООЕЛ', ddv: true, per: 'quarter', posK: '1200001', posP: 'POS',
  banks: [{ id: 'main', name: 'Халк', konto: '1000' }, { id: 'eur', name: 'Халк EUR', konto: '1030', cur: 'EUR' }],
  blg: [{ id: '1020', name: 'Главна благајна', konto: '1020', cur: 'MKD' }, { id: '1051', name: 'Девизна', konto: '1051', cur: 'EUR' }],
};

export const legacyState = (extra: Partial<LegacyState> & { firm?: Record<string, unknown> } = {}): LegacyState => ({
  firm: { ...FIRM, ...(extra.firm ?? {}) },
  gsch: extra.gsch ?? null,
  data: { partners: PARTNERS, items: ITEMS, codes: CODES, ...(extra.data ?? {}) },
});

/** The new-code context equivalent to `legacyState(extra)`. */
export const ctxOf = (st: LegacyState): PostingContext => {
  const f = st.firm as Record<string, any>;
  const g = st.gsch as Record<string, any> | null;
  return {
    firm: {
      ddv: f.ddv, sch: f.sch, vatIn: f.vatIn, vatOut: f.vatOut, vatImp: f.vatImp, vatInKonto: f.vatInKonto, posK: f.posK,
      posPartnerId: f.posP && PARTNERS.some((p) => p.id === f.posP) ? f.posP : undefined,
    },
    global: g ? { sch: g.sch, vatIn: g.vatIn, vatOut: g.vatOut, vatImp: g.vatImp } : null,
  };
};

/** Legacy invoice (advances as `{advInvId: base}`) → new invoice (advances resolved). */
export function invOf(inv: any, all: any[] = []): InvoiceDoc {
  const { advances, ...rest } = inv;
  const out: InvoiceDoc = { ...rest };
  if (advances) {
    out.advances = Object.entries(advances as Record<string, number>).flatMap(([id, amount]) => {
      const adv = all.find((x) => x.id === id);
      return adv ? [{ amount, invoice: adv }] : [];
    });
  }
  return out;
}

/** Legacy purchase → new purchase (stock line types resolved from the items, retail margin from legacy `calcRows`). */
export function purOf(p: any, retail?: { margin: number; vat: number }): PurchaseDoc {
  const stock: PurchaseStockLine[] | undefined = p.stock?.map((s: any) => ({ ...s, type: s.type || ITEMS.find((i) => i.id === s.item)?.type || 'goods' }));
  return { ...p, ...(stock ? { stock } : {}), ...(retail ? { retail } : {}) };
}
