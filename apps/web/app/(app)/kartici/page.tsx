/**
 * Legacy `VIEWS.kartici` 6627 (+ patches 8621, 12453 „без комитент“, 12959 усогласување, 13751 потврда на салдо) —
 * Финансово › Аналитички картици по комитент. Without a konto: `kcPicker` 6457 (konto list with turnover, group selection);
 * with kontos: partner list + the selected partner's card per konto (`kcCard`), or the synthetic card (`kcSynHTML`).
 * Sub-view `?nop=1`: lines without partner (legacy `VIEWS.kpNoP` 12447).
 */
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { and, eq, isNull, like, sql } from 'drizzle-orm';
import { openAmount, virtualAdvances } from '@wise/core';
import { syntheticCard } from '@wise/core/finance';
import { supplierWarnings } from '@wise/core/finpar-cards';
import { bankLines, effectiveChart, journalLines, loadBankEnv, matchContext, purchases } from "@wise/db";
import { booksPage, canDo } from '@/lib/books';
import { RowAction } from '@/components/row-action';
import { bkpFixAction } from '../banka/actions';
import { db } from '@/lib/db';
import { dmy, fmt } from '@/lib/fmt';
import { lineText } from '@/lib/finance';
import { aggregatedLines } from '@/lib/ledger-agg';
import { Hd } from '@/components/hd';
import { NoFirm } from '@/components/no-firm';
import { DownloadCsv } from '@/components/download-csv';
import { kcData, kcQs, kcState, type KcSP } from './data';
import { KcTable, SynTable } from './tables';

