/**
 * Print views of the finance & books screens (legacy `pdf(...)` outputs):
 * - `kartici`    — `kcPdfPart` 6444 / `ACT.kcaPdf` / `kcAllPdf` (one partner or all listed partners)
 * - `sinteticka` — `ACT.kcSynPdf` 7295
 * - `ios`        — `ACT.ios` 7302 (one partner, or `all=1` = every partner of the analytics filter, `anIosAll` 12975)
 * - `potvrda`    — `potHTML` 13745 (balance confirmation, чл. 483 ЗТД)
 * - `analitika`  — `ACT.anaPdf` 7298 (overview)
 * - `pkartica`   — `partnerCard` 6645 / `anCardPdf` / `anAllPdf`
 * - `poobjekti`  — `ACT.poObjPdf`
 * - `pdd`        — `pddPdfHTML` 8355
 * - `pozajmica`  — `lnPdf` / `lnDoc` 16708 (loan contract)
 */
import { Fragment } from 'react';
import { notFound } from 'next/navigation';
import {
  analyticsRows, balanceConfirmation, filterAnalytics, iosStatement, resultsByLocation, syntheticCard,
} from '@wise/core/finance';
import { and, eq, inArray } from 'drizzle-orm';
import { pddTypes, type PddType } from '@wise/core/finance';
import { effectiveChart, journals, loans, partners, pddPayments, purchases, type Firm } from '@wise/db';
import { LoanContract } from '../../../(app)/pozajmici/contract';
import { db } from '@/lib/db';
import { dmy, fmt } from '@/lib/fmt';
import { finLines, isDate, lineText, partnerMap, srchMatch, today } from '@/lib/finance';
import { kcData, kcState, type KcSP } from '../../../(app)/kartici/data';
import { SynTable } from '../../../(app)/kartici/tables';
import { locationNames, poRange } from '../../../(app)/poobjekti/data';
import { FirmHead, Sig } from '../../firm-head';
import { PotvrdaDoc } from '../potvrda-doc';
import { confirmationList } from '../../../(app)/kartici/potvrdi-data';
import { printGuard } from '../../guard';
import { requireUser } from '@/lib/auth';
import { viewAllowed } from '@/lib/nav';

export const metadata = { title: 'Печатење' };

type SP = KcSP & { all?: string; bal?: string; id?: string; /** potvrda: difference found by the card reconciliation (legacy `recDocHTML` opt.diff) */ diff?: string };
const VIEW: Record<string, string> = { kartici: 'kartici', sinteticka: 'kartici', potvrda: 'kartici', ios: 'kartici', analitika: 'analitika', pkartica: 'analitika', poobjekti: 'poobjekti', pdd: 'pdd', pozajmica: 'pozajmici' };

export default async function PrintFin({ params, searchParams }: { params: Promise<{ doc: string }>; searchParams: Promise<SP> }) {
  const { doc } = await params;
  const sp = await searchParams;
  let view = VIEW[doc];
  if (!view) notFound();
  // ИОС is printed from both the partner cards and the partner analytics (legacy `ios` 7302 from either screen)
  if (doc === 'ios' && !viewAllowed((await requireUser()).role, 'kartici')) view = 'analitika';
  const { firm, year } = await printGuard(view);
  switch (doc) {
    case 'kartici': return <Kartici firm={firm} year={year} sp={sp} />;
    case 'sinteticka': return <Sinteticka firm={firm} year={year} sp={sp} />;
    case 'potvrda': return <Potvrda firm={firm} year={year} sp={sp} />;
    case 'ios': case 'analitika': case 'pkartica': return <Analitika firm={firm} year={year} sp={sp} doc={doc} />;
    case 'poobjekti': return <Poobjekti firm={firm} year={year} sp={sp} />;
    case 'pdd': return <Pdd firm={firm} year={year} sp={sp} />;
    case 'pozajmica': return <Pozajmica firm={firm} year={year} sp={sp} />;
  }
  notFound();
}

type P = { firm: Firm; year: number; sp: SP };
const Pb = ({ i }: { i: number }) => (i ? <div className="pb" /> : null);
const slash = (d: string) => dmy(d).replace(/\./g, '/');

