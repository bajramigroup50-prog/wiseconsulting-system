// @vitest-environment happy-dom
/**
 * „Заглавие“ → „Ставки“ in the outgoing-invoice and the purchase editors (owner request): the header folds into one
 * summary line on „Понатаму“, the cursor goes to the first line field, a saved document opens folded and a missing
 * partner / supplier blocks the step. The saved payload is the same as before (one save at the end).
 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { blankLine, newInvoice, newPurchase, type EdInvoice, type EdPurchase } from './model';
import { buyerHint, headerMissing, headerSummary, purchaseHeaderMissing, purchaseSummary } from './invoice-steps';

vi.mock('next/link', () => ({ default: ({ href, children, ...r }: { href: string; children?: React.ReactNode }) => createElement('a', { href, ...r }, children) }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: () => {}, refresh: () => {} }) }));
vi.mock('@/app/(app)/izlez/actions', () => ({ saveInvoiceAction: async () => ({}), createInvoiceNalogAction: async () => ({}), createProductAction: async () => ({}), setSvcOnlyAction: async () => ({}) }));
vi.mock('@/app/(app)/_fx/actions', () => ({ fxDefaultRate: async () => ({ rate: 0, src: '' }) }));
vi.mock('@/app/(app)/vlez/actions', () => ({ addSupplierAction: async () => ({}), createItemsAction: async () => ({}), deletePurchaseAction: async () => ({}), purchaseDeletePreviewAction: async () => ({}), saveMarginDefaults: async () => ({}), savePurchaseAction: async () => ({}) }));
vi.mock('@/app/(app)/skan/actions', () => ({ scanStatus: async () => [], scanTaken: async () => {}, startScans: async () => ({}) }));
vi.mock('@/app/(app)/_ai/actions', () => ({ startAiRead: async () => ({}), aiReadStatus: async () => [] }));
vi.mock('@/lib/upload', () => ({ uploadFile: async () => ({ ok: false, error: 'x' }) }));

let InvoiceEditor: typeof import('./invoice-editor').InvoiceEditor;
let PurchaseEditor: typeof import('./purchase-editor').PurchaseEditor;
beforeAll(async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  InvoiceEditor = (await import('./invoice-editor')).InvoiceEditor;
  PurchaseEditor = (await import('./purchase-editor')).PurchaseEditor;
});

let root: Root | null = null, box: HTMLDivElement | null = null;
afterEach(() => { act(() => root?.unmount()); box?.remove(); root = null; box = null; });
const mount = (el: React.ReactElement) => {
  box = document.createElement('div');
  document.body.appendChild(box);
  root = createRoot(box);
  act(() => root!.render(el));
  return box;
};
const $ = <T extends Element = HTMLElement>(sel: string) => box!.querySelector<T>(sel);
const click = (el: Element | null) => act(() => { (el as HTMLElement).click(); });
/** Set a React-controlled field like the user does (native setter + input / change event). */
const type = (el: HTMLInputElement | HTMLSelectElement | null, v: string) => act(() => {
  const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, v);
  el!.dispatchEvent(new Event(el instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
});
const key = (el: Element | null, k: string) => act(() => { el!.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true })); });
const payload = () => JSON.parse($<HTMLInputElement>('input[name="payload"]')!.value) as Record<string, unknown> & { lines: { name: string; qty: string; price: string }[] };
const headerHidden = () => $('[data-testid="header-step"]')!.hidden;

const PARTNERS = [{ id: 'p1', code: '01', name: 'КОМИТЕНТ ДООЕЛ', edb: '4030000000001', address: 'Ул. 1', city: 'Скопје' }, { id: 'p2', code: '02', name: 'Нов Купувач ДОО', edb: null, address: null, city: null }];
const invProps = (initial: EdInvoice) => ({
  initial, title: 'Излезна фактура', partners: PARTNERS, items: [], stock: {}, locations: [], accounts: [['7600', 'Приходи']] as [string, string][], refInvoices: [], advances: [],
  revDefault: '7600', revByType: {}, advanceKonto: '2220', nonVat: false, back: '/izlez', svcOnly: true,
});
const newInv = (): EdInvoice => ({ ...newInvoice('invoice', '0042/2026', '2026-10-16', '7600'), data: { days: '15' } });
const savedInv = (): EdInvoice => ({ ...newInv(), id: '11111111-1111-1111-1111-111111111111', status: 'posted', partnerId: 'p1', due: '2026-10-31',
  lines: [{ ...blankLine('7600'), name: 'Услуга', qty: '2', price: '500' }] });

