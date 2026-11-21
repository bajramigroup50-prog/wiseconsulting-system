'use client';
/**
 * „Преглед на излезни калкулации“ (Материјално › Излез) like the old program (Helix), on `HelixShell`: the menu bar,
 * „Магацин“, the panel Смени магацин · Содржина (F10) · Нова (Ins) · Промена (Ent) · Бришење (Del) · Испрати
 * е-Фактура · Комерцијално (Наплати F4, Масовна наплата, Масовна наплата на курсни разлики, Книга на фактури F2,
 * Спецификација по комитенти F3, Промет по производи F6) · Продажба (Парагон, Промет, Прегл. по налози), and the
 * bottom bar (Селекција * + - F, Прекнижување F5, Главна книга F7, Филтер F12, F1 освежување, Излез Esc).
 *
 * „Нова (Ins)“ / „Промена (Ent)“ open the dialog „Нова услужна калкулација“ (tabs Основно / Дополнително): „Во ред (F9)“
 * saves the header (`saveInvoiceHeadAction`) and a new one opens its lines in the invoice editor. Works on the
 * server-rendered rows (`tr[data-id]` with `data-head` = the header as JSON, `data-paid` / `data-rest` / `data-total`).
 */
import { NalogPicker } from '@/components/nalog-picker';
import { MassAssignDialog } from './mass-assign-dialog';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { CURRENCIES, PAYM } from '@wise/core/sales';
import { nextInvoiceNumberAction, saveInvoiceHeadAction } from '@/app/(app)/izlez/head-actions';
import { HelixShell, type HxBtn, type HxGroup, type HxMenu, type HxWh } from '@/components/helix/helix-shell';

const nf = new Intl.NumberFormat('mk-MK', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** The header of the dialog (the names of the form fields of `saveInvoiceHeadAction`). */
export interface InvHead {
  id: string; number: string; nalogNo: string; oe: string; partnerId: string; refDoc: string; archNo: string; date: string; days: string; due: string;
  procDate: string; scheme: string; currency: string; fx: string; advPaid: string; payMethod: string; saldo: 'Д' | 'Н'; tip: 'final' | 'advance';
  note1: string; note2: string; note3: string; workOrder: string; attachNote: string; descr: string;
  grp1: string; grp2: string; costType: string; finNote: string; art32: boolean;
}

export const blankHead = (date: string, number = ''): InvHead => ({
  id: '', number, nalogNo: '', oe: '', partnerId: '', refDoc: '', archNo: '', date, days: '', due: '', procDate: date, scheme: '', currency: 'MKD', fx: '1',
  advPaid: '', payMethod: 'Вирман', saldo: 'Н', tip: 'final', note1: '', note2: '', note3: '', workOrder: '', attachNote: '', descr: '',
  grp1: '', grp2: '', costType: '', finNote: '', art32: false,
});

const addDays = (d: string, n: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || n === '' || !/^\d+$/.test(n)) return '';
  const t = new Date(d + 'T00:00:00Z');
  t.setUTCDate(t.getUTCDate() + Number(n));
  return t.toISOString().slice(0, 10);
};
const daysBetween = (a: string, b: string) => (/^\d{4}-\d{2}-\d{2}$/.test(a) && /^\d{4}-\d{2}-\d{2}$/.test(b) ? String(Math.round((Date.parse(b) - Date.parse(a)) / 864e5)) : '');

export interface PartnerOpt { id: string; code: string | null; name: string; edb?: string | null }
export interface NalogOpt { number: string; description: string }
export interface SchemeOpt { no: number; label: string }

const NOT = 'Оваа опција од старата програма уште ја нема во WISE.';
const LOCK = 'Во WISE се заклучува по период (Затворање / заклучување) – документите во заклучен период не се менуваат.';
const COPY_OFF = 'Копирање на фактура во нова уште не постои во WISE – користете „Во фактура“ од профактура / испратница.';

