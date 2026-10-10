/**
 * Legacy `VIEWS.mojIzv` (14940) — 🔒 Мој извештај – активност по клиент: for the owner only (claimed once by an
 * administrator): per firm the work items (invoices, purchases, statement lines, cash reports, manual journals,
 * payslips), revenue / purchases / costs, the monthly fee (`firms.settings.accFee` or the service contract), den./item,
 * the real AI cost (`ai_usage`), ratings and Excel export.
 */
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { MK_MON_L, miFlag, miMedian, miRange } from '@wise/core/firms/mojizv';
import { allowedFirms, officePage, today } from '@/lib/office';
import { Hd } from '@/components/hd';
import { RowAction } from '@/components/row-action';
import { claimReport } from './actions';
import { USD_MKD, miRows, reportOwner } from './data';

const n0 = (n: number) => Math.round(n).toLocaleString('mk-MK');
const COLS: [string, string, boolean][] = [
  ['name', 'Фирма', false], ['items', 'Ставки', true], ['inv', 'Излезни', true], ['prih', 'Приходи', true], ['nab', 'Набавки', true], ['tro', 'Трошоци', true],
  ['pur', 'Влезни', true], ['ai', 'со AI', true], ['aiMkd', 'AI трошок', true], ['stm', 'Изводи', true], ['bl', 'Ставки изв.', true], ['sal', 'Малопр.', true],
  ['jr', 'Налози', true], ['emp', 'Вработ.', true], ['fee', 'Надом./мес.', true], ['net', 'Ви останува', true], ['perItem', 'Ден/ставка', true],
];

