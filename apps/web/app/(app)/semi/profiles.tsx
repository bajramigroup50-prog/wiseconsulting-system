/**
 * Шифрарник → Шеми на книжење: the tabs „Шема 1 – основна / Шема 2 / … / + Нова шема“ and the form of a numbered scheme
 * (`@wise/core/scheme-profiles`). The form has the same groups and kontos as the Шема 1 editor; every field shows Шема 1's
 * konto as its placeholder and is EMPTY unless the scheme overrides it (empty = inherit from Шема 1).
 */
import Link from 'next/link';
import { schemeLabel, schemeOverrideCount, type SchemeProfile } from '@wise/core/scheme-profiles';
import { schemeRaw, type PostingContext } from '@wise/core/posting';
import { vatAccount } from '@wise/core/vat';
import { ActionForm, Submit } from '@/components/action-form';
import { RowAction } from '@/components/row-action';
import { copySchemeProfileAction, deleteSchemeProfileAction, saveSchemeProfileAction } from './profile-actions';
import { SCH_UI, VAT_RATES, VB_TYPES } from './schema';

export function SchemeTabs({ profiles, active, ed }: { profiles: readonly SchemeProfile[]; active: number | 'nova'; ed: boolean }) {
  const tab = (href: string, on: boolean, label: string, title?: string) => (
    <Link key={href} href={href} role="tab" aria-selected={on} className={'btn sm' + (on ? ' pri' : '')} title={title}>{label}</Link>
  );
  return (
    <div className="row" role="tablist" aria-label="Шеми на книжење" style={{ gap: 6, flexWrap: 'wrap', margin: '0 0 12px' }}>
      {tab('/semi', active === 1, 'Шема 1 – основна', 'Шемата на фирмата: важи за секој документ што не избрал друга шема')}
      {profiles.map((p) => tab(`/semi?sema=${p.no}`, active === p.no, `${schemeLabel(p.no, profiles)} · ${schemeOverrideCount(p)}`, `${schemeOverrideCount(p)} изменети конта во однос на Шема 1`))}
      {ed && tab('/semi?sema=nova', active === 'nova', '+ Нова шема', 'Нова шема: само контата што се разликуваат од Шема 1')}
    </div>
  );
}

