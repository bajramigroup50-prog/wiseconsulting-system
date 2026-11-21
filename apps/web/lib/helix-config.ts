/**
 * Shared pieces of the Helix-style lists (`HelixShell`) built on the server: the common menus (Безбедност, Сортирање,
 * Копирање) and the bottom bar (Прекнижување F5, Главна книга F7, Филтер, F1 освежување). Plain data, so a server page
 * passes it straight to the client shell.
 */
import type { HxBtn, HxMenu } from '@/components/helix/helix-shell';

export const hxRo = 'Немате право на внес во оваа фирма.';

export const hxSecurity = (): HxMenu => ({ label: 'Безбедност', items: [
  { label: 'Евиденција на активности', act: { href: '/aktivnost' } },
  { label: 'Корисници и права', act: { href: '/korisnici' } },
] });

/** „Сортирање“: `?sort=` keeps the other query values of `base` (e.g. `/m_izlez?t=sale&`). */
export const hxSort = (base: string, opts: [string, string][] = [['no', 'По број'], ['date', 'По датум'], ['amt', 'По износ']]): HxMenu => ({
  label: 'Сортирање', items: opts.map(([k, l]) => ({ label: l, act: { href: `${base}${base.includes('?') ? '&' : '?'}sort=${k}` } })),
});

export const hxCopyOff = (what = 'документ'): HxMenu => ({ label: 'Копирање', items: [], off: `Копирање на ${what} во нов уште не постои во WISE.` });

export const hxBottom = (filterKey = 'F12'): HxBtn[] => [
  { label: 'Прекнижување', key: 'F5', act: { href: '/rekniz' }, title: 'Рекнижење во маса' },
  { label: 'Главна книга', key: 'F7', act: { href: '/kartici' }, title: 'Картици на конта (главна книга)' },
  { label: 'Филтер', key: filterKey, act: { fn: 'filter' }, title: 'Барање / филтер на листата' },
  { label: 'Освежување на податоците', key: 'F1', act: { fn: 'refresh' } },
];

/** The first panel group: Смени магацин · Содржина (F10) · Нов (Ins) · Промена (Ent) · Бришење (Del). */
export function hxMainGroup(o: { newAct: HxBtn['act']; newKey?: boolean; hasWh: boolean; label?: string; write: boolean }): HxBtn[] {
  return [
    { label: 'Смени магацин', act: o.hasWh ? { fn: 'wh' } : { off: 'Фирмата нема посебни магацини / продавници (Шифрарник › Магацини).' } },
    { label: 'Содржина', key: 'F10', act: { row: 'a[data-open]' }, title: 'Ставките (содржината) на избраниот документ' },
    { label: o.newKey === false ? `${o.label ?? 'Нов'} (Ins)` : o.label ?? 'Нов', ...(o.newKey === false ? {} : { key: 'Insert' }), act: o.write ? o.newAct : { off: hxRo }, cls: 'pri' },
    { label: 'Промена', key: 'Enter', act: { row: 'a[data-open]' }, title: 'Отвори го избраниот документ' },
    { label: 'Бришење', key: 'Delete', act: { row: '[data-del] button' }, cls: 'danger' },
  ];
}
