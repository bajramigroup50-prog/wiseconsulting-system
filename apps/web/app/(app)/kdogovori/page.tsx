/**
 * Legacy `VIEWS.kdogovori` 10355 → 13577 → 13602 → 13608 → 13616 → **15514** — the accounting-service contract:
 * list with status, editor with live preview, office signature + stamp, the client's signature (on the screen in the
 * office or a scanned signed copy), the signed PDF archived in the dossier, e-mail, contract defaults, all clients
 * overview and the monthly invoices from the contracts in the office firm (legacy `kdRecPlan` panel of `periodicni`).
 *
 * Owner decision: the contracts are made BY the office firm (БАЈРАМИ ГРОУП ДООЕЛ Скопје, „Фирма на канцеларијата“)
 * WITH each client — the screen is the office OWNER's only and works on every client from here (`?f=<firm id>`,
 * the client picker), without switching the current firm. Not in the client portal.
 */
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { and, desc, eq } from 'drizzle-orm';
import { kdAmt, kdNew, kdNumber, kdStatus, kdVat, type KdContract } from '@wise/core/firms/kdog';
import { firms, officeCounters, serviceContracts, wordTemplates } from '@wise/db';
import { requireUser } from '@/lib/auth';
import { currentFirm } from '@/lib/context';
import { db } from '@/lib/db';
import { isUuid, today } from '@/lib/office';
import { OWNER_ONLY_MSG } from '@/lib/office-owner';
import { fmt } from '@/lib/fmt';
import { ActionForm } from '@/components/action-form';
import { Hd, dmy } from '@/components/hd';
import { RowAction } from '@/components/row-action';
import { UploadField } from '@/components/upload-field';
import { DownloadCsv } from '@/components/download-csv';
import { PdfButton } from '@/components/pdf-button';
import { SignaturePad, PhotoField } from '@/components/driver-form';
import { clientSign, contractToDossier, deleteContract, endContract, mailContract, officeSign, saveOffice, setOfficeFirm, syncRecurring, uploadSignedCopy } from './actions';
import { KdEditor } from './editor';
import { firmOf, kdCounterKey, kdOwnerUser, loadProvider, recPlanFor, rowToContract } from './lib';
import { firmSideSql } from '@/lib/demo-office';

const T = 'Договор за сметководствени услуги';

async function peekNo(date: string, demo: boolean) {
  const y = Number(date.slice(0, 4));
  const [c] = await db().select().from(officeCounters).where(and(eq(officeCounters.key, kdCounterKey(demo)), eq(officeCounters.year, y))).limit(1);
  return (demo ? 'ДЕМО-' : '') + kdNumber((c?.value ?? 0) + 1, y);
}

type KdogSum = { no?: string; date?: string; fee?: number; st?: string };

