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
import { PartnerWindow } from './partner-window';

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
  /** The other fields of the old program's „Нова ставка“ (`extra`): kept on the line, never in the sums. */
  meta: FastMeta;
}

/** Датум на документот, Валута, Аванс, ОЕ / Продавница / Магацин, Одобрено по документ, Почетна состојба (+ година), Г1, Г2, Тип на трошок, Забелешка. */
export interface FastMeta {
  docDate?: string; due?: string; advance?: boolean; opening?: boolean; openingYear?: string;
  oe?: string; store?: string; warehouse?: string; approvedDoc?: string; g1?: string; g2?: string; costType?: string; remark?: string;
}

/** An open document of a partner for F2: `side` = the side of `konto` that closes it (customer → П, supplier → Д). */
export interface OpenDoc { id: string; partnerId: string; no: string; open: number; side: 'd' | 'p'; konto: string; label: string }

export const blankFast = (d: Partial<FastLine> = {}): FastLine => ({
  konto: '', content: '', partnerId: '', stNo: '', acct: '', debit: '', credit: '', debitCur: '', creditCur: '', rate: '', cur: '',
  date: '', doc: '', docRef: '', newKonto: { mk: false, name: '' }, meta: {}, ...d,
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
  /** Show the other fields of the old program (документ датум, валута, аванс, ОЕ, продавница, магацин, Г1 / Г2…). */
  extra?: boolean;
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

/** The look of the old program's „Нова ставка“ window (small, grey-blue, yellow key fields, label left). */
const HX_CSS = `
.hx{width:min(900px,100%);background:#eef2f8;border:1px solid #8fa3bd;box-shadow:0 6px 24px rgba(0,0,0,.25);font:12px/1.25 "Segoe UI",Tahoma,Arial,sans-serif;color:#000}
.hx .hx-title{display:flex;justify-content:space-between;align-items:center;background:#f7f9fc;border-bottom:1px solid #c5d0de;padding:4px 8px;font-size:13px}
.hx .hx-x{border:0;background:none;color:#1a4f9c;cursor:pointer;font-size:14px}
.hx .hx-err{background:#fde8e8;color:#a00;padding:3px 8px}.hx .hx-ok{background:#e6f4e6;color:#165c16;padding:3px 8px}
.hx .hx-body{display:grid;grid-template-columns:minmax(0,2fr) minmax(0,.95fr) minmax(0,.8fr) minmax(0,1.15fr);gap:6px 10px;padding:8px;border:1px solid #c5d0de;margin:6px;background:#eef2f8}
.hx .hx-left,.hx .hx-mid,.hx .hx-mid2,.hx .hx-right{display:flex;flex-direction:column;gap:4px;min-width:0}
.hx .hx-right{border-left:1px solid #c5d0de;padding-left:8px}
.hx .hx-row{display:flex;align-items:center;gap:4px;margin:0;min-width:0}
.hx .hx-l{width:58px;flex:none;font-size:11.5px;text-align:right;line-height:1.1}
.hx input,.hx textarea,.hx select{font:12px "Segoe UI",Tahoma,Arial,sans-serif;height:20px;padding:0 3px;border:1px solid #7f8fa6;border-radius:0;background:#fff;min-width:0;box-shadow:none}
.hx textarea{height:44px;padding:2px 3px;resize:none}
.hx input[type=radio]{height:auto;width:auto;margin:0 3px 0 0}
.hx input[type=date]{width:110px}
.hx .hx-y{background:#fffbd0}
.hx .hx-n{text-align:right}
.hx .hx-konto{width:150px;flex:none}.hx .hx-konto input{background:#fffbd0;width:100%}.hx .hx-konto .row{flex-wrap:nowrap;gap:2px!important}.hx .hx-konto button{font-size:0;padding:0 3px;min-width:0;border:1px solid #7f8fa6;border-radius:0;height:20px;background:#f3f5f9}.hx .hx-konto button::before{content:'📋';font-size:12px}
.hx .hx-name{flex:1;height:20px;border:1px solid #7f8fa6;background:#fff;padding:1px 4px;overflow:hidden;white-space:nowrap}
.hx .hx-partner{flex:1;min-width:0;max-width:100%}.hx .hx-partner input{width:100%!important;min-width:0!important}.hx .hx-partner > *{max-width:100%}
.hx .hx-hint{font-size:11px;margin-left:62px;line-height:1.2}
.hx .hx-amt{display:grid;grid-template-columns:58px 1fr 1fr;gap:2px 6px;align-items:center;border-top:1px solid #c5d0de;padding-top:3px}
.hx .hx-amt input{font-weight:700;font-size:13px;height:24px}
.hx .hx-h{font-size:11.5px}.hx .hx-h.c{text-align:center}
.hx .hx-box{border:1px solid #c5d0de;padding:2px 6px 4px;margin:0;display:flex;flex-wrap:wrap;gap:4px;align-items:center}
.hx .hx-box legend{font-size:11.5px;padding:0 2px}
.hx .hx-radio{display:inline-flex;align-items:center;gap:2px;margin:0;font-size:12px}
.hx .hx-saldo{color:#1a2f8a;font-size:14px;margin-left:8px;min-width:80px;text-align:right;border:1px solid #c5d0de;background:#fff;padding:0 4px}
.hx .hx-no{border:1px solid #c5d0de;background:#fff;padding:0 4px;margin-left:8px;min-width:40px;text-align:right}
.hx .hx-btn{font:600 12px "Segoe UI",Tahoma,Arial,sans-serif;padding:3px 10px;background:#f3f5f9;border:1px solid #7f8fa6;border-radius:3px;cursor:pointer;white-space:nowrap}
.hx .hx-btn:hover{background:#e3e9f3}
.hx .hx-f8{all:unset;cursor:pointer;color:#1a3d8f;text-decoration:underline dotted}
.hx-pw-back{position:fixed;inset:0;z-index:70;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.12)}
.hx-pw{width:min(620px,96vw);background:#f0f3f8;border:1px solid #5a6f96;box-shadow:0 6px 24px rgba(0,0,0,.3);font:12px "Segoe UI",Tahoma,Arial,sans-serif;color:#000}
.hx-pw .hx-pw-list{height:min(52vh,420px);overflow:auto;background:#fff;border-top:1px solid #7f8fa6;border-bottom:1px solid #7f8fa6}
.hx-pw .hx-pw-h,.hx-pw .hx-pw-r{display:grid;grid-template-columns:90px 1fr;gap:6px;padding:1px 6px;white-space:nowrap}
.hx-pw .hx-pw-h{position:sticky;top:0;background:var(--line,#e5e7eb);font-weight:600}
.hx-pw .hx-pw-r{cursor:pointer}
.hx-pw .hx-pw-r.cur{font-weight:700}
.hx-pw .hx-pw-r.on{background:var(--accent-bg,#e6f2ee)}
.hx .hx-docs{border:1px solid #7f8fa6;background:#fff;max-height:160px;overflow:auto}
.hx .hx-docs button{display:block;width:100%;text-align:left;border:0;background:none;padding:2px 4px;cursor:pointer}
.hx .hx-docs button:hover{background:#e3e9f3}
@media (max-width:760px){.hx .hx-body{grid-template-columns:1fr 1fr}.hx .hx-right{border-left:0;padding-left:0}}
`;

export function FastEntry(p: FastEntryProps) {
  const { mode, chart, bank } = p;
  /** Partners typed by hand in the F8 window („Нов комитент“) join the list at once. */
  const [added, setAdded] = useState<PickerPartner[]>([]);
  const partners = useMemo(() => (added.length ? [...p.partners, ...added] : p.partners), [p.partners, added]);
  const [pw, setPw] = useState(false);
  const [pk, setPk] = useState(0);
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
  const setM = (x: Partial<FastMeta>) => setL((o) => ({ ...o, meta: { ...o.meta, ...x } }));
  /** The old program's layout (label left of the field, four columns) for the manual nalog's line. */
  const helix = !!p.extra && !p.bank;
  const cell = (label: React.ReactNode, el: React.ReactNode, span?: string) => (
    <label className="fe-hc" style={{ display: 'grid', gridTemplateColumns: 'auto minmax(0,1fr)', gap: 6, alignItems: 'center', margin: 0, ...(span ? { gridColumn: span } : {}) }}>
      <span className="mini" style={{ whiteSpace: 'nowrap' }}>{label}</span>{el}
    </label>
  );
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
      setL(blankFast({ ...keep, content: defaults.current.content, meta: l.meta.docDate ? { docDate: l.meta.docDate } : {} }));
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
      if (helix) { setPw(true); return; } // the old program's „Комитенти“ window
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

  if (helix) {
    const lab = (t: React.ReactNode, el: React.ReactNode, w?: number) => (
      <label className="hx-row"><span className="hx-l" style={w ? { width: w } : undefined}>{t}</span>{el}</label>
    );
    return (
      <div className="fe-back" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.08)', zIndex: 60, display: 'flex', alignItems: 'flex-end', justifyContent: 'flex-start', padding: 10 }}>
        <style>{HX_CSS}</style>
        <div ref={box} role="dialog" aria-modal="true" aria-label={title} className="fe hx" onKeyDown={onKey}>
          <div className="hx-title"><span>{title}</span><button type="button" className="hx-x" onClick={p.onClose} aria-label="Затвори">«</button></div>
          {err && <div className="hx-err" role="alert">{err}</div>}
          {ok && !err && <div className="hx-ok" role="status">{ok}</div>}
          <div className="hx-body fe-f">
            <div className="hx-left">
              <div className="hx-row"><span className="hx-l"><b>Конто</b></span>
                <span className="hx-konto"><KontoInput key={'k' + gen} chart={C} value={l.konto} onChange={(v) => set({ konto: v })} nk={l.newKonto} onNk={(n) => set({ newKonto: n })} list="feKonto" inputRef={kontoRef} /></span>
                <span className="hx-name">{k && names.get(k) ? names.get(k) : ''}</span>
              </div>
              <div className="hx-row"><span className="hx-l">Содржина<br />(/Фактура број)</span>
                <input className="hx-y" value={l.content} onChange={(e) => set({ content: e.target.value })} aria-label="Содржина" maxLength={500} style={{ flex: 1 }} />
              </div>
              <div className="hx-row"><span className="hx-l"><button type="button" className="hx-f8" onClick={() => setPw(true)} title="Комитенти – листа, избор или нов рачно">Комитент<br />(F8)</button></span>
                <span className="hx-partner"><PartnerPicker key={'p' + gen + '.' + pk} partners={partners} value={l.partnerId} onChange={(id) => set({ partnerId: id })} invalid={needsPartner(k)} /></span>
              </div>
              <div className="hx-hint">F5- Претходна содржина<br />F2- Затворање по документ</div>
              {pw && (
                <PartnerWindow partners={partners} value={l.partnerId}
                  onClose={() => { setPw(false); setTimeout(() => box.current?.querySelector<HTMLInputElement>('.hx-partner input')?.focus(), 0); }}
                  onPick={(x, isNew) => {
                    if (isNew) setAdded((a) => [...a, x]);
                    set({ partnerId: x.id }); setPk((n) => n + 1); setPw(false);
                    // on to the amounts, like Enter after the partner
                    setTimeout(() => { const inp = box.current?.querySelector<HTMLInputElement>('.hx-partner input'); if (inp) next(inp); }, 0);
                  }} />
              )}
              {docsOpen && (
                <div role="listbox" aria-label="Отворени документи" className="hx-docs">
                  {pDocs.length ? pDocs.slice(0, 50).map((x) => (
                    <button key={x.id} type="button" role="option" aria-selected={l.docRef === x.id} onClick={() => pickDoc(x)}>{x.label}</button>
                  )) : <span>Нема отворени документи{l.partnerId ? ' за овој комитент' : ''}.</span>}
                </div>
              )}
              {lab('Извод број', <input className="hx-y" value={l.stNo} onChange={(e) => set({ stNo: e.target.value })} aria-label="Извод број" style={{ width: 120 }} disabled={!p.showStNo} />)}
              <div className="hx-amt">
                <span className="hx-h"><b>Во денари</b></span><span className="hx-h c"><b>Должи</b></span><span className="hx-h c"><b>Побарува</b></span>
                <span /><input className="hx-y hx-n" inputMode="decimal" value={l.debit} onChange={(e) => set({ debit: e.target.value })} aria-label="Должи" placeholder="0.00" />
                <input className="hx-y hx-n" inputMode="decimal" value={l.credit} onChange={(e) => set({ credit: e.target.value })} aria-label="Побарува" placeholder="0.00" />
                <span className="hx-h">Во девизи</span><span className="hx-h c">Должи</span><span className="hx-h c">Побарува</span>
                <span /><input className="hx-n" inputMode="decimal" value={l.debitCur} disabled={p.fxLocked} onChange={(e) => set({ debitCur: e.target.value })} aria-label="Девизи должи" placeholder="0.000000" />
                <input className="hx-n" inputMode="decimal" value={l.creditCur} disabled={p.fxLocked} onChange={(e) => set({ creditCur: e.target.value })} aria-label="Девизи побарува" placeholder="0.000000" />
              </div>
              <div className="hx-row">
                <span className="hx-l" style={{ width: 'auto' }}>Курс</span><input className="hx-n" inputMode="decimal" value={l.rate} disabled={p.fxLocked} onChange={(e) => set({ rate: e.target.value })} aria-label="Курс" placeholder="0.00" style={{ width: 90 }} />
                <span className="hx-l" style={{ width: 'auto', marginLeft: 30 }}>Валута</span><input value={l.cur} disabled={p.fxLocked} onChange={(e) => set({ cur: e.target.value.toUpperCase().slice(0, 3) })} aria-label="Валута" style={{ width: 46 }} />
              </div>
            </div>
            <div className="hx-mid">
              <fieldset className="hx-box">
                {lab('Датум на книжење', <input className="hx-y" type="date" value={l.date} disabled={p.dateLocked} onChange={(e) => set({ date: e.target.value })} aria-label="Датум на книжење" />, 64)}
                {lab('Валута', <input type="date" value={l.meta.due ?? ''} onChange={(e) => setM({ due: e.target.value })} aria-label="Валута рок" />, 64)}
              </fieldset>
              <fieldset className="hx-box"><legend>Аванс</legend>
                <label className="hx-radio"><input type="radio" checked={!l.meta.advance} onChange={() => setM({ advance: false })} /> Не</label>
                <label className="hx-radio" style={{ marginLeft: 40 }}><input type="radio" checked={!!l.meta.advance} onChange={() => setM({ advance: true })} /> Да</label>
              </fieldset>
              {lab('Одобрено по документ', <input value={l.meta.approvedDoc ?? ''} onChange={(e) => setM({ approvedDoc: e.target.value })} aria-label="Одобрено по документ" maxLength={60} style={{ width: 100 }} />, 70)}
              {lab('Документ (/Калкул.бр.)', <input value={l.doc} onChange={(e) => set({ doc: e.target.value })} aria-label="Документ" maxLength={100} style={{ width: 100 }} />, 70)}
            </div>
            <div className="hx-mid2">
              {lab('ОЕ', <input value={l.meta.oe ?? ''} onChange={(e) => setM({ oe: e.target.value })} aria-label="ОЕ" maxLength={40} style={{ width: 64 }} />, 72)}
              {lab('Датум на документот', <input type="date" value={l.meta.docDate ?? ''} onChange={(e) => setM({ docDate: e.target.value })} aria-label="Датум на документот" style={{ width: 64 }} />, 72)}
              {lab('Продавница', <input value={l.meta.store ?? ''} onChange={(e) => setM({ store: e.target.value })} aria-label="Продавница" maxLength={40} style={{ width: 64 }} />, 72)}
              {lab('Магацин', <input value={l.meta.warehouse ?? ''} onChange={(e) => setM({ warehouse: e.target.value })} aria-label="Магацин" maxLength={40} style={{ width: 64 }} />, 72)}
            </div>
            <div className="hx-right">
              <div className="hx-row" style={{ justifyContent: 'space-between' }}>
                <fieldset className="hx-box" style={{ margin: 0 }}><legend>Почетна состојба</legend>
                  <label className="hx-radio"><input type="radio" checked={!l.meta.opening} onChange={() => setM({ opening: false })} /> Не</label>
                  <label className="hx-radio"><input type="radio" checked={!!l.meta.opening} onChange={() => setM({ opening: true })} /> Да</label>
                </fieldset>
                <input inputMode="numeric" maxLength={4} value={l.meta.openingYear ?? ''} onChange={(e) => setM({ openingYear: e.target.value.replace(/\D/g, '') })} aria-label="Година на почетната состојба" placeholder="година" style={{ width: 56 }} disabled={!l.meta.opening} />
              </div>
              <div className="hx-row">
                <span className="hx-l" style={{ width: 'auto' }}>Г1</span><input value={l.meta.g1 ?? ''} onChange={(e) => setM({ g1: e.target.value })} aria-label="Г1" maxLength={40} style={{ width: 64 }} />
                <span className="hx-l" style={{ width: 'auto' }}>Г2</span><input value={l.meta.g2 ?? ''} onChange={(e) => setM({ g2: e.target.value })} aria-label="Г2" maxLength={40} style={{ width: 64 }} />
              </div>
              {lab('Тип на трошок', <input value={l.meta.costType ?? ''} onChange={(e) => setM({ costType: e.target.value })} aria-label="Тип на трошок" maxLength={60} style={{ width: 110 }} />, 'auto' as unknown as number)}
              <span className="hx-l" style={{ width: 'auto' }}>Забелешка / Опис</span>
              <textarea rows={2} value={l.meta.remark ?? ''} onChange={(e) => setM({ remark: e.target.value })} aria-label="Забелешка" maxLength={200} />
              <div className="hx-row" style={{ justifyContent: 'flex-end' }}><span>Салдо</span><b className="hx-saldo" data-testid="fe-saldo" style={Math.abs(after) > 0.004 ? { color: '#c00' } : undefined}>{fmt(after)}</b></div>
              <div className="hx-row" style={{ justifyContent: 'flex-end' }}><span>Р.бр.</span><b className="hx-no" data-testid="fe-no">{no}</b></div>
              <div className="hx-row" style={{ justifyContent: 'space-between' }}>
                <button type="button" className="hx-btn" disabled={busy} onClick={() => void save()}>Во ред (F9)</button>
                <button type="button" className="hx-btn" onClick={p.onClose}>Излез (Esc)</button>
              </div>
              {p.onDelete && mode !== 'new' && <button type="button" className="hx-btn" disabled={busy} onClick={p.onDelete} style={{ color: '#c00' }}>Избриши ставка</button>}
            </div>
          </div>
          <datalist id="feKonto">{chart.map(([code, n]) => <option key={code} value={code}>{n}</option>)}</datalist>
        </div>
      </div>
    );
  }

  return (
    <div className="fe-back" style={{ position: 'fixed', inset: 0, background: helix ? 'rgba(0,0,0,.12)' : 'rgba(0,0,0,.28)', zIndex: 60, display: 'flex', alignItems: helix ? 'flex-end' : 'flex-start', justifyContent: helix ? 'flex-start' : 'center', padding: helix ? '12px' : '6vh 12px', overflowY: 'auto' }}>
      <div ref={box} role="dialog" aria-modal="true" aria-label={title} className="card fe" onKeyDown={onKey}
        style={{ width: p.extra ? 'min(1000px, 100%)' : 'min(760px, 100%)', margin: 0, boxShadow: '0 10px 40px rgba(0,0,0,.25)' }}>
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
