/**
 * Legacy `VIEWS.kdogovori` 10355 → 13577 → 13602 → 13608 → 13616 → **15514** — the accounting-service contract:
 * list with status, editor with live preview, office signature + stamp, the client's signature in the portal (or a
 * scanned signed copy), the signed PDF archived in the dossier, office data, all firms overview and the monthly
 * invoices from the contracts in the office firm (legacy `kdRecPlan` panel of `periodicni`).
 */
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { and, desc, eq } from 'drizzle-orm';
import { can, firmAllowed } from '@wise/core';
import { kdAmt, kdNew, kdNumber, kdStatus, kdVat, type KdContract } from '@wise/core/firms/kdog';
import { serviceContracts, wordTemplates, officeCounters, type Firm } from '@wise/db';
import { requireUser } from '@/lib/auth';
import { currentFirm } from '@/lib/context';
import { db } from '@/lib/db';
import { allowedFirms, officePage, today } from '@/lib/office';
import { fmt } from '@/lib/fmt';
import { ActionForm } from '@/components/action-form';
import { Hd, dmy } from '@/components/hd';
import { NoFirm } from '@/components/no-firm';
import { RowAction } from '@/components/row-action';
import { UploadField } from '@/components/upload-field';
import { DownloadCsv } from '@/components/download-csv';
import { PdfButton } from '@/components/pdf-button';
import { SignaturePad, PhotoField } from '@/components/driver-form';
import { clientSign, contractToDossier, deleteContract, endContract, officeSign, pickFirm, saveOffice, setOfficeFirm, syncRecurring, uploadSignedCopy } from './actions';
import { KdEditor } from './editor';
import { contractHtml, firmOf, loadOffice, officeFirm, recPlanFor, rowToContract } from './lib';

const T = 'Договор за сметководствени услуги';

async function peekNo(date: string) {
  const y = Number(date.slice(0, 4));
  const [c] = await db().select().from(officeCounters).where(and(eq(officeCounters.key, 'kdog'), eq(officeCounters.year, y))).limit(1);
  return kdNumber((c?.value ?? 0) + 1, y);
}

/** Template variables for the Word templates (legacy `tplRun(['kd'], {k})`). */
const tplQ = (k: KdContract, firm: Firm) => new URLSearchParams({
  ДОГОВОР_БРОЈ: k.number, ДАТУМ_ДОГОВОР: dmy(k.date), МЕСТО_ДОГОВОР: k.place, НАДОМЕСТ: fmt(Number(k.fee) || 0), ПРЕТСТАВНИК: k.rep, ПРЕТСТАВНИК_ФУНКЦИЈА: k.repRole,
  НАПОМЕНА: k.note, ФИРМА: firm.name,
});

