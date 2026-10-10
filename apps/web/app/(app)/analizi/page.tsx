/**
 * Legacy `VIEWS.analizi` 5297 — Анализи › Анализи и извештаи: six tabs (sales, products & stock, partners, cash
 * forecast, financial ratios, time & season) computed live from documents, stock and the ledger
 * (`@wise/core/analysis`, tabs in `body.tsx`). Tab / period are URL parameters (`?t=` / `?p=`) instead of
 * `S.anTab` / `S.anPer`; „Excel“ downloads each table as CSV (legacy `anXlsx`); „PDF“ is legacy `anPdf` (the tab,
 * landscape, `/print/analizi`) plus one report with all six tabs.
 */
import Link from 'next/link';
import { AN_PER, AN_TABS, anRange } from '@wise/core/analysis';
import { booksPage } from '@/lib/books';
import { dmy } from '@/lib/fmt';
import { todayIso } from '@/lib/stock';
import { Hd } from '@/components/hd';
import { NoFirm } from '@/components/no-firm';
import { AnBody } from './body';

export default async function AnaliziPage({ searchParams }: { searchParams: Promise<{ t?: string; p?: string }> }) {
  const sp = await searchParams;
  const { firm, year } = await booksPage('analizi');
  if (!firm) return <NoFirm t="Анализи и извештаи" />;
  const tab = AN_TABS.some(([k]) => k === sp.t) ? sp.t! : 'sales';
  const per = AN_PER.some(([k]) => k === sp.p) ? sp.p! : 'ytd';
  const today = todayIso();
  const r = anRange(per, year, today);
  const href = (t: string, p = per) => `/analizi?t=${t}&p=${p}`;
  const body = await AnBody({ firm, year, tab, per, today });

  return (
    <>
      <Hd t="Анализи и извештаи" sub="податоци во реално време од книжењата" exp={false}>
        <a className="btn" href={'/print/analizi?t=' + tab + '&p=' + per} target="_blank" rel="noopener">PDF</a>
        <a className="btn" href={'/print/analizi?t=all&p=' + per} target="_blank" rel="noopener" title="Сите шест анализи во еден извештај">PDF – сите анализи</a>
      </Hd>
      <div className="antabs" role="tablist">
        {AN_TABS.map(([k, t]) => <Link key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} href={href(k)}
          style={{ all: 'unset', cursor: 'pointer', padding: '9px 14px', fontWeight: tab === k ? 600 : 500, color: tab === k ? 'var(--ink)' : 'var(--muted)', borderBottom: `2px solid ${tab === k ? 'var(--accent)' : 'transparent'}`, marginBottom: -1 }}>{t}</Link>)}
      </div>
      {!['cash', 'kpi', 'time'].includes(tab) && (
        <div className="dfilter"><span className="mini">Период:</span>
          {AN_PER.map(([k, t]) => <Link key={k} className={`chip ${per === k ? 'on' : ''}`} href={href(tab, k)}>{t}</Link>)}
          <span className="mini" style={{ marginLeft: 'auto' }}>{r.lab} · {dmy(r.from)} – {dmy(r.to)}</span>
        </div>
      )}
      <div id="anBody">{body}</div>
    </>
  );
}

