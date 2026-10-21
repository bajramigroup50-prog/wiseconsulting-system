/**
 * Legacy `VIEWS.klHome` 9055 → 10400 — the client's home, exactly as legacy renders it (also with no data):
 * title = firm name · „портал за клиенти · датум“, tiles of „Мојата состојба“ (when that
 * section is on: купувачите ни должат, ние должиме, залиха, ДДВ за тековниот период), one card per enabled section,
 * expiring documents, „Испратено до канцеларијата“ (pending entries, last 5 sent items or „Сè уште ништо.“).
 * Server addition: messages from the office. (The accounting-service contract is no longer in the portal — owner-only.)
 */
import Link from 'next/link';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { balances, periodOf, sumPref } from '@wise/core';
import { klSections, type KlConfig } from '@wise/core/office';
import { partnerBalances } from '@wise/core/office/autopilot';
import { clientEntries, computeVatPeriod, dossierDocs, inboxItems, loadLedgerLines, partners } from '@wise/db';
import { db } from '@/lib/db';
import { officePage, today } from '@/lib/office';
import { Hd, dmy, dmyHm } from '@/components/hd';
import { NoFirm } from '@/components/no-firm';
import { hrefFor } from '@/lib/nav';
import { fmt } from '@/lib/fmt';
import { KlDashCards } from './kl-dash-cards';

const KIND: Record<string, string> = { purchase: 'Влезна фактура', invoice: 'Излезна фактура', sale: 'Промет', dossier: 'Документ' };

