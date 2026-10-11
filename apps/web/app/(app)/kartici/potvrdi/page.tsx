/** „📨 Потврди на салдо – сите комитенти“ (legacy `paModal` 13836): date, partners with a balance, e-mails, PDF for all, e-mail. */
import Link from 'next/link';
import { booksPage, canDo } from '@/lib/books';
import { dmy } from '@/lib/fmt';
import { Hd } from '@/components/hd';
import { NoFirm } from '@/components/no-firm';
import { confirmationList } from '../potvrdi-data';
import { PotvrdiList } from './potvrdi-list';

export default async function PotvrdiPage({ searchParams }: { searchParams: Promise<{ to?: string }> }) {
  const sp = await searchParams;
  const { u, firm, year } = await booksPage('kartici');
  if (!firm) return <NoFirm t="Потврди на салдо" />;
  const td = new Date().toISOString().slice(0, 10);
  const to = sp.to && /^\d{4}-\d{2}-\d{2}$/.test(sp.to) && sp.to.startsWith(String(year)) ? sp.to : td.startsWith(String(year)) ? td : `${year}-12-31`;
  const { list, last } = await confirmationList(firm.id, year, to);
  return (
    <>
      <Hd t="📨 Потврди на салдо – сите комитенти" sub={`состојба на ${dmy(to)}`} exp={false}>
        <Link className="btn" href="/kartici">← Картици</Link>
      </Hd>
      <form className="row" style={{ gap: 10, alignItems: 'end', marginBottom: 8 }}>
        <label className="f">Состојба на ден<input type="date" name="to" defaultValue={to} /></label>
        <button className="btn">Прикажи</button>
      </form>
      <PotvrdiList to={to} write={canDo(u, 'write', firm.id)}
        rows={list.map((x) => ({ pid: x.pid, name: x.name, code: x.code, email: x.email, R: x.nz.map((r) => ({ s: r.s, v: r.v })), last: last.get(x.pid)?.toISOString().slice(0, 10) ?? '' }))} />
    </>
  );
}
