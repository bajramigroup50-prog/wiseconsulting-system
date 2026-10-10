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
 */
import { Fragment } from 'react';
import { notFound } from 'next/navigation';
import {
  analyticsRows, balanceConfirmation, filterAnalytics, iosStatement, resultsByLocation, syntheticCard,
} from '@wise/core/finance';
import { and, eq } from 'drizzle-orm';
import { pddTypes, type PddType } from '@wise/core/finance';
import { effectiveChart, pddPayments, type Firm } from '@wise/db';
import { db } from '@/lib/db';
import { dmy, fmt } from '@/lib/fmt';
import { finLines, isDate, lineText, partnerMap, srchMatch, today } from '@/lib/finance';
import { kcData, kcState, type KcSP } from '../../../(app)/kartici/data';
import { SynTable } from '../../../(app)/kartici/tables';
import { locationNames, poRange } from '../../../(app)/poobjekti/data';
import { FirmHead, Sig } from '../../firm-head';
import { printGuard } from '../../guard';

export const metadata = { title: 'Печатење' };

type SP = KcSP & { all?: string; bal?: string; id?: string };
const VIEW: Record<string, string> = { kartici: 'kartici', sinteticka: 'kartici', potvrda: 'kartici', ios: 'analitika', analitika: 'analitika', pkartica: 'analitika', poobjekti: 'poobjekti', pdd: 'pdd' };

