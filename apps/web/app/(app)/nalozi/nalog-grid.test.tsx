// @vitest-environment happy-dom
/**
 * The opened nalog as a grid („Содржина (книжење) на финансов налог“): keyboard (↑ ↓, Ins, Enter, F3, + / −),
 * „Промена на ставка“ through the document correction (override) and directly on a manual nalog (Д = П kept),
 * the bank konto of a statement shown as one line, „Бришење“ of a statement line, and the list keys / sort.
 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { OvRow } from '@wise/core/finpar';
import { bankLineOf, mergeBankHeads, sums } from '@/lib/nalog-grid';

const push = vi.fn();
const refresh = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, refresh, replace() {} }) }));
const ovRows: OvRow[] = [
  { i: 0, account: '1200', debit: 1180, credit: 0, partnerId: 'k', note: '', doc: '15', del: false },
  { i: 1, account: '7600', debit: 0, credit: 1000, partnerId: null, note: '', doc: '15', del: false },
  { i: 2, account: '2300', debit: 0, credit: 180, partnerId: null, note: '', doc: '15', del: false },
];
const saveOverride = vi.fn(async (_j: string, _r: unknown, _s?: boolean) => ({ ok: '1' }));
const saveJournal = vi.fn(async (_p: unknown, _f: FormData) => ({ ok: '1' }));
vi.mock('./actions', () => ({
  overrideRowsAction: async () => ({ rows: ovRows.map((r) => ({ ...r })) }),
  saveOverrideAction: (j: string, r: unknown, s?: boolean) => saveOverride(j, r, s),
  saveJournal: (p: unknown, f: FormData) => saveJournal(p, f),
  createKontoAction: async () => ({ ok: '' }),
}));
const delBank = vi.fn(async (_id: number) => ({ ok: 'Избришано.' }));
vi.mock('./statement-actions', () => ({ deleteNalogBankLineAction: (id: number) => delBank(id), massCloseAction: async () => ({ ok: '' }), massClosePreviewAction: async () => ({ n: 0, text: '' }) }));
vi.mock('@/app/(app)/banka/actions', () => ({ addManualLineAction: async () => ({ ok: '' }) }));
vi.mock('next/link', () => ({ default: ({ href, children, ...r }: { href: string; children?: React.ReactNode }) => createElement('a', { href, ...r }, children) }));

describe('manual nalog editor („+ Рачен налог“)', () => {
  it('opens with „Нова ставка“; F9 adds lines (balance shown), the empty 4400 / 1000 rows give way; Esc closes, Ins reopens', async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const { JournalEditor } = await import('./journal-editor');
    const { newJournal } = await import('./editor-model');
    mount(createElement(JournalEditor, { initial: newJournal('2026-07-10'), chart: CHART, partners: PARTNERS, numbers: [], fast: true }));
    expect($('[role=dialog]')!.getAttribute('aria-label')).toBe('Нова ставка');
    type($('input[aria-label="Конто"]'), '4400');
    type($('input[aria-label="Должи"]'), '300');
    key($('input[aria-label="Должи"]')!, 'F9');
    await flush();
    expect($('[data-testid=fe-no]')!.textContent).toBe('2');
    expect($('[data-testid=fe-saldo]')!.textContent).toContain('300,00');
    type($('input[aria-label="Конто"]'), '1000');
    type($('input[aria-label="Побарува"]'), '300');
    expect($('[data-testid=fe-saldo]')!.textContent).toContain('0,00');
    key($('input[aria-label="Побарува"]')!, 'F9');
    await flush();
    key($('input[aria-label="Конто"]')!, 'Escape');
    expect($('[role=dialog]')).toBeNull();
    const p = JSON.parse($<HTMLInputElement>('input[name="payload"]')!.value) as { rows: { account: string; debit: string; credit: string }[] };
    expect(p.rows.map((r) => [r.account, r.debit, r.credit])).toEqual([['4400', '300', ''], ['1000', '', '300']]);
    expect(box!.textContent).toContain('изедначен');
    key($('form')!, 'Insert');
    expect($('[role=dialog]')).not.toBeNull();
  });
});

let NG: typeof import('./nalog-grid');
let LK: typeof import('./list-keys');
beforeAll(async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  NG = await import('./nalog-grid');
  LK = await import('./list-keys');
});

let root: Root | null = null, box: HTMLDivElement | null = null;
afterEach(() => { act(() => root?.unmount()); box?.remove(); root = null; box = null; vi.clearAllMocks(); });
const mount = (el: React.ReactElement) => {
  box = document.createElement('div');
  document.body.appendChild(box);
  root = createRoot(box);
  act(() => root!.render(el));
  return box;
};
const $ = <T extends Element = HTMLInputElement>(sel: string) => box!.querySelector<T>(sel);
const type = (el: HTMLInputElement | null, v: string) => act(() => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, v);
  el!.dispatchEvent(new Event('input', { bubbles: true }));
});
const key = (el: Element | EventTarget, k: string) => act(() => { el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true })); });
const flush = () => act(async () => { for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0)); });

type GR = import('./nalog-grid').GridRow;
const row = (o: Partial<GR> & { key: string; account: string }): GR => ({
  ids: [Number(o.key.replace(/\D/g, '')) || 1], jid: 'j1', date: '2026-07-10', izNo: '', jdesc: 'Фактура 15', note: '', debit: 0, credit: 0, doc: '15',
  devD: 0, devP: 0, cur: '', amountCur: null, locationId: null, partnerId: '', pcode: '', pname: '', head: false, src: [{ debit: o.debit ?? 0, credit: o.credit ?? 0 }], ...o,
});
const CHART: [string, string][] = [['1200', 'Купувачи'], ['7600', 'Приходи'], ['2300', 'ДДВ'], ['4400', 'Трошоци'], ['1000', 'Жиро сметка'], ['2200', 'Добавувачи']];
const PARTNERS = [{ id: 'k', code: '0339', name: 'КОМИТЕНТ ДООЕЛ' }];
const DOC_ROWS = [
  row({ key: 'l1', account: '1200', debit: 1180, partnerId: 'k', pcode: '0339', pname: 'КОМИТЕНТ ДООЕЛ' }),
  row({ key: 'l2', account: '7600', credit: 1000 }),
  row({ key: 'l3', account: '2300', credit: 180 }),
];
const docJ = (mode: 'override' | 'manual' | 'none' = 'override') => [{ id: 'j1', mode, bank: false, number: '2/7-9', date: '2026-07-10', description: 'Фактура 15', periodFrom: '', periodTo: '', why: 'Заклучен период.' }];
const grid = (rows = DOC_ROWS, journals = docJ()) => mount(createElement(NG.NalogGrid, {
  rows, journals, firmName: 'ТЕСТ ФИРМА ДОО', no: '2/7-9', date: '2026-07-10', chart: CHART, partners: PARTNERS, canDel: true,
  printHref: '/print/nalog?n=2%2F7-9', sintHref: '/nalozi?n=2%2F7-9&sint', newHref: '/nalozi?nov&n=2%2F7-9',
}));
const selected = () => Number(box!.querySelector('tr[aria-selected="true"]')!.getAttribute('data-i'));

describe('nalog grid keyboard', () => {
  it('↑ ↓ move the selection; the header shows the konto / partner of the row; F3 opens the konto card; Ins / Enter open the dialog', () => {
    grid();
    expect(selected()).toBe(0);
    expect($('[data-testid=grid-head]')!.textContent).toContain('КОМИТЕНТ ДООЕЛ');
    key(window, 'ArrowDown');
    expect(selected()).toBe(1);
    expect($('[data-testid=grid-head]')!.textContent).toContain('7600');
    key(window, 'F3');
    expect(push).toHaveBeenCalledWith('/kkart?k=7600');
    key(window, 'ArrowUp');
    key(window, 'F3');
    expect(push).toHaveBeenLastCalledWith('/kkart?k=1200&p=k');
    key(window, 'Enter');
    expect($('[role=dialog]')!.getAttribute('aria-label')).toBe('Промена на ставка');
    expect($('input[aria-label="Конто"]')!.value).toBe('1200');
    expect($('input[aria-label="Должи"]')!.value).toBe('1180');
    expect($('input[aria-label="Содржина"]')!.value).toBe('Фактура 15');
    key($('input[aria-label="Конто"]')!, 'Escape');
    expect($('[role=dialog]')).toBeNull();
    key(window, 'Insert');
    expect($('[role=dialog]')!.getAttribute('aria-label')).toBe('Нова ставка');
  });

  it('+ / − select rows; the footer shows the selection and the nalog totals', () => {
    grid();
    key(window, '+');
    key(window, '+');
    const f = $('[data-testid=grid-foot]')!.textContent!;
    expect(f).toContain('селекција (2)');
    expect(f).toContain('1.180,00'); // selection Должи
    expect(f).toContain('1.000,00'); // selection Побарува
    expect(f).toContain('ВК. ДОЛЖИ 1.180,00');
    key(window, 'ArrowUp');
    key(window, '-');
    expect($('[data-testid=grid-foot]')!.textContent).toContain('селекција (1)');
  });
});

describe('„Промена на ставка“', () => {
  it('a document nalog is corrected through the override: konto 7600 → 4400 keeps Д = П and is saved', async () => {
    grid(DOC_ROWS, docJ('override'));
    act(() => { (box!.querySelector('tr[data-i="1"] button') as HTMLButtonElement).click(); });
    expect($('[role=dialog]')).not.toBeNull();
    type($('input[aria-label="Конто"]'), '4400');
    key($('input[aria-label="Конто"]')!, 'F9');
    await flush();
    expect(saveOverride).toHaveBeenCalledTimes(1);
    const [jid, rows, stay] = saveOverride.mock.calls[0]!;
    expect(jid).toBe('j1');
    expect(stay).toBe(true);
    expect((rows as OvRow[])[1]).toMatchObject({ i: 1, account: '4400', credit: 1000 });
    expect((rows as OvRow[])[0]).toMatchObject({ i: 0, account: '1200', debit: 1180 });
    expect(refresh).toHaveBeenCalled();
  });

  it('an amount change that unbalances the journal is held (Салдо shown) until another line balances it', async () => {
    const M = [row({ key: 'm1', account: '4400', debit: 100 }), row({ key: 'm2', account: '1000', credit: 100 })];
    grid(M, docJ('manual'));
    key(window, 'Enter');
    type($('input[aria-label="Должи"]'), '120');
    key($('input[aria-label="Должи"]')!, 'F9');
    await flush();
    expect(saveJournal).not.toHaveBeenCalled();
    expect(box!.textContent).toContain('не е изедначен');
    key(window, 'ArrowDown');
    key(window, 'Enter');
    type($('input[aria-label="Побарува"]'), '120');
    key($('input[aria-label="Побарува"]')!, 'F9');
    await flush();
    expect(saveJournal).toHaveBeenCalledTimes(1);
    const F = saveJournal.mock.calls[0]![1];
    expect(F.get('stay')).toBe('1');
    const p = JSON.parse(String(F.get('payload')));
    expect(p.id).toBe('j1');
    expect(p.rows.map((r: { debit: string; credit: string }) => [r.debit, r.credit])).toEqual([['120', ''], ['', '120']]);
  });

  it('a locked nalog is read-only', () => {
    grid(DOC_ROWS, docJ('none'));
    key(window, 'Enter');
    expect($('[role=dialog]')).toBeNull();
    expect($('[role=alert]')!.textContent).toContain('Заклучен');
  });
});

describe('bank nalog', () => {
  it('the two head lines of a statement merge into ONE bank konto line; counter lines stay', () => {
    const L = [
      { account: '100005', debit: 100000, credit: 0, partnerId: null, note: 'Извод бр. 30 од 10.07.2026', currency: null, amountCur: null, journalId: 'b' },
      { account: '100005', debit: 0, credit: 200025, partnerId: null, note: 'Извод бр. 30 од 10.07.2026', currency: null, amountCur: null, journalId: 'b' },
      { account: '4460', debit: 25, credit: 0, partnerId: null, note: 'провизија', currency: null, amountCur: null, journalId: 'b' },
      { account: '1200', debit: 0, credit: 100000, partnerId: 'k', note: 'уплата', currency: null, amountCur: null, journalId: 'b' },
    ];
    expect(mergeBankHeads(L, () => true, new Set(['100005']))).toEqual([[0, 1], [2], [3]]);
    expect(mergeBankHeads(L, () => false, new Set(['100005']))).toEqual([[0], [1], [2], [3]]);
    expect(sums(L.map((l) => ({ ...l, devD: 0, devP: 0 })))).toMatchObject({ D: 100025, P: 300025 });
  });

  it('„Бришење (Del)“ finds the statement line behind a counter line; the bank konto line is automatic', () => {
    const BL = [{ id: 'a', amount: 100000, partnerId: 'k', konto: '1200' }, { id: 'b', amount: -25, partnerId: null, konto: '4460' }];
    expect(bankLineOf({ account: '1200', debit: 0, credit: 100000, partnerId: 'k' }, BL, '100005')).toMatchObject({ id: 'a' });
    expect(bankLineOf({ account: '4460', debit: 25, credit: 0, partnerId: null }, BL, '100005')).toMatchObject({ id: 'b' });
    expect(bankLineOf({ account: '100005', debit: 100000, credit: 0, partnerId: null }, BL, '100005')).toHaveProperty('error');
  });

  it('Del on a statement counter line deletes the statement line (after confirm)', async () => {
    const R = [row({ key: 'h1+2', ids: [1, 2], account: '1000', debit: 500, credit: 25, head: true, src: [{ debit: 500, credit: 0 }, { debit: 0, credit: 25 }] }), row({ key: 'c3', ids: [3], account: '4400', debit: 25 }), row({ key: 'c4', ids: [4], account: '1200', credit: 500, partnerId: 'k' })];
    grid(R, [{ ...docJ('override')[0]!, bank: true }]);
    expect(box!.querySelectorAll('tbody tr')).toHaveLength(3);
    key(window, 'Delete');
    expect(delBank).not.toHaveBeenCalled();
    expect($('[role=alert]')!.textContent).toContain('автоматски');
    const conf = vi.fn(() => true);
    (window as { confirm: unknown }).confirm = conf;
    key(window, 'ArrowDown');
    key(window, 'Delete');
    await flush();
    expect(conf).toHaveBeenCalled();
    expect(delBank).toHaveBeenCalledWith(3);

  });
});

describe('nalog list keys', () => {
  it('↑ ↓ / Enter open / Ins new / + selection sums', () => {
    mount(createElement('div', null,
      createElement('table', { id: 'nal-list' }, createElement('tbody', null,
        createElement('tr', { 'data-nal': '1/1-3', 'data-d': 100, 'data-p': 100 }, createElement('td', null, createElement('a', { href: '/nalozi?n=1%2F1-3', 'data-open': '' }, 'Отвори'))),
        createElement('tr', { 'data-nal': '2/1-3', 'data-d': 50, 'data-p': 40 }, createElement('td', null, createElement('a', { href: '/nalozi?n=2%2F1-3', 'data-open': '' }, 'Отвори'), createElement('a', { href: '/nalozi?n=2%2F1-3&sint', 'data-sint': '' }, 'Σ'))),
      )),
      createElement(LK.ListKeys, { tableId: 'nal-list', newHref: '/nalozi?nov' })));
    key(window, 'ArrowDown');
    key(window, 'Enter');
    expect(push).toHaveBeenLastCalledWith('/nalozi?n=2%2F1-3');
    key(window, 'F8');
    expect(push).toHaveBeenLastCalledWith('/nalozi?n=2%2F1-3&sint');
    key(window, 'Insert');
    expect(push).toHaveBeenLastCalledWith('/nalozi?nov');
    key(window, '+');
    expect($('[data-testid=list-sel]')!.textContent).toContain('Селекција 1');
    expect($('[data-testid=list-sel]')!.textContent).toContain('10,00');
  });
});
