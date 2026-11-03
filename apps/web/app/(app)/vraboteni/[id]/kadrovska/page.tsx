/**
 * „🎓 Кадровска евиденција“ of an employee (Helix codebooks Квалификации, Степен на образование, Странски јазици, Степен
 * на инвалидитет, Систематски прегледи, Посетени семинари, Казнени / Наградни мерки): dated records with an optional
 * „важи до“ (the next systematic check, a licence) – in `employees.data.hr`; the employee list warns when one expires.
 */
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { and, eq } from 'drizzle-orm';
import { employees } from '@wise/db';
import { canDo } from '@/lib/books';
import { db } from '@/lib/db';
import { dmy, todayIso } from '@/lib/fmt';
import { HR_KINDS, hrRecs } from '@/lib/payroll/hr-recs';
import { payPage } from '@/lib/payroll/server';
import { hrOfficeLocked } from '@/lib/hr-lock';
import { ActionForm } from '@/components/action-form';
import { RowAction } from '@/components/row-action';
import { Hd } from '@/components/hd';
import { NoFirm } from '@/components/no-firm';
import { ExportBar, type Cell } from '@/components/parity-fin/export-bar';
import { hrRecDelAction, hrRecSaveAction } from '../../hr-actions';

export default async function KadrovskaPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { u, firm } = await payPage('vraboteni');
  if (!firm) return <NoFirm t="Кадровска евиденција" />;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  if (await hrOfficeLocked(firm, u)) return <><Hd t="Кадровска евиденција" /><div className="callout bad">🔒 Само сопственикот.</div></>;
  const [e] = await db().select().from(employees).where(and(eq(employees.id, id), eq(employees.firmId, firm.id))).limit(1);
  if (!e) notFound();
  const write = canDo(u, 'write', firm.id);
  const R = hrRecs(e.data);
  const today = todayIso(), soon = new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10);
  const x: Cell[][] = [['Вид', 'Датум', 'Опис', 'Издавач / место', 'Важи до', 'Забелешка'], ...R.map((r) => [r.kind, dmy(r.date), r.title, r.issuer ?? '', r.until ? dmy(r.until) : '', r.note ?? ''])];
  return (
    <>
      <Hd t="Кадровска евиденција" sub={`${e.no ?? ''} ${e.name}${e.position ? ' · ' + e.position : ''}`}>
        <Link className="btn" href="/vraboteni">← Вработени</Link>
        <Link className="btn ghost" href={`/vraboteni/${e.id}/merki`}>⚖ Мерки и престанок</Link>
      </Hd>
      {write && (
        <ActionForm action={hrRecSaveAction} className="card">
          <input type="hidden" name="emp" value={e.id} />
          <div className="form">
            <label className="f">Вид<select name="kind">{HR_KINDS.map((k) => <option key={k}>{k}</option>)}</select></label>
            <label className="f">Датум<input name="date" type="date" defaultValue={today} /></label>
            <label className="f wide">Опис (звање, јазик и ниво, наод, тема…)<input name="title" /></label>
            <label className="f">Издавач / место<input name="issuer" /></label>
            <label className="f">Важи до / следен преглед<input name="until" type="date" /></label>
            <label className="f wide">Забелешка<input name="note" /></label>
          </div>
          <button className="btn pri">+ Додај</button>
        </ActionForm>
      )}
      {R.length ? (<>
        <div className="row"><ExportBar name={`Kadrovska_${e.name}`} title={`Кадровска евиденција – ${e.name}`} rows={x} pdf="#hrArea" /></div>
        <div className="tw" id="hrArea"><table>
          <thead><tr><th>Вид</th><th>Датум</th><th>Опис</th><th>Издавач / место</th><th>Важи до</th><th>Забелешка</th><th className="noprint" /></tr></thead>
          <tbody>{R.map((r) => (
            <tr key={r.id}><td>{r.kind}</td><td>{dmy(r.date)}</td><td>{r.title}</td><td>{r.issuer}</td>
              <td>{r.until ? <span className={'pill ' + (r.until < today ? 'bad' : r.until <= soon ? 'warn' : '')}>{dmy(r.until)}</span> : ''}</td><td>{r.note}</td>
              <td className="noprint">{write && <RowAction label="🗑" title="Избриши" confirm="Да се избрише записот?" action={hrRecDelAction.bind(null, e.id, r.id)} />}</td></tr>
          ))}</tbody>
        </table></div>
      </>) : <div className="card empty">Нема записи. Внесете образование, квалификации, јазици, систематски прегледи, семинари, мерки.</div>}
    </>
  );
}
