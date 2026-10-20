/**
 * 🏅 ISO – Квалитет: the office working by ISO 9001 (quality), ISO 27001 (information security) and ISO 10001 / 10002
 * (customer code of conduct, complaints), ISO/IEC 27701 + ЗЗЛП (personal data – linked to the ЗЗЛП screen's register) and
 * ISO 22301 (business continuity), getting ready for certification. Overview of the registers by standard, each
 * register's list with its form (document control, evidence files, sign-off, close rules), the certification
 * readiness, the Statement of Applicability, the employees (A.6), the evidence the system already keeps, and the
 * management review (/print/iso).
 */
import Link from 'next/link';
import { BCP_STATE, bcpStatus, breach72, ISO_GROUPS, ISO_STATUS, isoCloseCheck, isoKind, isoKindsOf, isoNo, isoOverview, isoStarters, riskScore, type IsoKind, type IsoRev, type IsoSign, type IsoStatus } from '@wise/core/office/iso';
import { isoEvidence, isoGdprLinks, OFFICE_FILE_ENTITY, users } from '@wise/db';
import { db } from '@/lib/db';
import { allowedFirms, filesOf, officePage, today } from '@/lib/office';
import { Hd, dmy } from '@/components/hd';
import { ActionForm, Submit } from '@/components/action-form';
import { FileChips } from '@/components/file-chips';
import { RowAction } from '@/components/row-action';
import { UploadField } from '@/components/upload-field';
import { isoDelete, isoSave, isoSign, isoStarter, isoStatus } from './actions';
import { loadIsoRows, loadReadiness, loadSoaMerged, loadStaff } from './iso-data';
import { ReadyView } from './ready-view';
import { SoaView } from './soa-view';
import { StaffView } from './staff-view';

type SP = { k?: string; id?: string; new?: string; c?: string };
const PILL: Record<IsoStatus, string> = { open: 'warn', progress: 'info', done: 'good' };
const SPECIAL = ['ev', 'ready', 'soa', 'staff'] as const;
/** Policies: the statuses read as document states. */
const DOC_STATUS: Record<IsoStatus, string> = { open: 'нацрт', progress: 'во преглед', done: 'во сила' };

