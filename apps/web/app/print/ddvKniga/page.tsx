/** Legacy `ACT.ddvBookPdf` 7318 (`Kniga_fakturi_<period>.pdf`): both invoice books of a VAT period, landscape. */
import { invoiceBookOutSum, invoiceBookRows } from '@wise/core/vat/evidence';
import { normalizeVatPeriod, vatYearOverview } from '@wise/db';
import { db } from '@/lib/db';
import { dmy, fmt } from '@/lib/fmt';
import { vatSource } from '@/lib/vat-source';
import { FirmHead, Sig } from '../firm-head';
import { printGuard } from '../guard';

export const metadata = { title: 'Книга на фактури' };

export default async function PrintDdvKniga({ searchParams }: { searchParams: Promise<{ p?: string }> }) {
  const sp = await searchParams;
  const { firm, year } = await printGuard('ddv');
  const ov = await vatYearOverview(db(), firm, year, vatSource);
  const want = normalizeVatPeriod(sp.p);
  const cur = ov.periods.find((p) => p.period === want) ?? ov.periods[0]!;
  const B = invoiceBookRows(ov.data.docs, cur.from, cur.to, { partners: ov.data.partners });
  const S = invoiceBookOutSum(B.out);
  const n = (v: number) => (v ? fmt(v) : '');
  return (
    <div className="pdfdoc land">
      <title>{`Kniga_fakturi_${cur.period}`}</title>
      <style dangerouslySetInnerHTML={{ __html: '@page{size:A4 landscape}' }} />
      <FirmHead firm={firm} title="КНИГА НА ИЗЛЕЗНИ И ВЛЕЗНИ ФАКТУРИ" sub={`${dmy(cur.from)} – ${dmy(cur.to)}`} />
      <h2>Излезни фактури</h2>
      <table style={{ fontSize: '7.5pt' }}><thead><tr><th>Датум</th><th>Бр.</th><th>Купувач</th><th>ЕДБ</th><th className="n">Основица 18%</th><th className="n">ДДВ 18%</th><th className="n">Основица 10%</th><th className="n">ДДВ 10%</th><th className="n">Основица 5%</th><th className="n">ДДВ 5%</th><th className="n">Чл. 32-а / 0%</th></tr></thead>
        <tbody>{B.out.map((r, i) => <tr key={i}><td>{dmy(r.date)}</td><td>{r.no}</td><td>{r.name}</td><td>{r.edb}</td><td className="n">{n(r.b18)}</td><td className="n">{n(r.v18)}</td><td className="n">{n(r.b10)}</td><td className="n">{n(r.v10)}</td><td className="n">{n(r.b5)}</td><td className="n">{n(r.v5)}</td><td className="n">{n(r.oth)}</td></tr>)}</tbody>
        <tfoot><tr><td colSpan={4}>Вкупно ({B.out.length})</td><td className="n">{fmt(S.b18)}</td><td className="n">{fmt(S.v18)}</td><td className="n">{fmt(S.b10)}</td><td className="n">{fmt(S.v10)}</td><td className="n">{fmt(S.b5)}</td><td className="n">{fmt(S.v5)}</td><td className="n">{fmt(S.oth)}</td></tr></tfoot>
      </table>
      <h2>Влезни фактури</h2>
      <table style={{ fontSize: '7.5pt' }}><thead><tr><th>Датум</th><th>Бр.</th><th>Добавувач</th><th>ЕДБ</th><th className="n">Основица</th><th className="n">ДДВ</th><th>Чл. 32-а</th></tr></thead>
        <tbody>{B.inn.map((r, i) => <tr key={i}><td>{dmy(r.date)}</td><td>{r.no}</td><td>{r.name}</td><td>{r.edb}</td><td className="n">{fmt(r.base)}</td><td className="n">{fmt(r.vat)}</td><td>{r.art32 ? 'Да' : ''}</td></tr>)}</tbody>
        <tfoot><tr><td colSpan={4}>Вкупно ({B.inn.length})</td><td className="n">{fmt(B.inn.reduce((s, r) => s + r.base, 0))}</td><td className="n">{fmt(B.inn.reduce((s, r) => s + r.vat, 0))}</td><td /></tr></tfoot>
      </table>
      <Sig />
    </div>
  );
}
