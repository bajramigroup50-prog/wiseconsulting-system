/**
 * Legacy `VIEWS.prenos` 6757 (+ 11176) with ACT `doTransfer` 7325 / `openYear` 7381 / `lockYear` 7382 / `goYear` /
 * `firmUnlock` 17021 — phase 7 "Нова година": carry-forward into the next year's opening balance and lock.
 * FIX(P8 #1): the help text names the accounts actually used (951/961 → 950/960), not 9500/9600.
 * FIX(P8 #15): open and lock are gated like the close, lock/unlock are audited, undo needs `close` + `del`.
 */
import { yeOpenPlan } from '@wise/core';
import { canDo } from '@/lib/books';
import { dmy, fmt } from '@/lib/fmt';
import { accountNames, phaseDone, yePage } from '@/lib/yearend';
import { NoFirm } from '@/components/no-firm';
import { RowAction } from '@/components/row-action';
import { ZsHead } from '@/components/yearend/ph-bar';
import { lockYearAction, openYearAction, undoOpenAction, unlockYearAction } from '../zsProc/actions';
import { setYear } from '../actions';

export default async function PrenosPage() {
  const c = await yePage('prenos');
  if (!c) return <NoFirm t="Пренос на почетна состојба" />;
  const { L, u, firm, year, findings } = c;
  const N = year + 1;
  const closed = !!L.closeJournal;
  const carry = closed ? yeOpenPlan(L.inputs) : [];
  const names = await accountNames(firm.id);
  const close = canDo(u, 'close', firm.id);
  const del = canDo(u, 'del', firm.id);
  const blocked = findings.open.length > 0;
  return (
    <>
      <ZsHead id="prenos" t="Пренос на почетна состојба" year={year} ent={L.ent} done={phaseDone(L)} />
      <div className="card"><h2>Чекори</h2><ul className="steps">
        <li>{closed ? <span className="pill good">✓</span> : <span className="pill warn">1</span>} <span>Затворање на годината {year} (класи 4 и 7 → 8000, данок на добивка, нето резултат → 951 / 961). {closed ? 'Направено.' : <a className="btn sm" href="/mbyllja">Затвори ја {year}</a>}</span></li>
        <li>{L.openJournal ? <span className="pill good">✓</span> : <span className="pill">2</span>} <span>Пренос на салдата на класите 0, 1, 2, 3, 6 и 9 во налог „Почетна состојба {N}“ (налог 0) на 01.01.{N}; побарувањата (120–128) и обврските (220–228) по партнер; 951 → 950 и 961 → 960.</span></li>
        <li>{L.locked ? <span className="pill good">✓</span> : <span className="pill">3</span>} <span>Заклучување на {year}: документите од затворената година повеќе не може да се менуваат. {L.locked && <>Заклучено до {dmy(firm.lockDate)}.</>}</span></li>
        <li><span className="pill">4</span> <span>Изберете година {N} и продолжете со работа.</span></li>
      </ul>
        {blocked && <div className="callout bad">Има {findings.open.length} неразрешени наоди – пренос и заклучување не се дозволени. <a className="btn sm" href="/zsKontrola">Контрола</a></div>}
        <div className="row">
          {close && closed && (
            <RowAction className="btn pri" action={openYearAction} label={L.openJournal ? `Повторно пренеси во ${N}` : `Пренеси ги салдата во ${N}`}
              confirm={`Да се пренесат салдата од ${year} во почетната состојба за ${N}? Постојната почетна состојба за ${N} ќе се замени.`} />
          )}
          {close && del && L.openJournal && (
            <RowAction className="btn danger" action={undoOpenAction} label={`Избриши почетна состојба ${N}`} confirm={`Да се избрише налогот „Почетна состојба ${N}“?`} />
          )}
          {close && closed && !L.locked && (
            <RowAction className="btn" action={lockYearAction} label={`Заклучи ја годината ${year}`} confirm={`Да се заклучи ${year}? Документите до 31.12.${year} повеќе нема да може да се менуваат.`} />
          )}
          {L.locked && u.role === 'admin' && (
            <RowAction className="btn" action={unlockYearAction} label="🔓 Отклучи" confirm={`Да се отклучи ${year} (заклучување до 31.12.${year - 1})?`} />
          )}
          <RowAction className="btn" action={setYear.bind(null, N)} label={`Отвори ја ${N}`} />
          {!closed && <span className="note">Прво затворете ја годината {year}.</span>}
        </div>
        <p className="note">Преносот може да се повтори ако подоцна нешто се смени во {year}; налогот за {N} се заменува, не се дуплира.</p>
      </div>
      <h2>Салда што ќе се пренесат ({carry.length} ставки)</h2>
      {carry.length ? (
        <div className="tw"><table>
          <thead><tr><th>Конто</th><th>Назив</th><th>Партнер</th><th className="n">Должи</th><th className="n">Побарува</th></tr></thead>
          <tbody>{carry.map((l, i) => <tr key={i}><td>{l.account}</td><td>{names[l.account] ?? ''}</td><td className="mini">{l.partner ? 'по партнер' : ''}</td><td className="n">{l.debit ? fmt(l.debit) : ''}</td><td className="n">{l.credit ? fmt(l.credit) : ''}</td></tr>)}</tbody>
        </table></div>
      ) : <div className="card empty">{closed ? 'Нема салда за пренос.' : `Додека годината ${year} не е затворена, добивката е сè уште во класите 4 и 7.`}</div>}
    </>
  );
}
