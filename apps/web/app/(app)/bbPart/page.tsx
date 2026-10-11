/** Legacy `VIEWS.bbPart` 12024 — Бруто биланс: one konto broken down by partner (opening / turnover / total / saldo D-P), search, → card. */
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { trialBalance } from '@wise/core';
import { effectiveChart } from '@wise/db';
import { booksPage, inYearOr, partnerOptions } from '@/lib/books';
import { db } from '@/lib/db';
import { dmy, fmt } from '@/lib/fmt';
import { srchMatch } from '@/lib/finance';
import { aggregatedLines } from '@/lib/ledger-agg';
import { Hd } from '@/components/hd';
import { NoFirm } from '@/components/no-firm';

type SP = { k?: string; from?: string; to?: string; close?: string; q?: string; p?: string; wh?: string };
const F = ['od', 'op', 'td', 'tp', 'vd', 'vp'] as const;

export default async function BbPartPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const { firm, year } = await booksPage('bilanc');
  if (!firm) return <NoFirm t="Бруто биланс – по комитенти" />;
  if (!/^\d{1,10}$/.test(sp.k ?? '')) notFound();
  const k = sp.k!;
  const from = inYearOr(sp.from, year, `${year}-01-01`), to = inYearOr(sp.to, year, `${year}-12-31`);
  const [lines, chart, P] = await Promise.all([aggregatedLines(firm.id, from, to, sp.wh), effectiveChart(db(), firm.id), partnerOptions(firm.id)]);
  const pname = new Map(P.map((p) => [p.id, p.name]));
  // legacy `bbRows('a',…,S.bbP,k)`: the partner filter of the trial balance carries over
  const pf = sp.p && pname.has(sp.p) ? sp.p : null;
  const all = trialBalance(lines, { level: 'a', from, to, withClose: sp.close === '1', partnerId: pf, byPartnerOf: k, partnerName: (id) => pname.get(id) }).rows;
  const q = (sp.q ?? '').trim();
  const L = q ? all.filter((p) => srchMatch(p.name, q)) : all;
  const sum = (f: (typeof F)[number]) => all.reduce((s, r) => s + (+r[f] || 0), 0);
  const back = `/bilanc?from=${from}&to=${to}${sp.close === '1' ? '&close=1' : ''}&exp=${k}`;
  return (
    <>
      <Hd t={`${k} ${chart.find((a) => a.code === k)?.name ?? ''} – по комитенти`} sub={`${dmy(from)} – ${dmy(to)}`}>
        <Link className="btn" href={back}>← Бруто биланс</Link>
        <Link className="btn" href={`/kkart?k=${k}&from=${from}&to=${to}&back=bbPart`}>Картица за целото конто</Link>
      </Hd>
      <form className="row" style={{ gap: 8, marginBottom: 8, alignItems: 'center' }}>
        <input type="hidden" name="k" value={k} /><input type="hidden" name="from" value={from} /><input type="hidden" name="to" value={to} />
        {sp.close === '1' && <input type="hidden" name="close" value="1" />}
        <input name="q" placeholder="🔍 Барај комитент…" defaultValue={q} style={{ maxWidth: 300 }} />
        <button className="btn">Барај</button>
        <span className="mini">{all.length} комитенти · кликнете на комитент за аналитичка картица</span>
      </form>
      <div className="tw"><table className="dense">
        <thead><tr><th>Комитент</th><th className="n">Поч. Д</th><th className="n">Поч. П</th><th className="n">Промет Д</th><th className="n">Промет П</th><th className="n">Вкупно Д</th><th className="n">Вкупно П</th><th className="n">Салдо Д</th><th className="n">Салдо П</th></tr></thead>
        <tbody>{L.length ? L.map((p) => (
          <tr key={p.k || '-'}>
            <td><Link href={`/kkart?k=${k}&from=${from}&to=${to}&p=${p.k || "none"}&back=bbPart`}><b>{p.name}</b></Link></td>
            {F.map((f) => <td key={f} className="n">{p[f] ? fmt(p[f]) : ''}</td>)}
            <td className="n">{p.s > 0 ? fmt(p.s) : ''}</td><td className="n">{p.s < 0 ? fmt(-p.s) : ''}</td>
          </tr>
        )) : <tr><td colSpan={9} className="note">Нема.</td></tr>}</tbody>
        <tfoot><tr><td><b>Вкупно {k}</b></td>{F.map((f) => <td key={f} className="n"><b>{fmt(sum(f))}</b></td>)}
          <td className="n"><b>{fmt(all.reduce((s, r) => s + Math.max(0, r.s), 0))}</b></td><td className="n"><b>{fmt(all.reduce((s, r) => s + Math.max(0, -r.s), 0))}</b></td></tr></tfoot>
      </table></div>
    </>
  );
}
