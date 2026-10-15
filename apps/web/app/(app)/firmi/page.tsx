/**
 * Фирми — legacy `VIEWS.firmi` with its patches: list (Фирма · ЕДБ · ДДВ · Заклучено до + 🔓 Отклучи),
 * row actions Отвори / Измени / Избриши (6887), „📷 Нова фирма од решение“ (10614), the firm report card
 * „🖨 Извештај за фирмите“ with filter, examples, PDF and Excel (12074), Excel template / import (6887), the editor
 * with every tab (`firm-form.tsx`). Server additions: search, ⬇ Извоз (re-importable Excel), archived firms.
 */
import Link from 'next/link';
import { asc, eq, ilike, inArray, or, sql, and } from 'drizzle-orm';
import { can } from '@wise/core';
import { DEMO_MAX_FIRMS } from '@wise/core/demo';
import { FR_F, frList, isFrFilter } from '@wise/core/firms/firmform';
import { firmActiveIn, firmFromYear, firmToYear } from '@wise/core/firms/years';
import { demoFirmCount, demoFirmSql, firmFirstDataYears, firmInYearSql, firmLastDataYears, firms } from '@wise/db';
import { requireUser } from '@/lib/auth';
import { currentFirm, currentYear } from '@/lib/context';
import { db } from '@/lib/db';
import { Hd, dmy } from '@/components/hd';
import { FirmForm } from './firm-form';
import { openFirm, restoreFirm, unlockFirm } from './actions';
import { ConfirmButton } from './confirm-button';
import { firmListSql, isDemoUser } from '@/lib/demo';
import { isOfficeOwner } from '@/lib/office-owner';

type Sp = { q?: string; edit?: string; nova?: string; f?: string; ex?: string; arh?: string; sve?: string };