export default async function KlHomePage() {
  const { firm } = await officePage('klHome');
  if (!firm) return <NoFirm t="Мојата фирма" />;
  const td = today(), y = td.slice(0, 4);
  const per = firm.vatPeriod === 'month' ? 'month' : 'quarter';
  const [msgs, pend, sent, docs, L, vat] = await Promise.all([
    db().select().from(inboxItems).where(and(eq(inboxItems.firmId, firm.id), eq(inboxItems.fromOffice, true))).orderBy(desc(inboxItems.createdAt)).limit(10),
    db().select().from(clientEntries).where(and(eq(clientEntries.firmId, firm.id), eq(clientEntries.status, 'pending'))).orderBy(desc(clientEntries.submittedAt)),
    db().select().from(inboxItems).where(and(eq(inboxItems.firmId, firm.id), eq(inboxItems.fromOffice, false))).orderBy(desc(inboxItems.createdAt)).limit(5),
    db().select().from(dossierDocs).where(eq(dossierDocs.firmId, firm.id)),
    loadLedgerLines(db(), firm.id, `${y}-01-01`, `${y}-12-31`).catch(() => []),
    firm.vatRegistered ? computeVatPeriod(db(), firm, periodOf(td, per)).then((c) => c.fields['31'] ?? 0).catch(() => null) : Promise.resolve(null),
  ]);
  const B = balances(L);
  const rec = sumPref(B, ['12']), pay = -sumPref(B, ['22']), stk = sumPref(B, ['66']) + sumPref(B, ['31']) + sumPref(B, ['63']);
  const S = klSections((firm.settings as { kl?: KlConfig }).kl, firm.mods);
  const showSt = S.some((s) => s[0] === 'stanje');
  // ❗ Што фали (option of the office): suppliers paid more than invoiced, customers who paid without an invoice
  const fali = S.some((s) => s[0] === 'fali') ? partnerBalances(L).filter((o) => (o.t === '22' && o.s > 1) || (o.t === '12' && o.s < -1)).sort((a, b) => Math.abs(b.s) - Math.abs(a.s)) : [];
  const PN = fali.length ? new Map((await db().select({ id: partners.id, name: partners.name }).from(partners).where(and(eq(partners.firmId, firm.id), inArray(partners.id, fali.map((o) => o.p))))).map((p) => [p.id, p.name])) : new Map<string, string>();
  const days = (d: string) => Math.round((Date.parse(d) - Date.parse(td)) / 864e5);
  const exp = docs.filter((d) => d.validTo && days(d.validTo) <= 30).sort((a, b) => (a.validTo! < b.validTo! ? -1 : 1));
  const tile = (lab: string, v: string, sub?: string, c?: string) => <div className="tile" key={lab}><span>{lab}</span><b style={c ? { color: c } : undefined}>{v}</b>{sub && <i>{sub}</i>}</div>;
  return (
    <>
      <Hd t={firm.name || 'Мојата фирма'} sub={`портал за клиенти · ${dmy(td)}`} exp={false} />
      <div className="row" style={{ gap: 10, flexWrap: 'wrap', margin: '0 0 12px' }}>
        <Link className="btn pri" href="/klFoto" style={{ fontSize: 18, padding: '14px 20px', borderRadius: 14 }}>📷 Испрати документ</Link>
        <Link className="btn" href="/klIzv" style={{ fontSize: 16, padding: '14px 18px', borderRadius: 14 }}>📊 Месечни извештаи</Link>
      </div>
      {showSt && (
        <div className="tiles">
          {tile('Купувачите ни должат', fmt(rec), 'отворени побарувања')}
          {tile('Ние должиме на добавувачи', fmt(pay), 'отворени обврски', pay > 0 ? 'var(--bad)' : undefined)}
          {stk ? tile('Залиха (набавна вредност)', fmt(stk)) : null}
          {vat != null ? tile('ДДВ за тековниот период', fmt(vat), vat > 0 ? 'за плаќање' : vat < 0 ? 'за поврат' : 'нема обврска') : null}
        </div>
      )}
      <KlDashCards firm={firm} year={Number(y)} td={td} vat={vat} show={{ kpi: S.some((s) => s[0] === 'kpi'), top: S.some((s) => s[0] === 'top'), otv: S.some((s) => s[0] === 'otv') }} />
      <div className="klgrid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(210px,1fr))', gap: 12, margin: '14px 0' }}>
        {S.filter((s) => s[3] !== 'klHome').map((s) => (
          <Link key={s[0]} className="card" href={hrefFor(s[3])} style={{ textAlign: 'left', cursor: 'pointer', padding: 16, margin: 0, border: '1px solid var(--line)', color: 'inherit', textDecoration: 'none' }}>
            <div style={{ fontSize: 26 }}>{s[2]}</div>
            <b style={{ display: 'block', margin: '6px 0 4px', fontSize: 15 }}>{s[1]}</b>
            <span className="mini" style={{ color: 'var(--muted)' }}>{s[5]}</span>
          </Link>
        ))}
      </div>
      {S.some((s) => s[0] === 'fali') && (
        <div className="card" style={{ borderLeft: `4px solid ${fali.length ? 'var(--bad)' : 'var(--good, #1a7f37)'}` }}>
          <b>❗ Што фали – фактури ({y})</b>
          {fali.length ? <>
            <p className="mini" style={{ margin: '4px 0 6px' }}>Според книгите – донесете ги или испратете ги фактурите (📷 Испрати документ):</p>
            {fali.map((o) => <div key={o.p + o.t} className="mini" style={{ marginTop: 3 }}>
              {o.t === '22' ? <>🔴 Платено <b>{fmt(o.s)}</b> ден. на <b>{PN.get(o.p) ?? 'добавувач'}</b> – недостасува <b>влезна фактура</b></>
                : <>🟠 Примено <b>{fmt(-o.s)}</b> ден. од <b>{PN.get(o.p) ?? 'купувач'}</b> – нема <b>излезна фактура</b> (аванс?)</>}
            </div>)}
          </> : <p className="mini" style={{ margin: '4px 0 0' }}>✅ Нема фактури што фалат.</p>}
        </div>
      )}
      {exp.length > 0 && (
        <div className="card" style={{ borderLeft: '4px solid #e08a00' }}><b>Документи што истекуваат</b>
          {exp.map((d) => <div key={d.id} className="mini" style={{ marginTop: 4 }}>{days(d.validTo!) < 0 ? '🔴 истечен' : '🟠 истекува'} {dmy(d.validTo)} – {d.title || d.category}</div>)}
        </div>
      )}
      <div className="card">
        <div className="hd"><b>Испратено до канцеларијата</b><Link className="btn sm pri" href="/klSend">📤 Испрати документ / порака</Link></div>
        {pend.length > 0 && <div className="mini" style={{ margin: '4px 0 8px', color: '#b26a00' }}>⏳ {pend.length} внесени документи чекаат одобрување од канцеларијата: {pend.slice(0, 5).map((x) => `${KIND[x.kind] ?? x.kind} ${String((x.data as { number?: string }).number ?? '')}`.trim()).join(', ')}</div>}
        {sent.length ? sent.map((d) => <div key={d.id} className="mini" style={{ marginTop: 4 }}>{d.done ? '✅' : '⏳'} {dmy(d.createdAt)} – {d.note || d.subject || ''}{d.done ? ' · обработено' : ''}</div>)
          : <p className="note" style={{ margin: '6px 0 0' }}>Сè уште ништо.</p>}
      </div>
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
