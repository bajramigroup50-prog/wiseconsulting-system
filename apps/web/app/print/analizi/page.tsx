/**
 * Legacy `ACT.anPdf` 5351: „Анализи и извештаи“ as a landscape PDF — the tab `?t=` with the period `?p=` (title
 * „АНАЛИЗА: <ТАБ>“, sub „<година> · <датум>“), or `?t=all` = every tab in one report, a page each.
 */
import { AN_PER, AN_TABS, anRange } from '@wise/core/analysis';
import { dmy } from '@/lib/fmt';
import { todayIso } from '@/lib/stock';
import { AnBody } from '../../(app)/analizi/body';
import { FirmHead } from '../firm-head';
import { printGuard } from '../guard';

export const metadata = { title: 'Анализа' };

const CSS = '.pdfdoc button{display:none!important}.pdfdoc .tiles{display:grid;grid-template-columns:repeat(4,1fr);gap:8px}.pdfdoc .cols{display:grid;grid-template-columns:1fr 1fr;gap:10px}.pdfdoc .card{break-inside:avoid}';

export default async function AnalizaPrint({ searchParams }: { searchParams: Promise<{ t?: string; p?: string }> }) {
  const sp = await searchParams;
  const { firm, year } = await printGuard('analizi');
  const per = AN_PER.some(([k]) => k === sp.p) ? sp.p! : 'ytd';
  const today = todayIso();
  const tabs = sp.t === 'all' ? AN_TABS : AN_TABS.filter(([k]) => k === sp.t).slice(0, 1);
  const T = tabs.length ? tabs : AN_TABS.slice(0, 1);
  const r = anRange(per, year, today);
  const bodies = await Promise.all(T.map(([k]) => AnBody({ firm, year, tab: k, per, today })));
  return (
    <div className="pdfdoc land">
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      {T.map(([k, t], i) => (
        <div key={k}>
          {i > 0 && <div className="pb" style={{ breakBefore: 'page' }} />}
          <FirmHead firm={firm} title={'АНАЛИЗА: ' + t.toUpperCase()}
            sub={`${year} · ${dmy(today)}${['cash', 'kpi', 'time'].includes(k) ? '' : ` · ${r.lab}: ${dmy(r.from)} – ${dmy(r.to)}`}`} />
          {bodies[i]}
        </div>
      ))}
    </div>
  );
}
