'use client';
/**
 * Одобренија / Профактури / Испратници in the layout of the Helix lists (like Излез, on `HelixShell`): the menu bar,
 * „Магацин“, the panel Смени магацин · Содржина (F10) · Нов (Ins) · Промена (Ent) · Бришење (Del), the document's
 * own actions (👁 / PDF, ✉, Во фактура, Кон фактура, Товарен лист, е-Фактура), and the bottom bar. Rows:
 * `tr[data-id]` with the row links `a[data-open]`, `a[data-print]`, `a[data-mail]`, `a[data-toinv]`, `a[data-ref]`,
 * `a[data-waybill]`, `a[data-ubl]`, `[data-del] button`.
 */
import { useMemo } from 'react';
import { HelixShell, type HxBtn, type HxGroup, type HxMenu, type HxWh } from '@/components/helix/helix-shell';

export type DocListKind = 'credit' | 'proforma' | 'dispatch';

/** The Helix controls of a document list mapped to WISE (exported for the tests). */
export function docHelix(kind: DocListKind, view: string, canWrite: boolean, hasWh: boolean): { groups: HxGroup[]; menu: HxMenu[]; bottom: HxBtn[] } {
  const ro = 'Немате право на внес во оваа фирма.';
  const own: HxBtn[] = kind === 'credit'
    ? [{ label: 'Кон фактура', key: 'F8', act: { row: 'a[data-ref]' }, title: 'Фактурата на која се однесува одобрението' }]
    : [
      { label: 'Во фактура', key: 'F8', act: canWrite ? { row: 'a[data-toinv]' } : { off: ro }, title: kind === 'dispatch' ? 'Фактурирај ја испратницата (без повторно раздолжување)' : 'Претвори ја профактурата во фактура со истите ставки' },
      ...(kind === 'dispatch' ? [{ label: 'Товарен лист', act: { row: 'a[data-waybill]' }, title: 'Товарен лист на избраната испратница' } as HxBtn] : []),
    ];
  return {
    groups: [
      { items: [
        { label: 'Смени магацин', act: hasWh ? { fn: 'wh' } : { off: 'Фирмата нема посебни магацини / продавници (Шифрарник › Магацини).' } },
        { label: 'Содржина', key: 'F10', act: { row: 'a[data-open]' }, title: 'Ставките на избраниот документ' },
        { label: 'Нов', key: 'Insert', act: canWrite ? { href: view + '?nov' } : { off: ro }, cls: 'pri' },
        { label: 'Промена', key: 'Enter', act: { row: 'a[data-open]' }, title: 'Отвори го избраниот документ' },
        { label: 'Бришење', key: 'Delete', act: { row: '[data-del] button' }, cls: 'danger' },
      ] },
      { items: [
        { label: '👁 Види / PDF', act: { row: 'a[data-print]' }, title: 'Преглед, печатење и PDF на избраниот документ' },
        ...(kind === 'credit' ? [
          { label: '✉ Испрати по е-пошта', act: { row: 'a[data-mail]' }, title: 'PDF по е-пошта (само прокнижено)' } as HxBtn,
          { label: 'Испрати е-Фактура', act: { row: 'a[data-ubl]' }, title: 'UBL е-фактура (XML) на избраното одобрение' } as HxBtn,
        ] : []),
        ...own,
      ] },
      { title: 'Комерцијално', items: [
        ...(kind === 'credit' ? [{ label: 'Книга на фактури', key: 'F2', act: { href: '/ddvKnigi?t=out' }, title: 'Книга на излезни фактури (ДДВ)' } as HxBtn] : []),
        { label: 'Спецификација по комитенти', key: 'F3', act: { href: '/analitika' }, title: 'Аналитика / ИОС по комитенти' },
        { label: 'Излезни фактури', act: { href: '/izlez' } },
        { label: 'Прегл. по налози', act: { href: '/nalozi' } },
      ] },
    ],
    menu: [
      { label: 'Специјални опции', items: [
        { label: '+ Нов документ (цел екран)', act: canWrite ? { href: view + '?nov' } : { off: ro } },
        ...(kind !== 'credit' ? [{ label: 'Во фактура (избраниот)', act: canWrite ? { row: 'a[data-toinv]' } : { off: ro } } as HxBtn] : []),
      ] },
      { label: kind === 'credit' ? 'Корекција за наплата' : 'Прегледи', items: kind === 'credit'
        ? [{ label: 'Компензации', act: { href: '/kompenzacii' } }, { label: 'Опомени', act: { href: '/opomeni' } }, { label: 'Излезни фактури', act: { href: '/izlez' } }]
        : [{ label: 'Излезни фактури', act: { href: '/izlez' } }, { label: 'Профактури', act: { href: '/profakturi' } }, { label: 'Испратници', act: { href: '/ispratnici' } }, { label: 'Сите извештаи', act: { href: '/izvestai' } }] },
      { label: 'Безбедност', items: [
        { label: 'Евиденција на активности', act: { href: '/aktivnost' } },
        { label: 'Корисници и права', act: { href: '/korisnici' } },
      ] },
      { label: 'Сортирање', items: [
        { label: 'По број', act: { href: view + '?sort=no' } },
        { label: 'По датум', act: { href: view + '?sort=date' } },
        { label: 'По комитент', act: { href: view + '?sort=p' } },
        { label: 'По износ', act: { href: view + '?sort=amt' } },
      ] },
      { label: 'Копирање', items: [], off: 'Копирање на документ во нов уште не постои во WISE.' },
      { label: 'Печатење', items: [
        { label: '👁 Види / PDF / печатење на избраниот', act: { row: 'a[data-print]' } },
        ...(kind === 'dispatch' ? [{ label: 'Товарен лист на избраната', act: { row: 'a[data-waybill]' } } as HxBtn] : []),
        { label: 'Печати ја листата', act: { fn: 'print' } },
      ] },
      { label: 'Останато', items: [{ label: 'Сите извештаи', act: { href: '/izvestai' } }] },
      ...(kind === 'credit' ? [{ label: 'Е-Фактура', items: [
        { label: 'Испрати: XML (UBL) на избраното', act: { row: 'a[data-ubl]' } },
        { label: 'Извоз на повеќе (ZIP) / увоз на XML', act: { href: '/efaktura' } },
      ] } as HxMenu] : []),
    ],
    bottom: [
      { label: 'Прекнижување', key: 'F5', act: { href: '/rekniz' }, title: 'Рекнижење во маса' },
      { label: 'Главна книга', key: 'F7', act: { href: '/kartici' }, title: 'Картици на конта (главна книга)' },
      { label: 'Филтер', key: 'F12', act: { fn: 'filter' }, title: 'Барање по број, комитент или шифра' },
      { label: 'Освежување на податоците', key: 'F1', act: { fn: 'refresh' } },
    ],
  };
}

export function DocListKeys({ kind, view, tableId, canWrite, wh, filterId, head, menuExtra, filter, filterOpen, children }: {
  kind: DocListKind; view: string; tableId: string; canWrite: boolean; wh?: HxWh | null; filterId?: string; head?: React.ReactNode;
  menuExtra?: Record<string, React.ReactNode>; filter?: React.ReactNode; filterOpen?: boolean; children?: React.ReactNode;
}) {
  const cfg = useMemo(() => docHelix(kind, view, canWrite, !!wh && wh.options.length > 2), [kind, view, canWrite, wh]);
  return <HelixShell tableId={tableId} groups={cfg.groups} menu={cfg.menu} bottom={cfg.bottom} wh={wh} exitHref="/" filterId={filterId} head={head}
    menuExtra={menuExtra} filter={filter} filterOpen={filterOpen}>{children}</HelixShell>;
}
