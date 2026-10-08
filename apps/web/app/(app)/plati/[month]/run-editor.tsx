'use client';
/**
 * Payroll month editor (legacy `payContent` 6176, `payEmpPanel` 6208, `payAddPanel` 6206, `payLineDlg` 6256 and the
 * `pay*` / `payLine*` handlers 7119–7133, keyboard F4 / Esc). Edits a local copy; "Зачувај" stores it, "Пресметка (F4)"
 * stores, calculates and posts (legacy `savePay2`). Line editing uses the `@wise/core` helpers (FIX #14).
 */
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState, useTransition } from 'react';
import {
  empCalc, HT_ADD, makePayLine, payBaseSum, payCatOf, payEmpFor, payIOHours, PCAT, removePayLine, takeFromEmployee, upsertPayLine,
  HTYPES, PXTRA, type PayCat, type PayEmp, type PayLine, type PayParams, type PsifCode,
} from '@wise/core/payroll';
import { fmt, fq } from '@/lib/fmt';
import { deleteRunAction, lockRunAction, mailSlipsAction, saveRunAction, unpostRunAction } from '../actions';

export interface EditorEmployee {
  id: string; no: string; name: string; embg: string; netBase: number; coef: number; start?: string; end?: string; stazPrev?: string; stazY?: string;
  hNorm?: string; active: boolean; position: string; oe: string; city: string; email: string;
}

interface Props {
  run: { id: string; month: string; status: 'draft' | 'posted'; locked: boolean; params: PayParams; emps: PayEmp[] };
  employees: EditorEmployee[];
  psif: PsifCode[];
  official: PayParams;
  split: { work: number; hol: number; names: string[] };
  journalNumber: string | null;
  openNotes: string[];
  mpinDiff: string[];
  mails: Record<string, { status: string; error: string | null; at: string; to: string }>;
  exports: { id: string; kind: string; name: string; at: string }[];
  groupMail: Record<string, string>;
  firmEmail: string;
  canWrite: boolean;
  canDel: boolean;
}

type LineEd = { ix: number | null; code: string; type: string; hours: string; amt: string; pct: string; cat: PayCat };
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x));
const num = (v: string) => (v.trim() === '' ? 0 : +v.replace(',', '.') || 0);
const catOf = (l: PayLine): PayCat => (l.cat || payCatOf(l.type)) as PayCat;

