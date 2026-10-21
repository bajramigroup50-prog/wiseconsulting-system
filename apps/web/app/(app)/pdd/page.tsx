/**
 * Legacy `VIEWS.pdd` 8329 — Плата › Закупнина, бонуси и услуги (книжење): payments to natural persons booked as a direct
 * cost (Д трошок бруто / П обврска нето / П ПДД), net → gross. `?ed=new|<id>|last` editor (`pddEditor`, `pddCopyLast`),
 * `?types=1` income types and kontos (`pddTypesHTML`).
 */
import Link from 'next/link';
import { and, asc, desc, eq, sql } from 'drizzle-orm';
import { pddTypes, type PddRow, type PddType } from '@wise/core/finance';
import { employees, journals, partners, pddPayments } from '@wise/db';
import { booksPage, canDo } from '@/lib/books';
import { db } from '@/lib/db';
import { dmy, fmt } from '@/lib/fmt';
import { today } from '@/lib/finance';
import { ActionForm, Submit } from '@/components/action-form';
import { Hd } from '@/components/hd';
import { NoFirm } from '@/components/no-firm';
import { RowAction } from '@/components/row-action';
import { deletePddAction, importAkontAction, relinkPddAction, savePddTypesAction } from './actions';
import { PddEditor, type Person } from './editor';

