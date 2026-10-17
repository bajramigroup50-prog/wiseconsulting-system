/**
 * Print view of the trial balance, landscape (legacy `ACT.bilPdf` 7267 → `ph()` + `bbTable(R,lvl,true)` + `sig()`); also a
 * PKG_REP report (`bba`/`bb3`). For the analytic level the legacy v423 layout (`bbo` 13653): Почетна состојба (net),
 * Само од тековна година Д/П, Вкупно Д/П, Крајно салдо, Комитент — partner rows for the kontos of the firm setting
 * `bbAnK` (default „0 1620 2620 1200 2200 7414“) with „Сумарно за …“, then Синтетика / Група / Класа / ВКУПНО.
 */
import { Fragment } from 'react';
import { CLS, trialBalance, type TbRow } from '@wise/core';
import { effectiveChart } from '@wise/db';
import { inYearOr, partnerOptions } from '@/lib/books';
import { db } from '@/lib/db';
import { dmy, fmt } from '@/lib/fmt';
import { aggregatedLines } from '@/lib/ledger-agg';
import { FirmHead, Sig } from '../firm-head';
import { printGuard } from '../guard';
import { bbAnKOf } from '@/lib/parity-fin';
import { BB_TABS, bbFilterLines, bbFilterOf, bbTab, bbView } from '@/lib/bb-filter';

export const metadata = { title: 'Бруто биланс' };

/**
 * Also the old program's „Бруто биланс – рекапитулар“ options: `pre` / `suf` / `kf` / `kt` (Префикс, Суфикс, Од – До конто),
 * `lvl=v` (Вкупно: class totals only), `nocur=1` (без колона „Само од тековна година“), `short=1` (Скратено печатење:
 * конто, назив, вкупно должи / побарува, салдо), `or=p` portrait (default landscape).
 */
type SP = { lvl?: string; from?: string; to?: string; q?: string; p?: string; close?: string; wh?: string; kom?: string; pre?: string; suf?: string; kf?: string; kt?: string; nocur?: string; short?: string; or?: string };
const F = ['vd', 'vp', 'od', 'op', 'td', 'tp'] as const;
const BBO_CSS = `table.bbo{table-layout:fixed!important;width:100%!important;border-collapse:collapse!important;border:1.5px solid #000!important;font-family:Arial,Helvetica,sans-serif!important;font-size:7.6pt!important;margin:0!important}
table.bbo th,table.bbo td{border:0.6pt solid #555!important;padding:2px 4px!important;vertical-align:middle!important;line-height:1.25!important;background:#fff!important;color:#000!important;font-size:7.6pt!important;font-family:Arial,Helvetica,sans-serif!important;overflow:hidden;word-break:break-word}
table.bbo th{background:#e6e6e6!important;font-weight:700!important;text-align:center!important;font-size:7.4pt!important}
table.bbo td.k{text-align:left!important;white-space:nowrap!important}
table.bbo td.o{text-align:left!important;text-transform:uppercase}
table.bbo td.n{text-align:right!important;white-space:nowrap!important}
table.bbo td.c{text-align:left!important;text-transform:uppercase;font-size:7pt!important}
table.bbo tr.s0 td{background:#f4f4f4!important;font-weight:700!important}
table.bbo tr.s1 td{background:#e9e9e9!important;font-weight:700!important;border-top:1pt solid #000!important}
table.bbo tr.s2 td{background:#dcdcdc!important;font-weight:700!important;border-top:1pt solid #000!important}
table.bbo tr.s3 td{background:#cfcfcf!important;font-weight:700!important;border-top:1.4pt solid #000!important;border-bottom:1.4pt solid #000!important}
table.bbo tr.s4 td{background:#bdbdbd!important;font-weight:700!important;border-top:2pt solid #000!important}
table.bbo tr{page-break-inside:avoid}`;


