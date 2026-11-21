'use client';
/**
 * „Преглед на влезни калкулации“ (Материјално › Влез) like the old program (Helix), on `HelixShell`: the menu bar,
 * „Магацин“, the panel Смени магацин · Содржина (F10) · Нова (Ins) · Промена (Ent) · Бришење (Del) · Комерцијално
 * (Наплати F4, Масовна наплата, Книга на фактури F2, Спецификација по комитенти F3, Набавени производи F6, Преглед по
 * налози, По документи), and the bottom bar (Прекнижување F5, Главна книга F7, Филтер F11, Излез Esc).
 *
 * „Нова (Ins)“ is the header dialog „Податоци за малопродажна калкулација“ of the page (`KalkNewKeys`, which owns the
 * Ins key; the button opens it with `?hnov`). Rows: `tr[data-id]` with `data-total` / `data-paid` / `data-rest`.
 */
import { MassAssignDialog } from './mass-assign-dialog';
import { useEffect, useMemo, useState } from 'react';
import { HelixShell, type HxBtn, type HxGroup, type HxMenu, type HxWh } from '@/components/helix/helix-shell';
import { PayDialog } from './invoice-list-keys';

/** The Helix controls of Влез mapped to WISE (exported for the tests). */
export function vlezHelix(canWrite: boolean, hasWh: boolean): { groups: HxGroup[]; menu: HxMenu[]; bottom: HxBtn[] } {
  const ro = 'Немате право на внес во оваа фирма.';
  const NOT = 'Оваа опција од старата програма уште ја нема во WISE.';
  const LOCK = 'Во WISE се заклучува по период (Затворање / заклучување) – документите во заклучен период не се менуваат.';
  return {
    groups: [
      { items: [
        { label: 'Смени магацин', act: hasWh ? { fn: 'wh' } : { off: 'Фирмата нема посебни магацини / продавници (Шифрарник › Магацини).' } },
        { label: 'Содржина', key: 'F10', act: { row: 'a[data-open]' }, title: 'Ставките (содржината) на избраната калкулација' },
        // the Ins key belongs to the page's „Податоци за малопродажна калкулација“ dialog
        { label: 'Нова (Ins)', act: canWrite ? { href: '/vlez?hnov' } : { off: ro }, cls: 'pri', title: 'Нова калкулација: заглавје, па ставки' },
        { label: 'Промена', key: 'Enter', act: { row: 'a[data-open]' }, title: 'Отвори ја избраната калкулација' },
        { label: '📎 Документ (скен / PDF)', act: { row: 'a[data-att]' }, title: 'Скенираниот документ / PDF на избраната фактура' },
        { label: '👁 Калкулација', act: { row: 'a[data-print]' }, title: 'Калкулација на избраната (печатење / PDF)' },
        { label: 'Бришење', key: 'Delete', act: { row: '[data-del] button' }, cls: 'danger', title: 'Избриши ја избраната калкулација (со налогот и приемот)' },
      ] },
      { title: 'Комерцијално', items: [
        { label: 'Наплати', key: 'F4', act: { ev: 'pay' }, title: 'Плаќање на избраната фактура: платен налог, извод, компензација, картица' },
        { label: 'Масовна наплата', act: { href: '/ppNal' }, title: 'Платни налози за неплатените фактури' },
        { label: 'Книга на фактури', key: 'F2', act: { href: '/ddvKnigi?t=in' }, title: 'Книга на влезни фактури (ДДВ)' },
        { label: 'Спецификација по комитенти', key: 'F3', act: { href: '/analitika' }, title: 'Аналитика / ИОС по комитенти' },
        { label: 'Набавени производи', key: 'F6', act: { href: '/g_kartica' }, title: 'Картица на артикл (влезови по артикл)' },
        { label: 'Преглед по налози', act: { href: '/nalozi' }, title: 'Налози за книжење' },
        { label: 'По документи', act: { href: '/arhiva' }, title: 'Архива на документи' },
      ] },
    ],
    menu: [
      { label: 'Специјални опции', items: [
        { label: 'Масовно книжење на селектирани калкулации', act: { href: '/rekniz' } },
        { label: 'Масовно доделување на терк и налог', act: canWrite ? { ev: 'mass-nalog' } : { off: ro } },
        { label: 'Масовно доделување на датум и валута', act: canWrite ? { ev: 'mass-date' } : { off: ro } },
        { label: 'Масовно доделување на организациона единица', act: { off: NOT } },
        { label: 'Направи нарачка од предвидување', act: { href: '/porachki' } },
        { label: 'Печатење книга на влезни фактури', act: { href: '/ddvKnigi?t=in' } },
        { label: 'Импорт на влезни калкулации од ексел Девизни', act: canWrite ? { href: '/vlez?px=imp' } : { off: ro } },
        { label: 'Масовно печатење на откупни белешки', act: { off: NOT } },
        { label: 'Експорт во ексел образец 13', act: { off: NOT } },
        { label: 'Импорт на влезни калкулации од Ексел', act: { href: '/uvoz?t=purchases&back=vlez' } },
        { label: 'Префрлање во трговска книга материјално (селектирани)', act: { href: '/g_trgv' } },
        { label: '+ Увозна (девизна)', act: canWrite ? { href: '/vlez?imp' } : { off: ro }, cls: 'hx-sep' },
        { label: '+ Рачен внес', act: canWrite ? { href: '/vlez?nov' } : { off: ro } },
        { label: '📥 Фактура со ставки од Excel', act: canWrite ? { href: '/vlez?px' } : { off: ro } },
        { label: '📷 Масовно скенирање', act: { href: '/masovno' } },
      ] },
      { label: 'Корекција за наплати', items: [
        { label: 'Корекција за наплати за селектирани калкулации', act: { ev: 'pay' }, title: 'Плаќање на избраната калкулација (F4)' },
        { label: 'Корекција за наплатено за селектирани калкулации', act: { href: '/banka' }, title: 'Плаќањата се поврзуваат од изводите / касата' },
        { label: 'Компензации', act: { href: '/kompenzacii' }, cls: 'hx-sep' },
        { label: 'Повратница до добавувач', act: { href: '/povratDob' } },
        { label: 'Платни налози', act: { href: '/ppNal' } },
      ] },
      { label: 'Безбедност', items: [
        { label: 'Отклучување на една калкулација', act: { href: '/zatvoranje' }, title: LOCK },
        { label: 'Заклучување на селектираните калкулации', act: { href: '/zatvoranje' }, title: LOCK },
        { label: 'Масовно отклучување на селектирани калкулации', act: { href: '/zatvoranje' }, title: LOCK },
        { label: 'Отклучување на калкулација обработена од страна на книговодител', act: { href: '/zatvoranje' }, title: LOCK },
        { label: 'Масовно отклучување на калкулации обработени од страна на книговодител', act: { href: '/zatvoranje' }, title: LOCK },
        { label: 'Евиденција на активности', act: { href: '/aktivnost' }, cls: 'hx-sep' },
      ] },
      { label: 'Сортирање', items: [
        { label: 'Сортирање по датум', act: { href: '/vlez?sort=date' } },
        { label: 'Сортирање по број', act: { href: '/vlez?sort=no' } },
        { label: 'По комитент', act: { href: '/vlez?sort=p' }, cls: 'hx-sep' },
        { label: 'По износ', act: { href: '/vlez?sort=amt' } },
      ] },
      { label: 'Останато', items: [
        { label: 'Масовно печатење на влезни калкулации (селектирани)', act: { fn: 'print' } },
        { label: 'Број на влезни калкулации', act: { href: '/vlez?vid=all' } },
        { label: 'Избор на увоз', act: canWrite ? { href: '/vlez?imp' } : { off: ro } },
        { label: 'Печатење на евиденција за откуп', act: { off: NOT } },
        { label: 'Печатење на потврда за откуп', act: { off: NOT } },
        { label: '💶 Фискални сметки – готовина 1020', act: { href: '/vlez?vid=k' }, cls: 'hx-sep' },
        { label: '👁 Калкулација на избраната', act: { row: 'a[data-print]' } },
      ] },
      { label: 'Копирање', items: [
        { label: 'Префрлање во книга на влезни ф-ри (селектирани)', act: { href: '/ddvKnigi?t=in' } },
        { label: 'Копирање на калкулацијата во излез', act: { off: NOT } },
        { label: 'Спојување на селектираните калкулации', act: { off: NOT } },
        { label: 'Копирање во малопродажба (K)', act: { href: '/m_izlez' } },
        { label: 'Префрлање во ЕТ (F8)', act: { href: '/g_trgv' } },
        { label: 'Копирање на Увоз во малопродажба', act: { off: NOT } },
        { label: 'Бришење на селектираните калкулации', act: { off: 'Штиклирајте ги калкулациите и избришете ги од менито / „⋯“ на редот.' }, cls: 'hx-sep' },
      ] },
      { label: 'Е-Фактура', items: [
        { label: 'Преземи PDF документ', act: { row: 'a[data-print]' } },
        { label: 'Отвори PDF документ за калкулација', act: { row: 'a[data-att]' } },
        { label: 'Увоз на е-фактура (UBL XML)', act: { href: '/efaktura' }, cls: 'hx-sep' },
      ] },
    ],
    bottom: [
      { label: 'Прекнижување', key: 'F5', act: { href: '/rekniz' }, title: 'Рекнижење во маса' },
      { label: 'Главна книга', key: 'F7', act: { href: '/kartici' }, title: 'Картици на конта (главна книга)' },
      { label: 'Филтер', key: 'F11', act: { fn: 'filter' }, title: 'Барање по број или добавувач' },
      { label: 'Освежување на податоците', key: 'F1', act: { fn: 'refresh' } },
    ],
  };
}

