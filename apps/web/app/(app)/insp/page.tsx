/**
 * Legacy `VIEWS.insp` 16537 → 16587 → **16676** — readiness for УЈП / ДПИ / ДИТ inspections: activity codes (main +
 * other, added by hand or read from a CRM document), the firm profile, a score per inspectorate, the checklist per
 * inspectorate with „Поправи →“, „✓ Имаме“ (with the document date), „➖“ and 📎 attachments, PDF per inspectorate,
 * the „🏛 Пакет за УЈП“ and „📨 Побарај документи од клиентот“ (an editable message to the portal / e-mail).
 */
import Link from 'next/link';
import { and, eq } from 'drizzle-orm';
import { INSP_G, inspCheck, inspCtx, type InspGroup, type InspManual, type InspProfile, type InspRow } from '@wise/core/office';
import { INSP_FILE_ENTITY, INSP_IC, INSP_PDF_MARK, inspAskMessage, inspFileKey, inspGroupScore } from '@wise/core/office/insp-extra';
import { buildFirmSnapshot, firmReshReads, getOfficeProfile, inspectionStates } from '@wise/db';
import { db } from '@/lib/db';
import { filesOf, officePage, today } from '@/lib/office';
import { hrefFor } from '@/lib/nav';
import { ActionForm } from '@/components/action-form';
import { AutoRefresh } from '@/components/auto-refresh';
import { DownloadCsv } from '@/components/download-csv';
import { FileChips } from '@/components/file-chips';
import { Hd, dmy } from '@/components/hd';
import { NoFirm } from '@/components/no-firm';
import { PdfButton } from '@/components/pdf-button';
import { RowAction } from '@/components/row-action';
import { UploadField } from '@/components/upload-field';
import { sendClientMessage } from '../autop/actions';
import { addInspCode, applyCodesScan, attachInsp, removeInspCode, saveInspProfile, setInspState, startCodesScan } from './actions';

type SP = { att?: string; ask?: string; scan?: string; codes?: string };
const PDF_NM: Record<InspGroup, string> = { ujp: 'УЈП', dpi: 'Пазарен', dit: 'Труд' };

