/**
 * Legacy `VIEWS.semi` 5221 (+ `schEx`, `SCH_UI`, `custHTML`) — Систем › Шеми за автоматско книжење: the kontos every
 * document is booked with (office-wide), VAT kontos per rate, method flags, and the user's own schemes (`custom`).
 */
import { eq } from 'drizzle-orm';
import { schemeRaw, SCH0, SCH_EXTRA } from '@wise/core/posting';
import { vatAccount } from '@wise/core/vat';
import type { CustomScheme } from '@wise/core/finance';
import { appSettings, effectiveChart, SCHEMES_SETTINGS_KEY, vatPostingContext } from '@wise/db';
import { booksPage, canDo } from '@/lib/books';
import { db } from '@/lib/db';
import { ActionForm } from '@/components/action-form';
import { Hd } from '@/components/hd';
import { NoFirm } from '@/components/no-firm';
import { RowAction } from '@/components/row-action';
import { RepostCallout } from '@/components/repost-callout';
import { deleteCustomSchemeAction, resetSchemesAction, saveSchemesAction } from './actions';
import { SCH_FLAGS, SCH_UI, VAT_RATES } from './schema';

const DEF = { ...SCH0, ...SCH_EXTRA } as Record<string, string | boolean>;

export default async function SemiPage() {
  const { u, firm, year } = await booksPage('semi');
  if (!firm) return <NoFirm t="Шеми за автоматско книжење" />;
  const [[g], chart] = await Promise.all([db().select().from(appSettings).where(eq(appSettings.key, SCHEMES_SETTINGS_KEY)).limit(1), effectiveChart(db(), firm.id)]);
  const G = (g?.value ?? {}) as { custom?: CustomScheme[]; updated?: string; by?: string };
  const ctx = vatPostingContext(firm, g?.value ?? null);
  const nm = new Map(chart.map((a) => [a.code, a.name]));
  const val = (k: string) => { const v = schemeRaw(ctx, k); return typeof v === 'string' ? v : ''; };
  const ed = canDo(u, 'schSaveAll', firm.id);
  const kin = (name: string, v: string, def?: string) => (
    <label className="f" key={name}>
      <input name={name} list="kpl" defaultValue={v} style={{ width: 130 }} disabled={!ed} placeholder={def} />
      <small className="note">{v === '-' ? 'не се користи' : v ? nm.get(v) ?? '⚠ контото не постои во контниот план' : ''}</small>
    </label>
  );
  const custom = [...(G.custom ?? []), { id: '', name: '', rows: [] } as CustomScheme];
  return (
    <>
      <Hd t="Шеми за автоматско книжење" sub="конта што програмот ги користи при книжење">
        {ed && <RowAction className="btn" label="Врати стандардни" confirm="Да се вратат стандардните конта (според контниот план) во сите шеми, за сите фирми?" action={resetSchemesAction} />}
        <RepostCallout u={u} firmId={firm.id} year={year} always />
      </Hd>
      <RepostCallout u={u} firmId={firm.id} year={year} />
      <div className={`callout ${firm.vatRegistered ? 'good' : 'warn'}`}><b>{firm.name}</b> е {firm.vatRegistered
        ? <><b>ДДВ обврзник</b> – влезниот ДДВ се одбива, излезниот се пресметува.</>
        : <><b>НЕ е ДДВ обврзник</b> – на излезните фактури не се пресметува ДДВ, а ДДВ од влезните фактури влегува во набавната вредност / трошокот.</>} Статусот се менува во Фирми → регистрација на фирмата.</div>
      <p className="note">Секој документ се книжи автоматски според овие шеми. Шемите се поставуваат еднаш и важат за сите фирми (и за новите). Промената важи за новите книжења; веќе книжените документи се прекнижуваат кога ќе се отворат и зачуваат повторно, или сите одеднаш со „Прекнижи ја {year} според шемите“. „-“ = редот не се користи.{G.updated ? ` Последна промена: ${G.updated.slice(0, 10).split('-').reverse().join('.')}${G.by ? ' · ' + G.by : ''}.` : ''}</p>
      <datalist id="kpl">{chart.map((a) => <option key={a.code} value={a.code}>{a.name}</option>)}</datalist>
      <ActionForm action={saveSchemesAction} reset={false} className="">
        {SCH_FLAGS.map(([k, t]) => (
          <label key={k} className="card" style={{ display: 'flex', flexDirection: 'row', gap: 10, alignItems: 'center', fontWeight: 600, marginBottom: 10 }}>
            <input type="checkbox" name={'s_' + k} value="1" defaultChecked={schemeRaw(ctx, k) === true} style={{ width: 'auto' }} disabled={!ed} /> {t}
          </label>
        ))}
        <div className="card">
          <div className="hd" style={{ margin: '0 0 4px' }}><b>ДДВ и приходи по стапки – автоматски</b></div>
          <p className="note" style={{ margin: '0 0 8px' }}>Програмата ја дели секоја фактура по стапките на ставките (18%, 10%, 5%) и секој ДДВ оди на своето конто. ДДВ платен на царина (ЕЦД) кај увозни фактури оди на посебните конта за увоз.</p>
          <table><thead><tr><th>Стапка</th><th>Претходен ДДВ – влезни фактури (Д)</th><th>ДДВ при увоз – царина (Д)</th><th>Обврска за ДДВ – излезни фактури (П)</th></tr></thead>
            <tbody>
              {VAT_RATES.map((r) => <tr key={r}><td><b>{r}%</b></td><td>{kin('VI' + r, vatAccount(ctx, 'in', r) ?? '')}</td><td>{kin('VM' + r, vatAccount(ctx, 'imp', r) ?? '')}</td><td>{kin('VO' + r, vatAccount(ctx, 'out', r) ?? '')}</td></tr>)}
              <tr><td><b>0%</b></td><td colSpan={3} className="note">без ДДВ – се книжи по шемите „без ДДВ / ослободена“</td></tr>
            </tbody></table>
        </div>
        <details className="card" style={{ marginTop: 14 }}><summary style={{ cursor: 'pointer', fontWeight: 600 }}>Сите поставки по групи (истите конта, во листа) и опции</summary>
        {SCH_UI.map(([t, d, F]) => (
          <div className="card" key={t}>
            <h2 style={{ margin: 0 }}>{t}</h2>
            <p className="note" style={{ margin: '4px 0 10px' }}>{d}</p>
            <div className="form">{F.map(([k, n]) => (
              <div key={k}><div className="mini">{n} <span className="mut">({k})</span></div>{kin('s_' + k, val(k), typeof DEF[k] === 'string' ? DEF[k] as string : '')}</div>
            ))}</div>
          </div>
        ))}
        </details>
        <h2 style={{ margin: '22px 0 4px' }}>Мои шеми (нови)</h2>
        <p className="note" style={{ margin: '0 0 8px' }}>Свои шеми за книжења што се повторуваат (закуп, телефон, провизии, аконтации, дивиденда…). Секој ред: конто, страна (Д/П) и процент од износот; Д% мора да е еднакво на П%. Нова шема: пополнете ја последната картичка.</p>
        <div className="schg">{custom.map((c, ci) => (
          <div className="card" key={ci}>
            <input type="hidden" name="c_i" value={ci} /><input type="hidden" name={'c_id_' + ci} value={c.id} />
            <div className="hd" style={{ margin: '0 0 6px' }}><input name={'c_name_' + ci} defaultValue={c.name} placeholder={c.id ? 'Назив на шемата' : '+ Нова шема – назив'} style={{ fontWeight: 600, maxWidth: 320 }} disabled={!ed} />
              {c.id && ed && <RowAction className="btn sm ghost" style={{ color: 'var(--bad)' }} label="Избриши шема" confirm={`Да се избрише шемата „${c.name}“?`} action={deleteCustomSchemeAction.bind(null, c.id)} />}</div>
            <table><thead><tr><th>Конто</th><th>Страна</th><th className="n">% од износот</th><th>Опис</th></tr></thead>
              <tbody>{[...c.rows, ...Array.from({ length: c.id ? 2 : 3 }, () => ({ k: '', s: 'd' as const, v: 0, n: '' }))].map((r, ri) => (
                <tr key={ri}>
                  <td><input name={'c_k_' + ci} list="kpl" defaultValue={r.k} style={{ width: 110 }} disabled={!ed} /></td>
                  <td><select name={'c_s_' + ci} defaultValue={r.s} style={{ width: 'auto' }} disabled={!ed}><option value="d">Д – Должи</option><option value="p">П – Побарува</option></select></td>
                  <td><input name={'c_v_' + ci} type="number" step="any" defaultValue={r.k ? r.v : ''} style={{ width: 90, textAlign: 'right' }} disabled={!ed} /></td>
                  <td><input name={'c_n_' + ci} defaultValue={r.n ?? ''} placeholder="опис" disabled={!ed} /></td>
                </tr>
              ))}</tbody></table>
          </div>
        ))}</div>
        {ed && <div className="row" style={{ justifyContent: 'flex-end', margin: '8px 0' }}><button className="btn pri">Зачувај (важи за сите фирми)</button></div>}
      </ActionForm>
    </>
  );
}