export default async function KdogovoriPage({ searchParams }: { searchParams: Promise<{ f?: string; ed?: string }> }) {
  const u = await kdOwnerUser();
  if (!u) {
    const u0 = await requireUser();
    if (u0.role === 'klient' || u0.role === 'teren') notFound();
    return <><Hd t={`✍ ${T}`} exp={false} /><div className="card empty">{OWNER_ONLY_MSG}</div></>;
  }
  const sp = await searchParams;
  const { raw, off, O, demo } = await loadProvider(u);
  const rate = kdVat(O);
  // 🎭 the firms of the owner's side only: demo firms for the demo office, never a demo firm for the real office
  const all = (await db().select().from(firms).where(firmSideSql(u))).filter((f) => !(f.settings as { example?: boolean }).example).sort((a, b) => a.name.localeCompare(b.name, 'mk'));
  const clients = all.filter((f) => f.id !== off?.id);
  const cur = await currentFirm(u);
  const fid = isUuid(sp.f) ? sp.f : cur && cur.id !== off?.id ? cur.id : '';
  const firm = clients.find((f) => f.id === fid) ?? null;
  const q = (x: Record<string, string>) => `/kdogovori?${new URLSearchParams({ ...(firm ? { f: firm.id } : {}), ...x })}`;

  /* ---------- editor ---------- */
  if (firm && sp.ed) {
    let k: KdContract;
    if (sp.ed === 'new') k = kdNew(O, firmOf(firm), today());
    else {
      const [r] = isUuid(sp.ed) ? await db().select().from(serviceContracts).where(and(eq(serviceContracts.id, sp.ed), eq(serviceContracts.firmId, firm.id))).limit(1) : [];
      if (!r) notFound();
      k = rowToContract(r);
      if (k.offSig) notFound();
    }
    return (
      <>
        <Hd t={k.id ? `Договор ${k.number}` : 'Нов договор за сметководствени услуги'} sub={`${O.name || 'канцеларија'} → ${firm.name}`}><Link className="btn" href={q({})}>← Листа</Link></Hd>
        {!O.name && <div className="callout warn">Прво одредете ја „Фирмата на канцеларијата“ (давател на услугата) во листата.</div>}
        <KdEditor initial={k} firm={firmOf(firm)} firmId={firm.id} O={O} off={off ? firmOf(off) : null} peekNo={k.number ? '' : await peekNo(k.date, demo)} offName={off?.name ?? null} />
      </>
    );
  }

  const [rows, Tp] = await Promise.all([
    firm ? db().select().from(serviceContracts).where(eq(serviceContracts.firmId, firm.id)).orderBy(desc(serviceContracts.date)) : Promise.resolve([]),
    // the office's own Word templates are the real office's (and served by an API a demo user cannot call)
    demo ? Promise.resolve([]) : db().select().from(wordTemplates).where(and(eq(wordTemplates.kind, 'kd'), eq(wordTemplates.active, true))),
  ]);
  const K = rows.map((r) => ({ k: rowToContract(r), ended: r.status === 'ended' }));
  const rec = off ? await recPlanFor(off.id, demo) : null;
  const todo = rec?.plan.filter((x) => x.st !== 'ок') ?? [];
  const missSig = [!O.sig ? 'потпис' : '', !O.stamp ? 'печат' : ''].filter(Boolean).join(' и ');
  const offS = (off?.settings ?? {}) as Record<string, unknown>;
  const fromFirm = (k: string) => typeof offS[k] === 'string' && !!offS[k];

  return (
    <>
      <Hd t={`✍ ${T}`} sub={`давател: ${O.name || '— не е одредена фирмата на канцеларијата'}`} />

      {/* client picker */}
      <form className="card row" style={{ gap: 10, alignItems: 'end', flexWrap: 'wrap' }} method="get" action="/kdogovori">
        <label className="f" style={{ minWidth: 320 }}>Клиент (нарачател)
          <select name="f" defaultValue={firm?.id ?? ''}>
            <option value="">— изберете фирма —</option>
            {clients.map((f) => <option key={f.id} value={f.id}>{f.name}{(f.settings as { kdog?: KdogSum }).kdog ? '' : ' · нема договор'}</option>)}
          </select>
        </label>
        <button className="btn">Отвори</button>
        <span style={{ flex: 1 }} />
        {firm && (O.name ? <Link className="btn pri" href={q({ ed: 'new' })}>+ Нов договор со {firm.name}</Link> : <button className="btn pri" disabled title="Прво одредете ја фирмата на канцеларијата">+ Нов договор</button>)}
      </form>

      {firm && (
        <>
          <h2 style={{ fontSize: 15, margin: '10px 0 6px' }}>{firm.name}</h2>
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
                      {!k.offSig && <Link className="btn sm" href={q({ ed: k.id! })}>Измени</Link>}
                      {!k.offSig && <RowAction className="btn sm pri" action={officeSign.bind(null, firm.id, k.id!)} label="✍ Потпиши и печат"
                        confirm={`${missSig ? `Немате ${missSig} (во картичката на фирмата на канцеларијата или подолу) – договорот ќе се потпише рачно. ` : ''}Да се стави потписот и печатот на ${O.name} на договорот ${k.number}? По ова договорот не може да се менува.`} />}
                      <a className="btn sm" href={`/kdogovori/pecati?id=${k.id}`} target="_blank" rel="noopener">⬇ PDF</a>
                      {Tp.length > 0 && <a className="btn sm" href={`/api/office/tpl/own?k=kd&src=kd:${k.id}&fmt=word`} title="Word од сопствениот шаблон">📝 Word</a>}
                      {!k.arch && (k.draftArch ? <span className="pill info" title="Нацртот е во досието; по потпишувањето се заменува">📁 во досие</span> : <RowAction className="btn sm" action={contractToDossier.bind(null, firm.id, k.id!)} label="📁 Во досие" />)}
                      {!k.arch && <RowAction action={deleteContract.bind(null, firm.id, k.id!)} label="🗑" style={{ color: 'var(--bad)' }} confirm={`Да се избрише договорот ${k.number}?`} />}
                      {k.arch && !ended && <RowAction action={endContract.bind(null, firm.id, k.id!)} label="Раскини" confirm="Да се означи договорот како раскинат?" />}
                      {!demo && <ActionForm action={mailContract} className="row" style={{ display: 'flex', gap: 4, marginTop: 4 }} reset={false}>
                        <input type="hidden" name="firmId" value={firm.id} /><input type="hidden" name="id" value={k.id} />
                        <input name="to" defaultValue={firm.email ?? ''} placeholder="е-пошта на клиентот" style={{ width: 200 }} />
                        <button className="btn sm">✉ Испрати PDF</button>
                      </ActionForm>}
                      {k.offSig && !k.cliSig && (
                        <>
                          <ActionForm action={uploadSignedCopy} className="row" style={{ display: 'flex', gap: 4, marginTop: 4 }}>
                            <input type="hidden" name="firmId" value={firm.id} /><input type="hidden" name="id" value={k.id} />
                            <UploadField firmId={firm.id} accept=".pdf,image/*" label="📎 Прикачи потпишан примерок" />
                            <button className="btn sm">Зачувај</button>
                          </ActionForm>
                          <details style={{ marginTop: 4, whiteSpace: 'normal' }}><summary className="btn sm">✍ Потпис на клиентот на екран</summary>
                            <ActionForm action={clientSign} className="card" style={{ marginTop: 6, borderLeft: '4px solid var(--accent)' }}>
                              <input type="hidden" name="firmId" value={firm.id} /><input type="hidden" name="id" value={k.id} />
                              <div className="form">
                                <label className="f">Име и презиме на потписникот (клиент)<input name="name" defaultValue={k.rep} /></label>
                                <PhotoField name="stamp" label="🔵 Печат (слика, по желба)" />
                              </div>
                              <SignaturePad name="sig" label="Потпис на клиентот" />
                              <label className="chk" style={{ marginTop: 6 }}><input type="checkbox" name="ok" /> Клиентот го прочита договорот и се согласува со неговата содржина</label>
                              <div className="row" style={{ marginTop: 8 }}><button className="btn pri">✍ Потпиши</button></div>
                            </ActionForm>
                          </details>
                        </>
                      )}
                    </td>
                  </tr>
                );
              })}
              {!K.length && <tr><td colSpan={5} className="note">Нема договор со оваа фирма.</td></tr>}
            </tbody>
          </table></div>
          <p className="note">Тек: 1) креирајте го договорот (податоците на клиентот и на {O.name || 'канцеларијата'} се пополнуваат автоматски) → 2) „✍ Потпиши и печат“ → 3) клиентот потпишува на екран во канцеларијата или прикачете скениран потпишан примерок → 4) договорот автоматски се архивира како PDF во „Документи на фирмата“ на клиентот.</p>
          {!Tp.length && !demo && <p className="note">За Word верзија прикачете шаблон од вид „Договор за сметководствени услуги“ во <a href="/tpl">Шаблони</a>.</p>}
        </>
      )}

      {/* „Фирма на канцеларијата“ = the provider */}
      {/* 🎭 the demo office firm is fixed: a demo admin sees it, never the picker (and never a real firm) */}
      {demo ? (
        <div className="card mini" style={{ lineHeight: 1.6 }}>
          🏢 Фирма на канцеларијата: <b>{off?.name ?? '—'}</b> · {[O.address, O.city].filter(Boolean).join(', ')} · ЕДБ {O.edb || '—'}
        </div>
      ) : (
        <ActionForm action={setOfficeFirm} reset={false}>
          <h2 style={{ fontSize: 15, margin: '0 0 8px' }}>🏢 Фирма на канцеларијата (давател на услугата во сите договори)</h2>
          <div className="row" style={{ gap: 10, alignItems: 'end', flexWrap: 'wrap' }}>
            <label className="f" style={{ minWidth: 320 }}>Фирма
              <select name="officeFirmId" defaultValue={off?.id ?? ''}>
                <option value="">— изберете —</option>
                {all.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
              </select>
            </label>
            <button className="btn pri">Зачувај</button>
            {off && !(offS.officeFirm) && <span className="pill warn">автоматски препознаена – потврдете</span>}
          </div>
          {off ? (
            <div className="mini" style={{ marginTop: 8, lineHeight: 1.6 }}>
              <b>{O.name}</b> · {[O.address, O.city].filter(Boolean).join(', ') || <span className="pill warn">нема адреса</span>} · ЕДБ {O.edb || '—'} · ЕМБС {O.embs || '—'} · Ж-сметка {O.bank || '—'}<br />
              Потписник: {O.rep || '—'}{O.repRole ? `, ${O.repRole}` : ''} · лого {O.logo ? '✓' : '—'} · потпис {O.sig ? '✓' : '—'}{O.sig && !fromFirm('sign') ? ' (од подесувањата подолу)' : ''} · печат {O.stamp ? '✓' : '—'}{O.stamp && !fromFirm('stamp') ? ' (од подесувањата подолу)' : ''}
              <br />Податоците (назив, адреса, ЕДБ, ЕМБС, сметка, потписник, лого, потпис, печат) се земаат од картичката на фирмата – менувајте ги во <Link href="/firmi">Фирми</Link>.
            </div>
          ) : <div className="callout warn" style={{ marginTop: 8 }}>Не е одредена фирмата на канцеларијата – изберете ја погоре.</div>}
        </ActionForm>
      )}

      {/* legacy kdRecPlan panel (periodicni 13567–13575) */}
      {off && rec && (
        <div className="card" style={{ padding: '10px 14px' }}>
          <div className="row" style={{ gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
            <b>📑 Месечни фактури од договорите (во {off.name})</b><span className="mini">{rec.plan.length} клиенти со договор · {rec.plan.length - todo.length} внесени</span>
            {todo.length ? <><span className="pill warn">{todo.length} за внесување / промена</span><RowAction className="btn sm pri" action={syncRecurring} label="🔄 Внеси ги" /></> : <span className="pill good">✓ сите се внесени</span>}
          </div>
          {todo.length > 0 && <div className="mini" style={{ marginTop: 6 }}>{todo.slice(0, 12).map((x) => `${x.firm.name} – ${fmt(x.net)} без ДДВ (${x.st}${x.partnerId ? '' : ', нов комитент'})`).join(' · ')}{todo.length > 12 ? ' …' : ''}</div>}
          <p className="note" style={{ margin: '6px 0 0' }}>Месечниот надоместок од договорот (или „Месечно без ДДВ“ во податоците на фирмата) станува периодична фактура во фирмата на канцеларијата: последен работен ден во месецот, ставка „Сметководствени услуги за месец“ + месецот.</p>
        </div>
      )}

      <ActionForm action={saveOffice} reset={false}>
        <h2 style={{ fontSize: 15, margin: '0 0 8px' }}>Услови и подесувања – важат за сите нови договори</h2>
        {!off && (
          <div className="form">
            <label className="f wide">Назив (без фирма на канцеларијата)<input name="name" defaultValue={raw.name ?? ''} /></label>
            <label className="f">Адреса<input name="address" defaultValue={raw.address ?? ''} /></label>
            <label className="f">Град<input name="city" defaultValue={raw.city ?? ''} /></label>
            <label className="f">ЕДБ<input name="edb" defaultValue={raw.edb ?? ''} /></label>
            <label className="f">ЕМБС<input name="embs" defaultValue={raw.embs ?? ''} /></label>
          </div>
        )}
        <div className="form">
          <label className="f">Одобрение / регистар бр.<input name="lic" defaultValue={raw.lic ?? ''} /></label>
          <label className="f" title="Се користи само ако во картичката на фирмата нема потписник">Застапник (резервно)<input name="rep" defaultValue={raw.rep ?? ''} /></label>
          <label className="f">Функција (резервно)<input name="repRole" defaultValue={raw.repRole ?? 'Управител'} /></label>
          <label className="f">Стандарден месечен надоместок (како што внесувате)<input name="fee" type="number" step="any" defaultValue={String(raw.fee ?? '')} /></label>
          <label className="f">Документи до (ден)<input name="docDay" type="number" defaultValue={raw.docDay ?? 5} /></label>
          <label className="f">Цените ги внесувам<select name="feeMode" defaultValue={raw.feeMode ?? 'gross'}><option value="gross">со ДДВ (бруто)</option><option value="net">без ДДВ (нето)</option></select></label>
        </div>
        <label className="chk" style={{ marginTop: 6 }}><input type="checkbox" name="vatOn" defaultChecked={raw.vatOn !== false} /> Канцеларијата е ДДВ обврзник (18%)</label>
        <div className="row" style={{ gap: 16, marginTop: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div className="mini">Потпис (ако го нема во картичката на фирмата):<br />{raw.sig ? <img src={`/api/files/${raw.sig}`} alt="потпис" style={{ height: 50, background: '#fff', border: '1px solid var(--line)' }} /> : '—'}<br /><UploadField firmId={null} name="sigIds" accept="image/*" label="Прикачи (PNG со проѕирна позадина)" /></div>
          <div className="mini">Печат (ако го нема во картичката на фирмата):<br />{raw.stamp ? <img src={`/api/files/${raw.stamp}`} alt="печат" style={{ height: 70 }} /> : '—'}<br /><UploadField firmId={null} name="stampIds" accept="image/*" label="Прикачи печат" /></div>
          <span style={{ flex: 1 }} /><button className="btn pri">Зачувај</button>
        </div>
        <p className="note">Потписот и печатот се ставаат само кога сопственикот ќе притисне „✍ Потпиши и печат“.</p>
      </ActionForm>

      <div className="card" id="kdAll">
        <div className="hd"><h2 style={{ fontSize: 15, margin: '0 0 6px' }}>Преглед – сите клиенти</h2>
          <div className="row noprint">
            <DownloadCsv name="Dogovori_site_firmi.csv" rows={[['Фирма', 'ЕДБ', 'Договор', 'Датум', 'Месечно со ДДВ', 'Статус'], ...clients.map((f) => { const x = (f.settings as { kdog?: KdogSum }).kdog; return [f.name, f.edb ?? '', x?.no ?? '', x?.date ? dmy(x.date) : '', x ? Number(x.fee ?? 0) : '', x?.st ?? 'нема договор']; })]} />
            <PdfButton selector="#kdAll" title="Договори за сметководствени услуги – сите клиенти" />
          </div></div>
        <div className="tw"><table className="dense">
          <thead><tr><th>Фирма</th><th>Договор</th><th className="n">Месечно</th><th>Статус</th><th></th></tr></thead>
          <tbody>{clients.map((f) => {
            const x = (f.settings as { kdog?: KdogSum }).kdog;
            return (
              <tr key={f.id}>
                <td>{f.name}</td>
                <td>{x ? `${x.no ?? ''} · ${dmy(x.date ?? null)}` : <span className="pill warn">нема договор</span>}</td>
                <td className="n">{x ? fmt(x.fee ?? 0) : ''}</td><td>{x?.st ?? ''}</td>
                <td>{f.id === firm?.id ? <span className="pill info">отворена</span> : <Link className="btn sm" href={`/kdogovori?f=${f.id}`}>Отвори</Link>}</td>
              </tr>
            );
          })}</tbody>
        </table></div>
      </div>
    </>
  );
}
