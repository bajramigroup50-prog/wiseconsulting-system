/**
 * Legacy `VIEWS.zsProc` (11178 + 11237 + 17093) — Финансово › Завршна сметка › 📋 Завршна сметка – по фази.
 * FIX(P8 #5): legacy reassigned the view at 11178 and lost the 11089 body and the "6. Досие" wrapper 11140; this is
 * one screen: phase bar, the year's status and the phase gate.
 */
import Link from 'next/link';
import { YE_ENTITY_NAMES } from '@wise/core';
import { canDo } from '@/lib/books';
import { dmy, fmt } from '@/lib/fmt';
import { phaseDone, yePage } from '@/lib/yearend';
import { NoFirm } from '@/components/no-firm';
import { FindingsCard } from '@/components/yearend/findings';
import { NotClosedNote, ZsHead } from '@/components/yearend/ph-bar';
import { RowAction } from '@/components/row-action';
import { ActionForm } from '@/components/yearend/action-form';
import { YearGo } from '@/components/yearend/year-go';
import { archiveNotesAction, setCrmPeriodAction } from './actions';

function Card({ t, ok, href, children }: { t: string; ok: boolean | null; href: string; children?: React.ReactNode }) {
  return (
    <div className="card">
      <div className="hd"><h2 style={{ fontSize: 15, margin: 0 }}>{t}</h2>
        <div className="row">{ok === true ? <span className="pill good">✓</span> : ok === false ? <span className="pill warn">…</span> : null}<Link className="btn sm" href={href}>Отвори →</Link></div></div>
      {children}
    </div>
  );
}

const ST: Record<string, string> = { draft: 'нацрт', ready: 'подготвена', submitted: 'поднесена', accepted: 'прифатена (увезена од ЦРМ)' };

