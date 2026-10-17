'use client';
/**
 * „Содржина (книжење) на финансов налог“ — the opened nalog as a keyboard grid, like the old program, in WISE style:
 * Р.бр. · Датум · (Изв. бр.) · Содржина · Конто · Должи · Побарува · Документ · (Дев. должи / побарува · Вал.) · Ком.ш. ·
 * Комитент; a header line with the firm, the selected row's konto / partner, the nalog number and date; a footer with
 * Салдо, the selection's ДОЛЖИ / ПОБАРУВА and ВК. ДОЛЖИ / ВК. ПОБАРУВА of the nalog (денари and девизи).
 *
 * Keys: ↑ ↓ select, Ins „Нова“, Enter „Промена“, Del „Бришење“, F3 „Аналитика“ (/kkart), F6 „Печатење девизен“,
 * + / − selection. A click on the konto cell or a double click on the row opens „Промена на ставка“ (the fast-entry
 * dialog): manual nalozi are changed directly (`saveJournal`), document nalozi through the manual correction
 * (`saveOverrideAction`, journal override). A change that leaves its journal Д ≠ П is held until the journal balances
 * again (Салдо shown) — then it is saved; locked periods are read-only (the server checks again).
 * A bank nalog shows the bank konto of each statement as ONE line (Σ приливи / Σ одливи), „Нова“ adds a statement
 * line (bank side automatic), „Бришење“ deletes the statement line and „Масовно затворање 1200 / 2200 / 2210 / 1210“
 * links the payments without a document to the open invoices (preview + confirm).
 */
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { OvRow } from '@wise/core/finpar';
import { FastEntry, type FastLine } from '@/components/fast-entry';
import { BankManualEntry, type BmeAccount, type BmeStatement } from '@/components/bank-manual-entry';
import type { PickerPartner } from '@/components/partner-picker';
import { sums } from '@/lib/nalog-grid';
import { overrideRowsAction, saveJournal, saveOverrideAction } from './actions';
import { deleteNalogBankLineAction, massCloseAction, massClosePreviewAction } from './statement-actions';

export interface GridRow {
  key: string;
  /** Journal line ids (two for the merged bank konto line of a statement). */
  ids: number[];
  jid: string;
  date: string; izNo: string;
  /** Journal description and the line's own note (Содржина = description + note). */
  jdesc: string; note: string;
  account: string; debit: number; credit: number; doc: string;
  devD: number; devP: number; cur: string; amountCur: number | null; locationId: string | null;
  partnerId: string; pcode: string; pname: string;
  /** The automatic bank konto line of a statement (not changed / deleted here). */
  head: boolean;
  /** Amounts of the source journal lines (for matching the correction rows). */
  src: { debit: number; credit: number }[];
  /** Added in this grid, not saved yet. */
  added?: boolean;
}
export interface GridJournal {
  id: string;
  /** manual = changed directly, override = document correction, none = read-only (locked / no right). */
  mode: 'manual' | 'override' | 'none';
  bank: boolean; number: string; date: string; description: string; periodFrom: string; periodTo: string;
  /** Why it is read-only. */
  why?: string;
}

