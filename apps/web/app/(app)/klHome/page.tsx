/** Legacy `VIEWS.klHome` 9055 → **10400** — the client's home: sections, my state, messages from the office. */
import Link from 'next/link';
import { and, desc, eq, sql } from 'drizzle-orm';
import { balances, sumPref } from '@wise/core';
import { klSections, type KlConfig } from '@wise/core/office';
import { clientEntries, firmDeadlines, inboxItems, loadLedgerLines } from '@wise/db';
import { db } from '@/lib/db';
import { officePage, today } from '@/lib/office';
import { Hd, dmy, dmyHm } from '@/components/hd';
import { NoFirm } from '@/components/no-firm';
import { hrefFor } from '@/lib/nav';
import { fmt } from '@/lib/fmt';

export default async function KlHomePage() {
  const { firm } = await officePage('klHome');
  if (!firm) return <NoFirm t="🏠 Почетна" />;
  const td = today(), y = td.slice(0, 4);
  const [msgs, [pend], dl, L] = await Promise.all([
    db().select().from(inboxItems).where(and(eq(inboxItems.firmId, firm.id), eq(inboxItems.fromOffice, true))).orderBy(desc(inboxItems.createdAt)).limit(10),
    db().select({ n: sql<number>`count(*)::int` }).from(clientEntries).where(and(eq(clientEntries.firmId, firm.id), eq(clientEntries.status, 'pending'))),
    db().select().from(firmDeadlines).where(and(eq(firmDeadlines.firmId, firm.id), eq(firmDeadlines.done, false))).orderBy(firmDeadlines.due).limit(10),
    loadLedgerLines(db(), firm.id, `${y}-01-01`, `${y}-12-31`),
  ]);
  const B = balances(L);
  const tiles: [string, number][] = [
    ['Побарувања од купувачи', sumPref(B, ['12'])],
    ['Обврски кон добавувачи', -sumPref(B, ['22'])],
    ['Благајна', sumPref(B, ['102'])],
    ['Жиро сметка', sumPref(B, ['100'])],
  ];
  const S = klSections((firm.settings as { kl?: KlConfig }).kl);
  return (
    <>
      <Hd t={`🏠 ${firm.name}`} sub="портал за клиенти" />
      <div className="tiles">{tiles.map(([t, v]) => <div key={t} className="tile"><span>{t}</span><b>{fmt(v)}</b></div>)}</div>
      {(pend?.n ?? 0) > 0 && <div className="callout">⏳ {pend!.n} ваши внесови чекаат одобрување од канцеларијата.</div>}
      <div className="tiles">
        {S.filter((s) => s[3] !== 'klHome').map((s) => (
          <Link key={s[0]} className="tile" href={hrefFor(s[3])} style={{ textAlign: 'left' }}><span>{s[2]} {s[1]}</span><small className="mini">{s[5]}</small></Link>
        ))}
      </div>
      {dl.length > 0 && <div className="card"><h2 style={{ fontSize: 15 }}>⏰ Рокови</h2><table className="dense"><tbody>
        {dl.map((d) => <tr key={d.id}><td style={d.due < td ? { color: 'var(--bad)', fontWeight: 700 } : undefined}>{dmy(d.due)}</td><td>{d.title}</td></tr>)}
      </tbody></table></div>}
      <div className="card"><h2 style={{ fontSize: 15 }}>✉ Пораки од канцеларијата</h2>
        {msgs.length ? msgs.map((m) => (
          <details key={m.id} style={{ borderTop: '1px solid var(--line)', padding: '6px 0' }}>
            <summary><span className="mini">{dmyHm(m.createdAt)}</span> <b>{m.subject ?? 'Порака'}</b></summary>
            <div style={{ whiteSpace: 'pre-line' }}>{m.note}</div>
          </details>
        )) : <p className="note">Нема пораки.</p>}
      </div>
    </>
  );
}
