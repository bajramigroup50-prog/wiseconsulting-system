/**
 * Legacy `VIEWS.bkAdv` 12545 (+ `VIEWS.bkUnl` 12513) — Финансово › Плаќања без фактура (аванси): partner payments booked
 * on 12x/22x without a linked document, applied FIFO to the partner's oldest open documents (`virtualAdvances`, legacy
 * `bkVirt` — FIX 4.4 #7: an explicit report helper, no hidden state in the open amounts), and the excess (advances).
 */
import Link from 'next/link';
import { isFxAccount, unlinkedPayments, virtualAdvances, type AdvanceInfo } from '@wise/core';
import { loadBankEnv, matchContext } from '@wise/db';
import { booksPage } from '@/lib/books';
import { db } from '@/lib/db';
import { dmy, fmt } from '@/lib/fmt';
import { Hd } from '@/components/hd';
import { NoFirm } from '@/components/no-firm';

export default async function BkAdvPage() {
  const { firm, year } = await booksPage('bkAdv');
  if (!firm) return <NoFirm t="Плаќања без фактура" />;
  const { ctx, env } = await db().transaction(async (tx) => {
    const env = await loadBankEnv(tx, firm.id);
    return { env, ctx: await matchContext(tx, env, year) };
  });
  const rows = ctx.rows.filter((r) => String(r.date).startsWith(String(year)));
  const { ADV } = virtualAdvances({ ...ctx, rows });
  const A = ADV.filter((a) => a.paid > 0);
  const left = A.filter((a) => a.left > 0);
  const pName = new Map(env.partners.map((p) => [p.id, p.name]));
  const unl = unlinkedPayments({ rows, accounts: env.accounts, year });
  const tb = (L: AdvanceInfo[], inc: boolean) => (
    <div className="tw"><table>
      <thead><tr><th>Комитент</th><th className="n">{inc ? 'Примено' : 'Платено'} без фактура</th><th className="n">Распоредено на отворени фактури</th><th className="n">Вишок – нема фактура</th><th>Плаќања</th></tr></thead>
      <tbody>{L.map((a) => (
        <tr key={a.type + a.pid}><td><b>{pName.get(a.pid) ?? '—'}</b></td><td className="n">{fmt(a.paid / 100)}</td><td className="n">{a.applied ? fmt(a.applied / 100) : ''}</td>
          <td className="n"><b>{a.left ? fmt(a.left / 100) : ''}</b></td>
          <td><small>{a.pays.map((b) => <div key={b.id}><Link href={`/${isFxAccount(env.accounts, b.acct) ? 'devizni' : 'banka'}?line=${b.id}`}>{dmy(b.date)} {fmt(Math.abs(b.amount) / 100)}</Link>{b.desc ? ' – ' + String(b.desc).slice(0, 50) : ''}</div>)}</small></td></tr>
      ))}</tbody>
      <tfoot><tr><td>Вкупно</td><td className="n">{fmt(L.reduce((s, a) => s + a.paid, 0) / 100)}</td><td className="n">{fmt(L.reduce((s, a) => s + a.applied, 0) / 100)}</td><td className="n">{fmt(L.reduce((s, a) => s + a.left, 0) / 100)}</td><td></td></tr></tfoot>
    </table></div>
  );
  const inL = left.filter((a) => a.type === 'invoice'), outL = left.filter((a) => a.type === 'purchase');
  return (
    <>
      <Hd t="Плаќања без фактура" sub="уплати и исплати што не се поврзани со фактура"><Link className="btn" href="/banka">Изводи</Link></Hd>
      <p className="note">Овие плаќања се распоредуваат на најстарите отворени фактури на истиот комитент (само за преглед – врската се прави со „Прокнижи…“ кај ставката). Колоната „Вишок“ се плаќања за кои <b>нема фактура</b>. Отворените фактури се читаат од книжењата на 120–128 / 220–228 по број на документ.</p>
      <div className="card"><h2>Примени уплати од купувачи без фактура</h2>
        {inL.length ? <><div className="callout warn">Уплата без издадена фактура е <b>примен аванс</b> – за неа треба да се издаде авансна фактура (ДДВ обврската настанува со наплатата на авансот), или да се провери дали фактурата е заборавена.</div>{tb(inL, true)}</> : <div className="empty">Нема уплати без фактура.</div>}
      </div>
      <div className="card"><h2>Плаќања кон добавувачи без влезна фактура</h2>
        {outL.length ? <><div className="callout warn">Платено, а влезната фактура не е внесена – побарајте ја фактурата од добавувачот (даден аванс или недостасува документ).</div>{tb(outL, false)}</> : <div className="empty">Нема плаќања без влезна фактура.</div>}
      </div>
      {A.some((a) => !a.left) && <div className="card"><h2>Распоредени во целост</h2>{tb(A.filter((a) => !a.left), true)}</div>}
      {unl.length > 0 && (
        <div className="card"><h2>Затвори рачно ({unl.length})</h2>
          <div className="tw"><table className="dense"><thead><tr><th>Датум</th><th>Комитент</th><th>Опис</th><th className="n">Износ</th><th></th></tr></thead>
            <tbody>{unl.map((b) => (
              <tr key={b.id}><td>{dmy(b.date)}</td><td>{pName.get(b.partner ?? '') ?? ''}</td><td>{b.desc}</td><td className="n">{fmt(b.amount / 100)}</td>
                <td><Link className="btn sm" href={`/banka?line=${b.id}`}>Поврзи со фактура</Link></td></tr>
            ))}</tbody></table></div>
        </div>
      )}
    </>
  );
}
