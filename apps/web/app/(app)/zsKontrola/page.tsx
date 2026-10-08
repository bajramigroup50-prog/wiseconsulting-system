/**
 * Legacy `VIEWS.zsKontrola` (10893 → 11070 ЦРМ rules card → 11236 `zcHTML`) — phase 1 "Контрола": the phase gate
 * findings, the ЦРМ validation rules and the cross-checks between the statements and the ДБ.
 */
import { crmRules } from '@wise/core';
import { forms3538 } from '@wise/db';
import { canDo } from '@/lib/books';
import { fmt } from '@/lib/fmt';
import { accountNames, phaseDone, yePage } from '@/lib/yearend';
import { NoFirm } from '@/components/no-firm';
import { FindingsCard } from '@/components/yearend/findings';
import { NotClosedNote, ZsHead } from '@/components/yearend/ph-bar';

export default async function ZsKontrolaPage() {
  const c = await yePage('zsKontrola');
  if (!c) return <NoFirm t="Контрола" />;
  const { L, u, firm, year, findings } = c;
  const V = L.Y.co.zs.V;
  const { de } = forms3538(L, await accountNames(firm.id));
  const rules = L.ent === 'co' || L.ent === 'tp' ? crmRules(L.Y.co.zs, de) : [];
  const errs = rules.filter((r) => r[2] !== 'warn');
  // FIX(P8 #8): bu252 carries the ДБ tax before the close too, so this check holds in both states
  const checks: [boolean, string][] = L.ent === 'co' ? [
    [Math.round(V.bs063 ?? 0) === Math.round(V.bs111 ?? 0), `Актива (063) ${fmt(V.bs063)} = Пасива (111) ${fmt(V.bs111)}`],
    [Math.round(V.bu252 ?? 0) === Math.round(L.Y.co.db.tax), `Данок на добивка во БУ (252) ${fmt(V.bu252)} = ДБ АОП 56 ${fmt(L.Y.co.db.tax)}`],
    [Math.round(V.bs077 ?? 0) <= Math.round(V.bu255 ?? 0), `Добивка во БС (077) ${fmt(V.bs077)} ≤ нето добивка во БУ (255) ${fmt(V.bu255)}`],
  ] : [];
  return (
    <>
      <ZsHead id="zsKontrola" t="Контрола пред завршна сметка" year={year} ent={L.ent} done={phaseDone(L)} />
      <NotClosedNote closed={L.Y.closed} year={year} />
      <FindingsCard all={findings.all} open={findings.open} ack={L.statement?.ack ?? {}} canAck={canDo(u, 'settings', firm.id) || canDo(u, 'fix', firm.id)} />
      {checks.length > 0 && (
        <div className="card"><h2>Биланси и ДБ</h2><ul className="steps">
          {checks.map(([ok, t]) => <li key={t}>{ok ? <span className="pill good">✓</span> : <span className="pill bad">✗</span>} <span>{t}</span></li>)}
        </ul></div>
      )}
      {(L.ent === 'co' || L.ent === 'tp') && (
        <div className="card" style={{ borderColor: errs.length ? 'var(--bad)' : 'var(--good)' }}>
          <div className="hd"><h2 style={{ fontSize: 15, margin: 0 }}>Правила на ЦРМ (е-годишна сметка)</h2>
            {errs.length ? <span className="pill bad">{errs.length} грешки</span> : <span className="pill good">✓ сите правила</span>}</div>
          {rules.length ? (
            <div className="tw"><table className="dense"><thead><tr><th style={{ width: 90 }}>Правило</th><th>Услов</th></tr></thead><tbody>
              {rules.map(([no, t, lvl]) => <tr key={String(no) + t}><td><span className={`pill ${lvl === 'warn' ? 'warn' : 'bad'}`}>{no}</span></td><td>{t}</td></tr>)}
            </tbody></table></div>
          ) : <p className="note">Билансите ги исполнуваат контролните правила на ЦРМ (2000–2349, 2600–2712).</p>}
        </div>
      )}
    </>
  );
}
