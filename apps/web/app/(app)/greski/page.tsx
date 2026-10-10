/**
 * Legacy `VIEWS.greski` (17472) — Регистар на грешки: every error in the program (browser, render, server) with
 * when, who, which firm and which screen; "copy for fixing", mark as solved, delete solved. Admin only.
 * Server errors are recorded by `instrumentation.ts` (legacy only saw browser errors).
 */
import Link from 'next/link';
import { desc, eq, sql } from 'drizzle-orm';
import { appErrors } from '@wise/db';
import { requireUser } from '@/lib/auth';
import { db } from '@/lib/db';
import { APP_VER } from '@/lib/errlog';
import { viewAllowed } from '@/lib/nav';
import { notFound } from 'next/navigation';
import { Hd, dmy } from '@/components/hd';
import { RowAction } from '@/components/row-action';
import { deleteFixed, markFixed } from './actions';
import { CopyButton, TestButton } from './tools';

const F = { open: 'Отворени', fixed: 'Решени', all: 'Сите' } as const;
type Filt = keyof typeof F;
const hm = (d: Date) => d.toLocaleTimeString('mk-MK', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Skopje' });
const iso = (d: Date) => d.toLocaleString('sv-SE', { timeZone: 'Europe/Skopje' }).slice(0, 16);

export default async function GreskiPage({ searchParams }: { searchParams: Promise<{ f?: string }> }) {
  const u = await requireUser();
  if (!viewAllowed(u.role, 'greski')) notFound();
  if (u.role !== 'admin') return (<><Hd t="Регистар на грешки" /><div className="card empty">Само за администратор.</div></>);
  const sp = await searchParams;
  const f: Filt = sp.f === 'fixed' || sp.f === 'all' ? sp.f : 'open';
  const where = f === 'all' ? undefined : eq(appErrors.fixed, f === 'fixed');
  const [L, [cnt]] = await Promise.all([
    db().select().from(appErrors).where(where).orderBy(desc(appErrors.at)).limit(300),
    db().select({ open: sql<number>`count(*) filter (where not ${appErrors.fixed})::int`, fixed: sql<number>`count(*) filter (where ${appErrors.fixed})::int` }).from(appErrors),
  ]);
  const copy = 'Грешки во WISE CONSULTING (' + APP_VER + '):\n\n' + L.slice(0, 20).map((e, i) =>
    `${i + 1}. ${iso(e.at)} · ${e.userName ?? ''} (${e.role ?? ''}) · фирма: ${e.firmName || '-'} · екран: ${e.view ?? ''} · ${e.src ?? ''} · ${e.ver ?? ''}${e.count > 1 ? ` · ×${e.count}` : ''}\n   ${e.msg}\n   ${String(e.stack ?? '').split('\n').slice(0, 4).join('\n   ')}`).join('\n\n');
  return (
    <>
      <Hd t="Регистар на грешки" sub={`${cnt?.open ?? 0} отворени · верзија ${APP_VER}`}>
        {(Object.keys(F) as Filt[]).map((k) => <Link key={k} className={`btn${k === f ? ' pri' : ''}`} href={`/greski?f=${k}`}>{F[k]}</Link>)}
        <CopyButton text={copy} disabled={!L.length} />
        <TestButton />
        {(cnt?.fixed ?? 0) > 0 && <RowAction className="btn danger" action={deleteFixed} label="Избриши решени" confirm={`Да се избришат ${cnt?.fixed} решени грешки од регистарот?`} />}
      </Hd>
      <p className="note">Секоја грешка во програмата автоматски се запишува тука: кога, кој корисник, во која фирма и на кој екран (и грешките на серверот). „Копирај за поправка“ го копира текстот – залепете го во разговорот со Claude за брза поправка. Иста грешка се запишува еднаш на ден; повторувањата се бројат (×).</p>
      {L.length ? (
        <div className="tw"><table className="dense">
          <thead><tr><th>Кога</th><th>Корисник</th><th>Фирма</th><th>Екран</th><th>Грешка</th><th>Верз.</th><th></th></tr></thead>
          <tbody>
            {L.map((e) => (
              <tr key={e.id}>
                <td>{dmy(iso(e.at).slice(0, 10))} {hm(e.at)}{e.count > 1 && <div className="mini">×{e.count}</div>}</td>
                <td>{e.userName}<br /><small className="mut">{e.role}</small></td>
                <td>{e.firmName}</td>
                <td>{e.view}<br /><small className="mut">{e.src}</small></td>
                <td style={{ maxWidth: 420 }}><b>{e.msg}</b>{e.stack && <details><summary className="mini">детали</summary><pre style={{ whiteSpace: 'pre-wrap', fontSize: 10.5, maxHeight: 160, overflow: 'auto' }}>{e.stack}</pre></details>}</td>
                <td>{e.ver}</td>
                <td>{e.fixed ? <span className="pill good">решено</span> : <RowAction className="btn sm" action={markFixed.bind(null, [e.id])} label="✓ Решено" />}</td>
              </tr>
            ))}
          </tbody>
        </table></div>
      ) : <div className="card empty">Нема грешки. 👍</div>}
    </>
  );
}
