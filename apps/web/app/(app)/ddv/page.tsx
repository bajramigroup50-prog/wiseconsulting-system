/**
 * Legacy `VIEWS.ddv` 5969 → 13126 (default = period due) → 16456 (month/quarter switch) → 16836 (inspector button)
 * — Финансово › ДДВ · ДДВ-04: period list with due dates, ДДВ-04 per period (table / official form), corrections,
 * close (file + post) / reopen. Sub-views: `?tab=insp` inspector table (legacy `ddvTab` 16812),
 * `?tab=tarifi` VAT kontos (legacy `tarifi` 12844).
 */
import Link from 'next/link';
import { eq, asc } from 'drizzle-orm';
import {
  DDV04_FIELDS, ddv04FromResult, ddvFor, periodDue, periodOf, perRange, schemeValue, vatAccount, VAT_REGISTRATION_LIMIT,
} from '@wise/core';
import {
  computeVatPeriod, effectiveChart, firmVatPeriodKind, fixtureVatSource, journalLines, journals, loadVatPostingContext,
  normalizeVatPeriod, users, vatPeriodLabel, vatYearOverview, type Firm, type VatPeriodOverview,
} from '@wise/db';
import { booksPage, canDo } from '@/lib/books';
import { db } from '@/lib/db';
import { dmy, fmt } from '@/lib/fmt';
import { vatLedgerNote, vatSource } from '@/lib/vat-source';
import { DT_DEF, DT_SH, periodShortLabel } from '@/lib/vat-view';
import type { SessionUser } from '@/lib/auth';
import { Hd } from '@/components/hd';
import { NoFirm } from '@/components/no-firm';
import { RowAction } from '@/components/row-action';
import { DownloadCsv } from '@/components/download-csv';
import { Ddv04Form, fi } from './ddv04-form';
import { CorrectionsForm, VatAccountsForm } from './forms';
import { DownloadXlsx } from './download-xlsx';
import { closeVatPeriodAction, reopenVatPeriodAction, saveDtColsAction, setVatPeriodKindAction } from './actions';
import { inspCols, inspTables, inspYears } from '@/lib/vat-insp';
import { PeriodKind } from './period-kind';
import { TarifiView } from './tarifi-view';
import { ddvEvidenceRows } from '@wise/core/vat/evidence';

type SP = { p?: string; view?: string; tab?: string; y?: string | string[]; mode?: string; c?: string | string[] };
const today = () => new Date().toISOString().slice(0, 10);
const list = (v: string | string[] | undefined) => (v == null ? [] : Array.isArray(v) ? v : [v]);

/** Legacy 13126: open the previous period while its return is still due, else the current one. */
function defaultPeriod(P: VatPeriodOverview[], kind: 'month' | 'quarter', year: number): string {
  const t = today();
  const cur = periodOf(t, kind);
  const [a] = perRange(cur);
  const d = new Date(a + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() - 1);
  const prev = periodOf(d.toISOString().slice(0, 10), kind);
  if (prev.startsWith(String(year)) && t <= periodDue(prev) && P.some((p) => p.period === prev)) return prev;
  return P.some((p) => p.period === cur) ? cur : P[0]!.period;
}

function statusPill(p: VatPeriodOverview) {
  const t = today();
  if (p.status === 'closed') return <span className="pill good">поднесена{p.row?.submittedAt ? ' ' + dmy(p.row.submittedAt.toISOString()) : ''}</span>;
  if (p.to >= t) return <span className="pill">тековен</span>;
  if (p.due < t) return <span className="pill bad">задоцнета</span>;
  return <span className="pill warn">за поднесување</span>;
}

