/**
 * Legacy `VIEWS.aml` **15976** — AML (ЗСППФТ): only the owner and the AML officer see the module (`amlOn`); everyone
 * else gets the internal suspicion report form. Tabs: 👥 Клиенти (batch analysis, risk counts, client file, overview),
 * 🏢 Канцеларија (officer / deputy, trainings, annual control, links), 🚩 Пријави (internal reports and their status).
 */
import { desc, eq } from 'drizzle-orm';
import { AML_IND, AML_LEVELS, AML_LV, amlCompleteness, amlNextReview, amlRisk, maskEmbg, type AmlFile, type AmlLevel } from '@wise/core/office';
import { amlRecords, amlReports, users } from '@wise/db';
import { amlAllowed, amlAutoFor, amlOffice } from '@/lib/aml';
import { db } from '@/lib/db';
import { allowedFirms, officePage, today } from '@/lib/office';
import { ActionForm } from '@/components/action-form';
import { Pill } from '@/components/file-chips';
import { Hd, dmy } from '@/components/hd';
import { fmt } from '@/lib/fmt';
import { RowAction } from '@/components/row-action';
import { OwnTplLinks } from '@/components/own-tpl-links';
import { saveAml } from './actions';
import { amlCtl, amlGo, amlOffSet, amlRepNew, amlRepSt, amlTrAdd } from './office-actions';

function ReportForm({ firms: F }: { firms: { id: string; name: string }[] }) {
  return (
    <ActionForm action={amlRepNew}>
      <h2 style={{ fontSize: 15, margin: '0 0 6px' }}>Нова внатрешна пријава за сомневање</h2>
      <div className="form">
        <label className="f">Клиент<select name="firmId"><option value="">—</option>{F.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}</select></label>
        <label className="f wide">Опис (што, кога, износ, индикатор)<textarea name="text" rows={3} style={{ width: '100%', font: 'inherit' }} /></label>
      </div>
      <button className="btn pri" style={{ marginTop: 6 }}>🚩 Испрати до овластеното лице</button>
      <p className="mini" style={{ margin: '6px 0 0' }}>Овластеното лице ја анализира и без одложување ја известува УФР преку <a href="https://ws-askmk.ufr.gov.mk/logon.html" target="_blank" rel="noopener">АСКМК</a> ако сомневањето е основано.</p>
    </ActionForm>
  );
}

