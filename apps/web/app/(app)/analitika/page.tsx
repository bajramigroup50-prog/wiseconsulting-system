/**
 * Legacy `VIEWS.analitika` 12965 (final; first version 6415) — Финансово › Аналитика на партнери (ИОС): partner × konto
 * turnover on 12…/22…, search by name / EDB / code / city, konto and „само со салдо“ filters, CSV, card PDF, ИОС PDF
 * (one partner or all shown, `anIosAll`).
 */
import Link from 'next/link';
import { analyticsRows, filterAnalytics } from '@wise/core/finance';
import { effectiveChart } from '@wise/db';
import { booksPage } from '@/lib/books';
import { db } from '@/lib/db';
import { fmt } from '@/lib/fmt';
import { finLines, partnerMap, srchMatch } from '@/lib/finance';
import { Hd } from '@/components/hd';
import { NoFirm } from '@/components/no-firm';
import { DownloadCsv } from '@/components/download-csv';
import { ConfirmLink } from '@/components/parity-fin/confirm-link';
import { dmy } from '@/lib/fmt';

type SP = { q?: string; k?: string; bal?: string };

export default async function AnalitikaPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const { firm, year } = await booksPage('analitika');
  if (!firm) return <NoFirm t="Аналитика на партнери" />;
  const [lines, P, chart] = await Promise.all([finLines(firm.id, `${year}-01-01`, `${year}-12-31`, { accountRe: '^(12|22)' }), partnerMap(firm.id), effectiveChart(db(), firm.id)]);
  const kName = (k: string) => chart.find((a) => a.code === k)?.name ?? '';
  const all = analyticsRows(lines);
  const KS = [...new Set(all.map((r) => r.k))].sort();
  const F = { q: (sp.q ?? '').trim(), k: /^\d{1,10}$/.test(sp.k ?? '') ? sp.k! : '', bal: sp.bal === '1' };
  let rows = filterAnalytics(all, F);
  if (F.q) rows = rows.filter((r) => { const p = P.get(r.p); return srchMatch([p?.name, p?.edb, p?.code, p?.city].filter(Boolean).join(' '), F.q); });
  const pn = (id: string) => P.get(id)?.name ?? '';
  rows.sort((a, b) => pn(a.p).localeCompare(pn(b.p), 'mk') || a.k.localeCompare(b.k));
  const tot = rows.reduce((a, r) => ({ d: a.d + r.d, c: a.c + r.c }), { d: 0, c: 0 });
  const np = new Set(rows.map((r) => r.p)).size;
  const fq = new URLSearchParams(Object.entries({ q: F.q, k: F.k, bal: F.bal ? '1' : '' }).filter(([, v]) => v) as [string, string][]).toString();
  const pr = (doc: string, extra = '') => `/print/fin/${doc}?${fq}${fq && extra ? '&' : ''}${extra}`;
  return (
    <>
      <Hd t="Аналитика на партнери" sub="ИОС">
        <DownloadCsv name={`Analitika_${year}.csv`} label="CSV" rows={[['Партнер', 'ЕДБ', 'Конто', 'Должи', 'Побарува', 'Салдо'], ...rows.map((r) => [pn(r.p), P.get(r.p)?.edb ?? '', r.k, r.d, r.c, Math.round((r.d - r.c) * 100) / 100])]} />
        <a className="btn" href={pr('analitika')} target="_blank" rel="noopener">PDF преглед</a>
        <a className="btn" href={pr('pkartica')} target="_blank" rel="noopener">PDF картици ({np})</a>
        {/* legacy `anCsv` 7261: every partner line of the year */}
        <DownloadCsv name={`Analitika_stavki_${year}.csv`} label="CSV ставки" rows={[['Датум', 'Партнер', 'Конто', 'Документ', 'Должи', 'Побарува'],
          ...lines.filter((l) => l.partnerId).map((l) => [dmy(l.date), pn(l.partnerId!), l.account, [l.description, l.doc].filter(Boolean).join(' · '), l.debit, l.credit])]} />
        <Link className="btn" href="/kartici/potvrdi">📨 Потврди на салдо – сите</Link>
        <ConfirmLink className={`btn pri${np ? '' : ' disabled'}`} href={pr('ios')} ask={np > 30 ? `Да се направи ИОС за ${np} партнери во еден PDF? Ова може да трае.` : undefined}>ИОС PDF за сите прикажани ({np})</ConfirmLink>
      </Hd>
      <form className="card"><div className="row" style={{ gap: '10px 16px', alignItems: 'end', flexWrap: 'wrap' }}>
        <input name="q" placeholder="🔍 Барај партнер по име, ЕДБ, шифра, град…" defaultValue={F.q} style={{ width: 320 }} autoComplete="off" />
        <label className="mini">Конто <select name="k" defaultValue={F.k} style={{ width: 'auto' }}>
          <option value="">сите</option><option value="12">12.. купувачи</option><option value="22">22.. добавувачи</option>
          {KS.map((k) => <option key={k} value={k}>{k} {kName(k).slice(0, 40)}</option>)}
        </select></label>
        <label className="chk"><input type="checkbox" name="bal" value="1" defaultChecked={F.bal} /> само со салдо</label>
        <button className="btn">Прикажи</button>
        <span style={{ flex: 1 }} />
        <span className="mini">Прикажани: <b>{rows.length}</b> ставки · <b>{np}</b> партнери · салдо <b>{fmt(tot.d - tot.c)}</b></span>
        {(F.q || F.k || F.bal) && <Link className="btn sm" href="/analitika">✕ Исчисти</Link>}
      </div></form>
      {rows.length ? (
        <div className="tw"><table>
          <thead><tr><th>Партнер</th><th>Конто</th><th className="n">Должи</th><th className="n">Побарува</th><th className="n">Салдо</th><th /></tr></thead>
          <tbody>{rows.map((r) => (
            <tr key={r.p + r.k}>
              <td>{pn(r.p)}{P.get(r.p)?.edb && <><br /><small className="mut">ЕДБ {P.get(r.p)!.edb}</small></>}</td>
              <td>{r.k} {kName(r.k)}</td><td className="n">{fmt(r.d)}</td><td className="n">{fmt(r.c)}</td><td className="n">{fmt(r.d - r.c)}</td>
              <td className="row" style={{ flexWrap: 'nowrap' }}>
                <Link className="btn sm" href={`/kartici?k=12,22&pid=${r.p}`}>Картица</Link>
                <a className="btn sm" href={`/print/fin/pkartica?pid=${r.p}`} target="_blank" rel="noopener">Картица PDF</a>
                <a className="btn sm" href={`/print/fin/ios?pid=${r.p}`} target="_blank" rel="noopener">ИОС PDF</a>
              </td>
            </tr>
          ))}</tbody>
          <tfoot><tr><td colSpan={2}>Вкупно</td><td className="n">{fmt(tot.d)}</td><td className="n">{fmt(tot.c)}</td><td className="n">{fmt(tot.d - tot.c)}</td><td /></tr></tfoot>
        </table></div>
      ) : <div className="card empty">{all.length ? 'Нема партнер што одговара на пребарувањето.' : 'Сè уште нема промет со партнери.'}</div>}
    </>
  );
}
