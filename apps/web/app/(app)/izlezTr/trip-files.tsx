/**
 * „📁 Досие на патување“: one trip on one screen — left the documents (transport invoice, CMR, travel order with the
 * countries → per diems), right the road expenses (receipts from any country, each in its currency → MKD at the NBRM
 * rate, foreign VAT not deductible) — and „📒 Книжи го патувањето“ books it all in ONE nalog „ПАТ <број>“.
 */
import Link from 'next/link';
import { and, desc, eq, gte, inArray, lte, ne } from 'drizzle-orm';
import { FR_COUNTRIES } from '@wise/core/industry';
import {
  docReads, employees, fileLinks, files, freightTours, invoices, loadFxSources, missingAccounts, partners, tripCostDrafts, tripCostReads, tripJournals,
  tripNalogNo, TRIP_COST_SOURCE, TRIP_FILE_ENTITY, TRIP_PAY_KONTA, type Firm,
} from '@wise/db';
import { CASH_EXPENSE_CATEGORIES } from '@wise/core';
import { db } from '@/lib/db';
import { dmy, fmt, todayIso } from '@/lib/fmt';
import { freightContext } from '@/lib/freight';
import { ActionForm, Submit } from '@/components/action-form';
import { UploadField } from '@/components/upload-field';
import { RowAction } from '@/components/row-action';
import { AutoRefresh } from '@/components/auto-refresh';
import { attachTripFilesAction, bookTripAction, deleteTripCostAction, detachTripFileAction, readTripCostsAction, retryTripCostAction, setTripInvoiceAction } from './actions';

const CN: Record<string, string> = { MK: 'Македонија', GB: 'В. Британија', ...Object.fromEntries(FR_COUNTRIES.map((c) => [c[0], c[1]])) };
const ROLE: Record<string, string> = { cmr: 'CMR', travel: 'Патен налог', doc: 'Друго' };
const CAT: Record<string, string> = { fuel: '⛽ гориво', toll: '🛣 патарина', parking: '🅿 паркинг', accommodation: '🛏 сместување', food: '🍽 храна', vehicle: '🔧 возило', transport: '⛴ превоз', office: 'канц.', post: 'пошта', other: 'друго' };

export async function TripFiles({ firm, year, open, write }: { firm: Firm; year: number; open?: string; write: boolean }) {
  const T = await db().select().from(freightTours)
    .where(and(eq(freightTours.firmId, firm.id), ne(freightTours.status, 'cancel'), gte(freightTours.date, `${year}-01-01`), lte(freightTours.date, `${year}-12-31`)))
    .orderBy(desc(freightTours.date)).limit(60);
  const tid = T.map((t) => t.id);
  const [L, J, E, CR] = await Promise.all([
    tid.length ? db().select({ id: fileLinks.entityId, role: fileLinks.role }).from(fileLinks).where(and(eq(fileLinks.entityType, TRIP_FILE_ENTITY), inArray(fileLinks.entityId, tid))) : Promise.resolve([]),
    tripJournals(db(), firm.id, tid),
    db().select({ id: employees.id, name: employees.name }).from(employees).where(eq(employees.firmId, firm.id)),
    tid.length ? db().select({ refId: docReads.refId, kind: docReads.kind }).from(docReads).where(and(eq(docReads.firmId, firm.id), inArray(docReads.refId, tid))) : Promise.resolve([]),
  ]);
  const drv = (id: string | null) => (id ? E.find((e) => e.id === id)?.name ?? '' : '');
  const has = (id: string, role: string) => L.some((l) => l.id === id && l.role === role) || (role === 'travel' && CR.some((c) => c.refId === id && c.kind === 'travel'));
  const nalogOf = (id: string) => J.find((j) => j.sourceId === id)?.number ?? null;
  const t = T.find((x) => x.id === open);
  return (
    <div className="card" id="dosie">
      <h2 style={{ fontSize: 15, marginTop: 0 }}>📁 Досие на патување – фактура, CMR, патен налог и трошоците во <u>еден налог (бројот на фактурата)</u></h2>
      <p className="note" style={{ marginTop: 0 }}>Изберете патување: лево се документите (фактура + CMR + патен налог со државите → дневници), десно трошоците на патот (фискални сметки од секоја држава, во нивната валута → денари по курс на НБРМ). „📒 Книжи го патувањето“ книжи сè во налог <b>со бројот на фактурата</b> (без фактура: „ПАТ &lt;број&gt;“).</p>
      {T.length === 0 ? <p className="note">Нема патувања во {year}. Прочитајте патен налог (погоре) или креирајте патување во <Link href="/frTuri">🚛 Тури</Link>.</p> : (
        <div className="tw"><table className="dense">
          <thead><tr><th>Патување</th><th>Датум</th><th>Возач</th><th>Релација</th><th>Фактура</th><th>CMR</th><th>Патен налог</th><th>Сметки</th><th>Налог</th><th /></tr></thead>
          <tbody>{T.map((x) => {
            const nc = CR.filter((c) => c.refId === x.id && c.kind === 'tripcost').length;
            return (
              <tr key={x.id} style={x.id === open ? { background: 'var(--sel, #eef4ff)' } : undefined}>
                <td><b>{x.number}</b></td><td>{dmy(x.date)}</td><td>{drv(x.driverId)}</td>
                <td className="mini">{[x.loadPlace, x.unloadPlace].filter(Boolean).join(' – ') || (x.segs ?? []).map((g) => g.c).join(' · ')}</td>
                <td>{x.invoiceId ? '✓' : <span className="mini" style={{ color: 'var(--bad)' }}>нема</span>}</td>
                <td>{has(x.id, 'cmr') ? '✓' : '—'}</td><td>{has(x.id, 'travel') || (x.segs ?? []).length ? '✓' : '—'}</td>
                <td>{nc || '—'}</td>
                <td>{nalogOf(x.id) ? <span className="pill good">{nalogOf(x.id)}</span> : <span className="mini">непрокнижено</span>}</td>
                <td><Link className={'btn sm' + (x.id === open ? ' pri' : '')} href={`/izlezTr?t=${x.id}#dosie`}>📁 Отвори</Link></td>
              </tr>
            );
          })}</tbody>
        </table></div>
      )}
      {t && <TripDossier firm={firm} t={t} write={write} driver={drv(t.driverId)} year={year} />}
    </div>
  );
}

