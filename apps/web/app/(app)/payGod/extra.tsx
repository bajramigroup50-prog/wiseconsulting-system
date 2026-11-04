/**
 * Плата › Годишен извештај – the Helix payroll reports: „Збирен рекапитулар по ставки и месеци“ (`?k=st`), totals per
 * организациона единица (`?k=oe`, Helix KumulativPoOE) and „Боледувања“ (`?k=bol`): sick leave per employee and month,
 * with what is on the ФЗО (refund) and the monthly ФЗО refund list (Helix FZOPotvrda) to print.
 */
import Link from 'next/link';
import { empCalc, payCatOf, PCAT, type PayCat } from '@wise/core';
import { dmy, fmt, fq } from '@/lib/fmt';
import { firmEmployees, yearRuns } from '@/lib/payroll/server';
import { Hd } from '@/components/hd';
import { ExportBar, type Cell } from '@/components/parity-fin/export-bar';

export const MM = ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12'];
type Runs = Awaited<ReturnType<typeof yearRuns>>;

function Tabs({ k }: { k: string }) {
  const T = [['st', 'Рекапитулар по ставки'], ['oe', 'По организациони единици'], ['kum', 'Кумулативна пресметка'], ['bol', 'Боледувања и ФЗО']] as const;
  return (
    <div className="row" style={{ gap: 6, marginBottom: 8, flexWrap: 'wrap' }}>
      <Link className="btn sm ghost" href="/payGod">← Годишен извештај</Link>
      {T.map(([x, l]) => <Link key={x} className={'btn sm' + (k === x ? ' pri' : '')} href={`/payGod?k=${x}`}>{l}</Link>)}
    </div>
  );
}

function MonthTable({ id, head, rows, f = fmt }: { id: string; head: string; rows: { key: string; label: string; sub?: string; m: Record<string, number> }[]; f?: (v: number) => string }) {
  const tot = (m: Record<string, number>) => Object.values(m).reduce((a, v) => a + v, 0);
  return (
    <div className="tw" id={id}><table className="dense">
      <thead><tr><th>{head}</th>{MM.map((x) => <th key={x} className="n">{x}</th>)}<th className="n">Вкупно</th></tr></thead>
      <tbody>{rows.map((r) => <tr key={r.key}><td>{r.label}{r.sub ? <small className="mut"> · {r.sub}</small> : null}</td>{MM.map((x) => <td key={x} className="n">{r.m[x] ? f(r.m[x]) : ''}</td>)}<td className="n"><b>{f(tot(r.m))}</b></td></tr>)}</tbody>
      <tfoot><tr><td>Вкупно</td>{MM.map((x) => <td key={x} className="n">{f(rows.reduce((a, r) => a + (r.m[x] ?? 0), 0))}</td>)}<td className="n">{f(rows.reduce((a, r) => a + tot(r.m), 0))}</td></tr></tfoot>
    </table></div>
  );
}
const csvOf = (head: string, rows: { label: string; sub?: string; m: Record<string, number> }[]): Cell[][] =>
  [[head, ...MM, 'Вкупно'], ...rows.map((r) => [r.label + (r.sub ? ' · ' + r.sub : ''), ...MM.map((x) => r.m[x] ?? ''), Object.values(r.m).reduce((a, v) => a + v, 0)])];

/** „Збирен рекапитулар по ставки и месеци“: gross per line type (deductions and non-taxable payments as their amount). */
export function StavkiReport({ runs, year }: { runs: Runs; year: number }) {
  const M = new Map<string, { key: string; label: string; sub: string; cat: PayCat; m: Record<string, number> }>();
  for (const p of runs) for (const e of p.emps) for (const r of empCalc(e, p.params).rows) {
    const cat = (r.cat || payCatOf(r.type)) as PayCat;
    const v = cat === 'sin' ? r.ded : cat === 'nep' ? r.nep : r.gr;
    if (!v) continue;
    const key = cat + '|' + r.type;
    const o = M.get(key) ?? M.set(key, { key, label: r.type, sub: PCAT.find((c) => c[0] === cat)?.[1] ?? cat, cat, m: {} }).get(key)!;
    const mm = p.month.slice(5, 7);
    o.m[mm] = (o.m[mm] ?? 0) + v;
  }
  const order = PCAT.map((c) => c[0]) as PayCat[];
  const rows = [...M.values()].sort((a, b) => order.indexOf(a.cat) - order.indexOf(b.cat) || a.label.localeCompare(b.label, 'mk'));
  return (
    <>
      <Hd t="Рекапитулар по ставки и месеци" sub={`${year} · бруто по вид на ставка; задршките и неоданочивите со нивниот износ`} />
      <Tabs k="st" />
      {rows.length ? <><div className="row"><ExportBar name={`Rekapitular_stavki_${year}`} title={`Рекапитулар по ставки и месеци ${year}`} rows={csvOf('Ставка', rows)} pdf="#stArea" landscape /></div>
        <MonthTable id="stArea" head="Ставка" rows={rows} /></> : <div className="card empty">Нема пресметани плати за {year}.</div>}
    </>
  );
}

