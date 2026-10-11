'use client';
/**
 * Opening balance editor — legacy `VIEWS.pocetna` 6319 (+ obFull 13237, control `obCtlHTML` 10663, `obRes` 10688).
 * Excel/CSV import runs in the browser: SheetJS → `parseOpeningSheet` (legacy `obSheet`) → `buildOpening` (legacy `importOpen`).
 * FIX(#19): no global change listener re-rendering the screen per field; plain React state.
 */
import { useActionState, useState, useTransition } from 'react';
import {
  buildOpening, csvToGrid, lineTotals, parseOpeningSheet, resultBalancingRow, type MatchablePartner, type OpeningControl,
} from '@wise/core';
import type { ActionState } from '@/lib/books';
import { fmt } from '@/lib/fmt';
import { saveOpening } from './actions';

export interface ORow { account: string; name: string; partnerId: string; partnerName: string; partnerCode: string; debit: string; credit: string }
const blank = (): ORow => ({ account: '', name: '', partnerId: '', partnerName: '', partnerCode: '', debit: '', credit: '' });
const n = (s: string) => Number(String(s).replace(/\s/g, '').replace(',', '.')) || 0;

export function OpeningEditor({ year, full, initialDate, initialRows, chart, partners, saved }: {
  year: number; full: boolean; initialDate: string; initialRows: ORow[]; chart: [string, string][];
  partners: (MatchablePartner & { code: string | null })[]; saved: number;
}) {
  const [st, action, pending] = useActionState<ActionState, FormData>(saveOpening, {});
  const [date, setDate] = useState(initialDate);
  const [rows, setRows] = useState<ORow[]>(initialRows.length ? initialRows : [blank()]);
  const [ctl, setCtl] = useState<OpeningControl | null>(null);
  const [msg, setMsg] = useState('');
  const [reading, startRead] = useTransition();
  const names = new Map(chart);
  const t = lineTotals(rows.map((r) => ({ debit: n(r.debit), credit: n(r.credit) })));
  const setRow = (i: number, p: Partial<ORow>) => setRows((R) => R.map((r, k) => (k === i ? { ...r, ...p } : r)));

  const importFile = (file: File) => startRead(async () => {
    setMsg('Се чита…');
    try {
      let grid: unknown[][];
      let src: 'excel' | 'csv' = 'excel';
      if (/\.(xlsx|xls)$/i.test(file.name)) {
        const XLSX = await import('xlsx');
        const wb = XLSX.read(new Uint8Array(await file.arrayBuffer()), { type: 'array' });
        grid = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[wb.SheetNames[0]!]!, { header: 1, raw: true, defval: '' });
      } else if (/\.(csv|txt)$/i.test(file.name) || file.type === 'text/csv') {
        grid = csvToGrid(await file.text());
        src = 'csv';
      } else {
        setMsg('Поддржани се Excel (.xlsx, .xls) и CSV. PDF и слики ќе се читаат со AI во следна фаза.');
        return;
      }
      const R = parseOpeningSheet(grid, src);
      if (!R) { setMsg('Не се најдени колони „Конто“ и „Салдо / Должи / Побарува“.'); return; }
      const b = buildOpening(R, { full, partners });
      if (!b.rows.length) { setMsg('Не се најдени конта со салдо.'); return; }
      setRows((cur) => [...cur.filter((r) => r.account || n(r.debit) || n(r.credit)), ...b.rows.map((r) => ({
        account: r.account, name: r.name, partnerId: r.partnerId, partnerName: r.partnerName ?? '', partnerCode: r.partnerCode ?? '',
        debit: r.debit ? String(r.debit) : '', credit: r.credit ? String(r.credit) : '',
      }))]);
      setCtl(b.control);
      setMsg(`Внесени се ${b.rows.length} ставки (${b.control.byK.length} конта, ${b.control.nP} по партнери). Проверете ја контролата подолу и зачувајте.`);
    } catch {
      setMsg('Документот не е прочитан. Пробајте Excel/CSV.');
    }
  });

  return (
    <form action={action}>
      <input type="hidden" name="payload" value={JSON.stringify({ full, date, rows: rows.map((r) => ({ ...r, debit: n(r.debit), credit: n(r.credit) })) })} />
      {st.error && <div className="callout bad" role="alert">{st.error}</div>}
      {st.ok && <div className="callout good" role="status">{st.ok}</div>}
      <div className="card"><div className="cols">
        <div>
          <h2>{full ? `Увоз на бруто биланс за ${year} (Excel или CSV) – сите класи` : 'Увоз од аналитички бруто биланс (Excel или CSV)'}</h2>
          <p className="note">Секоја аналитичка ставка се внесува посебно – на пр. 20 купувачи на 1200 и 20 добавувачи на 2200, секој со свој партнер. Партнерите што ги нема се креираат при зачувување. Се земаат само колоните <b>САЛДО</b>; програмот ги споредува прочитаните ставки со печатените збирови.</p>
          <input type="file" accept=".xlsx,.xls,.csv,.txt,text/csv" disabled={reading} onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) importFile(f); }} />
          <div className="note">{msg}</div>
        </div>
        <div className="form">
          <label className="f">{full ? 'Датум на книжење' : 'Датум на почетната состојба'}
            <input type="date" value={full ? `${year}-12-31` : date} disabled={full} onChange={(e) => setDate(e.target.value)} />
          </label>
        </div>
      </div></div>

      {ctl && (
        <div className="card" style={{ borderColor: 'var(--accent)' }}>
          <div className="hd"><h2 style={{ fontSize: 15 }}>Контрола на прочитаниот бруто биланс</h2><button type="button" className="btn sm ghost" onClick={() => setCtl(null)}>✕</button></div>
          <p className="mini" style={{ margin: '0 0 6px' }}>Прочитани <b>{ctl.n}</b> аналитички ставки · {ctl.nP} со партнер ({ctl.nNew} нови партнери ќе се креираат, {ctl.nP - ctl.nNew} препознаени){ctl.dropped ? ` · ${ctl.dropped} збирни реда отстранети` : ''} · извор: Excel/CSV по колони</p>
          {ctl.bad.length > 0
            ? <div className="callout warn">✕ Не се совпаѓаат со печатените збирови: {ctl.bad.map((b) => <span key={b.k}><b>{b.k}</b> (документ {fmt(b.doc)}, прочитано {fmt(b.got)}) · </span>)}</div>
            : ctl.chk > 0 && <div className="callout good">✓ Сите {ctl.chk} печатени збирови по конта се совпаѓаат со прочитаните ставки.</div>}
          {ctl.res !== 0 && (
            <div className="callout warn">
              Конта од класи 4, 5, 7 и 8 (приходи/расходи) не се пренесуваат во почетна состојба – тие даваат резултат {fmt(Math.abs(ctl.res))} ({ctl.res < 0 ? 'добивка' : 'загуба'}).
              Ако бруто билансот не е затворен, резултатот треба да оди на {ctl.res < 0 ? '950 Задржана добивка' : '960 Пренесена загуба'}.{' '}
              <button type="button" className="btn sm" onClick={() => {
                const b = resultBalancingRow(ctl.res);
                if (b) setRows((R) => [...R, { ...blank(), account: b.account, name: names.get(b.account) ?? '', debit: b.debit ? String(b.debit) : '', credit: b.credit ? String(b.credit) : '' }]);
                setCtl({ ...ctl, res: 0 });
              }}>+ Додај ред {ctl.res < 0 ? '950' : '960'}</button>
            </div>
          )}
          <div className="tw" style={{ maxHeight: 260, overflow: 'auto' }}><table className="dense">
            <thead><tr><th>Конто</th><th>Назив</th><th className="n">Ставки</th><th className="n">Должи</th><th className="n">Побарува</th><th className="n">Салдо</th><th>Збир од документ</th></tr></thead>
            <tbody>{ctl.byK.map((x) => (
              <tr key={x.k}><td>{x.k}</td><td className="mini">{names.get(x.k) ?? x.name}</td><td className="n">{x.n}{x.nP ? <span className="mini"> ({x.nP} парт.)</span> : null}</td>
                <td className="n">{fmt(x.d)}</td><td className="n">{fmt(x.p)}</td><td className="n">{fmt(x.d - x.p)}</td>
                <td>{x.doc == null ? <span className="mini">—</span> : Math.abs(x.doc - (x.d - x.p)) < 1 ? <span className="pill good">✓</span> : <span className="pill bad">{fmt(x.doc)}</span>}</td></tr>
            ))}</tbody>
          </table></div>
        </div>
      )}

      <datalist id="kontoList">{chart.map(([k, v]) => <option key={k} value={k}>{v}</option>)}</datalist>
      <div className="tw"><table>
        <thead><tr><th>Конто</th><th>Назив</th><th>Партнер</th><th className="n">Должи</th><th className="n">Побарува</th><th /></tr></thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              <td><input list="kontoList" value={r.account} onChange={(e) => { const k = e.target.value.trim(); setRow(i, { account: k, name: names.get(k) ?? r.name }); }} style={{ width: 100 }} /></td>
              <td><input value={names.get(r.account) ?? r.name} readOnly={names.has(r.account)} placeholder={names.has(r.account) ? '' : 'назив на ново конто'} onChange={(e) => setRow(i, { name: e.target.value })} /></td>
              <td>
                <select value={r.partnerId} onChange={(e) => setRow(i, { partnerId: e.target.value, partnerName: e.target.value ? '' : r.partnerName })} style={{ maxWidth: 220 }}>
                  <option value="">—</option>
                  {partners.map((p) => <option key={p.id} value={p.id}>{p.code ? p.code + ' · ' : ''}{p.name}</option>)}
                </select>
                {!r.partnerId && r.partnerName && <div className="mini" style={{ color: 'var(--accent)' }}>+ нов партнер: {r.partnerName}{r.partnerCode ? ` (${r.partnerCode})` : ''}</div>}
              </td>
              <td><input inputMode="decimal" value={r.debit} onChange={(e) => setRow(i, { debit: e.target.value })} style={{ textAlign: 'right', width: 130 }} /></td>
              <td><input inputMode="decimal" value={r.credit} onChange={(e) => setRow(i, { credit: e.target.value })} style={{ textAlign: 'right', width: 130 }} /></td>
              <td><button type="button" className="btn sm ghost danger" aria-label="Отстрани" onClick={() => setRows((R) => R.filter((_, k) => k !== i))}>✕</button></td>
            </tr>
          ))}
        </tbody>
        <tfoot><tr>
          <td colSpan={3}>Разлика: {fmt(t.diff)} {t.balanced ? <span className="pill good">изедначено</span> : <span className="pill bad">не е изедначено</span>}</td>
          <td className="n">{fmt(t.D)}</td><td className="n">{fmt(t.P)}</td><td />
        </tr></tfoot>
      </table></div>
      <div className="row" style={{ gap: 8 }}>
        <button type="button" className="btn" onClick={() => setRows((R) => [...R, blank()])}>+ Ред</button>
        <div className="savebar"><button className="btn pri" disabled={pending || reading}>{full ? `Зачувај бруто биланс ${year}` : 'Зачувај почетна состојба'}</button></div>
        <span className="note">
          {saved ? `${full ? 'Бруто билансот' : 'Почетната состојба'} за ${year} е зачувана (${saved} ставки). Со зачувување таа се заменува.`
            : `Сè уште нема ${full ? 'увезен бруто биланс' : 'почетна состојба'} за ${year}.`}
        </span>
      </div>
    </form>
  );
}