export default async function PrintFin({ params, searchParams }: { params: Promise<{ doc: string }>; searchParams: Promise<SP> }) {
  const { doc } = await params;
  const sp = await searchParams;
  const view = VIEW[doc];
  if (!view) notFound();
  const { firm, year } = await printGuard(view);
  switch (doc) {
    case 'kartici': return <Kartici firm={firm} year={year} sp={sp} />;
    case 'sinteticka': return <Sinteticka firm={firm} year={year} sp={sp} />;
    case 'potvrda': return <Potvrda firm={firm} year={year} sp={sp} />;
    case 'ios': case 'analitika': case 'pkartica': return <Analitika firm={firm} year={year} sp={sp} doc={doc} />;
    case 'poobjekti': return <Poobjekti firm={firm} year={year} sp={sp} />;
    case 'pdd': return <Pdd firm={firm} year={year} sp={sp} />;
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
  return (
    <div className="pdfdoc">
      {ids.length ? ids.map((pid) => {
        const p = D.P.get(pid);
        return D.cardsOf(pid).map((c) => (
          <Fragment key={pid + c.k}>
            <Pb i={n++} />
            <FirmHead firm={firm} title="Аналитичка картица за конто" sub={`${c.k} ${D.kName(c.k).toUpperCase()} · Период: од ${slash(s.from)} до ${slash(s.to)}`} />
            <div style={{ fontSize: 12, margin: '4px 0 6px' }}>Комитент &nbsp;&nbsp; <b>{(p?.code ? p.code + '-' : '') + (p?.name ?? '')}</b>{p?.edb ? ' · ЕДБ ' + p.edb : ''}
              <div style={{ fontSize: 10.5 }}>Жиро с-ка {p?.bankAccount ?? ''} · Банка {p?.bankName ?? ''}</div></div>
            <table className="kart">
              <thead>
                <tr><th rowSpan={2}>Налог<br />Број</th><th colSpan={2} style={{ textAlign: 'center' }}>Книжење</th><th colSpan={3} style={{ textAlign: 'center' }}>Износ на книжење</th><th rowSpan={2}>Документ<br />валута</th></tr>
                <tr><th>Датум</th><th>Содржина (ф-ра бр.)</th><th className="n">Должи</th><th className="n">Побарува</th><th className="n">Салдо</th></tr>
              </thead>
              <tbody>
                {c.o ? <tr><td /><td>{dmy(s.from)}</td><td>Почетно салдо</td><td className="n">{c.o > 0 ? fmt(c.o) : '.00'}</td><td className="n">{c.o < 0 ? fmt(-c.o) : '.00'}</td><td className="n">{fmt(c.o)}</td><td /></tr> : null}
                {c.rows.map((r, i) => (
                  <tr key={i}><td style={{ textAlign: 'right' }}>{r.line.number}</td><td>{dmy(r.line.date)}</td><td>{lineText(r.line).toUpperCase()}</td>
                    <td className="n">{r.line.debit ? fmt(r.line.debit) : '.00'}</td><td className="n">{r.line.credit ? fmt(r.line.credit) : '.00'}</td><td className="n">{fmt(r.s)}</td><td>{r.line.due ? dmy(r.line.due) : ''}</td></tr>
                ))}
              </tbody>
              <tfoot><tr><td colSpan={3} style={{ textAlign: 'right' }}>Вкупно :</td><td className="n">{fmt(c.td + (c.o > 0 ? c.o : 0))}</td><td className="n">{fmt(c.tp + (c.o < 0 ? -c.o : 0))}</td><td className="n">{fmt(c.end)}</td><td /></tr></tfoot>
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
  const pid = sp.pid && /^[0-9a-f-]{36}$/i.test(sp.pid) ? sp.pid : '';
  const P = await partnerMap(firm.id);
  const p = P.get(pid);
  if (!p) notFound();
  const to = isDate(sp.to) ? sp.to : today();
  const lines = await finLines(firm.id, `${year}-01-01`, to, { partnerId: pid });
  const R = balanceConfirmation(lines, pid, to);
  const dl = new Date(Date.now() + 8 * 864e5).toISOString().slice(0, 10);
  const bx: React.CSSProperties = { border: '1px solid #000', padding: '2px 6px' };
  const two = (lbl: string, L: (string | null | undefined)[]) => (
    <tr><td style={{ width: '22mm', fontWeight: 700, verticalAlign: 'top', paddingTop: 3, border: 0 }}>{lbl}</td>
      <td style={{ border: 0 }}><table style={{ borderCollapse: 'collapse', width: '120mm', margin: 0 }}><tbody>{L.map((x, i) => <tr key={i}><td style={{ ...bx, height: '5.5mm' }}>{x ?? ''}</td></tr>)}</tbody></table></td></tr>
  );
  const s = (firm.settings ?? {}) as { signer?: string; signerRole?: string };
  return (
    <div className="pdfdoc">
      <div style={{ fontFamily: 'Arial, Helvetica, sans-serif', fontSize: '9.5pt', lineHeight: 1.4, color: '#000' }}>
        <table style={{ borderCollapse: 'collapse', marginBottom: '5mm', border: 0 }}><tbody>
          {two('Од:', [firm.name, [firm.address, firm.city].filter(Boolean).join(', '), 'ЕДБ: ' + (firm.edb ?? '') + (firm.email ? ' · ' + firm.email : '')])}
          <tr><td style={{ height: '5mm', border: 0 }} /></tr>
          {two('До:', [p.name, [p.address, p.city].filter(Boolean).join(', '), p.edb ? 'ЕДБ: ' + p.edb : ''])}
          <tr><td style={{ height: '5mm', border: 0 }} /></tr>
          <tr><td style={{ fontWeight: 700, border: 0 }}>Дата:</td><td style={{ border: 0 }}><span style={{ ...bx, display: 'inline-block', minWidth: '40mm' }}>{dmy(today())}</span></td></tr>
        </tbody></table>
        <p style={{ fontWeight: 700, textAlign: 'justify' }}>Согласно член 483, став 3 од Законот за трговските друштва и член 7, став 2 од Правилникот за начинот за вршење на попис на средствата и обврските и усогласување на сметководствената со фактичката состојба утврдена со пописот Ви го праќаме следниот извод од нашата сметководствена евиденција, според кој состојбата на сметките побарувања од Вас/обврски кон Вас е како што е прикажано подолу. Доколку состојбата е идентична како таа евидентирана кај Вас, Ве молиме за потврда на истото (потпишана скенирана потврда пратена на e-mail).</p>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '6mm 0 2mm', fontWeight: 700 }}>
          <span>ПОТВРДА ЗА СОСТОЈБА НА САЛДА НА СМЕТКИ ЕВИДЕНТИРАНИ ВО НАША СМЕТКОВОДСТВЕНА ЕВИДЕНЦИЈА НА ДЕН:</span>
          <span style={{ ...bx, minWidth: '32mm', textAlign: 'center', fontWeight: 400 }}>{dmy(to)}</span>
        </div>
        <table style={{ borderCollapse: 'collapse', width: '100%' }}>
          <thead><tr><th style={{ ...bx, width: '12mm' }} /><th style={{ ...bx, width: '14mm' }} /><th style={bx} /><th style={{ ...bx, width: '32mm', textAlign: 'left', fontWeight: 400 }}>Износ</th><th style={{ ...bx, width: '62mm', textAlign: 'left', fontWeight: 400 }}>Забелешка</th></tr></thead>
          <tbody>{R.map((r) => (
            <tr key={r.s}><td style={bx}>С-ка</td><td style={{ ...bx, textAlign: 'right' }}>{r.s}</td><td style={bx}>{r.n}</td>
              <td style={{ ...bx, textAlign: 'right' }}>{Math.abs(r.v) > 0.004 ? fmt(Math.abs(r.v)) + ' ден' + (r.v < 0 ? ' (обратно салдо)' : '') : ''}</td><td style={bx}>{Math.abs(r.v) > 0.004 ? p.name : ''}</td></tr>
          ))}</tbody>
        </table>
        <div style={{ display: 'flex', gap: '8mm', marginTop: '6mm' }}>
          <p style={{ flex: 1, margin: 0, textAlign: 'justify' }}>Доколку нашата евиденција соодветствува со Вашата Ве молиме потврдете со потпис од одговорното лице. Ве молиме потврдата да ја пратите потпишана од Ваша страна на нашата e-mail адреса <b>{firm.email || '______'}</b> најдоцна до <b>{dmy(dl)}</b>. Доколку не одговорите на потврдата во предвидениот рок ќе сметаме дека со истата во целост се согласувате со наведеното во истата.</p>
          <div style={{ width: '62mm' }}><div>Одговорил</div><div style={{ ...bx, height: '16mm' }} /></div>
        </div>
        <p style={{ marginTop: '6mm' }}>Доколку нашата евиденција не соодветствува со Вашата Ве молиме кусо наведете ги разликите и пратете ни картички за спроредување на истата e-mail адреса во истиот рок.</p>
        <div style={{ ...bx, height: '14mm' }} />
        <div className="sigrow" style={{ display: 'flex', justifyContent: 'space-between', marginTop: '10mm', gap: '10mm', breakInside: 'avoid' }}>
          <div style={{ textAlign: 'center', minWidth: '70mm' }}><b>{firm.name}</b><div style={{ height: '24mm' }} /><div style={{ borderTop: '1px solid #000' }}>{s.signerRole || 'Управител'}{s.signer ? ': ' + s.signer : ''}</div></div>
          <div style={{ textAlign: 'center', minWidth: '70mm' }}><b>{p.name}</b><div style={{ height: '24mm' }} /><div style={{ borderTop: '1px solid #000' }}>Одговорно лице · М.П.</div></div>
        </div>
      </div>
    </div>
  );
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