/** The Helix controls of Излез mapped to WISE (exported for the tests). */
export function izlezHelix(view: string, canWrite: boolean, hasWh: boolean): { groups: HxGroup[]; menu: HxMenu[]; bottom: HxBtn[] } {
  const ro = 'Немате право на внес во оваа фирма.';
  return {
    groups: [
      { items: [
        { label: 'Смени магацин', act: hasWh ? { fn: 'wh' } : { off: 'Фирмата нема посебни магацини / продавници (Шифрарник › Магацини).' } },
        { label: 'Содржина', key: 'F10', act: { row: 'a[data-open]' }, title: 'Ставките (содржината) на избраната фактура' },
        { label: 'Нова', key: 'Insert', act: canWrite ? { ev: 'neu' } : { off: ro }, cls: 'pri', title: 'Нова услужна калкулација: заглавје, па ставки' },
        { label: 'Промена', key: 'Enter', act: { ev: 'change' }, title: 'Податоци (заглавје) на избраната фактура' },
        { label: 'Бришење', key: 'Delete', act: { row: '[data-del] button' }, cls: 'danger', title: 'Избриши ја избраната фактура' },
      ] },
      { items: [
        { label: 'Испрати е-Фактура', act: { row: 'a[data-ubl]' }, title: 'UBL е-фактура (XML) на избраната фактура – за Е-ФАКТУРА (WISE не ја праќа сам до УЈП)' },
        { label: '👁 Види фактура / PDF', act: { row: 'a[data-print]' }, title: 'Преглед, печатење и PDF на избраната фактура' },
        { label: '✉ Испрати по е-пошта', act: { row: 'a[data-mail]' }, title: 'PDF на избраната фактура по е-пошта (само прокнижена)' },
      ] },
      { title: 'Комерцијално', items: [
        { label: 'Наплати', key: 'F4', act: { ev: 'pay' }, title: 'Наплата на избраната фактура: извод, каса, компензација, картица' },
        { label: 'Масовна наплата', act: { href: '/banka' }, title: 'Изводи: приливите автоматски се поврзуваат со фактурите' },
        { label: 'Масовна наплата на курсни разлики', act: { href: '/kursRaz' }, title: 'Курсни разлики на девизните побарувања' },
        { label: 'Книга на фактури', key: 'F2', act: { href: '/ddvKnigi?t=out' }, title: 'Книга на излезни фактури (ДДВ)' },
        { label: 'Спецификација по комитенти', key: 'F3', act: { href: '/analitika' }, title: 'Аналитика / ИОС по комитенти' },
        { label: 'Промет по производи', key: 'F6', act: { href: '/analizi' }, title: 'Анализи: продажба по производи' },
      ] },
      { title: 'Продажба', items: [
        { label: 'Парагон', act: { href: '/m_izlez' }, title: 'Излез од продавница (парагон блок)' },
        { label: 'Промет', act: { href: '/g_trgv' }, title: 'Евиденција во трговијата на големо (ЕТ)' },
        { label: 'Прегл. по налози', act: { href: '/nalozi' }, title: 'Налози за книжење' },
      ] },
    ],
    menu: [
      { label: 'Специјални опции', items: [
        { label: 'Масовно книжење', act: { href: '/rekniz' }, title: 'Рекнижење во маса (нацртите се прокнижуваат со ✓ на редот)' },
        { label: 'Масовно доделување на терк и налог', act: canWrite ? { ev: 'mass-nalog' } : { off: ro } },
        { label: 'Масовно доделување на комитент', act: canWrite ? { ev: 'mass-partner' } : { off: ro } },
        { label: 'Масовно доделување на тип на калкулација', act: { off: NOT } },
        { label: 'Масовно доделување на датум и валута', act: canWrite ? { ev: 'mass-date' } : { off: ro } },
        { label: 'Структурен увид', act: { href: '/analizi' }, cls: 'hx-sep' },
        { label: 'Масовно прекнижување на селектирани калкулации во сите магацини', act: { href: '/rekniz' } },
        { label: 'Образец за месечна евиденција на отпад од пакување', act: { off: NOT } },
        { label: 'Креирај Понуда/Нарачка спрема добавувач', act: { href: '/porachki' } },
        { label: 'Реализација уплати по комерцијалист', act: { href: '/analizi' } },
        { label: 'Пресметка на цени за селектирани калкулации', act: { href: '/kalkCalc' } },
        { label: 'Масовно креирање на калк. по комитент', act: { href: '/periodicni' } },
        { label: 'Креирај збирна фактура', act: { off: NOT } },
        { label: 'Креирај збирна фактура за главен комитент', act: { off: NOT } },
        { label: 'Импорт на калкулации од Ексел', act: { href: `/uvoz?t=invoices&back=${view.slice(1)}` } },
        { label: 'Креирање документ од царинска декларација', act: { off: NOT } },
        { label: 'Генерирање на архивски број за минати документи', act: { off: NOT } },
        { label: 'Креирање збирна фактура по царинска декларација', act: { off: NOT } },
        { label: 'Печатење на опомени за неплатени ф-ри', act: { href: '/opomeni' } },
        { label: 'Импорт на излезни калкулации од Excel', act: { href: `/uvoz?t=invoices&back=${view.slice(1)}` } },
        { label: 'Креирај фактура од резервација', act: { off: NOT } },
        { label: 'Копирање на калкулација во нова калкулација', act: { off: COPY_OFF } },
        { label: 'Креирај преносница во продавница', act: { href: '/prenos' } },
        { label: 'Масовно креирање на услужни фактури по комитенти', act: { href: '/periodicni' } },
        { label: 'Креирај производна калкулација за период', act: canWrite ? { href: '/izlez?nov&prod=1' } : { off: ro } },
        { label: 'Референтни документи за калкулација', act: { row: 'a[data-att]' } },
        { label: 'Префрлање во трговска книга материјално (селектирани)', act: { href: '/g_trgv' } },
        { label: '✉ Испрати ја избраната по е-пошта', act: { row: 'a[data-mail]' }, cls: 'hx-sep' },
        { label: '📷 Прочитај / скенирај фактури (PDF)', act: { href: '/skan?k=sale' } },
        { label: 'Изглед на фактура…', act: { href: view + '?style' } },
      ] },
      { label: 'Корекција за наплата', items: [
        { label: 'Корекција за наплата', act: { ev: 'pay' }, title: 'Наплата на избраната фактура (F4)' },
        { label: 'Корекција на наплатено', act: { href: '/banka' }, title: 'Наплатата се поврзува од изводите / касата' },
        { label: 'Одобрение кон избраната фактура', act: { row: 'a[data-cr]' }, cls: 'hx-sep' },
        { label: 'Компензации', act: { href: '/kompenzacii' } },
      ] },
      { label: 'Прегледи', items: [
        { label: 'Книга на дневни финансиски извештаи', act: { href: '/fiskPer' } },
        { label: 'Книга на излезни фактури', act: { href: '/ddvKnigi?t=out' }, cls: 'hx-sep' },
        { label: 'Аналитика по комитенти (ИОС)', act: { href: '/analitika' } },
      ] },
      { label: 'Безбедност', items: [
        { label: 'Отклучување на една калкулација', act: { href: '/zatvoranje' }, title: LOCK },
        { label: 'Заклучување на селектирани калкулации', act: { href: '/zatvoranje' }, title: LOCK },
        { label: 'Масовно отклучување на селектирани калкулации', act: { href: '/zatvoranje' }, title: LOCK },
        { label: 'Отклучување на калкулација која е книговодствено обработена', act: { href: '/zatvoranje' }, title: LOCK },
        { label: 'Масовно отклучување на книговодствено обработени калк.', act: { href: '/zatvoranje' }, title: LOCK },
        { label: 'Евиденција на активности', act: { href: '/aktivnost' }, cls: 'hx-sep' },
      ] },
      { label: 'Сортирање', items: [
        { label: 'Сортирање по документ', act: { href: view + '?sort=doc' } },
        { label: 'Сортирање по наплатено', act: { href: view + '?sort=paid' } },
        { label: 'Сортирање по приоритет', act: { href: view + '?sort=prio' } },
        { label: 'По број', act: { href: view + '?sort=no' }, cls: 'hx-sep' },
        { label: 'По датум', act: { href: view + '?sort=date' } },
        { label: 'По комитент', act: { href: view + '?sort=p' } },
        { label: 'По износ', act: { href: view + '?sort=amt' } },
      ] },
      { label: 'Копирање', items: [
        { label: 'Префрлање во книга на излезни калкулации (селектирани)', act: { href: '/ddvKnigi?t=out' } },
        { label: 'Копирање на калкулација во калкулација', act: { off: COPY_OFF } },
        { label: 'Копирање на селектираните калкулации во еден малопродажен парагон', act: { href: '/m_izlez' } },
        { label: 'Копирање на селектираните калкулации во една малопродажна приемница', act: { off: NOT } },
        { label: 'Копирање на селектираните калкулации во малопродажни фактури', act: { off: NOT } },
        { label: 'Спојување на селектираните калкулации', act: { off: NOT } },
        { label: 'Копирање во малопродажба (K)', act: { href: '/m_izlez' } },
        { label: 'Бришење на селектираните калкулации', act: { off: 'Штиклирајте ги фактурите и „🗑 Избриши ги избраните“ под табелата.' }, cls: 'hx-sep' },
        { label: 'Копирање на селектирани калкулации', act: { off: COPY_OFF } },
        { label: 'Копирање на селектирани калкулации во малопродажни приемници по датум', act: { off: NOT } },
        { label: 'Копирање на селектирани калкулации во малопродажни парагони по датум', act: { off: NOT } },
      ] },
      { label: 'Печатење', items: [
        { label: '👁 Види / PDF / печатење на избраната', act: { row: 'a[data-print]' } },
        { label: '📎 Скениран документ на избраната', act: { row: 'a[data-att]' } },
        { label: 'Печати ја листата', act: { fn: 'print' } },
      ] },
      { label: 'Останато', items: [
        { label: 'Книга на фактури за производи излезени со тарифа нула', act: { href: '/ddvKnigi?t=out' } },
        { label: 'Проверка на неискнижени калкулации', act: { href: '/kontroli' } },
        { label: 'Корекција на Главен комитет', act: { off: NOT } },
        { label: 'Целодневен Извештај', act: { href: '/izvestai' } },
        { label: 'Бришење на калкулации - САЛДО', act: { off: NOT }, cls: 'hx-sep' },
        { label: 'Експорт дистриб. произ. (Excel)', act: { off: NOT } },
        { label: 'Корекција на паритет и услови за плаќање', act: { off: NOT } },
        { label: 'Профактури', act: { href: '/profakturi' }, cls: 'hx-sep' },
        { label: 'Испратници', act: { href: '/ispratnici' } },
      ] },
      { label: 'Е-Фактура', items: [
        { label: 'Испрати една е-Фактура за позиционирана фактура', act: { row: 'a[data-ubl]' } },
        { label: 'Преземи PDF документ', act: { row: 'a[data-print]' } },
        { label: 'Отвори PDF документ за калкулација', act: { row: 'a[data-att]' } },
        { label: 'Извоз на повеќе фактури (ZIP) / увоз на XML', act: { href: '/efaktura' }, cls: 'hx-sep' },
      ] },
    ],
    bottom: [
      { label: 'Прекнижување', key: 'F5', act: { href: '/rekniz' }, title: 'Рекнижење во маса' },
      { label: 'Главна книга', key: 'F7', act: { href: '/kartici' }, title: 'Картици на конта (главна книга)' },
      { label: 'Филтер', key: 'F12', act: { fn: 'filter' }, title: 'Барање по број, комитент или шифра' },
      { label: 'Останати опции', act: { href: '/izvestai' }, cls: 'ghost', title: 'Сите извештаи и опции' },
      { label: 'Освежување на податоците', key: 'F1', act: { fn: 'refresh' } },
    ],
  };
}

