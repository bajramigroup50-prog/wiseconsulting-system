/**
 * Client portal „✍ Договори за вработување“ (KL_SEC `vdog`, only when the office switches it on): the firm's
 * employment contracts and the related documents (анекси, одлуки, решенија за годишен одмор, мерки и престанок)
 * registered by the office — per employee, with PDF and Word. Read-only.
 */
import { notFound } from 'next/navigation';
import { asc, eq } from 'drizzle-orm';
import { hrDocLabel, hrFixedTerm } from '@wise/core';
import { employees, hrDocs } from '@wise/db';
import { db } from '@/lib/db';
import { dmy, todayIso } from '@/lib/fmt';
import { Hd } from '@/components/hd';
import { klDogCtx } from './guard';

export default async function KlDogovoriPage() {
  const g = await klDogCtx();
  if (!g) notFound();
  const { firm } = g;
  const [D, E] = await Promise.all([
    db().select().from(hrDocs).where(eq(hrDocs.firmId, firm.id)).orderBy(asc(hrDocs.date)),
    db().select({ id: employees.id, name: employees.name, position: employees.position, active: employees.active }).from(employees).where(eq(employees.firmId, firm.id)).orderBy(asc(employees.name)),
  ]);
  const today = todayIso();
  const byEmp = new Map<string, typeof D>();
  for (const d of D) { const k = d.employeeId ?? `n:${d.empName}`; byEmp.set(k, [...(byEmp.get(k) ?? []), d]); }
  const rows = [...E.map((e) => ({ key: e.id, name: e.name, position: e.position, active: e.active })),
    ...[...byEmp.keys()].filter((k) => k.startsWith('n:')).map((k) => ({ key: k, name: k.slice(2), position: null, active: false }))];
  const until = (d: (typeof D)[number]) => {
    if (d.kind === 'contract' && !hrFixedTerm(d.ctype)) return <span className="pill good">неопределено</span>;
    if (!d.end) return null;
    return d.end < today ? <span className="pill bad">истечен {dmy(d.end)}</span> : <span className="pill">до {dmy(d.end)}</span>;
  };
  return (
    <>
      <Hd t="✍ Договори за вработување" sub={firm.name} exp={false} />
      {rows.map((e) => {
        const L = byEmp.get(e.key) ?? [];
        return (
          <div className="card" key={e.key}>
            <div className="hd"><b>{e.name}</b><span className="mini">{e.position ?? ''}{e.active ? '' : ' · не е активен'}</span></div>
            {L.length ? (
              <table className="dense"><thead><tr><th>Бр.</th><th>Датум</th><th>Документ</th><th>Важи</th><th></th></tr></thead>
                <tbody>{L.map((d) => (
                  <tr key={d.id}><td><b>{d.no}</b></td><td>{dmy(d.date)}</td><td>{hrDocLabel(d)}</td><td>{until(d)}</td>
                    <td style={{ whiteSpace: 'nowrap' }}><a className="btn sm" href={`/klDogovori/${d.id}`} target="_blank" rel="noopener">⬇ PDF</a> <a className="btn sm" href={`/klDogovori/${d.id}?word=1`}>📝 Word</a></td></tr>
                ))}</tbody></table>
            ) : <div className="note">Нема заведен договор – канцеларијата го подготвува.</div>}
          </div>
        );
      })}
      {!rows.length && <div className="card empty">Нема вработени.</div>}
      <p className="note">Договорите ги подготвува и заведува канцеларијата (Закон за работните односи). За нов договор, анекс или решение испратете барање преку „📤 Испрати документ“.</p>
    </>
  );
}
