/**
 * Legacy `VIEWS.mbyllja` 6694 (+ 11176 phase bar), `closeYear` 6732, ACT `closeYear` (zcGate 11233) / `undoClose` 7380
 * and the imported-trial-balance close (`obRebuild` 17158) — phase 3 "Затворање".
 *
 * The close is the year-end engine's `yeClosePlan` (entity-aware): the tax is the ДБ AOP 56 (or ДБ-ВП / ДЛД-ДБ / NPO),
 * never the legacy fallback `r2(10 %)` (FIX P8 #8 / R2). It replaces the Phase 2 stopgap on "Почетна состојба".
 */
import Link from 'next/link';
import { yeClosePlan, type YeTaxSource } from '@wise/core';
import { canDo } from '@/lib/books';
import { dmy, fmt } from '@/lib/fmt';
import { phaseDone, yePage } from '@/lib/yearend';
import { NoFirm } from '@/components/no-firm';
import { RowAction } from '@/components/row-action';
import { ActionForm } from '@/components/yearend/action-form';
import { ZsHead } from '@/components/yearend/ph-bar';
import { closeYearAction, importPostCloseTbAction, undoCloseAction } from '../zsProc/actions';

const TAX_SRC: Record<YeTaxSource, [string, string?]> = {
  db: ['Данокот се зема од Даночниот биланс (ДБ): даночна основа АОП 49, данок АОП 56', '/zs_db'],
  vp: ['Фирмата е обврзник на ДБ-ВП: данокот е 1 % од вкупниот приход (АОП 06)', '/zs_vp'],
  dld: ['Трговец поединец / самостојна дејност: данокот е од ДЛД-ДБ', '/zsTP'],
  npo: ['Непрофитна организација: 1 % на приходите од стопанска дејност над 1.000.000 ден.', '/zsNPO'],
};

