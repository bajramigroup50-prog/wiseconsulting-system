// @vitest-environment happy-dom
/**
 * Излез like the old program (Helix): the panel „Содржина (F10) · Нов (Ins) · Промена (Ent) · Бришење (Del) · Испрати
 * е-Фактура · Наплати (F4) · Книга на фактури (F2) · Префрлање во книга на излези (F8)“, ↑ ↓ selection, and the dialog
 * „Нова услужна калкулација“ (Основно / Дополнително, F5, F8, Esc, F9).
 */
import { act, createElement as h } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

const push = vi.fn();
const refresh = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, refresh, replace() {} }), useSearchParams: () => new URLSearchParams() }));
const save = vi.fn(async (_p: unknown, _f: FormData) => ({ ok: 'Отворена', id: 'new-id', number: '12' }));
vi.mock('@/app/(app)/izlez/head-actions', () => ({
  nextInvoiceNumberAction: async () => ({ no: '42' }),
  saveInvoiceHeadAction: (p: unknown, f: FormData) => save(p, f),
}));

let LK: typeof import('./invoice-list-keys');
beforeAll(async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  LK = await import('./invoice-list-keys');
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
const $ = <T extends Element = HTMLInputElement>(sel: string) => document.querySelector<T>(sel);
const type = (el: HTMLInputElement | null, v: string) => act(() => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, v);
  el!.dispatchEvent(new Event('input', { bubbles: true }));
});
const key = (el: Element | EventTarget, k: string) => act(() => { el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true })); });
const flush = () => act(async () => { for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0)); });

const PARTNERS = [{ id: 'p1', code: '0007', name: 'КУПУВАЧ ДОО', edb: '4030000000001' }, { id: 'p2', code: '0008', name: 'ДРУГ ДОО' }];
const delA = vi.fn();
const tr = (id: string, no: string, o: Record<string, string> = {}) => h('tr', {
  key: id, 'data-id': id, 'data-sum': '2360', 'data-no': no, 'data-pname': 'КУПУВАЧ ДОО', 'data-pid': 'p1', 'data-total': '2360', 'data-paid': '1000', 'data-rest': '1360',
  'data-head': JSON.stringify({ ...LK.blankHead('2026-11-01', no), id, partnerId: 'p1', refDoc: 'НАР-' + no, days: '10', due: '2026-11-11', grp1: 'Г' }), ...o,
}, h('td', { className: 'hx-mk' }), h('td', null, no), h('td', null,
  h('a', { href: `/izlez?edit=${id}`, 'data-open': '' }, '✎'),
  h('a', { href: `/api/ubl/${id}`, 'data-ubl': '' }, 'XML'),
  h('span', { 'data-del': '' }, h('button', { type: 'button', onClick: () => delA(id) }, '🗑'))));
const view = (rows = [tr('a', '1'), tr('b', '2'), tr('c', '3', { 'data-prod': '1' })]) => mount(h(LK.InvoiceListKeys, {
  tableId: 'inv-list', canWrite: true, today: '2026-11-21', svc: false, view: '/izlez', partners: PARTNERS, nalozi: [{ number: '1041', description: 'Излезни 11/2026' }], schemes: [], nextNumber: '4', firmName: 'ТЕСТ ДООЕЛ',
  filterId: 'q', wh: { value: '', options: [{ v: '', label: 'Сите магацини' }, { v: 'main', label: '01 Главен магацин' }] },
}, h('input', { id: 'q' }), h('table', { id: 'inv-list' }, h('tbody', null, ...rows))));
const sel = () => [...document.querySelectorAll('tr[data-id]')].findIndex((r) => r.getAttribute('aria-selected') === 'true');
const btn = (t: string) => [...document.querySelectorAll('button')].find((b) => b.textContent === t)!;

