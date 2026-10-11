/**
 * 👥 Клиенти — the client's CDD file (чл. 13–19, 37–46) and risk assessment, plus the overview of all clients
 * (legacy client tab, extended: ЦРСМ check, PEP declaration, sanctions screening, EDD approval, relationship dates,
 * documents, risk history).
 */
import { AML_IND, AML_LEVELS, AML_LV, amlCddChecklist, amlCompleteness, amlNextReview, amlRetainUntil, amlRiskFull, maskEmbg, type AmlCdd, type AmlLevel } from '@wise/core/office';
import { ActionForm } from '@/components/action-form';
import { FileChips, Pill } from '@/components/file-chips';
import { FirmGo } from '@/components/firm-go';
import { dmy } from '@/components/hd';
import { OwnTplLinks } from '@/components/own-tpl-links';
import { RowAction } from '@/components/row-action';
import { UploadField } from '@/components/upload-field';
import { AML_CDD_ENTITY, amlAutoFor } from '@/lib/aml';
import { fmt } from '@/lib/fmt';
import { filesOf } from '@/lib/office';
import { saveAml } from './actions';
import { amlGo } from './office-actions';
import type { AmlFirm, AmlRec } from './report-form';

const H = ({ children }: { children: React.ReactNode }) => <h3 style={{ fontSize: 14, margin: '10px 0 4px' }}>{children}</h3>;
const T = (p: { n: string; l: string; v?: string | null; type?: string; ph?: string; wide?: boolean }) =>
  <label className={`f${p.wide ? ' wide' : ''}`}>{p.l}<input name={p.n} type={p.type ?? 'text'} defaultValue={p.v ?? ''} placeholder={p.ph} autoComplete="off" /></label>;