/** Legacy `kcPdfPart` 6444: one page per konto of the partner. */
async function Kartici({ firm, year, sp }: P) {
  const s = kcState(sp, year);
  if (!s.kontos.length) notFound();
  const D = await kcData(firm, year, s);
  const ids = s.pid ? [s.pid] : D.sums.map((x) => x.id);
  let n = 0;
  // legacy `kcDocInfo` 6442: statement number (Извод број) and calculation number (Калкул. број) per line
  const jids = [...new Set(D.lines.filter((l) => l.sourceType === 'bank_statement').map((l) => l.journalId).filter((x): x is string => !!x))];
  const pids = [...new Set(D.lines.filter((l) => l.sourceType === 'purchase' && l.sourceId && /^[0-9a-f-]{36}$/i.test(l.sourceId)).map((l) => l.sourceId!))];
  const [JM, PC] = await Promise.all([
    jids.length ? db().select({ id: journals.id, meta: journals.meta }).from(journals).where(inArray(journals.id, jids)) : [],
    pids.length ? db().select({ id: purchases.id, calc: purchases.calcNo, number: purchases.number }).from(purchases).where(inArray(purchases.id, pids)) : [],
  ]);
  const izv = new Map(JM.map((j) => [j.id, String(((j.meta ?? {}) as { statementNo?: string }).statementNo ?? '')]));
  const calc = new Map(PC.map((x) => [x.id, x.calc || x.number || '']));
  return (
    <div className="pdfdoc">
      {ids.length ? ids.map((pid) => {
        const p = D.P.get(pid);
        return D.cardsOf(pid).map((c) => (
          <Fragment key={pid + c.k}>
            <Pb i={n++} />
            <FirmHead firm={firm} title="" />
            {/* legacy `kcPdfPart` 6444: left block (konto, period, partner, bank) + right block (ОЕ / Група1 / Група2 / Трошок / Валута / Продавница) */}
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontFamily: 'Arial, sans-serif' }}>
              <div><div style={{ fontSize: 18 }}>Аналитичка картица за конто</div><div style={{ fontSize: 12 }}>{c.k} {D.kName(c.k).toUpperCase()}</div><div style={{ fontSize: 11 }}>Период: од {slash(s.from)} до {slash(s.to)}</div>
                <div style={{ fontSize: 12, marginTop: 10 }}>Комитент &nbsp;&nbsp; <b>{(p?.code ? p.code + '-' : '') + (p?.name ?? '')}</b>{p?.edb ? ' · ЕДБ ' + p.edb : ''}</div>
                <div style={{ fontSize: 10.5, marginTop: 8 }}>Жиро с-ка {p?.bankAccount ?? ''}<br />Банка {p?.bankName ?? ''}</div></div>
              <div style={{ fontSize: 10.5, lineHeight: 1.6, minWidth: '40mm' }}>ОЕ:<br />Група1: -<br />Група2: -<br />Трошок:<br />Валута:<br />Продавница:</div>
            </div>
            <table className="kart">
              <thead>
                <tr><th rowSpan={2}>Налог<br />Број</th><th colSpan={2} style={{ textAlign: 'center' }}>Книжење</th><th colSpan={3} style={{ textAlign: 'center' }}>Износ на книжење</th><th rowSpan={2}>Извод<br />број</th><th colSpan={2} style={{ textAlign: 'center' }}>Документ</th></tr>
                <tr><th>Датум</th><th>Содржина (ф-ра бр.)</th><th className="n">Должи</th><th className="n">Побарува</th><th className="n">Салдо</th><th>Валута</th><th>Калкул. број</th></tr>
              </thead>
              <tbody>
                {c.o ? <tr><td /><td>{dmy(s.from)}</td><td>Почетно салдо</td><td className="n">{c.o > 0 ? fmt(c.o) : '.00'}</td><td className="n">{c.o < 0 ? fmt(-c.o) : '.00'}</td><td className="n">{fmt(c.o)}</td><td /><td /><td /></tr> : null}
                {c.rows.map((r, i) => (
                  <tr key={i}><td style={{ textAlign: 'right' }}>{r.line.number}</td><td>{dmy(r.line.date)}</td><td>{lineText(r.line).toUpperCase()}</td>
                    <td className="n">{r.line.debit ? fmt(r.line.debit) : '.00'}</td><td className="n">{r.line.credit ? fmt(r.line.credit) : '.00'}</td><td className="n">{fmt(r.s)}</td>
                    <td>{r.line.sourceType === 'bank_statement' && r.line.journalId ? izv.get(r.line.journalId) : ''}</td><td>{r.line.due ? dmy(r.line.due) : ''}</td>
                    <td>{r.line.sourceType === 'purchase' && r.line.sourceId ? calc.get(r.line.sourceId) : ''}</td></tr>
                ))}
              </tbody>
              <tfoot><tr><td colSpan={3} style={{ textAlign: 'right' }}>Вкупно :</td><td className="n">{fmt(c.td + (c.o > 0 ? c.o : 0))}</td><td className="n">{fmt(c.tp + (c.o < 0 ? -c.o : 0))}</td><td className="n">{fmt(c.end)}</td><td colSpan={3} /></tr></tfoot>
            </table>
          </Fragment>
        ));
      }) : <p>Нема картици.</p>}
    </div>
  );
}