export function InvoiceListKeys({ tableId, canWrite, today, svc, view, partners, nalozi, schemes, nextNumber, firmName, wh, filterId, head, children, menuExtra, filter, filterOpen }: {
  tableId: string; canWrite: boolean; today: string; svc: boolean; view: string; partners: PartnerOpt[]; nalozi: NalogOpt[]; schemes: SchemeOpt[];
  nextNumber: string; firmName: string; wh?: HxWh | null; filterId?: string; head?: React.ReactNode; children?: React.ReactNode;
  menuExtra?: Record<string, React.ReactNode>; filter?: React.ReactNode; filterOpen?: boolean;
}) {
  const router = useRouter();
  const [dlg, setDlg] = useState<InvHead | null>(null);
  const [pay, setPay] = useState<HTMLTableRowElement | null>(null);
  const cfg = useMemo(() => izlezHelix(view, canWrite, !!wh && wh.options.length > 2), [view, canWrite, wh]);

  useEffect(() => {
    const openRow = (tr: HTMLTableRowElement | null) => { const a = tr?.querySelector<HTMLAnchorElement>('a[data-open]'); if (a) router.push(a.getAttribute('href')!); };
    const neu = () => { if (canWrite) setDlg(blankHead(today, nextNumber)); };
    const change = (e: Event) => {
      const tr = (e as CustomEvent<HTMLTableRowElement | null>).detail;
      if (!tr) return;
      // a production / cancelled invoice (or no right to write): the invoice itself
      if (!canWrite || tr.dataset.prod || tr.dataset.canc || !tr.dataset.head) { openRow(tr); return; }
      try { setDlg({ ...blankHead(today), ...(JSON.parse(tr.dataset.head) as Partial<InvHead>) }); } catch { openRow(tr); }
    };
    const payE = (e: Event) => { const tr = (e as CustomEvent<HTMLTableRowElement | null>).detail; if (tr) setPay(tr); };
    window.addEventListener('hx:neu', neu);
    window.addEventListener('hx:change', change);
    window.addEventListener('hx:pay', payE);
    return () => { window.removeEventListener('hx:neu', neu); window.removeEventListener('hx:change', change); window.removeEventListener('hx:pay', payE); };
  }, [canWrite, today, nextNumber, router]);

  return (
    <>
      <HelixShell tableId={tableId} groups={cfg.groups} menu={cfg.menu} bottom={cfg.bottom} wh={wh} exitHref="/" filterId={filterId} head={head} menuExtra={menuExtra} filter={filter} filterOpen={filterOpen}>{children}</HelixShell>
      {canWrite && <MassAssignDialog tableId={tableId} kind="invoice" partners={partners} schemes={schemes} today={today} />}
      {dlg && <InvoiceHeadDialog key={dlg.id || 'new'} head={dlg} svc={svc} partners={partners} nalozi={nalozi} schemes={schemes} firmName={firmName}
        onClose={() => setDlg(null)}
        onDone={(id, isNew) => {
          setDlg(null);
          // a new one: its lines („Содржина“) in the invoice editor; a changed one: the list again, selected
          if (isNew) router.push(`${view}?edit=${id}&drafted=1`);
          else { router.push(`${view}?saved=${id}`); router.refresh(); }
        }} />}
      {pay && <PayDialog tr={pay} onClose={() => setPay(null)} links={[
        { label: '🏦 Наплата преку извод (банка)', href: '/banka', pri: true, title: 'Приливот од изводот се поврзува со фактурата (автоматски или рачно)' },
        { label: '💵 Наплата во готово (благајна)', href: '/blagajna' },
        { label: '↔ Компензација', href: '/kompenzacii' },
        ...(pay.dataset.pid ? [{ label: '📒 Картица на купувачот', href: `/akart?k=12&pid=${pay.dataset.pid}` }] : []),
        ...(Number(pay.dataset.rest) > 0.009 ? [{ label: '⏰ Опомена', href: `/opomeni?ids=${pay.dataset.id}` }] : []),
      ]} />}
    </>
  );
}