export async function TabClient({ firm, clients, records, today: td, admin }: { firm: (AmlFirm & { id: string }) | null; clients: AmlFirm[]; records: AmlRec[]; today: string; admin: boolean }) {
  const rec = firm ? records.find((r) => r.firmId === firm.id) : undefined;
  const A = (rec?.data ?? {}) as AmlCdd;
  const X = firm ? await amlAutoFor(firm as never, Number(td.slice(0, 4))) : null;
  const risk = firm && X ? amlRiskFull(A, X, { eurRate: X.eurRate, today: td, nkd: X.nkd }) : null;
  const bo = [...(A.bo ?? []), ...Array(Math.max(0, 6 - (A.bo?.length ?? 0))).fill(null)].slice(0, 6) as (NonNullable<AmlCdd['bo']>[number] | null)[];
  const docs = firm ? (await filesOf(AML_CDD_ENTITY, [firm.id])).get(firm.id) ?? [] : [];
  const check = risk ? amlCddChecklist(A, X, risk.level, td) : [];
  const enh = !!risk?.enhanced || !!A.pep;
  const S = firm?.settings as { regDate?: string; manager?: string } | undefined;
  return (
    <>
      <div className="card noprint"><div className="row" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <RowAction action={amlGo} label="🔍 Пресметај ризик за сите клиенти" className="btn" showOk />
        <span className="muted">{records.length} анализирани · {clients.filter((c) => { const r = records.find((x) => x.firmId === c.id); return !r || (r.nextReview && r.nextReview <= td); }).length} за анализа/преглед</span></div>
        <p className="mini" style={{ margin: '6px 0 0' }}>Изберете клиент горе (избор на фирма). Анализата на клиентот се спроведува <b>пред</b> воспоставување на деловниот однос (чл. 16); ако не може да се спроведе, односот не се воспоставува или се прекинува (чл. 46).</p></div>

      {firm && risk && X ? (
        <ActionForm action={saveAml} reset={false}>
          <div className="hd"><h2>{firm.name}</h2>
            <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}><Pill c={AML_LV[risk.level][2]}>Ризик: {AML_LV[risk.level][0]} ({risk.score})</Pill>
              {risk.enhanced && <Pill c="bad">засилена анализа</Pill>}
              <span className="mini">комплетност {amlCompleteness(A, X)}% · следен преглед {dmy(amlNextReview(A, risk.level, td))}</span>
              <a className="btn sm noprint" href="/amlDoc?d=cdd" target="_blank" rel="noopener">🖨 Образец за анализа</a>
              <a className="btn sm noprint" href="/amlDoc?d=decl" target="_blank" rel="noopener">🖨 Изјава ВС / PEP</a></div></div>
          <p className="note" style={{ margin: 0 }}>Од книгите: промет {fmt(X.rev)} ден.; готовински ставки ≥ 1.000 €: {X.cash}{X.cash ? ` (најголема ${fmt(X.cashMax)})` : ''}; дејност {X.nkd || '—'}{X.nkdRisk ? ' (повисок ризик)' : ''}.</p>
          {risk.factors.length > 0 && <ul className="mini" style={{ margin: '4px 0' }}>{risk.factors.map(([t, w]) => <li key={t}>{t} (+{w})</li>)}</ul>}
          <div className="callout" style={{ marginTop: 6 }}><b>Проверки:</b> {check.filter(([, , ok]) => !ok).length ? <ul className="mini" style={{ margin: '2px 0 0' }}>{check.filter(([, , ok]) => !ok).map(([k, t]) => <li key={k} style={{ color: 'var(--bad)' }}>✗ {t}</li>)}</ul> : <span style={{ color: 'var(--good)' }}>✓ анализата е комплетна</span>}</div>

          <H>1. Клиент – правно лице (чл. 17 ст.3–4)</H>
          <p className="mini" style={{ margin: 0 }}>{firm.name} · ЕДБ {firm.edb ?? '—'} · ЕМБС {firm.embs ?? '—'} · {[firm.address, firm.city].filter(Boolean).join(', ')} {S?.regDate ? `· основано ${dmy(S.regDate)}` : ''}</p>
          <div className="form">
            <T n="cl_legalForm" l="Правна форма" v={A.client?.legalForm} ph="ДООЕЛ / ДОО / АД / ТП" />
            <T n="cl_seat" l="Седиште (ако е различно)" v={A.client?.seat} />
            <T n="cl_activity" l="Претежна дејност" v={A.client?.activity ?? firm.activity} />
            <T n="cl_bank" l="Трансакциски сметки / банки" v={A.client?.bankAccounts} wide />
            <T n="crDate" l="Тековна состојба од ЦР од (≤ 6 месеци)" v={A.crDate} type="date" />
            <T n="cl_crNo" l="Бр. на тековната состојба" v={A.client?.crNo} />
          </div>

          <H>2. Законски застапник (чл. 17 ст.1–2)</H>
          <div className="form">
            <T n="rep_name" l="Име и презиме" v={A.rep?.name ?? S?.manager} />
            <T n="rep_role" l="Функција" v={A.repX?.role} ph="управител" />
            <T n="rep_embg" l="ЕМБГ" v={A.rep?.embg} />
            <T n="rep_dob" l="Датум на раѓање" v={A.repX?.dob} type="date" />
            <T n="rep_address" l="Адреса на живеалиште" v={A.repX?.address} wide />
            <T n="rep_cit" l="Државјанство" v={A.repX?.cit} />
            <T n="rep_idType" l="Вид документ" v={A.rep?.idType} ph="лична карта / пасош" />
            <T n="rep_idNo" l="Број на документ" v={A.rep?.idNo} />
            <T n="rep_idIssuer" l="Издаден од" v={A.repX?.idIssuer} />
            <T n="rep_idValid" l="Важи до" v={A.rep?.idValid} type="date" />
            <label className="f">Начин на верификација<select name="rep_verMethod" defaultValue={A.repX?.verMethod ?? ''}><option value="">—</option>{['лично присуство – оригинален документ', 'квалификуван електронски потпис / е-идентификација', 'нотарски заверена копија'].map((m) => <option key={m}>{m}</option>)}</select></label>
            <T n="rep_verDate" l="Датум на верификација" v={A.repX?.verDate} type="date" />
            <label className="chk"><input type="checkbox" name="rep_ver" defaultChecked={!!A.rep?.ver} /> Идентитетот е верификуван, копија од документот е зачувана</label>
            <label className="chk"><input type="checkbox" name="nonFace" defaultChecked={!!A.nonFace} /> Без физичко присуство (чл. 41)</label>
          </div>

          <H>3. Ополномоштено лице (чл. 18) – ако дејствува друг во име на клиентот</H>
          <div className="form">
            <T n="px_name" l="Име и презиме" v={A.proxy?.name} /><T n="px_embg" l="ЕМБГ" v={A.proxy?.embg} /><T n="px_idNo" l="Документ бр." v={A.proxy?.idNo} />
            <T n="px_basis" l="Полномошно (бр., датум, заверка)" v={A.proxy?.basis} wide />
          </div>

          <H>4. Вистински сопственици (чл. 19–20: над 25% удели / гласови или контрола)</H>
          <div className="tw"><table className="dense"><thead><tr><th>Име / назив</th><th>ЕМБГ / ЕМБС</th><th>Државјанство</th><th>Удел %</th><th>ПЛ</th><th>PEP</th><th>Проверен на</th></tr></thead><tbody>
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
            <T n="crsm_date" l="Проверка во Регистарот на ВС (ЦРСМ) на" v={A.crsm?.date} type="date" />
            <label className="f">Резултат<select name="crsm_result" defaultValue={A.crsm?.result ?? ''}><option value="">—</option><option value="match">податоците се совпаѓаат</option><option value="mismatch">несогласување</option><option value="none">ВС не е запишан / ажуриран</option></select></label>
            <T n="crsm_disc" l="Несогласувањето пријавено до УФР на" v={A.crsm?.discReported} type="date" />
            <T n="crsm_note" l="Забелешка (што не се совпаѓа)" v={A.crsm?.note} wide />
          </div>
          <p className="mini" style={{ margin: '2px 0 0' }}>Проверката во Регистарот е задолжителна, но не е доволна сама по себе (чл. 19 ст.3). Ако ВС не е впишан, деловниот однос се одлага до впишувањето; несогласувањата веднаш се пријавуваат до УФР (чл. 32) – програмата автоматски креира пријава.</p>

          <H>5. Деловен однос (чл. 15)</H>
          <div className="form">
            <T n="services" l="Услуги (природа на односот)" v={A.services} ph="сметководство, плати, даночни пријави" wide />
            <T n="purpose" l="Цел и намена на деловниот однос" v={A.purpose} ph="водење сметководство за деловните активности на клиентот" wide />
            <T n="source" l="Извор на средства" v={A.source} ph="приходи од дејноста, основачки влог" wide />
            <T n="relStart" l="Почеток на деловниот однос" v={A.relStart} type="date" />
            <T n="cddDone" l="Анализата завршена на" v={A.cddDone} type="date" />
            <T n="relEnd" l="Крај на деловниот однос" v={A.relEnd} type="date" />
          </div>
          {A.relEnd && <p className="mini" style={{ margin: 0 }}>🔒 Досието се чува до {dmy(amlRetainUntil(A.relEnd))} (10 години од крајот на односот, чл. 62).</p>}

          <H>6. Носител на јавна функција (чл. 2 т.39, чл. 42) и санкции</H>
          <div className="form">
            <label className="chk"><input type="checkbox" name="pep" defaultChecked={!!A.pep} /> Клиентот / ВС / застапникот е носител на јавна функција, член на семејство или близок соработник (и до 2 години по престанокот)</label>
            <T n="pepd_date" l="Изјава за PEP добиена на" v={A.pepDecl?.date ?? (A.pepAsked ? A.created : null)} type="date" />
            <T n="pepd_fn" l="Функција" v={A.pepDecl?.fn} />
            <T n="pepd_rel" l="Однос (лично / семејство / соработник)" v={A.pepDecl?.relation} />
            <label className="chk"><input type="checkbox" name="hrc" defaultChecked={!!A.hrc} /> Поврзаност со високоризична земја (чл. 43)</label>
          </div>
          <div className="form">
            <T n="sanc_date" l="Проверка во листите на санкции на" v={A.sanc?.date} type="date" />
            <T n="sanc_lists" l="Проверени листи" v={A.sanc?.lists ?? 'Консолидирана листа на СБ на ОН; листи на рестриктивни мерки (УФР)'} wide />
            <label className="f">Резултат<select name="sanc_result" defaultValue={A.sanc?.result ?? ''}><option value="">—</option><option value="none">нема совпаѓање</option><option value="possible">можно совпаѓање – за проверка</option><option value="hit">совпаѓање</option></select></label>
            <T n="sanc_by" l="Проверил" v={A.sanc?.by} />
            <T n="sanc_note" l="Забелешка" v={A.sanc?.note} wide />
          </div>
          <p className="mini" style={{ margin: '2px 0 0' }}>Листи: <a href="https://ufr.gov.mk/?page_id=257" target="_blank" rel="noopener">рестриктивни мерки (УФР)</a> · <a href="https://ufr.gov.mk/?page_id=327" target="_blank" rel="noopener">листа на ОН</a> · <a href="https://ufr.gov.mk/?page_id=325" target="_blank" rel="noopener">домашни јавни функции</a>. При совпаѓање: <b>без одлагање</b> замрзнување според Законот за рестриктивни мерки и известување до УФР; клиентот не се известува.</p>

          <H>7. Засилена анализа (чл. 39, 41–45){enh ? '' : ' – не е потребна според ризикот'}</H>
          <div className="form">
            <T n="edd_reason" l="Причина" v={A.edd?.reason ?? (risk.enhanced ? risk.factors.filter(([, w]) => w >= 3).map(([t]) => t).join('; ') : '')} wide />
            <T n="wealth" l="Извор на богатството (имотот) и средствата" v={A.wealth} wide />
            <T n="edd_measures" l="Дополнителни мерки (документи, проверки)" v={A.edd?.measures} wide />
            <T n="edd_mon" l="Засилено следење (како и колку често)" v={A.edd?.monitoring} wide />
          </div>
          <p className="mini" style={{ margin: '2px 0 0' }}>Одобрение од раководството: {A.mgrOk ? <b>{dmy(A.mgrOk)}{A.edd?.mgrBy ? ` – ${A.edd.mgrBy}` : ''}</b> : <b style={{ color: enh ? 'var(--bad)' : undefined }}>нема</b>}{!admin && enh ? ' (го дава сопственикот)' : ''}</p>

          <H>8. Поедноставена анализа / одбиен однос</H>
          <div className="form">
            <label className="chk"><input type="checkbox" name="simplified" defaultChecked={!!A.simplified} /> Поедноставена анализа (само документиран низок ризик, чл. 38)</label>
            <T n="simplifiedReason" l="Образложение" v={A.simplifiedReason} wide />
            <T n="ref_date" l="Однос одбиен / прекинат на (чл. 46)" v={A.refused?.date} type="date" />
            <T n="ref_reason" l="Причина" v={A.refused?.reason} wide />
          </div>

          <H>9. Индикатори за сомнителност</H>
          <div style={{ display: 'grid', gap: 4 }}>
            {AML_IND.map(([k, t]) => <label key={k} className="chk"><input type="checkbox" name={`ind_${k}`} defaultChecked={!!A.ind?.[k]} /> {t}</label>)}
          </div>
          <div className="callout warn" style={{ marginTop: 6 }}>Ако има сомневање: <b>внатрешна пријава</b> до овластеното лице (таб „Пријави и УФР“). <b>Клиентот не смее да се извести</b> за сомневањето или пријавата (чл. 72).</div>

          <H>10. Документи (копии од документите за идентификација, тековна состојба, изјави)</H>
          <FileChips files={docs} />
          <UploadField firmId={null} label="📎 Прикачи документи (видливи само за канцеларијата)" />

          <div className="form">
            <label className="f">Рачна категорија (само повисока)<select name="lvOver" defaultValue={A.lvOver ?? ''}>
              <option value="">— автоматски —</option>{AML_LEVELS.map((l: AmlLevel) => <option key={l} value={l}>{AML_LV[l][0]}</option>)}
            </select></label>
            <T n="lastReview" l="Последна анализа" v={A.lastReview} type="date" />
          </div>
          <div className="row savebar"><button className="btn pri">Зачувај и пресметај ризик</button>
            <button className="btn" name="reviewed" value="on">✓ Анализата е обновена денес</button>
            {enh && admin && <button className="btn" name="mgrOk" value="on" title="Засилена анализа: одобрение од раководството (чл. 39, 42)">✓ Одобрение од раководството{A.mgrOk ? ` (${dmy(A.mgrOk)})` : ''}</button>}
            <OwnTplLinks src="aml:" docs={[{ k: 'd:Анализа на клиент (ПП/ФТ)', label: 'Анализа на клиент' }, { k: 'd:Изјава за вистински сопственик и носител на јавна функција', label: 'Изјава за ВС' }]} /></div>

          {(A.hist ?? []).length > 0 && <>
            <H>Историја на проценки на ризик</H>
            <table className="dense"><thead><tr><th>Датум</th><th>Ризик</th><th>Поени</th><th>Проценил</th><th>Фактори</th></tr></thead>
              <tbody>{[...(A.hist ?? [])].reverse().map((h, i) => <tr key={i}><td>{dmy(h.date)}</td><td>{AML_LV[h.level]?.[0]}</td><td>{h.score}</td><td>{h.by}</td><td className="mini">{(h.factors ?? []).join('; ')}</td></tr>)}</tbody></table>
          </>}
        </ActionForm>
      ) : <div className="callout">Изберете клиент (фирма) за анализа – горе во изборот на фирма или од прегледот подолу.</div>}

      <div className="card">
        <h2 style={{ fontSize: 15 }}>Преглед на клиенти</h2>
        <div className="tw"><table className="dense">
          <thead><tr><th>Фирма</th><th>Ризик</th><th>Поени</th><th>Вистински сопственици</th><th>Сигнали</th><th>Последна</th><th>Следна</th><th></th></tr></thead>
          <tbody>
            {clients.map((f) => {
              const r = records.find((x) => x.firmId === f.id);
              const d = (r?.data ?? {}) as AmlCdd;
              const lv = (r?.level ?? null) as AmlLevel | null;
              return (
                <tr key={f.id}>
                  <td>{f.name}</td>
                  <td>{lv ? <Pill c={AML_LV[lv][2]}>{AML_LV[lv][0]}</Pill> : <Pill c="warn">не е анализиран</Pill>}</td>
                  <td>{r?.score ?? ''}</td>
                  <td className="mini">{(d.bo ?? []).map((b) => `${b.name} ${maskEmbg(b.embg)}`).join('; ')}</td>
                  <td className="mini">{[d.pep && 'PEP', d.hrc && 'високоризична земја', d.nonFace && 'без лично присуство', d.sanc?.result === 'hit' && 'САНКЦИИ', d.relEnd && `однос завршен ${dmy(d.relEnd)}`, ...AML_IND.filter(([k]) => d.ind?.[k]).map(([, t]) => t)].filter(Boolean).join('; ') || '—'}</td>
                  <td>{dmy(r?.lastReview)}</td>
                  <td style={r?.nextReview && r.nextReview <= td ? { color: 'var(--bad)', fontWeight: 700 } : undefined}>{dmy(r?.nextReview)}</td>
                  <td className="noprint">{firm?.id !== f.id && <FirmGo fid={f.id} current={firm?.id ?? null} to="/aml?tab=cl" className="btn sm">Отвори</FirmGo>}</td>
                </tr>
              );
            })}
          </tbody>
        </table></div>
      </div>
    </>
  );
}
