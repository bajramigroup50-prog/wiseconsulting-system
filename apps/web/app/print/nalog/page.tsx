/**
 * Print view of one nalog (legacy `ACT.nalogPdf` 7346 → `nalogPdfZ` 3561): firm head, „Финансов налог број“,
 * columns Бр. · Датум · Изв. Бр · КОНТО · Должи · Побарува · Комитент · Содржина · Док. + забелешка, totals,
 * signatures Книжел / Контролирал / Одговорно лице. `?n=<number>`.
 */
import { notFound } from 'next/navigation';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { journalLines, journals, partners } from '@wise/db';
import { db } from '@/lib/db';
import { fmt } from '@/lib/fmt';
import { FirmHead, Sig } from '../firm-head';
import { printGuard } from '../guard';

export const metadata = { title: 'Налог за книжење' };

const CSS = `.nz{font-family:Arial,Helvetica,sans-serif;color:#000}.nz table{width:100%;border-collapse:collapse;font-size:9.5px}.nz th{border:1px solid #000;padding:2px 3px;font-weight:700;background:#fff;color:#000;text-transform:none;letter-spacing:0;font-size:9.5px;text-align:center}.nz td{border-left:1px solid #000;border-right:1px solid #000;border-bottom:1px dotted #999;padding:1px 3px;vertical-align:top;white-space:nowrap}.nz td.n{text-align:right;font-family:Arial,sans-serif}.nz tfoot td{border:1px solid #000;font-weight:700;background:#f2f2f2}.nz .hd2{display:flex;justify-content:space-between;align-items:flex-end;gap:12px;margin:14px 0 4px}.nz .hd2>div:first-child{white-space:nowrap}.nz .t1{font-size:17px;font-weight:700}.nz .t2{font-size:17px;font-weight:700;text-align:center}.nz .sm{font-size:11px}.nz .fh+.ph{display:none}`;
const d8 = (d?: string | null) => (d ? String(d).slice(0, 10).split('-').reverse().join('/') : '');

/** Legacy `cont()`: the description in capitals without the trailing „од dd.mm.yyyy“. */
const nalogContent = (s: string) => s.toUpperCase().replace(/\s+ОД\s+\d{2}\.\d{2}\.\d{4}.*$/, '').replace(/БР\.\s*/, 'БР ');

export default async function PrintNalog({ searchParams }: { searchParams: Promise<{ n?: string }> }) {
  const { n } = await searchParams;
  const { firm, year } = await printGuard('nalozi');
  if (!n) notFound();
  const J = await db().select().from(journals)
    .where(and(eq(journals.firmId, firm.id), eq(journals.number, n), sql`${journals.date} between ${`${year}-01-01`} and ${`${year}-12-31`}`))
    .orderBy(asc(journals.date), asc(journals.createdAt));
  if (!J.length) notFound();
  const L = await db().select({ l: journalLines, j: { date: journals.date, description: journals.description, kind: journals.kind, meta: journals.meta }, p: { code: partners.code, name: partners.name } })
    .from(journalLines).innerJoin(journals, eq(journals.id, journalLines.journalId)).leftJoin(partners, eq(partners.id, journalLines.partnerId))
    .where(inArray(journalLines.journalId, J.map((j) => j.id))).orderBy(asc(journals.date), asc(journals.createdAt), asc(journalLines.lineNo));
  const D = L.reduce((s, x) => s + Number(x.l.debit), 0), P = L.reduce((s, x) => s + Number(x.l.credit), 0);
  const date = J.map((j) => j.date).sort().at(-1)!;
  const label = J.length === 1 ? J[0]!.description ?? '' : (J[0]!.description ?? '') + ` и уште ${J.length - 1}`;
  const izb = (x: (typeof L)[number]) => {
    if (x.j.kind !== 'bank') return '';
    const m = (x.j.meta ?? {}) as { statementNo?: string };
    if (m.statementNo) return String(m.statementNo);
    return /бр\.\s*(\S+)/i.exec(x.j.description ?? '')?.[1] ?? '';
  };
  return (
    <div className="pdfdoc nz">
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <FirmHead firm={firm} title="" />
      <div className="hd2">
        <div><div className="t1">Финансов налог број&nbsp;&nbsp; {n}</div><div className="sm">Од {d8(date)}</div></div>
        <div className="t2">{label.toUpperCase()}</div>
        <div className="sm" style={{ textAlign: 'right' }}>Отпечатено: {d8(new Date().toISOString())}</div>
      </div>
      <table>
        <thead><tr><th style={{ width: 22 }}>Бр.</th><th>Датум</th><th>Изв.<br />Бр</th><th>КОНТО</th><th>Должи</th><th>Побарува</th><th>Комитент</th><th>Содржина<br /><small>(Фактура број)</small></th><th>Док. (Калк. Бр.)<br /><small>+ забелешка</small></th></tr></thead>
        <tbody>
          {L.map((x, i) => (
            <tr key={x.l.id}>
              <td className="n">{i + 1}</td><td>{d8(x.j.date)}</td><td style={{ textAlign: 'center' }}>{izb(x)}</td><td>{x.l.account}</td>
              <td className="n">{fmt(x.l.debit)}</td><td className="n">{fmt(x.l.credit)}</td>
              <td>{x.p ? ((x.p.code ? x.p.code + ' ' : '') + x.p.name).slice(0, 34) : ''}</td>
              <td style={{ whiteSpace: 'normal' }}>{nalogContent(x.j.description ?? '').slice(0, 90)}</td>
              <td style={{ whiteSpace: 'normal' }}>{x.l.doc ?? ''}{x.l.note && x.l.note !== x.j.description ? <> <small>{x.l.note.slice(0, 40)}</small></> : null}</td>
            </tr>
          ))}
        </tbody>
        <tfoot><tr><td colSpan={4}>Вкупно ({L.length} ставки)</td><td className="n">{fmt(D)}</td><td className="n">{fmt(P)}</td><td colSpan={3}>{Math.abs(D - P) < 0.01 ? '' : 'Разлика: ' + fmt(D - P)}</td></tr></tfoot>
      </table>
      <Sig who={['Книжел', 'Контролирал', 'Одговорно лице']} />
    </div>
  );
}
