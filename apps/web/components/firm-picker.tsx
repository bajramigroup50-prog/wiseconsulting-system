'use client';
/**
 * „Изберете фирма“ — legacy full-screen firm picker shown when no firm is selected (`firmPicker` 3712 → v455 14192,
 * views v456 14251, status v457 14263, print/Excel v458 14278): search, last opened, filter chips, A–Z, sortable list,
 * tiles / groups / status views, ↑ ↓ Enter Esc, „Прикажи уште“, 🖨 PDF and ⬇ Excel of the shown list.
 * While it is shown the menu and the firm bar are hidden (legacy `body.picking`).
 *
 * Default view „⊞ Табела“ = the old program's „Избор на работна фирма“: a dense grid, one row per firm, the old columns in
 * the old order (`FG_COLS`), sticky header, horizontal scroll, search by name / шифра / ЕДБ / ЕМБС / account, sort by
 * a header click (default Шифра), ↑ ↓ + Enter or a double-click opens the firm. The chosen view is kept per user.
 */
import { noteRendered } from '@/components/firm-guard';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState, useTransition } from 'react';
import {
  FG_COLS, fgApply, fgKey, FP_AZ, FP_FILTERS, FP_FILTER_TITLE, FP_VIEWS, fpApply, fpDdvDue, fpDdvNo, fpExportRows, fpGroupKey, fpPerson, fpPhone, fpPrevMonth, fpShort,
  type FpFilter, type FpFirm, type FpSort, type FpView,
} from '@wise/core/firms/picker';
import { selectFirm } from '@/app/(app)/actions';
import { logout } from '@/app/login/actions';
import { PdfButton } from './pdf-button';

const LS = { rec: 'lk_firms', last: 'lk_firm', hist: 'lk_firmHist', view: 'lk_fpv' };
const read = (k: string): string[] => { try { return JSON.parse(localStorage.getItem(k) ?? '[]'); } catch { return []; } };
const dmy = (d: string) => d.split('-').reverse().join('.');
/** Compact grid like the old program: small font, tight rows, sticky header and first column, scroll both ways. */
const FG_CSS = '.fg{overflow:auto;max-height:calc(100vh - 230px);border:1px solid var(--line);background:var(--panel)}'
  + '.fp2 .fg table{border:0;border-radius:0;width:max-content;min-width:100%;overflow:visible}'
  + '.fp2 .fg th{position:sticky;top:0;z-index:2;font-size:11px;letter-spacing:0;text-transform:none;padding:3px 6px;border-right:1px solid var(--line);border-bottom:1px solid var(--line)}'
  + '.fp2 .fg td{padding:1px 6px;font-size:12px;line-height:18px;white-space:nowrap;border-top:0;border-bottom:1px solid var(--line);border-right:1px solid var(--line);user-select:none}'
  + '.fp2 .fg td.nm{max-width:320px;overflow:hidden;text-overflow:ellipsis}.fp2 .fg tr.r.k td{background:var(--accent);color:#fff}'
  + '.fp2 .fg td:first-child,.fp2 .fg th:first-child{position:sticky;left:0;z-index:1;background:var(--panel)}.fp2 .fg th:first-child{z-index:3;background:var(--panel-2,#f1f4f2)}'
  + '.fp2 .fg tr.r.k td:first-child{background:var(--accent)}';
