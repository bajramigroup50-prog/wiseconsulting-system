/**
 * Legacy `VIEWS.greski` 17472 — Систем › 🐞 Регистар на грешки (administrator only): program errors from the browser
 * (error boundary → `/api/errors`) and the server (`instrumentation.ts`), with user, firm and screen; filter
 * open / fixed / all, „✓ Решено“, „Избриши решени“, „📋 Копирај за поправка“.
 */
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { errorsCopyText, listErrors } from '@wise/db';
import { requireUser } from '@/lib/auth';
import { db } from '@/lib/db';
import { viewAllowed } from '@/lib/nav';
import { Hd, dmyHm } from '@/components/hd';
import { RowAction } from '@/components/row-action';
import { deleteFixedAction, fixErrorAction } from './actions';
import { CopyButton } from './copy-button';

export default async function GreskiPage({ searchParams }: { searchParams: Promise<{ f?: string }> }) {
  const sp = await searchParams;
  const u = await requireUser();
  if (!viewAllowed(u.role, 'greski')) notFound();
  if (u.role !== 'admin') return <><Hd t="Регистар на грешки" /><div className="card empty">Само за администратор.</div></>;
  const f = sp.f === 'fixed' || sp.f === 'all' ? sp.f : 'open';
  let L: Awaited<ReturnType<typeof listErrors>> = [];
  let open = 0, anyFixed = false, missing = false;
  try {
    L = await listErrors(db(), f);
    const all = f === 'all' ? L : await listErrors(db(), 'all');
    open = all.filter((e) => !e.fixed).length;
    anyFixed = all.some((e) => e.fixed);
  } catch { missing = true; }
  return (
    <>
      <Hd t="Регистар на грешки" sub={`${open} отворени`}>
        {(['open', 'fixed', 'all'] as const).map((k) => <Link key={k} className={`btn${f === k ? ' pri' : ''}`} href={`/greski?f=${k}`}>{k === 'open' ? 'Отворени' : k === 'fixed' ? 'Решени' : 'Сите'}</Link>)}
        <CopyButton text={errorsCopyText(L)} disabled={!L.length} />
        {anyFixed && <RowAction action={deleteFixedAction} label="Избриши решени" className="btn danger" confirm="Да се избришат решените грешки од регистарот?" />}
      </Hd>
      <p className="note">Секоја грешка во програмата автоматски се запишува тука: кога, кој корисник, во која фирма и на кој екран. „Копирај за поправка“ го копира текстот – залепете го во разговорот со Claude за брза поправка. Иста отворена грешка се брои, не се запишува повторно.</p>
      {missing && <div className="callout warn">Табелата на регистарот сè уште не е создадена – потребна е миграција на базата.</div>}
      {L.length ? (
        <div className="tw"><table className="dense">
          <thead><tr><th>Кога</th><th>Корисник</th><th>Фирма</th><th>Екран</th><th>Грешка</th><th className="n">Пати</th><th></th></tr></thead>
          <tbody>{L.map((e) => (
            <tr key={e.id}>
              <td>{dmyHm(e.lastAt)}{e.count > 1 && <><br /><small className="mut">прва: {dmyHm(e.at)}</small></>}</td>
              <td>{e.userName ?? ''}<br /><small className="mut">{e.role ?? ''}</small></td>
              <td>{e.firmName ?? ''}</td>
              <td>{e.view ?? ''}<br /><small className="mut">{e.src}</small></td>
              <td style={{ maxWidth: 420 }}><b>{e.msg}</b>{(e.stack || e.digest) && <details><summary className="mini">детали</summary><pre style={{ whiteSpace: 'pre-wrap', fontSize: 10.5, maxHeight: 160, overflow: 'auto' }}>{e.digest ? `digest: ${e.digest}\n` : ''}{e.stack}</pre></details>}</td>
              <td className="n">{e.count}</td>
              <td>{e.fixed ? <span className="pill good">решено</span> : <RowAction action={fixErrorAction.bind(null, e.id)} label="✓ Решено" className="btn sm" />}</td>
            </tr>
          ))}</tbody>
        </table></div>
      ) : !missing && <div className="card empty">Нема грешки. 👍</div>}
    </>
  );
}
