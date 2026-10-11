'use client';
/**
 * Opening balance editor — legacy `VIEWS.pocetna` 6319 (+ obFull 13237, control `obCtlHTML` 10663, `obRes` 10688).
 * Excel/CSV import runs in the browser: SheetJS → `parseOpeningSheet` (legacy `obSheet`) → `buildOpening` (legacy `importOpen`).
 * FIX(#19): no global change listener re-rendering the screen per field; plain React state.
 */
import { useActionState, useEffect, useState, useTransition } from 'react';
import {
  buildOpening, csvToGrid, lineTotals, parseOpeningSheet, resultBalancingRow, type MatchablePartner, type OpeningControl,
} from '@wise/core';
import { obBankRows, obDiag, obFromAi, type ObDiagRow } from '@wise/core/finpar-ob';
import { AiReadList, useAiRead } from '@/components/ai-read';
import { xlsxDownload } from '@/components/parity-fin/export-bar';
import type { ActionState } from '@/lib/books';
import { fmt } from '@/lib/fmt';
import { addOpeningBanksAction, deleteOpening, makeOpeningPartnersAction, saveOpening } from './actions';
import { useRouter } from 'next/navigation';

export interface ORow { account: string; name: string; partnerId: string; partnerName: string; partnerCode: string; debit: string; credit: string; note?: string }
const blank = (): ORow => ({ account: '', name: '', partnerId: '', partnerName: '', partnerCode: '', debit: '', credit: '' });
/** Template of the Excel import (the headings `parseOpeningSheet` recognises). */
const TEMPLATE = [['Конто', 'Назив на конто', 'Комитент', 'Шифра на комитент / ЕДБ', 'Салдо должи', 'Салдо побарува'],
  ['1200', 'Побарувања од купувачи во земјата', 'ПРИМЕР ДООЕЛ Скопје', '4030000000000', 12000, 0], ['2200', 'Обврски кон добавувачи во земјата', 'ДОБАВУВАЧ ДОО', '4030000000001', 0, 12000]];
type Extra = { netZero: { k: string; n: number; g: number }[]; grand: [number, number]; remapped: number; src: string };
const n = (s: string) => Number(String(s).replace(/\s/g, '').replace(',', '.')) || 0;
const n0 = n;

