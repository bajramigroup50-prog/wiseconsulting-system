/** Legacy `kompPdfHTML` 8945: ИЗЈАВА ЗА КОМПЕНЗАЦИЈА, printed from the browser. */
import { notFound } from 'next/navigation';
import { and, eq, inArray } from 'drizzle-orm';
import { compensations, partners } from '@wise/db';
import { booksPage } from '@/lib/books';
import { db } from '@/lib/db';
import { dmy, fmt } from '@/lib/fmt';
import { PrintPage } from '@/components/print-page';
import { FirmHead, Sig } from '@/app/print/firm-head';

export default async function KompPrint({ searchParams }: { searchParams: Promise<{ id?: string }> }) {
  const sp = await searchParams;
  const { firm } = await booksPage('kompenzacii');
  if (!firm || !sp.id || !/^[0-9a-f-]{36}$/i.test(sp.id)) notFound();
  const [k] = await db().select().from(compensations).where(and(eq(compensations.id, sp.id), eq(compensations.firmId, firm.id))).limit(1);
  if (!k) notFound();
  const ids = [...new Set(k.rows.map((r) => r.partnerId))];
  const P = ids.length ? await db().select().from(partners).where(inArray(partners.id, ids)) : [];
  const pm = new Map(P.map((p) => [p.id, p]));
  const rec = k.rows.filter((r) => r.side === 'rec').reduce((s, r) => s + r.amt, 0);
  const pay = k.rows.filter((r) => r.side === 'pay').reduce((s, r) => s + r.amt, 0);
  return (
    <PrintPage title={`Компензација ${k.number}`}>
      <div className="pdfdoc">
        <FirmHead firm={firm} title="ИЗЈАВА ЗА КОМПЕНЗАЦИЈА" sub={`бр. ${k.number} од ${dmy(k.date)}`} />
        <p>{k.kind === 'multi' ? 'Мултилатерална' : 'Билатерална'} компензација помеѓу <b>{firm.name}</b> (ЕДБ {firm.edb ?? ''}) и{' '}
          {ids.map((id, i) => <span key={id}>{i ? ', ' : ''}<b>{pm.get(id)?.name}</b>{pm.get(id)?.edb ? ` (ЕДБ ${pm.get(id)!.edb})` : ''}</span>)}.</p>
        <p>Учесниците се согласуваат меѓусебните побарувања и обврски да се пребијат (компензираат) до износ од <b>{fmt(rec)} ден.</b>, по следните документи:</p>
        <table className="dense" style={{ width: '100%' }}>
          <thead><tr><th>Р.бр</th><th>Комитент</th><th>Документ</th><th>Датум</th><th>Вид</th><th className="n">Износ</th></tr></thead>
          <tbody>{k.rows.map((r, i) => (
            <tr key={i}><td>{i + 1}</td><td>{pm.get(r.partnerId)?.name}</td><td>{r.docNo}</td><td>{r.date ? dmy(r.date) : ''}</td><td>{r.side === 'rec' ? 'Наше побарување' : 'Наша обврска'}</td><td className="n">{fmt(r.amt)}</td></tr>
          ))}</tbody>
          <tfoot><tr><td colSpan={5}>Вкупно побарувања</td><td className="n">{fmt(rec)}</td></tr><tr><td colSpan={5}>Вкупно обврски</td><td className="n">{fmt(pay)}</td></tr></tfoot>
        </table>
        {k.note && <p>{k.note}</p>}
        <p>По оваа компензација наведените износи се сметаат за платени. Изјавата е составена во онолку примероци колку што има учесници.</p>
        <Sig who={[`За ${firm.name}`, ...ids.map((id) => `За ${pm.get(id)?.name ?? ''}`)]} />
      </div>
    </PrintPage>
  );
}