export function VlezListKeys({ tableId, canWrite, wh, filterId, head, children, menuExtra, filter, filterOpen }: {
  tableId: string; canWrite: boolean; wh?: HxWh | null; filterId?: string; head?: React.ReactNode; children?: React.ReactNode;
  menuExtra?: Record<string, React.ReactNode>; filter?: React.ReactNode; filterOpen?: boolean;
}) {
  const [pay, setPay] = useState<HTMLTableRowElement | null>(null);
  const cfg = useMemo(() => vlezHelix(canWrite, !!wh && wh.options.length > 2), [canWrite, wh]);
  useEffect(() => {
    const payE = (e: Event) => { const tr = (e as CustomEvent<HTMLTableRowElement | null>).detail; if (tr) setPay(tr); };
    window.addEventListener('hx:pay', payE);
    return () => window.removeEventListener('hx:pay', payE);
  }, []);
  return (
    <>
      <HelixShell tableId={tableId} groups={cfg.groups} menu={cfg.menu} bottom={cfg.bottom} wh={wh} exitHref="/" filterId={filterId} head={head} menuExtra={menuExtra} filter={filter} filterOpen={filterOpen}>{children}</HelixShell>
      {canWrite && <MassAssignDialog tableId={tableId} kind="purchase" today={new Date().toISOString().slice(0, 10)} />}
      {pay && <PayDialog tr={pay} title="Плаќање – фактура" onClose={() => setPay(null)} links={[
        { label: '💳 Платен налог (ПП30)', href: '/ppNal', pri: true, title: 'Платен налог за добавувачот' },
        { label: '🏦 Поврзи со извод (банка)', href: '/banka' },
        { label: '↔ Компензација', href: '/kompenzacii' },
        ...(pay.dataset.pid ? [{ label: '📒 Картица на добавувачот', href: `/akart?k=22&pid=${pay.dataset.pid}` }] : []),
      ]} />}
    </>
  );
}
