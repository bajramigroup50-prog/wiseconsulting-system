'use client';
/**
 * Manual journal editor — legacy `jEditor` 6403 (+ period 13460, nalog number 13472).
 * Totals update while typing (legacy 12981); one React state instead of the legacy global change listener.
 * Per-line note and document columns are new (FIX #9: the legacy editor had no per-line note).
 * „⚡ Нова ставка (Ins)“ opens the keyboard-first fast-entry dialog (F9 = add the line and the next one, Esc = close);
 * ✎ on a row opens the same dialog as „Промена на ставка“. The nalog is saved with „Зачувај (F4)“ and needs Д = П.
 */
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useActionState, useEffect, useRef, useState } from 'react';
import { lineTotals, needsPartner } from '@wise/core';
import { applyCustomScheme, type CustomScheme } from '@wise/core/finance';
import type { ActionState } from '@/lib/books';
import { fmt } from '@/lib/fmt';
import { FastEntry } from '@/components/fast-entry';
import { createKontoAction, saveJournal } from './actions';
import { blankRow as blank, fastToRow, isBlankRow, rowToFast, type EditorJournal, type EditorRow } from './editor-model';

/** End of month for "period from" (legacy 13461). */
const monthEnd = (d: string) => { const [y, m] = d.split('-').map(Number); return new Date(Date.UTC(y!, m!, 0)).toISOString().slice(0, 10); };