export default async function PddPage({ searchParams }: { searchParams: Promise<{ ed?: string; types?: string; ok?: string; pid?: string; amt?: string; k?: string; imp?: string }> }) {
  const sp = await searchParams;
  const { u, firm, year } = await booksPage('pdd');
  if (!firm) return <NoFirm t="Закупнина, бонуси и услуги" />;
  const T = pddTypes(((firm.settings ?? {}) as { pddTypes?: Partial<PddType>[] }).pddTypes);
  const tn = (id: string) => { const t = T.find((x) => x.id === id) ?? T[0]!; return t.sh || t.pod; };
  const L = await db().select().from(pddPayments).where(and(eq(pddPayments.firmId, firm.id), sql`${pddPayments.date} between ${year + '-01-01'} and ${year + '-12-31'}`)).orderBy(desc(pddPayments.date));
  const write = canDo(u, 'pddSave', firm.id);

  if (sp.ed && write) {
    const src = sp.ed === 'last' ? L[0] : sp.ed !== 'new' ? L.find((x) => x.id === sp.ed) ?? (await db().select().from(pddPayments).where(and(eq(pddPayments.id, sp.ed), eq(pddPayments.firmId, firm.id))).limit(1))[0] : undefined;
    const [E, P] = await Promise.all([
      db().select({ name: employees.name, embg: employees.embg, acct: employees.bankAcc, active: employees.active }).from(employees).where(eq(employees.firmId, firm.id)).orderBy(asc(employees.name)),
      db().select({ id: partners.id, name: partners.name, edb: partners.edb, acct: partners.bankAccount, data: partners.data }).from(partners).where(eq(partners.firmId, firm.id)).orderBy(asc(partners.name)),
    ]);
    const people: Person[] = [
      ...E.map((e) => ({ name: e.name, embg: e.embg ?? '', acct: e.acct ?? '', pid: '', active: e.active, emp: true })),
      ...P.filter((p) => { const d = (p.data ?? {}) as { embg?: string; fl?: boolean; person?: boolean }; return !!(d.embg || d.fl || d.person); })
        .map((p) => ({ name: p.name, embg: String(((p.data ?? {}) as { embg?: string }).embg ?? p.edb ?? '').replace(/\D/g, ''), acct: p.acct ?? '', pid: p.id })),
    ];
    for (const d of L) for (const r of d.rows) if (r.embg && !people.some((x) => x.embg === r.embg)) people.push({ name: r.name, embg: r.embg, acct: r.acct, pid: r.pid ?? '' });
    const edit = sp.ed !== 'new' && sp.ed !== 'last' && src;
    const rows: PddRow[] = (src?.rows ?? []).map((r) => ({ tid: r.tid, mode: r.mode, amt: r.amt, name: r.name, embg: r.embg, acct: r.acct, pid: r.pid }));
    // from the autopilot („Недостасува пресметка“): the person and the net amount paid without a calculation, the type
    // whose obligation konto is the one paid from
    if (sp.ed === 'new' && sp.pid && /^[0-9a-f-]{36}$/i.test(sp.pid)) {
      const p = P.find((x) => x.id === sp.pid);
      const pe = people.find((x) => x.pid === sp.pid);
      const t = T.find((x) => sp.k && x.kLiab === sp.k) ?? T.find((x) => x.id === 's1_15') ?? T[0]!;
      const amt = Math.max(0, Math.round(Number(sp.amt) * 100) / 100 || 0);
      if (p) rows.push({ tid: t.id, mode: 'n', amt, name: p.name, embg: pe?.embg ?? '', acct: pe?.acct ?? p.acct ?? '', pid: p.id });
    }
    return (
      <>
        <Hd t={edit ? 'Книжење: закупнина / бонус / услуга' : 'Ново книжење: закупнина / бонус / услуга'}><Link className="btn" href="/pdd">← Листа</Link></Hd>
        {sp.imp && edit && <div className="callout good" role="status">✓ Аконтативната пресметка е прочитана и прокнижена ({src.rows.length} примачи). Проверете ги примачите и контата – ако нешто менувате, „Зачувај“ го книжи повторно.{src.rows.some((r) => !r.pid) ? ' ⚠ Некои примачи не се поврзани со комитент – изберете го комитентот, за обврската да се затвори со изводот.' : ''}</div>}
        {sp.ed === 'last' && src && <div className="callout">Копирани се примачите и износите од {dmy(src.date)} – сменете го датумот ако треба.</div>}
        <PddEditor id={edit ? src.id : undefined} date={edit ? src.date : today()} note={src?.note ?? ''} rows={rows} types={T} people={people} />
      </>
    );
  }

  const NM = new Map((await db().select({ sid: journals.sourceId, number: journals.number }).from(journals).where(and(eq(journals.firmId, firm.id), eq(journals.sourceType, 'pdd')))).map((j) => [j.sid, j.number]));
  return (
    <>
      {sp.ok && <div className="callout good" role="status">✓ Прокнижено како директен трошок.</div>}
      <Hd t="Закупнина, бонуси и услуги" sub={`автоматско книжење како директен трошок · ${year}`}>
        <Link className="btn" href={sp.types ? '/pdd' : '/pdd?types=1'}>Видови приход и конта</Link>
        {write && L.length > 0 && <Link className="btn" href="/pdd?ed=last">Нова од последната (иста закупнина)</Link>}
        {write && <Link className="btn pri" href="/pdd?ed=new">+ Ново книжење</Link>}
      </Hd>
      {write && (
        <ActionForm action={importAkontAction} className="card" reset={false}>
          <div className="row" style={{ gap: 10, alignItems: 'end', flexWrap: 'wrap' }}>
            <label className="f" style={{ margin: 0 }}>📄 Аконтативни пресметки од е-ПДД (PDF – една или повеќе)<input type="file" name="pdf" accept="application/pdf,.pdf" multiple required /></label>
            <label className="f" style={{ margin: 0 }}>Вид (контирање)<select name="tid" defaultValue=""><option value="">Автоматски – според кодот во PDF</option>{T.map((t) => <option key={t.id} value={t.id}>{t.sh || t.pod} ({t.kExp} / {t.kLiab} / {t.kTax})</option>)}</select></label>
            <Submit>Увези и прокнижи</Submit>
            <span className="mini">Изберете една или повеќе (Ctrl+A во папката). Програмата ги чита примачите и ја книжи секоја пресметка: трошок / обврска по лице / ПДД – бонуси, закупнина… Веќе увезените се прескокнуваат.</span>
          </div>
        </ActionForm>
      )}
      {write && L.length > 0 && (
        <ActionForm action={relinkPddAction} className="card" reset={false}>
          <div className="row" style={{ gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            {L.some((d) => d.rows.some((r) => !r.pid)) ? <span>⚠ {L.reduce((a, d) => a + d.rows.filter((r) => !r.pid).length, 0)} примачи без комитент – обврската (22055…) не се затвора со плаќањето од изводот.</span> : <span className="mini">Сите примачи се поврзани со комитент.</span>}
            <Submit className="btn">🔗 Поврзи ги примачите</Submit>
          </div>
        </ActionForm>
      )}
      {sp.types && (
        <ActionForm action={savePddTypesAction} reset={false}>
          <div className="hd"><h2 style={{ fontSize: 15 }}>Видови и конта за книжење</h2><Link className="btn sm" href="/pdd">✕</Link></div>
          <div className="tw"><table className="dense">
            <thead><tr><th>Кратко име</th><th>Вид приход</th><th>Подвид приход</th><th className="n">Одбитоци %</th><th className="n">ПДД %</th><th>Трошок</th><th>Обврска кон примач</th><th>Обврска ПДД</th></tr></thead>
            <tbody>{[...T, { id: 'new', sh: '', vid: '', pod: '', ded: 0, tax: 10, kExp: '4490', kLiab: '22053', kTax: '2350' }].map((t) => (
              <tr key={t.id}>
                <td><input type="hidden" name="id" value={t.id} /><input name="sh" defaultValue={t.id === 'new' ? '' : t.sh} placeholder={t.id === 'new' ? '+ нов вид' : ''} style={{ width: 150 }} /></td>
                <td><input name="vid" defaultValue={t.vid} style={{ width: 230 }} /></td><td><input name="pod" defaultValue={t.pod} style={{ width: 230 }} /></td>
                <td><input name="ded" defaultValue={t.ded} style={{ width: 70 }} /></td><td><input name="tax" defaultValue={t.tax} style={{ width: 70 }} /></td>
                <td><input name="kExp" defaultValue={t.kExp} style={{ width: 70 }} /></td><td><input name="kLiab" defaultValue={t.kLiab} style={{ width: 70 }} /></td><td><input name="kTax" defaultValue={t.kTax} style={{ width: 70 }} /></td>
              </tr>
            ))}</tbody>
          </table></div>
          <div className="row" style={{ gap: 8, marginTop: 8 }}><span style={{ flex: 1 }} />{canDo(u, 'settings', firm.id) && <button className="btn pri">Зачувај</button>}</div>
          <p className="mini">Одбитоци = нормирани трошоци (закуп 10%). Трошок / обврска / данок – контата каде се книжи. Нов вид: пополнете го последниот ред.</p>
        </ActionForm>
      )}
      {L.length ? (
        <div className="tw"><table>
          <thead><tr><th>Датум на исплата</th><th>Опис</th><th>Примачи</th><th>Вид</th><th className="n">Бруто</th><th className="n">Одбитоци</th><th className="n">ПДД</th><th className="n">Нето</th><th>Налог</th><th /></tr></thead>
          <tbody>{L.map((d) => (
            <tr key={d.id}>
              <td>{dmy(d.date)}</td><td>{d.note}</td><td>{d.rows.map((r) => r.name).join(', ').slice(0, 80)}</td>
              <td className="mini">{[...new Set(d.rows.map((r) => tn(r.tid)))].join(', ')}</td>
              <td className="n">{fmt(Number(d.gross))}</td><td className="n">{fmt(Number(d.deductions))}</td><td className="n">{fmt(Number(d.tax))}</td><td className="n"><b>{fmt(Number(d.net))}</b></td>
              <td>{NM.get(d.id) && <Link className="btn sm ghost" href={`/nalozi?n=${encodeURIComponent(NM.get(d.id)!)}`}>{NM.get(d.id)}</Link>}</td>
              <td style={{ whiteSpace: 'nowrap' }}>
                {write && <Link className="btn sm" href={`/pdd?ed=${d.id}`}>Отвори</Link>}
                <a className="btn sm" href={`/print/fin/pdd?id=${d.id}`} target="_blank" rel="noopener">PDF</a>
                {canDo(u, 'del', firm.id) && <RowAction label="🗑" title="Избриши" confirm={`Да се избрише книжењето од ${dmy(d.date)} (и нејзиното книжење)?`} action={deletePddAction.bind(null, d.id)} />}
              </td>
            </tr>
          ))}</tbody>
        </table></div>
      ) : <div className="card empty">Нема книжења за {year}. Притиснете „+ Ново книжење“ – закупнина, бонуси или други услуги од физички лица.</div>}
      <p className="note">Секое книжење оди директно на трошок: трошок (Д) / обврска кон примачот – нето (П) / обврска за персонален данок (П). Нето → бруто со нормирани трошоци и данок 10%, заокружено на денар. Конта и проценти: „Видови и конта“.</p>
    </>
  );
}