export default async function ZsProcPage() {
  const c = await yePage('zsProc');
  if (!c) return <NoFirm t="Завршна сметка" />;
  const { L, u, firm, year, findings } = c;
  const V = L.Y.co.zs.V;
  const ent = L.ent;
  const res = ent === 'npo' && L.Y.npo ? { profit: L.Y.npo.sur, tax: L.Y.npo.tax } : ent !== 'co' && L.Y.tp ? { profit: L.Y.tp.res, tax: L.Y.tp.tax } : { profit: L.Y.co.zs.profit, tax: L.Y.co.db.tax };
  const cl = L.closing;
  const write = canDo(u, 'write', firm.id);
  const zsArch = ((firm.settings ?? {}) as { zsArch?: Record<string, { at: string }> }).zsArch ?? {};
  const prevA = zsArch[String(year - 1)];
  const hasPrev = Object.values(L.prev.V).some((v) => Math.round(v || 0) !== 0) || (!!L.prevStatement && Object.keys(L.prevStatement.zsMan).length > 0);
  const EUR = 61.5;
  const fi = (v: number) => Math.round(v).toLocaleString('de-DE');
  const sz = { emp: Math.round(V.bu257 || 0), inc: Math.round((V.bu201 || 0) + (V.bu223 || 0) + (V.bu244 || 0) + (V.bu248 || 0)), ast: Math.round(V.bs063 || 0) };
  const steps: [boolean, React.ReactNode, string?][] = [
    [findings.open.length === 0, findings.open.length ? `${findings.open.length} наоди за средување` : 'Контролата е чиста', '/zsKontrola'],
    ...(ent === 'co' ? [[!!L.statement && Object.keys(L.statement.dbAdj).length > 0, `Даночен биланс: данок ${fmt(L.Y.co.db.tax)} ден.`, '/zs_db'] as [boolean, React.ReactNode, string]] : []),
    [!!L.closeJournal, L.closeJournal ? `Затворена (налог ${L.closeJournal.number}${cl?.imported ? ', од увезен бруто биланс' : ''})` : 'Годината не е затворена', '/mbyllja'],
    [!!L.statement && Object.keys(L.statement.notes).length > 0, 'Објаснувачки белешки', '/zsBel'],
    [!!L.statement && ['submitted', 'accepted'].includes(L.statement.status), `Годишна сметка: ${ST[L.statement?.status ?? 'draft']}`, '/zsXml'],
    [!!L.openJournal, L.openJournal ? `Пренесено во ${year + 1} (налог ${L.openJournal.number})` : `Почетна состојба ${year + 1} не е пренесена`, '/prenos'],
    [L.locked, L.locked ? `Заклучена (до ${dmy(firm.lockDate)})` : 'Не е заклучена', '/prenos'],
  ];
  return (
    <>
      <ZsHead id="zsProc" t="Завршна сметка – по фази" year={year} ent={ent} done={phaseDone(L)} />
      <NotClosedNote closed={L.Y.closed} year={year} />
      <div className="cols">
        <div className="card">
          <h2>Состојба {year}</h2>
          <p className="note" style={{ margin: '0 0 8px' }}>Вид на субјект: <b>{YE_ENTITY_NAMES[ent]}</b>{firm.legalForm ? '' : ' (погоден од називот – поставете правна форма во „Фирми“)'}</p>
          <ul className="steps">
            {steps.map(([ok, t, href], i) => (
              <li key={i}>{ok ? <span className="pill good">✓</span> : <span className="pill warn">!</span>} <span>{t} {href && <Link className="btn sm" href={href}>Отвори</Link>}</span></li>
            ))}
          </ul>
        </div>
        <div className="tw"><table><tbody>
          <tr className="sub"><td colSpan={2}>Резултат {year}</td></tr>
          <tr><td>{res.profit >= 0 ? 'Добивка' : 'Загуба'} пред оданочување</td><td className="n">{fmt(res.profit)}</td></tr>
          <tr><td>Данок {cl?.closedAt ? '(од затворањето)' : '(пресметан)'}</td><td className="n">{fmt(cl?.tax ?? res.tax)}</td></tr>
          <tr className="tot"><td>Нето резултат</td><td className="n">{fmt(cl?.net ?? res.profit - res.tax)}</td></tr>
          {ent !== 'npo' && <>
            <tr className="sub"><td colSpan={2}>Биланс на состојба</td></tr>
            <tr><td>Актива (АОП 063)</td><td className="n">{fmt(V.bs063)}</td></tr>
            <tr><td>Пасива (АОП 111)</td><td className="n">{fmt(V.bs111)}</td></tr>
            <tr><td>Просечен број вработени (АОП 257)</td><td className="n">{V.bu257 ?? 0}</td></tr>
          </>}
        </tbody></table></div>
      </div>
      <FindingsCard all={findings.all} open={findings.open} ack={L.statement?.ack ?? {}} canAck={canDo(u, 'settings', firm.id) || canDo(u, 'fix', firm.id)} canDist={canDo(u, 'fix', firm.id)} />
      <div className="callout">Одете по ред: 1 → 8. Секоја фаза се отвора од лентата горе или со „Отвори →“.</div>
      <Card t="1. Контрола" ok={findings.open.length === 0} href="/zsKontrola"><p className="mini" style={{ margin: 0 }}>Бруто биланс, логика на салдата по класи, нераспоредени конта и контролите на ЦРМ{findings.open.length ? <> – <b>{findings.open.length} наод(и)</b></> : ' – сè во ред'}.</p></Card>
      {ent === 'co' && <Card t="2. Даночен биланс" ok={!!L.statement && Object.keys(L.statement.dbAdj).length > 0} href="/zs_db"><p className="mini" style={{ margin: 0 }}>Данок на добивка {fmt(L.Y.co.db.tax)} ден.</p></Card>}
      <Card t="3. Затворање 4/7 → 8 → 9" ok={L.Y.closed} href="/mbyllja"><p className="mini" style={{ margin: 0 }}>{L.Y.closed ? `Затворено: нето ${Number(cl?.net ?? 0) >= 0 ? 'добивка' : 'загуба'} ${fmt(Math.abs(Number(cl?.net ?? 0)))}, данок ${fmt(Number(cl?.tax ?? 0))}.` : 'Годината не е затворена.'}</p></Card>
      {ent !== 'npo' && ent !== 'sd' && (
        <Card t="4. Биланси и обрасци" ok={null} href="/zs_bs">
          <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}><Link className="btn sm" href="/zs_bs">Биланс на состојба</Link><Link className="btn sm" href="/zs_bu">Биланс на успех</Link>{(ent === 'co' || ent === 'tp') && <><Link className="btn sm" href="/zs_de">Образец 38</Link><Link className="btn sm" href="/zs_sp">Образец 35</Link></>}</div>
          <p className="mini" style={{ margin: '6px 0 0' }}>Години водени во друга програма: во Билансот на состојба → „📥 Увези од поднесена годишна сметка“.</p>
        </Card>
      )}
      <Card t={`5. Објаснувачки белешки (${year} и ${year - 1})`} ok={!!L.statement && Object.keys(L.statement.notes).length > 0} href="/zsBel">
        <p className="mini" style={{ margin: '0 0 6px' }}>Белешките ги имаат двете години. {prevA ? `Белешките за ${year - 1} се зачувани (${dmy(String(prevA.at).slice(0, 10))}).` : hasPrev ? `Прво зачувајте ги белешките за ${year - 1} – нивните износи стануваат „претходна година“.` : `За ${year - 1} нема податоци – внесете ги износите и текстот на белешките за ${year - 1}.`}</p>
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          {hasPrev && write && <RowAction className={`btn sm${prevA ? '' : ' pri'}`} action={archiveNotesAction.bind(null, year - 1)} label={`${prevA ? '↻ ' : '📦 '}Зачувај белешки ${year - 1}`}
            confirm={`Да се зачуваат објаснувачките белешки за ${year - 1} (износите за следната година)?`} />}
          <YearGo year={year - 1} to="/zs_bs">📥 Износи {year - 1}</YearGo>
          <YearGo year={year - 1} to="/zsBel">Белешки {year - 1}{L.prevStatement && Object.keys(L.prevStatement.notes).length ? ' ✓' : ''}</YearGo>
          <Link className="btn sm" href="/pecati/bel" target="_blank">⬇ PDF белешки {year}</Link>
        </div>
      </Card>
      {ent === 'co' && (
        <Card t="6. XML и поднесување" ok={null} href="/zsXml">
          <div className="row" style={{ gap: 10, flexWrap: 'wrap', alignItems: 'end' }}>
            {write && <ActionForm action={setCrmPeriodAction} submit="Зачувај" className="row">
              <label className="f" style={{ margin: 0 }}>Period (ЦРМ, 0–4)<select name="crmPeriod" defaultValue={String(L.statement?.crmPeriod ?? 1)} style={{ width: 'auto' }}>{[0, 1, 2, 3, 4].map((v) => <option key={v} value={v}>{v}</option>)}</select></label>
            </ActionForm>}
            <Link className="btn pri" href="/zsXml">⬇ XML за ЦРМ</Link>
            <Link className="btn" href="/pecati/db" target="_blank">⬇ ДБ (PDF)</Link>
            <Link className="btn" href="/pecati/bel" target="_blank">⬇ Белешки (PDF)</Link>
          </div>
          <p className="mini" style={{ margin: '6px 0 0' }}>Вработени {sz.emp} · приход {fmt(sz.inc)} ден. (≈ {fi(sz.inc / EUR)} €) · актива {fmt(sz.ast)} ден. (≈ {fi(sz.ast / EUR)} €). Ред: 1. ДБ во УЈП → 2. годишна сметка + белешки во ЦРМ.</p>
        </Card>
      )}
      <Card t="7. Досие на годината" ok={null} href="/zsDos"><p className="mini" style={{ margin: 0 }}>Сите датотеки на годината (XML, биланси, белешки, ДБ) и потврдите од ЦРМ и УЈП – „💾 Зачувај ги датотеките за {year}“.</p></Card>
      <Card t="8. Нова година" ok={!!L.openJournal} href="/prenos">
        <p className="mini" style={{ margin: 0 }}>По поднесувањето: зачувајте ги белешките за {year} ({write ? <RowAction className="btn sm" action={archiveNotesAction.bind(null, year)} label={`📦 Зачувај белешки ${year}`} confirm={`Да се зачуваат објаснувачките белешки за ${year} (износите за следната година)?`} /> : `📦 Зачувај белешки ${year}`}), заклучете ја годината и пренесете ја почетната состојба во {year + 1}.</p>
      </Card>
    </>
  );
}
