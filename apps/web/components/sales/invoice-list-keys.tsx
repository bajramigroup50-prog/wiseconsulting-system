'use client';
/**
 * „Преглед на услужни калкулации“ (Материјално › Излез) like the old program (Helix): the panel on the right with
 * „Содржина (F10)“ · „Нов (Ins)“ · „Промена (Ent)“ · „Бришење (Del)“ · „Испрати е-Фактура“ · „Наплати (F4)“ ·
 * „Книга на фактури (F2)“ · „Префрлање во книга на излези (F8)“, and the keyboard: ↑ ↓ select a row, Ins = Нов,
 * Enter = Промена, Del = Бришење (the row's own „🗑“ with its confirm), F10 = Содржина (the lines of the invoice).
 *
 * „Нов (Ins)“ / „Промена (Ent)“ open the dialog „Нова услужна калкулација“ (tabs Основно / Дополнително): „Во ред (F9)“
 * saves the header (`saveInvoiceHeadAction`) and a new one opens its lines in the invoice editor. Works on the
 * server-rendered rows (`tr[data-inv]` with `data-head` = the header as JSON, `data-paid` / `data-rest` / `data-total`).
 */
import { NalogPicker } from '@/components/nalog-picker';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { CURRENCIES, PAYM } from '@wise/core/sales';
import { nextInvoiceNumberAction, saveInvoiceHeadAction } from '@/app/(app)/izlez/head-actions';

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

export function InvoiceListKeys({ tableId, canWrite, today, svc, view, partners, nalozi, schemes, nextNumber, firmName }: {
  tableId: string; canWrite: boolean; today: string; svc: boolean; view: string; partners: PartnerOpt[]; nalozi: NalogOpt[]; schemes: SchemeOpt[];
  nextNumber: string; firmName: string;
}) {
  const router = useRouter();
  const [sel, setSel] = useState(0);
  const [dlg, setDlg] = useState<InvHead | null>(null);
  const [pay, setPay] = useState<HTMLTableRowElement | null>(null);
  const rows = () => [...(document.getElementById(tableId)?.querySelectorAll<HTMLTableRowElement>('tr[data-inv]') ?? [])];

  // the row just saved (`?saved=`) is the selected one; otherwise the last (newest) row
  useEffect(() => {
    const R = rows();
    const want = new URLSearchParams(window.location.search).get('saved');
    const i = want ? R.findIndex((tr) => tr.dataset.inv === want) : -1;
    setSel(i >= 0 ? i : Math.max(R.length - 1, 0));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const R = rows();
    R.forEach((tr, i) => {
      tr.setAttribute('aria-selected', String(i === sel));
      tr.style.outline = i === sel ? '2px solid var(--accent)' : '';
      tr.style.outlineOffset = '-2px';
    });
    R[sel]?.scrollIntoView?.({ block: 'nearest' });
  });

  const cur = () => rows()[sel];
  const follow = (q: string) => { const a = cur()?.querySelector<HTMLAnchorElement>(q); if (a) router.push(a.getAttribute('href')!); };
  const act = {
    lines: () => follow('a[data-open]'),
    neu: () => { if (canWrite) setDlg(blankHead(today, nextNumber)); },
    change: () => {
      const tr = cur();
      if (!tr) return;
      // a production / cancelled invoice (or no right to write): the invoice itself
      if (!canWrite || tr.dataset.prod || tr.dataset.canc || !tr.dataset.head) { follow('a[data-open]'); return; }
      try { setDlg({ ...blankHead(today), ...(JSON.parse(tr.dataset.head) as Partial<InvHead>) }); } catch { follow('a[data-open]'); }
    },
    del: () => cur()?.querySelector<HTMLButtonElement>('[data-del] button, button[data-del]')?.click(),
    ef: () => { const a = cur()?.querySelector<HTMLAnchorElement>('a[data-ubl]'); if (a) window.location.href = a.getAttribute('href')!; },
    pay: () => { const tr = cur(); if (tr) setPay(tr); },
    book: () => router.push('/ddvKnigi?t=out'),
    // „Префрлање во книга на излези“: a draft / pending invoice is booked (then it is in the output VAT book), a booked one
    // already is – the book opens
    toBook: () => {
      const b = cur()?.querySelector<HTMLButtonElement>('[data-approve] button, button[data-approve]');
      if (b) b.click(); else router.push('/ddvKnigi?t=out');
    },
  };

  useEffect(() => {
    const tb = document.getElementById(tableId);
    const click = (e: MouseEvent) => {
      const tr = (e.target as HTMLElement).closest?.('tr[data-inv]');
      if (tr) setSel(rows().indexOf(tr as HTMLTableRowElement));
    };
    const dbl = (e: MouseEvent) => { if ((e.target as HTMLElement).closest?.('tr[data-inv]') && !(e.target as HTMLElement).closest('a,button,input')) act.change(); };
    tb?.addEventListener('click', click);
    tb?.addEventListener('dblclick', dbl);
    const k = (e: KeyboardEvent) => {
      if (e.defaultPrevented || dlg || pay) return; // the dialogs have their own keys
      const tg = (e.target as HTMLElement)?.tagName;
      if (tg === 'INPUT' || tg === 'SELECT' || tg === 'TEXTAREA') return;
      const R = rows();
      const go = (f: () => void) => { e.preventDefault(); f(); };
      if (e.key === 'ArrowDown') go(() => setSel((s) => Math.min(s + 1, R.length - 1)));
      else if (e.key === 'ArrowUp') go(() => setSel((s) => Math.max(s - 1, 0)));
      else if (e.key === 'Insert') go(act.neu);
      else if (e.key === 'Enter' && tg !== 'BUTTON' && tg !== 'A' && tg !== 'SUMMARY') go(act.change);
      else if (e.key === 'Delete') go(act.del);
      else if (e.key === 'F10') go(act.lines);
      else if (e.key === 'F4') go(act.pay);
      else if (e.key === 'F2') go(act.book);
      else if (e.key === 'F8') go(act.toBook);
    };
    window.addEventListener('keydown', k);
    return () => { window.removeEventListener('keydown', k); tb?.removeEventListener('click', click); tb?.removeEventListener('dblclick', dbl); };
  });

  return (
    <>
      <aside className="card inv-panel noprint" aria-label="Излезни фактури – акции" style={{ position: 'sticky', top: 70, alignSelf: 'flex-start', display: 'flex', flexDirection: 'column', gap: 8, padding: 10, minWidth: 170 }}>
        <button type="button" className="btn" onClick={act.lines} title="Ставките (содржината) на избраната фактура">Содржина (F10)</button>
        <span style={{ height: 10 }} />
        {canWrite && <button type="button" className="btn pri" onClick={act.neu} title="Нова услужна калкулација: заглавје, па ставки">Нов (Ins)</button>}
        <button type="button" className="btn" onClick={act.change} title="Податоци (заглавје) на избраната фактура">Промена (Ent)</button>
        <button type="button" className="btn danger" onClick={act.del} title="Избриши ја избраната фактура">Бришење (Del)</button>
        <span style={{ height: 10 }} />
        <button type="button" className="btn" onClick={act.ef} title="UBL е-фактура (XML) на избраната фактура – за Е-ФАКТУРА">Испрати е-Фактура</button>
        <button type="button" className="btn" onClick={act.pay} title="Наплата на избраната фактура: извод, компензација, каса, картица">Наплати (F4)</button>
        <button type="button" className="btn" onClick={act.book} title="Книга на излезни фактури (ДДВ)">Книга на фактури (F2)</button>
        <button type="button" className="btn" onClick={act.toBook} title="Нацрт / внесена фактура: се книжи и влегува во книгата на излезни фактури; книжена: се отвора книгата">Префрлање во книга на излези (F8)</button>
        <span className="mini" style={{ marginTop: 6, lineHeight: 1.4 }}>↑ ↓ избор · Enter промена · двоен клик промена</span>
      </aside>
      {dlg && <InvoiceHeadDialog key={dlg.id || 'new'} head={dlg} svc={svc} partners={partners} nalozi={nalozi} schemes={schemes} firmName={firmName}
        onClose={() => setDlg(null)}
        onDone={(id, isNew) => {
          setDlg(null);
          // a new one: its lines („Содржина“) in the invoice editor; a changed one: the list again, selected
          if (isNew) router.push(`${view}?edit=${id}&drafted=1`);
          else { router.push(`${view}?saved=${id}`); router.refresh(); }
        }} />}
      {pay && <PayDialog tr={pay} onClose={() => setPay(null)} />}
    </>
  );
}