const nf = new Intl.NumberFormat('mk-MK', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmt = (v: number) => (v ? nf.format(v) : '');
const fmt0 = (v: number) => nf.format(v);
const dmy = (d: string) => d.split('-').reverse().join('.');
const r2 = (x: number) => Math.round(x * 100) / 100;
const MASS = ['1200', '2200', '2210', '1210'];

type Fe = { mode: 'new' | 'edit'; jid: string; idx: number | null } | null;
type OvState = { rows: OvRow[]; map: Map<string, number[]> };

/** Match the grid rows of a document journal to its correction rows (same konto / amounts / partner, in order). */
export function matchOv(rows0: readonly OvRow[], G: readonly GridRow[], jid: string): Map<string, number[]> {
  const used = new Set<number>();
  const m = new Map<string, number[]>();
  for (const g of G.filter((x) => x.jid === jid && !x.added)) {
    const idx: number[] = [];
    for (const s of g.src) {
      const k = rows0.findIndex((o, i) => !used.has(i) && !o.del && o.account === g.account && Math.abs(o.debit - s.debit) < 0.005 && Math.abs(o.credit - s.credit) < 0.005
        && (o.partnerId ?? '') === (g.head ? '' : g.partnerId || ''));
      if (k >= 0) { used.add(k); idx.push(k); }
    }
    m.set(g.key, idx);
  }
  return m;
}

export function NalogGrid({ rows, journals, firmName, no, date, chart, partners, canDel, newHref, printHref, sintHref, bank }: {
  rows: GridRow[]; journals: GridJournal[]; firmName: string; no: string; date: string;
  chart: [string, string][]; partners: PickerPartner[];
  /** Right to delete statement lines. */
  canDel: boolean;
  /** A new manual part of this nalog (`/nalozi?nov&n=…`) when no journal of it takes new lines here. */
  newHref?: string;
  printHref: string;
  /** „Синтетики“ (F8). */
  sintHref?: string;
  /** Bank nalog: the statements a new line can go to, and the mass close. */
  bank?: { accounts: BmeAccount[]; statements: BmeStatement[]; write: boolean };
}) {
  const router = useRouter();
  const [R, setR] = useState<GridRow[]>(rows);
  const [dirty, setDirty] = useState<Set<string>>(new Set());
  /** Correction rows of document journals with the grid row → correction row(s) map made when they were loaded. */
  const [ov, setOv] = useState<Record<string, OvState>>({});
  const [sel, setSel] = useState(0);
  const [mark, setMark] = useState<Set<string>>(new Set());
  const [fe, setFe] = useState<Fe>(null);
  const [bankNew, setBankNew] = useState(false);
  const [msg, setMsg] = useState<{ ok?: string; error?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const J = useMemo(() => new Map(journals.map((j) => [j.id, j])), [journals]);
  const names = useMemo(() => new Map(chart), [chart]);
  const pById = useMemo(() => new Map(partners.map((p) => [p.id, p])), [partners]);
  // fresh rows from the server (after a save) replace the local ones when nothing is pending
  useEffect(() => { if (!dirty.size) { setR(rows); setOv({}); } }, [rows]); // eslint-disable-line react-hooks/exhaustive-deps

  const cur = R[Math.min(sel, R.length - 1)];
  const dev = R.some((r) => r.devD || r.devP);
  const IZ = journals.some((j) => j.bank);
  const hasDoc = R.some((r) => r.doc);
  const all = sums(R);
  const S = sums(R.filter((r) => mark.has(r.key)));
  const jSaldo = (jid: string, without?: number | null) => r2(R.reduce((s, r, i) => (r.jid === jid && i !== without ? s + r.debit - r.credit : s), 0));
  const unbalanced = [...dirty].filter((jid) => Math.abs(jSaldo(jid)) > 0.004);

  /* ---------- saving ---------- */
  const saveJournals = async (G: GridRow[], D: Set<string>, O: Record<string, OvState>) => {
    const ready = [...D].filter((jid) => Math.abs(r2(G.reduce((s, r) => (r.jid === jid ? s + r.debit - r.credit : s), 0))) <= 0.004);
    for (const jid of ready) {
      const j = J.get(jid)!;
      const mine = G.filter((r) => r.jid === jid);
      let res: { ok?: string; error?: string };
      if (j.mode === 'manual') {
        const f = new FormData();
        f.set('stay', '1');
        f.set('payload', JSON.stringify({
          id: j.id, number: j.number, date: j.date, description: j.description, periodFrom: j.periodFrom, periodTo: j.periodTo,
          rows: mine.map((r) => ({
            account: r.account, partnerId: r.partnerId, debit: r.debit ? String(r.debit) : '', credit: r.credit ? String(r.credit) : '', note: r.note, doc: r.doc,
            currency: r.cur || null, amountCur: r.amountCur == null ? null : String(r.amountCur), locationId: r.locationId,
          })),
        }));
        res = await saveJournal({}, f);
      } else res = await saveOverrideAction(jid, O[jid]?.rows ?? [], true);
      if (res.error) { setMsg({ error: res.error }); return false; }
      D.delete(jid);
    }
    setDirty(new Set(D));
    if (ready.length) { setMsg({ ok: 'Промената е зачувана; налогот е прекнижан.' }); router.refresh(); }
    return true;
  };

  /** Correction rows of a document journal (loaded once; matched to the grid rows as they were saved). */
  const ensureOv = async (jid: string): Promise<Record<string, OvState> | string> => {
    if (ov[jid]) return ov;
    const r = await overrideRowsAction(jid);
    if (r.error || !r.rows) return r.error ?? 'Корекцијата не може да се вчита.';
    return { ...ov, [jid]: { rows: r.rows, map: matchOv(r.rows, rows, jid) } };
  };

  const applyLine = async (l: FastLine) => {
    if (!fe) return;
    const j = J.get(fe.jid)!;
    const content = l.content.trim();
    const patch = (g: GridRow): GridRow => ({
      ...g, account: l.konto, partnerId: l.partnerId, pcode: pById.get(l.partnerId)?.code ?? '', pname: pById.get(l.partnerId)?.name ?? '',
      debit: Number(l.debit.replace(',', '.')) || 0, credit: Number(l.credit.replace(',', '.')) || 0, doc: l.doc,
      note: content === g.jdesc && !g.note ? '' : content,
    });
    let G = R.slice();
    let O = ov;
    if (j.mode === 'override') {
      const o = await ensureOv(j.id);
      if (typeof o === 'string') return o;
      O = o;
    }
    const rowsOv = O[j.id] ? O[j.id]!.rows.slice() : [];
    const map = O[j.id]?.map ?? new Map<string, number[]>();
    if (fe.mode === 'edit' && fe.idx != null) {
      const g0 = G[fe.idx]!;
      const g = patch(g0);
      G[fe.idx] = g;
      if (j.mode === 'override') {
        if (g0.added) {
          const k = G.filter((x) => x.jid === j.id && x.added).indexOf(g);
          const adds = rowsOv.map((o, i) => (o.i == null ? i : -1)).filter((i) => i >= 0);
          if (adds[k] != null) rowsOv[adds[k]!] = { ...rowsOv[adds[k]!]!, account: g.account, debit: g.debit, credit: g.credit, partnerId: g.partnerId || null, note: g.note, doc: g.doc };
        } else {
          const ix = map.get(g0.key) ?? [];
          if (ix.length !== 1) return 'Ставката не може да се поврзе со корекцијата на документот – користете „✎ Корекција“.';
          rowsOv[ix[0]!] = { ...rowsOv[ix[0]!]!, account: g.account, debit: g.debit, credit: g.credit, partnerId: g.partnerId || null, note: g.note, doc: g.doc };
        }
      }
    } else {
      const last = [...G].reverse().find((x) => x.jid === j.id);
      const g = patch({
        key: 'new-' + Date.now() + '-' + G.length, ids: [], jid: j.id, date: j.date, izNo: '', jdesc: j.description, note: '', account: '', debit: 0, credit: 0, doc: '',
        devD: 0, devP: 0, cur: '', amountCur: null, locationId: null, partnerId: '', pcode: '', pname: '', head: false, src: [], added: true,
      });
      const at = last ? G.indexOf(last) + 1 : G.length;
      G.splice(at, 0, g);
      if (j.mode === 'override') rowsOv.push({ i: null, account: g.account, debit: g.debit, credit: g.credit, partnerId: g.partnerId || null, note: g.note, doc: g.doc, del: false });
    }
    if (j.mode === 'override') O = { ...O, [j.id]: { rows: rowsOv, map } };
    const D = new Set(dirty).add(j.id);
    setR(G); setOv(O); setDirty(D);
    await saveJournals(G, D, O);
    return null;
  };

  /* ---------- actions ---------- */
  const openChange = (i: number) => {
    const g = R[i];
    if (!g) return;
    setSel(i);
    const j = J.get(g.jid)!;
    if (g.head) { setMsg({ error: `Конто ${g.account} е банкарското конто на изводот – се книжи автоматски (Σ приливи / Σ одливи). Променете ја ставката на изводот.` }); return; }
    if (j.mode === 'none') { setMsg({ error: j.why || 'Налогот не може да се менува.' }); return; }
    setMsg(null);
    setFe({ mode: 'edit', jid: g.jid, idx: i });
  };
  const openNew = () => {
    setMsg(null);
    if (bank?.write && bank.statements.length) { setBankNew(true); return; }
    const W = journals.filter((j) => j.mode !== 'none' && !j.bank);
    const target = W.length === 1 ? W[0] : journals.length === 1 && journals[0]!.mode !== 'none' ? journals[0] : undefined;
    if (target) { setFe({ mode: 'new', jid: target.id, idx: null }); return; }
    if (newHref) { router.push(newHref); return; }
    setMsg({ error: 'Во овој налог не може да се додаваат ставки (заклучен или немате право).' });
  };
  const del = async (i: number) => {
    const g = R[i];
    if (!g) return;
    const j = J.get(g.jid)!;
    if (g.head) { setMsg({ error: `Банкарското конто ${g.account} се книжи автоматски – избришете ги ставките на изводот.` }); return; }
    if (j.mode === 'none' && !(j.bank && canDel)) { setMsg({ error: j.why || 'Налогот не може да се менува.' }); return; }
    const label = `р.бр. ${i + 1}: ${g.account} ${fmt(g.debit) || fmt(g.credit)} ${g.pname}`;
    if (j.bank && g.ids.length === 1 && canDel) {
      if (!window.confirm(`Да се избрише ставката ${label} од изводот? Налогот се прекнижува.`)) return;
      setBusy(true);
      const r = await deleteNalogBankLineAction(g.ids[0]!);
      setBusy(false);
      setMsg(r);
      if (!r.error) router.refresh();
      return;
    }
    if (j.mode === 'none') { setMsg({ error: j.why || 'Налогот не може да се менува.' }); return; }
    if (!window.confirm(`Да се отстрани ставката ${label}? Налогот мора повторно да биде изедначен (Д = П) за да се зачува.`)) return;
    let O = ov;
    if (j.mode === 'override') {
      const o = await ensureOv(j.id);
      if (typeof o === 'string') { setMsg({ error: o }); return; }
      const rowsOv = o[j.id]!.rows.slice();
      if (g.added) {
        const k = R.filter((x) => x.jid === j.id && x.added).indexOf(g);
        const adds = rowsOv.map((x, n) => (x.i == null ? n : -1)).filter((n) => n >= 0);
        if (adds[k] != null) rowsOv.splice(adds[k]!, 1);
      } else {
        const ix = o[j.id]!.map.get(g.key) ?? [];
        if (ix.length !== 1) { setMsg({ error: 'Ставката не може да се поврзе со корекцијата – користете „✎ Корекција“.' }); return; }
        rowsOv[ix[0]!] = { ...rowsOv[ix[0]!]!, del: true };
      }
      O = { ...o, [j.id]: { rows: rowsOv, map: o[j.id]!.map } };
    }
    const G = R.filter((_, k) => k !== i);
    const D = new Set(dirty).add(j.id);
    setR(G); setOv(O); setDirty(D); setSel(Math.max(0, Math.min(i, G.length - 1)));
    await saveJournals(G, D, O);
  };
  const analytics = (i: number) => { const g = R[i]; if (g) router.push(`/kkart?k=${encodeURIComponent(g.account)}${g.partnerId ? `&p=${g.partnerId}` : ''}`); };
  const print = (devizen: boolean) => window.open(printHref + (devizen ? '&dev=1' : ''), '_blank', 'noopener');
  const toggle = (i: number, on?: boolean) => {
    const g = R[i];
    if (!g) return;
    setMark((M) => { const n = new Set(M); if (on ?? !n.has(g.key)) n.add(g.key); else n.delete(g.key); return n; });
  };
  const cancel = () => { setDirty(new Set()); setOv({}); setR(rows); setMsg(null); };
  const massClose = async (konto: string) => {
    if (!bank) return;
    setBusy(true);
    const ids = bank.statements.map((s) => s.id);
    const p = await massClosePreviewAction(ids, konto);
    setBusy(false);
    if (p.error) { setMsg({ error: p.error }); return; }
    if (!p.n) { setMsg({ ok: p.text }); return; }
    if (!window.confirm(`${p.text}\n\nДа се затворат?`)) return;
    setBusy(true);
    const r = await massCloseAction(ids, konto);
    setBusy(false);
    setMsg(r);
    if (!r.error) router.refresh();
  };

  // grid keys (not while typing in a field or while a dialog is open)
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (fe || bankNew || e.defaultPrevented) return;
      const tg = (e.target as HTMLElement)?.tagName;
      if (tg === 'INPUT' || tg === 'SELECT' || tg === 'TEXTAREA') return;
      const go = (f: () => void) => { e.preventDefault(); f(); };
      if (e.key === 'ArrowDown') go(() => setSel((s) => Math.min(s + 1, R.length - 1)));
      else if (e.key === 'ArrowUp') go(() => setSel((s) => Math.max(s - 1, 0)));
      else if (e.key === 'Insert') go(openNew);
      else if (e.key === 'Enter' && tg !== 'BUTTON' && tg !== 'A') go(() => openChange(sel));
      else if (e.key === 'Delete') go(() => void del(sel));
      else if (e.key === 'F3') go(() => analytics(sel));
      else if (e.key === 'F6') go(() => print(true));
      else if (e.key === 'F8' && sintHref) go(() => router.push(sintHref));
      else if (e.key === '+') go(() => { toggle(sel, true); setSel((s) => Math.min(s + 1, R.length - 1)); });
      else if (e.key === '-') go(() => { toggle(sel, false); setSel((s) => Math.min(s + 1, R.length - 1)); });
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  });
  useEffect(() => { box.current?.querySelector(`tr[data-i="${sel}"]`)?.scrollIntoView?.({ block: 'nearest' }); }, [sel]);

  const feRow = fe?.mode === 'edit' && fe.idx != null ? R[fe.idx] : undefined;
  const feJ = fe ? J.get(fe.jid) : undefined;
  const feInit: Partial<FastLine> | undefined = fe && feJ ? (feRow ? {
    konto: feRow.account, content: feRow.note || feRow.jdesc, partnerId: feRow.partnerId, debit: feRow.debit ? String(feRow.debit) : '', credit: feRow.credit ? String(feRow.credit) : '',
    doc: feRow.doc, date: feRow.date, stNo: feRow.izNo, cur: feRow.cur, debitCur: feRow.devD ? String(feRow.devD) : '', creditCur: feRow.devP ? String(feRow.devP) : '',
  } : { date: feJ.date, content: feJ.description }) : undefined;
  const pName = cur ? (cur.pname || '') : '';

  return (
    <div ref={box} className="nalog-grid">
      <div className="row" style={{ gap: 6, flexWrap: 'wrap', alignItems: 'center', margin: '4px 0' }}>
        <button type="button" className="btn sm pri" onClick={openNew} disabled={busy}>Нова (Ins)</button>
        <button type="button" className="btn sm" onClick={() => openChange(sel)} disabled={!cur || busy}>Промена (Enter)</button>
        <button type="button" className="btn sm" onClick={() => void del(sel)} disabled={!cur || busy}>Бришење (Del)</button>
        <button type="button" className="btn sm" onClick={() => analytics(sel)} disabled={!cur}>Аналитика (F3)</button>
        <button type="button" className="btn sm" onClick={() => print(false)}>Печатење табеларно</button>
        <button type="button" className="btn sm" onClick={() => print(true)}>Печатење девизен (F6)</button>
        {sintHref && <button type="button" className="btn sm" onClick={() => router.push(sintHref)}>Синтетики (F8)</button>}
        {bank?.write && MASS.map((k) => <button key={k} type="button" className="btn sm ghost" disabled={busy} onClick={() => void massClose(k)} title={`Плаќањата на ${k} без фактура се поврзуваат со отворените фактури на комитентот (FIFO / по број) – со преглед пред потврда`}>Масовно затворање {k}</button>)}
        <span className="note">↑ ↓ избор · + / − селекција · клик на конто = промена</span>
      </div>
      <div className="row mini" style={{ gap: 14, flexWrap: 'wrap', padding: '4px 6px', background: 'var(--accent-soft, #eef4ff)', borderRadius: 6 }} data-testid="grid-head">
        <span><b>{firmName}</b></span>
        <span>Конто: <b>{cur?.account ?? ''}</b> {cur ? names.get(cur.account) ?? '' : ''}</span>
        <span>Комитент: <b>{cur?.pcode ?? ''}</b> {pName}</span>
        <span>Налог: <b>{no}</b></span>
        <span>Датум: <b>{dmy(date)}</b></span>
      </div>
      {msg && <div className={`callout ${msg.error ? 'bad' : 'good'}`} role={msg.error ? 'alert' : 'status'}>{msg.error ?? msg.ok}</div>}
      {unbalanced.length > 0 && (
        <div className="callout warn row" role="alert" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
          <span>Промената не е зачувана: налогот не е изедначен (разлика {fmt0(jSaldo(unbalanced[0]!))}). Поправете друга ставка (или додадете нова со Ins) – штом Д = П, се зачувува.</span>
          <button type="button" className="btn sm" onClick={cancel}>↺ Откажи промени</button>
        </div>
      )}
      <div className="tw"><table className="dense nalg fit">
        <thead><tr>
          <th className="n">Р.бр.</th><th>Датум</th>{IZ && <th className="n">Изв. бр.</th>}<th style={{ minWidth: 180 }}>Содржина</th><th>Конто</th>
          <th className="n">Должи</th><th className="n">Побарува</th>{hasDoc && <th>Документ</th>}
          {dev && <><th className="n">Дев. должи</th><th className="n">Дев. побарува</th><th>Вал.</th></>}
          <th>Ком.ш.</th><th>Комитент</th>
        </tr></thead>
        <tbody>
          {R.map((r, i) => (
            <tr key={r.key} data-i={i} aria-selected={i === sel} onClick={() => setSel(i)} onDoubleClick={() => openChange(i)}
              style={{ cursor: 'default', ...(i === sel ? { outline: '2px solid var(--accent)', outlineOffset: -2 } : {}), ...(mark.has(r.key) ? { background: 'var(--warn-bg, #fff7e0)' } : {}), ...(r.added ? { fontStyle: 'italic' } : {}) }}>
              <td className="n">{mark.has(r.key) ? '✓ ' : ''}{i + 1}</td>
              <td style={{ whiteSpace: 'nowrap' }}>{dmy(r.date)}</td>
              {IZ && <td className="n"><b>{r.izNo}</b></td>}
              <td className="w">{r.jdesc}{r.note && r.note !== r.jdesc && <><br /><small className="mut">{r.note}</small></>}</td>
              <td title={names.get(r.account) ?? ''}><button type="button" className="btn sm ghost" style={{ padding: '0 4px', fontWeight: 700 }} onClick={(e) => { e.stopPropagation(); openChange(i); }} aria-label={`Промена на ставка ${i + 1}`}><span className="num">{r.account}</span></button></td>
              <td className="n">{fmt(r.debit)}</td><td className="n">{fmt(r.credit)}</td>
              {hasDoc && <td className="w">{r.doc}</td>}
              {dev && <><td className="n">{fmt(r.devD)}</td><td className="n">{fmt(r.devP)}</td><td>{r.cur && r.cur !== 'MKD' ? r.cur : ''}</td></>}
              <td className="num" style={{ color: 'var(--muted)' }}>{r.pcode}</td>
              <td className="w" style={{ maxWidth: 220 }}>{r.pname}</td>
            </tr>
          ))}
        </tbody>
        <tfoot data-testid="grid-foot">
          <tr>
            <td colSpan={IZ ? 4 : 3}>Салдо <b>{fmt0(r2(all.D - all.P))}</b> · селекција ({mark.size})</td>
            <td className="mini">ДОЛЖИ / ПОБАРУВА</td>
            <td className="n">{fmt0(S.D)}</td><td className="n">{fmt0(S.P)}</td>
            <td colSpan={(hasDoc ? 1 : 0) + (dev ? 3 : 0) + 2} className="mini">ВК. ДОЛЖИ <b>{fmt0(all.D)}</b> · ВК. ПОБАРУВА <b>{fmt0(all.P)}</b> ({R.length} ставки)</td>
          </tr>
          {dev && (
            <tr>
              <td colSpan={IZ ? 4 : 3}>Девизи: салдо <b>{fmt0(r2(all.dD - all.dP))}</b></td>
              <td className="mini">ДОЛЖИ / ПОБАРУВА</td>
              <td className="n">{fmt0(S.dD)}</td><td className="n">{fmt0(S.dP)}</td>
              <td colSpan={(hasDoc ? 1 : 0) + 3 + 2} className="mini">ВК. ДОЛЖИ <b>{fmt0(all.dD)}</b> · ВК. ПОБАРУВА <b>{fmt0(all.dP)}</b></td>
            </tr>
          )}
        </tfoot>
      </table></div>
      {fe && feJ && (
        <FastEntry key={`${fe.mode}-${fe.jid}-${fe.idx}`} mode={fe.mode} chart={chart} partners={partners} initial={feInit}
          fx={dev || !!feRow?.cur} fxLocked={feJ.mode === 'override'} dateLocked showStNo={feJ.bank}
          saldo={jSaldo(fe.jid, fe.idx)} no={fe.idx != null ? fe.idx + 1 : R.length + 1}
          prevContent={[...R].reverse().find((r) => r.jid === fe.jid && r.note)?.note ?? feJ.description}
          onSave={applyLine} onClose={() => setFe(null)} />
      )}
      {bankNew && bank && (
        <BankManualEntry chart={chart} partners={partners} accounts={bank.accounts} statements={bank.statements} onClose={() => setBankNew(false)}
          initial={{ acct: bank.statements.at(-1)?.acct ?? '', date: bank.statements.at(-1)?.date ?? '', stNo: bank.statements.at(-1)?.no ?? '' }} />
      )}
    </div>
  );
}
