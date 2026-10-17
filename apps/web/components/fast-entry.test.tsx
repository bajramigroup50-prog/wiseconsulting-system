// @vitest-environment happy-dom
/**
 * „Нова ставка“ fast-entry dialog (old desktop program flow): F9 saves and clears for the next line keeping the
 * defaults, Esc closes, Enter moves on, F5 copies the previous content, the partner search finds both scripts, and in
 * bank mode Должи / Побарува of the counter konto become ОДЛИВ / ПРИЛИВ.
 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: () => {}, refresh: () => {} }) }));
const addManual = vi.fn(async (_p: unknown, _f: FormData) => ({ ok: 'Ставката е додадена.' }));
vi.mock('@/app/(app)/banka/actions', () => ({ addManualLineAction: (p: unknown, f: FormData) => addManual(p, f) }));

let FE: typeof import('./fast-entry');
let BME: typeof import('./bank-manual-entry');
beforeAll(async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  FE = await import('./fast-entry');
  BME = await import('./bank-manual-entry');
});

let root: Root | null = null, box: HTMLDivElement | null = null;
afterEach(() => { act(() => root?.unmount()); box?.remove(); root = null; box = null; addManual.mockClear(); });
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
const key = (el: Element | null, k: string) => act(() => { el!.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true })); });
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

const CHART: [string, string][] = [['1200', 'Купувачи во земјата'], ['2200', 'Добавувачи во земјата'], ['4400', 'Трошоци'], ['1000', 'Жиро сметка']];
const PARTNERS = [{ id: 'v', code: '0412', name: 'VENG HAUS DOO SKOPJE' }, { id: 'k', code: '0339', name: 'КОМИТЕНТ ДООЕЛ' }];

describe('fast entry dialog', () => {
  it('F9 saves the line, the dialog stays open and is cleared for the next line keeping date / statement no. / default content', async () => {
    const saved: import('./fast-entry').FastLine[] = [];
    mount(createElement(FE.FastEntry, {
      mode: 'new', chart: CHART, partners: PARTNERS, saldo: 0, no: 1, showStNo: true,
      initial: { date: '2026-07-10', stNo: '30', content: 'ИЗВОД БР 30' }, onSave: (l) => { saved.push(l); }, onClose: () => {},
    }));
    expect($('[role=dialog]')!.getAttribute('aria-label')).toBe('Нова ставка');
    type($('input[aria-label="Конто"]'), '4400');
    type($('input[aria-label="Должи"]'), '1500');
    expect($('[data-testid=fe-saldo]')!.textContent).toContain('1.500,00');
    key($('input[aria-label="Должи"]'), 'F9');
    await flush();
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ konto: '4400', debit: '1500', date: '2026-07-10', stNo: '30', content: 'ИЗВОД БР 30' });
    // cleared for the next line, defaults kept
    expect($('[role=dialog]')).not.toBeNull();
    expect($('input[aria-label="Конто"]')!.value).toBe('');
    expect($('input[aria-label="Должи"]')!.value).toBe('');
    expect($('input[aria-label="Извод број"]')!.value).toBe('30');
    expect($('input[aria-label="Датум на книжење"]')!.value).toBe('2026-07-10');
    expect($('input[aria-label="Содржина"]')!.value).toBe('ИЗВОД БР 30');
    expect(box!.textContent).toContain('е внесена');
    expect(document.activeElement).toBe($('input[aria-label="Конто"]'));
  });

  it('refuses a line without amount, a partner konto without partner; F5 copies the previous content', async () => {
    const onSave = vi.fn();
    mount(createElement(FE.FastEntry, { mode: 'new', chart: CHART, partners: PARTNERS, saldo: 0, no: 3, prevContent: 'Наем јули', onSave, onClose: () => {} }));
    type($('input[aria-label="Конто"]'), '1200');
    key($('input[aria-label="Конто"]'), 'F9');
    await flush();
    expect($('[role=alert]')!.textContent).toContain('Внесете износ');
    type($('input[aria-label="Побарува"]'), '100');
    key($('input[aria-label="Побарува"]'), 'F9');
    await flush();
    expect($('[role=alert]')!.textContent).toContain('бара комитент');
    expect(onSave).not.toHaveBeenCalled();
    key($('input[aria-label="Содржина"]'), 'F5');
    expect($('input[aria-label="Содржина"]')!.value).toBe('Наем јули');
  });

  it('Enter moves to the next field; Esc („Излез“) closes', () => {
    const onClose = vi.fn();
    mount(createElement(FE.FastEntry, { mode: 'edit', chart: CHART, partners: PARTNERS, saldo: 0, no: 2, initial: { konto: '4400', debit: '10' }, onSave: () => {}, onClose }));
    expect($('[role=dialog]')!.getAttribute('aria-label')).toBe('Промена на ставка');
    key($('input[aria-label="Конто"]'), 'Enter');
    expect(document.activeElement).toBe($('input[aria-label="Содржина"]'));
    key($('input[aria-label="Содржина"]'), 'Escape');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('F8 opens the partner search, which finds Latin names typed in Cyrillic and back', () => {
    let pid = '';
    mount(createElement(FE.FastEntry, { mode: 'new', chart: CHART, partners: PARTNERS, saldo: 0, no: 1, onSave: (l) => { pid = l.partnerId; }, onClose: () => {} }));
    key($('input[aria-label="Конто"]'), 'F8');
    const cb = $('input[role=combobox]')!;
    expect(document.activeElement).toBe(cb);
    type(cb, 'ВЕНГ');
    expect(box!.querySelector('[role=listbox]')!.textContent).toContain('VENG HAUS DOO SKOPJE');
    type(cb, 'komitent');
    expect(box!.querySelector('[role=listbox]')!.textContent).toContain('КОМИТЕНТ ДООЕЛ');
    key(cb, 'Enter');
    expect(cb.value).toBe('0339 · КОМИТЕНТ ДООЕЛ');
    expect(pid).toBe('');
  });
});

describe('bank line direction', () => {
  it('Побарува on the counter konto = ПРИЛИВ, Должи = ОДЛИВ; the bank konto side is automatic', () => {
    expect(FE.bankDirection({ debit: '', credit: '3540', debitCur: '', creditCur: '' })).toEqual({ dir: 'in', amount: 3540 });
    expect(FE.bankDirection({ debit: '120', credit: '', debitCur: '', creditCur: '' })).toEqual({ dir: 'out', amount: 120 });
    expect(FE.bankDirection({ debit: '1', credit: '1', debitCur: '', creditCur: '' })).toBeNull();
    const f = FE.bankLineForm(FE.blankFast({ acct: 'a1', date: '2026-07-10', konto: '2200', partnerId: 'v', debit: '500', content: 'Плаќање', stNo: '30', doc: '15/26' }), { fx: false });
    expect(f).toBeInstanceOf(FormData);
    const F = f as FormData;
    expect([F.get('dir'), F.get('amount'), F.get('konto'), F.get('partner'), F.get('stno'), F.get('ldoc')]).toEqual(['out', '500', '2200', 'v', '30', '15/26']);
  });

  it('„Нова ставка во извод“ posts through addManualLineAction with the direction and shows ПРИЛИВ', async () => {
    mount(createElement(BME.BankManualEntry, {
      chart: CHART, partners: PARTNERS, accounts: [{ id: 'a1', label: 'НЛБ', konto: '1000', cur: 'MKD' }],
      statements: [{ id: 's1', acct: 'a1', no: '30', date: '2026-07-10', net: 1000, lines: 4 }], initial: { acct: 'a1', date: '2026-07-10', stNo: '30' }, onClose: () => {},
    }));
    expect($('[data-testid=fe-no]')!.textContent).toBe('5');
    type($('input[aria-label="Конто"]'), '4400');
    type($('input[aria-label="Побарува"]'), '250');
    expect($('[data-testid=fe-dir]')!.textContent).toBe('ПРИЛИВ');
    expect($('[data-testid=fe-saldo]')!.textContent).toContain('1.250,00');
    key($('input[aria-label="Побарува"]'), 'F9');
    await flush();
    expect(addManual).toHaveBeenCalledTimes(1);
    const F = addManual.mock.calls[0]![1];
    expect([F.get('acct'), F.get('date'), F.get('dir'), F.get('amount'), F.get('konto')]).toEqual(['a1', '2026-07-10', 'in', '250', '4400']);
    // next line: same statement
    expect($('input[aria-label="Извод број"]')!.value).toBe('30');
    type($('input[aria-label="Конто"]'), '4400');
    type($('input[aria-label="Должи"]'), '80');
    expect($('[data-testid=fe-dir]')!.textContent).toBe('ОДЛИВ');
  });
});