export function ProfileForm({ p, ctx, names, ed, firms, owner, use }: {
  p: SchemeProfile | null; ctx: PostingContext; names: ReadonlyMap<string, string>; ed: boolean;
  /** Other firms of the user (copy targets). */
  firms: { id: string; name: string }[];
  owner: boolean;
  use?: { invoices: number; purchases: number; partners: number };
}) {
  const base = (k: string) => { const v = schemeRaw(ctx, k); return typeof v === 'string' ? v : ''; };
  const own = (k: string) => p?.sch?.[k] ?? '';
  const vatOwn = (m: 'vatIn' | 'vatImp' | 'vatOut', r: number) => String(p?.[m]?.[r] ?? '');
  const kin = (name: string, v: string, ph: string) => (
    <label className="f" key={name}>
      <input name={name} list="kpl" defaultValue={v} placeholder={ph} style={{ width: 130, ...(v ? { fontWeight: 700, borderColor: 'var(--accent)' } : {}) }} disabled={!ed} aria-label={name} />
      <small className="note">{v === '-' ? 'не се користи' : v ? names.get(v) ?? '⚠ контото не постои во контниот план' : ph ? 'како Шема 1' : ''}</small>
    </label>
  );
  const vatBase = (kind: 'in' | 'imp' | 'out', r: number) => vatAccount(ctx, kind, r) ?? '';
  return (
    <>
      <div className="callout info">
        {p ? <><b>{schemeLabel(p.no, [p])}</b> – {schemeOverrideCount(p)} изменети конта.</> : <b>Нова шема</b>} Пополнете ги <b>само контата што се разликуваат</b> од Шема 1 (сивиот текст е контото од Шема 1); празно = исто како Шема 1.
        Шемата се избира на документот (Дополнителни → „Шема за книжење“), на картичката на комитентот или при „Прекнижи ги избраните со Шема N“ во налогот.
        Начинот на водење на залихите (по продажни цени) е ист за сите шеми на фирмата.
        {use && (use.invoices + use.purchases + use.partners) > 0 && <> Се користи: {use.invoices} излезни, {use.purchases} влезни, {use.partners} комитенти.</>}
      </div>
      <ActionForm action={saveSchemeProfileAction} reset={false} className="">
        <input type="hidden" name="no" value={p?.no ?? ''} />
        <div className="card">
          <label className="f" style={{ maxWidth: 420 }}>Назив на шемата
            <input name="name" defaultValue={p?.name ?? ''} placeholder="на пр. Услуги во земјата (7414)" required disabled={!ed} maxLength={60} />
          </label>
        </div>
        <div className="card">
          <div className="hd" style={{ margin: '0 0 4px' }}><b>ДДВ конта по стапки</b></div>
          <p className="note" style={{ margin: '0 0 8px' }}>Само аналитички конта по стапка (на пр. 230018) – збирните 2300 / 1300 не се дозволени. ДДВ пријавата и книгите се пресметуваат од документите и не зависат од шемата.</p>
          <table><thead><tr><th>Стапка</th><th>Претходен ДДВ (Д)</th><th>ДДВ при увоз (Д)</th><th>Обврска за ДДВ (П)</th></tr></thead>
            <tbody>{VAT_RATES.map((r) => <tr key={r}><td><b>{r}%</b></td><td>{kin('VI' + r, vatOwn('vatIn', r), vatBase('in', r))}</td><td>{kin('VM' + r, vatOwn('vatImp', r), vatBase('imp', r))}</td><td>{kin('VO' + r, vatOwn('vatOut', r), vatBase('out', r))}</td></tr>)}</tbody></table>
          <div className="hd" style={{ margin: '14px 0 4px' }}><b>Основици за ДДВ пријава (вонбилансно, класа 99)</b></div>
          <table><thead><tr><th>Стапка</th>{VB_TYPES.map(([t, n]) => <th key={t} colSpan={2}>{n} – Д / П</th>)}</tr></thead>
            <tbody>{VAT_RATES.map((r) => <tr key={r}><td><b>{r}%</b></td>{VB_TYPES.map(([t]) => ['d', 'p'].map((s) => <td key={t + s}>{kin('s_vb' + t + r + s, own('vb' + t + r + s), base('vb' + t + r + s))}</td>))}</tr>)}</tbody></table>
        </div>
        {SCH_UI.map(([t, d, F]) => (
          <div className="card" key={t}>
            <h2 style={{ margin: 0 }}>{t}</h2>
            <p className="note" style={{ margin: '4px 0 10px' }}>{d}</p>
            <div className="form">{F.map(([k, n]) => (
              <div key={k}><div className="mini">{n} <span className="mut">({k})</span></div>{kin('s_' + k, own(k), base(k))}</div>
            ))}</div>
          </div>
        ))}
        {ed && <div className="row" style={{ justifyContent: 'flex-end', margin: '8px 0' }}><Submit>{p ? `Зачувај Шема ${p.no}` : 'Креирај ја шемата'}</Submit></div>}
      </ActionForm>
      {p && ed && (
        <div className="card">
          <div className="hd"><h2 style={{ margin: 0 }}>Копирај ја шемата во други фирми</h2>
            <RowAction className="btn sm danger" label={`🗑 Избриши Шема ${p.no}`} confirm={`Да се избрише Шема ${p.no} – „${p.name}“? Документите што ја користат мора прво да се прекнижат со друга шема.`} action={deleteSchemeProfileAction.bind(null, p.no)} />
          </div>
          <p className="note">Иста шема (назив) во фирмата се заменува; фирма во чиј контен план нема некое од контата се прескокнува.</p>
          {firms.length > 0 ? (
            <ActionForm action={copySchemeProfileAction} reset={false} className="">
              <input type="hidden" name="no" value={p.no} />
              <div className="row" style={{ gap: '4px 14px', flexWrap: 'wrap', maxHeight: 220, overflow: 'auto' }}>
                {firms.map((f) => <label key={f.id} className="chk"><input type="checkbox" name="firm" value={f.id} /> {f.name}</label>)}
              </div>
              <div className="row" style={{ gap: 8, marginTop: 8 }}>
                <Submit className="btn">Копирај во избраните фирми</Submit>
                {owner && <Submit className="btn" name="all" value="1">Копирај во сите фирми</Submit>}
              </div>
            </ActionForm>
          ) : <p className="note">Немате други фирми.</p>}
        </div>
      )}
    </>
  );
}
