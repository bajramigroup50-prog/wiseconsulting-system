'use client';
/** Result screens of the card reconciliation (legacy `VIEWS.recon` 12933 + `recPdf`/`recXlsx`) and `VIEWS.recFree` 13756. */
import { useState, useTransition } from 'react';
import type { RecResult } from '@wise/core/finance';
import { dmy, fmt } from '@/lib/fmt';
import { DownloadCsv } from '@/components/download-csv';
import { PdfButton } from '@/components/pdf-button';
import { compareAction, reconAction } from './actions';
import { RecArchive } from './archive';
import { readCardsAi } from './card-ai';

type Recon = Extract<Awaited<ReturnType<typeof reconAction>>, { ok: true }>;
type Cmp = Extract<Awaited<ReturnType<typeof compareAction>>, { ok: true }>;

const Td = ({ v }: { v: string | number | null | undefined }) => (typeof v === 'number' ? <td className="n">{fmt(v)}</td> : <td>{v ?? ''}</td>);
const Tiles = ({ T }: { T: [string, number][] }) => (
  <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
    {T.map(([t, v], i) => <div key={t} className="card" style={{ flex: 1, minWidth: 200 }}><div className="mini">{t}</div><div style={{ fontSize: 22, fontWeight: 700, color: i === 2 && Math.abs(v) > 0.009 ? 'var(--bad)' : undefined }}>{fmt(v)}</div></div>)}
  </div>
);

/**
 * The two lists next to each other: left „фали кај <2>“ (only in card 1), right „фали кај <1>“ (only in card 2), each in
 * date order without gaps, with its total; under them the documents both have with a different amount.
 */
function SideBySide({ M, n1, n2 }: { M: RecResult; n1: string; n2: string }) {
  const A = [...M.onlyO].sort((x, y) => String(x.date).localeCompare(String(y.date)));
  const B = [...M.onlyT].sort((x, y) => String(x.date).localeCompare(String(y.date)));
  const n = Math.max(A.length, B.length);
  const sa = A.reduce((s, x) => s + x.amt, 0), sb = B.reduce((s, x) => s + x.amt, 0);
  const sep = { borderLeft: '3px solid #666' };
  const nw = { whiteSpace: 'nowrap' as const };
  return (
    <>
      {n > 0 && <table className="dense">
        <thead>
          <tr>
            <th colSpan={4} style={{ textAlign: 'center', background: 'rgba(220,50,50,.10)' }}>Фали кај {n2} – ги има само {n1} ({A.length})</th>
            <th colSpan={4} style={{ textAlign: 'center', background: 'rgba(220,50,50,.10)', ...sep }}>Фали кај {n1} – ги има само {n2} ({B.length})</th>
          </tr>
          <tr><th>Датум</th><th>Документ</th><th>Опис</th><th className="n">Износ</th><th style={sep}>Датум</th><th>Документ</th><th>Опис</th><th className="n">Износ</th></tr>
        </thead>
        <tbody>{Array.from({ length: n }, (_, i) => {
          const x = A[i], y = B[i];
          return (
            <tr key={i}>
              <td style={nw}>{x ? dmy(x.date) : ''}</td><td style={nw}>{x?.doc ?? ''}</td><td>{x?.label ?? ''}</td><td className="n">{x ? fmt(x.amt) : ''}</td>
              <td style={{ ...sep, ...nw }}>{y ? dmy(y.date) : ''}</td><td style={nw}>{y?.doc ?? ''}</td><td>{y?.desc ?? ''}</td><td className="n">{y ? fmt(y.amt) : ''}</td>
            </tr>
          );
        })}</tbody>
        <tfoot><tr><td colSpan={3}><b>Вкупно</b></td><td className="n"><b>{fmt(sa)}</b></td><td colSpan={3} style={sep}><b>Вкупно</b></td><td className="n"><b>{fmt(sb)}</b></td></tr></tfoot>
      </table>}
      {M.adiff.length > 0 && <>
        <h2 style={{ fontSize: 15, margin: '12px 0 4px' }}>Ист документ кај двајцата – различен износ ({M.adiff.length})</h2>
        <table className="dense" style={{ width: 'auto' }}>
          <thead><tr><th>Документ кај {n1}</th><th>Документ кај {n2}</th><th className="n">{n1}</th><th className="n">{n2}</th><th className="n">Разлика</th></tr></thead>
          <tbody>{M.adiff.map((x, i) => <tr key={i}><td style={nw}>{dmy(x.o.date)} · {x.o.doc}</td><td style={nw}>{dmy(x.t.date)} · {x.t.doc}</td><td className="n">{fmt(x.o.amt)}</td><td className="n">{fmt(x.t.amt)}</td><td className="n"><b>{fmt(x.diff)}</b></td></tr>)}</tbody>
          <tfoot><tr><td colSpan={4}><b>Вкупно</b></td><td className="n"><b>{fmt(M.adiff.reduce((s, x) => s + x.diff, 0))}</b></td></tr></tfoot>
        </table>
      </>}
    </>
  );
}
/** „Што фали“: the total difference split into its parts. */
function ParSum({ M, n1, n2 }: { M: RecResult; n1: string; n2: string }) {
  const so = M.onlyO.reduce((s, x) => s + x.amt, 0), stt = M.onlyT.reduce((s, x) => s + x.amt, 0), sd = M.adiff.reduce((s, x) => s + x.diff, 0);
  return (
    <table className="dense" style={{ width: 'auto' }}><tbody>
      <tr><td>Ги има само <b>{n1}</b> – фалат кај <b>{n2}</b></td><td className="n">{M.onlyO.length}</td><td className="n"><b>{fmt(so)}</b></td></tr>
      <tr><td>Ги има само <b>{n2}</b> – фалат кај <b>{n1}</b></td><td className="n">{M.onlyT.length}</td><td className="n"><b>{fmt(-stt)}</b></td></tr>
      <tr><td>Ист документ кај двајцата – <b>различен износ</b></td><td className="n">{M.adiff.length}</td><td className="n"><b>{fmt(sd)}</b></td></tr>
      <tr><td><b>Вкупна разлика</b></td><td /><td className="n"><b>{fmt(so - stt + sd)}</b></td></tr>
      <tr><td className="muted">Усогласени ставки</td><td className="n muted">{M.pairs.length}</td><td /></tr>
    </tbody></table>
  );
}

