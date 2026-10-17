'use client';
/**
 * „Налог за книжење“ import (`/uvoz?t=journal`): the old program's journals from Excel / CSV / XML or its „Финансов
 * налог“ PDF. File → header row and columns recognised (`impAuto`, the user corrects) → 🔍 preview on the server
 * (per month, problems, missing partners, duplicates, the trial balance after the import) → ✅ confirm (one
 * transaction per batch) → the batches of the year with „🗑 Избриши го увозот“.
 */
import { useMemo, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { IMP_T, impAuto, type DecMode } from '@wise/core/retail/import';
import { jiGridRows, jiHeaderRow, jiNameDefault, jiTemplate } from '@wise/core/journal-import';
import type { JiBatch, JiPreview } from '@wise/db';
import { downloadXlsx, readRows } from '../_retail/read-file';
import { commitJournalImportAction, deleteJournalImportAction, previewJournalImportAction, readJournalPdfAction } from './journal-actions';

const T = IMP_T.journal;
const fmt = (n: number) => n.toLocaleString('mk-MK', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dmy = (d: string | null | undefined) => (d ? d.split('-').reverse().join('.') : '');
const MONTHS = ['јануари', 'февруари', 'март', 'април', 'мај', 'јуни', 'јули', 'август', 'септември', 'октомври', 'ноември', 'декември'];
const monthName = (m: string) => `${MONTHS[+m.slice(5, 7) - 1] ?? m} ${m.slice(0, 4)}`;
const KIND: Record<string, string> = {
  row: 'ред', konto: 'конто', synthetic: 'синтетика', partner: 'комитент', nopartner: 'без комитент', period: 'заклучен период', year: 'година', unbalanced: 'рамнотежа',
};

async function sha256(f: File): Promise<string> {
  try {
    const h = await crypto.subtle.digest('SHA-256', await f.arrayBuffer());
    return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, '0')).join('');
  } catch { return ''; }
}