/** Totals per организациона единица (employee `oe`): бруто, нето, придонеси + данок, by month. */
export async function OeReport({ runs, year, firmId }: { runs: Runs; year: number; firmId: string }) {
  const oeOf = new Map((await firmEmployees(firmId)).map((e) => [e.id, (e.oe ?? '').trim()]));
  const G = new Map<string, { key: string; label: string; m: Record<string, number> }>(), N = new Map<string, { key: string; label: string; m: Record<string, number> }>();
  const C = new Map<string, number>();
  for (const p of runs) for (const e of p.emps) {
    const T = empCalc(e, p.params).T, oe = oeOf.get(e.empId) || 'Без организациона единица', mm = p.month.slice(5, 7);
    for (const [mp, v] of [[G, T.gross + T.dopl], [N, T.net]] as const) {
      const o = mp.get(oe) ?? mp.set(oe, { key: oe, label: oe, m: {} }).get(oe)!;
      o.m[mm] = (o.m[mm] ?? 0) + v;
    }
    C.set(oe + '|' + mm, (C.get(oe + '|' + mm) ?? 0) + 1);
  }
  const sort = (m: Map<string, { key: string; label: string; m: Record<string, number> }>) => [...m.values()].sort((a, b) => a.label.localeCompare(b.label, 'mk'));
  const rG = sort(G).map((r) => ({ ...r, sub: `${Math.max(0, ...MM.map((x) => C.get(r.key + '|' + x) ?? 0))} вработени` })), rN = sort(N);
  return (
    <>
      <Hd t="Плати по организациони единици" sub={String(year)} />
      <Tabs k="oe" />
      {rG.length ? <>
        <div className="row"><ExportBar name={`Plati_po_OE_${year}`} title={`Плати по организациони единици ${year}`} rows={csvOf('Бруто – ОЕ', rG)} sheets={[{ name: 'Бруто', rows: csvOf('ОЕ', rG) }, { name: 'Нето', rows: csvOf('ОЕ', rN) }]} pdf="#oeArea" landscape /></div>
        <div id="oeArea"><h2>Бруто</h2><MonthTable id="oeG" head="Организациона единица" rows={rG} /><h2>Нето за исплата</h2><MonthTable id="oeN" head="Организациона единица" rows={rN} /></div>
        <p className="note">Организационата единица се внесува во податоците на вработениот (поле „ОЕ“).</p>
      </> : <div className="card empty">Нема пресметани плати за {year}.</div>}
    </>
  );
}

/**
 * „Кумулативна пресметка“ (Helix KumulativVrabOE / KumulativPoOE): per employee for the months `od`–`do`, grouped by
 * организациона единица with a subtotal each – часови, бруто, придонеси, данок, задршки, неоданочиви, нето за исплата.
 */
