/**
 * Legacy `VIEWS.zsKontrola` (10893 → 11070 ЦРМ rules card → 11236 `zcHTML`) — phase 1 "Контрола": the phase gate
 * findings, then the legacy steps 1–6 (`zkData`: trial balance, sign logic per class, unmapped accounts, close, AOP
 * cross-checks, notes) and the ЦРМ validation rules.
 */
import Link from 'next/link';
import { crmRules } from '@wise/core';
import { zkAopChecks, zkData } from '@wise/core/yearend/kontrola';
import { forms3538 } from '@wise/db';
import { canDo } from '@/lib/books';
import { fmt } from '@/lib/fmt';
import { accountNames, phaseDone, yePage } from '@/lib/yearend';
import { NoFirm } from '@/components/no-firm';
import { FindingsCard } from '@/components/yearend/findings';
import { NotClosedNote, ZsHead } from '@/components/yearend/ph-bar';

const ok = (b: boolean) => (b ? <span className="pill good">✓</span> : <span className="pill bad">✕</span>);
const fa = (v: number) => Math.round(+v || 0).toLocaleString('de-DE');

function Step({ n, t, b, children }: { n: number; t: string; b: boolean; children: React.ReactNode }) {
  return <div className="card"><div className="hd"><h2 style={{ fontSize: 15, margin: 0 }}>{n}. {t}</h2>{ok(b)}</div>{children}</div>;
}

