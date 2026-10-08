/**
 * Legacy `VIEWS.ddvKnigi` 8901 — Финансово › Книги за ДДВ (влезни / излезни фактури):
 * output book (`dkOut` → `vatBookOut`) and input book (`dkIn` → `vatBookIn`), reconciliation with ДДВ-04
 * (`dkCheck`), Excel/CSV export (`dkCsv`) and print (`dkPdf` → `/print/ddvKnigi`).
 */
import Link from 'next/link';
import { booksPage } from '@/lib/books';
import { dmy, fmt } from '@/lib/fmt';
import { VAT_SOURCE_NOTE } from '@/lib/vat-source';
import { bookColumns, bookPeriodOptions, bookTitle, defaultBookSel, loadVatBook, validBookSel, type BookKind } from '@/lib/vat-view';
import { Hd } from '@/components/hd';
import { NoFirm } from '@/components/no-firm';
import { DownloadCsv } from '@/components/download-csv';
import { DownloadXlsx } from '../ddv/download-xlsx';
import { BookTable, bookExportRows } from './book-table';

type SP = { t?: string; sel?: string };

export default async function DdvKnigiPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const { firm, year } = await booksPage('ddvKnigi');
  if (!firm) return <NoFirm t="Книги за ДДВ" />;
  const t: BookKind = sp.t === 'in' ? 'in' : 'out';
  const sel = validBookSel(sp.sel) ? sp.sel : defaultBookSel(firm);
  const B = await loadVatBook(firm, year, t, sel);
  const file = `${t === 'out' ? 'Kniga_izlezni_fakturi_' : 'Kniga_vlezni_fakturi_'}${B.from}_${B.to}`;
  const C = bookColumns(t);
  const colName = new Map<string, string>(C.map(([k, n]) => [k, n]));
  const rows = bookExportRows(B);
  return (
    <>
      <Hd t="Книги за ДДВ" sub={`${bookTitle(t)} · ${dmy(B.from)} – ${dmy(B.to)}`}>
        <DownloadXlsx name={file + '.xlsx'} sheets={[{ name: t === 'out' ? 'Излезни' : 'Влезни', rows }]} label="Excel" />
        <DownloadCsv name={file + '.csv'} rows={rows} label="CSV" />
        <a className="btn pri" href={`/print/ddvKnigi?t=${t}&sel=${sel}`} target="_blank" rel="noreferrer">PDF</a>
      </Hd>
      <div className="card">
        <form className="row" style={{ gap: '10px 16px', alignItems: 'center', flexWrap: 'wrap' }}>
          <Link className={`btn sm ${t === 'out' ? 'pri' : ''}`} href={`/ddvKnigi?t=out&sel=${sel}`}>Излезни фактури</Link>
          <Link className={`btn sm ${t === 'in' ? 'pri' : ''}`} href={`/ddvKnigi?t=in&sel=${sel}`}>Влезни фактури</Link>
          <input type="hidden" name="t" value={t} />
          <label className="mini">Период{' '}
            <select name="sel" defaultValue={sel} style={{ width: 'auto' }}>
              {bookPeriodOptions(year).map(([v, n]) => <option key={v} value={v}>{n}</option>)}
            </select>
          </label>
          <button className="btn sm">Прикажи</button>
          {B.check && (B.check.length
            ? <span className="pill bad" title={B.check.map((c) => `${colName.get(c.k) ?? c.k}: книга ${fmt(c.book)} / ДДВ-04 ${fmt(c.ddv)}`).join('\n')}>⚠ разлика со ДДВ-04 ({B.check.length})</span>
            : <span className="pill good">✓ се совпаѓа со ДДВ-04</span>)}
        </form>
      </div>
      {B.origin === 'ledger' && <div className="callout">{VAT_SOURCE_NOTE} Во книгата секој налог со ДДВ е еден ред; бројот е бројот на налогот.</div>}
      <div className="tw"><BookTable B={B} /></div>
      <p className="note">{t === 'out'
        ? 'Сите излезни фактури, одобренија (со минус), авансни фактури и дневните извештаи од каса, по датум на документот. Збировите по стапки се исти како полињата за промет и ДДВ во ДДВ-04.'
        : 'Сите влезни фактури, увоз (царина), фискални сметки од благајна со право на одбивка и повратници / одобренија од добавувачи (со минус). „Без право на одбивка“ = фактури без ДДВ или со неодбитлив ДДВ.'}</p>
    </>
  );
}
