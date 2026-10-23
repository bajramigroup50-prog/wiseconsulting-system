'use client';
/**
 * „Нова ставка“ / „Промена на ставка“ — the keyboard-first line dialog of the old desktop program, in WISE style.
 * One dialog, two modes: `new` (F9 „Во ред“ saves the line, the dialog stays open and is cleared for the NEXT line,
 * keeping the date, the statement number and the default content) and `edit` (F9 saves the change and closes).
 * Esc „Излез“ closes. Enter moves to the next field (on the last field it saves), F8 = partner search (Latin ↔
 * Cyrillic, `PartnerPicker`), F5 = the previous line's content, F2 = close by an open document (invoice) of the partner.
 * Shows the running Салдо of the nalog / statement and the Р.бр. of the line.
 *
 * The dialog only collects the line; the caller saves it (`onSave` returns an error text or nothing):
 *  - manual nalog editor → adds the row to the nalog being edited (the nalog itself still needs Д = П to be saved),
 *  - bank statement („✍️ Рачна ставка“) → `bankLineForm` maps Должи / Побарува of the counter konto to ОДЛИВ / ПРИЛИВ
 *    (the bank konto side is automatic),
 *  - nalog grid („Нова (Ins)“ / „Промена (Enter)“) → the manual journal or the document correction (override).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { needsPartner } from '@wise/core';
import { KontoInput, type NewKonto } from './konto-field';
import { PartnerPicker, type PickerPartner } from './partner-picker';

export interface FastLine {
  konto: string; content: string; partnerId: string;
  /** Statement number (Извод број) — bank lines and statement nalozi. */
  stNo: string;
  /** Bank account of the statement (bank mode). */
  acct: string;
  debit: string; credit: string;
  /** Foreign currency amounts (Во девизи) with the rate and the currency. */
  debitCur: string; creditCur: string; rate: string; cur: string;
  /** Booking date (Датум на книжење). */
  date: string;
  /** Document (калк. / фактура бр.). */
  doc: string;
  /** Id of the open document closed with F2 (bank: the line is linked to it). */
  docRef: string;
  newKonto: NewKonto;
}

/** An open document of a partner for F2: `side` = the side of `konto` that closes it (customer → П, supplier → Д). */
export interface OpenDoc { id: string; partnerId: string; no: string; open: number; side: 'd' | 'p'; konto: string; label: string }

export const blankFast = (d: Partial<FastLine> = {}): FastLine => ({
  konto: '', content: '', partnerId: '', stNo: '', acct: '', debit: '', credit: '', debitCur: '', creditCur: '', rate: '', cur: '',
  date: '', doc: '', docRef: '', newKonto: { mk: false, name: '' }, ...d,
});

/** Fields kept for the next line after F9 (legacy: датум, извод број, датум на документот, содржина по default). */
const KEEP: (keyof FastLine)[] = ['date', 'stNo', 'acct', 'cur', 'rate'];

