/**
 * Legacy `VIEWS.kartoni` 10153 — Картони на клиенти / пациенти: client search, confidential notes (`firm_docs` type
 * `cnote`), appointments and invoices of the client.
 */
import Link from 'next/link';
import { and, desc, eq, ilike, or } from 'drizzle-orm';
import { APPT_STATUS } from '@wise/core/industry';
import { appointments, invoices, listDocs, partners, type ClientNote } from '@wise/db';
import { db } from '@/lib/db';
import { dmy, fmt } from '@/lib/fmt';
import { industryPage, today } from '@/lib/industry';
import { BankForm } from '@/components/bank-form';
import { Hd } from '@/components/hd';
import { RowAction } from '@/components/row-action';
import { deleteNoteAction, saveNoteAction } from '../termini/actions';

export default async function Kartoni({ searchParams }: { searchParams: Promise<{ q?: string; p?: string; n?: string }> }) {
  const sp = await searchParams;
  const g = await industryPage('kartoni', 'Картони на клиенти / пациенти');
  if (g.blocked) return g.blocked;
  const { firm, write } = g;
  const q = (sp.q ?? '').trim();
  const P = await db().select().from(partners).where(and(eq(partners.firmId, firm.id), eq(partners.active, true), q ? or(ilike(partners.name, `%${q}%`), ilike(partners.phone, `%${q}%`), ilike(partners.email, `%${q}%`)) : undefined)).orderBy(partners.name).limit(200);
  const sel = sp.p ? (await db().select().from(partners).where(and(eq(partners.id, sp.p), eq(partners.firmId, firm.id))).limit(1))[0] : undefined;
  const notes = sel ? (await listDocs<ClientNote>(db(), firm.id, 'cnote')).filter((n) => n.data.partnerId === sel.id).sort((a, b) => String(b.date).localeCompare(String(a.date))) : [];
  const ap = sel ? await db().select().from(appointments).where(eq(appointments.partnerId, sel.id)).orderBy(desc(appointments.date)).limit(20) : [];
  const inv = sel ? await db().select().from(invoices).where(and(eq(invoices.partnerId, sel.id), eq(invoices.kind, 'invoice'))).orderBy(desc(invoices.date)) : [];
  const E = sp.n === 'new' ? { id: '', date: today(), data: { title: '', text: '', conf: true } } : notes.find((n) => n.id === sp.n);
  return (
    <>
      <Hd t="Картони на клиенти / пациенти"><Link className="btn" href="/termini">📅 Термини</Link></Hd>
      <div className="cols" style={{ gridTemplateColumns: '300px 1fr', alignItems: 'start' }}>
        <div className="card">
          <form action="/kartoni" className="row" style={{ marginBottom: 6, gap: 6 }}><input name="q" defaultValue={q} placeholder="🔍 Име, телефон…" /><button className="btn sm">Барај</button></form>
          <div style={{ maxHeight: 520, overflow: 'auto' }}>{P.map((p) => (
            <Link key={p.id} href={`/kartoni?p=${p.id}${q ? '&q=' + encodeURIComponent(q) : ''}`} style={{ display: 'block', padding: 6, borderBottom: '1px solid var(--line)', color: 'inherit', background: sel?.id === p.id ? 'var(--accent-soft)' : undefined }}>
              <b>{p.name}</b><div className="mini">{p.phone}</div></Link>
          ))}</div>
        </div>
        <div>
          {sel ? <>
            <div className="card"><h2 style={{ fontSize: 16, margin: 0 }}>{sel.name}</h2>
              <div className="mini">{[sel.phone, sel.email, sel.address].filter(Boolean).join(' · ')}</div>
              <div className="row" style={{ gap: 16, marginTop: 6 }}><span className="mini">📅 {ap.length} термини</span><span className="mini">🧾 {inv.length} фактури · {fmt(inv.reduce((s, i) => s + Number(i.total), 0))} ден.</span></div></div>
            <div className="card"><div className="hd"><h2 style={{ fontSize: 15, margin: 0 }}>Белешки / наоди</h2>{!E && write && <Link className="btn sm pri" href={`/kartoni?p=${sel.id}&n=new`}>+ Нова белешка</Link>}</div>
              {E && write && <BankForm action={saveNoteAction}>
                <input type="hidden" name="id" value={E.id} /><input type="hidden" name="partner" value={sel.id} />
                <div className="form"><label className="f">Датум<input name="date" type="date" defaultValue={E.date ?? today()} /></label>
                  <label className="f wide">Наслов (преглед, третман, услуга)<input name="title" defaultValue={E.data.title} /></label>
                  <label className="f wide">Опис / наод / препорака<textarea name="text" rows={5} defaultValue={E.data.text} /></label></div>
                <label className="chk"><input type="checkbox" name="conf" defaultChecked={E.data.conf !== false} /> 🔒 Доверливо (здравствени / лични податоци) – се гледа само во картонот</label>
                <div className="row" style={{ gap: 6, marginTop: 6 }}><span style={{ flex: 1 }} /><Link className="btn" href={`/kartoni?p=${sel.id}`}>Откажи</Link><button className="btn pri">Зачувај</button></div>
              </BankForm>}
              {notes.map((n) => <div key={n.id} style={{ borderTop: '1px solid var(--line)', padding: '8px 0' }}>
                <div className="row" style={{ justifyContent: 'space-between' }}><b>{dmy(n.date)} · {n.data.title}{n.data.conf !== false ? ' 🔒' : ''}</b>
                  <span className="mini">{n.data.by} {write && <><Link className="btn sm ghost" href={`/kartoni?p=${sel.id}&n=${n.id}`}>✎</Link><RowAction action={deleteNoteAction.bind(null, n.id)} confirm="Да се избрише белешката?" label="✕" /></>}</span></div>
                <div style={{ whiteSpace: 'pre-line' }}>{n.data.text}</div></div>)}
              {!notes.length && !E && <p className="note">Нема белешки.</p>}
            </div>
            <div className="card"><h2 style={{ fontSize: 15, margin: '0 0 6px' }}>Термини</h2>
              {ap.map((a) => <div key={a.id} className="mini" style={{ padding: '2px 0' }}><Link href={`/termini?id=${a.id}`}>{dmy(a.date)} {a.time} · {a.svc}</Link> · <span className={`pill ${APPT_STATUS[a.status][1]}`}>{APPT_STATUS[a.status][0]}</span></div>)}
              {!ap.length && <p className="note">Нема.</p>}</div>
          </> : <div className="card empty">Изберете клиент од листата.</div>}
          <p className="note">Здравствените податоци се посебна категорија лични податоци (Закон за заштита на личните податоци): внесувајте само потребното и давајте пристап само на овластени корисници.</p>
        </div>
      </div>
    </>
  );
}