export default async function DdvPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const { u, firm, year } = await booksPage('ddv');
  if (!firm) return <NoFirm t="ДДВ-04" />;
  if (sp.tab === 'insp') return <Inspector firm={firm} year={year} sp={sp} u={u} />;
  if (sp.tab === 'tarifi') return <TarifiView firm={firm} u={u} back={{ href: '/ddv', label: '← ДДВ-04' }} />;

  const kind = firmVatPeriodKind(firm);
  const ov = await vatYearOverview(db(), firm, year, vatSource);
  const P = ov.periods;
  const want = normalizeVatPeriod(sp.p);
  const sel = want && P.some((p) => p.period === want) ? want : defaultPeriod(P, kind, year);
  const cur = P.find((p) => p.period === sel)!;
  const closed = cur.status === 'closed';
  // Reuse the year's documents for the selected period (no second load).
  const C = await computeVatPeriod(db(), firm, sel, fixtureVatSource(ov.data), cur.row?.corrections ?? {}, ov.ctx);
  const F = cur.fields;
  const live = C.fields;
  const changedAfterFiling = closed && DDV04_FIELDS.some(([k]) => (live[k] ?? 0) !== (F[k] ?? 0));
  const chart = await effectiveChart(db(), firm.id);
  const kName = new Map(chart.map((a) => [a.code, a.name]));
  const showForm = sp.view === 'form';
  const write = canDo(u, 'write', firm.id), reopen = canDo(u, 'close', firm.id);
  const qs = (o: Partial<SP>) => '/ddv?' + new URLSearchParams(Object.entries({ p: sel, view: showForm ? 'form' : '', ...o }).filter(([, v]) => v) as [string, string][]).toString();

  let closeLines = C.close.lines.map((l) => ({ account: l.account, note: l.note ?? '', debit: l.debit, credit: l.credit }));
  let journal: { number: string; by: string | null } | null = null;
  if (closed && cur.row?.closingJournalId) {
    const [j] = await db().select({ number: journals.number, by: users.name }).from(journals).leftJoin(users, eq(users.id, journals.createdBy))
      .where(eq(journals.id, cur.row.closingJournalId)).limit(1);
    journal = j ?? null;
    const L = await db().select().from(journalLines).where(eq(journalLines.journalId, cur.row.closingJournalId)).orderBy(asc(journalLines.lineNo));
    closeLines = L.map((l) => ({ account: l.account, note: l.note ?? '', debit: Number(l.debit), credit: Number(l.credit) }));
  }
  const d31 = Math.round(C.close.diff) - ((F['31'] ?? 0) + (F['30'] ?? 0));
  const tot = (k: string) => P.filter((p) => p.kind === kind).reduce((s, p) => s + (p.fields[k] ?? 0), 0);
  const evid = ddvEvidenceRows(ov.data.docs, cur.from, cur.to, { partners: ov.data.partners });

  return (
    <>
      <Hd t="ДДВ-04" sub="даночна пријава за ДДВ">
        {firm.vatRegistered && <PeriodKind kind={kind} firmName={firm.name} write={write} action={setVatPeriodKindAction} />}
        <form className="row" style={{ gap: 4 }}>
          {showForm && <input type="hidden" name="view" value="form" />}
          <select name="p" defaultValue={sel} style={{ width: 'auto' }}>
            {P.map((p) => <option key={p.period} value={p.period}>{vatPeriodLabel(p.period)}</option>)}
          </select>
          <button className="btn sm">Отвори</button>
        </form>
        <DownloadCsv name={`DDV-04_${sel}.csv`} label="CSV ДДВ-04" rows={[['Поле', 'Опис', 'Износ (ден.)'], ...DDV04_FIELDS.map(([k, t]) => [k, t, F[k] ?? 0])]} />
        {/* Legacy `ddvCsv` 7263: the period's documents per rate group (VAT evidence). */}
        <DownloadCsv name={`DDV_evidencija_${sel}.csv`} label="Excel (CSV)" rows={evid} />
        <DownloadXlsx name={`DDV_evidencija_${sel}.xlsx`} label="Excel" sheets={[{ name: 'ДДВ евиденција', rows: evid }]} />
        <a className="btn" href={`/print/ddvKniga?p=${encodeURIComponent(sel)}`} target="_blank" rel="noreferrer">PDF книга на фактури</a>
        <Link className="btn" href={`/ddvKnigi?sel=${kind === 'month' ? sel.slice(5) : 'Q' + sel.slice(-1)}`}>Книги за ДДВ</Link>
        <Link className="btn" href={qs({ view: showForm ? '' : 'form' })}>{showForm ? 'Табела' : 'Образец'}</Link>
        <a className="btn pri" href={`/print/ddv04?p=${encodeURIComponent(sel)}`} target="_blank" rel="noreferrer">PDF образец ДДВ-04</a>
        <Link className="btn" href="/ddv?tab=insp" title="Табела по месеци за инспектор – за 1 до 5 години">📋 Табела за инспектор</Link>
        <Link className="btn" href="/ddv?tab=tarifi">Даночни тарифи</Link>
      </Hd>

      {/* FIX (LEGACY-MAP 5.4 item 11): the threshold comes from VAT_REGISTRATION_LIMIT instead of a hard-coded text. */}
      {!firm.vatRegistered && <div className="callout warn">Фирмата не е регистрирана за ДДВ. Регистрацијата е задолжителна кога годишниот промет ќе надмине {fi(VAT_REGISTRATION_LIMIT)} ден.</div>}
      {!!ov.data.ledgerJournals && <div className="callout">{vatLedgerNote(ov.data.ledgerJournals)}</div>}

      <div className="tw"><table>
        <thead><tr><th>Даночен период</th><th className="n">Излезен ДДВ (20)</th><th className="n">Претходен данок (29)</th><th className="n">За плаќање / поврат (31)</th><th>Рок за пријава</th><th>Статус</th><th /></tr></thead>
        <tbody>
          {P.map((p) => (
            <tr key={p.period} style={p.period === sel ? { background: 'var(--accent-soft)' } : undefined}>
              <td><b>{vatPeriodLabel(p.period)}</b>{p.kind !== kind && <span className="mini"> · {p.kind === 'month' ? 'месечно' : 'тримесечно'}</span>}</td>
              <td className="n">{fi(p.fields['20'])}</td><td className="n">{fi(p.fields['29'])}</td>
              <td className="n" style={{ color: (p.fields['31'] ?? 0) > 0 ? 'var(--bad)' : (p.fields['31'] ?? 0) < 0 ? 'var(--good)' : 'inherit' }}>{fi(p.fields['31'])}</td>
              <td>{dmy(p.due)}</td><td>{statusPill(p)}</td>
              <td><Link className="btn sm" href={qs({ p: p.period })}>Отвори</Link></td>
            </tr>
          ))}
        </tbody>
        <tfoot><tr><td>Вкупно {year}</td><td className="n">{fi(tot('20'))}</td><td className="n">{fi(tot('29'))}</td><td className="n">{fi(tot('31'))}</td><td colSpan={3} /></tr></tfoot>
      </table></div>

      <h2>Период {vatPeriodLabel(sel)}</h2>
      <div className="tiles">
        <div className="tile"><span>Вкупен ДДВ · поле 20</span><b>{fi(F['20'])}</b></div>
        <div className="tile"><span>Претходен данок · поле 29</span><b>{fi(F['29'])}</b></div>
        <div className="tile">
          <span>{(F['31'] ?? 0) >= 0 ? 'Долг · поле 31' : 'Побарување · поле 31'}</span>
          <b style={{ color: (F['31'] ?? 0) > 0 ? 'var(--bad)' : 'var(--good)' }}>{fi(Math.abs(F['31'] ?? 0))}</b>
          <i>период {vatPeriodLabel(sel)} · рок {dmy(cur.due)}</i>
        </div>
      </div>
      {changedAfterFiling && (
        <div className="callout warn">Документите за периодот се променети по поднесувањето: сега пресметаниот ДДВ-04 дава поле 31 = {fi(live['31'])} ден. (поднесено {fi(F['31'])}). Прикажана е поднесената пријава.</div>
      )}

      {(closeLines.length > 0 || closed) && firm.vatRegistered && (
        <div className="card">
          <div className="hd" style={{ margin: '0 0 6px', gap: 8, flexWrap: 'wrap' }}>
            <b>Затворање на ДДВ периодот (по поднесување)</b>
            <div className="row">
              {closed ? (
                <>
                  <span className="pill good">Затворен {cur.row?.submittedAt ? dmy(cur.row.submittedAt.toISOString()) : ''}{journal?.by ? ' · ' + journal.by : ''}</span>
                  {journal && <Link className="btn sm" href={`/nalozi?n=${encodeURIComponent(journal.number)}`}>Налог {journal.number}</Link>}
                  {reopen && <RowAction className="btn sm danger" label="Отвори период" action={reopenVatPeriodAction.bind(null, sel)}
                    confirm={`Периодот ${vatPeriodLabel(sel)} да се отвори? Налогот за затворање на ДДВ ќе се избрише и документите од периодот повторно ќе може да се менуваат.`} />}
                </>
              ) : write && (
                <RowAction className="btn pri" label="Потврди и книжи во налог" title="Затвори го периодот и книжи го ДДВ-04 во налог" action={closeVatPeriodAction.bind(null, sel)}
                  confirm={`Да се затвори ДДВ периодот ${vatPeriodLabel(sel)}? Ќе се книжи налог за затворање на ДДВ контата и документите од периодот ќе се заклучат.`} />
              )}
            </div>
          </div>
          <p className="note" style={{ margin: '0 0 8px' }}>
            Откако пријавата ќе се поднесе, контата на ДДВ за периодот се затвораат: Д обврски за ДДВ (230…) / П претходен ДДВ (130…), а разликата оди на <b>{schemeValue(ov.ctx, 'ddvPay')}</b> (обврска за плаќање) или <b>{schemeValue(ov.ctx, 'ddvClaim')}</b> (побарување). Налогот е со датум {dmy(cur.to)}. По затворањето, документите со ДДВ од периодот не може да се менуваат додека периодот не се отвори.
            {!closed && Math.abs(d31) > 2 && <b style={{ color: 'var(--bad)' }}> Разлика со поле 31: {fi(d31)} ден. – проверете дали сите документи се книжени на ДДВ контата од шемата.</b>}
          </p>
          {closeLines.length > 0 ? (
            <div className="tw"><table>
              <thead><tr><th>Конто</th><th>Назив</th><th>Опис</th><th className="n">Должи</th><th className="n">Побарува</th></tr></thead>
              <tbody>{closeLines.map((l, i) => (
                <tr key={i}><td>{l.account}</td><td>{kName.get(l.account) ?? ''}</td><td>{l.note}</td><td className="n">{l.debit ? fmt(l.debit) : ''}</td><td className="n">{l.credit ? fmt(l.credit) : ''}</td></tr>
              ))}</tbody>
            </table></div>
          ) : <div className="empty">Нема салдо на ДДВ контата – пријавата е затворена без налог.</div>}
        </div>
      )}
      {!closeLines.length && !closed && firm.vatRegistered && write && (
        <div className="card row" style={{ gap: 10, alignItems: 'center' }}>
          <span>Нема салдо на ДДВ контата за периодот.</span>
          <RowAction className="btn" label="Затвори период (нулта пријава)" action={closeVatPeriodAction.bind(null, sel)} confirm={`Да се затвори ДДВ периодот ${vatPeriodLabel(sel)} без налог?`} />
        </div>
      )}

      {firm.vatRegistered && (
        <CorrectionsForm key={sel + (cur.row?.updatedAt?.toISOString() ?? '')} period={sel} disabled={closed || !write}
          field30={cur.row?.corrections.field30 ?? 0} note={cur.row?.corrections.note ?? ''} amendmentNo={cur.row?.corrections.amendmentNo ?? ''} />
      )}

      {showForm ? (
        <div className="pdfwrap"><div className="pdfdoc" style={{ margin: '0 auto' }}>
          <Ddv04Form firm={firm} period={sel} fields={F} amendmentNo={cur.row?.corrections.amendmentNo} today={today()} />
        </div></div>
      ) : (
        <div className="tw"><table>
          <thead><tr><th>Поле</th><th>Опис</th><th className="n">Износ (ден.)</th></tr></thead>
          <tbody>{DDV04_FIELDS.map(([k, t]) => (
            <tr key={k} className={['20', '29', '31'].includes(k) ? 'tot' : undefined}><td className="num" style={{ textAlign: 'left' }}>{k}</td><td>{t}</td><td className="n">{fi(F[k])}</td></tr>
          ))}</tbody>
        </table></div>
      )}
      {/* FIX (LEGACY-MAP 5.4 item 5): legacy told users to move exports from field 08 to 07 by hand; exports, exempt
          sales without deduction (09) and supplies to non-residents (10) are now separated by the computation. */}
      <p className="note">Износите се во цели денари. Извозот е во поле 07, промет ослободен со право на одбивка во поле 08, без право на одбивка во поле 09. Пријавата се поднесува преку е-Даноци; печатениот образец служи за контрола и архива. Излезен ДДВ: {[18, 10, 5].map((r) => `${r}% → ${vatAccount(ov.ctx, 'out', r)}`).join(', ')}.</p>
    </>
  );
}