const nf = (v: number) => v.toLocaleString('mk-MK', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** localStorage key of the chosen view, per user. */
export const fpViewKey = (uid?: string) => (uid ? `${LS.view}:${uid}` : LS.view);

export function FirmPicker({ rows: F0, canNew, user, uid, office, today, year, book = false, canFirmi = true }: {
  rows: FpFirm[]; canNew: boolean; user: string; office: string; today: string;
  /** User id: the chosen view is remembered per user. */
  uid?: string;
  /** 🔒 book-only colleague: no monthly-invoice / fee columns; `canFirmi`: the firm admin page may be linked. */
  book?: boolean; canFirmi?: boolean;
  /** Selected year: the rows are the firms working in it; the top bar is hidden here, so the year is chosen here too. */
  year?: number;
}) {
  const router = useRouter();
  const [, start] = useTransition();
  const [q, setQ] = useState('');
  const [flt, setFlt] = useState<FpFilter>('all');
  const [az, setAz] = useState('');
  const [sort, setSort] = useState<FpSort>('name');
  const [view, setView] = useState<FpView>('grid');
  const [gs, setGs] = useState<{ c: string; d: boolean }>({ c: 'code', d: false });
  const gridRef = useRef<HTMLDivElement>(null);
  const [gby, setGby] = useState<'letter' | 'city' | 'ddv'>('letter');
  const [lim, setLim] = useState(60);
  const [k, setK] = useState(0);
  const [rec, setRec] = useState<string[]>([]);
  const inp = useRef<HTMLInputElement>(null);

  useEffect(() => {
    document.body.classList.add('picking');
    setRec(read(LS.rec));
    try { const v = localStorage.getItem(fpViewKey(uid)) as FpView | null; if (v && FP_VIEWS.some(([x]) => x === v)) setView(v); } catch { /* ignore */ }
    inp.current?.focus();
    return () => document.body.classList.remove('picking');
  }, []);

  const { rows: F1, letters } = useMemo(() => fpApply(F0, { q: view === 'grid' ? '' : q, flt, az, sort }, rec), [F0, q, flt, az, sort, rec, view]);
  // the grid: own search (name, шифра, ЕДБ, ЕМБС, account) and column sort; all rows (no „Прикажи уште“)
  const F = useMemo(() => (view === 'grid' ? fgApply(F1, q, gs.c, gs.d) : F1), [F1, q, gs, view]);
  const L = view === 'group' || view === 'grid' ? F : F.slice(0, view === 'list' ? lim : Math.max(lim, 120));
  const kk = Math.min(k, Math.max(0, L.length - 1));
  // keep the selected grid row in view while moving with the keyboard
  useEffect(() => { if (view === 'grid') gridRef.current?.querySelector('tr.k')?.scrollIntoView?.({ block: 'nearest' }); }, [kk, view]);
  const recent = rec.map((id) => F0.find((f) => f.id === id)).filter((f): f is FpFirm => !!f);
  const pv = fpPrevMonth(today);

  const pick = (id: string) => {
    try {
      localStorage.setItem(LS.rec, JSON.stringify([id, ...read(LS.rec).filter((x) => x !== id)].slice(0, 10)));
      localStorage.setItem(LS.last, id);
      localStorage.setItem(LS.hist, JSON.stringify([id, ...read(LS.hist).filter((x) => x !== id)].slice(0, 8)));
    } catch { /* ignore */ }
    start(async () => { await selectFirm(id); noteRendered({ firm: id }); router.push('/'); router.refresh(); });
  };
  const badge = (f: FpFirm) => (f.al ? (f.al.n ? <span className={`pill ${f.al.bad ? 'bad' : 'warn'}`} title={f.al.txt.join('\n')}>{f.al.bad ? '🔴' : '🟠'} {f.al.n}</span> : <span className="pill good">✓</span>) : null);
  const th = (key: FpSort, t: string, cls = '') => <th className={cls} onClick={() => setSort(key)} style={{ cursor: 'pointer' }}>{t}{sort === key ? ' ▾' : ''}</th>;
  const status = (f: FpFirm) => ({ ddv: fpDdvDue(f, today), mpOk: !!(f.mp && f.mp.month >= pv) });
  const xlsx = async () => {
    const X = await import('xlsx');
    const ws = X.utils.aoa_to_sheet(fpExportRows(F));
    ws['!cols'] = [28, 45, 8, 16, 10, 8, 11, 17, 22, 22, 30, 30, 14, 12, 10].map((w) => ({ wch: w }));
    const wb = X.utils.book_new();
    X.utils.book_append_sheet(wb, ws, 'Фирми');
    X.writeFile(wb, `Firmi_${today}.xlsx`);
  };
  const sub = [FP_FILTER_TITLE[flt], az ? `буква „${az}“` : '', q ? `пребарување „${q}“` : ''].filter(Boolean).join(' · ');

  return (
    <div className="fp2">
      <div className="fp2-top">
        <h1>Изберете фирма <span className="note" style={{ fontSize: 14, fontWeight: 400 }}>· {F0.length} фирми{year ? ` во ${year}` : ''}</span></h1>
        {year != null && (
          // the year is chosen on its own screen (never by an accidental select change): shown here with „Промени година“
          <span className="mini" title="Се прикажуваат само фирмите што работат во избраната година">
            Година <b id="fpYear" style={{ fontSize: 16 }}>{year}</b>{' '}
            <Link className="btn sm" href="/?godina=1">📅 Промени година</Link>
          </span>
        )}
        <div className="fp2-vw">{FP_VIEWS.map(([key, t]) => <button key={key} type="button" className={view === key ? 'on' : ''} onClick={() => { setView(key); setLim(60); setK(0); try { localStorage.setItem(fpViewKey(uid), key); } catch { /* ignore */ } }}>{t}</button>)}</div>
        {canNew && <Link className="btn pri" href="/firmi?nova">+ Нова фирма</Link>}
        <form action={logout} style={{ display: 'inline' }}><button className="btn">Одјава ({user})</button></form>
      </div>
      <input ref={inp} id="fp_q" className="fp2-q" placeholder={view === 'grid' ? 'Барај по име, шифра, ЕДБ, ЕМБС или жиро сметка… (↑ ↓ и Enter за отворање)' : 'Барај по назив, ЕДБ, ЕМБС, град… (↑ ↓ и Enter за отворање)'} value={q} autoComplete="off"
        onChange={(e) => { setQ(e.target.value); setK(0); setLim(60); }}
        onKeyDown={(e) => {
          const m = view === 'grid' ? fgKey(kk, L.length, e.key) : null;
          if (m) { e.preventDefault(); setK(m.k); if (m.open && L[m.k]) pick(L[m.k]!.id); }
          else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); setK(Math.max(0, Math.min(L.length - 1, kk + (e.key === 'ArrowDown' ? 1 : -1)))); }
          else if (e.key === 'Enter' && L[kk]) pick(L[kk]!.id);
          else if (e.key === 'Escape' && q) setQ('');
        }} />
      {recent.length > 0 && !q && (
        <div><div className="note" style={{ marginBottom: 4 }}>Последно отворени</div>
          <div className="fp2-rec">{recent.slice(0, 8).map((f) => <button key={f.id} type="button" title={f.name} onClick={() => pick(f.id)}>{fpShort(f.name)}</button>)}</div></div>
      )}
      <div className="fp2-chips">
        {FP_FILTERS.map(([key, t]) => <button key={key} type="button" className={`chip ${flt === key ? 'on' : ''}`} onClick={() => { setFlt(key); setK(0); }}>{t}</button>)}
        <span style={{ flex: 1 }} />
        <PdfButton selector="#fpPrint" title={`Листа на фирми ${dmy(today)}`} landscape className="btn sm" />
        <button type="button" className="btn sm" onClick={xlsx}>⬇ Excel</button>
      </div>
      <div className="fp2-az">
        <button type="button" className={!az ? 'on' : ''} onClick={() => setAz('')}>Сите</button>
        {[...FP_AZ, ...[...letters].filter((l) => l && !FP_AZ.includes(l)).sort()].map((l) => (
          <button key={l} type="button" className={`${az === l ? 'on' : ''}${letters.has(l) || az === l ? '' : ' dis'}`} onClick={() => { setAz(l); setK(0); }}>{l}</button>
        ))}
      </div>

      {view === 'grid' && (
        <div className="fg" ref={gridRef} id="fpGrid" role="grid" aria-label="Избор на работна фирма">
          <style>{FG_CSS}</style>
          <table>
            <thead><tr>{FG_COLS.map(([c, t]) => (
              <th key={c} data-col={c} title="Подреди по оваа колона" onClick={() => { setGs((o) => ({ c, d: o.c === c ? !o.d : false })); setK(0); }}>{t}{gs.c === c ? (gs.d ? ' ▴' : ' ▾') : ''}</th>
            ))}</tr></thead>
            <tbody>
              {L.map((f, i) => (
                <tr key={f.id} data-id={f.id} aria-selected={i === kk} className={`r${i === kk ? ' k' : ''}`} onClick={() => { setK(i); inp.current?.focus(); }} onDoubleClick={() => pick(f.id)}>
                  {FG_COLS.map(([c, , get]) => <td key={c} className={c === 'name' ? 'nm' : undefined} title={c === 'name' ? f.name : undefined}>{get(f)}</td>)}
                </tr>
              ))}
              {!L.length && <tr><td colSpan={FG_COLS.length} className="note" style={{ padding: 16 }}>{!F0.length ? (year ? `Нема фирми активни во ${year}.` : 'Нема фирми.') : 'Нема фирма што одговара на пребарувањето.'}</td></tr>}
            </tbody>
          </table>
        </div>
      )}
      {view === 'list' && (
        <table>
          <thead><tr>{th('name', 'Фирма')}{th('edb', 'ЕДБ', 'hide-s')}{th('city', 'Град', 'hide-s')}<th className="hide-s">ДДВ</th><th></th>{th('rec', 'Последно')}</tr></thead>
          <tbody>
            {L.map((f, i) => {
              const ri = rec.indexOf(f.id);
              return (
                <tr key={f.id} className={`r${i === kk ? ' k' : ''}`} onClick={() => pick(f.id)}>
                  <td><span className="av">{fpShort(f.name).charAt(0).toUpperCase() || '?'}</span><span className="nm">{fpShort(f.name)}</span>{fpShort(f.name) !== f.name && <div className="sm" style={{ marginLeft: 36 }}>{f.name}</div>}</td>
                  <td className="hide-s sm">{f.edb || '—'}</td><td className="hide-s sm">{f.city || ''}</td>
                  <td className="hide-s sm">{f.vat ? (f.month ? 'месечно' : 'тромесечно') : '—'}{f.example ? ' · пример' : ''}</td>
                  <td>{badge(f)}</td>
                  <td className="sm">{ri === 0 ? <span className="pill info">последна</span> : ri > 0 ? '✓' : ''}</td>
                </tr>
              );
            })}
            {!L.length && <tr><td colSpan={6} className="note" style={{ textAlign: 'center', padding: 24 }}>{!F0.length ? (year ? (canFirmi ? <>Нема фирми активни во {year}. Изберете друга година или во <Link href="/firmi?sve=1">Фирми → Прикажи ги сите години</Link> кај фирмата внесете „Активна од година“.</> : <>Нема фирми активни во {year}. Изберете друга година.</>) : canNew ? 'Нема фирми. Кликнете „+ Нова фирма“.' : 'Немате доделено фирми. Јавете се кај администраторот.') : 'Нема фирма што одговара на пребарувањето / филтерот.'}</td></tr>}
          </tbody>
        </table>
      )}
      {view === 'tiles' && (
        <div className="fp2-tiles">{L.map((f, i) => (
          <button key={f.id} type="button" className={`fp2-tile${i === kk ? ' k' : ''}`} title={f.name} onClick={() => pick(f.id)}>
            <span className="bd">{badge(f)}</span><b>{fpShort(f.name)}</b><small>ЕДБ {f.edb || '—'}</small>
            <small>{[f.city, f.vat ? 'ДДВ ' + (f.month ? 'мес.' : 'трим.') : 'не е ДДВ'].filter(Boolean).join(' · ')}</small>
          </button>
        ))}</div>
      )}
      {view === 'group' && (() => {
        const G = new Map<string, FpFirm[]>();
        for (const f of L) { const key = fpGroupKey(f, gby); G.set(key, [...(G.get(key) ?? []), f]); }
        const ks = [...G.keys()].sort((a, b) => a.localeCompare(b, 'mk'));
        return (
          <div>
            <div className="fp2-chips" style={{ marginBottom: 8 }}><span className="note">Групирај по:</span>
              {([['letter', 'Буква'], ['city', 'Град'], ['ddv', 'ДДВ']] as const).map(([key, t]) => <button key={key} type="button" className={`chip ${gby === key ? 'on' : ''}`} onClick={() => setGby(key)}>{t}</button>)}</div>
            {ks.map((key) => (
              <details key={key} className="fp2-grp" open={ks.length <= 6 || !!q}>
                <summary><span>{key}</span><span className="note">{G.get(key)!.length}</span></summary>
                <div className="gl">{G.get(key)!.map((f) => <button key={f.id} type="button" title={f.name} onClick={() => pick(f.id)}><span>{fpShort(f.name)}</span><span className="note">{badge(f)} {f.edb || ''}</span></button>)}</div>
              </details>
            ))}
          </div>
        );
      })()}
      {view === 'status' && (
        <>
          <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', margin: '0 0 6px', gap: 8, flexWrap: 'wrap' }}>
            <p className="note" style={{ margin: 0 }}>Сите податоци за фирмите на едно место. Кликнете на ред за да ја отворите фирмата; телефонот и е-поштата се кликаат посебно. МПИН за {pv.slice(5)}/{pv.slice(0, 4)}.</p>
          </div>
          <div className="fp2-wide"><table>
            <thead><tr><th>Фирма</th><th>Шифра</th><th>ЕДБ (даночен бр.)</th><th>ЕМБС</th><th>ДДВ</th><th>Контакт лице</th><th>Телефон</th><th>Е-пошта</th><th>Град</th><th>МПИН {pv.slice(5)}/{pv.slice(0, 4)}</th><th>ДДВ пријава</th>{!book && <><th>Мес. фактура</th><th style={{ textAlign: 'right' }}>Надомест</th></>}<th></th></tr></thead>
            <tbody>{L.map((f, i) => {
              const s = status(f); const ph = fpPhone(f);
              return (
                <tr key={f.id} className={`r${i === kk ? ' k' : ''}`} onClick={() => pick(f.id)}>
                  <td><span className="nm fn" title={f.name}>{fpShort(f.name)}</span></td><td className="sm">{f.code || ''}</td><td>{f.edb || '—'}</td><td className="sm">{f.embs || ''}</td>
                  <td>{f.vat ? <><span title={fpDdvNo(f)}>✓ {f.month ? 'месечно' : 'тромесечно'}</span><div className="sm">{fpDdvNo(f)}</div></> : <span className="sm">не</span>}</td>
                  <td>{fpPerson(f)}</td>
                  <td>{ph ? ph.split(', ').map((p, j) => <div key={j}><a href={'tel:' + p.replace(/\s/g, '')} onClick={(e) => e.stopPropagation()}>{p}</a></div>) : <span className="sm">—</span>}</td>
                  <td>{f.email ? <a className="em" href={'mailto:' + f.email} title={f.email} onClick={(e) => e.stopPropagation()}>{f.email}</a> : <span className="sm">—</span>}</td>
                  <td className="sm">{f.city || ''}</td>
                  <td>{s.mpOk ? <span className="ok">✓</span> : f.mp ? <span className="wa">последен {f.mp.month.slice(5)}/{f.mp.month.slice(0, 4)}</span> : <span className="sm">—</span>}</td>
                  <td>{s.ddv ? <span className="wa">{s.ddv.per} до {dmy(s.ddv.due).slice(0, 5)}</span> : <span className="sm">{f.vat ? 'нема овој месец' : '—'}</span>}</td>
                  {!book && <><td className="sm">{f.recNext ? (f.recNext <= today ? <span className="no">издади {dmy(f.recNext).slice(0, 5)}</span> : dmy(f.recNext)) : '—'}</td>
                  <td className="sm" style={{ textAlign: 'right' }}>{f.fee ? nf(f.fee) : ''}</td></>}<td>{badge(f)}</td>
                </tr>
              );
            })}</tbody>
          </table></div>
        </>
      )}
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <span className="note">Прикажани {L.length} од {F.length}{F.length !== F0.length ? ` (филтрирано од ${F0.length})` : ''}</span>
        {view !== 'group' && view !== 'grid' && F.length > L.length && <button type="button" className="btn" onClick={() => setLim(L.length + 100)}>Прикажи уште {Math.min(100, F.length - L.length)}</button>}
      </div>
      {/* legacy `fpPrint`: the whole filtered list, landscape */}
      <div style={{ display: 'none' }}>
        <div id="fpPrint">
          <div className="pdfdoc land">
            <style>{'.fpl{width:100%;border-collapse:collapse;font-size:8.5pt}.fpl th,.fpl td{border:1px solid #999;padding:3px 4px;text-align:left;vertical-align:top}.fpl th{background:#e8ecea;font-size:8pt}.fpl td.n{text-align:right}'}</style>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 6 }}>
              <div><div style={{ fontSize: '14pt', fontWeight: 700 }}>Листа на фирми</div><div style={{ fontSize: '9pt' }}>{sub} · вкупно {F.length}</div></div>
              <div style={{ fontSize: '8pt', textAlign: 'right' }}>{office}<br />{dmy(today)}</div>
            </div>
            <table className="fpl"><thead><tr><th>Р.бр.</th><th>Фирма</th><th>Шифра</th><th>ЕДБ</th><th>ЕМБС</th><th>ДДВ</th><th>Контакт лице</th><th>Телефон</th><th>Е-пошта</th><th>Адреса, град</th></tr></thead>
              <tbody>{F.map((f, i) => <tr key={f.id}><td className="n">{i + 1}</td><td>{f.name}</td><td>{f.code || ''}</td><td>{f.edb || ''}</td><td>{f.embs || ''}</td><td>{f.vat ? <>{f.month ? 'месечно' : 'тромес.'}<br />{fpDdvNo(f)}</> : 'не'}</td><td>{fpPerson(f)}</td><td>{fpPhone(f)}</td><td>{f.email || ''}</td><td>{[f.address, f.city].filter(Boolean).join(', ')}</td></tr>)}</tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