/** The differences (screen) + a hidden `.pdfdoc` записник for the server PDF. */
function Diffs({ M, l1, l2, n1 = 'лево', n2 = 'десно', title, sub, recon, file, extra }: { M: RecResult; l1: string; l2: string; n1?: string; n2?: string; title: string; sub: string; recon?: boolean; file?: string; extra?: React.ReactNode }) {
  const sum = (a: { amt: number }[]) => fmt(a.reduce((s, x) => s + x.amt, 0));
  const none = !M.onlyO.length && !M.onlyT.length && !M.adiff.length;
  const csv: (string | number)[][] = [['Вид', 'Датум', 'Документ', 'Опис', l1, l2, 'Разлика']];
  for (const o of M.onlyO) csv.push(['Само – ' + l1, dmy(o.date), o.doc, o.label, o.amt, '', o.amt]);
  for (const t of M.onlyT) csv.push(['Само – ' + l2, dmy(t.date), t.doc, t.desc, '', t.amt, -t.amt]);
  for (const x of M.adiff) csv.push(['Различен износ', dmy(x.o.date), x.o.doc + ' / ' + x.t.doc, '', x.o.amt, x.t.amt, x.diff]);
  for (const x of M.pairs) csv.push(['Усогласено', dmy(x.o.date), x.o.doc + ' / ' + x.t.doc, x.how, x.o.amt, x.t.amt, 0]);
  return (
    <>
      <div className="row" style={{ gap: 8, margin: '8px 0' }}>
        <DownloadCsv name={`${file ?? 'Usoglasuvanje'}.csv`} label="Excel" rows={csv} />
        <PdfButton selector="#recDoc .pdfdoc" title="Записник за усогласување" />
      </div>
      <div className="card"><h2 style={{ marginTop: 0 }}>Што фали – од што се состои разликата</h2><ParSum M={M} n1={n1} n2={n2} /></div>
      {!none && <div className="card tw"><SideBySide M={M} n1={n1} n2={n2} /></div>}
      <details className="card"><summary style={{ cursor: 'pointer', fontWeight: 600 }}>✓ Усогласени ставки ({M.pairs.length})</summary>
        <div className="tw"><table className="dense"><thead><tr><th>{recon ? 'Наш датум' : 'Датум 1'}</th><th>{recon ? 'Наш документ' : 'Документ 1'}</th><th>{recon ? 'Нивен датум' : 'Датум 2'}</th><th>{recon ? 'Нивен документ' : 'Документ 2'}</th><th className="n">Износ</th><th>Поврзано по</th></tr></thead>
          <tbody>{M.pairs.map((x, i) => <tr key={i}><Td v={dmy(x.o.date)} /><Td v={x.o.doc} /><Td v={dmy(x.t.date)} /><Td v={x.t.doc} /><Td v={x.o.amt} /><Td v={x.how} /></tr>)}</tbody></table></div>
      </details>
      <div id="recDoc" style={{ display: 'none' }}>
        <div className="pdfdoc">
          <div className="ph"><div><div className="pt">{title}</div><div className="ps">{sub}</div></div><div className="pm">Отпечатено: {dmy(new Date().toISOString())}</div></div>
          {extra}
          <h2>Што фали – од што се состои разликата</h2><ParSum M={M} n1={n1} n2={n2} />
          {!none && <SideBySide M={M} n1={n1} n2={n2} />}
          {none && <p><b>Нема разлики.</b></p>}
        </div>
      </div>
    </>
  );
}