export default async function ZsKontrolaPage() {
  const c = await yePage('zsKontrola');
  if (!c) return <NoFirm t="Контрола" />;
  const { L, u, firm, year, findings } = c;
  const V = L.Y.co.zs.V;
  const names = await accountNames(firm.id);
  const { de } = forms3538(L, names);
  const rules = L.ent === 'co' || L.ent === 'tp' ? crmRules(L.Y.co.zs, de) : [];
  const errs = rules.filter((r) => r[2] !== 'warn');
  const K = zkData(L.inputs.tb, names, L.rules);
  const A = L.ent === 'co' ? zkAopChecks(V, L.Y.co.db.V) : [];
  const meta = (L.closeJournal?.meta ?? null) as { net?: number; tax?: number } | null;
  const notesOk = !!L.statement && Object.keys(L.statement.notes ?? {}).length > 0;
  return (
    <>
      <ZsHead id="zsKontrola" t="Контрола на завршна сметка" year={year} ent={L.ent} done={phaseDone(L)} />
      <NotClosedNote closed={L.Y.closed} year={year} />
      <FindingsCard all={findings.all} open={findings.open} ack={L.statement?.ack ?? {}} canAck={canDo(u, 'settings', firm.id) || canDo(u, 'fix', firm.id)} />
      <Step n={1} t="Бруто билансот е изедначен" b={Math.abs(K.TD - K.TP) < 0.01}>
        <p className="mini" style={{ margin: 0 }}>Должи {fmt(K.TD)} · Побарува {fmt(K.TP)}{Math.abs(K.TD - K.TP) >= 0.01 && <> · <b>разлика {fmt(K.TD - K.TP)}</b> <Link className="btn sm" href="/bilanc">Бруто биланс</Link></>}</p>
      </Step>
      <Step n={2} t="Логика на салдата по класи (1 +, 2 −, 3 +, 4 +, 6 +, 7 −, 9 −)" b={!K.sign.length}>
        {K.sign.length ? (
          <>
            <p className="mini" style={{ margin: '0 0 6px' }}>Овие конта имаат салдо на „погрешната“ страна – проверете ги (може да е дозволено, на пр. повеќе платен ДДВ, аванси):</p>
            <div className="tw"><table className="dense"><thead><tr><th>Конто</th><th>Назив</th><th className="n">Салдо</th><th>Очекувано</th><th></th></tr></thead><tbody>
              {K.sign.map((x) => <tr key={x.k}><td>{x.k}</td><td>{names[x.k] ?? ''}</td><td className="n">{fmt(x.s)}</td><td>{x.e === 'd' ? 'должи (+)' : 'побарува (−)'}</td><td><Link className="btn sm" href={`/kkart?k=${encodeURIComponent(x.k)}`}>Картица</Link></td></tr>)}
            </tbody></table></div>
          </>
        ) : <p className="mini" style={{ margin: 0 }}>Сите конта се на очекуваната страна.</p>}
      </Step>
      <Step n={3} t="Сите конта со салдо се распоредени во АОП" b={!K.unm.length}>
        {K.unm.length ? (
          <>
            <p className="mini" style={{ margin: '0 0 6px' }}>Овие конта не влегуваат во ниту една позиција на билансите – износот би недостасувал:</p>
            <div className="tw"><table className="dense"><tbody>{K.unm.map((x) => <tr key={x.k}><td>{x.k}</td><td>{names[x.k] ?? ''}</td><td className="n">{fmt(x.s)}</td></tr>)}</tbody></table></div>
            <Link className="btn sm" href="/zs_pr">Правила за завршна пресметка</Link>
          </>
        ) : <p className="mini" style={{ margin: 0 }}>Нема нераспоредени конта.</p>}
      </Step>
      <Step n={4} t="Затворање 4 и 7 → 8 → 9" b={L.Y.closed}>
        {L.Y.closed
          ? <p className="mini" style={{ margin: 0 }}>Затворено: нето {(meta?.net ?? 0) >= 0 ? 'добивка' : 'загуба'} {fmt(Math.abs(meta?.net ?? 0))}, данок {fmt(meta?.tax ?? 0)}. Ако менувате нешто, затворете повторно.</p>
          : <p className="mini" style={{ margin: 0 }}>Годината не е затворена. Прво пополнете го ДБ (данокот), потоа затворете. <Link className="btn sm" href="/zs_db">ДБ</Link> <Link className="btn sm pri" href="/mbyllja">Затворање на година</Link></p>}
      </Step>
      {A.length > 0 && (
        <Step n={5} t="Контроли на АОП" b={A.every((x) => Math.abs(x[1] - x[2]) < 1)}>
          <div className="tw"><table className="dense"><thead><tr><th>Контрола</th><th className="n">Лево</th><th className="n">Десно</th><th></th></tr></thead><tbody>
            {A.map((x) => <tr key={x[0]}><td>{x[0]}</td><td className="n">{fa(x[1])}</td><td className="n">{fa(x[2])}</td><td>{ok(Math.abs(x[1] - x[2]) < 1)}</td></tr>)}
          </tbody></table></div>
        </Step>
      )}
      <Step n={6} t="Објаснувачки белешки (тековна и претходна година)" b={notesOk}>
        <p className="mini" style={{ margin: 0 }}>Се пополнуваат сами од билансите; дополнете текст каде треба. <Link className="btn sm" href="/zsBel">Отвори белешки</Link></p>
      </Step>
      {(L.ent === 'co' || L.ent === 'tp') && (
        <div className="card" style={{ borderColor: errs.length ? 'var(--bad)' : 'var(--good)' }}>
          <div className="hd"><h2 style={{ fontSize: 15, margin: 0 }}>7. Правила на ЦРМ (е-годишна сметка)</h2>
            <div className="row">{errs.length ? <span className="pill bad">{errs.length} грешки</span> : <span className="pill good">✓ сите правила</span>}<Link className="btn sm" href="/zsXml">XML за ЦРМ →</Link></div></div>
          {rules.length ? (
            <div className="tw"><table className="dense"><thead><tr><th style={{ width: 90 }}>Правило</th><th>Услов</th></tr></thead><tbody>
              {rules.map(([no, t, lvl]) => <tr key={String(no) + t}><td><span className={`pill ${lvl === 'warn' ? 'warn' : 'bad'}`}>{no}</span></td><td>{t}</td></tr>)}
            </tbody></table></div>
          ) : <p className="note">Билансите ги исполнуваат контролните правила на ЦРМ (2000–2349, 2600–2712).</p>}
        </div>
      )}
      <div className="callout">Во ЦРМ се внесува само <b>тековната година</b> – претходната ја пополнува системот на ЦРМ. Пред поднесување сите контроли треба да се ✓. Редослед: 1. ДБ во УЈП → 2. годишна сметка (БС, БУ, белешки) во ЦРМ.</div>
    </>
  );
}