export function JournalEditor({ initial, title = '', chart: chart0, partners, numbers, schemes = [], fast = false }: {
  initial: EditorJournal; /** The nalog's „✎ Назив“ shown in the header. */ title?: string; chart: [string, string][]; partners: { id: string; code: string | null; name: string }[]; numbers: string[];
  /** Custom posting schemes (legacy `S.gsch.custom`, „Од шема“ `jFromSch` 7254). */
  schemes?: CustomScheme[];
  /** Open „Нова ставка“ right away („+ Рачен налог“ / „+ Ставки“). */
  fast?: boolean;
}) {
  // the fast-entry dialog: null = closed, { i: null } = new lines, { i } = change row i
  const [fe, setFe] = useState<{ i: number | null } | null>(fast ? { i: null } : null);
  const [added, setAdded] = useState<[string, string][]>([]);
  const chart = added.length ? [...chart0, ...added] : chart0;
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [sch, setSch] = useState(0);
  const [schAmt, setSchAmt] = useState('');
  const cancelHref = initial.id ? `/nalozi?n=${encodeURIComponent(initial.number)}` : '/nalozi';
  // Legacy 7891–7893: F4 = save, Esc = cancel.
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (fe || e.defaultPrevented) return; // the dialog has its own keys (F9 / Esc)
      if (e.key === 'F4') { e.preventDefault(); formRef.current?.requestSubmit(); }
      else if (e.key === 'Escape') { e.preventDefault(); router.push(cancelHref); }
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [router, cancelHref, fe]);
  const [st, action, pending] = useActionState<ActionState, FormData>(saveJournal, {});
  const [j, setJ] = useState(initial);
  const names = new Map(chart);
  const set = (p: Partial<EditorJournal>) => setJ((x) => ({ ...x, ...p }));
  const setRow = (i: number, p: Partial<EditorRow>) => setJ((x) => ({ ...x, rows: x.rows.map((r, k) => (k === i ? { ...r, ...p } : r)) }));
  const t = lineTotals(j.rows.map((r) => ({ debit: r.debit.replace(',', '.'), credit: r.credit.replace(',', '.') })));
  const num = (v: string) => Number(String(v).replace(',', '.')) || 0;
  const saldoWithout = (i: number | null) => j.rows.reduce((s, r, k) => (k === i ? s : s + num(r.debit) - num(r.credit)), 0);
  const saveFast = async (l: Parameters<typeof fastToRow>[0]) => {
    if (l.newKonto.mk && !chart.some(([c]) => c === l.konto)) {
      const r = await createKontoAction(l.konto, l.newKonto.name);
      if (r.error) return r.error;
      setAdded((A) => [...A, [l.konto, l.newKonto.name || l.konto]]);
    }
    // a new nalog takes its date from the dialog („Датум на книжење“)
    if (!j.id && l.date && l.date !== j.date) set({ date: l.date });
    if (fe?.i != null) { const i = fe.i; setJ((x) => ({ ...x, rows: x.rows.map((r, k) => (k === i ? fastToRow(l, r) : r)) })); return; }
    // the editor's empty starting rows (4400 / 1000 without amounts) give way to the typed lines
    setJ((x) => ({ ...x, rows: [...x.rows.filter((r) => !isBlankRow(r)), fastToRow(l)] }));
  };
  const liveRows = j.rows.filter((r) => !isBlankRow(r));
  const prevContent = [...j.rows].reverse().find((r) => r.note)?.note ?? j.description;

  return (
    <form ref={formRef} action={action} onKeyDown={(e) => { if (e.key === 'Insert' && !fe) { e.preventDefault(); setFe({ i: null }); } }}>
      <input type="hidden" name="payload" value={JSON.stringify(j)} />
      <div className="hd">
        <h1>{j.id ? 'Корекција на налог ' + j.number : 'Рачен налог за книжење'}{title && <span className="mk">{title}</span>}</h1>
        <div className="row">
          <Link className="btn" href={cancelHref}>Откажи (Esc)</Link>
          <button className="btn pri" disabled={pending}>Зачувај (F4)</button>
        </div>
      </div>
      {st.error && <div className="callout bad" role="alert">{st.error}</div>}
      <div className="card"><div className="form">
        <label className="f">Број на налог
          <input list="j_noL" value={j.number} onChange={(e) => set({ number: e.target.value })} placeholder="на пр. 6/10-12 (празно = автоматски)" />
          <datalist id="j_noL">{numbers.map((n) => <option key={n} value={n} />)}</datalist>
        </label>
        <label className="f">Датум<input type="date" value={j.date} onChange={(e) => set({ date: e.target.value })} required /></label>
        <label className="f wide">Опис<input value={j.description} onChange={(e) => set({ description: e.target.value })} /></label>
        <label className="f">Период од<input type="date" value={j.periodFrom}
          onChange={(e) => set({ periodFrom: e.target.value, ...(e.target.value && !j.periodTo ? { periodTo: monthEnd(e.target.value) } : {}) })} /></label>
        <label className="f">до<input type="date" value={j.periodTo} onChange={(e) => set({ periodTo: e.target.value })} /></label>
      </div></div>
      <datalist id="kontoList">{chart.map(([k, n]) => <option key={k} value={k}>{n}</option>)}</datalist>
      <div className="tw"><table>
        <thead><tr><th>Конто</th><th>Назив</th><th>Партнер</th><th className="n">Должи</th><th className="n">Побарува</th><th>Опис (ред)</th><th>Документ</th><th></th></tr></thead>
        <tbody>
          {j.rows.map((r, i) => {
            const miss = needsPartner(r.account) && !r.partnerId && (Number(r.debit) || Number(r.credit));
            return (
              <tr key={i}>
                <td><input list="kontoList" value={r.account} onChange={(e) => setRow(i, { account: e.target.value.trim() })} style={{ width: 100 }} className="kin" /></td>
                <td className="mini">{names.get(r.account) ?? (r.account ? <span style={{ color: 'var(--bad)' }}>непознато конто</span> : '')}</td>
                <td>
                  <select value={r.partnerId} onChange={(e) => setRow(i, { partnerId: e.target.value })} style={{ maxWidth: 220, ...(miss ? { borderColor: 'var(--bad)' } : {}) }}>
                    <option value="">—</option>
                    {partners.map((p) => <option key={p.id} value={p.id}>{p.code ? p.code + ' · ' : ''}{p.name}</option>)}
                  </select>
                </td>
                <td><input inputMode="decimal" value={r.debit} placeholder="0.00" onChange={(e) => setRow(i, { debit: e.target.value })} style={{ textAlign: 'right', width: 130 }} /></td>
                <td><input inputMode="decimal" value={r.credit} placeholder="0.00" onChange={(e) => setRow(i, { credit: e.target.value })} style={{ textAlign: 'right', width: 130 }} /></td>
                <td><input value={r.note} onChange={(e) => setRow(i, { note: e.target.value })} style={{ width: 190 }} /></td>
                <td><input value={r.doc} onChange={(e) => setRow(i, { doc: e.target.value })} style={{ width: 95 }} /></td>
                <td style={{ whiteSpace: 'nowrap' }}><button type="button" className="btn sm ghost" aria-label="Промена на ставка" title="Промена на ставка" onClick={() => setFe({ i })}>✎</button>
                  <button type="button" className="btn sm ghost danger" aria-label="Отстрани" onClick={() => set({ rows: j.rows.filter((_, k) => k !== i) })}>✕</button></td>
              </tr>
            );
          })}
        </tbody>
        <tfoot><tr>
          <td colSpan={3}>Разлика: {fmt(t.diff)} {t.balanced ? <span className="pill good">изедначен</span> : <span className="pill bad">не е изедначен</span>}</td>
          <td className="n">{fmt(t.D)}</td><td className="n">{fmt(t.P)}</td><td colSpan={3} />
        </tr></tfoot>
      </table></div>
      <div className="row" style={{ gap: 8 }}>
        <button type="button" className="btn pri" onClick={() => setFe({ i: null })} title="Брз внес: Enter = следно поле, F9 = зачувај и следна ставка, Esc = излез">⚡ Нова ставка (Ins)</button>
        <button type="button" className="btn" onClick={() => set({ rows: [...j.rows, blank('4400')] })}>+ Празен ред</button>
        <span className="note">Конто 120–128 и 220–228 бара партнер.</span>
        {schemes.length ? (
          <>
            <span className="mini" style={{ marginLeft: 14 }}>Од шема:</span>
            <select value={sch} onChange={(e) => setSch(+e.target.value)} style={{ width: 'auto' }}>
              {schemes.map((c, i) => <option key={c.id || i} value={i}>{c.name}</option>)}
            </select>
            <input inputMode="decimal" value={schAmt} onChange={(e) => setSchAmt(e.target.value)} placeholder="износ" style={{ width: 120, textAlign: 'right' }} />
            <button type="button" className="btn pri" onClick={() => {
              const c = schemes[sch]; const a = Number(schAmt.replace(',', '.'));
              if (!c || !(a > 0)) { window.alert('Изберете шема и внесете износ.'); return; }
              const R = applyCustomScheme(c, a).map((r) => ({ ...blank(r.account), debit: r.debit ? String(r.debit) : '', credit: r.credit ? String(r.credit) : '', note: r.note }));
              set({ rows: R, description: j.description || c.name });
            }}>Пополни</button>
          </>
        ) : <span className="note" style={{ marginLeft: 14 }}>Свои шеми креирате во Систем → Шеми за автоматско книжење → „+ Нова шема“.</span>}
      </div>
      {fe && (
        <FastEntry key={fe.i ?? 'new'} mode={fe.i == null ? 'new' : 'edit'} chart={chart} partners={partners} fx dateLocked={!!j.id}
          initial={fe.i == null ? { date: j.date, content: j.description } : rowToFast(j.rows[fe.i]!, j.date)}
          saldo={saldoWithout(fe.i)} no={fe.i == null ? liveRows.length + 1 : fe.i + 1} prevContent={prevContent}
          onSave={saveFast} onClose={() => setFe(null)} />
      )}
    </form>
  );
}