export default async function IsoPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const { u } = await officePage('iso', { perm: 'office' });
  const td = today(), year = Number(td.slice(0, 4));
  const now = new Date().toLocaleString('sv-SE', { timeZone: 'Europe/Skopje' }).replace(' ', 'T').slice(0, 16);
  const [R, U, F, G] = await Promise.all([
    loadIsoRows(),
    db().select({ id: users.id, name: users.name, active: users.active }).from(users).orderBy(users.name),
    allowedFirms(u),
    db().transaction((tx) => isoGdprLinks(tx, year, td)),
  ]);
  const UA = U.filter((x) => x.active);
  const OV = isoOverview(R, td);
  const tab = (SPECIAL as readonly string[]).includes(sp.k ?? '') ? sp.k! : isoKind(sp.k ?? '')?.k ?? '';
  const def = tab && !(SPECIAL as readonly string[]).includes(tab) ? isoKind(tab)! : null;
  const edit = sp.id ? R.find((r) => r.id === sp.id) : undefined;
  const showForm = !!def && !def.hidden && (sp.new != null || !!edit);
  const uName = (id: string | null | undefined) => U.find((x) => x.id === id)?.name ?? '';
  const fName = (id: string | null) => F.find((x) => x.id === id)?.name ?? '';
  const ev = tab === 'ev' ? await db().transaction((tx) => isoEvidence(tx, new Date(Date.now() - 90 * 864e5))) : null;
  const noPolicies = !R.some((r) => r.kind === 'policy');
  const BCP = bcpStatus(R, td);
  const title = (id: unknown) => { const r = R.find((x) => x.id === id); return r ? `${isoNo(r.kind, r.no, r.year)} ${r.title}` : ''; };
  // starting records of this register not there yet (by title)
  const missing = def ? isoStarters(def.k, '', year).filter((s) => !R.some((r) => r.kind === def.k && (r.title === s.title || (s.data.docNo && r.data.docNo === s.data.docNo)))).length : 0;
  const STARTER_LBL: Partial<Record<IsoKind, string>> = { policy: '📘 Додај ги основните документи', processing: '🗂 Додај ги основните обработки', bcp: '🧯 Додај ги основните сценарија', supplier: '🤝 Додај ги основните добавувачи', auditplan: `🗓 Додај ја програмата за ${year}` };
  const B72 = { ok: ['good', '✓ во 72 ч.'], late: ['bad', '✗ задоцнето'], overdue: ['bad', '⏱ рокот помина'], open: ['warn', '⏱ АЗЛП'], na: ['', ''] } as const;
  const needStaff = tab === 'staff' || tab === 'ready' || !tab;
  const staff = needStaff ? await loadStaff(R, td) : null;
  const ready = (tab === 'ready' || !tab) && staff ? await loadReadiness(R, staff.lines, year, td) : null;
  const soa = tab === 'soa' ? await loadSoaMerged() : null;
  const FL = def ? await filesOf(OFFICE_FILE_ENTITY.iso, R.filter((r) => r.kind === def.k).map((r) => r.id)) : new Map<string, { id: string; name: string }[]>();
  const stLbl = (k: IsoKind) => (k === 'policy' ? DOC_STATUS : ISO_STATUS);

  return (
    <>
      <Hd t="🏅 ISO – Квалитет" sub="ISO 9001 квалитет · ISO 27001 безбедност на информациите · ISO 10001 / 10002 клиенти и поплаки · ISO 27701 лични податоци · ISO 22301 континуитет – подготовка за сертификација">
        <a className="btn" href={`/print/iso?y=${year}`} target="_blank" rel="noreferrer">🖨 Преглед од раководството {year}</a>
      </Hd>
      {noPolicies && (
        <div className="callout info">📘 Почнете со <b>основните документи</b>: опсег, контекст и заинтересирани страни, политики, улоги, методологија за ризици, изјава за применливост, постапки (поплаки, корективни мерки, пристап и резервни копии, документи, проверки, лични податоци, континуитет…) – готов текст со името на канцеларијата, со ознака и верзија; вие ги прегледувате и одобрувате.{' '}
          <RowAction action={isoStarter.bind(null, 'policy')} label="📘 Креирај ги основните документи" className="btn pri sm" showOk /></div>
      )}
      {ISO_GROUPS.map((gr) => (
        <div key={gr.g}>
          {gr.g !== 'qms' && <h3 style={{ margin: '12px 0 4px', fontSize: 14 }}>{gr.n}</h3>}
          <div className="tiles kpi k4">
            {isoKindsOf(gr.g).map((d) => {
              const o = OV.find((x) => x.k === d.k)!;
              const extra = d.k === 'bcp' && BCP.length ? BCP.filter((b) => b.state !== 'ok').length : 0;
              return (
                <Link key={d.k} href={`/iso?k=${d.k}`} className="tile kt" style={{ textDecoration: 'none', color: 'inherit', outline: tab === d.k ? '2px solid var(--accent)' : undefined }}>
                  <div className="kh"><span>{d.ic} {d.n}</span></div>
                  <b className="num">{o.total}</b>
                  <i>{o.open ? <>{o.open} отворени{o.late ? <> · <strong style={{ color: 'var(--bad)' }}>{o.late} по рокот</strong></> : ''}</> : o.total ? '✓ сите затворени' : 'празно'}{extra ? <> · <strong style={{ color: 'var(--warn)' }}>{extra} за тест</strong></> : null} · <span className="mini">{d.clause}</span></i>
                </Link>
              );
            })}
            {gr.g === 'pims' && (
              <Link href="/zzlp" className="tile kt" style={{ textDecoration: 'none', color: 'inherit' }}>
                <div className="kh"><span>🔐 Регистар ЗЗЛП (клиенти)</span></div>
                <b className="num">{G.dpa}</b>
                <i>договори за обработка · {G.activities} обработки кај {G.activityFirms} клиенти · {G.statements} изјави{G.requests.late + G.breaches.late ? <> · <strong style={{ color: 'var(--bad)' }}>{G.requests.late + G.breaches.late} по рокот</strong></> : null}</i>
              </Link>
            )}
          </div>
        </div>
      ))}
      <div className="row" style={{ gap: 6, margin: '10px 0', flexWrap: 'wrap' }}>
        <Link className={`btn ${tab === 'ready' ? 'pri' : ''}`} href="/iso?k=ready">✅ Подготвеност за сертификација</Link>
        <Link className={`btn ${tab === 'soa' ? 'pri' : ''}`} href="/iso?k=soa">📋 Изјава за применливост (SoA)</Link>
        <Link className={`btn ${tab === 'staff' ? 'pri' : ''}`} href="/iso?k=staff">👥 Вработени (A.6)</Link>
        <Link className={`btn ${tab === 'ev' ? 'pri' : ''}`} href="/iso?k=ev">🧾 Докази од системот (27001)</Link>
      </div>

      {tab === 'ready' && ready && <ReadyView S={ready} full />}
      {tab === 'soa' && soa && <SoaView L={soa} sel={sp.c} />}
      {tab === 'staff' && staff && <StaffView office={staff.office} lines={staff.lines} R={R} />}

      {def && !def.hidden && (
        <div className="card">
          <div className="hd"><h2 style={{ margin: 0 }}>{def.ic} {def.n} <span className="mini">· {def.clause}</span></h2>
            {!showForm && <Link className="btn pri" href={`/iso?k=${def.k}&new`}>＋ Нов запис</Link>}</div>
          <p className="note" style={{ marginTop: 4 }}>{def.hint}</p>
          {def.g === 'pims' && (
            <div className="callout info" style={{ margin: '4px 0 8px' }}>🔗 Поврзано: <Link href="/zzlp">🔐 ЗЗЛП</Link> – договори за обработка со {G.dpa} клиенти, изјави за доверливост ({G.statements}), барања ({G.requests.n} во {year}{G.requests.open ? `, ${G.requests.open} отворени` : ''}) и повреди ({G.breaches.n}{G.breaches.open ? `, ${G.breaches.open} отворени` : ''}) по клиент; обработките по клиент ({G.activities}) – во <Link href="/zakon">Законска усогласеност</Link>.{def.k !== 'dpia' && <> Безбедносните инциденти со лични податоци го имаат правилото за <Link href="/iso?k=incident">72 часа</Link>.</>}</div>
          )}
          {def.k === 'review' && <p className="note">🖨 Влезните елементи (поплаки, неусогласености, проверки, ризици, цели, обуки, инциденти, лични податоци, континуитет, подготвеност) се составуваат сами во <a href={`/print/iso?y=${year}`} target="_blank" rel="noreferrer">Преглед од раководството {year}</a>; тука се запишува одржаниот состанок, одлуките и потписот.</p>}
          {missing > 0 && STARTER_LBL[def.k] && !(def.k === 'policy' && noPolicies) && (
            <div className="row" style={{ margin: '0 0 8px' }}><RowAction action={isoStarter.bind(null, def.k)} label={`${STARTER_LBL[def.k]} (${missing})`} className="btn sm" showOk /></div>
          )}

          {showForm && (() => {
            const sign = edit?.data._sign as IsoSign | undefined;
            const revs = (Array.isArray(edit?.data._rev) ? edit!.data._rev : []) as IsoRev[];
            const closeMsg = edit && edit.status !== 'done' ? isoCloseCheck(def.k, edit.data) : null;
            return (
              <ActionForm action={isoSave} reset={false} className="card" style={{ background: 'var(--accent-soft)' }}>
                <input type="hidden" name="kind" value={def.k} />
                {edit && <input type="hidden" name="id" value={edit.id} />}
                {edit && <p className="mini" style={{ margin: '0 0 6px' }}><b>{isoNo(edit.kind, edit.no, edit.year)}</b> · внел {uName(edit.createdBy) || '—'} на {dmy(edit.created.slice(0, 10))}{sign ? <> · <span className="pill good">✍ потврдил {sign.name} {dmy(sign.at.slice(0, 10))}</span></> : ' · не е потврдено од одговорното лице'}</p>}
                <div className="row" style={{ gap: '8px 14px', flexWrap: 'wrap', alignItems: 'end' }}>
                  <label className="f" style={{ flex: '2 1 320px' }}>Наслов<input name="title" required defaultValue={edit?.title ?? ''} /></label>
                  {(def.k === 'complaint' || def.k === 'nc' || def.k === 'incident' || def.k === 'dsr') && (
                    <label className="f" style={{ flex: '1 1 220px' }}>Клиент (фирма)<select name="firmId" defaultValue={edit?.firmId ?? ''}><option value="">—</option>{F.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
                  )}
                  <label className="f">{def.k === 'risk' ? 'Сопственик на ризикот' : 'Одговорно лице'}<select name="ownerId" defaultValue={edit?.ownerId ?? u.id}><option value="">—</option>{UA.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
                  <label className="f">Рок<input type="date" name="due" defaultValue={edit?.due ?? ''} /></label>
                  <label className="f">Статус<select name="status" defaultValue={edit?.status ?? 'open'}>{(Object.keys(ISO_STATUS) as IsoStatus[]).map((s) => <option key={s} value={s}>{stLbl(def.k)[s]}</option>)}</select></label>
                </div>
                <div className="row" style={{ gap: '8px 14px', flexWrap: 'wrap', marginTop: 8 }}>
                  {def.fields.map((x) => {
                    const v = String(edit?.data[x.k] ?? '');
                    return (
                      <label key={x.k} className="f" style={{ flex: x.t === 'area' ? '1 1 100%' : '1 1 200px' }}>{x.n}
                        {x.t === 'area' ? <textarea name={'d_' + x.k} defaultValue={v} rows={x.k === 'text' ? 14 : 3} />
                          : x.t === 'sel' ? <select name={'d_' + x.k} defaultValue={v}>{(x.o ?? []).map((o) => <option key={o} value={o}>{o || '—'}</option>)}</select>
                            : x.t === 'ref' ? <select name={'d_' + x.k} defaultValue={v}><option value="">—</option>{R.filter((r) => r.kind === x.ref).map((r) => <option key={r.id} value={r.id}>{isoNo(r.kind, r.no, r.year)} {r.title}</option>)}</select>
                              : <input name={'d_' + x.k} type={x.t === 'date' ? 'date' : x.t === 'dt' ? 'datetime-local' : x.t === 'num' ? 'number' : 'text'} step={x.t === 'num' ? 'any' : undefined} defaultValue={v} />}
                      </label>
                    );
                  })}
                </div>
                <div className="row" style={{ gap: 8, marginTop: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <UploadField firmId={null} label="📎 Доказ / прилог (скен, сертификат, листа…)" />
                  {edit && <FileChips files={FL.get(edit.id)} />}
                </div>
                {closeMsg && <p className="mini" style={{ color: 'var(--warn)', margin: '6px 0 0' }}>За „{stLbl(def.k).done}“: {closeMsg.replace(/^За затворање пополнете: /, 'пополнете ')}</p>}
                {def.k === 'policy' && revs.length > 0 && (
                  <details style={{ marginTop: 8 }} open><summary className="mini"><b>Историја на измени</b> ({revs.length})</summary>
                    <table className="dense" style={{ marginTop: 4 }}><thead><tr><th>Верзија</th><th>Датум</th><th>Изменил</th><th>Опис на измената</th></tr></thead>
                      <tbody>{revs.map((x, i) => <tr key={i}><td>{x.v}</td><td>{dmy(x.on)}</td><td>{uName(x.by)}</td><td>{x.note ?? (i === 0 ? 'прва верзија' : '')}</td></tr>)}</tbody></table>
                    <p className="note" style={{ margin: '4px 0 0' }}>Нова верзија = променете ја „Верзија“ и внесете „Опис на измената“ – се запишува сама.</p>
                  </details>
                )}
                <div className="row" style={{ gap: 8, marginTop: 8 }}><Submit>Зачувај</Submit><Link className="btn" href={`/iso?k=${def.k}`}>Откажи</Link>
                  {edit && !sign && <RowAction action={isoSign.bind(null, edit.id)} label="✍ Потврди (одговорно лице)" className="btn" title="Потврда од одговорното лице – кој и кога; при измена на содржината потврдата се брише" />}</div>
              </ActionForm>
            );
          })()}

          {(() => {
            const L = R.filter((r) => r.kind === def.k);
            if (!L.length) return <div className="empty">Нема записи. ＋ Нов запис.</div>;
            return (
              <div className="tw"><table className="dense">
                <thead><tr><th>Бр.</th><th>Наслов</th>{def.k === 'risk' && <th className="n">Ризик</th>}{def.k === 'incident' && <th>ЗЗЛП 72 ч.</th>}
                  {def.k === 'bcp' && <><th className="n">RTO</th><th className="n">RPO</th><th>Последен тест</th><th>Следен</th></>}
                  {def.k === 'bctest' && <><th>Сценарио</th><th>Датум</th><th>Траење / RTO</th><th>Резултат</th></>}
                  {def.k === 'dpia' && <th>Обработка</th>}{def.k === 'processing' && <th>Улога</th>}{def.k === 'dsr' && <th>Вид</th>}
                  {def.k === 'policy' && <th>Ознака · верзија</th>}{def.k === 'audit' && <th>Програма</th>}{def.k === 'supplier' && <th>Оценка</th>}{def.k === 'training' && <th>Компетентност</th>}
                  <th>Клиент</th><th>Одговорен</th><th>Рок</th><th>Статус</th><th>✍ 📎</th><th /></tr></thead>
                <tbody>{L.map((r) => {
                  const rs = def.k === 'risk' ? riskScore(r.data) : null;
                  const b72 = def.k === 'incident' ? breach72(r.data, now) : null;
                  const bc = def.k === 'bcp' ? BCP.find((x) => x.r.id === r.id) : null;
                  const pl = def.k === 'bctest' ? BCP.find((x) => x.r.id === r.data.plan) : null;
                  const late = r.status !== 'done' && r.due && r.due < td;
                  const sign = r.data._sign as IsoSign | undefined;
                  return (
                    <tr key={r.id}>
                      <td style={{ whiteSpace: 'nowrap' }}><b>{isoNo(r.kind, r.no, r.year)}</b><div className="mini">{dmy(r.created.slice(0, 10))}{r.createdBy ? ` · ${uName(r.createdBy)}` : ''}</div></td>
                      <td><Link href={`/iso?k=${def.k}&id=${r.id}`}>{r.title}</Link></td>
                      {def.k === 'risk' && <td className="n">{rs ? <span className={`pill ${rs.cls === 'high' ? 'bad' : rs.cls === 'mid' ? 'warn' : 'good'}`}>{rs.s}</span> : '—'}{r.data.accepted ? <div className="mini">прифатен</div> : null}</td>}
                      {b72 && <td style={{ whiteSpace: 'nowrap' }}>{b72.state !== 'na' && <><span className={`pill ${B72[b72.state][0]}`}>{B72[b72.state][1]}</span>{b72.deadline && <div className="mini">до {dmy(b72.deadline.slice(0, 10))} {b72.deadline.slice(11)}{b72.hoursLeft != null && b72.hoursLeft >= 0 ? ` · уште ${b72.hoursLeft} ч.` : ''}</div>}</>}</td>}
                      {bc && <><td className="n">{bc.rto != null ? `${bc.rto} ч.` : '—'}</td><td className="n">{bc.rpo != null ? `${bc.rpo} ч.` : '—'}</td>
                        <td>{bc.lastTest ? dmy(bc.lastTest) : '—'}<div className="mini" style={{ color: bc.state === 'ok' ? undefined : 'var(--bad)' }}>{BCP_STATE[bc.state]}</div></td><td>{bc.next ? dmy(bc.next) : ''}</td></>}
                      {def.k === 'bctest' && <><td>{title(r.data.plan)}</td><td>{r.data.date ? dmy(String(r.data.date)) : ''}</td>
                        <td>{r.data.took != null ? `${String(r.data.took)} ч.` : '—'}{pl?.rto != null ? ` / ${pl.rto} ч.` : ''}{r.data.lost != null ? <div className="mini">изгубено {String(r.data.lost)} ч.{pl?.rpo != null ? ` / RPO ${pl.rpo} ч.` : ''}</div> : null}</td>
                        <td>{r.data.result ? <span className={`pill ${r.data.result === 'успешно' ? 'good' : r.data.result === 'делумно' ? 'warn' : 'bad'}`}>{String(r.data.result)}</span> : ''}</td></>}
                      {def.k === 'dpia' && <td>{title(r.data.processing)}{r.data.residual ? <div className="mini">преостанат: {String(r.data.residual)}</div> : null}</td>}
                      {def.k === 'processing' && <td>{String(r.data.role ?? '')}{r.data.special === 'да' ? <div className="mini">посебни категории</div> : null}</td>}
                      {def.k === 'dsr' && <td>{String(r.data.type ?? '')}{r.data.answeredOn ? <div className="mini">одговорено {dmy(String(r.data.answeredOn))}</div> : null}</td>}
                      {def.k === 'policy' && <td style={{ whiteSpace: 'nowrap' }}><b>{String(r.data.docNo ?? '—')}</b> · в. {String(r.data.version ?? '—')}<div className="mini">{r.data.approvedOn ? `одобрено ${dmy(String(r.data.approvedOn))}` : 'неодобрено'}{r.data.reviewOn ? ` · преглед ${dmy(String(r.data.reviewOn))}` : ''}</div></td>}
                      {def.k === 'audit' && <td>{title(r.data.plan)}</td>}
                      {def.k === 'supplier' && <td>{String(r.data.evaluation ?? '—')}{r.data.dpa ? <div className="mini">DPA: {String(r.data.dpa)}</div> : null}</td>}
                      {def.k === 'training' && <td>{String(r.data.evaluation ?? '—')}</td>}
                      <td>{fName(r.firmId)}</td><td>{uName(r.ownerId)}</td>
                      <td style={late ? { color: 'var(--bad)', fontWeight: 600 } : undefined}>{r.due ? dmy(r.due) : ''}</td>
                      <td><span className={`pill ${PILL[r.status]}`}>{stLbl(def.k)[r.status]}</span>{r.closed && r.status === 'done' ? <div className="mini">{dmy(r.closed.slice(0, 10))}</div> : null}</td>
                      <td style={{ whiteSpace: 'nowrap' }}>{sign ? <span title={`потврдил ${sign.name} ${dmy(sign.at.slice(0, 10))}`}>✍</span> : <span className="mini" title="не е потврдено">—</span>} {(FL.get(r.id)?.length ?? 0) > 0 ? <span title={FL.get(r.id)!.map((x) => x.name).join(', ')}>📎{FL.get(r.id)!.length}</span> : ''}</td>
                      <td style={{ whiteSpace: 'nowrap' }}>
                        <Link className="btn sm" href={`/iso?k=${def.k}&id=${r.id}`}>✎</Link>
                        {r.status !== 'done' ? <RowAction action={isoStatus.bind(null, r.id, 'done')} label={def.k === 'policy' ? '✓ Во сила' : '✓ Затвори'} className="btn sm" />
                          : <RowAction action={isoStatus.bind(null, r.id, 'open')} label="↺" title="Отвори повторно" />}
                        <RowAction action={isoDelete.bind(null, r.id)} label="🗑" title="Избриши" confirm={`Да се избрише „${r.title}“?`} />
                      </td>
                    </tr>
                  );
                })}</tbody>
              </table></div>
            );
          })()}
        </div>
      )}

      {tab === 'ev' && ev && (
        <div className="card">
          <h2 style={{ marginTop: 0 }}>🧾 Докази од системот – последни 90 дена</h2>
          <p className="note">Програмата веќе ги води записите што ги бара ISO 27001: пристап по корисник и улога (A.5.15–5.18), дневник на секоја промена што не може да се брише (A.8.15), грешки на системот (A.8.16), дневна резервна копија пред секоја надградба (A.8.13).</p>
          <div className="tiles kpi k4">
            <div className="tile kt"><div className="kh"><span>Корисници</span></div><b className="num">{ev.users.filter((x) => x.active).length}</b><i>активни · {ev.users.filter((x) => !x.active).length} затворени</i></div>
            <div className="tile kt"><div className="kh"><span>Евидентирани промени</span></div><b className="num">{ev.changes.toLocaleString('mk-MK')}</b><i>дневник на промени (не се брише)</i></div>
            <div className="tile kt"><div className="kh"><span>Најавувања</span></div><b className="num">{ev.logins.toLocaleString('mk-MK')}</b><i>последни 90 дена</i></div>
            <div className="tile kt"><div className="kh"><span>Грешки на системот</span></div><b className="num">{ev.errors.open}</b><i>отворени · {ev.errors.fixed} решени</i></div>
          </div>
          <div className="cols" style={{ marginTop: 10 }}>
            <div><h3>Корисници и улоги (контрола на пристап)</h3><div className="tw"><table className="dense"><thead><tr><th>Име</th><th>Корисничко</th><th>Улога</th><th>Статус</th></tr></thead>
              <tbody>{ev.users.map((x) => <tr key={x.username}><td>{x.name}</td><td>{x.username}</td><td>{x.role}</td><td>{x.active ? <span className="pill good">активен</span> : <span className="pill">затворен</span>}</td></tr>)}</tbody></table></div></div>
            <div><h3>Најчести промени</h3><div className="tw"><table className="dense"><thead><tr><th>Акција</th><th className="n">Број</th></tr></thead>
              <tbody>{ev.topActions.map((x) => <tr key={x.a}><td>{x.a}</td><td className="n">{x.n}</td></tr>)}</tbody></table></div></div>
          </div>
        </div>
      )}

      {!tab && (
        <>
          {ready && <ReadyView S={ready} />}
          <div className="card">
            <h2 style={{ marginTop: 0 }}>Како се користи – пат до сертификат</h2>
            <ol style={{ margin: 0, paddingLeft: 20, lineHeight: 1.7 }}>
              <li><b>📘 Документи</b>: креирајте ги основните (опсег, контекст, заинтересирани страни, политики, улоги, ризици, SoA, постапки), дополнете ги и ставете ги <b>во сила</b> со „Одобрил / Одобрено на“; секоја нова верзија се запишува во историјата.</li>
              <li><b>📋 Изјава за применливост</b>: прегледајте ги 93-те контроли (предлогот е подготвен за сметководствена канцеларија) и потврдете ги.</li>
              <li><b>🎯 Ризици</b> со третман и прифаќање, <b>🏁 цели</b> со план и мерење, <b>🤝 добавувачи</b> со оценка.</li>
              <li><b>👥 Вработени</b>: договор за вработување со одредбите за безбедност и ЗЗЛП (🖨 печати, потпишете, прикачете скен), изјава за прифаќање на политиките, <b>🎓 обуки</b> со оценка на компетентноста.</li>
              <li>Во текот на годината: секоја <b>📣 поплака</b>, <b>🛠 неусогласеност</b> (затвора се дури по проверка на ефективноста), <b>🛡 инцидент</b> (АЗЛП во 72 часа), <b>🙋 барање од субјект</b>, <b>♻ тест на враќање</b> – со доказ (📎) и потврда (✍).</li>
              <li><b>🗓 Програма</b> и <b>🔍 внатрешни проверки</b>, потоа <b>🧭 преглед од раководството</b> (🖨 извештајот се составува сам) – и ✅ подготвеноста треба да е зелена пред сертификациската проверка.</li>
            </ol>
          </div>
        </>
      )}
    </>
  );
}