export function OpeningEditor({ year, full, initialDate, initialRows, chart, partners, saved, firmId = '', bankKontos = [], isAdmin = false, canDelete = false }: {
  year: number; full: boolean; initialDate: string; initialRows: ORow[]; chart: [string, string][];
  partners: (MatchablePartner & { code: string | null })[]; saved: number;
  /** Firm (for the AI read of PDF / images) and the kontos it already has bank accounts for. */
  firmId?: string; bankKontos?: string[];
  /** legacy `obClearAll` 12834: the saved opening balance is deleted only by an administrator */
  isAdmin?: boolean; canDelete?: boolean;
}) {
  const [st, action, pending] = useActionState<ActionState, FormData>(saveOpening, {});
  const [date, setDate] = useState(initialDate);
  const [rows, setRows] = useState<ORow[]>(initialRows.length ? initialRows : [blank()]);
  const [ctl, setCtl] = useState<OpeningControl | null>(null);
  const [msg, setMsg] = useState('');
  const [reading, startRead] = useTransition();
  const [extra, setExtra] = useState<Extra | null>(null);
  const [diagOn, setDiagOn] = useState(false);
  const [findV, setFindV] = useState('');
  const ai = useAiRead(firmId);
  const router = useRouter();
  const [busy, startBusy] = useTransition();
  const [note, setNote] = useState('');
  const missingP = rows.filter((r) => r.partnerName && !r.partnerId && r.account);
  const missingPn = new Set(missingP.map((r) => r.partnerName.toLowerCase())).size;
  const clearAll = () => {
    const n = rows.filter((r) => r.account || n0(r.debit) || n0(r.credit)).length;
    if (!n && !saved) { setNote('Нема ставки за бришење.'); return; }
    if (!window.confirm(`Да се избришат СИТЕ ${n} ставки од почетната состојба${saved ? ` (и зачуваниот налог за отворање ${year})` : ''}?`)) return;
    setRows([blank()]); setCtl(null); setExtra(null);
    if (saved) {
      if (!isAdmin || !canDelete) { setNote('Зачуваната почетна состојба може да ја избрише само администраторот. Ставките на екранот се исчистени.'); return; }
      if (!window.confirm(`⚠ ПОСЛЕДНА ПОТВРДА\n\nЗачуваниот налог за отворање ${year} (${saved} ставки) ќе се избрише. Бруто билансот ќе остане без почетна состојба додека не внесете нова.\n\nДа се избрише?`)) return;
      startBusy(async () => { const r = await deleteOpening(full); setNote(r.error ?? 'Почетната состојба е исчистена – можете повторно да ја увезете.'); router.refresh(); });
      return;
    }
    setNote('Почетната состојба е исчистена – можете повторно да ја увезете.');
  };
  const names = new Map(chart);
  const t = lineTotals(rows.map((r) => ({ debit: n(r.debit), credit: n(r.credit) })));
  const setRow = (i: number, p: Partial<ORow>) => setRows((R) => R.map((r, k) => (k === i ? { ...r, ...p } : r)));

  /** Rows of a parsed sheet / read → editor rows + control (legacy `importOpen` 10670). */
  const applySheet = (R: Parameters<typeof buildOpening>[0], x?: Omit<Extra, 'src'>) => {
    const b = buildOpening(R, { full, partners });
    if (!b.rows.length) { setMsg('Не се најдени конта со салдо.'); return; }
    setRows((cur) => [...cur.filter((r) => r.account || n(r.debit) || n(r.credit)), ...b.rows.map((r) => ({
      account: r.account, name: r.name, partnerId: r.partnerId, partnerName: r.partnerName ?? '', partnerCode: r.partnerCode ?? '',
      debit: r.debit ? String(r.debit) : '', credit: r.credit ? String(r.credit) : '',
    }))]);
    setCtl(b.control);
    setExtra(x ? { ...x, src: 'ai' } : null);
    setMsg(`Внесени се ${b.rows.length} ставки (${b.control.byK.length} конта, ${b.control.nP} по партнери). Проверете ја контролата подолу и зачувајте.`);
  };
  // legacy `obAi` 10646: PDF / images are read by AI (worker kind `ob`, prompt `OB_PROMPT`)
  useEffect(() => {
    const d = ai.docs.find((x) => x.status === 'done' && x.result);
    if (!d) return;
    ai.setDocs((D) => D.map((x) => (x.id === d.id ? { ...x, status: 'saved' } : x)));
    const r = obFromAi(d.result, { full });
    if (!r.rows.length) { setMsg('Документот не е прочитан. Пробајте Excel/CSV или појасна слика.'); return; }
    applySheet({ rows: r.rows, totals: r.totals, src: 'csv' }, { netZero: r.netZero, grand: r.grand, remapped: r.remapped });
  }, [ai.docs]); // eslint-disable-line react-hooks/exhaustive-deps

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
      } else if (/pdf|image\//i.test(file.type) || /\.(pdf|jpe?g|png|webp)$/i.test(file.name)) {
        if (!firmId) { setMsg('Автоматското читање не е достапно; користете Excel/CSV или внесете рачно.'); return; }
        setMsg('Се чита бруто билансот… (10–60 секунди)');
        await ai.read('ob', [file]);
        return;
      } else {
        setMsg('Поддржани се Excel (.xlsx, .xls), CSV, PDF и слики.');
        return;
      }
      const R = parseOpeningSheet(grid, src);
      if (!R) { setMsg('Не се најдени колони „Конто“ и „Салдо / Должи / Побарува“.'); return; }
      applySheet(R);
    } catch {
      setMsg('Документот не е прочитан. Пробајте Excel/CSV.');
    }
  });

  return (
    <form action={action} onSubmit={(e) => {
      // legacy 17173: a full-year trial balance for the current (unfinished) year is most likely a mistake
      if (full && year >= new Date().getFullYear() && !window.confirm(`Горе е избрана тековната година ${year}. Дали бруто билансот е навистина за ${year}?`)) e.preventDefault();
    }}>
      <input type="hidden" name="payload" value={JSON.stringify({ full, date, rows: rows.map((r) => ({ ...r, debit: n(r.debit), credit: n(r.credit) })) })} />
      {st.error && <div className="callout bad" role="alert">{st.error}</div>}
      {st.ok && <div className="callout good" role="status">{st.ok}</div>}
      <div className="card"><div className="cols">
        <div>
          <h2>{full ? `Увоз на бруто биланс за ${year} (Excel или CSV) – сите класи` : 'Увоз од аналитички бруто биланс (Excel или CSV)'}</h2>
          <p className="note">Секоја аналитичка ставка се внесува посебно – на пр. 20 купувачи на 1200 и 20 добавувачи на 2200, секој со свој партнер. Партнерите што ги нема се креираат при зачувување. Се земаат само колоните <b>САЛДО</b>; програмот ги споредува прочитаните ставки со печатените збирови.</p>
          <input type="file" accept=".xlsx,.xls,.csv,.txt,text/csv,.pdf,application/pdf,image/*" disabled={reading || ai.busy} onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) importFile(f); }} />
          <div className="row" style={{ gap: 6, marginTop: 6 }}>
            <button type="button" className="btn sm ghost" onClick={() => xlsxDownload('Pocetna_sostojba_obrazec.xlsx', [{ name: 'Бруто биланс', rows: TEMPLATE }])}>⬇ Excel образец</button>
            <button type="button" className="btn sm ghost" onClick={() => xlsxDownload(`Pocetna_sostojba_${year}.xlsx`, [{ name: 'Почетна состојба', rows: [TEMPLATE[0]!, ...rows.filter((r) => r.account).map((r) => [r.account, names.get(r.account) ?? r.name, partners.find((p) => p.id === r.partnerId)?.name ?? r.partnerName, partners.find((p) => p.id === r.partnerId)?.code ?? r.partnerCode, n(r.debit), n(r.credit)])] }])}>⬇ Excel (ставките)</button>
          </div>
          <div className="note">{msg}</div>
          <AiReadList docs={ai.docs} msg={ai.msg} />
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
          <p className="mini" style={{ margin: '0 0 6px' }}>Прочитани <b>{ctl.n}</b> аналитички ставки · {ctl.nP} со партнер ({ctl.nNew} нови партнери ќе се креираат, {ctl.nP - ctl.nNew} препознаени){ctl.dropped ? ` · ${ctl.dropped} збирни реда отстранети` : ''} · извор: {extra?.src === 'ai' ? 'автоматско читање (PDF/слика)' : 'Excel/CSV по колони'}</p>
          {extra && (extra.grand[0] || extra.grand[1]) ? (Math.abs(extra.grand[0] - ctl.D) < 1 && Math.abs(extra.grand[1] - ctl.P) < 1
            ? <div className="callout good">✓ Вкупното салдо од документот (Д {fmt(extra.grand[0])} / П {fmt(extra.grand[1])}) се совпаѓа со прочитаното.</div>
            : <div className="callout warn">Вкупно на документот: должи {fmt(extra.grand[0])} / побарува {fmt(extra.grand[1])} · прочитано: {fmt(ctl.D)} / {fmt(ctl.P)} – разлика {fmt(ctl.D - extra.grand[0])} / {fmt(ctl.P - extra.grand[1])}.</div>) : null}
          {!!extra?.netZero.length && <div className="callout" style={{ margin: '6px 0' }}>Не се пренесуваат конта чии ставки по комитенти се пребиваат на нула (салдо 0): {extra.netZero.map((x) => <span key={x.k}><b>{x.k}</b> {names.get(x.k) ?? ''} ({x.n} ставки, {fmt(x.g)} Д = П) · </span>)}</div>}
          {!!extra?.remapped && <div className="callout" style={{ margin: '6px 0' }}>Добивката/загубата од претходната година (951/961) е пренесена на 950/960.</div>}
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

      {(() => {
        // legacy `obBankRows` callout 12226: bank accounts are created on save
        const B = full ? [] : obBankRows(rows.map((r) => ({ ...r, name: names.get(r.account) ?? r.name })), bankKontos);
        return B.length ? (
          <div className="callout" style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <span>🏦 Банкарски сметки во бруто билансот: {B.map((r) => <span key={r.account}><b>{r.account}</b> {r.name}{/^103/.test(r.account) ? ' (девизна)' : ''} · </span>)}</span><span style={{ flex: 1 }} />
            <button type="button" className="btn" style={{ fontWeight: 700 }} disabled={busy} onClick={() => startBusy(async () => { const r = await addOpeningBanksAction(B.map((x) => ({ account: x.account, name: x.name }))); setNote(r.error ?? r.ok ?? ''); router.refresh(); })}>+ Внеси ги како сметки на фирмата</button>
          </div>
        ) : null;
      })()}
      {missingP.length > 0 && (
        <div className="callout" style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <span>👥 <b>{missingPn}</b> партнери од бруто билансот ги нема во шифрарникот ({missingP.length} ставки).</span><span style={{ flex: 1 }} />
          <button type="button" className="btn pri" style={{ fontWeight: 700 }} disabled={busy} onClick={() => {
            if (!window.confirm(`Да се внесат ${missingPn} нови партнери (комитенти) во шифрарникот и да се поврзат со ${missingP.length} ставки?`)) return;
            startBusy(async () => {
              const r = await makeOpeningPartnersAction(missingP.map((x) => ({ partnerName: x.partnerName, partnerCode: x.partnerCode })));
              if (r.map) setRows((R) => R.map((x) => (x.partnerName && !x.partnerId && r.map![x.partnerName] ? { ...x, partnerId: r.map![x.partnerName]!, partnerName: '', partnerCode: '' } : x)));
              setNote(r.error ?? r.ok ?? '');
              router.refresh();
            });
          }}>+ Внеси ги сите како комитенти сега</button>
        </div>
      )}
      {note && <div className="callout" role="status">{note}</div>}
      {(!t.balanced || diagOn) && <DiffPanel rows={rows} names={names} partners={partners} printed={ctl?.byK ?? []} on={diagOn} toggle={() => setDiagOn(!diagOn)} findV={findV} setFindV={setFindV}
        swap={(i) => { setRows((R) => R.map((r, k) => (k === i ? { ...r, debit: r.credit, credit: r.debit } : r))); setNote('Страната е сменета: ' + (rows[i]?.account ?? '') + ' ' + (rows[i]?.partnerName || rows[i]?.name || '')); }}
        remove={(ix) => setRows((R) => R.filter((_, k) => !ix.includes(k)))} />}
      <datalist id="kontoList">{chart.map(([k, v]) => <option key={k} value={k}>{v}</option>)}</datalist>
      <div className="tw"><table>
        <thead><tr><th>Конто</th><th>Назив</th><th>Партнер</th><th className="n">Должи</th><th className="n">Побарува</th><th /></tr></thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} id={`ox-${i}`}>
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
        <button type="button" className="btn danger" disabled={busy} title="Ги брише сите ставки одеднаш" onClick={clearAll}>🗑 Избриши ги сите</button>
        <button className="btn pri" disabled={pending || reading}>{full ? `Зачувај бруто биланс ${year}` : 'Зачувај почетна состојба'}</button>
        <span className="note">
          {saved ? `${full ? 'Бруто билансот' : 'Почетната состојба'} за ${year} е зачувана (${saved} ставки). Со зачувување таа се заменува.`
            : `Сè уште нема ${full ? 'увезен бруто биланс' : 'почетна состојба'} за ${year}.`}
        </span>
      </div>
    </form>
  );
}

