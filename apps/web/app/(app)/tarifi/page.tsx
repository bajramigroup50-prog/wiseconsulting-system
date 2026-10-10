/** Legacy `VIEWS.tarifi` 6975 — Шифрарник › Даночни тарифи (VAT rates, accounts and ДДВ-04 fields). */
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { TARIFI } from '@wise/core/codebooks';
import { requireUser } from '@/lib/auth';
import { sysViewAllowed } from '@/lib/nav-system';
import { Hd } from '@/components/hd';

export default async function TarifiPage() {
  const u = await requireUser();
  if (!sysViewAllowed(u.role, 'tarifi')) notFound();
  return (
    <>
      <Hd t="Даночни тарифи" sub="ДДВ"><Link className="btn" href="/sifrarnik">← Шифрарник</Link></Hd>
      <div className="tw"><table>
        <thead><tr><th>Тарифа</th><th>Стапка</th><th>Примена</th><th>Излезен ДДВ</th><th>Претходен ДДВ</th><th>ДДВ-04 полиња</th></tr></thead>
        <tbody>{TARIFI.map((r) => <tr key={r[0]}>{r.map((c, i) => <td key={i}>{c}</td>)}</tr>)}</tbody>
      </table></div>
      <p className="note">Буквите на тарифите се ознаки за фискалната каса; проверете ги според вашиот фискален апарат.</p>
    </>
  );
}
