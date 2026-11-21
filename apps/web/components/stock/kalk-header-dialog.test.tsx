// @vitest-environment happy-dom
/**
 * „Податоци за малопродажна калкулација“ (Helix): Ins opens it, the next calculation number comes by itself, F7 cycles
 * the Тип, F8 / Комитент search, „Посебни“ `*` / `+` / `-`, F9 opens the WISE document of the Тип with the header (`hx`),
 * Esc closes; the header decodes back into the document (`@/lib/kalk-header`).
 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { blankHeader, decodeHeader, headerHref, headerNote, headerPurchaseData } from '@/lib/kalk-header';
import type { KalkDialogData } from '@/lib/kalk-header-data';

const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, refresh() {}, replace() {} }), useSearchParams: () => new URLSearchParams() }));
const nextNo = vi.fn(async (wh: string, _d: string) => ({ no: wh === 's1' ? '0003 02' : '0007 01' }));
vi.mock('@/app/(app)/vlez/actions', () => ({ nextCalcNoAction: (wh: string, d: string) => nextNo(wh, d) }));

const data: KalkDialogData = {
  partners: [{ id: 'p1', name: 'Добавувач Алфа', edb: '4030000000001' }, { id: 'p2', name: 'Бета ДООЕЛ', edb: '4030000000002' }],
  locations: [{ id: 's1', code: '02', name: 'Продавница Центар', kind: 'store' }],
  calcs: [
    { id: 'c1', calcNo: '0001 01', doc: 'Ф-10', total: 1000, partner: 'Алфа', advance: false },
    { id: 'c2', calcNo: '0002 01', doc: 'Ф-11', total: 500, partner: 'Бета', advance: false },
    { id: 'c3', calcNo: '0003 01', doc: 'А-1', total: 300, partner: 'Алфа', advance: true },
  ],
};

let root: Root | null = null;
let host: HTMLDivElement;
const key = (k: string, el: Element | Window = document.activeElement ?? document.body) => act(async () => { el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true })); });
const dlg = () => document.querySelector('[role="dialog"]');
const typeIn = async (el: HTMLInputElement | HTMLSelectElement, v: string) => act(async () => {
  const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, v);
  el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
});
const click = (el: Element) => act(async () => { (el as HTMLElement).click(); });
const $ = <T extends Element = HTMLInputElement>(q: string) => document.querySelector(q) as T;

beforeEach(async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  push.mockClear(); nextNo.mockClear();
  host = document.createElement('div'); document.body.appendChild(host);
  const { KalkNewKeys } = await import('./kalk-header-dialog');
  root = createRoot(host);
  await act(async () => { root!.render(createElement(KalkNewKeys, { data, today: '2026-11-21', defaults: { wh: 'main' } })); });
});
afterEach(() => { act(() => root?.unmount()); host.remove(); });

describe('„Нов (Ins)“ → „Податоци за малопродажна калкулација“', () => {
  it('Ins opens it with the next calculation number and today; Esc closes', async () => {
    expect(dlg()).toBeNull();
    await key('Insert', window);
    expect(dlg()?.getAttribute('aria-label')).toBe('Податоци за малопродажна калкулација');
    expect(nextNo).toHaveBeenCalledWith('main', '2026-11-21');
    expect($('#kh_no').value).toBe('0007 01');
    expect($('#kh_date').value).toBe('2026-11-21');
    // the store changes the object → its own number
    await typeIn($<HTMLSelectElement>('#kh_st'), 's1');
    expect($('#kh_no').value).toBe('0003 02');
    await key('Escape', $('#kh_no'));
    expect(dlg()).toBeNull();
  });

  it('F7 cycles the Тип; F8 + Enter picks the partner; F9 opens /vlez with the header', async () => {
    await click([...document.querySelectorAll('button')].find((b) => b.textContent === 'Нов (Ins)')!);
    const tip = () => (document.querySelector('input[name="kh_tip"]:checked') as HTMLInputElement).value;
    expect(tip()).toBe('in');
    await key('F7', $('#kh_no'));
    expect(tip()).toBe('ret');
    for (let i = 0; i < 7; i++) await key('F7', $('#kh_no'));
    expect(tip()).toBe('in');
    await key('F8', $('#kh_no'));
    expect(document.activeElement?.id).toBe('kh_kom');
    await typeIn($('#kh_kom'), 'бета');
    await key('Enter', $('#kh_kom'));
    expect($('#kh_kom').value).toBe('Бета ДООЕЛ');
    await key('F5', $('#kh_no'));
    expect(document.activeElement?.id).toBe('kh_doc');
    await typeIn($('#kh_doc'), 'Ф-200');
    await key('F6', $('#kh_doc'));
    expect(document.activeElement?.id).toBe('kh_disp');
    await key('F9', $('#kh_doc'));
    expect(push).toHaveBeenCalledTimes(1);
    const href = String(push.mock.calls[0]![0]);
    expect(href).toMatch(/^\/vlez\?nov&hx=/);
    const h = decodeHeader(new URLSearchParams(href.split('?')[1]).get('hx'))!;
    expect(h).toMatchObject({ partnerId: 'p2', doc: 'Ф-200', calcNo: '0007 01', wh: 'main', date: '2026-11-21', tip: 'in' });
  });

  it('„Посебни“: * selects all of the type, + / − add / remove, Авансна lists the advance calculations; the links travel with the header', async () => {
    await key('Insert', window);
    await click(document.querySelector('[role="tab"]:nth-child(2)')!);
    expect(document.querySelectorAll('tbody tr')).toHaveLength(2);
    const tbl = document.querySelector('table')!;
    await key('*', tbl);
    expect(document.querySelector('[role="tab"]:nth-child(2)')?.textContent).toBe('Посебни (2)');
    expect(document.querySelector('tfoot')?.textContent).toMatch(/1\.500,00/);
    await key('-', tbl); // the first row out
    expect([...document.querySelectorAll<HTMLInputElement>('tbody input[type=checkbox]')].map((c) => c.checked)).toEqual([false, true]);
    await click(document.querySelector('input[name="kh_vid"][value="av"]')!);
    expect(document.querySelector('tbody')?.textContent).toMatch(/0003 01/);
    await key('+', tbl);
    // Тип „Нивелација“ (no partner needed) → /nivel with the links
    await click(document.querySelector('[role="tab"]:nth-child(1)')!);
    await click(document.querySelector('input[name="kh_tip"][value="niv"]')!);
    await key('F9', $('#kh_no'));
    const href = String(push.mock.calls[0]![0]);
    expect(href).toMatch(/^\/nivel\?nov&hx=/);
    expect(decodeHeader(new URLSearchParams(href.split('?')[1]).get('hx'))).toMatchObject({ tip: 'niv', vid: 'av', links: ['c2', 'c3'] });
  });
});

describe('the header in the document', () => {
  it('every Тип opens its WISE document; extra fields go to the purchase data and the note', () => {
    const h = blankHeader('2026-11-21', { partnerId: 'p1', store: 's1', doc: 'Ф-1', dispNo: 'И-5', archNo: '77', ref: 'дог. 3', note: 'прва', oe: '01', rabat: '2,5', saldo: true, links: ['c1'] });
    const T = (tip: typeof h.tip) => headerHref({ ...h, tip }).split('&hx=')[0];
    expect(['in', 'ret', 'disp', 'niv', 'out', 'par', 'ord', 'pop'].map((t) => T(t as typeof h.tip))).toEqual([
      '/vlez?nov', '/povratDob?nov', '/vlez?nov', '/nivel?nov', '/izlez?nov', '/m_izlez?t=sale&nov&wh=s1', '/porachki?nov', '/m_izlez?t=pop&nov&wh=s1',
    ]);
    expect(headerNote(h)).toBe('прва – По документ Ф-1 · Испратница И-5 · Арх. бр. 77 · Повикување на дог. 3');
    expect(headerPurchaseData(h)).toMatchObject({ oe: '01', hxStore: 's1', hxDispNo: 'И-5', hxArchNo: '77', rabReg: '2.5', hxLinks: 'c1', saldo: 'Д', hxTip: 'in' });
    expect(decodeHeader('не-е-base64')).toBeNull();
  });
});