/** Legacy `ACT.kcSynPdf` 7295. */
async function Sinteticka({ firm, year, sp }: P) {
  const s = kcState(sp, year);
  if (!s.kontos.length) notFound();
  const D = await kcData(firm, year, s);
  const C = syntheticCard(D.lines, s);
  return (
    <div className="pdfdoc land">
      <style dangerouslySetInnerHTML={{ __html: '@page{size:A4 landscape}' }} />
      <FirmHead firm={firm} title="СИНТЕТИЧКА КАРТИЦА" sub={s.kontos.map((c) => c + ' ' + D.kName(c)).join(' + ') + ' · ' + dmy(s.from) + ' – ' + dmy(s.to)} />
      <SynTable C={C} pname={(id) => D.P.get(id ?? '')?.name ?? ''} />
    </div>
  );
}

/** Legacy `potHTML` 13745: balance confirmation (чл. 483 ст. 3 ЗТД, чл. 7 ст. 2 Правилник за попис). */
async function Potvrda({ firm, year, sp }: P) {
  const to = isDate(sp.to) ? sp.to : today();
  // legacy „📨 Потврди на салдо – сите“ (13834): `all=1` = every partner with a balance (or the `ids` given), one page each
  if (sp.all === '1') {
    const { list } = await confirmationList(firm.id, year, to);
    const want = new Set(String((sp as { ids?: string }).ids ?? '').split(',').filter(Boolean));
    const L = want.size ? list.filter((x) => want.has(x.pid)) : list;
    return (
      <div className="pdfdoc">
        {L.length ? L.map((x, i) => <Fragment key={x.pid}><Pb i={i} /><PotvrdaDoc firm={firm} p={x.p!} R={x.R} to={to} today={today()} /></Fragment>) : <p>Нема комитенти со салдо на 120/162/220/262.</p>}
      </div>
    );
  }
  const pid = sp.pid && /^[0-9a-f-]{36}$/i.test(sp.pid) ? sp.pid : '';
  const P = await partnerMap(firm.id);
  const p = P.get(pid);
  if (!p) notFound();
  const lines = await finLines(firm.id, `${year}-01-01`, to, { partnerId: pid });
  const R = balanceConfirmation(lines, pid, to);
  return <div className="pdfdoc"><PotvrdaDoc firm={firm} p={p} R={R} to={to} diff={Number(sp.diff) || 0} today={today()} /></div>;
}

