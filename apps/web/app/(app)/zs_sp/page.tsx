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
import { saveActMap, saveNkdAop } from '../zsProc/actions';
import { spRows } from '@wise/core/yearend/tools';
import { XlsxButton } from '@/components/vp-tools';

export default async function ZsSpPage() {
  const c = await yePage('zs_sp');
  if (!c) return <NoFirm t="Образец 35" />;
  const { L, firm, year } = c;
  const names = await accountNames(firm.id);
  const { f35 } = forms3538(L, names);
  const D = spRows(L.Y.co.balances.pre, names, ((firm.settings ?? {}) as { actMap?: Record<string, string> }).actMap ?? {}, firm.activity ?? '');
  const pc = (v: number) => (D.tot ? (v / D.tot * 100).toFixed(2) : '0');
  const own = ((firm.settings ?? {}) as { nkdAop?: Record<string, number> }).nkdAop ?? {};
  const raw = L.statement?.f35Raw ?? {};
  return (
    <>
      <ZsHead id="zs_sp" t="Структура на приходи по дејности (образец 35)" year={year} ent={L.ent} done={phaseDone(L)}>
        <XlsxButton name={`Struktura_prihodi_${year}.xlsx`} label="Excel" sheets={[
          { name: 'По конто', rows: [['Конто', 'Назив', 'Шифра на дејност (НКД)', 'Приход', '%'], ...D.rows.map((x) => [x.k, x.n, x.a, x.v, +pc(x.v)])] },
          { name: 'По дејност', rows: [['Шифра на дејност', 'Приход', '%'], ...Object.entries(D.byA).map(([a, v]) => [a, v, +pc(v)])] },
        ]} />
      </ZsHead>
      <ActionForm action={saveActMap} submit="Зачувај шифри" className="card">
        <div className="tw"><table>
          <thead><tr><th>Конто</th><th>Назив</th><th>Шифра на дејност (НКД)</th><th className="n">Приход</th><th className="n">%</th></tr></thead>
          <tbody>{D.rows.length ? D.rows.map((x) => (
            <tr key={x.k}><td>{x.k}</td><td>{x.n}</td><td><input name={'act:' + x.k} defaultValue={((firm.settings ?? {}) as { actMap?: Record<string, string> }).actMap?.[x.k] ?? ''} placeholder={firm.activity || 'на пр. 46.90'} style={{ width: 120 }} /></td><td className="n">{fmt(x.v)}</td><td className="n">{pc(x.v)}</td></tr>
          )) : <tr><td colSpan={5} className="empty">Нема приходи за {year}.</td></tr>}</tbody>
          <tfoot><tr><td></td><td>Вкупно</td><td></td><td className="n">{fmt(D.tot)}</td><td className="n">100.00</td></tr></tfoot>
        </table></div>
        <h2>По дејност</h2>
        <div className="tw"><table><thead><tr><th>Шифра на дејност</th><th className="n">Приход</th><th className="n">%</th></tr></thead>
          <tbody>{Object.entries(D.byA).map(([a, v]) => <tr key={a}><td>{a}</td><td className="n">{fmt(v)}</td><td className="n">{pc(v)}</td></tr>)}</tbody></table></div>
        <p className="note">Основна шифра на дејност на фирмата: <b>{firm.activity || '—'}</b> (Шифрарник → Фирми). Ако некое конто на приход е од друга дејност, внесете ја шифрата во редот.</p>
      </ActionForm>
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
