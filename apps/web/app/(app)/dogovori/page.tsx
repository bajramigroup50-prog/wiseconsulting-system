/** Legacy `VIEWS.dogovori` 6099 (Евиденција на договори — HR registry) + annual leave / sick leave entries. */
import Link from 'next/link';
import { asc, eq } from 'drizzle-orm';
import { hrDocLabel, hrFixedTerm } from '@wise/core';
import { hrDocs, loadPaySettings, nextHrDocNo } from '@wise/db';
import { canDo } from '@/lib/books';
import { db } from '@/lib/db';
import { hrOwnDocIds } from '@/lib/own-template';
import { dmy } from '@/lib/fmt';
import { firmEmployees, payPage } from '@/lib/payroll/server';
import { Hd } from '@/components/hd';
import { NoFirm } from '@/components/no-firm';
import { LeaveForm, PrefixForm } from './forms';

const KINDS = [['', 'сите'], ['contract', 'Договори'], ['annex', 'Анекси'], ['odluka', 'Одлуки'], ['di', 'Мерки и престанок'], ['leave', 'Годишни одмори'], ['sick', 'Боледувања']] as const;

export default async function DogovoriPage({ searchParams }: { searchParams: Promise<{ q?: string; kind?: string; nov?: string }> }) {
  const sp = await searchParams;
  const { u, firm, year } = await payPage('dogovori');
  if (!firm) return <NoFirm t="Евиденција на договори" />;
  const [all, emps, ps, nextNo] = await Promise.all([
    db().select().from(hrDocs).where(eq(hrDocs.firmId, firm.id)).orderBy(asc(hrDocs.date)),
    firmEmployees(firm.id),
    loadPaySettings(db(), firm.id),
    db().transaction((tx) => nextHrDocNo(tx, firm.id, `${year}-${new Date().toISOString().slice(5, 10)}`)),
  ]);
  const today = new Date().toISOString().slice(0, 10), soon = new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10);
  const q = (sp.q ?? '').trim().toLowerCase();
  const kind = sp.kind ?? '';
  const R = all.filter((d) => d.date.startsWith(String(year)) && (!kind || (kind === 'di' ? d.kind.startsWith('di-') : d.kind === kind))
    && (!q || `${d.no} ${d.empName} ${d.position ?? ''}`.toLowerCase().includes(q)))
    .sort((a, b) => (parseInt(a.no.replace(/^\D+/, '')) || 0) - (parseInt(b.no.replace(/^\D+/, '')) || 0));
  const ownW = await hrOwnDocIds(R);
  const E = new Map(emps.map((e) => [e.id, e]));
  const status = (d: (typeof all)[number]) => {
    if (d.kind === 'leave' || d.kind === 'sick') return <span className="pill">{dmy(d.start)}–{dmy(d.end)} · {Number(d.days)} дена</span>;
    if (d.kind.startsWith('di-')) return d.end ? <span className="pill warn">престанок {dmy(d.end)}</span> : null;
    const later = all.filter((x) => x.employeeId === d.employeeId && (x.kind === 'annex' || x.kind === 'odluka')
      && (d.kind === 'contract' ? x.refNo === d.no : x.date > d.date || (x.date === d.date && (parseInt(x.no) || 0) > (parseInt(d.no) || 0))))
      .sort((a, b) => (a.date < b.date ? 1 : -1))[0];
    if (later) return <span className="pill info">{later.transform ? 'трансформиран' : 'продолжен'} со бр. {later.no}</span>;
    if (!d.end) return (d.kind === 'contract' && !hrFixedTerm(d.ctype)) || d.transform ? <span className="pill good">неопределено</span> : null;
    return d.end < today ? <span className="pill bad">истечен {dmy(d.end)}</span> : d.end <= soon ? <span className="pill warn">истекува {dmy(d.end)}</span> : <span className="pill">важи до {dmy(d.end)}</span>;
  };
  const write = canDo(u, 'write', firm.id);
  return (
    <>
      <Hd t="Евиденција на договори" sub={'деловодник за вработени · ' + year}>
        <Link className="btn" href="/vraboteni">Вработени</Link>
        {write && <Link className="btn pri" href="/dogovori?nov">+ Годишен одмор / боледување</Link>}
      </Hd>
      {write && <PrefixForm prefix={ps.hrPrefix ?? ''} />}
      {sp.nov !== undefined && write && <LeaveForm employees={emps.filter((e) => e.active).map((e) => ({ id: e.id, name: e.name }))} nextNo={nextNo} />}
      <form className="card"><div className="row" style={{ gap: '10px 16px', alignItems: 'end' }}>
        <input name="q" defaultValue={sp.q ?? ''} placeholder="Барај број, вработен, работно место…" style={{ width: 280 }} />
        <label className="mini">Вид <select name="kind" defaultValue={kind} style={{ width: 'auto' }}>{KINDS.map(([k, n]) => <option key={k} value={k}>{n}</option>)}</select></label>
        <button className="btn">Филтрирај</button>
      </div></form>
      {R.length ? (
        <div className="tw"><table>
          <thead><tr><th>Дел. број</th><th>Датум</th><th>Вработен</th><th>Документ</th><th>Работно место</th><th>Од</th><th>Статус</th><th></th></tr></thead>
          <tbody>{R.map((d) => {
            const e = d.employeeId ? E.get(d.employeeId) : undefined;
            const isLast = d.kind !== 'leave' && d.kind !== 'sick' && !d.kind.startsWith('di-') && e?.contract === 'определено' && e.end && d.end === e.end;
            return (
              <tr key={d.id}>
                <td><b className="num">{d.no}</b></td><td>{dmy(d.date)}</td><td>{d.empName}</td>
                <td>{hrDocLabel(d)}{d.refNo && <><br /><small className="note">кон договор бр. {d.refNo}</small></>}</td>
                <td>{d.position}</td><td>{dmy(d.start)}</td><td>{status(d)}</td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  {isLast && write && <Link className="btn sm pri" href={`/vraboteni/${d.employeeId}/dogovor#prodolzi`}>Продолжи</Link>}{' '}
                  <a className="btn sm" href={`/dogovori/${d.id}`} target="_blank" rel="noopener">PDF</a>{' '}
                  {ownW.has(d.id) && <><a className="btn sm" href={`/dogovori/${d.id}?word=1`} title="Word од сопствениот шаблон">📝 Word</a>{' '}</>}
                  {d.employeeId && <Link className="btn sm" href={d.kind.startsWith('di-') ? `/vraboteni/${d.employeeId}/merki` : `/vraboteni/${d.employeeId}/dogovor`}>Отвори</Link>}
                </td>
              </tr>
            );
          })}</tbody>
        </table></div>
      ) : <div className="card empty">Нема заведени документи за {year}. Договорите, анексите, одлуките и мерките се заведуваат автоматски со број кога ќе ги зачувате (Вработени → Договор / ⚖).</div>}
      <p className="note">Бројот се доделува автоматски по ред за годината ({nextNo} е следниот). Може да го внесете рачно пред да зачувате; ист број не може да се употреби двапати. Контролниот код на документот е запишан во евиденцијата.</p>
      <p className="mini">Вкупно во евиденцијата (сите години): {all.length} документи.</p>
    </>
  );
}