describe('Излез – Helix panel and keys', () => {
  it('has the panel, menu and bottom bar of the old program; ↑ ↓ select (the last row first, ▸), F10 opens the lines, Del deletes', async () => {
    view();
    const P = $('aside[aria-label="Акции на прегледот"]')!;
    expect([...P.querySelectorAll('button')].map((b) => b.textContent)).toEqual(['Смени магацин', 'Содржина (F10)', 'Нова (Ins)', 'Промена (Ent)', 'Бришење (Del)', 'Испрати е-Фактура',
      'Наплати (F4)', 'Масовна наплата', 'Масовна наплата на курсни разлики', 'Книга на фактури (F2)', 'Спецификација по комитенти (F3)', 'Промет по производи (F6)', 'Парагон', 'Промет', 'Прегл. по налози']);
    expect([...P.querySelectorAll('legend')].map((l) => l.textContent)).toEqual(['Комерцијално', 'Продажба']);
    expect([...document.querySelectorAll('[data-hx-menu] summary')].map((x) => x.textContent)).toEqual(['Специјални опции', 'Корекција за наплата', 'Прегледи', 'Безбедност', 'Сортирање', 'Копирање', 'Печатење', 'Останато', 'Е-Фактура']);
    // no copy in WISE yet: shown, disabled, with the reason
    expect([...document.querySelectorAll('[data-hx-menu] summary')].find((x) => x.textContent === 'Копирање')!.getAttribute('aria-disabled')).toBe('true');
    expect(document.body.textContent).toContain('Прекнижување (F5)');
    expect(document.body.textContent).toContain('Главна книга (F7)');
    expect(document.body.textContent).toContain('F1 - Освежување на податоците');
    expect(sel()).toBe(2);
    expect(document.querySelectorAll('td.hx-mk')[2]!.textContent).toBe('▸');
    key(window, 'ArrowUp'); key(window, 'ArrowUp');
    expect(sel()).toBe(0);
    key(window, 'ArrowDown');
    expect(sel()).toBe(1);
    key(window, 'F10');
    expect(push).toHaveBeenLastCalledWith('/izlez?edit=b');
    key(window, 'Delete');
    expect(delA).toHaveBeenCalledWith('b');
    key(window, 'F2');
    expect(push).toHaveBeenLastCalledWith('/ddvKnigi?t=out');
    key(window, 'F5');
    expect(push).toHaveBeenLastCalledWith('/rekniz');
    key(window, 'F12');
    await flush();
    expect(document.activeElement?.id).toBe('q');
    (document.activeElement as HTMLElement).blur();
    key(window, 'Escape');
    expect(push).toHaveBeenLastCalledWith('/');
  });

  it('Селекција: + marks and moves down, * all / none, F only the marked; the sum of the marked', () => {
    view();
    key(window, 'Home');
    key(window, '+');
    key(window, '+');
    expect(document.querySelectorAll('tr.hx-marked')).toHaveLength(2);
    expect($('[data-testid=hx-sel]')!.textContent).toContain('4.720,00');
    key(window, 'F');
    expect([...document.querySelectorAll<HTMLTableRowElement>('tr[data-id]')].map((r) => r.hidden)).toEqual([false, false, true]);
    key(window, 'F');
    key(window, '*');
    expect(document.querySelectorAll('tr.hx-marked')).toHaveLength(0);
    key(window, '*');
    expect(document.querySelectorAll('tr.hx-marked')).toHaveLength(3);
  });

  it('F4 „Наплати“ shows за наплата / наплатено / останува and where to record the payment', () => {
    view();
    key(window, 'F4');
    const d = $('[role=dialog][aria-label="Наплата на фактура"]')!;
    expect($('[data-testid=pay-sums]')!.textContent).toContain('2.360,00');
    expect($('[data-testid=pay-sums]')!.textContent).toContain('1.360,00');
    expect([...d.querySelectorAll('a')].map((a) => a.getAttribute('href'))).toEqual(expect.arrayContaining(['/banka', '/kompenzacii', '/akart?k=12&pid=p1', '/opomeni?ids=c']));
    key(d, 'Escape');
    expect($('[role=dialog]')).toBeNull();
  });

  it('Ins opens „Нова услужна калкулација“: next number, today, Денови → Валута, F8 комитент, tabs, Esc', async () => {
    view();
    key(window, 'Insert');
    const d = $('[role=dialog]')!;
    expect(d.getAttribute('aria-label')).toBe('Нова услужна калкулација');
    expect($('#hd_no')!.value).toBe('4');
    expect($('#hd_date')!.value).toBe('2026-11-21');
    type($('#hd_days'), '15');
    expect($('#hd_due')!.value).toBe('2026-12-06');
    key($('#hd_ref')!, 'F5');
    await flush();
    expect($('#hd_ref')!.value).toBe('42');
    key($('#hd_days')!, 'F8');
    await flush();
    expect(document.activeElement?.id).toBe('hd_p');
    type($('#hd_p'), '0007 · КУПУВАЧ ДОО');
    expect($('[data-testid=hd-partner]')!.textContent).toContain('4030000000001');
    expect($<HTMLInputElement>('input[name=partnerId]')!.value).toBe('p1');
    act(() => btn('Дополнително').click());
    expect($('[data-pane=dop]')!.hidden).toBe(false);
    expect(d.textContent).toContain('Фактура по член 32А без ДДВ');
    expect(d.textContent).toContain('Забелешка (само за во финансово)');
    key($('#hd_g1')!, 'Escape');
    expect($('[role=dialog]')).toBeNull();
  });

  it('„Во ред (F9)“ sends the header; a new one opens its lines in the editor', async () => {
    view();
    key(window, 'Insert');
    type($('#hd_p'), '0008 · ДРУГ ДОО');
    act(() => btn('Во ред (F9)').click());
    await flush();
    expect(save).toHaveBeenCalled();
    const f = save.mock.calls[0]![1];
    expect(f.get('partnerId')).toBe('p2');
    expect(f.get('number')).toBe('4');
    expect(f.get('saldo')).toBe('Н');
    expect(f.get('tip')).toBe('final');
    expect(push).toHaveBeenLastCalledWith('/izlez?edit=new-id&drafted=1');
  });

  it('Enter = Промена: the dialog with the invoice header; a production invoice opens the invoice itself', () => {
    view();
    key(window, 'ArrowUp'); key(window, 'ArrowUp');
    key(window, 'Enter');
    expect($('[role=dialog]')!.textContent).toContain('Промена на услужна калкулација');
    expect($('#hd_no')!.value).toBe('1');
    expect($('#hd_ref')!.value).toBe('НАР-1');
    expect($('#hd_due')!.value).toBe('2026-11-11');
    expect($('#hd_p')!.value).toBe('0007 · КУПУВАЧ ДОО');
    key($('#hd_no')!, 'Escape');
    key(window, 'ArrowDown'); key(window, 'ArrowDown');
    key(window, 'Enter');
    expect($('[role=dialog]')).toBeNull();
    expect(push).toHaveBeenLastCalledWith('/izlez?edit=c');
  });
});