describe('outgoing invoice: header → lines', () => {
  it('pure rules: required fields, the summary line, the soft ЕДБ hint', () => {
    expect(headerMissing({ partnerId: '', date: '2026-10-16' })).toEqual(['комитент']);
    expect(headerMissing({ partnerId: 'p1', date: '' })).toEqual(['датум']);
    expect(headerSummary({ ...newInv(), partnerId: 'p1' }, 'КОМИТЕНТ ДООЕЛ')).toBe('Ф-ра 0042/2026 · 16.10.2026 · КОМИТЕНТ ДООЕЛ · валута 15 дена');
    expect(buyerHint(PARTNERS[1], true)).toEqual(['ЕДБ', 'адреса']);
    expect(buyerHint(PARTNERS[1], false)).toEqual([]);
    expect(buyerHint({ name: 'Марко Марковски', edb: null }, true)).toEqual([]);
  });

  it('a missing partner blocks „Понатаму“ with a message; the header stays open', () => {
    mount(createElement(InvoiceEditor, invProps(newInv())));
    expect(headerHidden()).toBe(false);
    click($('[data-testid="header-next"]'));
    expect($('[data-testid="header-err"]')!.textContent).toMatch(/комитент/);
    expect(headerHidden()).toBe(false);
    expect($('[data-testid="header-summary"]')).toBeNull();
  });

  it('„Понатаму“ folds the header into the summary and puts the cursor in the first line field; Enter moves on', () => {
    mount(createElement(InvoiceEditor, invProps(newInv())));
    // „Комитент“ is the first select with the partners (before „Комитент носител“)
    type([...box!.querySelectorAll<HTMLSelectElement>('[data-testid="header-step"] select')].find((s) => [...s.options].some((o) => o.value === 'p1'))!, 'p1');
    // Enter in a header field = „Понатаму“ (not a form submit)
    key($('[data-testid="header-step"] input[type="date"]'), 'Enter');
    expect(headerHidden()).toBe(true);
    expect($('[data-testid="header-summary"]')!.textContent).toContain('Ф-ра 0042/2026 · 16.10.2026 · КОМИТЕНТ ДООЕЛ · валута 15 дена');
    const name0 = $<HTMLInputElement>('[data-row="0"] [data-f="name"]');
    expect(document.activeElement).toBe(name0);
    type(name0, 'Сметководствени услуги');
    key(name0, 'Enter');
    expect(document.activeElement).toBe($('[data-row="0"] [data-f="qty"]'));
    type($('[data-row="0"] [data-f="qty"]'), '3');
    key($('[data-row="0"] [data-f="qty"]'), 'Enter');
    expect(document.activeElement).toBe($('[data-row="0"] [data-f="price"]'));
    type($('[data-row="0"] [data-f="price"]'), '1000');
    key($('[data-row="0"] [data-f="price"]'), 'Enter');
    // the row is kept and the cursor is in the next (new, empty) row
    expect(document.activeElement).toBe($('[data-row="1"] [data-f="name"]'));
    // ✎ opens the header again
    click($('[data-testid="header-edit"]'));
    expect(headerHidden()).toBe(false);
    // one save at the end: the payload carries the header and only the typed line (empty rows are dropped)
    const P = payload();
    expect(P.partnerId).toBe('p1');
    expect(P.lines.map((l) => [l.name, l.qty, l.price])).toEqual([['Сметководствени услуги', '3', '1000']]);
  });

  it('an existing invoice opens folded with the lines visible, and saves the same payload as before', () => {
    mount(createElement(InvoiceEditor, invProps(savedInv())));
    expect(headerHidden()).toBe(true);
    expect($('[data-testid="header-summary"]')!.textContent).toContain('КОМИТЕНТ ДООЕЛ');
    expect($<HTMLInputElement>('[data-row="0"] [data-f="name"]')!.value).toBe('Услуга');
    const before = payload();
    click($('[data-testid="header-edit"]'));
    click($('[data-testid="header-next"]'));
    expect(headerHidden()).toBe(true);
    expect(document.activeElement).toBe($('[data-row="1"] [data-f="name"]'));
    expect(payload()).toEqual(before);
  });

  it('a draft just created from its header opens folded with the cursor in the first line', () => {
    mount(createElement(InvoiceEditor, { ...invProps({ ...savedInv(), status: 'draft', number: '', lines: [] }), drafted: '' }));
    expect(headerHidden()).toBe(true);
    expect(document.activeElement).toBe($('[data-row="0"] [data-f="name"]'));
  });

  it('a legal-entity buyer without ЕДБ / address gets only a soft hint', () => {
    mount(createElement(InvoiceEditor, invProps({ ...savedInv(), partnerId: 'p2' })));
    expect($('[data-testid="edb-hint"]')!.textContent).toContain('За правно лице ДДВ обврзник е потребен ЕДБ на купувачот (чл. 53 ЗДДВ)');
    expect(($('button.btn.pri:not([type="button"])') as HTMLButtonElement).disabled).toBe(false);
  });
});