export const amt = (s: string) => { const n = Number(String(s ?? '').replace(/\s/g, '').replace(',', '.')); return Number.isFinite(n) ? n : NaN; };
const nf = new Intl.NumberFormat('mk-MK', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmt = (v: number) => nf.format(v);

/** Bank line of the dialog: Должи on the counter konto = ОДЛИВ (bank konto Побарува), Побарува = ПРИЛИВ (bank Должи). */
export function bankDirection(l: Pick<FastLine, 'debit' | 'credit' | 'debitCur' | 'creditCur'>, fx = false): { dir: 'in' | 'out'; amount: number } | null {
  const d = amt(fx ? l.debitCur : l.debit) || 0, p = amt(fx ? l.creditCur : l.credit) || 0;
  if (d && p) return null;
  if (p) return { dir: 'in', amount: Math.abs(p) };
  if (d) return { dir: 'out', amount: Math.abs(d) };
  return null;
}

/** Client-side checks before `onSave` (the server repeats them). */
export function lineError(l: FastLine, o: { fx?: boolean; bank?: boolean; chart: Set<string> }): string {
  const k = l.konto.trim().split(/\s/)[0] ?? '';
  if (!k) return 'Внесете конто.';
  if (!/^\d{3,8}$/.test(k)) return `Неважечко конто „${k}“.`;
  if (!o.chart.has(k) && !l.newKonto.mk) return `Контото ${k} не е во контниот план – штиклирајте „+ Ново конто“.`;
  const d = amt(l.debit), p = amt(l.credit), dc = amt(l.debitCur), pc = amt(l.creditCur);
  if ([d, p, dc, pc].some((x) => Number.isNaN(x))) return 'Неважечки износ.';
  const any = o.fx ? (dc || pc || d || p) : (d || p);
  if (!any) return 'Внесете износ во Должи или Побарува.';
  if ((d && p) || (dc && pc)) return 'Износ само во Должи или само во Побарува.';
  if (needsPartner(k) && !l.partnerId) return `Конто ${k} бара комитент (F8).`;
  if (o.bank && !bankDirection(l, !!o.fx && !(d || p))) return 'Внесете износ во Должи (одлив) или Побарува (прилив).';
  return '';
}

export interface FastEntryProps {
  mode: 'new' | 'edit';
  chart: [string, string][];
  partners: PickerPartner[];
  /** The row being changed (edit) or the defaults of the first new line (date, statement number, content…). */
  initial?: Partial<FastLine>;
  /** Nalog: Д − П without this line. Bank: прилив − одлив of the chosen statement without this line. */
  saldo: number | ((l: FastLine) => number);
  /** Р.бр. of the line (new: of the next line). */
  no: number | ((l: FastLine) => number);
  /** Content of the previous line (F5). */
  prevContent?: string;
  /** Show the foreign-currency fields. */
  fx?: boolean;
  /** Foreign amounts / currency are read-only (document correction keeps them). */
  fxLocked?: boolean;
  /** Show „Извод број“. */
  showStNo?: boolean;
  /** The booking date belongs to the nalog (manual editor) — shown, not edited. */
  dateLocked?: boolean;
  /** Bank mode: the bank konto (its side is automatic) and the statements to add to. */
  bank?: { konto: string; statements?: { key: string; acct: string; no: string; date: string; label: string }[]; accounts?: { id: string; label: string; konto: string }[] };
  /** Open documents for F2. */
  docs?: OpenDoc[];
  /** Saves the line; returns an error text (dialog stays as is) or nothing. */
  onSave: (l: FastLine) => Promise<string | null | void> | string | null | void;
  onClose: () => void;
  /** „🗑 Избриши ставка“ in „Промена на ставка“ (the same as Del on the row). */
  onDelete?: () => void;
  title?: string;
}

export function FastEntry(p: FastEntryProps) {
  const { mode, chart, partners, bank } = p;
  const C = useMemo(() => chart.map(([code, name]) => ({ code, name })), [chart]);
  const codes = useMemo(() => new Set(chart.map(([c]) => c)), [chart]);
  const names = useMemo(() => new Map(chart), [chart]);
  const pById = useMemo(() => new Map(partners.map((x) => [x.id, x])), [partners]);
  const defaults = useRef(blankFast(p.initial));
  const [l, setL] = useState<FastLine>(() => blankFast(p.initial));
  const [gen, setGen] = useState(0);
  const [prev, setPrev] = useState(p.prevContent ?? '');
  const [err, setErr] = useState('');
  const [ok, setOk] = useState('');
  const [busy, setBusy] = useState(false);
  const [docsOpen, setDocsOpen] = useState(false);
  // „💱 Во девизи“ in any nalog (an incoming invoice in EUR on 2210…): on by itself for the foreign supplier / customer kontos
  const [fxOn, setFxOn] = useState(!!p.initial?.cur && p.initial.cur !== 'MKD');
  const fx = !!p.fx || fxOn || (!bank && /^(221|121)/.test(l.konto));
  const box = useRef<HTMLDivElement>(null);
  const kontoRef = useRef<HTMLInputElement>(null);
  const set = (x: Partial<FastLine>) => setL((o) => ({ ...o, ...x }));
  const k = l.konto.trim().split(/\s/)[0] ?? '';
  const d = amt(l.debit) || 0, c = amt(l.credit) || 0;
  const saldo = typeof p.saldo === 'function' ? p.saldo(l) : p.saldo;
  const no = typeof p.no === 'function' ? p.no(l) : p.no;
  // nalog: Д − П with this line (0 = balanced); bank: прилив − одлив of the statement with this line
  const after = bank ? saldo + c - d : saldo + d - c;
  const fxOnly = !!fx && !(d || c);
  const dir = bank ? bankDirection(l, fxOnly) : null;
  const pDocs = (p.docs ?? []).filter((x) => !l.partnerId || x.partnerId === l.partnerId);

  useEffect(() => { kontoRef.current?.focus(); }, [gen]);

  const fields = () => [...(box.current?.querySelectorAll<HTMLElement>('.fe-f input:not([type=hidden]):not([type=checkbox]):not(:disabled), .fe-f select:not(:disabled)') ?? [])];
  const next = (from: EventTarget | null) => {
    const F = fields();
    const i = F.indexOf(from as HTMLElement);
    if (i < 0) return;
    if (i === F.length - 1) { void save(); return; }
    F[i + 1]!.focus();
  };

  const save = async () => {
    if (busy) return;
    const e = lineError(l, { fx, bank: !!bank, chart: codes });
    if (e) { setErr(e); setOk(''); return; }
    const out = { ...l, konto: k };
    // a nalog line needs denars: devizi × курс when only the foreign amount is typed (the bank converts by the statement rate)
    if (!bank && fx && !(d || c)) {
      const r = amt(l.rate), dc = amt(l.debitCur) || 0, pc = amt(l.creditCur) || 0;
      if (!(r > 0)) { setErr('Внесете курс (или износ во денари).'); return; }
      out.debit = dc ? (dc * r).toFixed(2) : ''; out.credit = pc ? (pc * r).toFixed(2) : '';
    }
    setBusy(true); setErr('');
    try {
      const r = await p.onSave(out);
      if (r) { setErr(r); return; }
      if (mode === 'edit') { p.onClose(); return; }
      setPrev(l.content);
      setOk(`✓ Ставка р.бр. ${no} е внесена.`);
      const keep = Object.fromEntries(KEEP.map((f) => [f, l[f]])) as Partial<FastLine>;
      setL(blankFast({ ...keep, content: defaults.current.content }));
      setDocsOpen(false);
      setGen((g) => g + 1);
    } catch (x) {
      setErr(x instanceof Error ? x.message : String(x));
    } finally { setBusy(false); }
  };

  const pickDoc = (x: OpenDoc) => {
    const amount = String(x.open);
    set({
      partnerId: x.partnerId, konto: l.konto || x.konto, doc: x.no, docRef: x.id,
      content: `${x.side === 'p' ? 'Уплата' : 'Плаќање'} по фактура ${x.no}`,
      ...(x.side === 'p' ? { credit: amount, debit: '' } : { debit: amount, credit: '' }),
    });
    setDocsOpen(false);
    if (!l.partnerId) setGen((g) => g + 1);
  };

  const onKey = (e: React.KeyboardEvent) => {
    const t = e.target as HTMLElement;
    if (e.key === 'F9') { e.preventDefault(); void save(); }
    else if (e.key === 'Escape') {
      if (docsOpen) { e.preventDefault(); setDocsOpen(false); return; }
      if (t.getAttribute('role') === 'combobox' && t.getAttribute('aria-expanded') === 'true') return; // closes the partner list first
      e.preventDefault(); p.onClose();
    } else if (e.key === 'F8') {
      e.preventDefault();
      const inp = box.current?.querySelector<HTMLInputElement>('input[role=combobox]');
      inp?.focus(); inp?.select();
    } else if (e.key === 'F5') { e.preventDefault(); if (prev) set({ content: prev }); }
    else if (e.key === 'F2') { e.preventDefault(); setDocsOpen((o) => !o); }
    else if (e.key === 'Enter' && t.tagName !== 'BUTTON' && t.tagName !== 'TEXTAREA') {
      // the partner list picks with Enter (defaultPrevented) — then the cursor moves on as well
      e.preventDefault();
      next(t);
    }
  };

  const title = p.title ?? (mode === 'edit' ? 'Промена на ставка' : 'Нова ставка');
  const pName = pById.get(l.partnerId)?.name ?? '';
  const st = bank?.statements ?? [];
  const stKey = st.find((s) => s.acct === l.acct && s.date === l.date)?.key ?? '';

  return (
    <div className="fe-back" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.28)', zIndex: 60, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '6vh 12px', overflowY: 'auto' }}>
      <div ref={box} role="dialog" aria-modal="true" aria-label={title} className="card fe" onKeyDown={onKey}
        style={{ width: 'min(760px, 100%)', margin: 0, boxShadow: '0 10px 40px rgba(0,0,0,.25)' }}>
        <div className="hd" style={{ marginBottom: 6 }}>
          <h2 style={{ margin: 0 }}>{title}</h2>
          <span className="row" style={{ gap: 10, alignItems: 'center' }}>
            <span className="mini">Р.бр. <b data-testid="fe-no">{no}</b></span>
            <span className="mini">{bank ? 'Салдо на изводот' : 'Салдо'} <b data-testid="fe-saldo" style={!bank && Math.abs(after) > 0.004 ? { color: 'var(--bad)' } : undefined}>{fmt(after)}</b></span>
          </span>
        </div>
        {err && <div className="callout bad" role="alert" style={{ margin: '4px 0' }}>{err}</div>}
        {ok && !err && <div className="callout good" role="status" style={{ margin: '4px 0' }}>{ok}</div>}
        <div className="form fe-f" style={{ gap: '6px 12px' }}>
          {bank && st.length > 0 && (
            <label className="f wide">Извод
              <select value={stKey} onChange={(e) => { const s = st.find((x) => x.key === e.target.value); if (s) set({ acct: s.acct, date: s.date, stNo: s.no }); }}>
                {!stKey && <option value="">нов извод (по датум)</option>}
                {st.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
              </select>
            </label>
          )}
          {bank && !st.length && (bank.accounts?.length ?? 0) > 1 && (
            <label className="f">Сметка
              <select value={l.acct} onChange={(e) => set({ acct: e.target.value })}>{bank.accounts!.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}</select>
            </label>
          )}
          <label className="f">Конто
            <KontoInput key={'k' + gen} chart={C} value={l.konto} onChange={(v) => set({ konto: v })} nk={l.newKonto} onNk={(n) => set({ newKonto: n })} list="feKonto" inputRef={kontoRef} />
          </label>
          <label className="f wide">Содржина / фактура број <small className="mut">(F5 претходна, F2 по документ)</small>
            <input value={l.content} onChange={(e) => set({ content: e.target.value })} aria-label="Содржина" maxLength={500} />
          </label>
          <label className="f wide">Комитент <small className="mut">(F8 барај)</small>
            <PartnerPicker key={'p' + gen} partners={partners} value={l.partnerId} onChange={(id) => set({ partnerId: id })} invalid={needsPartner(k)} />
            {pName && <small className="mut" style={{ display: 'block' }}>{pName}</small>}
          </label>
          {docsOpen && (
            <div className="f wide" role="listbox" aria-label="Отворени документи" style={{ border: '1px solid var(--line)', borderRadius: 6, padding: 4, maxHeight: 200, overflowY: 'auto' }}>
              {pDocs.length ? pDocs.slice(0, 50).map((x) => (
                <button key={x.id} type="button" role="option" aria-selected={l.docRef === x.id} className="btn sm ghost" style={{ display: 'block', width: '100%', textAlign: 'left' }} onClick={() => pickDoc(x)}>{x.label}</button>
              )) : <span className="mut">Нема отворени документи{l.partnerId ? ' за овој комитент' : ''}.</span>}
            </div>
          )}
          {p.showStNo && <label className="f">Извод број<input value={l.stNo} onChange={(e) => set({ stNo: e.target.value })} style={{ width: 90 }} aria-label="Извод број" /></label>}
          <label className="f">Во денари – Должи<input inputMode="decimal" value={l.debit} onChange={(e) => set({ debit: e.target.value })} style={{ textAlign: 'right' }} aria-label="Должи" /></label>
          <label className="f">Побарува<input inputMode="decimal" value={l.credit} onChange={(e) => set({ credit: e.target.value })} style={{ textAlign: 'right' }} aria-label="Побарува" /></label>
          {!p.fx && !bank && !fx && <button type="button" className="btn sm ghost" style={{ alignSelf: 'end' }} onClick={() => setFxOn(true)}>💱 Во девизи</button>}
          {fx && (
            <>
              <label className="f">Во девизи – Должи<input inputMode="decimal" value={l.debitCur} disabled={p.fxLocked} onChange={(e) => set({ debitCur: e.target.value })} style={{ textAlign: 'right' }} aria-label="Девизи должи" /></label>
              <label className="f">Побарува<input inputMode="decimal" value={l.creditCur} disabled={p.fxLocked} onChange={(e) => set({ creditCur: e.target.value })} style={{ textAlign: 'right' }} aria-label="Девизи побарува" /></label>
              <label className="f">Курс<input inputMode="decimal" value={l.rate} disabled={p.fxLocked} onChange={(e) => set({ rate: e.target.value })} style={{ width: 90, textAlign: 'right' }} aria-label="Курс" /></label>
              <label className="f">Валута<input value={l.cur} disabled={p.fxLocked} onChange={(e) => set({ cur: e.target.value.toUpperCase().slice(0, 3) })} style={{ width: 70 }} aria-label="Валута" placeholder="EUR" /></label>
            </>
          )}
          <label className="f">Датум на книжење<input type="date" value={l.date} disabled={p.dateLocked} onChange={(e) => set({ date: e.target.value })} aria-label="Датум на книжење" /></label>
          <label className="f">Документ (калк. / ф-ра бр.)<input value={l.doc} onChange={(e) => set({ doc: e.target.value })} aria-label="Документ" maxLength={100} /></label>
        </div>
        <datalist id="feKonto">{chart.map(([code, n]) => <option key={code} value={code}>{n}</option>)}</datalist>
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', marginTop: 8, gap: 8, flexWrap: 'wrap' }}>
          <span className="mini" data-testid="fe-hint">
            {k && names.get(k) ? <><b>{k}</b> {names.get(k)}</> : null}
            {dir && bank ? <> · <b data-testid="fe-dir">{dir.dir === 'in' ? 'ПРИЛИВ' : 'ОДЛИВ'}</b> ({dir.dir === 'in' ? 'Должи' : 'Побарува'} {bank.konto || 'банка'} автоматски)</> : null}
          </span>
          <span className="row" style={{ gap: 6 }}>
            <button type="button" className="btn pri" disabled={busy} onClick={() => void save()}>Во ред (F9)</button>
            {p.onDelete && mode !== 'new' && <button type="button" className="btn danger" disabled={busy} onClick={p.onDelete}>🗑 Избриши ставка</button>}
            <button type="button" className="btn" onClick={p.onClose}>Излез (Esc)</button>
          </span>
        </div>
        <p className="note" style={{ margin: '6px 0 0' }}>Enter = следно поле · F9 = зачувај{mode === 'new' ? ' и нова ставка' : ''} · F8 = комитент · F5 = претходна содржина · F2 = затвори по документ · Esc = излез</p>
      </div>
    </div>
  );
}

/** FormData for `addManualLineAction` (bank „✍️ Рачна ставка“): direction from Должи / Побарува of the counter konto. */
export function bankLineForm(l: FastLine, o: { fx: boolean; docs?: OpenDoc[] }): FormData | string {
  const fxOnly = o.fx && !(amt(l.debit) || amt(l.credit));
  const dr = bankDirection(l, o.fx);
  if (!dr) return 'Внесете износ во Должи (одлив) или Побарува (прилив).';
  const f = new FormData();
  f.set('acct', l.acct); f.set('date', l.date); f.set('dir', dr.dir); f.set('amount', String(dr.amount));
  if (o.fx && !fxOnly) {
    const mk = bankDirection(l, false);
    if (mk) f.set('amountMkd', String(mk.amount));
  }
  f.set('desc', l.content); f.set('konto', l.konto); f.set('partner', l.partnerId); f.set('stno', l.stNo); f.set('ldoc', l.doc);
  if (l.newKonto.mk) { f.set('newKonto', '1'); f.set('newName', l.newKonto.name); }
  const d = l.docRef ? o.docs?.find((x) => x.id === l.docRef) : undefined;
  if (d) f.set('doc', `${d.side === 'p' ? 'inv' : 'pur'}|${d.id}|${Math.round(d.open * 100)}|${d.no}|${d.partnerId}`);
  return f;
}