describe('Влез – Helix controls', () => {
  it('panel, menu and bottom bar of „Преглед на влезни калкулации“ map to WISE screens', async () => {
    const { vlezHelix } = await import('./vlez-list-keys');
    const c = vlezHelix(true, false);
    expect(c.groups.flatMap((g) => g.items.map((b) => b.label + (b.key ? ` (${b.key})` : '')))).toEqual(['Смени магацин', 'Содржина (F10)', 'Нова (Ins)', 'Промена (Enter)', 'Бришење (Delete)',
      'Наплати (F4)', 'Масовна наплата', 'Книга на фактури (F2)', 'Спецификација по комитенти (F3)', 'Набавени производи (F6)', 'Преглед по налози', 'По документи']);
    expect(c.groups[0]!.items[0]!.act).toHaveProperty('off');
    // Ins stays with the page's „Податоци за малопродажна калкулација“ dialog
    expect(c.groups[0]!.items[2]).toMatchObject({ act: { href: '/vlez?hnov' } });
    expect(c.groups[0]!.items[2]!.key).toBeUndefined();
    expect(c.menu.map((m) => m.label)).toEqual(['Специјални опции', 'Корекција за наплати', 'Безбедност', 'Сортирање', 'Копирање', 'Останато', 'Е-Фактура']);
    expect(c.bottom.map((b) => `${b.label} ${b.key}`)).toEqual(['Прекнижување F5', 'Главна книга F7', 'Филтер F11', 'Освежување на податоците F1']);
    expect(c.groups[1]!.items.find((b) => b.key === 'F2')!.act).toEqual({ href: '/ddvKnigi?t=in' });
  });
});