export default async function KarticiPage({ searchParams }: { searchParams: Promise<KcSP> }) {
  const sp = await searchParams;
  const { u, firm, year } = await booksPage('kartici');
  if (!firm) return <NoFirm t="Аналитички картици по комитент" />;
  const s = kcState(sp, year);
  if (!s.kontos.length) return <Picker firmId={firm.id} s={s} kq={(sp.kq ?? '').trim()} post={sp.post !== '0'} />;

  const D = await kcData(firm, year, s);
  const kl = s.kontos.map((c) => c + ' ' + D.kName(c)).join(' + ');
  const syn = sp.syn === '1' || (sp.syn !== '0' && !D.hasPartners);
  const q = (o: Record<string, string | undefined> = {}) => '/kartici?' + kcQs(s, o);
  const back = <Link className="btn" href={`/kartici?from=${s.from}&to=${s.to}${s.sort === 'nal' ? '&sort=nal' : ''}`}>← Избор на конто</Link>;

  if (syn) {
    const C = syntheticCard(D.lines, s);
    return (
      <>
        <Hd t="Синтетичка картица" sub={kl}>
          {back}
          {D.hasPartners && <Link className="btn" href={q({ syn: '0' })}>По комитенти</Link>}
          <a className="btn pri" href={`/print/fin/sinteticka?${kcQs(s)}`} target="_blank" rel="noopener">PDF</a>
        </Hd>
        <p className="note">{dmy(s.from)} – {dmy(s.to)} · сортирано по {s.sort === 'nal' ? 'налог' : 'датум'}</p>
        <div className="tw"><SynTable C={C} pname={(id) => D.P.get(id ?? '')?.name ?? ''} links /></div>
      </>
    );
  }

  const sel = s.pid ? D.P.get(s.pid) : undefined;
  const C = sel ? D.cardsOf(sel.id) : [];
  const tot = Math.round(C.reduce((a, c) => a + c.end, 0) * 100) / 100;
  const csv: (string | number)[][] = [['Комитент', 'ЕДБ', 'Конто', 'Датум', 'Налог', 'Документ', 'Валута', 'Должи', 'Побарува', 'Салдо']];
  for (const x of sel ? [{ id: sel.id }] : D.sums) {
    const p = D.P.get(x.id);
    for (const c of D.cardsOf(x.id)) {
      if (c.o) csv.push([p?.name ?? '', p?.edb ?? '', c.k, '', '', 'Почетно салдо', '', c.o > 0 ? c.o : 0, c.o < 0 ? -c.o : 0, c.o]);
      for (const r of c.rows) csv.push([p?.name ?? '', p?.edb ?? '', c.k, dmy(r.line.date), r.line.number ?? '', lineText(r.line), r.line.due ? dmy(r.line.due) : '', r.line.debit, r.line.credit, r.s]);
    }
  }
  const npAmt = Math.round(D.noPartner.reduce((a, l) => a + l.debit - l.credit, 0) * 100) / 100;
  const td = new Date().toISOString().slice(0, 10);
  // legacy wrappers 8621 (supplier warnings) and 12554 (`#kcAdv` advances without invoice) for the selected partner
  let warns: ReturnType<typeof supplierWarnings> = [];
  let adv: ReturnType<typeof virtualAdvances>['ADV'] = [];
  if (sel) {
    const ctx = await db().transaction(async (tx) => matchContext(tx, await loadBankEnv(tx, firm.id), year));
    adv = virtualAdvances({ ...ctx, rows: ctx.rows.filter((r) => String(r.date).startsWith(String(year))) }).ADV.filter((a) => a.pid === sel.id && a.paid > 0);
    const [PM, UP, B22] = await Promise.all([
      db().select({ d: purchases.date }).from(purchases).where(and(eq(purchases.firmId, firm.id), eq(purchases.partnerId, sel.id))),
      db().select({ date: bankLines.date, amount: bankLines.amount }).from(bankLines).where(and(eq(bankLines.firmId, firm.id), eq(bankLines.partnerId, sel.id), like(bankLines.konto, '22%'), isNull(bankLines.refId))),
      db().select({ s: sql<string>`coalesce(sum(${journalLines.debit} - ${journalLines.credit}), 0)` }).from(journalLines).where(and(eq(journalLines.firmId, firm.id), eq(journalLines.partnerId, sel.id), like(journalLines.account, '22%'))),
    ]);
    const openInv = ctx.purchases.filter((x) => x.partner === sel.id).reduce((a, x) => a + Math.max(0, openAmount(ctx.rows, 'purchase', x)), 0) / 100;
    warns = supplierWarnings({
      pid: sel.id, name: sel.name, today: td, year: String(year), purchaseMonths: PM.map((x) => x.d.slice(0, 7)),
      unlinkedPays: UP.map((x) => ({ date: x.date, amount: Number(x.amount) })), openInvoices: openInv, balance22: Number(B22[0]?.s ?? 0), fmt,
    });
  }
  const fixOk = canDo(u, 'nalEdit', firm.id), writeOk = canDo(u, 'write', firm.id);
  const SRC: Record<string, string> = { invoice: 'Излез', purchase: 'Влез', bank_statement: 'Извод', cash_voucher: 'Благајна', sales_daily: 'Каса', compensation: 'Компензација', opening: 'Почетна' };

  return (
    <>
      <Hd t="Аналитички картици по комитент" sub={kl}>
        {back}
        <Link className="btn" href={q({ syn: '1' })}>Синтетичка картица</Link>
        {/* legacy `kcCsv` 7298: `;` with decimal comma for Macedonian Excel */}
        <DownloadCsv name={`Analiticki_kartici_${year}.csv`} rows={csv.map((r, i) => (i ? r.map((c) => (typeof c === 'number' ? c.toFixed(2).replace('.', ',') : c)) : r))} />
        <a className="btn" href={`/print/fin/kartici?${kcQs(s, { pid: '' })}`} target="_blank" rel="noopener">PDF сите картици</a>
        <Link className="btn" href="/kartici/potvrdi" title="Потврди на салдо до сите комитенти со салдо – PDF и е-пошта">📨 Потврди на салдо – сите</Link>
        {sel && <>
          <a className="btn" href={`/print/fin/potvrda?pid=${sel.id}&to=${s.to < td ? s.to : td}`} target="_blank" rel="noopener" title="Потврда за состојба на салда (чл. 483 ЗТД)">📄 Потврда на салдо</a>
          <Link className="btn" href={`/recon?${kcQs(s)}`} title="Спореди со картицата што ја испратил комитентот">🔍 Усогласи со картица од комитент</Link>
          <a className="btn" href={`/print/fin/ios?pid=${sel.id}`} target="_blank" rel="noopener">ИОС</a>
          <a className="btn pri" href={`/print/fin/kartici?${kcQs(s)}`} target="_blank" rel="noopener">PDF картица</a>
        </>}
      </Hd>
      {D.noPartner.length > 0 && (
        <div className="callout warn" style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <span>👥 <b>{D.noPartner.length}</b> ставки на {s.kontos.join(', ')} се книжени <b>без комитент</b> (салдо {fmt(npAmt)}) – затоа не се гледаат во картицата на комитентот.</span>
          <span style={{ flex: 1 }} />
          <Link className="btn" href={q({ nop: sp.nop === '1' ? '' : '1' })}>{sp.nop === '1' ? 'Скриј ги' : 'Прикажи ги'}</Link>
          {writeOk && <RowAction className="btn pri" action={bkpFixAction} label="Поврзи ги со комитентот од изводот" confirm="Ставките од изводите на 12x / 22x без комитент да се поврзат со комитентот наведен во изводот? Комитентите што ги нема ќе се креираат." />}
        </div>
      )}
      {warns.map((w, i) => <div key={i} className={`callout ${w.lvl === 'bad' ? 'bad' : 'warn'}`} style={{ marginBottom: 8 }}>⚠ {w.txt}</div>)}
      {adv.length > 0 && (
        <div className="callout" id="kcAdv">🧾 {adv.map((a, i) => <span key={i}>{a.type === 'invoice' ? 'Примено' : 'Платено'} без поврзана фактура: <b>{fmt(a.paid / 100)}</b>{a.applied ? ` (распоредено на најстарите отворени фактури ${fmt(a.applied / 100)})` : ''}{a.left ? <> · <b>вишок без фактура {fmt(a.left / 100)}</b></> : null}<br /></span>)}
          <Link className="btn sm" href="/bkAdv">Детали</Link></div>
      )}
      {sp.nop === '1' && D.noPartner.length > 0 && (
        <div className="card">
          <p className="note" style={{ marginTop: 0 }}>Отворете го налогот и изберете комитент во колоната „Комитент“ (изводите: во „Изводи“ изберете комитент на ставката).</p>
          <div className="tw"><table className="dense">
            <thead><tr><th>Датум</th><th>Извор</th><th>Налог</th><th>Опис / назив од извод</th><th>Конто</th><th className="n">Должи</th><th className="n">Побарува</th></tr></thead>
            <tbody>{D.noPartner.map((l) => (
              <tr key={l.id}><td>{dmy(l.date)}</td><td><span className="pill">{SRC[l.sourceType ?? ''] ?? (l.kind === 'manual' ? 'Налог' : l.kind)}</span></td>
                <td>{fixOk ? <Link className="btn sm ghost" href={`/nalozi?n=${encodeURIComponent(l.number ?? '')}`}>✎ {l.number}</Link> : l.number}</td><td>{lineText(l)}</td>
                <td><b>{l.account}</b>{l.kind === 'open' && <small className="mut"> почетна</small>}</td><td className="n">{l.debit ? fmt(l.debit) : ''}</td><td className="n">{l.credit ? fmt(l.credit) : ''}</td></tr>
            ))}</tbody>
          </table></div>
        </div>
      )}
      <form className="card"><div className="row" style={{ gap: '10px 16px', alignItems: 'end' }}>
        <input type="hidden" name="k" value={s.kontos.join(',')} />
        {s.pid && <input type="hidden" name="pid" value={s.pid} />}
        <label className="mini">Сортирање <select name="sort" defaultValue={s.sort} style={{ width: 'auto' }}><option value="date">по датум</option><option value="nal">по налог</option></select></label>
        <label className="mini">Од <input name="from" type="date" defaultValue={s.from} /></label>
        <label className="mini">До <input name="to" type="date" defaultValue={s.to} /></label>
        <label className="chk" style={{ margin: 0 }}><input type="checkbox" name="open" value="1" defaultChecked={s.open} /> само со салдо</label>
        <input name="q" placeholder="🔍 Барај комитент по име, ЕДБ, шифра…" defaultValue={s.q} style={{ width: 260 }} />
        <button className="btn">Прикажи</button>
      </div></form>
      <div className="kcgrid">
        <div className="card kclist">
          <div className="tw" style={{ maxHeight: 560 }}><table>
            <thead><tr><th>Комитент</th><th className="n">Салдо</th></tr></thead>
            <tbody>{D.sums.length ? D.sums.map((x) => (
              <tr key={x.id} className={x.id === s.pid ? 'sel' : ''}>
                <td><Link href={q({ pid: x.id })}>{x.name}</Link><br /><small className="note">{x.n} ставки</small></td>
                <td className="n" style={{ color: x.s > 0.009 ? 'var(--ink)' : x.s < -0.009 ? 'var(--bad)' : 'var(--muted)' }}>{fmt(x.s)}</td>
              </tr>
            )) : <tr><td colSpan={2} className="empty">Нема комитенти со промет.</td></tr>}</tbody>
            <tfoot><tr><td>Вкупно {D.sums.length}</td><td className="n">{fmt(D.sums.reduce((a, x) => a + x.s, 0))}</td></tr></tfoot>
          </table></div>
        </div>
        <div>{sel ? (
          <div className="card">
            <div className="hd">
              <div><h2>{sel.name}</h2><p className="note" style={{ margin: '2px 0 0' }}>{[sel.edb ? 'ЕДБ ' + sel.edb : '', sel.address ?? '', dmy(s.from) + ' – ' + dmy(s.to)].filter(Boolean).join(' · ')}</p></div>
              <div style={{ textAlign: 'right' }}><span className="note">Салдо</span><br /><b className="num" style={{ fontSize: 18, color: tot < -0.009 ? 'var(--bad)' : 'var(--ink)' }}>{fmt(tot)}</b><br />
                <small className="note">{tot > 0.009 ? 'комитентот ни должи' : tot < -0.009 ? 'ние должиме' : 'затворено'}</small></div>
            </div>
            {C.length ? C.map((c) => (
              <div key={c.k}>
                <h3 className="fh">{c.k} {D.kName(c.k)}</h3>
                <div className="tw"><KcTable c={c} links /></div>
              </div>
            )) : <div className="empty">Нема ставки во периодот.</div>}
          </div>
        ) : <div className="card empty">Изберете комитент од листата лево за да ја видите неговата аналитичка картица.</div>}</div>
      </div>
    </>
  );
}