/** Client portal (legacy `if(kl)`): contracts signed by the office, sign on the screen. */
async function ClientView() {
  const u = await requireUser();
  const firm = await currentFirm(u);
  if (!firm) return <NoFirm t="Договор со сметководителот" />;
  const O = await loadOffice();
  const L = (await db().select().from(serviceContracts).where(eq(serviceContracts.firmId, firm.id)).orderBy(desc(serviceContracts.date))).map(rowToContract).filter((k) => k.offSig);
  const H = await Promise.all(L.map((k) => contractHtml(k, firm, O, { e: !!k.cliSig && !k.cliSig.scan })));
  return (
    <>
      <Hd t="Договор со сметководителот" sub={firm.name} />
      {L.map((k, i) => {
        const st = kdStatus(k);
        return (
          <div className="card" key={k.id}>
            <div className="hd"><b>{k.number} · {dmy(k.date)}</b><span className={`pill ${st[1]}`}>{st[0]}</span></div>
            <div className="pdfwrap" style={{ maxHeight: 520, overflow: 'auto', border: '1px solid var(--line)', padding: 16, background: '#fff', color: '#111' }} dangerouslySetInnerHTML={{ __html: H[i]! }} />
            {k.cliSig ? (
              <div className="row" style={{ gap: 8, marginTop: 8 }}><a className="btn" href={`/kdogovori/pecati?id=${k.id}`} target="_blank" rel="noopener">⬇ PDF</a></div>
            ) : (
              <ActionForm action={clientSign} className="card" style={{ marginTop: 10, borderLeft: '4px solid var(--accent)' }}>
                <b>✍ Потпишете го договорот</b>
                <input type="hidden" name="id" value={k.id} />
                <div className="form" style={{ marginTop: 6 }}>
                  <label className="f">Име и презиме на потписникот<input name="name" defaultValue={k.rep} /></label>
                  <PhotoField name="stamp" label="🔵 Печат (слика, по желба)" />
                </div>
                <SignaturePad name="sig" label="Потпис" />
                <label className="chk" style={{ marginTop: 6 }}><input type="checkbox" name="ok" /> Го прочитав договорот и се согласувам со неговата содржина</label>
                <div className="row" style={{ marginTop: 8 }}><button className="btn pri">✍ Потпиши</button></div>
              </ActionForm>
            )}
          </div>
        );
      })}
      {!L.length && <div className="card empty">Нема договор за потпишување.</div>}
    </>
  );
}