export function ReconForm({ pid, k, from, to, years, year, firmId }: { pid: string; k: string; from: string; to: string; years: number[]; year: number; firmId: string }) {
  const [res, setRes] = useState<Recon | null>(null);
  const [err, setErr] = useState('');
  const [note, setNote] = useState('');
  const [pending, start] = useTransition();
  return (
    <>
      <form className="card" action={(fd) => start(async () => {
        setErr('');
        const e = await readCardsAi(fd, ['file'], firmId, setNote);
        if (e) { setErr(e); setRes(null); return; }
        const r = await reconAction(fd); if ('error' in r) { setErr(r.error ?? ''); setRes(null); } else setRes(r);
      })}>
        <input type="hidden" name="pid" value={pid} /><input type="hidden" name="k" value={k} /><input type="hidden" name="from" value={from} /><input type="hidden" name="to" value={to} />
        <div className="row" style={{ gap: 10, alignItems: 'end', flexWrap: 'wrap', marginBottom: 8 }}>
          <label className="mini">Од година <select name="y1" defaultValue={year} style={{ width: 'auto' }}>{years.map((y) => <option key={y}>{y}</option>)}</select></label>
          <label className="mini">До година <select name="y2" defaultValue={year} style={{ width: 'auto' }}>{years.map((y) => <option key={y}>{y}</option>)}</select></label>
          <input type="file" name="file" accept=".xlsx,.xls,.csv,.txt,.pdf,image/*" required />
          <button className="btn pri" disabled={pending}>{pending ? '⏳ Се чита картицата на комитентот…' : 'Спореди'}</button>
          {note && <span className="note">{note}</span>}
        </div>
        <span className="mini mut">Ако картицата на комитентот почнува пред првата година, нејзините постари ставки се собираат во „пренесено салдо“ и се споредуваат со нашата почетна состојба.</span>
        {err && <div className="callout warn">Не е прочитано: {err}</div>}
      </form>
      {res && (
        <>
          <Tiles T={[['Салдо кај нас', res.sums.sO], ['Салдо кај комитентот (огледално)', res.sums.sT], ['Разлика', res.sums.dif]]} />
          {res.sums.ok && <div className="callout good">✓ Картиците се усогласени.</div>}
          <RecArchive partner={res.partner} from={res.from} to={res.to} sO={res.sums.sO} dif={res.sums.dif} ok={res.sums.ok} potvrda={`/print/fin/potvrda?pid=${pid}&to=${res.to}&diff=${res.sums.ok ? 0 : res.sums.dif}`} />
          <Diffs recon n1="нас" n2={res.partner} file={`Usoglasuvanje_${res.partner.replace(/[^\p{L}\p{N}]+/gu, '_').slice(0, 40)}`} M={res.M} l1="кај нас – ги нема кај комитентот" l2="кај комитентот – ги нема кај нас" title="ЗАПИСНИК ЗА УСОГЛАСУВАЊЕ НА КАРТИЦА" sub={`${res.partner}${res.edb ? ' · ЕДБ ' + res.edb : ''} · ${dmy(res.from)} – ${dmy(res.to)}`} />
          {res.M.open.length > 0 && <p className="note">Почетното салдо кај нас: {fmt(res.M.open.reduce((a, o) => a + o.amt, 0))}{res.opening ? ' · кај комитентот: ' + fmt(-res.opening) : ''} – вклучено во салдата.</p>}
        </>
      )}
    </>
  );
}