export interface PayLink { label: string; href: string; pri?: boolean; title?: string }

/** „Наплати (F4)“: what is paid / left on the selected document and where the payment is recorded in WISE. */
export function PayDialog({ tr, onClose, links, title = 'Наплата – фактура', cur }: { tr: HTMLTableRowElement; onClose: () => void; links: PayLink[]; title?: string; cur?: string }) {
  const d = tr.dataset;
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => { ref.current?.focus(); }, []);
  return (
    <div role="dialog" aria-modal="true" aria-label="Наплата на фактура" onKeyDown={(e) => { if (e.key === 'Escape' || e.key === 'F4') { e.preventDefault(); onClose(); } }}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.25)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
      <div className="card" style={{ width: 'min(480px, 94vw)', padding: 16, margin: 0 }}>
        <h2 style={{ marginTop: 0 }}>{title} {d.no}</h2>
        <p style={{ margin: '0 0 10px' }}>{d.pname}</p>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '4px 16px' }} data-testid="pay-sums">
          <span>За наплата</span><b className="n">{nf.format(Number(d.total) || 0)}{cur ? ' ' + cur : ''}</b>
          <span>Наплатено</span><b className="n">{nf.format(Number(d.paid) || 0)}</b>
          <span>Останува</span><b className="n" style={Number(d.rest) > 0.009 ? { color: 'var(--bad)' } : undefined}>{nf.format(Number(d.rest) || 0)}</b>
        </div>
        <div style={{ display: 'grid', gap: 6, marginTop: 14 }}>
          {links.map((l) => <a key={l.href} className={'btn' + (l.pri ? ' pri' : '')} href={l.href} title={l.title}>{l.label}</a>)}
        </div>
        <div className="row" style={{ marginTop: 14 }}><button ref={ref} type="button" className="btn" style={{ flex: 1 }} onClick={onClose}>Излез (Esc)</button></div>
      </div>
    </div>
  );
}