/** Legacy „🔍 Анализа на разликата“ (12296 / 12314 / 12338): why the opening balance does not balance. */
function DiffPanel({ rows, names, partners, printed, on, toggle, findV, setFindV, swap, remove }: {
  rows: ORow[]; names: Map<string, string>; partners: { id: string; name: string }[]; printed: { k: string; doc: number | null }[];
  on: boolean; toggle: () => void; findV: string; setFindV: (v: string) => void; swap: (i: number) => void; remove: (ix: number[]) => void;
}) {
  const pn = new Map(partners.map((p) => [p.id, p.name]));
  const R: ObDiagRow[] = rows.map((r, i) => ({ i, account: r.account, label: r.partnerName || pn.get(r.partnerId) || r.name || names.get(r.account) || '', partner: r.partnerId || r.partnerName, debit: n(r.debit), credit: n(r.credit) }));
  const t = lineTotals(R);
  const X = obDiag(R, { known: (k) => names.has(k), printed });
  const nm = (r: ObDiagRow) => `${r.account} ${r.label}`;
  const amt = (r: ObDiagRow) => (r.debit ? 'Д ' + fmt(r.debit) : 'П ' + fmt(r.credit));
  const go = (r: ObDiagRow) => <button type="button" className="btn sm" onClick={() => { const el = document.getElementById('ox-' + r.i); if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); el.style.outline = '3px solid var(--warn)'; setTimeout(() => { el.style.outline = ''; }, 4000); } }}>→ ред</button>;
  const sw = (r: ObDiagRow) => <button type="button" className="btn sm" title="Смени Должи ↔ Побарува" onClick={() => swap(r.i)}>⇄ Д/П</button>;
  const ad = Math.abs(X.diff);
  // legacy `obDocT` 12345: the document's grand total (Д = П) against what was read
  const [docT, setDocT] = useState('');
  const T = n(docT.replace(/\.(?=\d{3}(\D|$))/g, ''));
  const eD = T ? X.D - T : 0, eP = T ? X.P - T : 0;
  const fv = n(findV.replace(/\.(?=\d{3}(\D|$))/g, ''));
  const found = fv ? R.filter((r) => r.account && (Math.abs((r.debit || r.credit) - fv) < 0.5 || Math.abs((r.debit || r.credit) - fv / 2) < 0.5)) : [];
  return (
    <>
      <div className="row" style={{ gap: 8, margin: '0 0 8px' }}><button type="button" className={`btn ${on ? 'pri' : ''}`} style={{ fontWeight: 700 }} onClick={toggle}>🔍 Анализа на разликата ({fmt(t.diff)})</button></div>
      {on && (
        <div className="card" style={{ borderColor: 'var(--warn)' }}>
          <h2 style={{ fontSize: 15, margin: '0 0 6px' }}>🔍 Анализа: Должи {fmt(X.D)} · Побарува {fmt(X.P)} · разлика <b>{fmt(X.diff)}</b> ({X.diff < 0 ? 'побарува е повеќе' : 'должи е повеќе'})</h2>
          <table className="dense" style={{ maxWidth: 560 }}><thead><tr><th>Класа</th><th className="n">Ставки</th><th className="n">Должи</th><th className="n">Побарува</th><th className="n">Салдо</th></tr></thead>
            <tbody>{X.cls.map((c) => <tr key={c.c}><td>{c.c}</td><td className="n">{c.n}</td><td className="n">{fmt(c.d)}</td><td className="n">{fmt(c.p)}</td><td className="n">{fmt(c.d - c.p)}</td></tr>)}</tbody></table>
          {Math.abs(X.res) > 0.5 && <div className={`callout ${Math.abs(Math.abs(X.res) - ad) < 0.5 ? 'warn' : ''}`} style={{ marginTop: 8 }}>Класите 4–8 (расходи/приходи) имаат салдо {fmt(X.res)}{Math.abs(Math.abs(X.res) - ad) < 0.5 ? <> – <b>исто колку разликата</b>: билансот не е затворен, додајте ред за резултатот (950 добивка / 960 загуба) или отстранете ги класите 4–8.</> : null}</div>}
          {X.ctl.length > 0 && <div className="callout warn" style={{ marginTop: 8 }}><b>Конта што не се совпаѓаат со печатениот збир во документот:</b><br />{X.ctl.map((c) => <span key={c.k}><b>{c.k}</b> {names.get(c.k) ?? ''}: прочитано {fmt(c.net)}, во документот {fmt(c.doc)} → разлика <b>{fmt(c.net - c.doc)}</b><br /></span>)}<span className="mini">Таму недостасува или е погрешно прочитан ред.</span></div>}
          {X.hits.length > 0 && <div className="callout warn" style={{ marginTop: 8 }}><b>Ставки со износ поврзан со разликата:</b><br />{X.hits.map((x) => <span key={x.r.i}>{nm(x.r)} · {amt(x.r)} – {x.why} {go(x.r)} {sw(x.r)}<br /></span>)}</div>}
          {X.dup.length > 0 && <div className="callout" style={{ marginTop: 8 }}><b>Двојни ставки (исто конто, партнер и износ):</b><br />{X.dup.map((g) => <span key={g[0]!.i}>{nm(g[0]!)} · {amt(g[0]!)} × {g.length} {go(g[1]!)}<br /></span>)}<span className="mini">Ако во документот ставката е само еднаш, избришете го дупликатот.</span></div>}
          {X.both.length > 0 && <div className="callout" style={{ marginTop: 8 }}><b>Ставки со износ и во Должи и во Побарува:</b><br />{X.both.map((r) => <span key={r.i}>{nm(r)} · Д {fmt(r.debit)} / П {fmt(r.credit)} {go(r)}<br /></span>)}</div>}
          {X.noK.length > 0 && <div className="callout" style={{ marginTop: 8 }}><b>Конта што ги нема во контниот план:</b><br />{X.noK.map((r) => <span key={r.i}>{nm(r)} · {amt(r)} {go(r)}<br /></span>)}</div>}
          {X.sub.length > 0 && <div className="callout warn" style={{ marginTop: 8 }}><b>Збирни (вкупни) редови прочитани како ставки:</b><br />{X.sub.map((x) => <span key={x.r.i}>{nm(x.r)} · {amt(x.r)} – {x.why} {go(x.r)}<br /></span>)}
            <button type="button" className="btn sm danger" onClick={() => remove(X.sub.map((x) => x.r.i))}>✕ Отстрани ги сите {X.sub.length} збирни редови</button></div>}
          <div style={{ marginTop: 10, display: 'grid', gap: 8 }}>
            <div className="row" style={{ gap: 6, alignItems: 'center', flexWrap: 'wrap' }}><b>Барај износ:</b><input value={findV} placeholder={fmt(ad)} onChange={(e) => setFindV(e.target.value)} style={{ width: 160 }} /><span className="mini">ги наоѓа ставките со тој износ или со половина од него</span></div>
            {fv > 0 && <div className="callout">{found.length ? found.map((r) => <span key={r.i}>{nm(r)} · {amt(r)} {go(r)} {sw(r)}<br /></span>) : `Нема ставка со износ ${findV} (ниту половина).`}</div>}
            {X.pairs.length > 0 && <div className="callout"><b>Две ставки што заедно даваат {fmt(ad)}</b> (можеби една од нив недостасува од другата страна или е двојна):<br />{X.pairs.map(([a, b]) => <span key={a.i + '-' + b.i}>{nm(a)} · {amt(a)} + {nm(b)} · {amt(b)} {go(a)} {go(b)}<br /></span>)}</div>}
            <div className="callout"><b>Плати и обврски кон вработени (24.., 41.., 42..):</b> {X.pay.length ? <><br />{X.pay.map((r) => <span key={r.i}>{nm(r)} · {amt(r)} {go(r)} {sw(r)}<br /></span>)}</> : 'нема такви ставки во почетната состојба – ако во документот ги има (на пр. 2400 нето плати, 2410 придонеси), тие недостасуваат.'}</div>
            {!X.ctl.length && !X.hits.length && !X.dup.length && !X.both.length && !X.sub.length && Math.abs(Math.abs(X.res) - ad) >= 0.5 && <p className="note">Не се најде автоматска причина. Споредете ги збировите по класа погоре со бруто билансот – класата што не се совпаѓа ја содржи грешката.</p>}
            <div className="row" style={{ gap: 6, alignItems: 'center', flexWrap: 'wrap', borderTop: '1px solid var(--line)', paddingTop: 8 }}><b>Вкупно салдо од документот (Д = П):</b><input value={docT} placeholder="на пр. 12,059,456" onChange={(e) => setDocT(e.target.value)} style={{ width: 160 }} /></div>
            {T > 0 && <div className={`callout ${Math.abs(eD) < 1 && Math.abs(eP) < 1 ? 'good' : 'warn'}`}>Прочитано: Должи {fmt(X.D)} ({eD >= 0 ? 'повеќе' : 'помалку'} за <b>{fmt(Math.abs(eD))}</b>) · Побарува {fmt(X.P)} ({eP >= 0 ? 'повеќе' : 'помалку'} за <b>{fmt(Math.abs(eP))}</b>).{eD > 0.5 && eP > 0.5 ? ' Двете страни се поголеми → најверојатно се прочитани збирни редови (вкупно по конто/група) како ставки.' : ''}</div>}
            <p className="mini" style={{ margin: 0 }}>„⇄ Д/П“ ја менува страната на ставката – ако ставка од {fmt(ad / 2)} е на погрешна страна, по промената разликата станува 0.</p>
          </div>
        </div>
      )}
    </>
  );
}
