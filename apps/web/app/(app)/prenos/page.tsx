/**
 * Legacy `VIEWS.prenos` 6757 (+ 11176) with ACT `doTransfer` 7325 / `openYear` 7381 / `lockYear` 7382 / `goYear` /
 * `firmUnlock` 17021 — phase 7 "Нова година": carry-forward into the next year's opening balance and lock.
 * FIX(P8 #1): the help text names the accounts actually used (951/961 → 950/960), not 9500/9600.
 * FIX(P8 #15): open and lock are gated like the close, lock/unlock are audited, undo needs `close` + `del`.
 * Carry-over evidence (FIX carry-1): konto by konto and partner by partner, closing balance 31.12 vs the posted
 * opening 01.01 with ✓ / ⚠ and the reason; totals „Вкупно затворање = Вкупно почетна“, assets = liabilities;
 * PDF / Excel; „Пренеси повторно“ (idempotent) and „Пренеси ја ставката“.
 */
import Link from 'next/link';
import { inArray } from 'drizzle-orm';
import { carryKeyString, type CarryEvidenceRow } from '@wise/core';
import { carryState, codes } from '@wise/db';
import { canDo } from '@/lib/books';
import { db } from '@/lib/db';
import { dmy, fmt } from '@/lib/fmt';
import { partnerNames } from '@/lib/firms-office';
import { accountNames, phaseDone, yePage } from '@/lib/yearend';
import { NoFirm } from '@/components/no-firm';
import { RowAction } from '@/components/row-action';
import { ScreenExport } from '@/components/screen-export';
import { PrevYearCallout } from '@/components/yearend/prev-year-callout';
import { ZsHead } from '@/components/yearend/ph-bar';
import { carryRowAction, lockYearAction, openYearAction, setCarryByDocAction, undoOpenAction, unlockYearAction } from '../zsProc/actions';
import { setYear } from '../actions';

type Filter = 'all' | 'carried' | 'not';
const FILTERS: [Filter, string][] = [['not', 'Непренесени и разлики'], ['carried', 'Пренесени'], ['all', 'Сите']];

const DP = ({ v }: { v: number | null }) => (
  v == null ? <><td className="n mini">—</td><td className="n mini">—</td></> : <><td className="n">{v > 0 ? fmt(v) : ''}</td><td className="n">{v < 0 ? fmt(-v) : ''}</td></>
);

function statusOf(r: CarryEvidenceRow): { cls: string; txt: string } {
  if (r.carried && r.status !== 'missing') return { cls: 'good', txt: '✓ пренесено' };
  if (r.carried) return { cls: 'bad', txt: '⚠ не е пренесено' };
  if (r.status === 'missing') return { cls: 'bad', txt: '⚠ не е пренесено' };
  return { cls: 'warn', txt: '⚠ не е пренесено' };
}