export default async function KdogovoriPage({ searchParams }: { searchParams: Promise<{ ed?: string }> }) {
  const u0 = await requireUser();
  if (u0.role === 'klient') return <ClientView />;
  const { u, firm } = await officePage('kdogovori', { perm: 'office' });
  if (!firm) return <NoFirm t={`✍ ${T}`} />;
  const sp = await searchParams;
  const O = await loadOffice();
  const off = await officeFirm(O);
  const rate = kdVat(O);
  const setOk = can(u.principal, 'settings', firm.id), delOk = can(u.principal, 'del', firm.id);

  /* ---------- editor ---------- */
  if (sp.ed && setOk) {
    let k: KdContract;
    if (sp.ed === 'new') k = kdNew(O, firmOf(firm), today());
    else {
      const [r] = /^[0-9a-f-]{36}$/i.test(sp.ed) ? await db().select().from(serviceContracts).where(and(eq(serviceContracts.id, sp.ed), eq(serviceContracts.firmId, firm.id))).limit(1) : [];
      if (!r) notFound();
      k = rowToContract(r);
      if (k.offSig) notFound();
    }
    return (
      <>
        <Hd t={k.id ? `Договор ${k.number}` : 'Нов договор за сметководствени услуги'} sub={firm.name}><Link className="btn" href="/kdogovori">← Листа</Link></Hd>
        {!O.name && <div className="callout warn">Прво внесете ги податоците на канцеларијата (давател на услугата) подолу во листата.</div>}
        <KdEditor initial={k} firm={firmOf(firm)} firmId={firm.id} O={O} off={off ? firmOf(off) : null} peekNo={k.number ? '' : await peekNo(k.date)} offName={off?.name ?? null} />
      </>
    );
  }

  /* ---------- list ---------- */
  const [rows, Tp, F] = await Promise.all([
    db().select().from(serviceContracts).where(eq(serviceContracts.firmId, firm.id)).orderBy(desc(serviceContracts.date)),
    db().select().from(wordTemplates).where(and(eq(wordTemplates.kind, 'kd'), eq(wordTemplates.active, true))),
    allowedFirms(u),
  ]);
  const K = rows.map((r) => ({ k: rowToContract(r), ended: r.status === 'ended' }));
  const firmsL = F.filter((f) => !(f.settings as { example?: boolean }).example);
  const offAuto = !O.name && off ? off : null;
  const offS = (offAuto?.settings ?? {}) as { signer?: string; signerRole?: string; manager?: string };
  const OV = {
    name: O.name || offAuto?.name || '', address: O.address || offAuto?.address || '', edb: O.edb || (offAuto?.edb ?? '').replace(/\D/g, ''), embs: O.embs || (offAuto?.embs ?? '').replace(/\D/g, ''),
    city: O.city || (offAuto && /чаир|бутел|карпош|центар|аеродром|гази баба|кисела вода|ѓорче|сарај|шуто/i.test(offAuto.city ?? '') ? 'Скопје' : offAuto?.city ?? '') || '',
    rep: O.rep || offS.signer || offS.manager || '', repRole: O.repRole || offS.signerRole || 'Управител',
  };
  const isOff = off?.id === firm.id;
  const rec = isOff ? await recPlanFor(firm.id) : null;
  const todo = rec?.plan.filter((x) => x.st !== 'ок') ?? [];
  const missSig = [!O.sig ? 'потпис' : '', !O.stamp ? 'печат' : ''].filter(Boolean).join(' и ');

  return (
    <>
      <Hd t={T} sub={firm.name}>
        {setOk && (O.name ? <Link className="btn pri" href="/kdogovori?ed=new">+ Нов договор за оваа фирма</Link> : <button className="btn pri" disabled title="Прво внесете ги податоците на канцеларијата">+ Нов договор за оваа фирма</button>)}
      </Hd>
      <div className="tw"><table>
        <thead><tr><th>Број</th><th>Датум</th><th className="n">Месечно со ДДВ</th><th>Статус</th><th></th></tr></thead>
        <tbody>
          {K.map(({ k, ended }) => {
            const st = ended ? ['раскинат', ''] : kdStatus(k);
            return (
              <tr key={k.id}>
                <td><b>{k.number}</b></td><td>{dmy(k.date)}</td><td className="n">{fmt(kdAmt(k.feeMode, k.fee, rate).gross)}</td>
                <td><span className={`pill ${st[1]}`}>{st[0]}</span>{k.cliSig && <div className="mini">клиент: {k.cliSig.name} · {String(k.cliSig.at).slice(0, 10)}</div>}</td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  {!k.offSig && setOk && <Link className="btn sm" href={`/kdogovori?ed=${k.id}`}>Измени</Link>}
                  {!k.offSig && setOk && <RowAction className="btn sm pri" action={officeSign.bind(null, k.id!)} label="✍ Потпиши и печат"
                    confirm={`${missSig ? `Немате прикачено ${missSig} – договорот ќе се потпише рачно. ` : ''}Да се стави вашиот потпис и печат на договорот ${k.number}? По ова договорот не може да се менува и оди кај клиентот за потпис.`} />}
                  <a className="btn sm" href={`/kdogovori/pecati?id=${k.id}`} target="_blank" rel="noopener">⬇ PDF</a>
                  {Tp.map((t) => <a key={t.id} className="btn sm" href={`/api/office/tpl/${t.id}?${tplQ(k, firm)}`} title="Word (шаблон)">⬇ {t.name}</a>)}
                  {!k.arch && (k.draftArch ? <span className="pill info" title="Нацртот е во досието; по потпишувањето се заменува">📁 во досие</span> : <RowAction className="btn sm" action={contractToDossier.bind(null, k.id!)} label="📁 Во досие" />)}
                  {k.arch && <Link className="btn sm" href="/dosie">📁 Досие</Link>}
                  {delOk && !k.arch && <RowAction action={deleteContract.bind(null, k.id!)} label="🗑" style={{ color: 'var(--bad)' }} confirm={`Да се избрише договорот ${k.number}?`} />}
                  {k.arch && !ended && setOk && <RowAction action={endContract.bind(null, k.id!)} label="Раскини" confirm="Да се означи договорот како раскинат?" />}
                  {k.offSig && !k.cliSig && setOk && (
                    <ActionForm action={uploadSignedCopy} className="row" style={{ display: 'inline-flex', gap: 4, marginTop: 4 }}>
                      <input type="hidden" name="id" value={k.id} />
                      <UploadField firmId={firm.id} accept=".pdf,image/*" label="📎 Прикачи потпишан примерок" />
                      <button className="btn sm">Зачувај</button>
                    </ActionForm>
                  )}
                </td>
              </tr>
            );
          })}
          {!K.length && <tr><td colSpan={5} className="note">Нема договор за оваа фирма.</td></tr>}
        </tbody>
      </table></div>
      <p className="note">Тек: 1) креирајте го договорот (податоците на фирмата се пополнуваат автоматски) → 2) „✍ Потпиши и печат“ – се ставаат вашиот потпис и печат → 3) клиентот го гледа во порталот и потпишува на екран (или прикачете скениран потпишан примерок) → 4) договорот автоматски се архивира како PDF во „Документи на фирмата“.</p>
      {!Tp.length && <p className="note">За Word верзија прикачете шаблон од вид „Договор за сметководствени услуги“ во <a href="/tpl">Шаблони</a>.</p>}

      {/* legacy kdRecPlan panel (periodicni 13567–13575) */}
      {!off ? (
        <div className="card" style={{ padding: '10px 14px' }}><b>📑 Договори за сметководствени услуги</b> – не е одредена фирмата на канцеларијата (од неа се фактурираат месечните надоместоци). {setOk && <RowAction className="btn sm" action={setOfficeFirm} label="Ова е фирмата на канцеларијата" confirm={`„${firm.name}“ е фирмата на канцеларијата – од неа се фактурираат сметководствените услуги на клиентите?`} />}</div>
      ) : !isOff ? (
        <div className="card note" style={{ padding: '10px 14px' }}>📑 Фактурите по договорите за сметководствени услуги се издаваат во фирмата <b>{off.name}</b> (Периодични фактури).</div>
      ) : (
        <div className="card" style={{ padding: '10px 14px' }}>
          <div className="row" style={{ gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
            <b>📑 Од договорите за сметководствени услуги</b><span className="mini">{rec!.plan.length} клиенти со договор · {rec!.plan.length - todo.length} внесени</span>
            {todo.length ? <><span className="pill warn">{todo.length} за внесување / промена</span><RowAction className="btn sm pri" action={syncRecurring} label="🔄 Внеси ги" /></> : <span className="pill good">✓ сите се внесени</span>}
            <Link className="btn sm" href="/periodicni">Периодични фактури</Link>
          </div>
          {todo.length > 0 && <div className="mini" style={{ marginTop: 6 }}>{todo.slice(0, 12).map((x) => `${x.firm.name} – ${fmt(x.net)} без ДДВ (${x.st}${x.partnerId ? '' : ', нов комитент'})`).join(' · ')}{todo.length > 12 ? ' …' : ''}</div>}
          <p className="note" style={{ margin: '6px 0 0' }}>Месечниот надоместок од договорот (или „Месечно без ДДВ“ во податоците на фирмата) автоматски станува периодична фактура: последен работен ден во месецот, ставка „Сметководствени услуги за месец“ + месецот. Кога ќе се смени цената во договорот, се менува и тука.</p>
        </div>
      )}

      {setOk && (
        <ActionForm action={saveOffice} reset={false}>
          <h2 style={{ fontSize: 15, margin: '0 0 8px' }}>Податоци за канцеларијата (давател на услугата) – важат за сите договори</h2>
          {offAuto && <div className="callout" id="ko_auto">Податоците се пополнети од фирмата <b>{(offAuto.settings as { short?: string }).short || offAuto.name}</b> – притиснете „Зачувај“.</div>}
          <div className="form">
            <label className="f wide">Назив<input name="name" defaultValue={OV.name} /></label>
            <label className="f">Адреса<input name="address" defaultValue={OV.address} /></label>
            <label className="f">Град<input name="city" defaultValue={OV.city} /></label>
            <label className="f">ЕДБ<input name="edb" defaultValue={OV.edb} /></label>
            <label className="f">ЕМБС<input name="embs" defaultValue={OV.embs} /></label>
            <label className="f">Одобрение / регистар бр.<input name="lic" defaultValue={O.lic ?? ''} /></label>
            <label className="f">Застапник<input name="rep" defaultValue={OV.rep} /></label>
            <label className="f">Функција<input name="repRole" defaultValue={OV.repRole} /></label>
            <label className="f">Стандарден месечен надоместок (како што внесувате)<input name="fee" type="number" step="any" defaultValue={String(O.fee ?? '')} /></label>
            <label className="f">Документи до (ден)<input name="docDay" type="number" defaultValue={O.docDay ?? 5} /></label>
            <label className="f">Цените ги внесувам<select name="feeMode" defaultValue={O.feeMode ?? 'gross'}><option value="gross">со ДДВ (бруто)</option><option value="net">без ДДВ (нето)</option></select></label>
          </div>
          <label className="chk" style={{ marginTop: 6 }}><input type="checkbox" name="vatOn" defaultChecked={O.vatOn !== false} /> Канцеларијата е ДДВ обврзник (18%)</label>
          <div className="row" style={{ gap: 16, marginTop: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <div className="mini">Потпис:<br />{O.sig ? <img src={`/api/files/${O.sig}`} alt="потпис" style={{ height: 50, background: '#fff', border: '1px solid var(--line)' }} /> : '—'}<br /><UploadField firmId={null} name="sigIds" accept="image/*" label="Прикачи (PNG со проѕирна позадина)" /></div>
            <div className="mini">Печат:<br />{O.stamp ? <img src={`/api/files/${O.stamp}`} alt="печат" style={{ height: 70 }} /> : '—'}<br /><UploadField firmId={null} name="stampIds" accept="image/*" label="Прикачи печат" /></div>
            <span style={{ flex: 1 }} /><button className="btn pri">Зачувај</button>
          </div>
          <p className="note">Потписот и печатот се чуваат во програмата и се ставаат само кога администраторот ќе притисне „✍ Потпиши и печат“.</p>
        </ActionForm>
      )}

      <div className="card" id="kdAll">
        <div className="hd"><h2 style={{ fontSize: 15, margin: '0 0 6px' }}>Преглед – сите фирми</h2>
          <div className="row noprint">
            <DownloadCsv name="Dogovori_site_firmi.csv" rows={[['Фирма', 'ЕДБ', 'Договор', 'Датум', 'Месечно со ДДВ', 'Статус'], ...firmsL.map((f) => { const x = (f.settings as { kdog?: { no?: string; date?: string; fee?: number; st?: string } }).kdog; return [f.name, f.edb ?? '', x?.no ?? '', x?.date ? dmy(x.date) : '', x ? Number(x.fee ?? 0) : '', x?.st ?? 'нема договор']; })]} />
            <PdfButton selector="#kdAll" title="Договори за сметководствени услуги – сите фирми" />
          </div></div>
        <div className="tw"><table className="dense">
          <thead><tr><th>Фирма</th><th>Договор</th><th className="n">Месечно</th><th>Статус</th><th></th></tr></thead>
          <tbody>{firmsL.map((f) => {
            const x = (f.settings as { kdog?: { no?: string; date?: string; fee?: number; st?: string } }).kdog;
            return (
              <tr key={f.id}>
                <td>{f.name}</td>
                <td>{x ? `${x.no ?? ''} · ${dmy(x.date ?? null)}` : <span className="pill warn">нема договор</span>}</td>
                <td className="n">{x ? fmt(x.fee ?? 0) : ''}</td><td>{x?.st ?? ''}</td>
                <td>{f.id === firm.id ? <span className="pill info">тековна</span> : firmAllowed(u.principal, f.id, f.ownerId) && <RowAction className="btn sm" action={pickFirm.bind(null, f.id)} label="Отвори" />}</td>
              </tr>
            );
          })}</tbody>
        </table></div>
      </div>
    </>
  );
}
