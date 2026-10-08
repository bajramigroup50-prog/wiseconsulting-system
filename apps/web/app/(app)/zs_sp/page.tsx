/**
 * Legacy `VIEWS.zs_sp` (zsView 7711 → `f35HTML` wrapper 11051) — ЦРМ образец 35: revenue by activity
 * (AOP = 4000 + NACE Rev 2.1 class index; unknown codes get a typed AOP that is remembered per firm).
 * FIX(P8 #13): `f35Man` was read but never written; manual form-35 amounts come only from an imported ЦРМ XML
 * (`f35Raw`), shown here when present.
 */
import { fmt } from '@/lib/fmt';
import { forms3538 } from '@wise/db';
import { accountNames, phaseDone, yePage } from '@/lib/yearend';
import { NoFirm } from '@/components/no-firm';
import { ActionForm } from '@/components/yearend/action-form';
import { ZsHead } from '@/components/yearend/ph-bar';
import { saveNkdAop } from '../zsProc/actions';

export default async function ZsSpPage() {
  const c = await yePage('zs_sp');
  if (!c) return <NoFirm t="Образец 35" />;
  const { L, firm, year } = c;
  const { f35 } = forms3538(L, await accountNames(firm.id));
  const own = ((firm.settings ?? {}) as { nkdAop?: Record<string, number> }).nkdAop ?? {};
  const raw = L.statement?.f35Raw ?? {};
  return (
    <>
      <ZsHead id="zs_sp" t="Структура на приходи по дејности (образец 35)" year={year} ent={L.ent} done={phaseDone(L)} />
      {!firm.activity && <div className="callout warn">Фирмата нема шифра на дејност (НКД) – внесете ја во „Фирми“.</div>}
      {Object.keys(raw).length > 0 && <div className="callout">Во XML за ЦРМ се користат износите од увезениот (прифатен) XML: {Object.entries(raw).map(([a, v]) => `АОП ${a}: ${fmt(v)}`).join(' · ')}.</div>}
      <ActionForm action={saveNkdAop} submit="Зачувај АОП" className="card">
        <h2 style={{ fontSize: 15, margin: '0 0 6px' }}>Образец 35 – Структура на приходи по дејности (за ЦРМ XML)</h2>
        <div className="tw"><table className="dense">
          <thead><tr><th>Шифра (НКД)</th><th>АОП во образец 35</th><th className="n">Приход {year}</th></tr></thead>
          <tbody>
            {f35.length ? f35.map((r) => (
              <tr key={r.nkd}><td>{r.nkd}</td>
                <td>{r.aop && !own[r.nkd] ? <b>{r.aop}</b> : <><input name={'nkd:' + r.nkd} defaultValue={r.aop ?? ''} placeholder="4000–4654" style={{ width: 110 }} />{!r.aop && <span className="pill warn"> внесете АОП</span>}</>}</td>
                <td className="n">{fmt(r.v)}</td></tr>
            )) : <tr><td colSpan={3} className="note">Нема приходи по дејности.</td></tr>}
          </tbody>
        </table></div>
        <p className="mini" style={{ margin: '6px 0 0' }}>АОП се пополнува автоматски од шифрата на дејноста (НКД Рев. 2.1: 4000 = 01.11 … 4509 = 69.20 …) и оди во XML за ЦРМ. Ако некоја шифра не се најде, внесете го АОП-от рачно – програмот го памети.</p>
      </ActionForm>
    </>
  );
}