export function CompareForm({ firmName, firmId, year }: { firmName: string; firmId: string; year: number }) {
  const [res, setRes] = useState<Cmp | null>(null);
  const [err, setErr] = useState('');
  const [note, setNote] = useState('');
  const [names, setNames] = useState({ a: firmName, b: '' });
  // a name typed by hand stays; otherwise each comparison names the cards after what was read
  const [typed, setTyped] = useState({ a: false, b: false });
  const [mode, setMode] = useState('auto');
  const [pending, start] = useTransition();
  const X = res?.X;
  return (
    <>
      <form className="card" action={(fd) => start(async () => {
        setErr('');
        const e = await readCardsAi(fd, ['a', 'b'], firmId, setNote);
        if (e) { setErr(e); setRes(null); return; }
        const r = await compareAction(fd); if ('error' in r) { setErr(r.error ?? ''); setRes(null); } else {
          setRes(r);
          // card 2 carries its own name (АГНА …), not „Картица 2“: the name read from the card unless one is typed
          setNames((n) => ({ a: typed.a ? n.a : n.a || r.ha, b: typed.b ? n.b : r.hb }));
        }
      })}>
        <div className="row" style={{ gap: 14, flexWrap: 'wrap', alignItems: 'flex-start' }}>
          <div style={{ flex: 1, minWidth: 280 }}><b>Картица 1</b> <span className="mini">(наша / прва страна)</span>
            <input value={names.a} onChange={(e) => { setNames({ ...names, a: e.target.value }); setTyped({ ...typed, a: true }); }} placeholder="Назив" style={{ margin: '4px 0' }} />
            <input type="file" name="a" accept=".xlsx,.xls,.csv,.txt,.pdf,image/*" required />{res && <div className="mini">✓ {res.fa} · {res.na} ставки</div>}</div>
          <div style={{ flex: 1, minWidth: 280 }}><b>Картица 2</b> <span className="mini">(на комитентот / втора страна)</span>
            <input value={names.b} onChange={(e) => { setNames({ ...names, b: e.target.value }); setTyped({ ...typed, b: !!e.target.value }); }} placeholder="Назив на комитентот" style={{ margin: '4px 0' }} />
            <input type="file" name="b" accept=".xlsx,.xls,.csv,.txt,.pdf,image/*" required />{res && <div className="mini">✓ {res.fb} · {res.nb} ставки</div>}</div>
        </div>
        <div className="row" style={{ gap: 10, marginTop: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <label className="mini">Насока <select name="mirror" defaultValue="auto" style={{ width: 'auto' }}>
            <option value="auto">автоматски</option><option value="1">картица 2 е од другата страна (нивното „Должи“ = наше „Побарува“)</option><option value="0">двете картици се од иста страна</option>
          </select></label>
          <button className="btn pri" disabled={pending}>{pending ? 'Се чита…' : 'Спореди'}</button>
          {note && <span className="note">{note}</span>}
        </div>
        <div className="row" style={{ gap: 10, alignItems: 'end', flexWrap: 'wrap', marginTop: 8 }}>
          <label className="f" style={{ minWidth: 230 }}>Период за споредба<select name="mode" value={mode} onChange={(e) => setMode(e.target.value)}>
            <option value="auto">Автоматски – заедничкиот период на двете картици</option><option value="year">Само една година</option><option value="all">Сите години (целите картици)</option><option value="custom">Од – до</option>
          </select></label>
          {mode === 'year' && <label className="f">Година<select name="yr" defaultValue={year}>{[year, year - 1, year - 2].map((y) => <option key={y}>{y}</option>)}</select></label>}
          {mode === 'custom' && <><label className="f">Од<input type="date" name="cf" /></label><label className="f">До<input type="date" name="ct" /></label></>}
          <span className="mini" style={{ maxWidth: 420 }}>За потврда на салдо пред крајот на годината изберете „Само една година“: ставките од претходните години се собираат во почетно салдо и се споредуваат како еден износ.</span>
        </div>
        {err && <div className="callout warn">Не е прочитано: {err}</div>}
      </form>
      {X && (
        <>
          <div className="callout" style={{ marginTop: 8 }}>📅 <b>{X.mode === 'auto' ? 'Се споредува само заедничкиот период' : 'Споредуван период'}: {dmy(X.from)} – {dmy(X.to)}</b><br />
            <span className="mini">Картица 1: {dmy(X.rA.from)} – {dmy(X.rA.to)} · Картица 2: {dmy(X.rB.from)} – {dmy(X.rB.to)}{X.outA || X.outB ? ` · ставки надвор од периодот (не се споредуваат): картица 1 – ${X.outA}, картица 2 – ${X.outB}` : ''}</span>
            {X.cmpPre ? (Math.abs(X.preA) > 0.004 || Math.abs(X.preB) > 0.004) && <><br />Салдо пред {dmy(X.from)} (почетно / пренесено): картица 1 <b>{fmt(X.preA)}</b> · картица 2 <b>{fmt(X.preB)}</b>{Math.abs(X.preDif) > 0.009 ? <span style={{ color: 'var(--bad)' }}> · разлика {fmt(X.preDif)}</span> : ' · ✓ исто'}</>
              : Math.abs(X.preA) > 0.004 && <><br />Картица 2 почнува на {dmy(X.rB.from)} без почетно салдо – салдото на картица 1 пред тој датум ({fmt(X.preA)}) <b>не се споредува</b>.</>}
            {X.auto && <><br /><span className="mini">Насоката е одредена автоматски ({X.mirror ? 'картица 2 е од другата страна' : 'двете картици се од иста страна'}).</span></>}
          </div>
          {/* legacy v432 13803: one tile — the difference inside the period */}
          <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}><div className="card" style={{ flex: 1, minWidth: 200 }}><div className="mini">Разлика во периодот {dmy(X.from)} – {dmy(X.to)}</div><div style={{ fontSize: 22, fontWeight: 700, color: Math.abs(X.difPer) > 0.009 ? 'var(--bad)' : undefined }}>{fmt(X.difPer)}</div></div></div>
          {Math.abs(X.difTot) < 0.01 && !X.M.onlyO.length && !X.M.onlyT.length && !X.M.adiff.length && <div className="callout good">✓ Картиците се усогласени.</div>}
          <RecArchive partner={names.b || 'Картица 2'} from={X.from} to={X.to} sO={X.sA} dif={X.difTot} ok={Math.abs(X.difTot) < 0.01 && !X.M.onlyO.length && !X.M.onlyT.length && !X.M.adiff.length} />
          <Diffs n1={names.a || 'картица 1'} n2={names.b || 'картица 2'} file={`Sporedba_kartici_${(names.b || 'kartici').replace(/[^\p{L}\p{N}]+/gu, '_').slice(0, 40)}`} M={X.M} l1={'во картица 1' + (names.a ? ` (${names.a})` : '')} l2={'во картица 2' + (names.b ? ` (${names.b})` : '')} title="ЗАПИСНИК ЗА УСОГЛАСУВАЊЕ НА КАРТИЦИ" sub={`${names.a || 'Картица 1'} ↔ ${names.b || 'Картица 2'}`}
            extra={<>
              <p style={{ margin: '3mm 0' }}><b>Споредуван период: {dmy(X.from)} – {dmy(X.to)}</b>{X.cmpPre && Math.abs(X.preDif) > 0.009 ? <><br />Разлика во почетното / пренесеното салдо на {dmy(X.from)}: <b>{fmt(X.preDif)}</b></> : null}</p>
              {(X.M.onlyO.length > 0 || X.M.onlyT.length > 0 || X.M.adiff.length > 0) && <p style={{ marginTop: '3mm' }}><b>Вкупно разлика во периодот: {fmt(X.difPer)}</b></p>}
            </>} />
        </>
      )}
    </>
  );
}