export default async function PrintBilanc({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const { firm, year } = await printGuard('bilanc');
  const tab = bbTab(sp.lvl);
  const lvl = tab === 'v' ? 'a' : tab;
  const lvlName = BB_TABS.find(([v]) => v === tab)![1];
  const flt = bbFilterOf(sp);
  const noCur = sp.nocur === '1', short = sp.short === '1';
  const page = `@page{size:A4 ${sp.or === 'p' ? 'portrait' : 'landscape'}}`;
  const pdoc = sp.or === 'p' ? 'pdfdoc' : 'pdfdoc land';
  const from = inYearOr(sp.from, year, `${year}-01-01`), to = inYearOr(sp.to, year, `${year}-12-31`);
  const [all, chart, P] = await Promise.all([aggregatedLines(firm.id, from, to, sp.wh), effectiveChart(db(), firm.id), partnerOptions(firm.id)]);
  const lines = bbFilterLines(all, flt);
  const names = new Map(chart.map((a) => [a.code, a.name]));
  const pf = sp.p && /^[0-9a-f-]{36}$/i.test(sp.p) ? sp.p : null;
  const withClose = sp.close === '1';
  const q = (sp.q ?? '').trim();
  const V = bbView(lines, { tab, from, to, withClose, partnerId: pf, f: { pre: '', suf: '', kf: '', kt: '' }, q, accountName: (k) => names.get(k) });
  const R = V.rows;
  const FF = short ? (['vd', 'vp'] as const) : noCur ? F.filter((f) => f !== 'td' && f !== 'tp') : F;
  const cells = (r: Omit<TbRow, 'k' | 'name'>) => short
    ? <>{FF.map((f) => <td className="n" key={f}>{fmt(r[f])}</td>)}<td className="n"><b>{fmt(r.s)}</b></td></>
    : <><td className="n"><b>{fmt(r.s)}</b></td>{FF.map((f) => <td className="n" key={f}>{fmt(r[f])}</td>)}</>;
  const par = [flt.pre && 'префикс ' + flt.pre, flt.suf && 'суфикс ' + flt.suf, (flt.kf || flt.kt) && `конта ${flt.kf || '…'} – ${flt.kt || '…'}`, q && 'филтер: ' + q].filter(Boolean).join(' · ');
  const head = <FirmHead firm={firm} title={`БРУТО БИЛАНС – ${lvlName.toUpperCase()}${short ? ' (скратено)' : ''}`} sub={`Период ${dmy(from)} – ${dmy(to)}${par ? ' · ' + par : ''}`} />;

  if (tab === 'a' && !short) {
    // `kom=0`: every konto without the partner breakdown („🖨 Само конта“)
    const anK = sp.kom === '0' ? [] : bbAnKOf(firm.settings);
    const withP = new Set(lines.filter((l) => l.partnerId).map((l) => l.account));
    const pm = new Map(P.map((p) => [p.id, (p.code ? p.code + ' ' : '') + p.name]));
    const agg = (rows: Omit<TbRow, 'k' | 'name'>[]) => {
      const t = { od: 0, op: 0, td: 0, tp: 0, vd: 0, vp: 0 };
      for (const r of rows) for (const f of Object.keys(t) as (keyof typeof t)[]) t[f] += +r[f] || 0;
      return { ...t, ps: t.od - t.op, s: t.vd - t.vp };
    };
    const det = (k: string, name: string, r: Omit<TbRow, 'k' | 'name'>, kom: string, key: string) => (
      <tr key={key}><td className="k">{k}</td><td className="o">{name}</td><td className="n">{fmt(r.od - r.op)}</td><td className="n tc">{fmt(r.td)}</td><td className="n tc">{fmt(r.tp)}</td>
        <td className="n">{fmt(r.vd)}</td><td className="n">{fmt(r.vp)}</td><td className="n">{fmt(r.s)}</td><td className="c">{kom}</td></tr>
    );
    const sumRow = (label: string, t: ReturnType<typeof agg>, lv: number, key: string) => (
      <tr key={key} className={'s' + lv}><td className="k" colSpan={2}>{label}</td><td className="n">{fmt(t.ps)}</td><td className="n tc">{lv === 0 ? fmt(t.td) : ''}</td><td className="n tc">{lv === 0 ? fmt(t.tp) : ''}</td>
        <td className="n">{fmt(t.vd)}</td><td className="n">{fmt(t.vp)}</td><td className="n">{fmt(t.s)}</td><td /></tr>
    );
    const body: React.ReactNode[] = [];
    for (const c of [...new Set(R.map((r) => r.k[0]!))].sort()) {
      const rc = R.filter((r) => r.k[0] === c);
      for (const g of [...new Set(rc.map((r) => r.k.slice(0, 2)))].sort()) {
        const rg = rc.filter((r) => r.k.startsWith(g));
        for (const s of [...new Set(rg.map((r) => r.k.slice(0, 3)))].sort()) {
          const rs = rg.filter((r) => r.k.startsWith(s));
          for (const r of rs) {
            const Pr = anK.some((p) => r.k.startsWith(p)) && withP.has(r.k)
              ? trialBalance(lines, { level: 'a', from, to, withClose, partnerId: pf, byPartnerOf: r.k, partnerName: (id) => pm.get(id) }).rows : [];
            if (Pr.length && (Pr.length > 1 || Pr[0]!.k)) {
              Pr.forEach((p, i) => body.push(det(r.k, r.name, p, p.k ? pm.get(p.k) ?? p.name : '(без комитент)', r.k + ':' + i)));
              body.push(sumRow('Сумарно за ' + r.k, agg([r]), 0, 'S' + r.k));
            } else body.push(det(r.k, r.name, r, '', r.k));
          }
          body.push(sumRow('Синтетика ' + s, agg(rs), 1, 's' + s));
        }
        body.push(sumRow('Група ' + g, agg(rg), 2, 'g' + g));
      }
      body.push(sumRow('Класа ' + c, agg(rc), 3, 'c' + c));
    }
    body.push(sumRow('ВКУПНО', agg(R), 4, 'T'));
    return (
      <div className={pdoc}>
        <style dangerouslySetInnerHTML={{ __html: page + BBO_CSS + (noCur ? 'table.bbo .tc{display:none}' : '') }} />
        {head}
        <table className="bbo">
          <colgroup>{(noCur ? ['8%', '27%', '10%', '10%', '10%', '10%', '25%'] : ['7%', '21%', '9%', '9%', '9%', '9%', '9%', '9%', '18%']).map((w, i) => <col key={i} style={{ width: w }} />)}</colgroup>
          <thead>
            <tr><th rowSpan={2}>Конто</th><th rowSpan={2}>Опис</th><th rowSpan={2}>Почетна<br />состојба</th>{!noCur && <th colSpan={2}>Само од тековна година</th>}<th colSpan={2}>Вкупно од тековна година</th><th rowSpan={2}>Крајно<br />салдо</th><th rowSpan={2}>Комитент</th></tr>
            <tr>{!noCur && <><th>Должи</th><th>Побарува</th></>}<th>Должи</th><th>Побарува</th></tr>
          </thead>
          <tbody>{body}</tbody>
        </table>
        <Sig />
      </div>
    );
  }

  const H = short ? ['Вк. должи', 'Вк. побарува', 'Салдо']
    : ['Салдо', 'Вк. должи', 'Вк. побарува', 'Поч. сост. должи', 'Поч. сост. побарува', ...(noCur ? [] : ['Должи од тек. година', 'Побарува од тек. година'])];
  const cols = 2 + H.length;
  return (
    <div className={pdoc}>
      <style dangerouslySetInnerHTML={{ __html: page }} />
      {head}
      <table>
        <thead><tr><th>Конто</th><th>Назив</th>{H.map((h) => <th key={h} className="n">{h}</th>)}</tr></thead>
        <tbody>
          {V.classes.map(({ c, rows, total }) => (
            <Fragment key={c}>
              {lvl !== '1' && tab !== 'v' && <tr className="sub"><td colSpan={cols}>Класа {CLS[+c as 0]}</td></tr>}
              {tab !== 'v' && rows.map((r) => <tr key={r.k}><td>{r.k}</td><td>{r.name}</td>{cells(r)}</tr>)}
              {lvl !== '1' && <tr className="tot"><td colSpan={2}>{tab === 'v' ? `Класа ${CLS[+c as 0]}` : `Вкупно класа ${c}`}</td>{cells(total)}</tr>}
            </Fragment>
          ))}
        </tbody>
        <tfoot><tr><td colSpan={2}>ВКУПНО</td>{cells(V.total)}</tr></tfoot>
      </table>
      <Sig />
    </div>
  );
}