export async function KumReport({ runs, year, firmId, od, to }: { runs: Runs; year: number; firmId: string; od?: string; to?: string }) {
  const oeOf = new Map((await firmEmployees(firmId)).map((e) => [e.id, (e.oe ?? '').trim()]));
  const mo = (v: string | undefined, d: string) => (v && /^(0[1-9]|1[0-2])$/.test(v) ? v : d);
  let a = mo(od, '01'), b = mo(to, '12');
  if (a > b) [a, b] = [b, a];
  const COLS = [['h', 'Часови'], ['g', 'Бруто'], ['c', 'Придонеси'], ['t', 'Данок'], ['d', 'Задршки'], ['x', 'Неоданочиви'], ['n', 'Нето за исплата']] as const;
  type V = Record<(typeof COLS)[number][0], number>;
  const zero = (): V => ({ h: 0, g: 0, c: 0, t: 0, d: 0, x: 0, n: 0 });
  const E = new Map<string, { oe: string; no: string; name: string; embg: string; months: number; v: V }>();
  for (const p of runs) {
    const mm = p.month.slice(5, 7);
    if (mm < a || mm > b) continue;
    for (const e of p.emps) {
      const T = empCalc(e, p.params).T, k = e.empId || (e.no ?? '') + '|' + e.name;
      const o = E.get(k) ?? E.set(k, { oe: oeOf.get(e.empId) || 'Без организациона единица', no: e.no ?? '', name: e.name, embg: e.embg ?? '', months: 0, v: zero() }).get(k)!;
      o.months++;
      o.v.h += T.hours; o.v.g += T.gross + T.dopl; o.v.c += T.contr; o.v.t += T.tax; o.v.d += T.ded; o.v.x += T.nep; o.v.n += T.net;
    }
  }
  const rows = [...E.values()].sort((x, y) => x.oe.localeCompare(y.oe, 'mk') || x.no.localeCompare(y.no, 'mk', { numeric: true }) || x.name.localeCompare(y.name, 'mk'));
  const oes = [...new Set(rows.map((r) => r.oe))];
  const sum = (rs: typeof rows): V => rs.reduce((s, r) => { for (const [c] of COLS) s[c] += r.v[c]; return s; }, zero());
  const f = (c: string, v: number) => (c === 'h' ? fq(v) : fmt(v));
  const per = a === '01' && b === '12' ? String(year) : `${a}.${year} – ${b}.${year}`;
  const csv: Cell[][] = [['ОЕ', 'Шифра', 'Вработен', 'ЕМБГ', 'Месеци', ...COLS.map((c) => c[1])]];
  for (const oe of oes) {
    const rs = rows.filter((r) => r.oe === oe);
    for (const r of rs) csv.push([r.oe, r.no, r.name, r.embg, r.months, ...COLS.map(([c]) => r.v[c])]);
    if (oes.length > 1) csv.push([oe, '', 'Вкупно ОЕ', '', '', ...COLS.map(([c]) => sum(rs)[c])]);
  }
  csv.push(['', '', 'ВКУПНО', '', '', ...COLS.map(([c]) => sum(rows)[c])]);
  const sel = (n: string, v: string) => <select name={n} defaultValue={v} style={{ width: 'auto', minWidth: 70 }}>{MM.map((x) => <option key={x} value={x}>{x}</option>)}</select>;
  return (
    <>
      <Hd t="Кумулативна пресметка на плати" sub={`${per} · по вработен и организациона единица`} />
      <Tabs k="kum" />
      <form style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8, alignItems: 'center' }}>
        <input type="hidden" name="k" value="kum" />
        <span className="mini">Од месец</span>{sel('od', a)}<span className="mini">до</span>{sel('do', b)}<button className="btn sm">Прикажи</button>
      </form>
      {rows.length ? <>
        <div className="row"><ExportBar name={`Kumulativ_plati_${year}_${a}-${b}`} title={`Кумулативна пресметка на плати ${per}`} rows={csv} pdf="#kumArea" landscape /></div>
        <div className="tw" id="kumArea"><table className="dense">
          <thead><tr><th>Шифра</th><th>Вработен</th><th>ЕМБГ</th><th className="n">Месеци</th>{COLS.map(([c, l]) => <th key={c} className="n">{l}</th>)}</tr></thead>
          {oes.map((oe) => {
            const rs = rows.filter((r) => r.oe === oe), s = sum(rs);
            return (
              <tbody key={oe}>
                {oes.length > 1 && <tr><td colSpan={4 + COLS.length}><b>{oe}</b></td></tr>}
                {rs.map((r, i) => <tr key={i}><td>{r.no}</td><td>{r.name}</td><td>{r.embg}</td><td className="n">{r.months}</td>{COLS.map(([c]) => <td key={c} className="n">{f(c, r.v[c])}</td>)}</tr>)}
                {oes.length > 1 && <tr><td colSpan={4}><i>Вкупно {oe}</i></td>{COLS.map(([c]) => <td key={c} className="n"><i>{f(c, s[c])}</i></td>)}</tr>}
              </tbody>
            );
          })}
          <tfoot><tr><td colSpan={4}>ВКУПНО</td>{COLS.map(([c]) => <td key={c} className="n">{f(c, sum(rows)[c])}</td>)}</tr></tfoot>
        </table></div>
      </> : <div className="card empty">Нема пресметани плати за {per}.</div>}
    </>
  );
}

