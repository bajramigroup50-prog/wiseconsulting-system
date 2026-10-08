/** Legacy `VIEWS.aml` **15976** — AML (ЗСППФТ) client risk assessment and the office overview. */
import { eq } from 'drizzle-orm';
import { AML_IND, AML_LEVELS, AML_LV, amlCompleteness, amlNextReview, amlRisk, maskEmbg, type AmlFile, type AmlLevel } from '@wise/core/office';
import { amlRecords } from '@wise/db';
import { amlAutoFor } from '@/lib/aml';
import { db } from '@/lib/db';
import { allowedFirms, officePage, today } from '@/lib/office';
import { ActionForm } from '@/components/action-form';
import { Pill } from '@/components/file-chips';
import { Hd, dmy } from '@/components/hd';
import { fmt } from '@/lib/fmt';
import { saveAml } from './actions';

export default async function AmlPage() {
  const { u, firm } = await officePage('aml', { perm: 'office' });
  const td = today();
  const [F, R] = await Promise.all([allowedFirms(u), db().select().from(amlRecords)]);
  const rec = firm ? R.find((r) => r.firmId === firm.id) : undefined;
  const A = (rec?.data ?? {}) as AmlFile;
  const X = firm ? await amlAutoFor(firm, Number(td.slice(0, 4))) : null;
  const risk = firm && X ? amlRisk(A, X, { eurRate: X.eurRate, today: td, nkd: X.nkd }) : null;
  const bo = [...(A.bo ?? []), ...Array(Math.max(0, 4 - (A.bo?.length ?? 0))).fill(null)].slice(0, 4) as (NonNullable<AmlFile['bo']>[number] | null)[];
  const due = F.map((f) => ({ f, r: R.find((x) => x.firmId === f.id) })).filter(({ r }) => !r || (r.nextReview && r.nextReview <= td));

  return (
    <>
      <Hd t="🛡 Спречување перење пари (УФР)" sub={`${R.length} анализирани · ${due.length} за анализа/преглед`} />
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
            <label className="chk"><input type="checkbox" name="reviewed" /> Анализата е направена денес</label>
          </div>
          <div className="row"><button className="btn pri">Зачувај и пресметај ризик</button>
            <a className="btn" href="/tpl">📄 Документи (Анализа на клиент, Изјава за ВС) – Шаблони</a></div>
        </ActionForm>
      ) : <div className="callout">Изберете фирма за анализа на клиентот.</div>}

      <div className="card">
        <h2 style={{ fontSize: 15 }}>Преглед на клиенти</h2>
        <div className="tw"><table className="dense">
          <thead><tr><th>Фирма</th><th>Ризик</th><th>Поени</th><th>Вистински сопственици</th><th>Последна</th><th>Следна</th></tr></thead>
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