/* ---------------- Табела за инспектор (legacy `VIEWS.ddvTab` 16812) ---------------- */

async function Inspector({ firm, year, sp, u }: { firm: Firm; year: number; sp: SP; u: SessionUser }) {
  const y0 = new Date().getFullYear();
  const avail = [...new Set([year, ...Array.from({ length: 8 }, (_, i) => y0 - i)])].sort((a, b) => b - a);
  const YS = inspYears(sp.y, year);
  const mode = sp.mode === 'per' ? 'per' : 'month';
  const allK = DDV04_FIELDS.map(([k]) => k);
  const cols = inspCols(firm, sp.c);
  const tables = await inspTables(firm, YS, mode);
  const q = (o: { y?: number[]; c?: string[] }) => '/ddv?' + new URLSearchParams([['tab', 'insp'], ['mode', mode], ...(o.y ?? YS).map((y) => ['y', String(y)]), ...(o.c ?? cols).map((c) => ['c', c])]).toString();
  const printQs = new URLSearchParams([['mode', mode], ...YS.map((y) => ['y', String(y)]), ...cols.map((c) => ['c', c])]).toString();
  const sum = (R: { F: Record<string, number> }[], k: string) => R.reduce((s, r) => s + (r.F[k] ?? 0), 0);
  const head = ['Период', ...cols.map((k) => `${DT_SH[k] ?? k} (поле ${k})`)];
  const fileBase = `DDV_tabela_${(firm.name ?? '').replace(/[^\p{L}\p{N}]+/gu, '_')}_${YS.join('-')}`;
  return (
    <>
      <Hd t="📋 Табела за инспектор – пријавен ДДВ" sub={`${firm.name} · по месеци / даночни периоди · од ДДВ-04 во програмот`}>
        <Link className="btn" href="/ddv">← ДДВ-04</Link>
        <DownloadXlsx name={fileBase + '.xlsx'} sheets={tables.map((t) => ({ name: String(t.y), rows: [head, ...t.rows.map((r) => [r.l, ...cols.map((k) => r.F[k] ?? 0)]), ['Вкупно ' + t.y, ...cols.map((k) => sum(t.rows, k))]] }))} />
        <DownloadCsv name={fileBase + '.csv'} rows={[['Година', ...head], ...tables.flatMap((t) => t.rows.map((r) => [t.y, r.l, ...cols.map((k) => r.F[k] ?? 0)]))]} />
        <a className="btn pri" href={`/print/ddvTab?${printQs}`} target="_blank" rel="noreferrer">🖨 PDF</a>
        <Link className="btn" href="/paket" title="Табелата по месеци е во извештаите на пакетот (📦 УЈП – еден клик)">📦 Во пакет за УЈП</Link>
      </Hd>
      <form className="card">
        <div className="row" style={{ gap: '6px 14px', flexWrap: 'wrap', alignItems: 'center' }}>
          <input type="hidden" name="tab" value="insp" />
          <b style={{ fontSize: 13 }}>Години:</b>
          {avail.map((y) => <label key={y} className="chk" style={{ margin: 0 }}><input type="checkbox" name="y" value={y} defaultChecked={YS.includes(y)} /> {y}</label>)}
          <span style={{ marginLeft: 12 }}><b style={{ fontSize: 13 }}>Редови:</b>{' '}
            <label className="chk" style={{ margin: 0 }}><input type="radio" name="mode" value="month" defaultChecked={mode === 'month'} /> по месеци</label>{' '}
            <label className="chk" style={{ margin: 0 }}><input type="radio" name="mode" value="per" defaultChecked={mode === 'per'} /> по даночни периоди (како пријавени)</label>
          </span>
          <button className="btn sm pri">Прикажи</button>
          <Link className="btn sm" href={q({ y: [0, 1, 2, 3, 4].map((i) => y0 - i).sort((a, b) => a - b) })}>последни 5</Link>
        </div>
        <details style={{ marginTop: 8 }}>
          <summary className="mini"><b>Колони (полиња од ДДВ-04)</b> – {cols.length} избрани · изберете ги точно колоните што ги бара инспекторот</summary>
          <div className="row" style={{ gap: '4px 12px', flexWrap: 'wrap', marginTop: 6 }}>
            {DDV04_FIELDS.map(([k, t]) => <label key={k} className="chk" style={{ margin: 0, fontSize: 12 }} title={t}><input type="checkbox" name="c" value={k} defaultChecked={cols.includes(k)} /> {k} {DT_SH[k] ?? ''}</label>)}
          </div>
          <div className="row" style={{ gap: 6, marginTop: 6 }}>
            <Link className="btn sm" href={q({ c: DT_DEF })}>Стандардни</Link>
            <Link className="btn sm" href={q({ c: allK })}>Сите 31</Link>
            {canDo(u, 'write', firm.id) && <RowAction className="btn sm" action={saveDtColsAction.bind(null, cols)} label="💾 Запомни ги колоните за фирмата" />}
          </div>
        </details>
      </form>
      {tables.map((t) => (
        <div key={t.y} className="card tw">
          <h2 style={{ margin: '0 0 6px' }}>{t.y}</h2>
          <table className="dense" style={{ width: '100%', tableLayout: 'fixed', fontSize: 10.5 }}>
            <thead><tr><th style={{ width: '9%' }}>Период</th>{cols.map((k) => <th key={k} className="n" title={`Поле ${k}`} style={{ whiteSpace: 'normal', textTransform: 'none', letterSpacing: 0 }}>{DT_SH[k] ?? k}<br /><span style={{ fontWeight: 400 }}>поле {k}</span></th>)}</tr></thead>
            <tbody>{t.rows.map((r) => <tr key={r.l}><td>{r.l}</td>{cols.map((k) => <td key={k} className="n">{r.F[k] ? fi(r.F[k]) : ''}</td>)}</tr>)}</tbody>
            <tfoot><tr><td><b>Вкупно {t.y}</b></td>{cols.map((k) => <td key={k} className="n"><b>{fi(sum(t.rows, k))}</b></td>)}</tr></tfoot>
          </table>
        </div>
      ))}
      <p className="note">„По даночни периоди“ ги покажува пријавите како што се поднесени (затворените периоди од зачуваната пријава). „По месеци“ ги дели податоците по месец и за кварталните обврзници.</p>
    </>
  );
}