/** Sick leave per employee and month (hours, gross, on the ФЗО) and the ФЗО refund list of a month. */
export function BolReport({ runs, year, month }: { runs: Runs; year: number; month?: string }) {
  type L = { month: string; no: string; name: string; embg: string; type: string; hours: number; gross: number; fzo: boolean };
  const L: L[] = [];
  for (const p of runs) for (const e of p.emps) for (const r of empCalc(e, p.params).rows) {
    if ((r.cat || payCatOf(r.type)) !== 'bol' || !(r.hr || r.gr)) continue;
    L.push({ month: p.month, no: e.no ?? '', name: e.name, embg: e.embg ?? '', type: r.type, hours: r.hr, gross: r.gr, fzo: r.payer === 'ФЗО' || /ФЗО/.test(r.type) });
  }
  const H = new Map<string, { key: string; label: string; sub?: string; m: Record<string, number> }>();
  for (const l of L) {
    const k = l.no + '|' + l.name, o = H.get(k) ?? H.set(k, { key: k, label: `${l.no} ${l.name}`.trim(), m: {} }).get(k)!;
    const mm = l.month.slice(5, 7);
    o.m[mm] = (o.m[mm] ?? 0) + l.hours;
  }
  const rows = [...H.values()].sort((a, b) => a.label.localeCompare(b.label, 'mk'));
  const months = [...new Set(L.filter((l) => l.fzo).map((l) => l.month))].sort();
  const sel = month && months.includes(month) ? month : months[months.length - 1];
  const F = L.filter((l) => l.fzo && l.month === sel);
  return (
    <>
      <Hd t="Боледувања и рефундација од ФЗО" sub={String(year)} />
      <Tabs k="bol" />
      {rows.length ? <>
        <h2>Часови боледување по вработен и месец</h2>
        <div className="row"><ExportBar name={`Boleduvanja_${year}`} title={`Боледувања ${year}`} rows={[['Месец', 'Шифра', 'Вработен', 'ЕМБГ', 'Вид', 'Часови', 'Бруто', 'На товар на ФЗО'], ...L.map((l) => [l.month, l.no, l.name, l.embg, l.type, l.hours, l.gross, l.fzo ? 'да' : ''] as Cell[])]} pdf="#bolArea" landscape /></div>
        <MonthTable id="bolArea" head="Вработен" rows={rows} f={fq} />
      </> : <div className="card empty">Нема боледувања во платите за {year}.</div>}
      <div className="card">
        <h2>Барање за рефундација од ФЗО</h2>
        {months.length ? <>
          <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>{months.map((m) => <Link key={m} className={'btn sm' + (m === sel ? ' pri' : '')} href={`/payGod?k=bol&m=${m}`}>{m.slice(5, 7)}.{m.slice(0, 4)}</Link>)}
            <ExportBar name={`FZO_refundacija_${sel}`} title={`Рефундација на надоместок на плата од ФЗО – ${sel!.slice(5, 7)}.${sel!.slice(0, 4)}`} rows={[['Шифра', 'Вработен', 'ЕМБГ', 'Вид', 'Часови', 'Бруто надоместок'], ...F.map((l) => [l.no, l.name, l.embg, l.type, l.hours, l.gross] as Cell[]), ['Вкупно', '', '', '', F.reduce((a, l) => a + l.hours, 0), F.reduce((a, l) => a + l.gross, 0)]]} pdf="#fzoArea" /></div>
          <div className="tw" id="fzoArea"><table>
            <thead><tr><th>Шифра</th><th>Вработен</th><th>ЕМБГ</th><th>Вид</th><th className="n">Часови</th><th className="n">Бруто надоместок</th></tr></thead>
            <tbody>{F.map((l, i) => <tr key={i}><td>{l.no}</td><td>{l.name}</td><td>{l.embg}</td><td>{l.type}</td><td className="n">{fq(l.hours)}</td><td className="n">{fmt(l.gross)}</td></tr>)}</tbody>
            <tfoot><tr><td colSpan={4}>Вкупно за рефундација</td><td className="n">{fq(F.reduce((a, l) => a + l.hours, 0))}</td><td className="n">{fmt(F.reduce((a, l) => a + l.gross, 0))}</td></tr></tfoot>
          </table></div>
          <p className="note">Ставките на товар на ФЗО (боледување над 30 дена, бременост / нега на дете) – прилог кон барањето за рефундација (МПИН, вид на надоместок). Датум на печатење {dmy(new Date().toISOString().slice(0, 10))}.</p>
        </> : <p className="mini mut">Нема ставки на товар на ФЗО во {year}.</p>}
      </div>
    </>
  );
}