export function JournalImporter({ year, batches, canDel }: { year: number; batches: JiBatch[]; canDel: boolean }) {
  const router = useRouter();
  const [rows, setRows] = useState<unknown[][] | null>(null);
  const [file, setFile] = useState('');
  const [hash, setHash] = useState('');
  const [hi, setHi] = useState(0);
  const [map, setMap] = useState<Record<string, number>>({});
  const [decSel, setDecSel] = useState<DecMode>('');
  const [create, setCreate] = useState(false);
  const [pv, setPv] = useState<JiPreview | null>(null);
  const [msg, setMsg] = useState<{ ok?: string; error?: string }>({});
  const [synth, setSynth] = useState(false);
  const [mode, setMode] = useState<'journal' | 'invoices'>('journal');
  const [skipOpening, setSkipOpening] = useState(false);
  /** nalog type / number for the rows without one (a file that is one nalog): default from the file name, editable */
  const [nal, setNal] = useState({ type: '', no: '' });
  const [pending, start] = useTransition();
  const inp = useRef<HTMLInputElement>(null);

  const load = async (f: File | undefined) => {
    if (!f) return;
    setMsg({}); setPv(null);
    try {
      let R: unknown[][];
      if (/\.pdf$/i.test(f.name) || f.type === 'application/pdf') {
        const fd = new FormData(); fd.set('file', f);
        const r = await readJournalPdfAction(fd);
        if (!r.grid) { setMsg({ error: r.error ?? 'PDF-от не може да се прочита.' }); return; }
        R = r.grid;
      } else R = await readRows(f);
      if (!R.length) { setMsg({ error: 'Датотеката е празна или форматот не е препознаен.' }); return; }
      const h = jiHeaderRow(R);
      setRows(R); setFile(f.name); setHash(await sha256(f)); setHi(h); setMap(impAuto('journal', R[h] ?? [])); setDecSel(''); setCreate(false);
      setNal(jiNameDefault(f.name)); setMode('journal'); setSkipOpening(false);
    } catch { setMsg({ error: 'Датотеката не може да се прочита.' }); }
  };

  const hdr = rows?.[hi] ?? [];
  const GR = useMemo(() => (rows ? jiGridRows(rows, hi, map, decSel) : { rows: [], count: 0, blocked: [], examples: [] }), [rows, hi, map, decSel]);
  const blocked = GR.blocked.length > 0;
  const noAmt = map.d == null && map.p == null && map.amt == null;
  const missing = [...(map.date == null ? ['Датум'] : []), ...(map.k == null ? ['Конто'] : []), ...(noAmt ? ['Должи / Побарува или Износ'] : [])];

  const payload = (cp: boolean, o: { mode?: 'journal' | 'invoices'; skip?: boolean } = {}) =>
    JSON.stringify({ file, hash, createPartners: cp, skipOpening: o.skip ?? skipOpening, mode: o.mode ?? mode, nalog: nal, rows: GR.rows });

  const check = (cp = create, o: { mode?: 'journal' | 'invoices'; skip?: boolean } = {}) => {
    if (missing.length) { setMsg({ error: 'Поврзете ги колоните: ' + missing.join(', ') }); return; }
    if (blocked) { setMsg({ error: 'Изберете „Децимали“ – износите како „10.000“ може да значат десет илјади или десет.' }); return; }
    setMsg({});
    start(async () => {
      const r = await previewJournalImportAction(payload(cp, o));
      if (r.error) { setMsg({ error: r.error }); setPv(null); } else setPv(r.data!);
    });
  };
  const commit = () => {
    if (!pv?.ok) return;
    const n = pv.journals - pv.duplicates.length;
    if (!window.confirm(`Да се увезат ${n} налози (${pv.lines} ставки, должи = побарува = ${fmt(pv.D)})${create && pv.missingPartners.length ? ` и да се креираат ${pv.missingPartners.length} нови комитенти` : ''}?`)) return;
    start(async () => {
      const r = await commitJournalImportAction(payload(create));
      if (r.error) { setMsg({ error: r.error }); return; }
      const R = r.data!;
      setMsg({ ok: `Готово: увезени ${R.journals} книжења, ${R.lines} ставки (должи = побарува = ${fmt(R.D)})`
        + (R.invoices != null ? `; ${R.invoices} излезни фактури` : '') + (R.invoicesRefused?.length ? `; ${R.invoicesRefused.length} групи увезени како ставки (${R.invoicesRefused.slice(0, 3).map((x) => x.no + ': ' + x.why).join(' · ')})` : '')
        + (R.opening === 'posted' ? '; почетната состојба е внесена (налог 0)' : R.opening === 'exists' ? '; почетната состојба веќе постоеше – прескокната' : '')
        + (R.newPartners ? `; ${R.newPartners} нови комитенти` : '') + (R.duplicates ? `; ${R.duplicates} веќе внесени се прескокнати` : '') + '.' });
      setPv(null); setRows(null);
      router.refresh();
    });
  };
  const del = (b: JiBatch) => {
    if (!window.confirm(`Да се избришат сите ${b.journals} налози од увозот „${b.file}“ (${dmy(b.from)} – ${dmy(b.to)})? Комитентите што се креирани остануваат.`)) return;
    start(async () => {
      const r = await deleteJournalImportAction(b.batch);
      setMsg(r.error ? { error: r.error } : { ok: `Избришани ${r.data} налози од увозот „${b.file}“.` });
      router.refresh();
    });
  };

  // trial balance: analytic (as booked) or per synthetic konto (3 digits)
  const tb = useMemo(() => {
    if (!pv) return [];
    if (!synth) return pv.tb;
    const M = new Map<string, { k: string; name: string; d: number; p: number; s: number }>();
    for (const r of pv.tb) {
      const k = r.k.slice(0, 3);
      const x = M.get(k) ?? { k, name: '', d: 0, p: 0, s: 0 };
      x.d += r.d; x.p += r.p; x.s += r.s;
      M.set(k, x);
    }
    return [...M.values()].map((x) => ({ ...x, d: Math.round(x.d * 100) / 100, p: Math.round(x.p * 100) / 100, s: Math.round(x.s * 100) / 100 }));
  }, [pv, synth]);

  return (
    <>
      <div className="row" style={{ gap: 10, margin: '12px 0', flexWrap: 'wrap', alignItems: 'center' }}>
        <button type="button" className="btn pri" style={{ fontSize: 15, padding: '10px 18px' }} onClick={() => inp.current?.click()}>📂 Избери Excel / CSV / PDF од старата програма</button>
        <button type="button" className="btn" onClick={() => downloadXlsx('Obrazec_uvoz_nalozi.xlsx', jiTemplate())}>⬇ Преземи образец за налози</button>
        <input ref={inp} type="file" hidden accept=".xlsx,.xls,.csv,.txt,.xml,.pdf" onChange={(e) => { void load(e.target.files?.[0]); e.target.value = ''; }} />
      </div>
      <p className="note" style={{ margin: '0 0 8px' }}>
        Колони: <b>датум</b>, вид и број на налог, <b>конто</b>, <b>должи / побарува</b> (или износ + страна Д/П), шифра / ЕДБ / назив на комитент, документ, опис, износ во девизи.
        Бројот на налогот од старата програма се задржува („06/9“). PDF: „Финансов налог“ од старата програма (со текст, не скениран).
        Се увезува само по потврда, целиот увоз одеднаш; повторен увоз на истата датотека не додава ништо.
      </p>
      {!rows && (
        <label className="drop" style={{ border: '2px dashed var(--accent)', padding: 28, cursor: 'pointer', display: 'block' }}
          onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); void load(e.dataTransfer.files[0]); }} onClick={() => inp.current?.click()}>
          <b>Изберете или повлечете датотека</b> – Excel (.xlsx, .xls), CSV, XML или PDF „Финансов налог“.<br /><small>Налозите од јануари до последниот месец во старата програма; потоа продолжувате во WISE.</small>
        </label>
      )}
      {msg.error && <div className="callout bad" role="alert">{msg.error}</div>}
      {msg.ok && <div className="callout good">{msg.ok}</div>}

      {rows && (
        <div className="card">
          <div className="hd"><h2>Поврзување на колоните</h2><span className="note">{file} · {GR.count} редови</span></div>
          <div className="form">{T.f.map(([k, n]) => (
            <label key={k} className="f">{n}<select value={map[k] ?? ''} onChange={(e) => { setPv(null); setMap((m) => { const x = { ...m }; if (e.target.value === '') delete x[k]; else x[k] = Number(e.target.value); return x; }); }}>
              <option value="">— нема —</option>{hdr.map((x, i) => <option key={i} value={i}>{String(x || 'Колона ' + (i + 1)).slice(0, 40)}</option>)}
            </select></label>
          ))}</div>
          <div className="row" style={{ marginTop: 8, gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <label className="mini">Заглавие во ред <input type="number" min={1} value={hi + 1} style={{ width: 60 }} onChange={(e) => { const h = Math.max(0, (Number(e.target.value) || 1) - 1); setHi(h); setMap(impAuto('journal', rows[h] ?? [])); setPv(null); }} /></label>
            <label className="mini">Децимали <select value={decSel} onChange={(e) => { setDecSel(e.target.value as DecMode); setPv(null); }} style={{ width: 'auto' }}>
              <option value="">од датотеката</option><option value="comma">1.234,56 – „10.000“ = десет илјади</option><option value="dot">1,234.56 – „10.000“ = десет</option>
            </select></label>
            <span className="mini">Работна година: <b>{year}</b></span>
          </div>
          <div className="row" style={{ marginTop: 8, gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <span className="mini">{map.no == null ? 'Датотеката нема колона „Налог“ – целата е еден налог:' : 'За редовите без број на налог:'}</span>
            <label className="mini">Вид / код <input value={nal.type} style={{ width: 70 }} onChange={(e) => { setNal((x) => ({ ...x, type: e.target.value })); setPv(null); }} /></label>
            <label className="mini">Број <input value={nal.no} style={{ width: 80 }} onChange={(e) => { setNal((x) => ({ ...x, no: e.target.value })); setPv(null); }} /></label>
            <span className="mini mut">→ налог „{nal.type && nal.no ? `${nal.type}/${nal.no}` : nal.no || nal.type || 'автоматски'}“ (од името на датотеката „{file}“; „1-1-3“ = налог 1 за месеците 1–3)</span>
          </div>
          <div className="row" style={{ marginTop: 8, gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
            <label className="mini"><input type="radio" name="jimode" checked={mode === 'journal'} onChange={() => { setMode('journal'); setPv(null); }} /> <b>Увези како налог</b> (ставките како што се, со комитент и документ на секоја ставка)</label>
            <label className="mini"><input type="radio" name="jimode" checked={mode === 'invoices'} onChange={() => { setMode('invoices'); setPv(null); }} /> <b>Увези како излезни фактури</b> (препорачано за налог на фактури: ДДВ книги, отворени ставки, поврзување со плаќања)</label>
          </div>
          {missing.length > 0 && <div className="callout warn">Поврзете ги колоните: {missing.join(', ')}.</div>}
          {blocked && <div className="callout bad" role="alert"><b>⚠ Износите не се еднозначни</b> во колоните: {GR.blocked.join(', ')} (на пр. „{GR.examples.join('“, „')}“). Изберете „Децимали“.</div>}
          <div className="row" style={{ justifyContent: 'flex-end', marginTop: 10, gap: 8 }}>
            <button type="button" className="btn" onClick={() => { setRows(null); setFile(''); setPv(null); }}>Друга датотека</button>
            <button type="button" className="btn pri" disabled={pending || blocked || missing.length > 0} onClick={() => check()}>{pending && !pv ? 'Се проверува…' : '🔍 Провери (преглед пред увоз)'}</button>
          </div>
        </div>
      )}

      {rows && pv && (
        <>
          <div className="card">
            <div className="hd"><h2>Преглед пред увоз</h2>
              {pv.ok ? <span className="pill good">може да се увезе</span> : <span className="pill bad">{pv.problems.filter((p) => p.kind !== 'synthetic' && !(p.kind === 'partner' && create)).length} проблеми – увозот е оневозможен</span>}</div>
            <p className="note">{pv.rows} ставки во датотеката{pv.skipped ? `, ${pv.skipped} редови без износ / збирни редови прескокнати` : ''} · {pv.nalogs} налози ({pv.journals} книжења) · {pv.lines} ставки · должи <b>{fmt(pv.D)}</b> · побарува <b>{fmt(pv.P)}</b></p>
            {pv.warnings.map((w, i) => <div key={i} className="callout warn">{w}</div>)}
            {pv.opening && !pv.opening.exists && (
              <label className="row mini" style={{ gap: 6, alignItems: 'center', margin: '6px 0' }}>
                <input type="checkbox" checked={!skipOpening} onChange={(e) => { setSkipOpening(!e.target.checked); check(create, { skip: !e.target.checked }); }} />
                Внеси ги {pv.opening.rows} ставки на 01.01 како <b>Почетна состојба</b> (налог 0; должи {fmt(pv.opening.D)} / побарува {fmt(pv.opening.P)})
              </label>
            )}
            <p className="note">Комитенти пронајдени: по шифра {pv.matchedBy.code} · по ЕДБ {pv.matchedBy.edb} · по назив {pv.matchedBy.name} · по сличен назив {pv.matchedBy.norm} · латиница ↔ кирилица {pv.matchedBy.translit}{pv.missingPartners.length ? ` · не се пронајдени ${pv.missingPartners.length}` : ''}</p>
            {pv.invoices && (
              <p className="note"><b>Излезни фактури:</b> {pv.invoices.n} (вкупно {fmt(pv.invoices.total)}){pv.invoices.dups.length ? `, ${pv.invoices.dups.length} веќе постојат – се прескокнуваат` : ''}
                {pv.invoices.refused.length > 0 && <> · <span style={{ color: 'var(--bad)' }}>{pv.invoices.refused.length} не се добиваат точно</span> (се увезуваат како ставки): {pv.invoices.refused.slice(0, 30).map((x) => `${x.no} – ${x.why}`).join(' · ')}{pv.invoices.refused.length > 30 ? ' …' : ''}</>}</p>
            )}
            <div className="tw"><table className="dense">
              <thead><tr><th>Месец</th><th className="num">Налози</th><th className="num">Ставки</th><th className="num">Σ Должи</th><th className="num">Σ Побарува</th><th className="num">Проблеми</th></tr></thead>
              <tbody>
                {pv.months.map((m) => <tr key={m.m}><td>{monthName(m.m)}</td><td className="num">{m.nalogs}</td><td className="num">{m.lines}</td><td className="num">{fmt(m.D)}</td><td className="num">{fmt(m.P)}</td><td className="num">{m.problems ? <span style={{ color: 'var(--bad)' }}>{m.problems}</span> : '—'}</td></tr>)}
                <tr style={{ fontWeight: 600 }}><td>Вкупно</td><td className="num">{pv.nalogs}</td><td className="num">{pv.lines}</td><td className="num">{fmt(pv.D)}</td><td className="num">{fmt(pv.P)}</td><td className="num">{pv.problems.length || '—'}</td></tr>
              </tbody>
            </table></div>
          </div>

          {pv.problems.length > 0 && (
            <div className="card">
              <div className="hd"><h2>Проблеми</h2><span className="note">поправете ја датотеката (или контниот план / комитентите) и проверете повторно</span></div>
              <ul style={{ margin: 0, paddingLeft: 18 }}>{pv.problems.slice(0, 150).map((p, i) => (
                <li key={i} style={{ color: (p.kind === 'partner' && create) || p.kind === 'synthetic' ? 'var(--mut)' : 'var(--bad)' }}><span className="pill">{KIND[p.kind] ?? p.kind}</span> {p.msg}{p.kind === 'partner' && create ? ' → ќе се креира' : ''}</li>
              ))}</ul>
              {pv.problems.length > 150 && <p className="note">… и уште {pv.problems.length - 150}.</p>}
            </div>
          )}

          {pv.missingPartners.length > 0 && (
            <div className="card">
              <div className="hd"><h2>Комитенти што ги нема во WISE ({pv.missingPartners.length})</h2></div>
              <div className="tw"><table className="dense">
                <thead><tr><th>Назив</th><th>Шифра</th><th>ЕДБ</th><th>Конта</th><th className="num">Ставки</th></tr></thead>
                <tbody>{pv.missingPartners.slice(0, 300).map((m) => <tr key={m.key}><td>{m.name || '—'}</td><td>{m.code}</td><td>{m.edb}</td><td>{m.kontos.join(', ')}</td><td className="num">{m.rows.length}</td></tr>)}</tbody>
              </table></div>
              <label className="row" style={{ gap: 6, marginTop: 8, alignItems: 'center' }}>
                <input type="checkbox" checked={create} onChange={(e) => { setCreate(e.target.checked); check(e.target.checked); }} />
                <b>Креирај ги комитентите што недостасуваат</b> (назив, шифра и ЕДБ од датотеката) – или поправете ја датотеката.
              </label>
            </div>
          )}

          {pv.duplicates.length > 0 && (
            <div className="card">
              <div className="hd"><h2>Веќе увезени налози ({pv.duplicates.length}) – се прескокнуваат</h2></div>
              <p className="note">{pv.duplicates.slice(0, 60).map((d) => `${d.label} од ${dmy(d.date)} (${fmt(d.total)})`).join(' · ')}{pv.duplicates.length > 60 ? ' …' : ''}</p>
            </div>
          )}

          <div className="card">
            <div className="hd"><h2>Бруто биланс по увозот – од 01.01.{year} до {dmy(pv.tbTo)}</h2>
              <label className="mini"><input type="checkbox" checked={synth} onChange={(e) => setSynth(e.target.checked)} /> по синтетика (3 цифри)</label></div>
            <p className="note">Книжењата на годината до последниот датум од датотеката + увозот. Споредете го со бруто билансот од старата програма пред да потврдите.</p>
            <div className="tw" style={{ maxHeight: 420, overflow: 'auto' }}><table className="dense">
              <thead><tr><th>Конто</th><th>Назив</th><th className="num">Должи</th><th className="num">Побарува</th><th className="num">Салдо</th></tr></thead>
              <tbody>
                {tb.map((r) => <tr key={r.k}><td>{r.k}</td><td>{r.name}</td><td className="num">{fmt(r.d)}</td><td className="num">{fmt(r.p)}</td><td className="num">{fmt(r.s)}</td></tr>)}
                <tr style={{ fontWeight: 600 }}><td colSpan={2}>Вкупно</td><td className="num">{fmt(pv.tbTotal.d)}</td><td className="num">{fmt(pv.tbTotal.p)}</td><td className="num">{fmt(Math.round((pv.tbTotal.d - pv.tbTotal.p) * 100) / 100)}</td></tr>
              </tbody>
            </table></div>
          </div>

          <div className="card">
            <div className="hd"><h2>Налози ({pv.journals})</h2></div>
            <div className="tw" style={{ maxHeight: 320, overflow: 'auto' }}><table className="dense">
              <thead><tr><th>Налог</th><th>Број во WISE</th><th>Датум</th><th className="num">Ставки</th><th className="num">Износ</th><th></th></tr></thead>
              <tbody>{pv.list.map((j, i) => <tr key={i}><td>{j.label}</td><td>{j.number ?? 'автоматски'}</td><td>{dmy(j.date)}</td><td className="num">{j.lines}</td><td className="num">{fmt(j.total)}</td><td>{j.dup ? <span className="pill">веќе увезен</span> : ''}</td></tr>)}</tbody>
            </table></div>
            {pv.list.length < pv.journals && <p className="note">… прикажани се првите {pv.list.length}.</p>}
            <div className="row" style={{ justifyContent: 'flex-end', marginTop: 10, gap: 8 }}>
              <button type="button" className="btn" disabled={pending} onClick={() => check()}>↻ Провери повторно</button>
              <button type="button" className="btn pri" disabled={pending || !pv.ok || pv.journals === pv.duplicates.length} onClick={commit}>
                {pending ? 'Се работи…' : pv.journals === pv.duplicates.length ? 'Нема нови налози' : `✅ Потврди увоз (${pv.journals - pv.duplicates.length} налози)`}
              </button>
            </div>
          </div>
        </>
      )}

      <div className="card">
        <div className="hd"><h2>Увези на налози во {year}</h2></div>
        {batches.length ? (
          <div className="tw"><table className="dense">
            <thead><tr><th>Датотека</th><th>Увезено</th><th>Период</th><th className="num">Налози</th><th className="num">Ставки</th><th className="num">Должи</th><th></th></tr></thead>
            <tbody>{batches.map((b) => (
              <tr key={b.batch}>
                <td>{b.file}</td><td>{new Date(b.at).toLocaleString('mk-MK')}</td><td>{dmy(b.from)} – {dmy(b.to)}</td>
                <td className="num">{b.journals}</td><td className="num">{b.lines}</td><td className="num">{fmt(b.D)}</td>
                <td>{canDel && (b.locked ? <span className="mini mut">заклучен период</span>
                  : <button type="button" className="btn sm danger" disabled={pending} onClick={() => del(b)}>🗑 Избриши го увозот</button>)}</td>
              </tr>
            ))}</tbody>
          </table></div>
        ) : <p className="note">Нема увезени налози во оваа година.</p>}
      </div>
    </>
  );
}