export function RunEditor(p: Props) {
  const router = useRouter();
  const [params, setParams] = useState<PayParams>(p.run.params);
  const [emps, setEmps] = useState<PayEmp[]>(p.run.emps);
  const [dirty, setDirty] = useState(false);
  const [sel, setSel] = useState(p.run.emps.length ? 0 : -1);
  const [open, setOpen] = useState(-1);
  const [lineSel, setLineSel] = useState(-1);
  const [lineEd, setLineEd] = useState<LineEd | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [mailOpen, setMailOpen] = useState(false);
  const [F, setF] = useState({ rp: '', oe: '', q: '' });
  const [msg, setMsg] = useState<{ ok?: string; error?: string }>({});
  const [pending, start] = useTransition();
  const lock = p.run.locked || !p.canWrite;
  const ro = lock;
  const M = p.run.month;
  const mm = M.split('-').reverse().join('/');
  const empOf = (id: string) => p.employees.find((x) => x.id === id);

  const calcs = useMemo(() => emps.map((e) => { try { return empCalc(e, params); } catch { return null; } }), [emps, params]);
  const idx = emps.map((_, i) => i).filter((i) => {
    const e = emps[i]!, me = empOf(e.empId);
    return (!F.rp || (me?.position ?? '') === F.rp) && (!F.oe || (me?.oe ?? '') === F.oe) && (!F.q || `${e.name} ${e.no}`.toLowerCase().includes(F.q.toLowerCase()));
  });
  const RP = [...new Set(p.employees.map((e) => e.position).filter(Boolean))], OE = [...new Set(p.employees.map((e) => e.oe).filter(Boolean))];
  const sum = (f: (i: number) => number) => idx.reduce((s, i) => s + f(i), 0);

  const mutate = (fn: (E: PayEmp[]) => void) => { const E = clone(emps); fn(E); setEmps(E); setDirty(true); };
  const setParam = (k: keyof PayParams, v: string) => { setParams({ ...params, [k]: num(v) }); setDirty(true); };

  const run = (fn: () => Promise<{ ok?: string; error?: string } | void>) => start(async () => {
    const r = await fn();
    if (r) setMsg(r);
    if (r && !r.error) router.refresh();
  });
  const save = (post: boolean) => run(async () => {
    const r = await saveRunAction({ month: M, runId: p.run.id, params, emps, post });
    if (!r.error) setDirty(false);
    return r;
  });

  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'F4') { ev.preventDefault(); if (!lock && emps.length) save(true); }
      else if (ev.key === 'Escape') { if (lineEd) setLineEd(null); else if (open >= 0) setOpen(-1); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });
  useEffect(() => {
    const warn = (ev: BeforeUnloadEvent) => { if (dirty) { ev.preventDefault(); } };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const e = open >= 0 ? emps[open] : undefined;
  const c = open >= 0 ? calcs[open] : null;
  const printHref = (q: string) => `/plati/${M}/pecati?${q}`;
  const PrintBtn = ({ href, children, title }: { href: string; children: React.ReactNode; title?: string }) =>
    dirty ? <button className="btn" disabled title="Прво зачувајте ги промените">{children}</button>
      : <a className="btn" href={href} target="_blank" rel="noopener" title={title}>{children}</a>;

  return (
    <>
      <div className="hd">
        <h1>Содржина на пресметка<span className="mk">{mm}{p.run.locked ? ' · 🔒 заклучен' : ''}{p.run.status === 'posted' ? ` · прокнижено${p.journalNumber ? ' (налог ' + p.journalNumber + ')' : ''}` : ' · непрокнижено'}{dirty ? ' · ✎ незачувани промени' : ''}</span></h1>
        <div className="row">
          <Link className="btn" href="/plati">← Избор на месец</Link>
          <PrintBtn href={printHref('d=rec')}>PDF рекапитулар</PrintBtn>
          {sel >= 0 && emps[sel] && <PrintBtn href={printHref('d=slip&e=' + encodeURIComponent(emps[sel]!.empId))} title="Пресметка само за избраниот вработен">PDF: {emps[sel]!.name.slice(0, 22)}</PrintBtn>}
          <PrintBtn href={printHref('d=slips')}>PDF пресметки (сите)</PrintBtn>
          <PrintBtn href={`/plati/${M}/mpin?f=xlsx`}>МПИН (Excel)</PrintBtn>
          <PrintBtn href={`/plati/${M}/mpin`} title="MPI3 .txt за УЈП">МПИН (.txt за УЈП)</PrintBtn>
          <PrintBtn href={`/plati/${M}/nalozi`}>Налози за плаќање</PrintBtn>
          <button className="btn" disabled={dirty || p.run.status !== 'posted'} title={p.run.status !== 'posted' ? 'Прво пресметка (F4)' : ''} onClick={() => setMailOpen(!mailOpen)}>✉ Испрати пресметки</button>
        </div>
      </div>
      {msg.error && <div className="callout bad" role="alert">{msg.error}</div>}
      {msg.ok && <div className="callout good">{msg.ok}</div>}
      {p.openNotes.length > 0 && (
        <div className="callout bad"><b>⛔ {p.openNotes.length} отворени известувања за промени</b> – пресметка (F4), заклучување и МПИН не се дозволени додека не ги внесете и означите „✓ Внесено“ (<Link href="/plati">кон известувањата</Link>):<br />{p.openNotes.join(' · ')}</div>
      )}
      {p.mpinDiff.length > 0 && <div className="callout warn">Параметрите на месецот се разликуваат од официјалните на УЈП за {mm}: {p.mpinDiff.join('; ')}. МПИН пријавата може да биде одбиена.</div>}

      {mailOpen && <MailPanel p={p} onDone={(r) => { setMsg(r); if (!r.error) setMailOpen(false); }} />}

      <div className="card"><div className="row" style={{ gap: 14, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <fieldset className="fs" style={{ minWidth: 150 }}><legend>Период</legend>
          <label className="fl"><span>Година</span><input value={M.slice(0, 4)} readOnly style={{ width: 80 }} /></label>
          <label className="fl"><span>Месец</span><input value={M.slice(5, 7)} readOnly style={{ width: 80 }} /></label>
        </fieldset>
        <fieldset className="fs" style={{ flex: 1, minWidth: 320 }}><legend>Генерални податоци за месецот</legend>
          <div className="form">
            {([['avg', 'Просечна бруто плата'], ['minGross', 'Мин. плата (бруто)'], ['minNet', 'Мин. плата (нето)'], ['minBase', 'Најниска основица'], ['hours', 'Работни часови'], ['exempt', 'Даночно ослободување']] as const).map(([k, l]) => (
              <label className="f" key={k}>{l}<input type="number" step="any" value={String(params[k] ?? '')} disabled={ro} onChange={(x) => setParam(k, x.target.value)} /></label>
            ))}
          </div>
          <details style={{ marginTop: 6 }}><summary className="mini">Стапки на придонеси и данок</summary>
            <div className="row" style={{ gap: '8px 14px', marginTop: 6 }}>
              {([['pio', 'ПИО'], ['zdr', 'Здравство'], ['dop', 'Доп. здравство'], ['vrab', 'Вработување'], ['tax', 'Персонален данок']] as const).map(([k, l]) => (
                <label className="mini" key={k}>{l} <input type="number" step="any" value={String(params[k])} disabled={ro} onChange={(x) => setParam(k, x.target.value)} style={{ width: 70, textAlign: 'right' }} /> %</label>
              ))}
              <button className="btn sm" disabled={ro} onClick={() => { setParams({ ...params, ...p.official }); setDirty(true); setMsg({ ok: 'Применети се параметрите што важат за ' + M + '.' }); }}>Врати ги важечките за {M}</button>
            </div>
          </details>
        </fieldset>
      </div>
        <p className="note" style={{ margin: '6px 0 0' }}>Работни часови: <b>{p.split.work}</b> редовни{p.split.hol ? <> + <b>{p.split.hol}</b> државен празник ({p.split.names.join(', ')})</> : null}.</p>
      </div>

      <div className="tw"><table className="dense">
        <thead><tr><th>Шифра</th><th>Име и презиме</th><th className="n">Бруто плата</th><th className="n">Бруто осн.</th><th className="n">Придонеси</th><th className="n">Данок</th><th className="n">Износ за исплата</th><th className="n">Одработени часови</th><th>Е-пошта</th></tr></thead>
        <tbody>
          {idx.map((i) => {
            const x = emps[i]!, k = calcs[i];
            const ml = p.mails[x.empId];
            return (
              <tr key={i} onClick={() => setSel(i)} onDoubleClick={() => { setSel(i); setOpen(i); setLineSel(-1); }} style={{ cursor: 'pointer', ...(i === sel ? { background: 'var(--accent-soft)', fontWeight: 600 } : {}) }}>
                <td>{x.no}</td>
                <td>{x.name}{x.adv ? <> <span className="pill info">аванс</span></> : null}{x.noTax ? <> <span className="pill">без данок</span></> : null}{x.inout && x.inout !== 'full' ? <> <span className="pill warn">{x.inout === 'in' ? 'пријава' : 'одјава'} {x.ioDate?.split('-').reverse().join('.')}</span></> : null}</td>
                {k ? <>
                  <td className="n">{fmt(k.T.gross + k.T.dopl)}</td><td className="n">{fmt(payBaseSum(k))}</td><td className="n">{fmt(k.T.contr + k.T.dopl)}</td>
                  <td className="n">{fmt(k.T.tax)}</td><td className="n">{fmt(k.T.net)}</td><td className="n">{fq(k.rows.reduce((a, r) => a + (r.hr || 0), 0))}</td>
                </> : <td colSpan={6} className="note">неважечки параметри</td>}
                <td>{ml ? <span className={'pill ' + (ml.status === 'sent' ? 'good' : ml.status === 'failed' ? 'bad' : 'warn')} title={(ml.error ?? '') + ' ' + ml.to + ' · ' + ml.at}>{ml.status === 'sent' ? '✓ испратено' : ml.status === 'failed' ? 'неуспешно' : 'во ред'}</span> : empOf(x.empId)?.email ? '' : <span className="mini">нема е-пошта</span>}</td>
              </tr>
            );
          })}
          {!idx.length && <tr><td colSpan={9} className="note">Нема вработени во пресметката{emps.length ? ' за овој филтер' : ''}.</td></tr>}
        </tbody>
        <tfoot><tr><td colSpan={2}>Вкупно ({idx.length})</td>
          <td className="n">{fmt(sum((i) => (calcs[i] ? calcs[i]!.T.gross + calcs[i]!.T.dopl : 0)))}</td>
          <td className="n">{fmt(sum((i) => (calcs[i] ? payBaseSum(calcs[i]!) : 0)))}</td>
          <td className="n">{fmt(sum((i) => (calcs[i] ? calcs[i]!.T.contr + calcs[i]!.T.dopl : 0)))}</td>
          <td className="n">{fmt(sum((i) => calcs[i]?.T.tax ?? 0))}</td>
          <td className="n">{fmt(sum((i) => calcs[i]?.T.net ?? 0))}</td>
          <td className="n">{fq(sum((i) => calcs[i]?.rows.reduce((a, r) => a + (r.hr || 0), 0) ?? 0))}</td><td></td></tr></tfoot>
      </table></div>

      <div className="pay-bar">
        <button className="btn" disabled={ro} onClick={() => setAddOpen(!addOpen)}>Нов (Ins)</button>
        <button className="btn" disabled={sel < 0} onClick={() => { setOpen(sel); setLineSel(-1); }}>Преглед (Ent)</button>
        <button className="btn" disabled={sel < 0 || ro} onClick={() => {
          const x = emps[sel]; if (!x || !window.confirm(`Да се отстрани „${x.name}“ од пресметката за ${M}?`)) return;
          mutate((E) => E.splice(sel, 1)); setOpen(-1); setSel(Math.min(sel, emps.length - 2));
        }}>Бришење (Del)</button>
        <select value={F.rp} onChange={(x) => setF({ ...F, rp: x.target.value })} style={{ width: 'auto' }}><option value="">Филтер по РП (сите)</option>{RP.map((x) => <option key={x}>{x}</option>)}</select>
        <select value={F.oe} onChange={(x) => setF({ ...F, oe: x.target.value })} style={{ width: 'auto' }}><option value="">Филтер по ОЕ (сите)</option>{OE.map((x) => <option key={x}>{x}</option>)}</select>
        <input placeholder="🔍 Пребарување…" value={F.q} onChange={(x) => setF({ ...F, q: x.target.value })} style={{ width: 170 }} />
        <span style={{ flex: 1 }} />
        <button className="btn" disabled={ro || pending || !dirty} onClick={() => save(false)}>Зачувај</button>
        <button className="btn pri" disabled={ro || pending || !emps.length || p.openNotes.length > 0} onClick={() => save(true)}>Пресметка (F4)</button>
        {p.run.status === 'posted' && <button className="btn" disabled={ro || pending} onClick={() => { if (window.confirm('Да се отпокнижи налогот за платата? Пресметката останува зачувана.')) run(() => unpostRunAction(p.run.id)); }}>Отпокнижи</button>}
        {p.canWrite && <button className="btn" disabled={pending || dirty} onClick={() => run(() => lockRunAction(p.run.id, !p.run.locked))}>{p.run.locked ? 'Отклучи месец' : 'Заклучи месец'}</button>}
        {p.canDel && <button className="btn danger" disabled={ro || pending} onClick={() => { if (window.confirm(`Да се избрише пресметката за ${M} (заедно со налогот)?`)) run(() => deleteRunAction(p.run.id)); }}>Избриши месец</button>}
      </div>

      {addOpen && (
        <div className="card">
          <div className="hd"><h2>Додај вработен во пресметката</h2><button className="btn sm" onClick={() => setAddOpen(false)}>Затвори</button></div>
          {(() => {
            const inM = new Set(emps.map((x) => x.empId));
            const L = p.employees.filter((x) => !inM.has(x.id));
            return L.length ? (
              <div className="tw"><table className="dense"><tbody>{L.map((x) => (
                <tr key={x.id}><td>{x.no}</td><td>{x.name}</td><td>{x.position}</td><td className="n">{x.netBase ? fmt(x.netBase) : ''}</td><td>{!x.active && <span className="pill">неактивен</span>}</td>
                  <td><button className="btn sm pri" onClick={() => { mutate((E) => E.push(payEmpFor(M, x, params))); setSel(emps.length); setMsg({ ok: 'Додаден: ' + x.name + '. Притиснете „Пресметка (F4)“ за да се зачува.' }); }}>Додај</button></td></tr>
              ))}</tbody></table></div>
            ) : <p className="note">Сите вработени се веќе во пресметката. Нов вработен додадете во <Link href="/vraboteni">„Матични податоци за вработени“</Link>.</p>;
          })()}
        </div>
      )}

      {e && c && (
        <div className="card" id="payEmpCard">
          <div className="hd"><h2>{e.no} {e.name}</h2><div className="row">
            <button className="btn sm" disabled={open <= 0} onClick={() => { setOpen(open - 1); setSel(open - 1); setLineSel(-1); }}>◀</button>
            <button className="btn sm" disabled={open >= emps.length - 1} onClick={() => { setOpen(open + 1); setSel(open + 1); setLineSel(-1); }}>▶</button>
            <PrintBtn href={printHref('d=slip&e=' + encodeURIComponent(e.empId))}>PDF пресметка</PrintBtn>
            <button className="btn sm" onClick={() => setOpen(-1)}>Затвори (Esc)</button>
          </div></div>
          <div className="row" style={{ gap: 12, flexWrap: 'wrap', alignItems: 'flex-start' }}>
            <div className="form" style={{ flex: '0 0 auto' }}>
              <label className="f"><b>Нето плата</b><input type="number" step="any" disabled={ro} value={e.grossBase ? '' : String(e.netBase ?? '')} placeholder={e.grossBase ? 'од бруто' : ''}
                onChange={(x) => mutate((E) => { E[open]!.netBase = num(x.target.value); })} /></label>
              <label className="f"><b>Бруто плата</b><input type="number" step="any" disabled={ro} value={String(e.grossBase ?? '')} placeholder={fmt(c.Gf)}
                onChange={(x) => mutate((E) => { const v = num(x.target.value); if (v) E[open]!.grossBase = v; else delete E[open]!.grossBase; })} /></label>
              <label className="f">Коефициент<input type="number" step="any" disabled={ro} value={String(e.coef ?? '')} onChange={(x) => mutate((E) => { E[open]!.coef = num(x.target.value); })} /></label>
              <label className="f">Час. за раб.<input type="number" step="any" disabled={ro} value={String(e.hNorm ?? '')} placeholder={String(params.hours ?? '')} onChange={(x) => mutate((E) => { const v = num(x.target.value); if (v) E[open]!.hNorm = v; else delete E[open]!.hNorm; })} /></label>
              <label className="f">Стаж (год.) · минат труд {c.mt}%<input type="number" step="any" disabled={ro} value={String(e.stazY ?? '')} onChange={(x) => mutate((E) => { E[open]!.stazY = num(x.target.value); })} /></label>
            </div>
            {([['short', 'Скрат. раб. време', 'Да', 'Не'], ['union', 'Чл. на синд.', 'Да', 'Не'], ['noTax', 'Тип', 'без данок', 'со данок'], ['adv', 'Исплата', 'аванс', 'цел износ']] as const).map(([k, l, a, b]) => (
              <fieldset className="fs" key={k}><legend>{l}</legend>
                <label className="chk"><input type="radio" checked={!!e[k]} disabled={ro} onChange={() => mutate((E) => { (E[open] as unknown as Record<string, unknown>)[k] = true; })} /> {a}</label>
                <label className="chk"><input type="radio" checked={!e[k]} disabled={ro} onChange={() => mutate((E) => { (E[open] as unknown as Record<string, unknown>)[k] = false; })} /> {b}</label>
              </fieldset>
            ))}
            <fieldset className="fs"><legend>Пријава / Одјава</legend>
              {([['full', 'Цел месец'], ['in', 'Пријава'], ['out', 'Одјава']] as const).map(([v, n]) => (
                <label className="chk" key={v} style={{ display: 'block' }}><input type="radio" checked={(e.inout || 'full') === v} disabled={ro}
                  onChange={() => mutate((E) => { const x = E[open]!; x.inout = v; if (v === 'full') delete x.ioDate; payIOHours(M, x); })} /> {n}</label>
              ))}
              {(e.inout || 'full') !== 'full' && <input type="date" value={e.ioDate ?? ''} disabled={ro} min={M + '-01'} max={M + '-31'}
                onChange={(x) => mutate((E) => { const y = E[open]!; y.ioDate = x.target.value; payIOHours(M, y); })} />}
            </fieldset>
            <div className="row" style={{ flexDirection: 'column', gap: 6 }}>
              <button className="btn sm" disabled={ro} onClick={() => { const me = empOf(e.empId); if (!me) { setMsg({ error: 'Вработениот не е најден во матичните податоци.' }); return; } mutate((E) => takeFromEmployee(E[open]!, me, M)); setMsg({ ok: 'Превземено од матични податоци.' }); }}>Превземи од матични</button>
              <button className="btn sm" disabled={ro} onClick={() => { mutate((E) => { E[open]!.grossBase = +params.avg || 0; }); setMsg({ ok: 'Бруто = просечна бруто плата ' + fmt(params.avg) }); }}>Просечно бруто</button>
            </div>
          </div>
          <div className="tw" style={{ marginTop: 8 }}><table className="dense">
            <thead><tr><th>Опис</th><th className="n">Час</th><th className="n">%</th><th className="n">Износ</th><th className="c">Ред. час</th><th className="c">Придонеси</th><th className="c">Болед.</th><th className="c">Год. одмор</th><th className="c">Синдик./Осиг.</th><th className="c">Прекувр.</th><th className="c">Нагр./Казна</th></tr></thead>
            <tbody>{(e.lines ?? []).map((l, j) => {
              const r = (() => { try { return empCalc({ ...e, lines: [l] }, params).rows[0]; } catch { return undefined; } })();
              const cat = catOf(l);
              const pre = cat === 'dop' && (HT_ADD(l.type) || /^1\d\d$/.test(l.code || ''));
              const flags = [cat === 'reg', cat !== 'sin', cat === 'bol', cat === 'odm', cat === 'sin', pre, cat === 'kor' || (cat === 'dop' && !pre)];
              return (
                <tr key={j} onClick={() => setLineSel(j)} onDoubleClick={() => { if (!ro) setLineEd(edOf(l, j)); }} style={{ cursor: 'pointer', ...(lineSel === j ? { background: 'var(--accent-soft)' } : {}) }}>
                  <td>{l.code && <small className="mut">{l.code} </small>}{l.type}{l.payer === 'ФЗО' && <> <span className="pill warn">ФЗО</span></>}</td>
                  <td className="n">{+(l.hours ?? 0) ? fq(l.hours as number) : ''}</td>
                  <td className="n">{cat === 'sin' || (!+(l.hours ?? 0) && +(l.amt ?? 0)) ? '' : String(l.pct ?? 100)}</td>
                  <td className="n">{r ? fmt(cat === 'sin' ? -(+(l.amt ?? 0) || 0) : r.gr) : ''}</td>
                  {flags.map((f, i) => <td key={i} className="c">{f ? '☑' : '☐'}</td>)}
                </tr>
              );
            })}</tbody>
            <tfoot><tr><td>Вкупно</td><td className="n">{(() => { const x = c.rows.filter((r) => catOf(r) === 'dop').reduce((a, r) => a + (r.hr || 0), 0); return x ? `${fq(c.T.hours)} + ${fq(x)} = ${fq(c.T.hours + x)}` : fq(c.T.hours); })()}</td><td></td><td className="n">{fmt(c.T.gross)}</td><td colSpan={7}></td></tr></tfoot>
          </table></div>
          <div className="mini" style={{ margin: '6px 0' }}>Бруто {fmt(c.T.gross + c.T.dopl)} · придонеси {fmt(c.T.contr + c.T.dopl)} · данок {fmt(c.T.tax)}{c.T.ded ? ' · задршки ' + fmt(c.T.ded) : ''} · <b>за исплата {fmt(c.T.net)}</b>
            {(() => { const f = c.rows.filter((r) => r.payer === 'ФЗО').reduce((a, r) => a + r.gr, 0); return f ? <> · <span className="pill warn">од тоа бруто на товар на ФЗО (рефундација): {fmt(f)}</span></> : null; })()}</div>
          <div className="row" style={{ gap: 8 }}>
            <button className="btn" disabled={ro} onClick={() => setLineEd({ ix: null, code: '', type: '', hours: '0', amt: '0', pct: '100', cat: 'dop' })}>Нов</button>
            <button className="btn" disabled={ro || lineSel < 0} onClick={() => { const l = e.lines?.[lineSel]; if (l) setLineEd(edOf(l, lineSel)); }}>Промени (Ent)</button>
            <button className="btn" disabled={ro || lineSel < 0} onClick={() => { mutate((E) => removePayLine(E[open]!, lineSel, params)); setLineSel(-1); }}>Бришење</button>
          </div>
          {lineEd && <LineDialog ed={lineEd} psif={p.psif} setEd={setLineEd} onOk={(l) => {
            try {
              const line = makePayLine({ type: l.type, hours: l.hours, amt: l.amt, pct: l.pct, cat: l.cat, code: l.code }, p.psif);
              mutate((E) => upsertPayLine(E[open]!, line, l.ix, params));
              setLineSel(l.ix ?? (e.lines?.length ?? 0)); setLineEd(null);
            } catch (x) { setMsg({ error: (x as Error).message }); }
          }} />}
        </div>
      )}

      {p.exports.length > 0 && (
        <details className="card"><summary>Архива на МПИН извози ({p.exports.length})</summary>
          <table className="dense"><tbody>{p.exports.map((x) => <tr key={x.id}><td>{x.at}</td><td>{x.kind}</td><td>{x.name}</td><td><a className="btn sm" href={`/plati/${M}/mpin?arhiva=${x.id}`}>Преземи</a></td></tr>)}</tbody></table>
        </details>
      )}
    </>
  );
}

function edOf(l: PayLine, ix: number): LineEd {
  return { ix, code: l.code ?? '', type: l.type, hours: String(l.hours ?? 0), amt: String(l.amt ?? 0), pct: String(l.pct ?? 100), cat: catOf(l) };
}

function LineDialog({ ed, psif, setEd, onOk }: { ed: LineEd; psif: PsifCode[]; setEd: (x: LineEd | null) => void; onOk: (x: LineEd) => void }) {
  const info = ed.code ? psif.find((y) => y.code === ed.code) : undefined;
  const types = [...new Set([...psif.map((x) => x.name), ...HTYPES.map((x) => x[0]), ...PXTRA.map((x) => x[0])])];
  return (
    <div className="card" style={{ marginTop: 8, borderColor: 'var(--accent)' }}>
      <div className="row" style={{ gap: 16, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <div className="form" style={{ flex: '0 0 340px' }}>
          <label className="f wide">Шифра<select value={ed.code} onChange={(x) => {
            const s = psif.find((y) => y.code === x.target.value);
            setEd(s ? { ...ed, code: s.code, type: s.name, pct: String(s.cat === 'kor' || s.cat === 'sin' ? 0 : s.pct), cat: s.cat } : { ...ed, code: '' });
          }}>
            <option value="">— слободен внес —</option>
            {PCAT.map(([k, n]) => <optgroup key={k} label={n}>{psif.filter((x) => x.cat === k).map((x) => <option key={x.code} value={x.code}>{x.code} · {x.name}{x.cat === 'kor' || x.cat === 'sin' ? '' : ' – ' + x.pct + '%'}</option>)}</optgroup>)}
          </select></label>
          <label className="f wide">Опис<input list="plTypes" value={ed.type} autoFocus onChange={(x) => setEd({ ...ed, type: x.target.value })} /></label>
          <label className="f">Часови<input type="number" step="any" value={ed.hours} onChange={(x) => setEd({ ...ed, hours: x.target.value })} /></label>
          <label className="f">Износ<input type="number" step="any" value={ed.amt} onChange={(x) => setEd({ ...ed, amt: x.target.value })} /></label>
          <label className="f">Процент<input type="number" step="any" value={ed.pct} onChange={(x) => setEd({ ...ed, pct: x.target.value })} /></label>
        </div>
        <fieldset className="fs"><legend>Тип на дефинирана ставка</legend>
          {PCAT.map(([k, n]) => <label className="chk" key={k} style={{ display: 'block' }}><input type="radio" checked={ed.cat === k} onChange={() => setEd({ ...ed, cat: k })} /> {n}</label>)}
        </fieldset>
        <div className="row" style={{ flexDirection: 'column', gap: 8 }}>
          <button className="btn pri" onClick={() => onOk(ed)}>Во ред (F9)</button>
          <button className="btn" onClick={() => setEd(null)}>Излез (Esc)</button>
        </div>
      </div>
      {info && <p className="note" style={{ margin: '6px 0 0' }}><b>{info.code} {info.name}</b> · {info.cat === 'kor' || info.cat === 'sin' ? 'износ' : info.pct + '%'} · на товар на: <b>{info.payer}</b>{info.mpin ? ' · МПИН вид на надоместок: ' + info.mpin : ''}{info.basis ? <><br />Основ: {info.basis}</> : null}</p>}
      <p className="note" style={{ margin: '6px 0 0' }}>Часови × процент = износ од бруто платата по час. Ако внесете само <b>Износ</b> (без часови), се додава фиксен бруто износ (награда, корекција; казна со минус). „Синдикат/Осигурување“ е задршка од нето платата.</p>
      <datalist id="plTypes">{types.map((x) => <option key={x} value={x} />)}</datalist>
    </div>
  );
}

function MailPanel({ p, onDone }: { p: Props; onDone: (r: { ok?: string; error?: string }) => void }) {
  const [mode, setMode] = useState<'one' | 'each' | 'grp'>('each');
  const [to, setTo] = useState(p.firmEmail);
  const [by, setBy] = useState<'oe' | 'city'>('oe');
  const [pending, start] = useTransition();
  const E = new Map(p.employees.map((x) => [x.id, x]));
  const withMail = p.run.emps.filter((x) => E.get(x.empId)?.email);
  const groups = [...new Set(p.run.emps.map((x) => String(E.get(x.empId)?.[by] ?? '').trim() || `(без ${by === 'city' ? 'град' : 'ОЕ'})`))].sort();
  const [G, setG] = useState<Record<string, string>>({});
  const gv = (k: string) => G[`${by}:${k}`] ?? p.groupMail[`${by}:${k}`] ?? '';
  return (
    <div className="card" style={{ gap: 8, borderColor: 'var(--accent)' }}>
      <b>✉ Испрати ги пресметките за {p.run.month.split('-').reverse().join('/')}</b>
      <label className="chk"><input type="radio" checked={mode === 'each'} onChange={() => setMode('each')} /> <b>Секој вработен</b> ја добива својата пресметка на својата е-пошта ({withMail.length} од {p.run.emps.length} имаат е-пошта)</label>
      {mode === 'each' && withMail.length < p.run.emps.length && <p className="mini" style={{ margin: 0 }}>Без е-пошта: {p.run.emps.filter((x) => !E.get(x.empId)?.email).map((x) => x.name).join(', ')} – внесете ја во „Матични податоци за вработени“.</p>}
      <label className="chk"><input type="radio" checked={mode === 'one'} onChange={() => setMode('one')} /> Сите пресметки во една порака на адреса: <input value={to} onChange={(x) => setTo(x.target.value)} placeholder="sopstvenik@firma.mk" style={{ width: 240, marginLeft: 6 }} /></label>
      <label className="chk"><input type="radio" checked={mode === 'grp'} onChange={() => setMode('grp')} /> <b>По пункт / град</b>, групирано по <select value={by} onChange={(x) => setBy(x.target.value as 'oe' | 'city')} style={{ width: 'auto', marginLeft: 4 }}><option value="oe">Организациона единица (ОЕ / пункт)</option><option value="city">Град</option></select></label>
      {mode === 'grp' && (
        <table className="dense"><thead><tr><th>{by === 'city' ? 'Град' : 'Пункт / ОЕ'}</th><th>Е-пошта на пунктот</th></tr></thead>
          <tbody>{groups.map((k) => <tr key={k}><td>{k}</td><td><input value={gv(k)} onChange={(x) => setG({ ...G, [`${by}:${k}`]: x.target.value })} placeholder="punkt@firma.mk" style={{ width: 220 }} /></td></tr>)}</tbody></table>
      )}
      <p className="mini" style={{ margin: 0 }}>Пресметката се испраќа во самата порака (HTML). Пораките се праќаат преку серверот за е-пошта и се евидентираат; статусот се гледа во колоната „Е-пошта“.</p>
      <div className="row"><button className="btn pri" disabled={pending} onClick={() => {
        const groupsIn = Object.fromEntries(groups.map((k) => [k, gv(k)]).filter(([, v]) => v));
        if (!window.confirm(mode === 'each' ? `Да се испрати пресметката на секој од ${withMail.length} вработени?` : mode === 'one' ? `Да се испратат сите ${p.run.emps.length} пресметки на ${to}?` : `Да се испратат пресметките на ${Object.keys(groupsIn).length} групи?`)) return;
        start(async () => onDone(await mailSlipsAction({ runId: p.run.id, mode, to, groupBy: by, groups: groupsIn })));
      }}>✉ Испрати</button></div>
    </div>
  );
}