/** Legacy analytics prints: `ios` 7302, `anaPdf` 7298, `partnerCard` 6645 (`anCardPdf` / `anAllPdf`). */
async function Analitika({ firm, year, sp, doc }: P & { doc: string }) {
  const [lines, P, chart] = await Promise.all([finLines(firm.id, `${year}-01-01`, `${year}-12-31`, { accountRe: '^(12|22)' }), partnerMap(firm.id), effectiveChart(db(), firm.id)]);
  const kName = (k: string) => chart.find((a) => a.code === k)?.name ?? '';
  let rows = filterAnalytics(analyticsRows(lines), { k: sp.k, bal: sp.bal === '1' });
  const q = (sp.q ?? '').trim();
  if (q) rows = rows.filter((r) => { const p = P.get(r.p); return srchMatch([p?.name, p?.edb, p?.code, p?.city].filter(Boolean).join(' '), q); });
  rows.sort((a, b) => (P.get(a.p)?.name ?? '').localeCompare(P.get(b.p)?.name ?? '', 'mk'));
  const pid = sp.pid && P.has(sp.pid) ? sp.pid : '';
  const pids = pid ? [pid] : [...new Set(rows.map((r) => r.p))];
  if (doc === 'analitika') {
    return (
      <div className="pdfdoc">
        <FirmHead firm={firm} title="АНАЛИТИКА НА ПАРТНЕРИ" sub={'Година ' + year} />
        <table><thead><tr><th>Партнер</th><th>ЕДБ</th><th>Конто</th><th className="n">Должи</th><th className="n">Побарува</th><th className="n">Салдо</th></tr></thead>
          <tbody>{rows.map((r) => <tr key={r.p + r.k}><td>{P.get(r.p)?.name}</td><td>{P.get(r.p)?.edb}</td><td>{r.k} {kName(r.k)}</td><td className="n">{fmt(r.d)}</td><td className="n">{fmt(r.c)}</td><td className="n">{fmt(r.d - r.c)}</td></tr>)}</tbody></table>
        <Sig />
      </div>
    );
  }
  if (!pids.length) return <div className="pdfdoc"><p>Нема картици за печатење.</p></div>;
  if (doc === 'pkartica') {
    return (
      <div className="pdfdoc">
        {pids.map((id, i) => {
          const p = P.get(id);
          const L = lines.filter((l) => l.partnerId === id);
          const ks = [...new Set(L.map((l) => l.account))].sort();
          return (
            <Fragment key={id}>
              <Pb i={i} />
              <FirmHead firm={firm} title="КАРТИЦА НА ПАРТНЕР" sub={(p?.name ?? '') + ' · ЕДБ ' + (p?.edb ?? '') + ' · ' + year} />
              {ks.map((k) => {
                let s = 0;
                const R = L.filter((l) => l.account === k);
                return (
                  <Fragment key={k}>
                    <h2>{k} {kName(k)}</h2>
                    <table><thead><tr><th>Датум</th><th>Документ</th><th className="n">Должи</th><th className="n">Побарува</th><th className="n">Салдо</th></tr></thead>
                      <tbody>{R.map((l) => { s += l.debit - l.credit; return <tr key={l.id}><td>{dmy(l.date)}</td><td>{lineText(l)}</td><td className="n">{l.debit ? fmt(l.debit) : ''}</td><td className="n">{l.credit ? fmt(l.credit) : ''}</td><td className="n">{fmt(s)}</td></tr>; })}</tbody>
                      <tfoot><tr><td colSpan={2}>Вкупно</td><td className="n">{fmt(R.reduce((a, l) => a + l.debit, 0))}</td><td className="n">{fmt(R.reduce((a, l) => a + l.credit, 0))}</td><td className="n">{fmt(s)}</td></tr></tfoot></table>
                  </Fragment>
                );
              })}
            </Fragment>
          );
        })}
      </div>
    );
  }
  // ИОС
  return (
    <div className="pdfdoc">
      {pids.map((id, i) => {
        const p = P.get(id);
        const X = iosStatement(lines, id);
        return (
          <Fragment key={id}>
            <Pb i={i} />
            <FirmHead firm={firm} title="ИЗВОД НА ОТВОРЕНИ СТАВКИ (ИОС)" sub={'Состојба на ' + dmy(today())} />
            <div className="box"><b>До:</b> {p?.name}<br />{p?.address}<br />ЕДБ: {p?.edb}</div>
            <table><thead><tr><th>Датум</th><th>Документ</th><th className="n">Должи</th><th className="n">Побарува</th></tr></thead>
              <tbody>{X.lines.map((l) => <tr key={l.id}><td>{dmy(l.date)}</td><td>{lineText(l)}</td><td className="n">{l.debit ? fmt(l.debit) : ''}</td><td className="n">{l.credit ? fmt(l.credit) : ''}</td></tr>)}</tbody>
              <tfoot><tr><td colSpan={2}>Салдо {X.saldo > 0 ? 'во наша корист' : 'во ваша корист'}</td><td className="n" colSpan={2}>{fmt(Math.abs(X.saldo))} ден.</td></tr></tfoot></table>
            <p>Ве молиме да ја потврдите состојбата во рок од 8 дена од приемот. Доколку не добиеме одговор, ќе сметаме дека состојбата е усогласена.</p>
            <Sig who={['Потврдуваме', 'Оспоруваме', 'За ' + firm.name]} />
          </Fragment>
        );
      })}
    </div>
  );
}

