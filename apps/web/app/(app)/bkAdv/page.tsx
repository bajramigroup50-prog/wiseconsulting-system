/**
 * UX Phase 3 (P3/P29): the „🔗 Поврзување“ tab of Изводи — the PROPOSED payment ↔ invoice links (made after every import:
 * reference / number → exact amount → FIFO over the partner's open documents with partial payments), accepted or
 * rejected in bulk by a person. Below it the old report.
 *
 * Legacy `VIEWS.bkAdv` 12545 (+ `VIEWS.bkUnl` 12513) — Финансово › Плаќања без фактура (аванси): partner payments booked
 * on 12x/22x without a linked document, applied FIFO to the partner's oldest open documents (`virtualAdvances`, legacy
 * `bkVirt` — FIX 4.4 #7: an explicit report helper, no hidden state in the open amounts), and the excess (advances).
 */
import Link from 'next/link';
import { isFxAccount, unlinkedPayments, virtualAdvances, type AdvanceInfo } from '@wise/core';
import { REVIEW_CONF_LBL } from '@wise/core';
import { linkProposals, loadBankEnv, matchContext } from '@wise/db';
import { booksPage, canDo } from '@/lib/books';
import { AUTO_LBL } from '@/lib/bank';
import { BankForm } from '@/components/bank-form';
import { RowAction } from '@/components/row-action';
import { hubTabs } from '@/components/hub-tabs';
import { linksAction, proposeLinksAction } from './actions';
import { db } from '@/lib/db';
import { dmy, fmt } from '@/lib/fmt';
import { Hd } from '@/components/hd';
import { NoFirm } from '@/components/no-firm';
import { ExportBar, type Cell } from '@/components/parity-fin/export-bar';