export default async function AmlPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const sp = await searchParams;
  const { u, firm } = await officePage('aml', { perm: 'write' });
  const td = today();
  const F0 = await allowedFirms(u);
  const clientsF = F0.filter((f) => !(f.settings as { officeFirm?: boolean }).officeFirm);
  if (!(await amlAllowed(u))) {
    return (
      <>
        <Hd t="🚩 Пријави сомневање (УФР)" sub="внатрешна пријава до овластеното лице" exp={false} />
        <div className="callout bad"><b>Законска обврска:</b> ако забележите сомнителна трансакција или однесување кај клиент, веднаш пријавете го овде. Пријавата ја гледаат <b>само</b> управителот и овластеното лице. <b>Не го известувајте клиентот</b> ниту други лица.</div>
        <ReportForm firms={clientsF} />
      </>
    );
  }
  const tab = sp.tab === 'off' || sp.tab === 'rep' ? sp.tab : 'cl';
  const [F, R, O, reps, U] = await Promise.all([Promise.resolve(F0), db().select().from(amlRecords), amlOffice(),
    db().select().from(amlReports).orderBy(desc(amlReports.createdAt)), db().select({ id: users.id, name: users.name, role: users.role, active: users.active }).from(users)]);
  const y = td.slice(0, 4);
  const tr = (O.tr ?? []).filter((t) => t.date.startsWith(y));
  const warn = [!O.officer && 'Не е определено овластено лице.', tr.length < 2 && `Обуки во ${y}: ${tr.length} (потребни најмалку 2).`, !(O.ctl ?? '').startsWith(y) && 'Годишна внатрешна контрола не е евидентирана.'].filter(Boolean) as string[];
  const head = (
    <>
      <Hd t="🛡 Спречување перење пари и финансирање тероризам" sub="УФР · ЗСППФТ (151/2022, 208/2024)" />
      {warn.length > 0 && <div className="callout warn">{warn.map((w) => <div key={w}>{w}</div>)}</div>}
      <div className="row" style={{ gap: 6, marginBottom: 8 }}>
        {([['cl', '👥 Клиенти'], ['off', '🏢 Канцеларија (програма, лице, обуки)'], ['rep', '🚩 Пријави']] as const).map(([k, n]) => <a key={k} className={`btn ${tab === k ? 'pri' : ''}`} href={`/aml?tab=${k}`}>{n}</a>)}
      </div>
    </>
  );
  if (tab === 'off') return (
    <>
      {head}
      <ActionForm action={amlOffSet} reset={false}>
        <h2 style={{ fontSize: 15, margin: '0 0 6px' }}>Овластено лице и заменик</h2>
        <div className="form">
          <label className="f">Овластено лице<input name="officer" defaultValue={O.officer ?? ''} /></label>
          <label className="f">Корисник во програмата (пристап до модулот)<select name="offUid" defaultValue={O.offUid ?? ''}><option value="">—</option>{U.filter((x) => x.role !== 'klient' && x.active).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
          <label className="f">Заменик<input name="deputy" defaultValue={O.deputy ?? ''} /></label>
        </div>
        <button className="btn pri" style={{ marginTop: 6 }}>Зачувај</button>
      </ActionForm>
      <div className="card">
        <h2 style={{ fontSize: 15, margin: '0 0 6px' }}>Документи на канцеларијата</h2>
        <p className="note" style={{ margin: 0 }}>Одлука за овластено лице и заменик, Програма за спречување ПП/ФТ (член 12) и Проценка на ризик на канцеларијата (член 11) се прават од <a href="/tpl">📄 Шаблони</a> (Word / PDF).</p>
        <div className="row" style={{ flexWrap: 'wrap', gap: 4, marginTop: 6 }}><OwnTplLinks src="firm:" docs={['Одлука за овластено лице', 'Програма за спречување ПП/ФТ', 'Проценка на ризик на канцеларијата'].map((t) => ({ k: `d:${t}`, label: t }))} /></div>
      </div>
      <ActionForm action={amlTrAdd}>
        <h2 style={{ fontSize: 15, margin: '0 0 6px' }}>Обуки (најмалку 2 годишно) · во {y}: {tr.length}</h2>
        <div className="form">
          <label className="f">Датум<input name="date" type="date" /></label>
          <label className="f wide">Тема<input name="topic" placeholder="пр. Индикатори за сомнителни трансакции; нови листи на УФР" /></label>
          <label className="f wide">Учесници<input name="who" /></label>
        </div>
        <button className="btn sm" style={{ marginTop: 6 }}>+ Евидентирај обука</button>
        {(O.tr ?? []).length > 0 && <table className="dense" style={{ marginTop: 6 }}><tbody>{[...(O.tr ?? [])].reverse().map((t, i) => <tr key={i}><td>{dmy(t.date)}</td><td>{t.topic}</td><td>{t.who ?? ''}</td></tr>)}</tbody></table>}
      </ActionForm>
      <div className="card">
        <h2 style={{ fontSize: 15, margin: '0 0 6px' }}>Годишна внатрешна контрола</h2>
        <p style={{ margin: '0 0 6px' }}>Последна: <b>{O.ctl ? dmy(O.ctl) : '—'}</b></p>
        <RowAction action={amlCtl} label="✓ Извршена денес" className="btn sm" />
        <p className="mini" style={{ margin: '8px 0 0' }}>Корисни линкови: <a href="https://ufr.gov.mk/wp-content/uploads/2020/05/Indikatori.pdf" target="_blank" rel="noopener">Листа на индикатори (УФР)</a> · <a href="https://ufr.gov.mk/?page_id=3315" target="_blank" rel="noopener">Високоризични земји</a> · <a href="https://ws-askmk.ufr.gov.mk/logon.html" target="_blank" rel="noopener">АСКМК – пријави до УФР</a></p>
      </div>
    </>
  );
  if (tab === 'rep') return (
    <>
      {head}
      <div className="callout bad"><b>Забрана за откривање:</b> клиентот или трети лица не смеат да се известат дека има сомневање, внатрешна пријава или пријава до УФР.</div>
      <ReportForm firms={clientsF} />
      <div className="card tw">{reps.length ? <table className="dense">
        <thead><tr><th>Датум</th><th>Клиент</th><th>Опис</th><th>Пријавил</th><th>Статус</th><th></th></tr></thead>
        <tbody>{reps.map((x) => (
          <tr key={x.id}><td>{dmy(x.createdAt)}</td><td>{x.firmName}</td><td>{x.text}</td><td>{x.createdByName}</td><td>{x.status}{x.note && <div className="mini">{x.note}</div>}</td>
            <td style={{ whiteSpace: 'nowrap' }}>{(x.status === 'нова' || x.status === 'анализа') && <>
              <RowAction action={amlRepSt.bind(null, x.id, 'анализа')} label="Анализа" className="btn sm" />
              <RowAction action={amlRepSt.bind(null, x.id, 'пријавено во УФР')} label="Пријавено во УФР" className="btn sm pri" />
              <RowAction action={amlRepSt.bind(null, x.id, 'затворено')} label="Без пријава" className="btn sm" />
            </>}</td></tr>
        ))}</tbody>
      </table> : <div className="empty">Нема внатрешни пријави.</div>}</div>
    </>
  );
  const rec = firm ? R.find((r) => r.firmId === firm.id) : undefined;
  const A = (rec?.data ?? {}) as AmlFile;
  const X = firm ? await amlAutoFor(firm, Number(td.slice(0, 4))) : null;
  const risk = firm && X ? amlRisk(A, X, { eurRate: X.eurRate, today: td, nkd: X.nkd }) : null;
  const bo = [...(A.bo ?? []), ...Array(Math.max(0, 4 - (A.bo?.length ?? 0))).fill(null)].slice(0, 4) as (NonNullable<AmlFile['bo']>[number] | null)[];
  const due = F.map((f) => ({ f, r: R.find((x) => x.firmId === f.id) })).filter(({ r }) => !r || (r.nextReview && r.nextReview <= td));

  return (
    <>
      {head}
      <div className="card"><div className="row" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <RowAction action={amlGo} label="🔍 Анализирај ги сите клиенти" className="btn pri" />
        <span className="muted">{R.length} анализирани · {due.length} за анализа/преглед</span></div>
        <p className="mini" style={{ margin: '6px 0 0' }}>Податоците се пополнуваат автоматски од фирмата, основањето, договорот и книгите (готовина, промет, вработени, дејност). Вие ги дополнувате проверките.</p></div>
      <div className="row" style={{ gap: 10, flexWrap: 'wrap', margin: '10px 0', alignItems: 'stretch' }}>
        {[...AML_LEVELS].reverse().map((l) => <div key={l} className="card" style={{ flex: 1, minWidth: 140, margin: 0 }}><div className="muted" style={{ fontSize: 12 }}>{AML_LV[l][0]} ризик</div><div style={{ fontSize: 22, fontWeight: 700 }}>{R.filter((r) => r.level === l).length}</div></div>)}
        <div className="card" style={{ flex: 1, minWidth: 140, margin: 0 }}><div className="muted" style={{ fontSize: 12 }}>За обновување</div><div style={{ fontSize: 22, fontWeight: 700 }}>{R.filter((r) => r.nextReview && r.nextReview <= td).length}</div></div>
      </div>
      {firm && risk && X ? (
        <ActionForm action={saveAml} reset={false}>
          <div className="hd"><h2>{firm.name}</h2>
            <div className="row"><Pill c={AML_LV[risk.level][2]}>Ризик: {AML_LV[risk.level][0]} ({risk.score})</Pill>
              <span className="mini">комплетност {amlCompleteness(A, X)}% · следна анализа {dmy(amlNextReview(A, risk.level, td))}</span></div></div>
          <p className="note" style={{ margin: 0 }}>Од книгите: промет {fmt(X.rev)} ден.; готовински ставки ≥ 1.000 €: {X.cash}{X.cash ? ` (најголема ${fmt(X.cashMax)})` : ''}; дејност {X.nkd || '—'}{X.nkdRisk ? ' (повисок ризик)' : ''}.</p>
          {risk.factors.length > 0 && <ul className="mini" style={{ margin: '4px 0' }}>{risk.factors.map(([t, w]) => <li key={t}>{t} (+{w})</li>)}</ul>}

          <h3 style={{ fontSize: 14, margin: '8px 0 4px' }}>Застапник</h3>
          <div className="form">
            <label className="f">Име и презиме<input name="rep_name" defaultValue={A.rep?.name ?? ''} /></label>
            <label className="f">ЕМБГ<input name="rep_embg" defaultValue={A.rep?.embg ?? ''} autoComplete="off" /></label>
            <label className="f">Број на лична карта<input name="rep_idNo" defaultValue={A.rep?.idNo ?? ''} autoComplete="off" /></label>
            <label className="f">Важи до<input name="rep_idValid" type="date" defaultValue={A.rep?.idValid ?? ''} /></label>
            <label className="chk"><input type="checkbox" name="rep_ver" defaultChecked={!!A.rep?.ver} /> Проверено со оригинален документ</label>
            <label className="chk"><input type="checkbox" name="nonFace" defaultChecked={!!A.nonFace} /> Без лично присуство</label>
          </div>
          <h3 style={{ fontSize: 14, margin: '8px 0 4px' }}>Вистински сопственици (над 25%)</h3>
          <div className="tw"><table className="dense"><thead><tr><th>Име / назив</th><th>ЕМБГ / ЕМБС</th><th>Државјанство</th><th>Удел %</th><th>ПЛ</th><th>PEP</th><th>Проверено во регистар</th></tr></thead><tbody>
            {bo.map((b, i) => (
              <tr key={i}>
                <td><input name={`bo${i}_name`} defaultValue={b?.name ?? ''} /></td><td><input name={`bo${i}_embg`} defaultValue={b?.embg ?? ''} autoComplete="off" /></td>
                <td><input name={`bo${i}_cit`} defaultValue={b?.cit ?? ''} /></td><td><input name={`bo${i}_share`} defaultValue={b?.share ?? ''} style={{ width: 70 }} /></td>
                <td><input type="checkbox" name={`bo${i}_legal`} defaultChecked={!!b?.legal} /></td><td><input type="checkbox" name={`bo${i}_pep`} defaultChecked={!!b?.pep} /></td>
                <td><input type="date" name={`bo${i}_ver`} defaultValue={b?.ver ?? ''} /></td>
              </tr>
            ))}
          </tbody></table></div>
          <div className="form">
            <label className="f">Тековна состојба од ЦР од<input name="crDate" type="date" defaultValue={A.crDate ?? ''} /></label>
            <label className="chk"><input type="checkbox" name="pep" defaultChecked={!!A.pep} /> PEP / поврзано лице</label>
            <label className="chk"><input type="checkbox" name="pepAsked" defaultChecked={A.pepAsked !== undefined} /> Изјава за PEP добиена</label>
            <label className="chk"><input type="checkbox" name="hrc" defaultChecked={!!A.hrc} /> Поврзаност со високоризична земја</label>
            <label className="f wide">Цел и природа на деловниот однос<input name="purpose" defaultValue={A.purpose ?? ''} placeholder="Сметководствени услуги" /></label>
            <label className="f wide">Извор на средства<input name="source" defaultValue={A.source ?? ''} /></label>
            <label className="f wide">Потекло на имотот (засилена анализа)<input name="wealth" defaultValue={A.wealth ?? ''} /></label>
          </div>
          <h3 style={{ fontSize: 14, margin: '8px 0 4px' }}>Индикатори за сомнителност</h3>
          <div style={{ display: 'grid', gap: 4 }}>
            {AML_IND.map(([k, t]) => <label key={k} className="chk"><input type="checkbox" name={`ind_${k}`} defaultChecked={!!A.ind?.[k]} /> {t}</label>)}
          </div>
          <div className="form">
            <label className="f">Рачна категорија<select name="lvOver" defaultValue={A.lvOver ?? ''}>
              <option value="">— автоматски —</option>{AML_LEVELS.map((l: AmlLevel) => <option key={l} value={l}>{AML_LV[l][0]}</option>)}
            </select></label>
            <label className="f">Последна анализа<input name="lastReview" type="date" defaultValue={A.lastReview ?? ''} /></label>

          </div>
          <div className="row savebar"><button className="btn pri">Зачувај и пресметај ризик</button>
            <button className="btn" name="reviewed" value="on">✓ Анализата е обновена денес</button>
            {(risk.level === 'high' || !!A.pep) && <button className="btn" name="mgrOk" value="on" title="Засилена анализа: потребно е одобрение од управителот">✓ Одобрение од управителот{A.mgrOk ? ` (${dmy(A.mgrOk)})` : ''}</button>}
            <OwnTplLinks src="aml:" docs={[{ k: 'd:Анализа на клиент (ПП/ФТ)', label: 'Анализа на клиент' }, { k: 'd:Изјава за вистински сопственик и носител на јавна функција', label: 'Изјава за ВС' }]}
              none={<a className="btn" href="/tpl">📄 Документи (Анализа на клиент, Изјава за ВС) – Шаблони</a>} /></div>
        </ActionForm>
      ) : <div className="callout">Изберете фирма за анализа на клиентот.</div>}

      <div className="card">
        <h2 style={{ fontSize: 15 }}>Преглед на клиенти</h2>
        <div className="tw"><table className="dense">
          <thead><tr><th>Фирма</th><th>Ризик</th><th>Поени</th><th>Вистински сопственици</th><th>Сигнали</th><th>Последна</th><th>Следна</th></tr></thead>
          <tbody>
            {F.map((f) => {
              const r = R.find((x) => x.firmId === f.id);
              const d = (r?.data ?? {}) as AmlFile;
              const lv = (r?.level ?? null) as AmlLevel | null;
              return (
                <tr key={f.id}>
                  <td>{f.name}</td>
                  <td>{lv ? <Pill c={AML_LV[lv][2]}>{AML_LV[lv][0]}</Pill> : <Pill c="warn">не е анализиран</Pill>}</td>
                  <td>{r?.score ?? ''}</td>
                  <td className="mini">{(d.bo ?? []).map((b) => `${b.name} ${maskEmbg(b.embg)}`).join('; ')}</td>
                  <td className="mini">{[d.pep && 'PEP', d.hrc && 'високоризична земја', d.nonFace && 'без лично присуство', ...AML_IND.filter(([k]) => d.ind?.[k]).map(([, t]) => t)].filter(Boolean).join('; ') || '—'}</td>
                  <td>{dmy(r?.lastReview)}</td>
                  <td style={r?.nextReview && r.nextReview <= td ? { color: 'var(--bad)', fontWeight: 700 } : undefined}>{dmy(r?.nextReview)}</td>
                </tr>
              );
            })}
          </tbody>
        </table></div>
      </div>
    </>
  );
}