export default async function InspPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const { u, firm } = await officePage('insp', { perm: 'office' });
  if (!firm) return <NoFirm t="🛡 Подготвеност за инспекција" />;
  const st = (firm.settings ?? {}) as { inspProf?: InspProfile; nkdOther?: string[]; nkd?: string; short?: string };
  const prof = st.inspProf ?? {};
  const other = (st.nkdOther ?? []).filter((x) => typeof x === 'string');
  const [snap, man, O] = await Promise.all([
    buildFirmSnapshot(db(), firm.id),
    db().select().from(inspectionStates).where(eq(inspectionStates.firmId, firm.id)),
    getOfficeProfile(db()),
  ]);
  const M: Record<string, InspManual> = Object.fromEntries(man.map((m) => [m.itemId, { d: m.doneDate, na: m.na, by: m.byName, note: m.note }]));
  const c = inspCtx(snap!, prof, other);
  const R = inspCheck(c, M);
  const sc = inspGroupScore(R);
  const FL = await filesOf(INSP_FILE_ENTITY, R.map((r) => inspFileKey(firm.id, r.it.id)));
  const acts = ([['retail', 'Трговија на мало'], ['whole', 'Трговија на големо'], ['ugost', 'Угостителство'], ['serv', 'Услуги'], ['rent', 'Изнајмување (рент)'], ['build', 'Градежништво'], ['prod', 'Производство'], ['trans', 'Превоз']] as const)
    .filter(([k]) => c[k]).map(([, n]) => n);
  const ask = sp.ask !== undefined ? inspAskMessage(R, st.short || firm.name, O.name ?? '') : null;
  const [scan] = sp.scan && /^[0-9a-f-]{36}$/i.test(sp.scan)
    ? await db().select().from(firmReshReads).where(and(eq(firmReshReads.id, sp.scan), eq(firmReshReads.createdBy, u.id))).limit(1) : [];
  const scanRes = (scan?.result ?? {}) as { nkd?: string; otherNkd?: string[] };
  const td = today();
  const csv: (string | number | null)[][] = [['Инспекторат', 'Состојба', 'Обврска', 'Закон', 'Казна', 'Состојба (опис)', 'Што бара инспекторот', 'Потврдено на']];
  for (const [g, n] of INSP_G) for (const r of R.filter((x) => x.it.g === g)) csv.push([n, INSP_PDF_MARK[r.s], r.t, r.it.law, r.it.fine ?? '', r.txt, r.it.ev, M[r.it.id]?.d ?? '']);

  const table = (g: InspGroup) => {
    const L = R.filter((r) => r.it.g === g);
    if (!L.length) return <p className="muted">{g === 'dpi' ? 'Означете горе „Трговија на мало / големо“, „Угостителство“ или „Производство“ ако фирмата има објект или стока.' : 'Фирмата нема активни вработени.'}</p>;
    return (
      <div className="tw"><table className="dense">
        <thead><tr><th style={{ width: 28 }} /><th>Обврска</th><th>Состојба</th><th>Што бара инспекторот</th><th style={{ width: 210 }} /></tr></thead>
        <tbody>{L.map((r) => <Row key={r.it.id} r={r} m={M[r.it.id]} files={FL.get(inspFileKey(firm.id, r.it.id))} att={sp.att === r.it.id} firmId={firm.id} td={td} />)}</tbody>
      </table></div>
    );
  };

  return (
    <>
      <Hd t="🛡 Подготвеност за инспекција" sub={`${firm.name} · УЈП, пазарен инспекторат, инспекторат за труд`}>
        <span className="row" style={{ gap: 4, display: 'inline-flex', alignItems: 'center' }}>
          <span className="mini">🖨 PDF:</span>
          {INSP_G.map(([g]) => <PdfButton key={g} selector={`#inspPdf_${g}`} title={`Inspekcija_${PDF_NM[g]}_${firm.name}_${td}`} className="btn sm" />)}
          <PdfButton selector="#inspPdf_all" title={`Inspekcija_site_${firm.name}_${td}`} className="btn sm ghost" />
        </span>
        <Link className="btn" href="/paket?pre=ujp" title="Бруто биланс, ДДВ, картици по конто, основни средства, лагер листа – по е-пошта">🏛 Пакет за УЈП</Link>
        <DownloadCsv name={`Inspekcija_${firm.name}_${td}.csv`} rows={csv} label="⬇ Excel (CSV)" />
        <Link className="btn pri" href="/insp?ask=1">📨 Побарај документи од клиентот</Link>
      </Hd>

      {sp.ask !== undefined && (ask ? (
        <ActionForm action={sendClientMessage} reset={false}>
          <div className="row" style={{ justifyContent: 'space-between' }}><b>{firm.name} · 📨 Документи за инспекција</b><span className="muted" style={{ fontSize: 12 }}>{firm.email ? `✉ ${firm.email}` : 'нема е-пошта – само портал'}</span></div>
          <input type="hidden" name="firmId" value={firm.id} /><input type="hidden" name="type" value="insp" /><input type="hidden" name="key" value={`insp|${firm.id}|${td}`} />
          <input name="subject" defaultValue={ask.subj} style={{ width: '100%', margin: '6px 0' }} />
          <textarea name="body" rows={10} defaultValue={ask.body} style={{ width: '100%' }} />
          <div className="row" style={{ gap: 6, marginTop: 6 }}>
            <button className="btn pri sm" name="only" value="">📨 Испрати (портал{firm.email ? ' + е-пошта' : ''})</button>
            <button className="btn sm" name="only" value="portal">Само портал</button>
            <Link className="btn sm ghost" href="/insp">← Назад</Link>
          </div>
        </ActionForm>
      ) : <div className="callout good">Нема што да се побара – сè е подготвено. <Link href="/insp">← Назад</Link></div>)}

      <div className="card">
        <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 8 }}>
          <b style={{ fontSize: 13 }}>Шифри на дејност:</b>
          {c.codes.length ? c.codes.map((k, i) => (
            <span key={k} className={`pill ${i ? '' : 'info'}`}>{k}{i ? '' : ' главна'}
              {i > 0 && other.includes(k) && <> <RowAction action={removeInspCode.bind(null, k)} label="✕" title="Отстрани" className="btn sm ghost" style={{ padding: '0 4px' }} /></>}
            </span>
          )) : <span className="pill warn">нема внесена шифра – внесете ја во <Link href="/firmi">Фирми</Link></span>}
          <ActionForm action={addInspCode} className="row" style={{ gap: 4, display: 'inline-flex' }}>
            <input name="code" placeholder="+ шифра (пр. 46.90)" style={{ width: 150 }} />
            <button className="btn sm">Додај</button>
          </ActionForm>
          <Link className="btn sm pri" href="/insp?codes=scan" title="Програмот ги чита сите шифри од тековната состојба / решението од ЦРМ (PDF/слика)">📷 Од решение / тековна (ЦРМ)</Link>
          <span className="muted" style={{ fontSize: 12 }}>→ се проверува за: <b>{acts.join(', ') || '—'}</b></span>
        </div>
        {sp.codes === 'scan' && !scan && (
          <ActionForm action={startCodesScan} className="card" style={{ margin: '0 0 8px' }}>
            <b>📷 Шифри на дејност од документ од ЦРМ</b>
            <UploadField firmId={null} accept="application/pdf,.pdf,image/jpeg,image/png,image/webp" label="Тековна состојба / Решение за упис (PDF или слика)" />
            <div className="row" style={{ gap: 6 }}><button className="btn pri sm">Прочитај</button><Link className="btn sm ghost" href="/insp">Откажи</Link></div>
          </ActionForm>
        )}
        {scan && (
          <div className={`callout ${scan.status === 'error' ? 'bad' : ''}`} style={{ marginBottom: 8 }}>
            {(scan.status === 'queued' || scan.status === 'reading') && <><AutoRefresh seconds={3} />📷 Се читаат шифрите на дејност…</>}
            {scan.status === 'error' && <>Не се прочитаа шифри – внесете ги рачно. {scan.error}</>}
            {scan.status === 'saved' && <>✓ Шифрите се внесени.</>}
            {scan.status === 'done' && <>Прочитано: главна <b>{scanRes.nkd || '—'}</b>, други: <b>{(scanRes.otherNkd ?? []).join(', ') || '—'}</b>{' '}
              <RowAction className="btn sm pri" action={applyCodesScan.bind(null, scan.id)} label="✓ Внеси ги шифрите" /></>}
            {' '}<Link className="btn sm ghost" href="/insp">Затвори</Link>
          </div>
        )}
        <p className="muted" style={{ fontSize: 11.5, margin: '0 0 8px' }}>Внесете ги сите дејности што фирмата ги врши (од тековната состојба / структурата на приходите) – обврските се додаваат автоматски за секоја дејност, за да нема изненадување при контрола.</p>
        <ActionForm action={saveInspProfile} reset={false} className="row" style={{ gap: 14, flexWrap: 'wrap', alignItems: 'center' }}>
          <label className="chk"><input type="checkbox" name="fisk" defaultChecked={c.fisk} /> Фискален апарат</label>
          <label className="chk"><input type="checkbox" name="alc" defaultChecked={c.alc} /> Продава алкохол / цигари</label>
          <label className="chk"><input type="checkbox" name="web" defaultChecked={c.web} /> Веб-страница (онлајн продажба)</label>
          <label className="f" style={{ margin: 0 }}>Благајнички максимум (ден.)<input name="kasaMax" type="number" defaultValue={c.kmax || ''} style={{ width: 120 }} /></label>
          <button className="btn sm">Зачувај</button>
          <span className="muted" style={{ fontSize: 12 }}>Вработени: <b>{c.n}</b>{c.n > 25 ? ' · над 25 → електронска евиденција на работно време' : ''}</span>
        </ActionForm>
        <p className="muted" style={{ fontSize: 12, margin: '6px 0 0' }}>Автоматските проверки се од книжењата (Z, благајна, фактури, плати, вработени). За документите што програмот не може да ги види – кликнете „✓ Имаме“ со датумот на документот (каде што има рок, програмот потсетува кога истекува).</p>
        <div id="inspHelp" className="callout" style={{ marginTop: 8, fontSize: 12.5 }}><b>„✓ Имаме“</b> = ја потврдувате обврската: документот постои и е во ред (на пр. архивската книга е водена). Внесете го <b>датумот на документот</b> пред да кликнете. Програмот го запишува кој и кога потврдил; кај документите со рок (осигурување, ПП апарати, годишен одмор) потсетува кога истекува. <b>📎</b> = прикачете го самиот документ (PDF/слика) – тогаш при инспекција го имате веднаш. Повторен клик на „✓ Имаме“ го отштиклира. <b>➖</b> = не се однесува на оваа фирма.</div>
      </div>

      <div className="row" style={{ gap: 10, flexWrap: 'wrap', margin: '8px 0' }}>
        {INSP_G.map(([g, n]) => {
          const s = sc[g];
          return (
            <div key={g} className="card" style={{ flex: 1, minWidth: 220, margin: 0 }}>
              <div className="muted" style={{ fontSize: 12.5 }}>{n}</div>
              <div style={{ fontSize: 26, fontWeight: 700, color: s.pct >= 90 ? 'var(--good)' : s.pct >= 60 ? 'var(--warn,#b7791f)' : 'var(--bad)' }}>{s.n ? `${s.pct}%` : '—'}</div>
              <div style={{ fontSize: 12 }}>{s.bad ? `⛔ ${s.bad} проблеми ` : ''}{s.todo ? `⬜ ${s.todo} непотврдени` : ''}{!s.bad && !s.todo && s.n ? 'подготвени' : ''}</div>
            </div>
          );
        })}
      </div>
      {INSP_G.map(([g, n]) => <div key={g} className="card"><h2 style={{ margin: '0 0 6px' }}>{n}</h2>{table(g)}</div>)}
      <p className="note">Листата е изработена според законите и објавените листи за проверка на инспекторатите (Закон за инспекциски надзор). Не е правен совет – за специфични дејности (храна, градежништво, превоз) важат и посебни прописи.</p>

      {/* PDF areas (legacy `inspPdf`): one per inspectorate and all together */}
      <div style={{ display: 'none' }}>
        {[...INSP_G.map(([g]) => [g, [g]] as const), ['all', INSP_G.map(([g]) => g)] as const].map(([id, G]) => (
          <div key={id} id={`inspPdf_${id}`} className="pdfdoc">
            <PdfDoc firmName={firm.name} td={td} G={G as readonly InspGroup[]} R={R} sc={sc} />
          </div>
        ))}
      </div>
    </>
  );
}