async function TripDossier({ firm, t, write, driver, year }: { firm: Firm; t: typeof freightTours.$inferSelect; write: boolean; driver: string; year: number }) {
  const [X, fx, links, reads, travel, J, INV] = await Promise.all([
    freightContext(firm),
    loadFxSources(db(), firm.id),
    db().select({ fileId: fileLinks.fileId, role: fileLinks.role, name: files.name }).from(fileLinks).innerJoin(files, eq(files.id, fileLinks.fileId))
      .where(and(eq(fileLinks.entityType, TRIP_FILE_ENTITY), eq(fileLinks.entityId, t.id))),
    tripCostReads(db(), firm.id, [t.id]),
    db().select({ fileIds: docReads.fileIds }).from(docReads).where(and(eq(docReads.firmId, firm.id), eq(docReads.kind, 'travel'), eq(docReads.refId, t.id))),
    tripJournals(db(), firm.id, [t.id]),
    db().select({ id: invoices.id, number: invoices.number, date: invoices.date, total: invoices.total, cur: invoices.currency, p: partners.name }).from(invoices).leftJoin(partners, eq(partners.id, invoices.partnerId))
      .where(and(eq(invoices.firmId, firm.id), eq(invoices.kind, 'invoice'), eq(invoices.status, 'posted'), gte(invoices.date, `${year - 1}-12-01`))).orderBy(desc(invoices.date)).limit(300),
  ]);
  const missing = new Set(await missingAccounts(db(), firm.id, Object.values(CASH_EXPENSE_CATEGORIES).flatMap((c) => [...c[1]]).concat(['44010', '44011', '44021'])));
  const C = tripCostDrafts(reads, { fx, missing, today: todayIso() });
  const dn = X.dn(t);
  const inv = t.invoiceId ? INV.find((i) => i.id === t.invoiceId) : undefined;
  const N = J[0]?.number ?? (inv ? inv.number : tripNalogNo(t.number));
  const travelFiles = [...new Set(travel.flatMap((r) => r.fileIds))];
  const sumC = C.filter((c) => !c.problem).reduce((s, c) => s + c.mkd, 0);
  const vatC = C.filter((c) => !c.problem && c.country === 'MK' && firm.vatRegistered).reduce((s, c) => s + (c.mkd * c.rate) / (100 + c.rate), 0);
  const pending = reads.filter((r) => r.status === 'queued' || r.status === 'reading').length;
  const isBooked = (st: string) => J.some((j) => j.sourceType === st);
  const file = (id: string, label: string, role?: string) => (
    <span key={id + (role ?? '')} style={{ marginRight: 6, whiteSpace: 'nowrap' }}>
      <a className="btn sm" href={`/api/files/${id}`} target="_blank" rel="noopener">👁 {label}</a>
      {write && role && <RowAction action={detachTripFileAction.bind(null, t.id, id, role)} label="✕" className="btn sm ghost" confirm="Да се отстрани датотеката од патувањето?" />}
    </span>
  );
  return (
    <div style={{ marginTop: 12, borderTop: '2px solid var(--line, #ddd)', paddingTop: 10 }}>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
        <h3 style={{ margin: 0 }}>🚛 Патување {t.number} · {dmy(t.date)}{t.retDate ? ` – ${dmy(t.retDate)}` : ''} · {driver || 'без возач'}</h3>
        <div className="row" style={{ gap: 6 }}>
          <Link className="btn sm" href={`/frTuri?id=${t.id}&dn=1`}>✎ Држави / возач / цена</Link>
          {J.length > 0 && <Link className="btn sm" href={`/nalozi?q=${encodeURIComponent(N)}`}>📒 Налог {N}</Link>}
        </div>
      </div>
      {pending > 0 && <div className="callout info" style={{ marginTop: 8 }}>⏳ Се читаат {pending} датотеки со сметки…<AutoRefresh seconds={15} /></div>}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 12, marginTop: 10 }}>
        {/* LEFT: documents */}
        <div className="card" style={{ margin: 0 }}>
          <h4 style={{ marginTop: 0 }}>📄 Документи</h4>
          <div style={{ marginBottom: 8 }}>
            <b>Фактура за превоз:</b>{' '}
            {inv ? <><Link href={`/izlez?edit=${inv.id}`}>{inv.number}</Link> · {inv.p ?? ''} · {fmt(Number(inv.total))} {inv.cur} <a className="btn sm" href={`/print/doc/${inv.id}`} target="_blank" rel="noopener">👁</a></> : <span style={{ color: 'var(--bad)' }}>не е поврзана</span>}
            {write && (
              <ActionForm action={setTripInvoiceAction.bind(null, t.id)} className="row" reset={false} style={{ gap: 6, marginTop: 4 }}>
                <select name="invoiceId" defaultValue={t.invoiceId ?? ''} style={{ maxWidth: 300 }}>
                  <option value="">— без фактура —</option>
                  {INV.map((i) => <option key={i.id} value={i.id}>{i.number} · {dmy(i.date)} · {(i.p ?? '').slice(0, 28)} · {fmt(Number(i.total))} {i.cur}</option>)}
                </select>
                <Submit className="btn sm">Поврзи</Submit>
              </ActionForm>
            )}
          </div>
          <div style={{ marginBottom: 8 }}>
            <b>CMR / патен налог / друго:</b>{' '}
            {travelFiles.map((f, i) => file(f, `Патен налог${travelFiles.length > 1 ? ' ' + (i + 1) : ''}`))}
            {links.map((l) => file(l.fileId, `${ROLE[l.role] ?? l.role}: ${l.name.slice(0, 22)}`, l.role))}
            {!travelFiles.length && !links.length && <span className="mini">ништо прикачено</span>}
            {write && (
              <ActionForm action={attachTripFilesAction.bind(null, t.id)} className="" style={{ marginTop: 6 }}>
                <div className="row" style={{ gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                  <select name="role" defaultValue="cmr"><option value="cmr">CMR</option><option value="travel">Патен налог</option><option value="doc">Друго</option></select>
                  <UploadField firmId={firm.id} accept="image/*,application/pdf" label="📎 Избери датотеки" />
                  <Submit className="btn sm">Прикачи</Submit>
                </div>
              </ActionForm>
            )}
          </div>
          <div>
            <b>Дневници за возачот</b> {t.red !== 100 && <span className="mini">({t.red}%)</span>}
            {dn.rows.length ? (
              <table className="dense" style={{ marginTop: 4 }}><tbody>
                {dn.rows.map((r, i) => <tr key={i}><td>{CN[r.c] ?? r.c}</td><td className="n">{r.u} × {fmt(r.amt)} {r.cur}</td></tr>)}
                <tr><td><b>Вкупно</b></td><td className="n"><b>{fmt(dn.mkd)} ден.</b></td></tr>
              </tbody></table>
            ) : <div className="mini">Нема држави со влез / излез – прочитајте го патниот налог (погоре) или внесете ги во „✎ Држави“.</div>}
            {dn.miss.length > 0 && <div className="mini" style={{ color: 'var(--bad)' }}>Нема курс за {dn.miss.join(', ')}.</div>}
          </div>
        </div>
        {/* RIGHT: road expenses */}
        <div className="card" style={{ margin: 0 }}>
          <h4 style={{ marginTop: 0 }}>⛽ Трошоци на патот (сметки од сите држави)</h4>
          {write && (
            <ActionForm action={readTripCostsAction.bind(null, t.id)} className="" style={{ marginBottom: 8 }}>
              <UploadField firmId={firm.id} capture accept="image/*,application/pdf" label="📎 Фискални сметки: гориво, патарина, паркинг… (може повеќе)" />
              <Submit className="btn sm pri">🤖 Прочитај ги сметките</Submit>
            </ActionForm>
          )}
          {C.length || reads.some((r) => r.status === 'error') ? (
            <div className="tw"><table className="dense">
              <thead><tr><th>Датум</th><th>Држава</th><th>Продавач</th><th>Вид</th><th className="n">Износ</th><th className="n">Курс</th><th className="n">Денари</th><th>ДДВ</th><th /></tr></thead>
              <tbody>
                {C.map((c) => (
                  <tr key={c.readId + c.i}>
                    <td>{dmy(c.date)}</td><td>{CN[c.country] ?? c.country}</td>
                    <td>{c.merchant}<div className="mini">{c.docNo}{c.liters ? ` · ${c.liters} л` : ''}</div></td>
                    <td className="mini">{CAT[c.cat] ?? c.cat}<div>к. {c.konto}</div></td>
                    <td className="n">{fmt(+c.amt || 0)} {c.cur}</td><td className="n mini">{c.cur === 'MKD' ? '' : c.fx ? String(c.fx) : '—'}</td>
                    <td className="n">{c.problem ? <span style={{ color: 'var(--bad)' }} title={c.problem === 'нема курс' ? 'Внесете го курсот на НБРМ за датумот (Курсна листа)' : undefined}>{c.problem}</span> : fmt(c.mkd)}</td>
                    <td className="mini">{c.country === 'MK' ? (firm.vatRegistered ? `${c.rate}% се одбива` : `${c.rate}%`) : `${c.rate ? c.rate + '% ' : ''}не се одбива`}</td>
                    <td>{write && c.i === 0 && <RowAction action={deleteTripCostAction.bind(null, c.readId)} label="🗑" className="btn sm ghost" confirm="Да се избрише оваа датотека со сметки (сите сметки од неа)?" />}</td>
                  </tr>
                ))}
                {reads.filter((r) => r.status === 'error').map((r) => (
                  <tr key={r.id}><td colSpan={8} style={{ color: 'var(--bad)' }}>✕ {r.error}</td>
                    <td>{write && <><RowAction action={retryTripCostAction.bind(null, r.id)} label="↻" className="btn sm ghost" /><RowAction action={deleteTripCostAction.bind(null, r.id)} label="🗑" className="btn sm ghost" /></>}</td></tr>
                ))}
                <tr><td colSpan={6}><b>Вкупно трошоци</b>{vatC > 0 && <span className="mini"> (од тоа влезен ДДВ {fmt(vatC)})</span>}</td><td className="n"><b>{fmt(sumC)}</b></td><td colSpan={2} /></tr>
              </tbody>
            </table></div>
          ) : <p className="mini">Нема сметки. Повлечете ги фискалните од патот – програмот ја препознава државата, валутата и ДДВ-стапката (МК, BG, GR, TR, RS, CH, GB, LU, FR, BE, DE, AT…).</p>}
        </div>
      </div>
      {/* summary + one nalog */}
      <div className="callout" style={{ marginTop: 10 }}>
        <div className="row" style={{ gap: 18, flexWrap: 'wrap' }}>
          <span>Приход (фактура): <b>{inv ? `${fmt(Number(inv.total))} ${inv.cur}` : '—'}</b></span>
          <span>Дневници: <b>{fmt(dn.mkd)}</b> ден. {isBooked('freight_perdiem') && '✓'}</span>
          <span>Трошоци на патот: <b>{fmt(sumC)}</b> ден. {isBooked(TRIP_COST_SOURCE) && '✓'}</span>
          <span>Налог: <b>{J.length ? N : 'непрокнижено'}</b></span>
        </div>
        {write && (
          <ActionForm action={bookTripAction.bind(null, t.id)} className="row" reset={false} style={{ gap: 8, marginTop: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <label>Трошоците се платени од:{' '}
              <select name="payK" defaultValue="2411">{TRIP_PAY_KONTA.map(([k, n]) => <option key={k} value={k}>{k} – {n}</option>)}</select>
            </label>
            <Submit className="btn pri">{J.length ? '↻ Книжи го патувањето повторно' : '📒 Книжи го патувањето (еден налог)'}</Submit>
          </ActionForm>
        )}
      </div>
    </div>
  );
}
