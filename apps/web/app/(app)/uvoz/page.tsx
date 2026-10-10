/**
 * Увоз од Excel / CSV / XML — legacy `VIEWS.uvoz` 5413 (+ back button 17228, file button 17231), `IMP_T`, `impExec`,
 * `impTpl`; plus the stock-list imports legacy ran from the lager lists (`lagImport` / `lagImpGo` 4949 / 7926):
 * receipts into a location, counts and new retail prices → levelling (types `in`, `pop`, `nivel`).
 */
import Link from 'next/link';
import { IMP_T, type ImpType } from '@wise/core/retail/import';
import { booksPage, canDo } from '@/lib/books';
import { locationOptions } from '@/lib/sales';
import { todayIso } from '@/lib/stock';
import { Hd } from '@/components/hd';
import { NoFirm } from '@/components/no-firm';
import { Importer } from './importer';

const MAIN: ImpType[] = ['partners', 'items', 'employees', 'purchases', 'invoices', 'stock', 'journal'];

export default async function UvozPage({ searchParams }: { searchParams: Promise<{ t?: string; wh?: string; back?: string }> }) {
  const sp = await searchParams;
  const { u, firm, year } = await booksPage('uvoz');
  if (!firm) return <NoFirm t="Увоз од Excel / CSV / XML" />;
  const t = (sp.t && sp.t in IMP_T ? sp.t : 'partners') as ImpType;
  const write = canDo(u, 'impRun', firm.id);
  const locs = [{ id: 'main', name: 'Главен магацин', kind: 'warehouse' }, ...(await locationOptions(firm.id)).map((l) => ({ id: l.id, name: l.name, kind: l.kind }))];
  const back = sp.back === 'uvozMalo' || sp.back === 'uvozMat' ? sp.back : '';
  const today = todayIso();
  const q = (x: string) => `/uvoz?t=${x}${sp.wh ? '&wh=' + sp.wh : ''}${back ? '&back=' + back : ''}`;
  return (
    <>
      <Hd t="Увоз од Excel / CSV / XML" sub="масовно внесување податоци" />
      {back && <Link className="btn sm" href={'/' + back} style={{ margin: '4px 0 8px' }}>← назад кон {back === 'uvozMalo' ? 'Малопродажба' : 'Материјално'} · увоз</Link>}
      <div className="card">
        <div className="dfilter">{[...MAIN, ...(MAIN.includes(t) ? [] : [t])].map((k) => <Link key={k} className={`chip ${t === k ? 'on' : ''}`} href={q(k)}>{IMP_T[k].t}</Link>)}</div>
        <p className="note" style={{ margin: '8px 0 0' }}>{IMP_T[t].note}</p>
        <p className="note" style={{ margin: '4px 0 0' }}>Електронски фактури (UBL XML од е-Фактура) се внесуваат директно во <b>Влез</b> или <b>Масовно внесување</b> – без читање, со точни износи.</p>
      </div>
      {write ? <Importer key={t} t={t} locs={locs} date0={today.startsWith(String(year)) ? today : `${year}-01-01`} wh0={locs.some((l) => l.id === sp.wh) ? sp.wh! : t === 'nivel' ? locs.find((l) => l.kind === 'store')?.id ?? '' : 'main'} />
        : <div className="card empty">Немате право за увоз.</div>}
    </>
  );
}