export default async function MbylljaPage() {
  const c = await yePage('mbyllja');
  if (!c) return <NoFirm t="Затворање на година" />;
  const { L, u, firm, year, findings } = c;
  const plan = yeClosePlan({
    year, ent: L.ent, inputs: L.inputs, settings: L.settings, rules: L.rules,
    accounts: ((firm.settings ?? {}) as { accounts?: Record<string, unknown> }).accounts ?? null, firm: { name: firm.name, activity: firm.activity },
  });
  const cl = L.closeJournal;
  const close = canDo(u, 'close', firm.id);
  const undo = close && canDo(u, 'del', firm.id);
  const rev = L.ent === 'npo' && L.Y.npo ? L.Y.npo.inc : plan.before.co.zs.V.bu201 ?? 0;
  const [srcTxt, srcHref] = TAX_SRC[plan.taxSource];
  const blocked = findings.open.length > 0;
  const tb = L.inputs.tb;
  const D = tb.reduce((s, r) => s + r.debit + (r.openingDebit ?? 0), 0), P = tb.reduce((s, r) => s + r.credit + (r.openingCredit ?? 0), 0);
  const npoChart = L.ent === 'npo' && L.Y.npoChart === 'npo';
  return (
    <>
      <ZsHead id="mbyllja" t={`Затворање на година ${year}`} year={year} ent={L.ent} done={phaseDone(L)} />
      <div className="card"><h2>Контрола пред затворање</h2><ul className="steps">
        <li>{Math.abs(D - P) < 0.01 ? <span className="pill good">✓</span> : <span className="pill warn">!</span>} <span>Бруто билансот е изедначен {Math.abs(D - P) >= 0.01 && <Link className="btn sm" href="/bilanc">Среди</Link>}</span></li>
        <li>{blocked ? <span className="pill bad">{findings.open.length}</span> : <span className="pill good">✓</span>} <span>{blocked ? 'Има неразрешени наоди – затворањето не е дозволено' : 'Контролата е чиста'} <Link className="btn sm" href="/zsKontrola">Контрола</Link></span></li>
        <li>{findings.all.some((x) => x.key === 'dep') ? <span className="pill warn">!</span> : <span className="pill good">✓</span>} <span>Амортизација <Link className="btn sm" href="/os">Основни средства</Link></span></li>
      </ul></div>
      <div className="cols">
        <div className="tw"><table><tbody>
          <tr className="sub"><td colSpan={2}>Чекор 1 · Се затвораат класите 4 и 7 на {npoChart ? '800' : '8000'}</td></tr>
          <tr><td>Приходи</td><td className="n">{fmt(rev)}</td></tr>
          <tr className="tot"><td>{plan.profit >= 0 ? 'Добивка' : 'Загуба'} пред оданочување</td><td className="n">{fmt(plan.profit)}</td></tr>
          <tr className="sub"><td colSpan={2}>Чекор 2 · Данок</td></tr>
          <tr><td>{srcTxt} {srcHref && <Link className="btn sm" href={srcHref}>Отвори</Link>}</td><td /></tr>
          {plan.taxSource === 'db' && <tr><td>Даночна основа (АОП 49)</td><td className="n">{fmt(plan.before.co.db.base)}</td></tr>}
          <tr><td>Данок {npoChart ? '(810 / 245)' : '(8100 / 2330)'}</td><td className="n">{fmt(plan.tax)}</td></tr>
          <tr className="sub"><td colSpan={2}>Чекор 3 · Нето резултатот се пренесува во класа 9</td></tr>
          <tr className="tot"><td>{plan.net >= 0 ? `Нето добивка → ${npoChart ? '970 Вишок на приходи' : '951 Добивка од тековната година'}` : `Нето загуба → ${npoChart ? '092 Недостиг на приходи' : '961 Загуба за тековната година'}`}</td><td className="n">{fmt(plan.net)}</td></tr>
        </tbody></table></div>
        <div className="card"><h2>Со еден клик</h2>
          <p className="note">Програмот креира налог 999 за затворање на 31.12.{year}: го затвора секое конто од класите 4 и 7, го книжи данокот, го пренесува резултатот на 8200, а потоа на 951 (добивка) или 961 (загуба). Може да се пресметува повторно колку што треба, сè додека годината не се пренесе или заклучи.</p>
          {cl && <div className="callout good">Годината {year} е затворена{L.closing?.closedAt ? ' на ' + dmy(L.closing.closedAt.toISOString()) : ''} (налог {cl.number}{L.closing?.imported ? ', од увезен бруто биланс' : ''}): нето {fmt(L.closing?.net ?? (cl.meta as { net?: number }).net)} ден.</div>}
          <div className="row">
            {close && !L.closing?.imported && (
              <RowAction className="btn pri" action={closeYearAction} label={cl ? 'Пресметај го затворањето повторно' : `Затвори ја годината ${year}`}
                confirm={`Да се ${cl ? 'пресмета повторно' : 'креира'} налогот за затворање на 31.12.${year}? Данок ${fmt(plan.tax)} ден., нето ${fmt(plan.net)} ден.`} />
            )}
            {cl && undo && (
              <RowAction className="btn danger" action={undoCloseAction} label="Поништи затворање"
                confirm={`Да се избрише налогот за затворање ${cl.number} за ${year}? Годината повторно ќе биде отворена.`} />
            )}
            {!close && <span className="note">Затворање на година може да направи главен сметководител или администратор.</span>}
          </div>
          <h2>По затворањето</h2>
          <div className="row"><Link className="btn" href="/prenos">Пренос во {year + 1} и заклучување →</Link><Link className="btn" href="/zs_bs">Биланси →</Link></div>
        </div>
      </div>
      {close && !cl && (
        <ActionForm action={importPostCloseTbAction} submit="Увези и зачувај затворање" confirm={`Да се зачува бруто билансот и налогот за затворање на ${year}?`}>
          <h2>Бруто биланс по затворање (од друга програма)</h2>
          <p className="note">Ако годината е затворена во друга програма, залепете го нејзиниот бруто биланс <b>по затворање</b> (класите 4 и 7 на нула) со колони: <code>конто; назив; промет должи; промет побарува; салдо должи; салдо побарува</code>. Приходите и расходите се враќаат од прометот, а затворањето се зачувува како посебен налог „Затворање {year}“, за да излезат Биланс на успех и Биланс на состојба како во поднесената сметка.</p>
          <textarea name="text" rows={8} style={{ width: '100%', fontFamily: 'var(--mono, monospace)' }} placeholder={'1000;Жиро сметка;150000,00;60000,00;90000,00;0\n7400;Приходи од продажба;100000,00;100000,00;0;0'} />
        </ActionForm>
      )}
    </>
  );
}