export default async function PrenosPage({ searchParams }: { searchParams: Promise<{ f?: string }> }) {
  const sp = await searchParams;
  const c = await yePage('prenos');
  if (!c) return <NoFirm t="Пренос на почетна состојба" />;
  const { L, u, firm, year, findings } = c;
  const N = year + 1;
  const closed = !!L.closeJournal;
  const S = await carryState(db(), firm.id, year, L);
  const E = S.evidence;
  const names = await accountNames(firm.id);
  const pn = await partnerNames(firm.id, E.rows.map((r) => r.partnerId));
  const locIds = [...new Set(E.rows.map((r) => r.locationId).filter((x): x is string => !!x))];
  const locs = new Map(locIds.length ? (await db().select({ id: codes.id, name: codes.name }).from(codes).where(inArray(codes.id, locIds))).map((x) => [x.id, x.name]) : []);
  const close = canDo(u, 'close', firm.id);
  const transfer = canDo(u, 'doTransfer', firm.id);
  const del = canDo(u, 'del', firm.id);
  const settings = canDo(u, 'settings', firm.id);
  const blocked = findings.open.length > 0;
  const f: Filter = sp.f === 'all' || sp.f === 'carried' ? sp.f : 'not';
  const rows = E.rows.filter((r) => f === 'all' || (f === 'carried' ? r.carried : !r.carried || r.status === 'missing'));
  const T = E.totals;
  const nCarried = E.rows.filter((r) => r.carried).length;
  const nOk = E.rows.filter((r) => r.carried && r.status !== 'missing').length;
  return (
    <>
      <ZsHead id="prenos" t="Пренос на почетна состојба" year={year} ent={L.ent} done={phaseDone(L)} />
      <PrevYearCallout firmId={firm.id} year={year} />
      <div className="card"><h2>Чекори</h2><ul className="steps">
        <li>{closed ? <span className="pill good">✓</span> : <span className="pill warn">1</span>} <span>Затворање на годината {year} (класи 4 и 7 → 8000, данок на добивка, нето резултат → 951 / 961). Со затворањето салдата веднаш се пренесуваат во {N}. {closed ? 'Направено.' : <Link className="btn sm" href="/mbyllja">Затвори ја {year}</Link>}</span></li>
        <li>{L.openJournal ? <span className="pill good">✓</span> : <span className="pill">2</span>} <span>Пренос на салдата на класите 0, 1, 2, 3, 6 и 9 во налог „Почетна состојба {N}“ (налог 0) на 01.01.{N}: секое аналитичко конто, по партнер за секое конто што има партнери (купувачи, добавувачи, заеми, аванси…), по локација{S.byDoc ? ' и по отворен документ (12x / 22x)' : ''}; 951 → 950 и 961 → 960. Класите 4, 5, 7 и 8 не се пренесуваат.</span></li>
        <li>{L.locked ? <span className="pill good">✓</span> : <span className="pill">3</span>} <span>Заклучување на {year}: документите од затворената година повеќе не може да се менуваат. {L.locked && <>Заклучено до {dmy(firm.lockDate)}.</>} За измена: отклучи → измени → затвори повторно (почетната состојба за {N} се ажурира).</span></li>
        <li><span className="pill">4</span> <span>Изберете година {N}: налогот е во „Налози“ и „Почетна состојба“, картиците и бруто билансот на {N} почнуваат од овие салда.</span></li>
      </ul>
        {!closed && <div className="callout bad">⚠ <b>Годината {year} не е затворена – затворете ја и пренесете ги салдата.</b> Додека не се затвори, добивката е сè уште во класите 4 и 7, а почетната состојба за {N} е празна. <Link className="btn sm" href="/mbyllja">Затворање на {year} →</Link></div>}
        {blocked && <div className="callout bad">Има {findings.open.length} неразрешени наоди – пренос и заклучување не се дозволени. <Link className="btn sm" href="/zsKontrola">Контрола</Link></div>}
        {S.lockedNext && <div className="callout bad">Периодот на {N} е заклучен (до {dmy(firm.lockDate)}) – почетната состојба не може да се книжи ниту замени.</div>}
        {S.plan.blocked.length > 0 && <div className="callout bad">Контата {S.plan.blocked.join(', ')} имаат салдо, а не постојат во контниот план (ниту нивната синтетика) – отворете ги во <Link href="/konto">Контен план</Link>, па пренесете повторно.</div>}
        <div className="row">
          {transfer && closed && (
            <RowAction className="btn pri" action={openYearAction} showOk label={L.openJournal ? '↻ Пренеси повторно' : `Пренеси ги салдата во ${N}`}
              confirm={`Да се пренесат салдата од ${year} во почетната состојба за ${N}?${L.openJournal ? ` Постојниот налог „Почетна состојба ${N}“ ќе се замени (не се дуплира).` : ''}`} />
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
          {settings && (
            <RowAction className="btn ghost" action={setCarryByDocAction.bind(null, !S.byDoc)} showOk
              label={S.byDoc ? '☑ По отворен документ (12x / 22x)' : '☐ По отворен документ (12x / 22x)'}
              title="Побарувањата и обврските по партнер да се пренесуваат и по фактура / документ (отворени ставки, ИОС)" />
          )}
        </div>
        <p className="note">Преносот може да се повтори ако подоцна нешто се смени во {year}; налогот за {N} се заменува, не се дуплира. Секој пренос се запишува во дневникот на активности.</p>
      </div>

      <div id="carryEv">
        <div className="card">
          <h2>Контрола на преносот {year} → {N}</h2>
          <div className="tw"><table>
            <thead><tr><th /><th className="n">Должи</th><th className="n">Побарува</th><th className="n">Актива (0,1,3,6)</th><th className="n">Пасива (2,9)</th></tr></thead>
            <tbody>
              <tr><td>Вкупно затворање 31.12.{year} (класи 0,1,2,3,6,9)</td><td className="n">{fmt(T.closingDebit)}</td><td className="n">{fmt(T.closingCredit)}</td><td className="n">{fmt(T.closingAssets)}</td><td className="n">{fmt(T.closingLiabilities)}</td></tr>
              <tr><td>Вкупно почетна 01.01.{N}{L.openJournal ? ` (налог ${L.openJournal.number})` : ' – не е пренесена'}</td><td className="n">{fmt(T.openingDebit)}</td><td className="n">{fmt(T.openingCredit)}</td><td className="n">{fmt(T.openingAssets)}</td><td className="n">{fmt(T.openingLiabilities)}</td></tr>
            </tbody>
          </table></div>
          {T.ok
            ? <div className="callout good">✓ Вкупно затворање = Вкупно почетна, должи = побарува, актива = пасива. Пренесени {nOk} од {nCarried} ставки.</div>
            : <div className="callout warn">⚠ Преносот не е усогласен: {E.missing} ставки не се пренесени или се разликуваат{L.openJournal ? ' – „Пренеси повторно“' : ''}.</div>}
        </div>
        <div className="row" style={{ gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          <h2 style={{ margin: 0 }}>Салда конто по конто и партнер по партнер</h2>
          <span className="row" style={{ gap: 4 }}>{FILTERS.map(([k, t]) => <Link key={k} className={`btn sm${f === k ? ' pri' : ''}`} href={`/prenos?f=${k}`}>{t}</Link>)}</span>
          <ScreenExport title={`Пренос на салда ${year} → ${N}`} selector="#carryEv" landscape />
        </div>
        {rows.length ? (
          <div className="tw"><table>
            <thead>
              <tr><th rowSpan={2}>Конто</th><th rowSpan={2}>Назив</th><th rowSpan={2}>Партнер</th><th rowSpan={2}>Документ</th><th rowSpan={2}>Локација</th>
                <th colSpan={2} className="c">Салдо 31.12.{year}</th><th colSpan={2} className="c">Почетна 01.01.{N}</th><th rowSpan={2}>Статус</th><th rowSpan={2}>Причина / забелешка</th><th rowSpan={2} className="noprint" /></tr>
              <tr><th className="n">Должи</th><th className="n">Побарува</th><th className="n">Должи</th><th className="n">Побарува</th></tr>
            </thead>
            <tbody>{rows.map((r) => {
              const st = statusOf(r);
              const src = r.sources.filter((s) => s !== r.account);
              return (
                <tr key={carryKeyString(r) + (r.carried ? '' : '#n')}>
                  <td>{r.account}{src.length > 0 && <span className="mini"> ← {src.join(', ')}</span>}</td>
                  <td className="mini">{names[r.account] ?? ''}</td>
                  <td>{r.partnerId ? pn.get(r.partnerId)?.name ?? '?' : ''}</td>
                  <td className="mini">{r.doc ?? ''}</td>
                  <td className="mini">{r.locationId ? locs.get(r.locationId) ?? '' : ''}</td>
                  <DP v={r.closing} />
                  <DP v={r.carried || r.opening != null ? r.opening : null} />
                  <td><span className={`pill ${st.cls}`}>{st.txt}</span></td>
                  <td className="mini">{r.reason}</td>
                  <td className="noprint">{transfer && r.carried && r.status === 'missing' && L.openJournal && (
                    <RowAction className="btn sm" action={carryRowAction.bind(null, carryKeyString(r))} label="Пренеси ја ставката" showOk />
                  )}</td>
                </tr>
              );
            })}</tbody>
          </table></div>
        ) : <div className="card empty">{f === 'not' ? (E.rows.length ? 'Сите салда се пренесени.' : `Нема книжења во ${year}.`) : 'Нема ставки.'}</div>}
      </div>
    </>
  );
}