const PField = ({ label, id, children, span }: { label: string; id?: string; children: React.ReactNode; span?: number }) => (
  <>
    <label htmlFor={id} style={{ whiteSpace: 'nowrap' }}>{label}</label>
    <div style={span ? { gridColumn: `span ${span}` } : undefined}>{children}</div>
  </>
);

const yel = { background: 'var(--warn-bg, #fffbe0)' };

/** „Нова услужна калкулација“: tabs Основно / Дополнително · „Излез (Esc)“ · „Опис“ · „Во ред (F9)“. */
export function InvoiceHeadDialog({ head, svc, partners, nalozi, schemes, firmName, onClose, onDone }: {
  head: InvHead; svc: boolean; partners: PartnerOpt[]; nalozi: NalogOpt[]; schemes: SchemeOpt[]; firmName?: string;
  onClose: () => void; onDone: (id: string, isNew: boolean) => void;
}) {
  const [h, setH] = useState<InvHead>(head);
  const [tab, setTab] = useState<'osn' | 'dop'>('osn');
  const [opis, setOpis] = useState(!!head.descr);
  const [st, setSt] = useState<{ error?: string }>({});
  const [pending, setPending] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const noRef = useRef<HTMLInputElement>(null);
  const pRef = useRef<HTMLInputElement>(null);
  const [hint, setHint] = useState('');
  const label = (p: PartnerOpt) => `${p.code ? p.code + ' · ' : ''}${p.name}`;
  const pById = useMemo(() => new Map(partners.map((p) => [p.id, p])), [partners]);
  const [pq, setPq] = useState(() => { const p = pById.get(head.partnerId); return p ? label(p) : ''; });
  const set = (x: Partial<InvHead>) => setH((o) => ({ ...o, ...x }));
  useEffect(() => { noRef.current?.focus(); }, []);
  // saved → navigate right away (the list re-renders after the save and may remount this dialog)
  const submit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (pending) return;
    setPending(true);
    try {
      const r = await saveInvoiceHeadAction({}, new FormData(e.currentTarget));
      if (r.ok && r.id) onDone(r.id, !h.id); else setSt({ error: r.error ?? 'Не е зачувано.' });
    } finally { setPending(false); }
  };

  const pickPartner = (v: string) => {
    setPq(v);
    const t = v.trim().toLowerCase();
    const m = partners.find((p) => label(p).toLowerCase() === t) ?? partners.find((p) => (p.code ?? '').toLowerCase() === t && t !== '');
    set({ partnerId: m?.id ?? '' });
  };
  const gen = async (field: 'number' | 'refDoc') => {
    const r = await nextInvoiceNumberAction(h.date);
    if (r.no) { set({ [field]: r.no } as Partial<InvHead>); setHint(''); } else setHint(r.error ?? '');
  };
  const onKey = (e: React.KeyboardEvent) => {
    const t = e.target as HTMLElement;
    if (e.key === 'Escape') { e.preventDefault(); onClose(); }
    else if (e.key === 'F9') { e.preventDefault(); formRef.current?.requestSubmit(); }
    else if (e.key === 'F8') { e.preventDefault(); setTab('osn'); setTimeout(() => { pRef.current?.focus(); pRef.current?.select(); }, 0); }
    else if (e.key === 'F5' && (t.id === 'hd_no' || t.id === 'hd_ref')) { e.preventDefault(); void gen(t.id === 'hd_no' ? 'number' : 'refDoc'); }
    else if (e.key === 'Enter' && t.tagName === 'INPUT' && (t as HTMLInputElement).type !== 'radio' && (t as HTMLInputElement).type !== 'checkbox') {
      // Enter moves to the next field (like the old program); on the last field it confirms
      e.preventDefault();
      const pane = t.closest('[data-pane]');
      const F = [...(pane?.querySelectorAll<HTMLElement>('input:not([type=hidden]):not([type=radio]):not([type=checkbox]), select') ?? [])].filter((x) => !(x as HTMLInputElement).disabled);
      const i = F.indexOf(t);
      if (i >= 0 && i < F.length - 1) F[i + 1]!.focus(); else formRef.current?.requestSubmit();
    }
  };
  const P = pById.get(h.partnerId);
  return (
    <div role="dialog" aria-modal="true" aria-label="Нова услужна калкулација" onKeyDown={onKey}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.25)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
      <form ref={formRef} onSubmit={(e) => void submit(e)} className="card" style={{ width: 'min(760px, 96vw)', maxHeight: '94vh', overflow: 'auto', padding: 16, margin: 0 }}>
        <h2 style={{ marginTop: 0, marginBottom: 4 }}>{h.id ? 'Промена на услужна калкулација' : 'Нова услужна калкулација'}</h2>
        {firmName && <div className="mini muted" style={{ marginBottom: 8 }}>{firmName}</div>}
        {/* every field is sent from the state, whatever tab is open */}
        {h.id && <input type="hidden" name="id" value={h.id} />}
        {svc && <input type="hidden" name="svc" value="1" />}
        <input type="hidden" name="partnerId" value={h.partnerId} />
        <input type="hidden" name="saldo" value={h.saldo} />
        <input type="hidden" name="tip" value={h.tip} />
        {h.art32 && <input type="hidden" name="art32" value="1" />}
        {(['grp1', 'grp2', 'costType', 'finNote', 'descr'] as const).map((k) => <input key={k} type="hidden" name={k} value={h[k]} />)}
        {st.error && <div className="callout bad" role="alert">{st.error}</div>}
        <div className="row" role="tablist" style={{ gap: 4, marginBottom: 10 }}>
          <button type="button" role="tab" aria-selected={tab === 'osn'} className={'btn sm' + (tab === 'osn' ? ' pri' : '')} onClick={() => setTab('osn')}>Основно</button>
          <button type="button" role="tab" aria-selected={tab === 'dop'} className={'btn sm' + (tab === 'dop' ? ' pri' : '')} onClick={() => setTab('dop')}>Дополнително</button>
        </div>

        <div data-pane="osn" hidden={tab !== 'osn'} style={{ display: tab === 'osn' ? 'grid' : 'none', gridTemplateColumns: 'auto 1fr auto 1fr', gap: '8px 10px', alignItems: 'center' }}>
          <PField label="Калкул. број (F5)" id="hd_no"><input id="hd_no" ref={noRef} name="number" value={h.number} onChange={(e) => set({ number: e.target.value })} placeholder="празно = следен број" style={yel} /></PField>
          <PField label="Налог" id="hd_nal">
            <NalogPicker id="hd_nal" name="nalogNo" value={h.nalogNo} date={h.date} preset={nalozi} onChange={(v) => set({ nalogNo: v })} />
          </PField>
          <PField label="ОЕ" id="hd_oe"><input id="hd_oe" name="oe" value={h.oe} onChange={(e) => set({ oe: e.target.value })} /></PField>
          <PField label="Архивски број" id="hd_arch"><input id="hd_arch" name="archNo" value={h.archNo} onChange={(e) => set({ archNo: e.target.value })} /></PField>
          <PField label="Комитент (F8)" id="hd_p" span={3}>
            <input id="hd_p" ref={pRef} list="hd_plist" value={pq} onChange={(e) => pickPartner(e.target.value)} placeholder="шифра или назив…" aria-label="Комитент" style={yel} autoComplete="off" />
            <datalist id="hd_plist">{partners.map((p) => <option key={p.id} value={label(p)}>{p.edb ?? ''}</option>)}</datalist>
            {pq && !P && <small className="mini" style={{ color: 'var(--bad)' }}>изберете од листата</small>}
            {P && <small className="mini muted" data-testid="hd-partner">{P.name}{P.edb ? ' · ЕДБ ' + P.edb : ''}</small>}
          </PField>
          <PField label="По документ (F5)" id="hd_ref"><input id="hd_ref" name="refDoc" value={h.refDoc} onChange={(e) => set({ refDoc: e.target.value })} /></PField>
          <PField label="Обработка" id="hd_proc"><input id="hd_proc" type="date" name="procDate" value={h.procDate} onChange={(e) => set({ procDate: e.target.value })} /></PField>
          <PField label="Датум" id="hd_date"><input id="hd_date" type="date" name="date" value={h.date} required onChange={(e) => set({ date: e.target.value, ...(h.days ? { due: addDays(e.target.value, h.days) } : {}) })} style={yel} /></PField>
          <PField label="Денови" id="hd_days"><input id="hd_days" name="days" inputMode="numeric" value={h.days} onChange={(e) => set({ days: e.target.value, due: addDays(h.date, e.target.value) || h.due })} style={{ maxWidth: 90 }} /></PField>
          <PField label="Валута (рок)" id="hd_due"><input id="hd_due" type="date" name="due" value={h.due} onChange={(e) => set({ due: e.target.value, days: daysBetween(h.date, e.target.value) })} /></PField>
          <PField label="Терк за книжење" id="hd_sch">
            <select id="hd_sch" name="scheme" value={h.scheme} onChange={(e) => set({ scheme: e.target.value })}>
              <option value="">Автоматски</option><option value="1">Шема 1 – основна</option>
              {schemes.map((s) => <option key={s.no} value={String(s.no)}>{s.label}</option>)}
            </select>
          </PField>
          <PField label="Валута" id="hd_cur">
            <select id="hd_cur" name="currency" value={h.currency} onChange={(e) => set({ currency: e.target.value, ...(e.target.value === 'MKD' ? { fx: '1' } : {}) })}>{CURRENCIES.map((c) => <option key={c}>{c}</option>)}</select>
          </PField>
          <PField label="Курс" id="hd_fx"><input id="hd_fx" name="fx" value={h.fx} disabled={h.currency === 'MKD'} onChange={(e) => set({ fx: e.target.value })} style={{ maxWidth: 120 }} /></PField>
          {h.currency === 'MKD' && <input type="hidden" name="fx" value="1" />}
          <PField label="Платен аванс" id="hd_adv"><input id="hd_adv" name="advPaid" inputMode="decimal" value={h.advPaid} onChange={(e) => set({ advPaid: e.target.value })} style={{ maxWidth: 140 }} /></PField>
          <PField label="Начин на плаќање" id="hd_pm">
            <select id="hd_pm" name="payMethod" value={h.payMethod} onChange={(e) => set({ payMethod: e.target.value })}>{[...new Set([h.payMethod, ...PAYM].filter(Boolean))].map((x) => <option key={x}>{x}</option>)}</select>
          </PField>
          <span>Салдо</span>
          <div className="row" style={{ gap: 12 }}>
            {(['Д', 'Н'] as const).map((v) => <label key={v} style={{ display: 'inline-flex', gap: 4, alignItems: 'center', margin: 0 }}><input type="radio" checked={h.saldo === v} onChange={() => set({ saldo: v })} style={{ width: 'auto', margin: 0 }} /> {v === 'Д' ? 'Да' : 'Не'}</label>)}
          </div>
          <span>Тип</span>
          <div className="row" style={{ gap: 12 }}>
            <label style={{ display: 'inline-flex', gap: 4, alignItems: 'center', margin: 0 }}><input type="radio" checked={h.tip === 'final'} onChange={() => set({ tip: 'final' })} style={{ width: 'auto', margin: 0 }} /> Завршна</label>
            <label style={{ display: 'inline-flex', gap: 4, alignItems: 'center', margin: 0 }}><input type="radio" checked={h.tip === 'advance'} onChange={() => set({ tip: 'advance' })} style={{ width: 'auto', margin: 0 }} /> Авансна</label>
          </div>
          <label htmlFor="hd_n1">Напомена</label>
          <div style={{ gridColumn: 'span 3', display: 'grid', gap: 4 }}>
            <input id="hd_n1" name="note1" value={h.note1} onChange={(e) => set({ note1: e.target.value })} aria-label="Напомена 1" />
            <input name="note2" value={h.note2} onChange={(e) => set({ note2: e.target.value })} aria-label="Напомена 2" />
            <input name="note3" value={h.note3} onChange={(e) => set({ note3: e.target.value })} aria-label="Напомена 3" />
          </div>
          <PField label="Раб. налог" id="hd_wo"><input id="hd_wo" name="workOrder" value={h.workOrder} onChange={(e) => set({ workOrder: e.target.value })} /></PField>
          <PField label="Прилог" id="hd_att"><input id="hd_att" name="attachNote" value={h.attachNote} onChange={(e) => set({ attachNote: e.target.value })} /></PField>
          {opis && <>
            <label htmlFor="hd_descr">Опис</label>
            <textarea id="hd_descr" rows={4} value={h.descr} onChange={(e) => set({ descr: e.target.value })} style={{ gridColumn: 'span 3' }} />
          </>}
        </div>

        <div data-pane="dop" hidden={tab !== 'dop'} style={{ display: tab === 'dop' ? 'grid' : 'none', gridTemplateColumns: 'auto 1fr', gap: '8px 10px', alignItems: 'center' }}>
          <PField label="Група 1" id="hd_g1"><input id="hd_g1" value={h.grp1} onChange={(e) => set({ grp1: e.target.value })} /></PField>
          <PField label="Група 2" id="hd_g2"><input id="hd_g2" value={h.grp2} onChange={(e) => set({ grp2: e.target.value })} /></PField>
          <PField label="Тип на трошок" id="hd_ct">
            <select id="hd_ct" value={h.costType} onChange={(e) => set({ costType: e.target.value })}>{[...new Set(['', 'Материјален', 'Нематеријален', 'Транспорт', 'Услуга', h.costType])].map((x) => <option key={x} value={x}>{x || '—'}</option>)}</select>
          </PField>
          <PField label="Забелешка (само за во финансово)" id="hd_fn"><input id="hd_fn" value={h.finNote} onChange={(e) => set({ finNote: e.target.value })} /></PField>
          <span />
          <label style={{ display: 'inline-flex', gap: 6, alignItems: 'center', margin: 0 }}>
            <input type="checkbox" checked={h.art32} onChange={(e) => set({ art32: e.target.checked })} style={{ width: 'auto', margin: 0 }} /> Фактура по член 32А без ДДВ
          </label>
        </div>

        {hint && <p className="mini" style={{ color: 'var(--bad)' }}>{hint}</p>}
        <div className="row" style={{ gap: 10, marginTop: 16, justifyContent: 'space-between' }}>
          <button type="button" className="btn" onClick={onClose} style={{ flex: 1 }}>Излез (Esc)</button>
          <button type="button" className={'btn' + (opis ? ' pri' : '')} onClick={() => { setOpis((o) => !o); setTab('osn'); }} style={{ flex: 1 }}>Опис</button>
          <button className="btn pri" disabled={pending} style={{ flex: 1 }}>Во ред (F9)</button>
        </div>
        <p className="mini muted" style={{ marginBottom: 0 }}>F5 = следен број · F8 = комитент · Enter = следно поле · {h.id ? 'ставките остануваат исти' : 'ставките се внесуваат потоа („Содржина“)'}.</p>
      </form>
    </div>
  );
}