/** „Наплати (F4)“: what is paid / left on the selected invoice and where the payment is recorded in WISE. */
function PayDialog({ tr, onClose }: { tr: HTMLTableRowElement; onClose: () => void }) {
  const d = tr.dataset;
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => { ref.current?.focus(); }, []);
  return (
    <div role="dialog" aria-modal="true" aria-label="Наплата на фактура" onKeyDown={(e) => { if (e.key === 'Escape' || e.key === 'F4') { e.preventDefault(); onClose(); } }}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.25)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
      <div className="card" style={{ width: 'min(480px, 94vw)', padding: 16, margin: 0 }}>
        <h2 style={{ marginTop: 0 }}>Наплата – фактура {d.no}</h2>
        <p style={{ margin: '0 0 10px' }}>{d.pname}</p>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '4px 16px' }} data-testid="pay-sums">
          <span>За наплата</span><b className="n">{nf.format(Number(d.total) || 0)}</b>
          <span>Наплатено</span><b className="n">{nf.format(Number(d.paid) || 0)}</b>
          <span>Останува</span><b className="n" style={Number(d.rest) > 0.009 ? { color: 'var(--bad)' } : undefined}>{nf.format(Number(d.rest) || 0)}</b>
        </div>
        <div style={{ display: 'grid', gap: 6, marginTop: 14 }}>
          <a className="btn pri" href="/banka" title="Приливот од изводот се поврзува со фактурата (автоматски или рачно)">🏦 Наплата преку извод (банка)</a>
          <a className="btn" href="/blagajna" title="Уплата во готово – благајна">💵 Наплата во готово (благајна)</a>
          <a className="btn" href="/kompenzacii" title="Пребивање на побарување и обврска">↔ Компензација</a>
          {d.pid && <a className="btn" href={`/akart?k=12&pid=${d.pid}`}>📒 Картица на купувачот</a>}
          {Number(d.rest) > 0.009 && <a className="btn" href={`/opomeni?ids=${d.inv}`}>⏰ Опомена</a>}
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