function Row({ r, m, files, att, firmId, td }: { r: InspRow; m?: InspManual; files?: { id: string; name: string }[]; att: boolean; firmId: string; td: string }) {
  const confirmed = !!(m?.d && !m.na);
  return (
    <tr>
      <td style={{ fontSize: 16 }}>{INSP_IC[r.s]}</td>
      <td><b>{r.t}</b><div className="muted" style={{ fontSize: 11.5 }}>{r.it.law}{r.it.fine ? ` · казна: ${r.it.fine}` : ''}</div></td>
      <td style={{ fontSize: 12.5 }}>{r.txt}</td>
      <td style={{ fontSize: 12 }}>{r.it.ev}</td>
      <td style={{ whiteSpace: 'nowrap' }}>
        {r.go && <><Link className="btn sm" href={hrefFor(r.go)}>Поправи →</Link> </>}
        {r.it.man && (
          <>
            <ActionForm action={setInspState} reset={false} className="row" style={{ gap: 4, display: 'inline-flex' }}>
              <input type="hidden" name="itemId" value={r.it.id} />
              <input type="date" name="d" defaultValue={m?.d ?? ''} style={{ width: 130, fontSize: 12 }} title="Датум на документот / проверката" />
              <button className={`btn sm ${confirmed ? '' : 'pri'}`} name="op" value="ok" title={confirmed ? 'Кликнете повторно (со истиот датум) за да се отштиклира' : 'Потврдете дека документот постои (со датумот лево)'}>{confirmed ? '✓ Потврдено' : '✓ Имаме'}</button>
              <button className="btn sm ghost" name="op" value="na" title="Не се однесува">➖</button>
              <Link className="btn sm ghost" href={`/insp?att=${r.it.id}`} title="Прикачи го документот (PDF / слика)">📎</Link>
            </ActionForm>
            {files?.length ? <div className="inspF" style={{ marginTop: 4, whiteSpace: 'normal' }}><FileChips files={files} /></div> : null}
            {att && (
              <ActionForm action={attachInsp} className="card" style={{ marginTop: 6, whiteSpace: 'normal' }}>
                <input type="hidden" name="itemId" value={r.it.id} />
                <label className="f">Датум на документот<input type="date" name="d" defaultValue={m?.d ?? td} /></label>
                <UploadField firmId={firmId} accept="application/pdf,.pdf,image/jpeg,image/png,image/webp" label="📎 Документ (PDF / слика)" />
                <div className="row" style={{ gap: 6 }}><button className="btn sm pri">Прикачи и потврди</button><Link className="btn sm ghost" href="/insp">Откажи</Link></div>
              </ActionForm>
            )}
          </>
        )}
      </td>
    </tr>
  );
}