/** Legacy `ACT.poObjPdf`: result per location. */
async function Poobjekti({ firm, year, sp }: P) {
  const { from, to } = poRange(sp, year);
  const [lines, names] = await Promise.all([finLines(firm.id, from, to, { excludeClose: true }), locationNames(firm.id)]);
  const R = resultsByLocation(lines, [...names.keys()]);
  const T = (k: 'rev' | 'cogs' | 'exp' | 'res') => fmt(R.reduce((a, r) => a + r[k], 0));
  return (
    <div className="pdfdoc">
      <FirmHead firm={firm} title="РЕЗУЛТАТ ПО ОБЈЕКТИ" sub={`Период ${dmy(from)} – ${dmy(to)}`} />
      <table><thead><tr><th>Објект</th><th className="n">Приходи</th><th className="n">Набавна вредност на продаденото</th><th className="n">Други трошоци</th><th className="n">Резултат</th></tr></thead>
        <tbody>{R.map((r) => <tr key={r.w}><td>{r.w ? names.get(r.w) ?? '—' : 'Заеднички (без објект)'}</td><td className="n">{fmt(r.rev)}</td><td className="n">{fmt(r.cogs)}</td><td className="n">{fmt(r.exp)}</td><td className="n">{fmt(r.res)}</td></tr>)}</tbody>
        <tfoot><tr><td>Вкупно</td><td className="n">{T('rev')}</td><td className="n">{T('cogs')}</td><td className="n">{T('exp')}</td><td className="n">{T('res')}</td></tr></tfoot></table>
      <Sig />
    </div>
  );
}

/** Legacy `pddPdfHTML` 8355: ПДД payment calculation, landscape. */
async function Pdd({ firm, sp }: P) {
  if (!sp.id || !/^[0-9a-f-]{36}$/i.test(sp.id)) notFound();
  const [d] = await db().select().from(pddPayments).where(and(eq(pddPayments.id, sp.id), eq(pddPayments.firmId, firm.id))).limit(1);
  if (!d) notFound();
  const T = pddTypes(((firm.settings ?? {}) as { pddTypes?: Partial<PddType>[] }).pddTypes);
  const tOf = (id: string) => T.find((t) => t.id === id) ?? T[0]!;
  return (
    <div className="pdfdoc land">
      <style dangerouslySetInnerHTML={{ __html: '@page{size:A4 landscape}' }} />
      <FirmHead firm={firm} title="ПРЕСМЕТКА – ЗАКУПНИНА / БОНУСИ / УСЛУГИ" sub={'Датум на исплата ' + dmy(d.date)} />
      <p>Исплатувач: <b>{firm.name}</b> · ЕДБ {firm.edb}{d.note ? ' · ' + d.note : ''}</p>
      <table><thead><tr><th>ЕМБГ</th><th>Име и презиме</th><th>Трансакциска сметка</th><th>Вид / подвид приход</th><th className="n">Бруто</th><th className="n">Одбитоци</th><th className="n">ПДД</th><th className="n">Нето</th></tr></thead>
        <tbody>{d.rows.map((r, i) => <tr key={i}><td>{r.embg}</td><td>{r.name.toUpperCase()}</td><td>{r.acct}</td><td style={{ fontSize: '8pt' }}>{tOf(r.tid).vid}<br />{tOf(r.tid).pod}</td>
          <td className="n">{fmt(r.G)}</td><td className="n">{fmt(r.ded)}</td><td className="n">{fmt(r.tax)}</td><td className="n">{fmt(r.net)}</td></tr>)}</tbody>
        <tfoot><tr><td colSpan={4}>Вкупно</td><td className="n">{fmt(Number(d.gross))}</td><td className="n">{fmt(Number(d.deductions))}</td><td className="n">{fmt(Number(d.tax))}</td><td className="n">{fmt(Number(d.net))}</td></tr></tfoot></table>
      <Sig />
    </div>
  );
}

/** Legacy `ACT.lnPdf`: the loan contract. */
async function Pozajmica({ firm, sp }: P) {
  if (!sp.id || !/^[0-9a-f-]{36}$/i.test(sp.id)) notFound();
  const [l] = await db().select().from(loans).where(and(eq(loans.id, sp.id), eq(loans.firmId, firm.id))).limit(1);
  if (!l) notFound();
  const [p] = l.partnerId ? await db().select().from(partners).where(eq(partners.id, l.partnerId)).limit(1) : [];
  return <div className="pdfdoc"><LoanContract l={l} firm={firm} partner={p} /></div>;
}
