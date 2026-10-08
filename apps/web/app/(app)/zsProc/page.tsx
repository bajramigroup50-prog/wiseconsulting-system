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

const ST: Record<string, string> = { draft: 'нацрт', ready: 'подготвена', submitted: 'поднесена', accepted: 'прифатена (увезена од ЦРМ)' };

export default async function ZsProcPage() {
  const c = await yePage('zsProc');
  if (!c) return <NoFirm t="Завршна сметка" />;
  const { L, u, firm, year, findings } = c;
  const V = L.Y.co.zs.V;
  const ent = L.ent;
  const res = ent === 'npo' && L.Y.npo ? { profit: L.Y.npo.sur, tax: L.Y.npo.tax } : ent !== 'co' && L.Y.tp ? { profit: L.Y.tp.res, tax: L.Y.tp.tax } : { profit: L.Y.co.zs.profit, tax: L.Y.co.db.tax };
  const cl = L.closing;
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
      <FindingsCard all={findings.all} open={findings.open} ack={L.statement?.ack ?? {}} canAck={canDo(u, 'settings', firm.id) || canDo(u, 'fix', firm.id)} />
    </>
  );
}
