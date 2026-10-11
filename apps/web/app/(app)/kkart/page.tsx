/** Legacy `VIEWS.kkart` 6686 — Финансово › Аналитичка картица по конто (data `kkData` 6679, table `kkTable` 12823, `kkPdf` 7973, `kkXlsx` 12828). */
import Link from 'next/link';
import { booksPage } from '@/lib/books';
import { fmt } from '@/lib/fmt';
import { Hd } from '@/components/hd';
import { NoFirm } from '@/components/no-firm';
import { ExportBar } from '@/components/parity-fin/export-bar';
import { kkData, type KkSP } from './data';
import { KkTable, kkRows } from './table';

export default async function KkartPage({ searchParams }: { searchParams: Promise<KkSP & { back?: string }> }) {
  const sp = await searchParams;
  const { firm, year } = await booksPage('kkart');
  if (!firm) return <NoFirm t="Аналитичка картица по конто" />;
  const d = await kkData(firm.id, year, sp);
  const { k, sub, from, to, pf, noPartner, X, name, subT, chart, P } = d;
  const qs = new URLSearchParams(Object.entries({ k, sub: sub ? '1' : '', p: pf ?? (noPartner ? 'none' : ''), from, to }).filter(([, v]) => v)).toString();
  // legacy `kkBack`: back to the screen the card was opened from
  const back = sp.back === 'bbPart' ? { href: `/bbPart?k=${k}&from=${from}&to=${to}`, t: '← По комитенти' } : { href: `/bilanc?from=${from}&to=${to}`, t: '← Бруто биланс' };

  return (
    <>
      <Hd t="Аналитичка картица по конто" sub={`${k} ${name}${subT}`} exp={false}>
        <Link className="btn" href={back.href}>{back.t}</Link>
        <a className="btn" href={`/print/kkart?${qs}`} target="_blank" rel="noopener">PDF</a>
        <ExportBar pdf={false} name={`Kartica_${k}_${from}_${to}`} title={`Картица ${k}`} rows={kkRows(d)} />
      </Hd>
      <form className="card"><div className="row" style={{ gap: 12, alignItems: 'end' }}>
        <label className="f" style={{ width: 260 }}>Конто<input name="k" list="kkL" defaultValue={k} /></label>
        <datalist id="kkL">{chart.map((a) => <option key={a.code} value={a.code}>{a.name}</option>)}</datalist>
        <label className="chk"><input type="checkbox" name="sub" value="1" defaultChecked={sub} /> со подконта (сите што почнуваат со {k})</label>
        <label className="f">Комитент
          <select name="p" defaultValue={pf ?? (noPartner ? 'none' : '')} style={{ width: 230 }}>
            <option value="">сите</option><option value="none">без комитент</option>
            {P.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </label>
        <label className="f">Од<input type="date" name="from" defaultValue={from} /></label>
        <label className="f">До<input type="date" name="to" defaultValue={to} /></label>
        <button className="btn pri">Прикажи</button>
      </div></form>
      {sp.p && sp.p !== 'none' && !pf && <div className="callout warn">Комитентот не е најден.</div>}
      <div className="tiles">
        <div className="tile"><span className="k">Почетно салдо</span><b className="v num">{fmt(X.opening)}</b></div>
        <div className="tile"><span className="k">Должи</span><b className="v num">{fmt(X.debit)}</b></div>
        <div className="tile"><span className="k">Побарува</span><b className="v num">{fmt(X.credit)}</b></div>
        <div className="tile"><span className="k">Салдо</span><b className="v num">{fmt(X.closing)}</b><i>{X.closing >= 0 ? 'должно салдо' : 'побарувачко салдо'}</i></div>
      </div>
      <div className="tw"><KkTable d={d} /></div>
    </>
  );
}