const purProps = (initial: EdPurchase) => ({
  initial, title: 'Влезна фактура', partners: [{ id: 's1', code: '1', name: 'ДОБАВУВАЧ ДОО', edb: '4030000000002' }], items: [], locations: [],
  accounts: [['4000', 'Трошоци'], ['6600', 'Стоки']] as [string, string][], nonVat: false, defMargin: 20, mgRound: 1, back: '/vlez', files: [],
});
const newPur = (): EdPurchase => ({ ...newPurchase('2026-10-16', false, { supplierFx: '2210', stock: '6600', purDefault: '4000' }), number: 'Ф-77' });

describe('incoming invoice: header → lines', () => {
  it('pure rules', () => {
    expect(purchaseHeaderMissing({ partnerId: '', supplierName: ' ', date: '2026-10-16' })).toEqual(['добавувач']);
    expect(purchaseHeaderMissing({ partnerId: '', supplierName: 'Нов доб.', date: '2026-10-16' })).toEqual([]);
    expect(purchaseSummary({ ...newPur(), partnerId: 's1', data: { days: '30' } }, 'ДОБАВУВАЧ ДОО')).toBe('Влезна ф-ра Ф-77 · прием 16.10.2026 · ДОБАВУВАЧ ДОО · валута 30 дена · жиро сметка');
  });

  it('a missing supplier blocks „Понатаму“', () => {
    mount(createElement(PurchaseEditor, purProps(newPur())));
    click($('[data-testid="header-next"]'));
    expect($('[data-testid="header-err"]')!.textContent).toMatch(/добавувач/);
    expect(headerHidden()).toBe(false);
  });

  it('„Понатаму“ folds the header and focuses the first posting amount; Enter in a header field does the same', () => {
    mount(createElement(PurchaseEditor, purProps(newPur())));
    const sup = [...box!.querySelectorAll<HTMLSelectElement>('[data-testid="header-step"] select')].find((s) => [...s.options].some((o) => o.value === 's1'))!;
    type(sup, 's1');
    key($('[data-testid="header-step"] input[type="date"]'), 'Enter');
    expect(headerHidden()).toBe(true);
    expect($('[data-testid="header-summary"]')!.textContent).toContain('Влезна ф-ра Ф-77 · прием 16.10.2026 · ДОБАВУВАЧ ДОО');
    expect(document.activeElement).toBe($('[data-grow="0"] [data-f="base"]'));
    const before = payload();
    click($('[data-testid="header-edit"]'));
    expect(headerHidden()).toBe(false);
    expect(payload()).toEqual(before);
  });

  it('a stock receipt focuses the first empty article row', () => {
    mount(createElement(PurchaseEditor, purProps({ ...newPur(), partnerId: 's1', ptype: 'stock', stock: [{ itemId: '', name: '', code: '', barcode: '', unit: 'ком', qty: '1', price: '', rab: '', amount: '', cn: '', dep: '', sp: '', type: 'goods', rate: '18' }] })));
    click($('[data-testid="header-next"]'));
    expect(document.activeElement).toBe($('[data-srow="0"] [data-f="item"]'));
  });

  it('an existing purchase opens folded with the lines visible', () => {
    mount(createElement(PurchaseEditor, purProps({ ...newPur(), id: '22222222-2222-2222-2222-222222222222', partnerId: 's1', groups: [{ account: '4000', rate: '18', base: '1000', vat: '180' }] })));
    expect(headerHidden()).toBe(true);
    expect($('[data-testid="header-summary"]')!.textContent).toContain('ДОБАВУВАЧ ДОО');
    expect($<HTMLInputElement>('[data-grow="0"] [data-f="base"]')!.value).toBe('1000');
  });
});