export default async function MojIzvPage({ searchParams }: { searchParams: Promise<{ md?: string; m?: string; y?: string; go?: string; s?: string; d?: string }> }) {
  const { u } = await officePage('mojIzv');
  const owner = await reportOwner();
  if (!owner) {
    if (u.role !== 'admin') notFound();
    return (
      <>
        <Hd t="🔒 Мој извештај" />
        <div className="card"><p>Овој извештај е лично ваш. Поврзете го со вашиот профил – потоа никој друг (ниту друг администратор) нема да може да го отвори.</p>
          <RowAction className="btn pri" action={claimReport} label="🔒 Поврзи го само со мене" confirm={`Извештајот „🔒 Мој извештај“ ќе се поврзе само со вашиот профил (${u.name}). Потоа никој друг – ниту друг администратор – не може да го отвори. Да продолжам?`} /></div>
      </>
    );
  }
  if (owner.id !== u.id) return (<><Hd t="🔒 Мој извештај" /><div className="empty">Нема пристап.</div></>);
  const sp = await searchParams;
  const td = today();
  const pm = (() => { let y = +td.slice(0, 4), m = +td.slice(5, 7) - 1; if (!m) { m = 12; y--; } return `${y}-${String(m).padStart(2, '0')}`; })();
  const md = sp.md === 'y' ? 'y' : 'm';
  const m = sp.m && /^\d{4}-(0[1-9]|1[0-2])$/.test(sp.m) ? sp.m : pm;
  const y = sp.y && /^\d{4}$/.test(sp.y) ? sp.y : td.slice(0, 4);
  const R = miRange(md, m, y, td.slice(0, 7));
  const qs = new URLSearchParams({ md, m, y }).toString();
  const months = Array.from({ length: 24 }, (_, i) => { const d = new Date(Date.UTC(+td.slice(0, 4), +td.slice(5, 7) - 1 - i, 1)); return d.toISOString().slice(0, 7); });
  const ctl = (
    <form className="card">
      <div className="row" style={{ gap: 10, flexWrap: 'wrap', alignItems: 'end' }}>
        <label className="f" style={{ margin: 0 }}>Период<select name="md" defaultValue={md} style={{ width: 'auto' }}><option value="m">Месец</option><option value="y">Година</option></select></label>
        <label className="f" style={{ margin: 0 }}>Месец<select name="m" defaultValue={m} style={{ width: 'auto' }}>{months.map((x) => <option key={x} value={x}>{MK_MON_L[+x.slice(5) - 1]} {x.slice(0, 4)}</option>)}</select></label>
        <label className="f" style={{ margin: 0 }}>Година<select name="y" defaultValue={y} style={{ width: 'auto' }}>{[0, 1, 2, 3].map((k) => String(+td.slice(0, 4) - k)).map((x) => <option key={x}>{x}</option>)}</select></label>
        <input type="hidden" name="go" value="1" />
        <button className="btn pri">📊 Пресметај</button>
        {sp.go && <a className="btn" href={`/mojIzv/xlsx?${qs}`}>⬇ Excel</a>}
      </div>
      <p className="note" style={{ margin: '8px 0 0' }}>🔒 Само за вас – клиентите и вработените не го гледаат. <b>Ставки</b> = излезни + влезни фактури + ставки во изводи + малопродажни сметки + рачни налози + пресметки на плата (по вработен). <b>Ден по ставка</b> = вашиот надоместок ÷ ставки – колку помалку, толку клиентот ви носи повеќе работа за помалку пари.</p>
    </form>
  );
  if (!sp.go) return (<><Hd t="🔒 Мој извештај – активност по клиент" sub={R.lbl} />{ctl}<div className="empty">Изберете период и притиснете „📊 Пресметај“.</div></>);
  const X = await miRows(await allowedFirms(u), R);
  const sk = COLS.some(([k]) => k === sp.s) ? sp.s! : 'items';
  const sd = sp.d === '1' ? 1 : sp.d === '-1' ? -1 : sk === 'name' || sk === 'perItem' ? 1 : -1;
  const val = (r: (typeof X)[number]) => (sk === 'name' ? r.F.name.toLowerCase() : (r as unknown as Record<string, number | null>)[sk] ?? (sd > 0 ? Infinity : -Infinity));
  const L = [...X].sort((a, b) => { const p = val(a), q = val(b); return p! < q! ? -sd : p! > q! ? sd : 0; });
  const tot = (k: keyof (typeof X)[number]) => X.reduce((a, r) => a + (Number(r[k]) || 0), 0);
  const med = miMedian(X);
  const mx = Math.max(1, ...X.map((r) => r.items));
  const top = [...X].sort((a, b) => b.items - a.items).filter((r) => r.items).slice(0, 5);
  const topP = X.filter((r) => r.prih > 0).sort((a, b) => b.prih - a.prih).slice(0, 5), mp = Math.max(1, ...topP.map((r) => r.prih));
  const low = X.filter((r) => r.fee > 0 && r.perItem != null && med && r.perItem < med * 0.5).sort((a, b) => a.perItem! - b.perItem!).slice(0, 8);
  const noFee = X.filter((r) => !r.fee && r.items > 0), idle = X.filter((r) => !r.items), act = X.filter((r) => r.items > 0);
  const Kpi = ({ l, v, s }: { l: string; v: string; s?: string }) => <div className="card" style={{ flex: 1, minWidth: 160, margin: 0 }}><div className="muted" style={{ fontSize: 12 }}>{l}</div><div style={{ fontSize: 22, fontWeight: 700 }}>{v}</div>{s && <div className="mini">{s}</div>}</div>;
  const th = (k: string, l: string, n: boolean) => <th key={k} className={n ? 'n' : ''} style={{ whiteSpace: 'nowrap' }}><Link href={`/mojIzv?${qs}&go=1&s=${k}&d=${sk === k ? -sd : k === 'name' || k === 'perItem' ? 1 : -1}`}>{l}{sk === k ? (sd < 0 ? ' ▼' : ' ▲') : ''}</Link></th>;
  return (
    <>
      <Hd t="🔒 Мој извештај – активност по клиент" sub={`${R.lbl} · ${X.length} фирми`} />
      {ctl}
      <div className="row" style={{ gap: 10, flexWrap: 'wrap', margin: '10px 0', alignItems: 'stretch' }}>
        <Kpi l="Активни фирми" v={`${act.length} / ${X.length}`} s={idle.length ? idle.length + ' без ниту една ставка' : ''} />
        <Kpi l="Вкупно ставки" v={n0(tot('items'))} s={`${n0(tot('inv'))} изл. · ${n0(tot('pur'))} влез. · ${n0(tot('bl'))} извод`} />
        <Kpi l="Приходи на клиентите" v={n0(tot('prih')) + ' ден'} s={`набавки ${n0(tot('nab'))} · трошоци ${n0(tot('tro'))}`} />
        <Kpi l="Пресметки на плата" v={n0(tot('payEmp'))} s="вработени × месеци" />
        <Kpi l="Надоместок за периодот" v={n0(tot('feeP')) + ' ден'} s={tot('items') ? 'просек ' + (tot('feeP') / tot('items')).toFixed(1) + ' ден / ставка' : ''} />
        <Kpi l="AI трошок" v={n0(tot('aiMkd')) + ' ден'} s={`$${tot('aiUsd').toFixed(2)} · ${n0(tot('aiDocs'))} читања`} />
        <Kpi l="Средно ден / ставка" v={med == null ? '—' : med.toFixed(1) + ' ден'} s="медијана на фирмите со надоместок" />
      </div>
      <div className="row" style={{ gap: 10, flexWrap: 'wrap', alignItems: 'stretch' }}>
        <div className="card" style={{ flex: 1, minWidth: 300, margin: 0 }}><h2 style={{ fontSize: 15, margin: '0 0 8px' }}>🏆 Најголема активност</h2>
          {top.length ? top.map((r) => <div key={r.F.id} style={{ margin: '0 0 6px' }}><div className="row" style={{ justifyContent: 'space-between' }}><span>{r.F.name}</span><b>{n0(r.items)}</b></div><div style={{ height: 8, background: 'var(--line,#e5e7eb)', borderRadius: 4 }}><div style={{ height: 8, width: `${Math.max(2, r.items / mx * 100)}%`, background: '#0f5a46', borderRadius: 4 }} /></div></div>) : <div className="muted">—</div>}</div>
        <div className="card" style={{ flex: 1, minWidth: 300, margin: 0 }}><h2 style={{ fontSize: 15, margin: '0 0 8px' }}>💰 Најголеми приходи</h2>
          {topP.length ? topP.map((r) => <div key={r.F.id} style={{ margin: '0 0 6px' }}><div className="row" style={{ justifyContent: 'space-between' }}><span>{r.F.name} <span className="mini">набавки {n0(r.nab)} · трошоци {n0(r.tro)}</span></span><b>{n0(r.prih)}</b></div><div style={{ height: 8, background: 'var(--line,#e5e7eb)', borderRadius: 4 }}><div style={{ height: 8, width: `${Math.max(2, r.prih / mp * 100)}%`, background: '#1d4ed8', borderRadius: 4 }} /></div></div>) : <div className="muted">—</div>}</div>
        <div className="card" style={{ flex: 1, minWidth: 300, margin: 0 }}><h2 style={{ fontSize: 15, margin: '0 0 8px' }}>⚠ Многу работа за малку пари</h2>
          {low.length ? low.map((r) => <div key={r.F.id} className="row" style={{ justifyContent: 'space-between', margin: '0 0 4px' }}><span>{r.F.name} <span className="mini">{n0(r.items)} ставки · {n0(r.fee)} ден/мес.</span></span><b style={{ color: '#b42318' }}>{r.perItem!.toFixed(1)} ден</b></div>) : <div className="muted">Нема фирми под половина од медијаната.</div>}
          {noFee.length > 0 && <p className="note" style={{ margin: '10px 0 0' }}>Без внесен надоместок, а имаат активност: <b>{noFee.map((r) => r.F.name).join(', ')}</b> – внесете договор во „✍ Договор за сметководствени услуги“.</p>}</div>
      </div>
      <div className="card tw" style={{ marginTop: 10, overflow: 'auto' }}><table className="dense">
        <thead><tr>{COLS.map(([k, l, n]) => th(k, l, n))}<th>Оценка</th></tr></thead>
        <tbody>{L.map((r) => { const fl = miFlag(r, med); return (
          <tr key={r.F.id}>
            <td style={{ minWidth: 170 }}>{r.F.name}</td><td className="n"><b>{n0(r.items)}</b></td><td className="n">{r.inv}</td><td className="n">{n0(r.prih)}</td><td className="n">{n0(r.nab)}</td><td className="n">{n0(r.tro)}</td>
            <td className="n">{r.pur}</td><td className="n">{r.ai || ''}</td><td className="n" title={`${r.aiDocs} читања · $${r.aiUsd.toFixed(2)}`}>{r.aiMkd ? n0(r.aiMkd) + ' ден' : ''}{r.aiUsd ? <div className="mini">${r.aiUsd.toFixed(2)}</div> : null}</td>
            <td className="n">{r.stm}</td><td className="n">{r.bl}</td><td className="n">{r.sal || ''}</td><td className="n">{r.jr || ''}</td><td className="n">{r.emp || ''}</td>
            <td className="n">{r.fee ? n0(r.fee) : '—'}</td><td className="n" style={{ color: r.net < 0 ? '#b42318' : 'inherit' }}>{r.fee || r.aiMkd ? n0(r.net) : ''}</td>
            <td className="n">{r.perItem == null ? '—' : r.perItem.toFixed(1)}</td><td>{fl && <span className={`pill ${fl[1]}`}>{fl[0]}</span>}</td>
          </tr>); })}</tbody>
        <tfoot><tr><th>Вкупно</th><th className="n">{n0(tot('items'))}</th><th className="n">{n0(tot('inv'))}</th><th className="n">{n0(tot('prih'))}</th><th className="n">{n0(tot('nab'))}</th><th className="n">{n0(tot('tro'))}</th><th className="n">{n0(tot('pur'))}</th><th className="n">{n0(tot('ai'))}</th><th className="n">{n0(tot('aiMkd'))}</th><th className="n">{n0(tot('stm'))}</th><th className="n">{n0(tot('bl'))}</th><th className="n">{n0(tot('sal'))}</th><th className="n">{n0(tot('jr'))}</th><th className="n">{n0(tot('emp'))}</th><th className="n">{n0(tot('fee'))}</th><th className="n">{n0(tot('net'))}</th><th /><th /></tr></tfoot>
      </table></div>
      <p className="note">Надоместокот за периодот = месечниот × месеците од почетокот на договорот (или „accFrom“) до крајот на периодот. Приходите и трошоците се од книжењата (74–76, класа 4 без 47/48). AI трошокот е вистински, од евиденцијата на повиците (курс {USD_MKD} ден/$).</p>
    </>
  );
}
