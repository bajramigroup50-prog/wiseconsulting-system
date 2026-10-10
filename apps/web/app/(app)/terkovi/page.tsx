/** Legacy `VIEWS.terkovi` 6976 — Шифрарник › Теркови за книжење (how each document is posted). */
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { TERKOVI } from '@wise/core/codebooks';
import { requireUser } from '@/lib/auth';
import { sysViewAllowed } from '@/lib/nav-system';
import { Hd } from '@/components/hd';

export default async function TerkoviPage() {
  const u = await requireUser();
  if (!sysViewAllowed(u.role, 'terkovi')) notFound();
  return (
    <>
      <Hd t="Теркови за книжење" sub="шеми на автоматско книжење">
        <Link className="btn" href="/sifrarnik">← Шифрарник</Link>
        <Link className="btn" href="/banka">Правила за изводи</Link>
        <Link className="btn" href="/konto">Контен план</Link>
      </Hd>
      <p className="note">Секој документ се книжи автоматски по овие шеми. Контата се менуваат во „Контен план“ (називи) и во самиот документ (избор на конто по ред); правилата за изводи се во „Изводи“.</p>
      <div className="tw"><table>
        <thead><tr><th>Документ</th><th>Книжење</th></tr></thead>
        <tbody>{TERKOVI.map(([d, k]) => <tr key={d}><td><b>{d}</b></td><td>{k}</td></tr>)}</tbody>
      </table></div>
    </>
  );
}