export default async function FirmiPage({ searchParams }: { searchParams: Promise<Sp> }) {
  const sp = await searchParams;
  const u = await requireUser();
  const [cur, year] = await Promise.all([currentFirm(u), currentYear()]);
  // „Прикажи ги сите години“: by default only the firms working in the selected year (`@wise/core/firms/years`)
  const allYears = sp.sve !== undefined && sp.sve !== '0';
  const q = (sp.q ?? '').trim();
  const fk = isFrFilter(sp.f) ? sp.f : 'all';
  const withEx = sp.ex !== '0';
  const admin = u.role === 'admin';
  // the archive of deleted firms is the real office's — never for a demo admin
  const realAdmin = admin && !isDemoUser(u);
  // 🎭 a demo user creates demo firms only („ДЕМО – …“), at most DEMO_MAX_FIRMS in total; they go away at the demo reset
  const meDemo = isDemoUser(u);
  const nDemo = meDemo ? await demoFirmCount(db()) : 0;

  // 🎭 demo firms are never in the normal list (a demo user sees only them); the owner gets them in a separate „ДЕМО“ group
  const scoped = firmListSql(u);
  const demoGroup = await isOfficeOwner(u).catch(() => false)
    ? await db().select().from(firms).where(and(demoFirmSql, eq(firms.active, true))).orderBy(asc(firms.name))
    : [];
  const search = q ? or(ilike(firms.name, `%${q}%`), ilike(firms.edb, `%${q}%`), ilike(firms.embs, `%${q}%`), ilike(firms.city, `%${q}%`), ilike(firms.code, `%${q}%`)) : undefined;

  const all = await db().select().from(firms).where(and(scoped, eq(firms.active, true), allYears ? undefined : firmInYearSql(year))).orderBy(asc(firms.name));
  const nOther = allYears ? 0 : ((await db().select({ n: sql<number>`count(*)::int` }).from(firms).where(and(scoped, eq(firms.active, true))))[0]?.n ?? 0) - all.length;
  const fdy = await firmFirstDataYears(db(), all.map((f) => f.id));
  const ldy = allYears ? await firmLastDataYears(db(), all.map((f) => f.id)) : new Map<string, number>();
  const yrs = (f: typeof all[number]) => { const a = firmFromYear(f, fdy.get(f.id)), b = firmToYear(f); return `${a}–${b ?? ''}`; };
  const archived = realAdmin && sp.arh !== undefined ? await db().select().from(firms).where(eq(firms.active, false)).orderBy(asc(firms.name)) : [];
  const nArch = realAdmin ? (await db().select({ n: sql<number>`count(*)::int` }).from(firms).where(eq(firms.active, false)))[0]?.n ?? 0 : 0;
  const ex = (f: typeof all[number]) => (f.settings as { example?: boolean }).example === true;
  const R = all.map((f) => ({ ...f, example: ex(f) }));
  const shown = new Set(frList(R, fk, withEx).map((f) => f.id));
  const matchQ = q ? new Set((await db().select({ id: firms.id }).from(firms).where(and(scoped, search))).map((r) => r.id)) : null;
  const rows = R.filter((f) => shown.has(f.id) && (!matchQ || matchQ.has(f.id)));

  const editId = sp.edit;
  const draft = editId ? (await db().select().from(firms).where(eq(firms.id, editId)).limit(1))[0] : undefined;
  const draftFrom = draft ? firmFromYear(draft, (await firmFirstDataYears(db(), [draft.id])).get(draft.id)) : new Date().getFullYear();
  const showForm = (sp.nova !== undefined && can(u.principal, 'newFirm')) || (draft && can(u.principal, 'saveFirm', draft.id));
  const office = all.find((f) => (f.settings as { officeFirm?: boolean }).officeFirm) ?? null;
  const ds = (draft?.settings ?? {}) as { officeFirm?: boolean; kdog?: { no?: string } };
  const withFee = !!showForm && u.role !== 'klient' && can(u.principal, 'office') && !ds.officeFirm && office?.id !== draft?.id;
  const feeNote = `Секој месец (последен работен ден) автоматски се издава фактура до оваа фирма${office ? ` од ${office.name}` : ''}.${ds.kdog?.no ? ` Договор ${ds.kdog.no}.` : ''}`;
  const n = (k: (typeof FR_F)[number][0]) => frList(R, k, withEx).length;
  const qs = (o: Partial<Sp>) => '?' + new URLSearchParams(Object.entries({ q, f: fk, ex: withEx ? '1' : '0', sve: allYears ? '1' : undefined, ...o }).filter(([, v]) => v !== undefined && v !== '') as [string, string][]).toString();

  return (
    <>
      <Hd t="Фирми" sub={allYears ? `${all.length} фирми · сите години` : `${all.length} фирми активни во ${year}`}>
        {can(u.principal, 'firms') && <>
          <a className="btn" href="/firmi/izvoz" title="Сите фирми во Excel, во колоните што ги чита увозот">⬇ Извоз</a>
          <a className="btn" href="/firmiImp/obrazec" title="Празен Excel образец со сите колони за фирми">⬇ Excel образец</a>
          <Link className="btn" href="/firmiImp" title="Excel со листа на фирми (на пр. извоз од друга програма: Име на фирма, Жиро сметка, Матичен број, Даночен…)">📥 Увоз од Excel</Link>
          <Link className="btn pri" href="/firmiResh" title="Скенирајте решение од ЦРМ – фирмата се внесува сама">📷 Нова фирма од решение</Link>
          <Link className="btn" href="/firmi/kirilica">🔧 Поправка на увезени фирми</Link>
        </>}
        {can(u.principal, 'newFirm') && (meDemo
          ? nDemo < DEMO_MAX_FIRMS && <Link className="btn pri" href="/firmi?nova">+ Нова фирма (демо)</Link>
          : <Link className="btn pri" href="/firmi?nova">+ Нова фирма</Link>)}
      </Hd>
      {meDemo && <div className="callout warn">🎭 Демо фирми: <b>{nDemo} / {DEMO_MAX_FIRMS}</b>. Новата фирма се зачувува како „ДЕМО – …“ и се брише при ресетирање на демото (секоја ноќ или рачно).</div>}
      {showForm && <FirmForm key={draft?.id ?? 'new'} firm={draft ?? null} fromYearDef={draftFrom} withFee={withFee} feeNote={feeNote} canDelete={admin} canResh={can(u.principal, 'firms')} />}
      {!showForm && <>
        <div className="row" style={{ gap: 8, alignItems: 'center', margin: '0 0 8px', flexWrap: 'wrap' }}>
          {allYears
            ? <><span className="pill">Сите години</span><Link className="btn sm" href={`/firmi${qs({ sve: undefined })}`}>Само фирмите активни во {year}</Link></>
            : <><span className="pill good">Година {year}</span>
              <Link className="btn sm ghost" href={`/firmi${qs({ sve: '1' })}`} title="Фирмите што не работат во избраната година (почнуваат подоцна или се затворени)">Прикажи ги сите години{nOther > 0 ? ` (уште ${nOther})` : ''}</Link></>}
          <span className="mut mini">Фирмата се гледа во годините од „Активна од година“ до „До година (затворена)“ (Измени → ДДВ и години).</span>
        </div>
        {all.length > 0 && (
          <form className="card" style={{ padding: '10px 14px' }}>
            <div className="row" style={{ gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
              <b>🖨 Извештај за фирмите</b>
              <label className="mini">Прикажи <select name="f" defaultValue={fk} style={{ width: 'auto' }}>{FR_F.map(([k, t]) => <option key={k} value={k}>{t} ({n(k)})</option>)}</select></label>
              <input type="hidden" name="ex" value="0" />
              {allYears && <input type="hidden" name="sve" value="1" />}
              <label className="chk"><input type="checkbox" name="ex" value="1" defaultChecked={withEx} /> вклучи примери</label>
              <input name="q" defaultValue={q} placeholder="🔍 Назив, ЕДБ, ЕМБС, шифра или град…" style={{ flex: 1, minWidth: 200 }} />
              <button className="btn">Прикажи</button>
              <span style={{ flex: 1 }} />
              <a className="btn pri" style={{ fontWeight: 700 }} href={`/print/firmi${qs({})}`} target="_blank">🖨 PDF</a>
              <a className="btn" href={`/firmi/izvestaj${qs({})}`}>Excel</a>
            </div>
          </form>
        )}
        {all.length ? (
          <div className="tw">
            <table>
              <thead><tr><th>Фирма</th><th>ЕДБ</th><th>ДДВ</th><th title="Години во кои фирмата работи">Години</th><th>Заклучено до</th><th></th></tr></thead>
              <tbody>
                {rows.map((f) => (
                  <tr key={f.id}>
                    <td>{f.code && <span className="mut">{f.code} · </span>}{f.name}{f.example && <> <span className="pill warn">пример</span></>}{f.id === cur?.id && <> <span className="pill good">тековна</span></>}
                      {allYears && !firmActiveIn(f, year, fdy.get(f.id), ldy.get(f.id)) && <> <span className="pill warn">не е активна во {year}</span></>}</td>
                    <td>{f.edb ?? ''}</td>
                    <td>{f.vatRegistered ? 'Да · ' + (f.vatPeriod === 'month' ? 'месечно' : 'тримесечно') : 'Не'}</td>
                    <td className="mut">{yrs(f)}</td>
                    <td>{f.lockDate ? dmy(f.lockDate) : '—'}
                      {f.lockDate && admin && <form action={unlockFirm} style={{ display: 'inline' }}>
                        <input type="hidden" name="id" value={f.id} />{' '}
                        <ConfirmButton className="btn sm ghost" title="Отклучи (за корекција / бришење)"
                          msg={`Фирмата „${f.name}“ е заклучена до ${dmy(f.lockDate)}.\n\nДа се отклучи ${f.lockDate.slice(0, 4)}? Заклучувањето се враќа до 31.12.${Number(f.lockDate.slice(0, 4)) - 1}, па документите и налозите од ${f.lockDate.slice(0, 4)} може да се менуваат и бришат.\n(По корекцијата заклучете ја годината повторно.)`}>🔓 Отклучи</ConfirmButton>
                      </form>}
                    </td>
                    <td className="row" style={{ gap: 4, flexWrap: 'nowrap' }}>
                      <form action={openFirm}><input type="hidden" name="id" value={f.id} /><button className="btn sm">Отвори</button></form>
                      {can(u.principal, 'saveFirm', f.id) && <Link className="btn sm" href={`/firmi?edit=${f.id}`}>Измени</Link>}
                      {admin && <Link className="btn sm ghost danger" href={`/firmi?edit=${f.id}#del`} title="Бришењето е во картичката на фирмата (две потврди)">Избриши</Link>}
                    </td>
                  </tr>
                ))}
                {!rows.length && <tr><td colSpan={6} className="mut">{q ? `Нема фирма што одговара на „${q}“.` : 'Нема фирми за избраниот филтер.'}</td></tr>}
              </tbody>
            </table>
          </div>
        ) : nOther > 0
          ? <div className="card empty">Нема фирми активни во {year}. <Link href={`/firmi${qs({ sve: '1' })}`}>Прикажи ги сите години ({nOther})</Link> и кај фирмата внесете „Активна од година“.</div>
          : <div className="card empty">Додадете ја вашата фирма. Сметководствено биро тука ги додава сите клиенти.</div>}
        {demoGroup.length > 0 && (
          <div className="card" style={{ marginTop: 10 }}><h2>🎭 ДЕМО</h2><p className="note">Демо фирмите за презентација – не се дел од канцеларијата (извештаи, рокови, фактурирање).</p>
            <div className="tw"><table><tbody>
              {demoGroup.map((f) => <tr key={f.id}><td>{f.name}</td><td>{f.edb ?? ''}</td><td><form action={openFirm}><input type="hidden" name="id" value={f.id} /><button className="btn sm">Отвори</button></form></td></tr>)}
            </tbody></table></div>
          </div>
        )}
        {realAdmin && nArch > 0 && (
          <div style={{ marginTop: 10 }}>
            {sp.arh === undefined ? <Link className="btn sm ghost" href="/firmi?arh">🗄 Неактивни фирми ({nArch})</Link> : (
              <div className="card"><h2>🗄 Неактивни фирми</h2><p className="note">Неактивните фирми не се гледаат во работата – книгите и документите се чуваат и фирмата може повторно да се активира.</p>
                <div className="tw"><table><thead><tr><th>Фирма</th><th>ЕДБ</th><th></th></tr></thead><tbody>
                  {archived.map((f) => <tr key={f.id}><td>{f.name}</td><td>{f.edb ?? ''}</td><td><form action={restoreFirm}><input type="hidden" name="id" value={f.id} /><button className="btn sm">▶ Активирај</button></form></td></tr>)}
                </tbody></table></div>
              </div>
            )}
          </div>
        )}
      </>}
    </>
  );
}
