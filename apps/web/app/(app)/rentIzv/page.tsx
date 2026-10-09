/** Legacy `VIEWS.rentIzv` 9844 → 11805 — rentals, rented days, utilisation, revenue per vehicle, km, deadlines. */
import Link from 'next/link';
import { rentReport } from '@wise/db';
import { inYearOr } from '@/lib/books';
import { db } from '@/lib/db';
import { dmy, fmt } from '@/lib/fmt';
import { industryPage, today } from '@/lib/industry';
import { Hd } from '@/components/hd';

export default async function RentIzv({ searchParams }: { searchParams: Promise<{ a?: string; b?: string }> }) {
  const sp = await searchParams;
  const g = await industryPage('rentIzv', 'Rent-a-car – извештаи');
  if (g.blocked) return g.blocked;
  const a = inYearOr(sp.a, g.year, `${g.year}-01-01`);
  const b = inYearOr(sp.b, g.year, String(g.year) === today().slice(0, 4) ? today() : `${g.year}-12-31`);
  const R = await db().transaction((tx) => rentReport(tx, g.firm.id, a, b));
  const nd = Math.round((Date.parse(b) - Date.parse(a)) / 864e5) + 1;
  const tot = R.reduce((s, x) => ({ n: s.n + x.n, days: s.days + x.days, rev: s.rev + x.rev, km: s.km + x.km }), { n: 0, days: 0, rev: 0, km: 0 });
  const soon = (d: string | null | undefined) => d && Date.parse(d) - Date.now() <= 30 * 864e5;
  return (
    <>
      <Hd t="Rent-a-car – извештаи"><Link className="btn" href="/rent">🚗 Резервации</Link></Hd>
      <form className="row" style={{ gap: 8, marginBottom: 8 }} action="/rentIzv">
        <label className="mini">од <input name="a" type="date" defaultValue={a} style={{ width: 'auto' }} /></label>
        <label className="mini">до <input name="b" type="date" defaultValue={b} style={{ width: 'auto' }} /></label><button className="btn sm">Прикажи</button>
      </form>
      <div className="tw"><table><thead><tr><th>Возило</th><th className="n">Изнајмувања</th><th className="n">Изнајмени денови</th><th className="n">Искористеност</th><th className="n">Приход без ДДВ</th><th className="n">Приход / ден</th><th className="n">Км</th><th>Рокови</th></tr></thead>
        <tbody>{R.map((x) => (
          <tr key={x.v.id}><td><b>{x.v.plate}</b> <span className="mini">{x.v.name}</span></td><td className="n">{x.n}</td><td className="n">{x.days}</td>
            <td className="n"><span className={`pill ${x.util >= 60 ? 'good' : x.util >= 30 ? 'warn' : 'bad'}`}>{x.util}%</span></td><td className="n">{fmt(x.rev)}</td><td className="n">{x.days ? fmt(x.rev / x.days) : ''}</td><td className="n">{x.km || ''}</td>
            <td className="mini">{[['рег.', x.v.regExp], ['осиг.', x.v.insExp], ['техн.', x.v.techExp]].filter(([, d]) => soon(d)).map(([n, d]) => `📄 ${n} ${dmy(d)}`).join(' ') || <span className="pill good">во ред</span>}</td></tr>
        ))}
          <tr><td><b>Вкупно</b></td><td className="n">{tot.n}</td><td className="n">{tot.days}</td><td className="n">{R.length && nd ? Math.round((tot.days / (nd * R.length)) * 100) + '%' : ''}</td><td className="n"><b>{fmt(tot.rev)}</b></td><td className="n">{tot.days ? fmt(tot.rev / tot.days) : ''}</td><td className="n">{tot.km}</td><td /></tr>
        </tbody></table></div>
      <p className="note">Искористеност = изнајмени денови / денови во периодот. Приходот е од фактурите издадени од договорите.</p>
    </>
  );
}
