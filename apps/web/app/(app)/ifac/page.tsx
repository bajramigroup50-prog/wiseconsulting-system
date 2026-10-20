/**
 * 🤝 IFAC – Ангажмани и етика: the professional standards ИСОС requires of its members, per client firm and year —
 * ✉ the ISRS 4410 engagement letter (generated from the firm and its contract, printed and signed, archived in the
 * dossier with a renewal reminder), ✅ the ISQM 1 checklist (acceptance / continuance with the УФР analysis, the
 * IESBA declarations, the contract and the letter read from the system; the year-end review by a second person),
 * the engagement file and the compiler's report, 📋 the overview of all clients, and office-wide (`./tabs`) 🏛 the ISQM 1
 * system, 👥 the employees (competence, CPD), 🧭 the IESBA declarations (→ ISO „Обуки“), 🏛 the obligations towards ИСОС
 * (`./isos-tab`: insurance, the list by 31.01, the questionnaire by 31.03, the control on the spot) and 🎯 the readiness.
 */
import Link from 'next/link';
import { KD_SVC } from '@wise/core/firms/kdog';
import { can } from '@wise/core';
import {
  EL_FRAMEWORKS, elFileNormalize, elFileStatus, elHtml, elNew, elStatus, QC_DECISIONS, QC_REVIEW, QC_RISK, qcEmpty, qcNormalize, qcStatus, type QcLine,
} from '@wise/core/office/ifac';
import { IFAC_FILE_ENTITY } from '@wise/core/office/ifac-sqm';
import { ethicsSigned, ethicsStaff, ifacGet, ifacYear, letterOf, qcAuto } from '@wise/db';
import { FileChips } from '@/components/file-chips';
import { currentYear } from '@/lib/context';
import { db } from '@/lib/db';
import { isDemoUser } from '@/lib/demo';
import { allowedFirms, filesOf, officePage, today } from '@/lib/office';
import { ActionForm, Submit } from '@/components/action-form';
import { FirmGo } from '@/components/firm-go';
import { Hd, dmy } from '@/components/hd';
import { RowAction } from '@/components/row-action';
import { UploadField } from '@/components/upload-field';
import { firmOf, imgUrl, loadProvider, officeFirm } from '../kdogovori/lib';
import { letterDelete, letterSave, letterSign, qcSave } from './actions';
import { Meta, TabEthics, TabReady, TabSqm, TabStaff } from './tabs';
import { TabIsos } from './isos-tab';
import { contractFor } from './lib';

type Tab = 'el' | 'qc' | 'all' | 'sqm' | 'staff' | 'et' | 'isos' | 'ready';
const TABS: [Tab, string][] = [
  ['el', '✉ Писмо за ангажман (ISRS 4410)'], ['qc', '✅ Ангажман (ISQM 1)'], ['all', '📋 Сите клиенти'],
  ['sqm', '🏛 Систем (ISQM 1)'], ['staff', '👥 Вработени'], ['et', '🧭 Етика (IESBA)'], ['isos', '🏛 ИСОС'], ['ready', '🎯 Подготвеност'],
];

const Line = ({ x }: { x: QcLine }) => (
  <li style={{ margin: '3px 0' }}>{x.ok ? <span className="pill good">✓</span> : <span className="pill warn">!</span>} {x.n}{x.auto ? <span className="mini"> · од системот: {x.info}</span> : null}</li>
);

