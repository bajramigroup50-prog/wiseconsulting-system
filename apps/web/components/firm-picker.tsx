'use client';
/**
 * „Изберете фирма“ — legacy full-screen firm picker shown when no firm is selected (`firmPicker` 3712 → v455 14192,
 * views v456 14251, status v457 14263, print/Excel v458 14278): search, last opened, filter chips, A–Z, sortable list,
 * tiles / groups / status views, ↑ ↓ Enter Esc, „Прикажи уште“, 🖨 PDF and ⬇ Excel of the shown list.
 * While it is shown the menu and the firm bar are hidden (legacy `body.picking`).
 */
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState, useTransition } from 'react';
import {
  FP_AZ, FP_FILTERS, FP_FILTER_TITLE, FP_VIEWS, fpApply, fpDdvDue, fpDdvNo, fpExportRows, fpGroupKey, fpPerson, fpPhone, fpPrevMonth, fpShort,
  type FpFilter, type FpFirm, type FpSort, type FpView,
} from '@wise/core/firms/picker';
import { selectFirm } from '@/app/(app)/actions';
import { logout } from '@/app/login/actions';
import { PdfButton } from './pdf-button';

const LS = { rec: 'lk_firms', last: 'lk_firm', hist: 'lk_firmHist', view: 'lk_fpv' };
const read = (k: string): string[] => { try { return JSON.parse(localStorage.getItem(k) ?? '[]'); } catch { return []; } };
const dmy = (d: string) => d.split('-').reverse().join('.');
const nf = (v: number) => v.toLocaleString('mk-MK', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function FirmPicker({ rows: F0, canNew, user, office, today }: { rows: FpFirm[]; canNew: boolean; user: string; office: string; today: string }) {
  const router = useRouter();
  const [, start] = useTransition();
  const [q, setQ] = useState('');
  const [flt, setFlt] = useState<FpFilter>('all');
  const [az, setAz] = useState('');
  const [sort, setSort] = useState<FpSort>('name');
  const [view, setView] = useState<FpView>('list');
  const [gby, setGby] = useState<'letter' | 'city' | 'ddv'>('letter');
  const [lim, setLim] = useState(60);
  const [k, setK] = useState(0);
  const [rec, setRec] = useState<string[]>([]);
  const inp = useRef<HTMLInputElement>(null);

  useEffect(() => {
    document.body.classList.add('picking');
    setRec(read(LS.rec));
    try { const v = localStorage.getItem(LS.view) as FpView | null; if (v && FP_VIEWS.some(([x]) => x === v)) setView(v); } catch { /* ignore */ }
    inp.current?.focus();
    return () => document.body.classList.remove('picking');
  }, []);

  const { rows: F, letters } = useMemo(() => fpApply(F0, { q, flt, az, sort }, rec), [F0, q, flt, az, sort, rec]);
  const L = view === 'group' ? F : F.slice(0, view === 'list' ? lim : Math.max(lim, 120));
  const kk = Math.min(k, Math.max(0, L.length - 1));
  const recent = rec.map((id) => F0.find((f) => f.id === id)).filter((f): f is FpFirm => !!f);
  const pv = fpPrevMonth(today);

  const pick = (id: string) => {
    try {
      localStorage.setItem(LS.rec, JSON.stringify([id, ...read(LS.rec).filter((x) => x !== id)].slice(0, 10)));
      localStorage.setItem(LS.last, id);
      localStorage.setItem(LS.hist, JSON.stringify([id, ...read(LS.hist).filter((x) => x !== id)].slice(0, 8)));
    } catch { /* ignore */ }
    start(async () => { await selectFirm(id); router.push('/'); router.refresh(); });
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
        <h1>Изберете фирма <span className="note" style={{ fontSize: 14, fontWeight: 400 }}>· {F0.length} фирми</span></h1>
        <div className="fp2-vw">{FP_VIEWS.map(([key, t]) => <button key={key} type="button" className={view === key ? 'on' : ''} onClick={() => { setView(key); setLim(60); setK(0); try { localStorage.setItem(LS.view, key); } catch { /* ignore */ } }}>{t}</button>)}</div>
        {canNew && <Link className="btn pri" href="/firmi?nova">+ Нова фирма</Link>}
        <form action={logout} style={{ display: 'inline' }}><button className="btn">Одјава ({user})</button></form>
      </div>
      <input ref={inp} id="fp_q" className="fp2-q" placeholder="Барај по назив, ЕДБ, ЕМБС, град… (↑ ↓ и Enter за отворање)" value={q} autoComplete="off"
        onChange={(e) => { setQ(e.target.value); setK(0); setLim(60); }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); setK(Math.max(0, Math.min(L.length - 1, kk + (e.key === 'ArrowDown' ? 1 : -1)))); }
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
            {!L.length && <tr><td colSpan={6} className="note" style={{ textAlign: 'center', padding: 24 }}>{!F0.length ? (canNew ? 'Нема фирми. Кликнете „+ Нова фирма“.' : 'Немате доделено фирми. Јавете се кај администраторот.') : 'Нема фирма што одговара на пребарувањето / филтерот.'}</td></tr>}
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
            <thead><tr><th>Фирма</th><th>Шифра</th><th>ЕДБ (даночен бр.)</th><th>ЕМБС</th><th>ДДВ</th><th>Контакт лице</th><th>Телефон</th><th>Е-пошта</th><th>Град</th><th>МПИН {pv.slice(5)}/{pv.slice(0, 4)}</th><th>ДДВ пријава</th><th>Мес. фактура</th><th style={{ textAlign: 'right' }}>Надомест</th><th></th></tr></thead>
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
                  <td className="sm">{f.recNext ? (f.recNext <= today ? <span className="no">издади {dmy(f.recNext).slice(0, 5)}</span> : dmy(f.recNext)) : '—'}</td>
                  <td className="sm" style={{ textAlign: 'right' }}>{f.fee ? nf(f.fee) : ''}</td><td>{badge(f)}</td>
                </tr>
              );
            })}</tbody>
          </table></div>
        </>
      )}
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <span className="note">Прикажани {L.length} од {F.length}{F.length !== F0.length ? ` (филтрирано од ${F0.length})` : ''}</span>
        {view !== 'group' && F.length > L.length && <button type="button" className="btn" onClick={() => setLim(L.length + 100)}>Прикажи уште {Math.min(100, F.length - L.length)}</button>}
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