function PdfDoc({ firmName, td, G, R, sc }: { firmName: string; td: string; G: readonly InspGroup[]; R: InspRow[]; sc: ReturnType<typeof inspGroupScore> }) {
  const one = G.length === 1 ? INSP_G.find(([k]) => k === G[0])![1].replace(/^\S+\s/, '') : '';
  return (
    <>
      <h2 style={{ textAlign: 'center', margin: '0 0 2px' }}>ЛИСТА ЗА ПОДГОТВЕНОСТ ЗА ИНСПЕКЦИЈА{one ? ` – ${one}` : ''}</h2>
      <p style={{ textAlign: 'center', margin: '0 0 10px' }}>{firmName} · состојба на {dmy(td)}</p>
      {INSP_G.filter(([g]) => G.includes(g)).map(([g, n]) => {
        const L = R.filter((r) => r.it.g === g);
        return L.length ? (
          <div key={g}>
            <h3>{n} – {sc[g].pct}%</h3>
            <table style={{ width: '100%', tableLayout: 'fixed', fontSize: '8.5pt' }}>
              <colgroup><col style={{ width: '5%' }} /><col style={{ width: '34%' }} /><col style={{ width: '33%' }} /><col style={{ width: '28%' }} /></colgroup>
              <thead><tr><th /><th>Обврска</th><th>Состојба</th><th>Документ за инспекторот</th></tr></thead>
              <tbody>{L.map((r) => <tr key={r.it.id} style={{ verticalAlign: 'top' }}><td>{INSP_PDF_MARK[r.s]}</td><td>{r.t}<br /><small>{r.it.law}</small></td><td>{r.txt}</td><td>{r.it.ev}</td></tr>)}</tbody>
            </table>
          </div>
        ) : null;
      })}
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 40 }}>
        {['Сметководител', 'Управител'].map((x) => <div key={x} style={{ textAlign: 'center', minWidth: 200 }}><div>{x}</div><div style={{ height: 36 }} /><div style={{ borderTop: '1px solid #000' }} /></div>)}
      </div>
      <p className="mini" style={{ fontSize: '7.5pt', marginTop: 12 }}>Листата е изработена според законите и објавените листи за проверка на инспекторатите. Не е правен совет.</p>
    </>
  );
}