export default async function IfacPage({ searchParams }: { searchParams: Promise<{ t?: string; c?: string; u?: string; p?: string }> }) {
  const sp = await searchParams;
  const { u, firm } = await officePage('ifac', { perm: 'office' });
  const td = today(), year = await currentYear();
  const tab: Tab = (TABS.find(([k]) => k === sp.t)?.[0]) ?? (firm ? 'el' : 'all');
  const demo = isDemoUser(u);
  const [P, staff, signed] = await Promise.all([loadProvider(u), db().transaction((tx) => ethicsStaff(tx, demo)), db().transaction((tx) => ethicsSigned(tx, year))]);
  const O = P.O;
  const uName = (id: string | null | undefined) => staff.find((x) => x.id === id)?.name ?? '';
  const mine = signed.get(u.id);
  const canSet = can(u.principal, 'settings', null);

  return (
    <>
      <Hd t="🤝 IFAC – Ангажмани и етика" sub={`ISRS 4410 · ISQM 1 · Кодекс на етика IESBA (ИСОС) · ${firm ? firm.name + ' · ' : ''}${year}`}>
        <Link className="btn" href="/iso">🏅 ISO</Link>
      </Hd>
      {!mine && staff.some((x) => x.id === u.id) && tab !== 'et' && (
        <div className="callout warn">🧭 Вашата годишна изјава за етика (IESBA) за {year} не е потпишана. <Link className="btn sm pri" href="/ifac?t=et">Прочитај и потпиши</Link></div>
      )}
      <div className="row" style={{ gap: 6, margin: '0 0 8px', flexWrap: 'wrap' }}>
        {TABS.map(([k, n]) => <Link key={k} className={`btn ${tab === k ? 'pri' : ''}`} href={`/ifac?t=${k}`}>{n}</Link>)}
      </div>

      {(tab === 'el' || tab === 'qc') && !firm && <div className="card empty">Изберете фирма (клиент) горе – писмото и листата се водат по фирма и година.</div>}

      {tab === 'el' && firm && await (async () => {
        const cur = await db().transaction((tx) => letterOf(tx, firm.id, year));
        const k = cur ? null : await contractFor(firm.id);
        const l = cur?.letter ?? elNew(O, firmOf(firm), year, td, k);
        const st = elStatus(cur?.letter);
        const off = await officeFirm(O, firm);
        const html = elHtml(l, { firm: firmOf(firm), firmId: firm.id, O, off: off ? firmOf(off) : null, img: imgUrl, draftMark: true, peekNo: '' });
        const edit = !cur?.letter.signed;
        return (
          <>
            <div className="card">
              <div className="hd"><h2 style={{ margin: 0 }}>✉ Писмо за ангажман за {year} <span className={`pill ${st[1]}`}>{st[0]}</span>{cur ? <span className="mini"> · {cur.letter.number}</span> : null}</h2>
                <div className="row" style={{ gap: 6 }}>
                  {cur && <a className="btn" href={`/print/ifacEl?y=${year}`} target="_blank" rel="noreferrer">🖨 Печати</a>}
                  {cur && !cur.letter.signed && <RowAction action={letterDelete.bind(null, year)} label="🗑" title="Избриши" confirm={`Да се избрише писмото ${cur.letter.number}?`} />}
                </div></div>
              <p className="note" style={{ marginTop: 4 }}>ISRS 4410 (ревидиран) §24: цел и опфат, применлива рамка, одговорности на двете страни, извештај за составување, рокови и надоместок. Податоците се земаат од фирмата и од договорот{k?.number ? ` ${k.number}` : ''}; писмото важи до 31.12.{year}, а 30 дена пред тоа во досието излегува потсетник за обнова.</p>
              {!O.name && <div className="callout warn">Прво одредете ја „Фирмата на канцеларијата“ во <Link href="/kdogovori">Договор за сметководствени услуги</Link>.</div>}
              {edit && (
                // keyed by the stored letter: React resets an uncontrolled form after its action – remount with the saved values
                <ActionForm key={JSON.stringify(cur?.letter ?? null)} action={letterSave} reset={false} className="card" style={{ background: 'var(--accent-soft)' }}>
                  <input type="hidden" name="year" value={year} />
                  <div className="form">
                    <label className="f">Датум<input type="date" name="date" defaultValue={l.date} /></label>
                    <label className="f">Место<input name="place" defaultValue={l.place} /></label>
                    <label className="f">Застапник на клиентот<input name="rep" defaultValue={l.rep} /></label>
                    <label className="f">Функција<input name="repRole" defaultValue={l.repRole} /></label>
                    <label className="f wide">Применлива рамка<select name="framework" defaultValue={l.framework}>{EL_FRAMEWORKS.map(([v, n]) => <option key={v} value={v}>{n}</option>)}</select></label>
                    <label className="f">Цените ги внесувам<select name="feeMode" defaultValue={l.feeMode}><option value="gross">со ДДВ</option><option value="net">без ДДВ</option></select></label>
                    <label className="f">Месечен надоместок<input type="number" step="any" name="fee" defaultValue={String(l.fee)} /></label>
                    <label className="f">Годишна сметка (еднократно)<input type="number" step="any" name="feeYear" defaultValue={String(l.feeYear)} /></label>
                    <label className="f">По час (надвор од опфатот)<input type="number" step="any" name="feeHour" defaultValue={String(l.feeHour)} /></label>
                    <label className="f">Документи до (ден)<input type="number" name="docDay" defaultValue={l.docDay} /></label>
                    <label className="f">Плаќање до (ден)<input type="number" name="payDay" defaultValue={l.payDay} /></label>
                    <label className="f">Договор бр.<input name="contractNo" defaultValue={l.contractNo} /></label>
                  </div>
                  <div style={{ margin: '8px 0 4px' }}><b>Опфат</b> <span className="mini">(книговодство, плати, ДДВ, завршна сметка – и другите услуги од договорот)</span></div>
                  <div className="row" style={{ gap: '4px 14px', flexWrap: 'wrap' }}>
                    {KD_SVC.map(([v, n]) => <label key={v} className="chk"><input type="checkbox" name="svc" value={v} defaultChecked={l.svc.includes(v)} /> {n}</label>)}
                  </div>
                  <label className="f wide" style={{ marginTop: 6 }}>Дополнителна услуга (по желба)<input name="note" defaultValue={l.note} /></label>
                  <div className="row" style={{ gap: 8, marginTop: 8 }}><Submit>{cur ? 'Зачувај измени' : '✉ Изготви писмо'}</Submit></div>
                </ActionForm>
              )}
              {cur && !cur.letter.signed && (
                <ActionForm action={letterSign} className="card" style={{ borderLeft: '4px solid var(--accent)' }}>
                  <input type="hidden" name="year" value={year} />
                  <b>✍ Клиентот го потпиша писмото</b>
                  <div className="form" style={{ marginTop: 6 }}>
                    <label className="f">Датум на потпис<input type="date" name="at" defaultValue={td} required /></label>
                    <label className="f">Потписник<input name="name" defaultValue={l.rep} /></label>
                  </div>
                  <UploadField firmId={firm.id} accept=".pdf,image/*" label="📎 Скениран потпишан примерок (по желба)" />
                  <div className="row" style={{ marginTop: 6 }}><Submit>✍ Потпишано – архивирај</Submit></div>
                </ActionForm>
              )}
              {cur?.letter.signed && <div className="callout good">✅ Потпишано од {cur.letter.signed.name} на {dmy(cur.letter.signed.at)} · во <Link href="/dosie">Документи на фирмата</Link>. За {year + 1} изгответе ново писмо (потсетникот е во досието).</div>}
            </div>
            <div className="card" style={{ background: '#fff', color: '#111' }}><div dangerouslySetInnerHTML={{ __html: html }} /></div>
          </>
        );
      })()}

      {tab === 'qc' && firm && await (async () => {
        const [r0, X] = await Promise.all([db().transaction((tx) => ifacGet(tx, 'qc', year, firm.id)), db().transaction((tx) => qcAuto(tx, firm.id, year, demo))]);
        const q0 = r0 ? qcNormalize(r0.data as never) : null;
        const q = q0 ?? qcEmpty();
        const DF = r0 ? (await filesOf(IFAC_FILE_ENTITY, [r0.id])).get(r0.id) : undefined;
        const doc = q.doc ?? elFileNormalize(null);
        const DS = elFileStatus(doc, DF?.length ?? 0);
        const S = qcStatus(q, X, td);
        const who = (n: string, v: string | null | undefined) => <select name={n} defaultValue={v ?? ''}><option value="">—</option>{staff.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select>;
        return (
          <ActionForm key={JSON.stringify(q0)} action={qcSave} reset={false}>
            <input type="hidden" name="year" value={year} />
            <div className="hd"><h2 style={{ margin: 0 }}>✅ Контрола на квалитет – {firm.name}, {year}</h2>
              <span className={`pill ${S.ok ? 'good' : 'warn'}`}>{S.ok ? '✓ ангажманот е комплетен' : 'во тек'}</span></div>
            <p className="note" style={{ marginTop: 4 }}>ISQM 1: пред прифаќање / продолжување на клиентот за годината и пред затворање на годината – преглед од второ лице. Ставките „од системот“ се читаат од УФР, изјавите за етика, договорот и писмото.</p>
            <div className="cols">
              <div>
                <h3 style={{ margin: '4px 0' }}>1. Прифаќање и продолжување <span className="mini">({S.accept.done}/{S.accept.total})</span></h3>
                <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                  {S.accept.items.map((x) => x.auto ? <Line key={x.k} x={x} /> : (
                    <li key={x.k} style={{ margin: '3px 0' }}><label className="chk"><input type="checkbox" name={`a_${x.k}`} defaultChecked={x.ok} /> {x.n}</label></li>
                  ))}
                </ul>
                <div className="row" style={{ gap: 6, margin: '4px 0', flexWrap: 'wrap' }}>
                  {!S.accept.items.find((x) => x.k === 'aml')!.ok && <Link className="btn sm" href="/aml">🛡 УФР анализа</Link>}
                  {!S.accept.items.find((x) => x.k === 'letter')!.ok && <Link className="btn sm" href="/ifac?t=el">✉ Писмо</Link>}
                  {!S.accept.items.find((x) => x.k === 'contract')!.ok && <Link className="btn sm" href={`/kdogovori?f=${firm.id}`}>✍ Договор</Link>}
                  {!S.accept.items.find((x) => x.k === 'ethics')!.ok && <Link className="btn sm" href="/ifac?t=et">🧭 Изјави</Link>}
                </div>
                <div className="form">
                  {!X.aml?.level && <label className="f">Ризик (рачно, без УФР)<select name="risk" defaultValue={q.risk ?? ''}><option value="">—</option>{QC_RISK.map(([v, n]) => <option key={v} value={v}>{n}</option>)}</select></label>}
                  <label className="f">Одлука<select name="decision" defaultValue={q.decision ?? ''}><option value="">—</option>{QC_DECISIONS.map(([v, n]) => <option key={v} value={v}>{n}</option>)}</select></label>
                  <label className="f">Одлучил{who('decidedBy', q.decidedBy ?? (q0 ? null : u.id))}</label>
                  <label className="f">Датум<input type="date" name="decidedOn" defaultValue={q.decidedOn ?? ''} /></label>
                  <label className="f wide">Белешка<input name="accNote" defaultValue={q.accNote ?? ''} /></label>
                </div>
              </div>
              <div>
                <h3 style={{ margin: '4px 0' }}>2. Преглед на завршната сметка од второ лице <span className="mini">({S.review.done}/{S.review.total})</span></h3>
                <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                  {QC_REVIEW.map((x) => <li key={x.k} style={{ margin: '3px 0' }}><label className="chk"><input type="checkbox" name={`r_${x.k}`} defaultChecked={!!q.rev[x.k]} /> {x.n}</label></li>)}
                </ul>
                <div className="form">
                  <label className="f">Изготвил{who('preparedBy', q.preparedBy)}</label>
                  <label className="f">Прегледал (второ лице){who('reviewedBy', q.reviewedBy)}</label>
                  <label className="f" title="За канцеларија со едно лице: друг овластен сметководител (член на ИСОС)">или надворешен прегледувач<input name="reviewedExt" defaultValue={q.reviewedExt ?? ''} placeholder="име, лиценца" /></label>
                  <label className="f">Датум на преглед<input type="date" name="reviewedOn" defaultValue={q.reviewedOn ?? ''} /></label>
                  <label className="f wide">Наоди / белешка<input name="revNote" defaultValue={q.revNote ?? ''} /></label>
                </div>
                {S.review.ok ? <div className="callout good">✓ Прегледано од {uName(q.reviewedBy) || q.reviewedExt} на {dmy(q.reviewedOn)} (изготвил {uName(q.preparedBy)}).</div>
                  : <p className="note">Прегледот го прави лице различно од изготвувачот, пред поднесување на годишната сметка (<Link href="/zsProc">Завршна сметка – по фази</Link>).</p>}
              </div>
            </div>
            <h3 style={{ margin: '10px 0 4px' }}>3. Досие на ангажманот (ISRS 4410 §37–39) <span className="mini">({DS.done}/{DS.total})</span>
              {' '}<a className="btn sm" href={`/print/ifacCr?y=${year}`} target="_blank" rel="noreferrer">🖨 Извештај за составување</a></h3>
            <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 4px' }}>{DS.items.map(([n, o]) => <li key={n} style={{ margin: '2px 0' }}>{o ? <span className="pill good">✓</span> : <span className="pill warn">!</span>} {n}</li>)}</ul>
            <div className="form">
              <label className="f wide">Значајни прашања во ангажманот<textarea name="doc_matters" rows={3} defaultValue={doc.matters} /></label>
              <label className="f wide">Значајни проценки (резервирања, вредности, пописи, исправки)<textarea name="doc_judgments" rows={3} defaultValue={doc.judgments} /></label>
              <label className="f">Комуникација со раководството – датум<input type="date" name="doc_commOn" defaultValue={doc.commOn ?? ''} /></label>
              <label className="f wide">Комуникација – содржина (што е договорено / соопштено)<input name="doc_comm" defaultValue={doc.comm} /></label>
              <label className="f">Финансиските извештаи одобрени од раководството на<input type="date" name="doc_fsDate" defaultValue={doc.fsDate ?? ''} /></label>
              <label className="f">Писмена потврда на раководството – датум<input type="date" name="doc_ackOn" defaultValue={doc.ackOn ?? ''} /></label>
              <label className="f">Потврдил (име, функција)<input name="doc_ackBy" defaultValue={doc.ackBy} /></label>
              <label className="f">Извештај за составување – датум<input type="date" name="doc_reportOn" defaultValue={doc.reportOn ?? ''} /></label>
            </div>
            <div style={{ margin: '6px 0' }}><b>Докази</b> (потпишана потврда на раководството, преписка, потпишан извештај) <FileChips files={DF} /></div>
            <UploadField firmId={firm.id} accept=".pdf,image/*,.doc,.docx,.xlsx" label="📎 Прикачи доказ" />
            <div className="row" style={{ marginTop: 8, gap: 10, alignItems: 'center' }}><Submit>Зачувај (нова верзија)</Submit><Meta d={r0?.data} staff={staff} /></div>
          </ActionForm>
        );
      })()}

      {tab === 'et' && <TabEthics u={u} year={year} office={O.name ?? ''} staff={staff} />}
      {tab === 'sqm' && <TabSqm year={year} comp={sp.c} staff={staff} canEdit={canSet} />}
      {tab === 'staff' && <TabStaff year={year} uid={sp.u} staff={staff} canEdit={canSet} today={td} />}
      {tab === 'isos' && <TabIsos year={year} today={td} staff={staff} canEdit={canSet} demo={demo} hasOffice={!!P.off} edit={sp.p} />}
      {tab === 'ready' && <TabReady u={u} year={year} today={td} demo={demo} officeFirmId={P.off?.id ?? null} />}

      {tab === 'all' && await (async () => {
        const [F0, R] = await Promise.all([allowedFirms(u, { year }), db().transaction((tx) => ifacYear(tx, year))]);
        const F = F0.filter((f) => f.id !== P.off?.id);
        const of = (k: string, id: string) => R.find((r) => r.kind === k && r.subject === id);
        return (
          <div className="card">
            <h2 style={{ marginTop: 0 }}>📋 Сите клиенти – {year}</h2>
            <div className="tw"><table className="dense">
              <thead><tr><th>Фирма</th><th>Писмо (ISRS 4410)</th><th>Прифаќање (ISQM 1)</th><th>Преглед од второ лице</th><th /></tr></thead>
              <tbody>{F.map((f) => {
                const l = of('letter', f.id), qr = of('qc', f.id), q = qr ? qcNormalize(qr.data as never) : null;
                return (
                  <tr key={f.id}>
                    <td>{f.name}</td>
                    <td>{l ? <span className={`pill ${l.status === 'signed' ? 'good' : 'warn'}`}>{String(l.data.number ?? '')} · {l.status === 'signed' ? 'потпишано' : 'чека потпис'}</span> : <span className="pill bad">нема</span>}</td>
                    <td>{q?.decision === 'decline' ? <span className="pill bad">одбиен</span> : qr && qr.status !== 'open' ? <span className="pill good">{dmy(q?.decidedOn)}</span> : <span className="pill warn">отворено</span>}</td>
                    <td>{qr?.status === 'reviewed' ? <span className="pill good">{uName(q?.reviewedBy)} · {dmy(q?.reviewedOn)}</span> : <span className="pill warn">не</span>}</td>
                    <td style={{ whiteSpace: 'nowrap' }}><FirmGo fid={f.id} current={firm?.id} to="/ifac?t=el" className="btn sm">✉</FirmGo> <FirmGo fid={f.id} current={firm?.id} to="/ifac?t=qc" className="btn sm">✅</FirmGo></td>
                  </tr>
                );
              })}</tbody>
            </table></div>
          </div>
        );
      })()}
    </>
  );
}