export default async function BkAdvPage() {
  const { u, firm, year } = await booksPage('bkAdv');
  if (!firm) return <NoFirm t="Поврзување" />;
  const write = canDo(u, 'write', firm.id);
  const { ctx, env, links } = await db().transaction(async (tx) => {
    const env = await loadBankEnv(tx, firm.id);
    return { env, ctx: await matchContext(tx, env, year), links: await linkProposals(tx, firm.id, year) };
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
  // Excel / CSV (hard rule): one sheet per table of the screen.
  const H: Cell[] = ['Комитент', 'Вид', 'Платено/примено без фактура', 'Распоредено на отворени фактури', 'Вишок – нема фактура', 'Плаќања'];
  const advRows = (L: AdvanceInfo[], kind: string): Cell[][] => L.map((a) => [pName.get(a.pid) ?? '—', kind, a.paid / 100, a.applied / 100, a.left / 100,
    a.pays.map((b) => `${dmy(b.date)} ${fmt(Math.abs(b.amount) / 100)}`).join('; ')]);
  const all: Cell[][] = [H, ...advRows(inL, 'Примено од купувач'), ...advRows(outL, 'Платено на добавувач'), ...advRows(A.filter((a) => !a.left), 'Распоредено во целост')];
  const unlRows: Cell[][] = [['Датум', 'Комитент', 'Опис', 'Прилив', 'Одлив'],
    ...unl.map((b) => [b.date, pName.get(b.partner ?? '') ?? b.name ?? '', b.desc ?? '', b.amount > 0 ? b.amount / 100 : '', b.amount < 0 ? -b.amount / 100 : ''])];
  const nSure = links.rows.filter((r) => r.proposal.conf === 'sure').length;
  return (
    <>
      {await hubTabs('izvodi', 'bkAdv')}
      <Hd t="Поврзување" sub="плаќања ↔ фактури · плаќања без фактура (аванси)" excel={false}>
        <ExportBar pdf={false} name={`Placanja_bez_faktura_${year}`} title={`Плаќања без фактура ${year}`} rows={all} sheets={[{ name: 'Без фактура', rows: all }, { name: 'Затвори рачно', rows: unlRows }]} />
        <Link className="btn" href="/banka">Изводи</Link>{unl.length > 0 && <a className="btn pri" href="#bkUnl">Затвори рачно ({unl.length})</a>}
      </Hd>
      <div className="card" id="links">
        <div className="hd"><h2>🔗 Предложени врски плаќање ↔ фактура ({links.rows.length})</h2>
          {write && <RowAction className="btn" action={proposeLinksAction} label="↻ Предложи врски" showOk title="Предлози за сите плаќања од годината без фактура (одбиените остануваат одбиени)" />}</div>
        <p className="note">По секој увоз на извод програмата <b>предлага</b> врска кога повикувањето на број, бројот на фактурата, износот или FIFO по отворените фактури на комитентот се совпаѓаат. Врската се прави дури кога ќе ја потврдите (делумните плаќања и едно плаќање за повеќе фактури се распоредуваат по FIFO; вишокот останува аванс).{links.rejected ? ` Одбиени предлози: ${links.rejected}.` : ''}</p>
        {links.rows.length ? (
          <BankForm action={linksAction}>
            <div className="tw"><table className="dense">
              <thead><tr><th></th><th>Датум</th><th>Комитент / опис</th><th className="n">Прилив</th><th className="n">Одлив</th><th>Фактури</th><th>Причина</th></tr></thead>
              <tbody>{links.rows.map((r) => (
                <tr key={r.lineId}>
                  <td>{write && <input type="checkbox" name="ln" value={r.lineId} defaultChecked={r.proposal.conf === 'sure'} aria-label="Избери" />}</td>
                  <td>{dmy(r.date)}</td>
                  <td style={{ minWidth: 200 }}><b>{pName.get(r.proposal.partnerId ?? r.partnerId ?? '') ?? r.name}</b>{r.onPartner && <> <span className="pill info">аванс на комитент</span></>}<br /><small>{r.desc}</small></td>
                  <td className="n">{r.amount > 0 ? fmt(r.amount) : ''}</td><td className="n">{r.amount < 0 ? fmt(-r.amount) : ''}</td>
                  <td><small>{r.proposal.refs.map((x) => `${x.label}: ${fmt(x.amt)}`).join(' · ')}{r.proposal.excess ? ` · аванс ${fmt(r.proposal.excess)}` : ''}</small></td>
                  <td style={{ maxWidth: 320 }}><span className={`pill ${r.proposal.conf === 'sure' ? 'good' : 'warn'}`}>{REVIEW_CONF_LBL[r.proposal.conf]}</span> <span className="pill info">{AUTO_LBL[r.proposal.how] ?? r.proposal.how}</span> <small>{r.proposal.why}</small></td>
                </tr>
              ))}</tbody>
            </table></div>
            {write && <div className="row" style={{ gap: 8 }}><span className="note">Штиклирани се „сигурните“ ({nSure}). Отштиклирајте ги погрешните.</span><span style={{ flex: 1 }} />
              <button className="btn" name="do" value="reject">✕ Одбиј ги избраните</button>
              <button className="btn pri" name="do" value="accept">✓ Поврзи ги избраните</button></div>}
          </BankForm>
        ) : <div className="empty">Нема предложени врски.</div>}
      </div>
      <div id="finArea">
      <p className="note">Овие плаќања се распоредуваат на најстарите отворени фактури на истиот комитент (само за преглед – врската се прави со „Прокнижи…“ кај ставката). Колоната „Вишок“ се плаќања за кои <b>нема фактура</b>. Отворените фактури се читаат од книжењата на 120–128 / 220–228 по број на документ.</p>
      <div className="card"><h2>Примени уплати од купувачи без фактура</h2>
        {inL.length ? <><div className="callout warn">Уплата без издадена фактура е <b>примен аванс</b> – за неа треба да се издаде авансна фактура (ДДВ обврската настанува со наплатата на авансот), или да се провери дали фактурата е заборавена.</div>{tb(inL, true)}</> : <div className="empty">Нема уплати без фактура.</div>}
      </div>
      <div className="card"><h2>Плаќања кон добавувачи без влезна фактура</h2>
        {outL.length ? <><div className="callout warn">Платено, а влезната фактура не е внесена – побарајте ја фактурата од добавувачот (даден аванс или недостасува документ).</div>{tb(outL, false)}</> : <div className="empty">Нема плаќања без влезна фактура.</div>}
      </div>
      {A.some((a) => !a.left) && <div className="card"><h2>Распоредени во целост</h2>{tb(A.filter((a) => !a.left), true)}</div>}
      {unl.length > 0 && (
        <div className="card" id="bkUnl"><h2>Затвори рачно ({unl.length})</h2>
          <div className="tw"><table className="dense"><thead><tr><th>Датум</th><th>Комитент</th><th>Опис</th><th className="n">Прилив</th><th className="n">Одлив</th><th className="noprint"></th></tr></thead>
            <tbody>{unl.map((b) => (
              <tr key={b.id}><td>{dmy(b.date)}</td><td>{pName.get(b.partner ?? '') ?? b.name ?? '—'}{!b.partner && <> <span className="pill warn">без комитент</span></>}</td>
                <td style={{ maxWidth: 280 }}><small>{b.desc}</small></td>
                <td className="n">{b.amount > 0 ? fmt(b.amount / 100) : ''}</td><td className="n">{b.amount < 0 ? fmt(-b.amount / 100) : ''}</td>
                <td className="noprint"><Link className="btn sm" href={`/banka?line=${b.id}`}>Поврзи со фактура</Link></td></tr>
            ))}</tbody></table></div>
        </div>
      )}
      </div>
    </>
  );
}