/** Legacy `kcPicker` 6457: chart accounts with turnover in the period (prefix sums), search, group selection. */
async function Picker({ firmId, s, kq, post }: { firmId: string; s: ReturnType<typeof kcState>; kq: string; post: boolean }) {
  const [lines, chart] = await Promise.all([aggregatedLines(firmId, s.from, s.to), effectiveChart(db(), firmId)]);
  const B = new Map<string, { d: number; p: number }>();
  for (const l of lines) { if (l.kind === 'close') continue; const b = B.get(l.account) ?? { d: 0, p: 0 }; b.d += l.debit; b.p += l.credit; B.set(l.account, b); }
  const BK = [...B.entries()];
  const r2 = (n: number) => Math.round(n * 100) / 100;
  let rows = chart.map((a) => {
    const pr = BK.filter(([x]) => x.startsWith(a.code));
    return { c: a.code, n: a.name, d: r2(pr.reduce((t, [, b]) => t + b.d, 0)), p: r2(pr.reduce((t, [, b]) => t + b.p, 0)) };
  });
  const codes = new Set(chart.map((a) => a.code));
  for (const [x, b] of BK) if (!codes.has(x)) rows.push({ c: x, n: '(аналитика)', d: r2(b.d), p: r2(b.p) });
  rows.sort((a, b) => (a.c < b.c ? -1 : 1));
  if (post) rows = rows.filter((r) => r.d || r.p);
  const q = kq.toLowerCase();
  if (q) rows = rows.filter((r) => r.c.startsWith(q) || r.n.toLowerCase().includes(q));
  const base = `from=${s.from}&to=${s.to}${s.sort === 'nal' ? '&sort=nal' : ''}`;
  // legacy `kcPicker` 6457: Enter on the search opens the exact konto (or the only match)
  const exact = q ? rows.find((r) => r.c === q) ?? (rows.length === 1 ? rows[0] : undefined) : undefined;
  if (exact) redirect(`/kartici?k=${exact.c}&${base}`);
  return (
    <>
      <Hd t="Избор на конто за аналитика" sub="аналитички картици" />
      <form className="card"><div className="row" style={{ gap: '10px 16px', alignItems: 'end' }}>
        <label className="mini">Период од <input name="from" type="date" defaultValue={s.from} /></label>
        <label className="mini">до <input name="to" type="date" defaultValue={s.to} /></label>
        <label className="chk" style={{ margin: 0 }}><input type="checkbox" name="post" value="1" defaultChecked={post} /> Само конта со книжење</label>
        <input type="hidden" name="post" value="0" />
        <fieldset className="fs" style={{ margin: 0, padding: '4px 10px' }}><legend>Сортирање по</legend><div className="row">
          <label className="rb"><input type="radio" name="sort" value="nal" defaultChecked={s.sort === 'nal'} /> Налог</label>
          <label className="rb"><input type="radio" name="sort" value="date" defaultChecked={s.sort !== 'nal'} /> Датум</label>
        </div></fieldset>
        <input name="kq" placeholder="Внесете конто (на пр. 2200) или назив" defaultValue={kq} style={{ width: 300 }} autoComplete="off" />
        <button className="btn">Барај</button>
      </div></form>
      <form>
        <input type="hidden" name="from" value={s.from} /><input type="hidden" name="to" value={s.to} />{s.sort === 'nal' && <input type="hidden" name="sort" value="nal" />}
        <div className="row" style={{ margin: '0 0 8px' }}><button className="btn" name="grp" value="1">Групен избор (означените)</button></div>
        <div className="tw" style={{ maxHeight: 600 }}><table>
          <thead><tr><th style={{ width: 34 }} /><th>Конто</th><th>Назив</th><th className="n">Должи</th><th className="n">Побарува</th><th className="n">Салдо</th></tr></thead>
          <tbody>{rows.length ? rows.slice(0, 400).map((r) => (
            <tr key={r.c}>
              <td><input type="checkbox" name="k" value={r.c} aria-label={`Групен избор ${r.c}`} /></td>
              <td className="num" style={{ textAlign: 'left' }}><Link href={`/kartici?k=${r.c}&${base}`}><b>{r.c}</b></Link></td>
              <td><Link href={`/kartici?k=${r.c}&${base}`}>{r.n}</Link></td>
              <td className="n">{r.d ? fmt(r.d) : ''}</td><td className="n">{r.p ? fmt(r.p) : ''}</td><td className="n">{r.d || r.p ? fmt(r.d - r.p) : ''}</td>
            </tr>
          )) : <tr><td colSpan={6} className="empty">Нема конта.</td></tr>}</tbody>
        </table></div>
      </form>
      <p className="note">Кликнете на конто за да се отворат аналитичките картици по комитент. Со ☑ изберете повеќе конта (на пр. 1200 + 1620) и „Групен избор“.</p>
    </>
  );
}
