/**
 * Legacy `VIEWS.banka` 4711 → … → 13319 (16 wrappers) and `VIEWS.devizni` 4888 — Финансово › Изводи / Девизни
 * изводи: bank accounts, statement import, matching rules, auto-match review, statements with header (number,
 * bank balance vs book balance, control totals, FX rate), lines with their booking, manual linking.
 */
import Link from 'next/link';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { BKPK_RE, bankEffKonto, feeFix, BANKS_MK, bankCodeOf, openDocsFor, unlinkedPayments } from '@wise/core';
import { sameRefKey, transitOpen, transitResidueLabel } from '@wise/core/bank/parity';
import {
  bankLines, bankPartnerFixPlan, bankRules, bankStatements, effectiveChart, fxStatementBalance, journalLines, journals, lineFxDifference, lineOpenDocs, lineProblem,
  loadBankAccounts, loadBankEnv, matchContext, posBalance, proposeMatches, statementGapsFor, statementNoSuggestions, toBankRow, transitResidues, type BankLine, type BankStatement,
} from '@wise/db';
import { booksPage, canDo, partnerOptions } from '@/lib/books';
import { AUTO_LBL } from '@/lib/bank';
import { db } from '@/lib/db';
import { dmy, fmt } from '@/lib/fmt';
import { BankForm } from '@/components/bank-form';
import { Hd } from '@/components/hd';
import { NoFirm } from '@/components/no-firm';
import { RowAction } from '@/components/row-action';
import {
  addManualLineAction, addRuleAction, applyMatchesAction, bkpFixAction, saveAutoNotifyAction, closeTransitAction, deleteLineAction, deleteStatementAction, feeFixAction, izvFillAction, posFeeAction,
  flipLineAction, linkLineAction, numberStatementsAction, removeBankAccountAction, removeRuleAction, saveBankAccountAction,
  setKontoAction, setPartnerAction, undoImportAction, unlinkLineAction, updateStatementAction,
} from './actions';
import { ImportBox } from './import-box';
import { ClassifyButton } from './classify-button';
import type { PnLast } from './paynotes';
import { applyBankClassifyAction } from './classify-actions';
import { bankClassifyProposals } from './classify';

export type BankSP = { banks?: string; review?: string; line?: string; m?: string; open?: string; acct?: string; manual?: string; ai?: string };

const CURS = ['MKD', 'EUR', 'USD', 'CHF', 'GBP'];
const n2 = (v: string | null | undefined) => (v == null ? '' : String(Number(v)));

export async function BankView({ fx, sp }: { fx: boolean; sp: BankSP }) {
  const view = fx ? 'devizni' : 'banka';
  const base = '/' + view;
  const T = fx ? 'Девизни изводи' : 'Изводи';
  const { u, firm, year } = await booksPage(view);
  if (!firm) return <NoFirm t={T} />;
  const write = canDo(u, 'write', firm.id), del = canDo(u, 'del', firm.id);
  const all = await loadBankAccounts(db(), firm.id);
  const BK = all.filter((a) => (a.cur !== 'MKD') === fx);
  const acct = BK.find((a) => a.id === sp.acct) ?? BK[0];
  const month = /^(0[1-9]|1[0-2])$/.test(sp.m ?? '') ? sp.m! : '';
  const onlyOpen = sp.open === '1';
  const [from, to] = month ? [`${year}-${month}-01`, `${year}-${month}-31`] : [`${year}-01-01`, `${year}-12-31`];
  const q = (o: Partial<BankSP>) => {
    const p = new URLSearchParams();
    const m = { m: month || undefined, open: onlyOpen ? '1' : undefined, acct: sp.acct, ...o };
    for (const [k, v] of Object.entries(m)) if (v) p.set(k, String(v));
    const s = p.toString();
    return base + (s ? '?' + s : '');
  };

  const ids = BK.map((a) => a.id);
  const S: BankStatement[] = ids.length
    ? await db().select().from(bankStatements).where(and(eq(bankStatements.firmId, firm.id), inArray(bankStatements.bankAccountId, ids), sql`${bankStatements.date} between ${from} and ${to}`))
      .orderBy(desc(bankStatements.date), asc(bankStatements.bankAccountId))
    : [];
  const L: BankLine[] = S.length ? await db().select().from(bankLines).where(inArray(bankLines.statementId, S.map((s) => s.id))).orderBy(asc(bankLines.lineNo)) : [];
  const [chart, P, R, J, gaps, trans, bal] = await Promise.all([
    effectiveChart(db(), firm.id),
    partnerOptions(firm.id),
    db().select().from(bankRules).where(eq(bankRules.firmId, firm.id)).orderBy(asc(bankRules.kind), asc(bankRules.match)),
    S.length ? db().select({ id: journals.sourceId, number: journals.number }).from(journals)
      .where(and(eq(journals.firmId, firm.id), eq(journals.sourceType, 'bank_statement'), inArray(journals.sourceId, S.map((s) => s.id)))) : Promise.resolve([]),
    statementGapsFor(db(), firm.id, year),
    transitResidues(db(), firm.id, year),
    BK.length ? db().select({
      account: journalLines.account, date: journals.date,
      s: sql<string>`sum(${journalLines.debit} - ${journalLines.credit})`,
      c: sql<string>`sum(case when ${journalLines.debit} <> 0 then coalesce(${journalLines.amountCur}, 0) else -coalesce(${journalLines.amountCur}, 0) end)`,
    }).from(journalLines).innerJoin(journals, eq(journals.id, journalLines.journalId))
      .where(and(eq(journalLines.firmId, firm.id), inArray(journalLines.account, [...new Set(BK.map((a) => a.konto))]), sql`${journals.date} between ${year + '-01-01'} and ${year + '-12-31'}`))
      .groupBy(journalLines.account, journals.date) : Promise.resolve([]),
  ]);
  const kName = (k: string | null | undefined) => chart.find((a) => a.code === k)?.name ?? '';
  /* finance parity: legacy wrappers 12401 (izvFill), 12443 (bkpFix), 12522 (unlinked), 12764 (trOpen), 13082 (POS box), 12652 (FX balance) */
  const [env, sugg, bkp, pos] = await Promise.all([
    db().transaction((tx) => loadBankEnv(tx, firm.id)),
    db().transaction((tx) => statementNoSuggestions(tx, firm.id, year)),
    write ? db().transaction((tx) => bankPartnerFixPlan(tx, firm.id, year)) : Promise.resolve([]),
    fx ? Promise.resolve(null) : db().transaction((tx) => posBalance(tx, firm.id, year)),
  ]);
  const ctx = await db().transaction((tx) => matchContext(tx, env, year));
  const unl = unlinkedPayments({ rows: ctx.rows.filter((r) => BK.some((b) => b.id === r.acct)), accounts: env.accounts, year });
  const unlIds = new Set(unl.map((r) => r.id));
  const TL = await db().select({ k: journalLines.account, date: journals.date, d: journalLines.debit, p: journalLines.credit }).from(journalLines).innerJoin(journals, eq(journals.id, journalLines.journalId))
    .where(and(eq(journalLines.firmId, firm.id), inArray(journalLines.account, [env.konta.transitFx, env.konta.transit]), sql`${journals.date} between ${year + '-01-01'} and ${year + '-12-31'}`));
  const trOpen = transitOpen(TL.map((l) => ({ k: l.k, date: l.date, d: Math.round(Number(l.d) * 100), p: Math.round(Number(l.p) * 100) })), env.konta);
  const fxBal = new Map<string, number | null>();
  if (fx) for (const s0 of S) if (s0.closing != null) fxBal.set(s0.id, await db().transaction((tx) => fxStatementBalance(tx, s0.bankAccountId, s0.date)));
  const bankK = new Set(all.map((a) => a.konto));
  const manualDocs = sp.manual && write ? [
    ...openDocsFor({ id: 'm', acct: acct?.id ?? '', date: `${year}-12-31`, amount: 1, desc: '' }, ctx).O.map((z) => ({ v: `inv|${z.x.id}`, t: `Наша фактура ${z.x.number ?? ''} · ${pNameOf(z.x.partner)} · ${fmt(z.o / 100)}`, o: z.o, n: z.x.number ?? '', p: z.x.partner ?? '' })),
    ...openDocsFor({ id: 'm', acct: acct?.id ?? '', date: `${year}-12-31`, amount: -1, desc: '' }, ctx).O.map((z) => ({ v: `pur|${z.x.id}`, t: `Влезна ф-ра ${z.x.number ?? ''} · ${pNameOf(z.x.partner)} · ${fmt(z.o / 100)}`, o: z.o, n: z.x.number ?? '', p: z.x.partner ?? '' })),
  ] : [];
  function pNameOf(id?: string | null) { return P.find((p) => p.id === id)?.name ?? ''; }
  const pName = new Map(P.map((p) => [p.id, p.name]));
  const nalog = new Map(J.map((j) => [j.id!, j.number]));
  const bookBal = (konto: string, date: string, cur: boolean) =>
    bal.filter((b) => b.account === konto && b.date <= date).reduce((s, b) => s + Number(cur ? b.c : b.s), 0);
  const byStatement = new Map<string, BankLine[]>();
  for (const l of L) (byStatement.get(l.statementId) ?? byStatement.set(l.statementId, []).get(l.statementId)!).push(l);
  const acctOf = new Map(all.map((a) => [a.id, a]));
  // legacy 12407: the count is over the whole year (the action fixes the whole year)
  const fees = write ? feeFix(ctx.rows.filter((r) => BK.some((b) => b.id === r.acct)), year).length : 0;
  const unnumbered = S.some((s) => !s.number);
  const nOpen = L.filter((l) => lineProblem(l, fx)).length;

  /* ---------- review & line editor ---------- */
  const review = sp.review !== undefined && write ? await db().transaction((tx) => proposeMatches(tx, firm.id, year, { fx })) : null;
  const aiProps = review && sp.ai ? await bankClassifyProposals(firm.id, year, sp.ai) : null;
  const lineById = new Map(L.map((l) => [l.id, l]));
  const edLine = sp.line ? L.find((l) => l.id === sp.line) ?? (await db().select().from(bankLines).where(and(eq(bankLines.id, sp.line), eq(bankLines.firmId, firm.id))).limit(1))[0] : undefined;
  const edDocs = edLine && write ? await db().transaction((tx) => lineOpenDocs(tx, firm.id, year, edLine.id)) : null;
  // legacy `bkSameRef` 12691: other lines with the same reference (≥ 6 digits) that already have a partner
  const refKey = edLine ? sameRefKey({ bref: edLine.bref ?? '', desc: edLine.description }) : '';
  const sameRef = refKey ? (await db().select().from(bankLines).where(and(eq(bankLines.firmId, firm.id), sql`${bankLines.id} <> ${edLine!.id}`, sql`${bankLines.partnerId} is not null`,
    sql`(coalesce(${bankLines.bref}, '') || ' ' || ${bankLines.description} || ' ' || coalesce(${bankLines.counterAccount}, '')) like ${'%' + refKey + '%'}`)).limit(10)) : [];

  const partnerSelect = (name: string, value?: string | null) => (
    <select name={name} defaultValue={value ?? ''} style={{ maxWidth: 260 }}>
      <option value="">— без комитент —</option>
      {P.map((p) => <option key={p.id} value={p.id}>{p.code ? p.code + ' · ' : ''}{p.name}</option>)}
    </select>
  );

  return (
    <>
      <Hd t={T} sub={fx ? 'EUR, USD, CHF… по курс на НБРСМ' : 'денарски сметки · автоматско книжење'}>
        {write && unnumbered && <RowAction className="btn" action={numberStatementsAction} label="Нумерирај изводи" />}
        {write && <Link className="btn pri" href={q({ review: '1' })}>Прокнижи автоматски</Link>}
        {write && <Link className="btn" href={q({ manual: sp.manual ? undefined : '1' })}>✍️ Рачна ставка</Link>}
        <Link className="btn" href={q({ banks: sp.banks ? undefined : '1' })}>Банкарски сметки…</Link>
        <Link className="btn" href="/bankFmt" title="Кој формат на извод е најдобар за секоја банка">🔎 Формати по банка</Link>
        <Link className="btn" href="/bkAdv">Извештај: плаќања без фактура</Link>
      </Hd>
      <datalist id="bkK">{chart.map((a) => <option key={a.code} value={a.code}>{a.name}</option>)}</datalist>
      {/* line kontos: the bank kontos themselves are not offered (legacy `kontoOpts(…, k => !bankKontos().includes(k))`) */}
      <datalist id="bkK2">{chart.filter((a) => !bankK.has(a.code)).map((a) => <option key={a.code} value={a.code}>{a.name}</option>)}</datalist>
      {write && sugg.size > 0 && (
        <div className="callout warn" style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <span>📄 <b>{sugg.size}</b> изводи немаат број (банката не го дала во датотеката). Предлогот е по редослед – претходниот број + 1.</span><span style={{ flex: 1 }} />
          <RowAction className="btn pri" action={izvFillAction} label="✓ Пополни ги броевите" confirm={`Да се пополнат ${sugg.size} празни броеви на изводи по редослед (претходен број + 1, по сметка и година)? Проверете ги со изводите од банката.`} />
        </div>
      )}
      {write && bkp.length > 0 && (
        <div className="callout warn" style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <span>👥 <b>{bkp.length}</b> ставки на 1200/2200 немаат комитент (или имаат погрешен) – без комитент нема аналитичка картица и изводот не се книжи: {[...new Set(bkp.map((x) => x.name))].slice(0, 6).join(', ')}{bkp.length > 6 ? '…' : ''}</span><span style={{ flex: 1 }} />
          <RowAction className="btn pri" action={bkpFixAction} label="Поврзи ги со комитентот од изводот" confirm={`Да се поврзат ${bkp.length} ставки со комитентите од изводот? Комитентите што ги нема ќе се креираат: ${[...new Set(bkp.filter((x) => !x.partner).map((x) => x.name))].slice(0, 15).join(', ') || '—'}`} />
        </div>
      )}
      {unl.length > 0 && (
        <div className="callout" style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <span>🧾 <b>{unl.length}</b> плаќања на купувачи / добавувачи не се поврзани со фактура (аванси или фактура што недостасува).</span><span style={{ flex: 1 }} />
          <Link className="btn" href="/bkAdv">Прикажи и затвори рачно</Link>
        </div>
      )}
      {trOpen.length > 0 && (
        <div className="callout warn">🔁 <b>Пренос меѓу сопствени сметки без другата страна</b>: {trOpen.map((t) => <span key={t.k + t.date}>{t.k} на {dmy(t.date)}: {fmt(t.r / 100)} ({t.r > 0 ? 'излезено, не е примено' : 'примено, не е испратено'}) · </span>)} Увезете го изводот од другата сметка.</div>
      )}
      {pos && pos.state !== 'none' && pos.state !== 'closed' && (
        <div className="callout" id="posBox">
          💳 <b>Плаќања со картички (POS, конто {pos.k})</b>: продажба со картички {fmt(pos.d / 100)} · примено од банка {fmt(pos.p / 100)} · отворено <b>{fmt(pos.s / 100)}</b>{pos.d ? ` (${Math.round((pos.p / pos.d) * 100)}%)` : ''}.
          {pos.state === 'fee' && <> Разликата е најчесто провизијата на банката.{write && (
            <BankForm action={posFeeAction} className="row" style={{ gap: 6, marginTop: 6 }}>
              <input name="amount" inputMode="decimal" defaultValue={(pos.s / 100).toFixed(2)} style={{ width: 120, textAlign: 'right' }} aria-label="Износ на провизијата" />
              <input type="date" name="date" defaultValue={pos.last || `${year}-12-31`} />
              <button className="btn sm pri">Книжи провизија 4460</button>
            </BankForm>
          )}</>}
          {pos.state === 'waiting' && ' Банката сè уште не ги уплатила.'}
          {pos.state === 'over' && ' Примено е повеќе отколку продадено – проверете ги фискалните извештаи.'}
        </div>
      )}

      {!BK.length && (
        <div className="callout">{fx
          ? 'Сè уште нема девизна сметка. Додадете ја: назив (на пр. Комерцијална EUR), девизна сметка / IBAN, валута и конто (на пр. 1030). Потоа увезете го изводот (најдобро XML или MT940).'
          : 'Сè уште нема банкарска сметка. Додадете ја: назив на банката, жиро сметка (15 цифри) и конто (на пр. 1000 или аналитика 100005).'}</div>
      )}

      {write && BK.length > 0 && !fx && (() => {
        // legacy `pnCard` 13319: payment confirmations to customers + summary for the office
        const st = (firm.settings ?? {}) as { autoNotify?: { pay?: boolean; sum?: boolean; to?: string }; pnLast?: PnLast };
        const cfg = { pay: st.autoNotify?.pay !== false, sum: st.autoNotify?.sum !== false, to: st.autoNotify?.to ?? '' };
        const Lt = st.pnLast;
        return (
          <div className="card" id="pnCard" style={{ padding: '8px 12px' }}>
            <BankForm action={saveAutoNotifyAction} className="row" style={{ gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
              <b>🔔 Автоматски известувања по изводот</b>
              <label className="chk"><input type="checkbox" name="pay" defaultChecked={cfg.pay} /> потврда за уплата до купувачот (е-пошта)</label>
              <label className="chk"><input type="checkbox" name="sum" defaultChecked={cfg.sum} /> преглед за мене на</label>
              <input name="to" type="email" defaultValue={cfg.to} placeholder="moja@posta.mk" style={{ width: 220 }} />
              <button className="btn sm">Зачувај</button>
            </BankForm>
            {Lt && <details style={{ marginTop: 6 }}><summary className="mini" style={{ cursor: 'pointer' }}>Последно: {dmy(Lt.at)} {Lt.at.slice(11, 16)} · {Lt.n} уплати · {fmt(Lt.tot / 100)} ден. · {Lt.sent} потврди{Lt.mailed ? ' · преглед на ' + Lt.mailed : ''}</summary><pre style={{ whiteSpace: 'pre-wrap', fontSize: 12, margin: '6px 0 0' }}>{Lt.txt}</pre></details>}
          </div>
        );
      })()}

      {(sp.banks || !BK.length) && (
        <div className="card">
          <h2>Банкарски сметки</h2>
          <div className="tw"><table className="dense">
            <thead><tr><th>Банка</th><th>Жиро / девизна сметка</th><th>IBAN</th><th>Валута</th><th>Конто</th><th>Налог</th><th></th></tr></thead>
            <tbody>{BK.map((x) => (
              <tr key={x.id}><td colSpan={7}>
                <BankForm action={saveBankAccountAction} className="row" style={{ gap: 6, flexWrap: 'nowrap' }}>
                  <input type="hidden" name="id" value={x.id} />
                  <input name="name" defaultValue={x.name} style={{ width: 180 }} disabled={!write} />
                  <input name="account" defaultValue={x.account ?? ''} style={{ width: 170 }} disabled={!write} title={BANKS_MK[bankCodeOf(x.account)]?.n} />
                  <input name="iban" defaultValue={x.iban ?? ''} style={{ width: 200 }} disabled={!write} />
                  <select name="cur" defaultValue={x.cur} disabled={!write}>{CURS.filter((c) => (c !== 'MKD') === fx).map((c) => <option key={c}>{c}</option>)}</select>
                  <input name="konto" defaultValue={x.konto} list="bkK" style={{ width: 100 }} disabled={!write} title={kName(x.konto)} />
                  <input name="nal" defaultValue={x.nal ?? ''} placeholder={fx ? '7' : '6'} style={{ width: 60 }} disabled={!write} title="Шифра на налогот (празно = 6/66… или 7/77…)" />
                  {write && <button className="btn sm">Зачувај</button>}
                  {write && <RowAction action={removeBankAccountAction.bind(null, x.id)} label="✕" confirm={`Да се отстрани сметката „${x.name}“?`} className="btn sm ghost danger" />}
                </BankForm>
              </td></tr>
            ))}</tbody>
          </table></div>
          {write && (
            <BankForm action={saveBankAccountAction} className="row" style={{ gap: 6 }}>
              <input name="name" placeholder="Банка, на пр. Халкбанк" style={{ maxWidth: 200 }} required />
              <input name="account" placeholder="Жиро сметка" style={{ maxWidth: 190 }} />
              <input name="iban" placeholder="IBAN (девизна)" style={{ maxWidth: 200 }} />
              <select name="cur" defaultValue={fx ? 'EUR' : 'MKD'}>{CURS.filter((c) => (c !== 'MKD') === fx).map((c) => <option key={c}>{c}</option>)}</select>
              <input name="konto" list="bkK" placeholder={fx ? 'Конто, на пр. 1030' : 'Конто, на пр. 100005'} style={{ maxWidth: 160 }} required />
              <button className="btn">Додај сметка</button>
            </BankForm>
          )}
          <p className="note">За девизна сметка изберете валута (EUR, USD…) и посебно конто. Износите се внесуваат во валута, а во денари се пресметуваат по курсот на изводот; разликата при плаќање на фактура оди на курсни разлики (4810 / 7810). Секоја банка има свое аналитичко конто. Сметка со изводи не може да се отстрани.</p>
        </div>
      )}

      {gaps.length > 0 && (
        <div className="callout warn"><b>Недостасува извод?</b> {gaps.filter((g) => BK.some((b) => b.id === g.accountId)).map((g) => (
          <div key={g.accountId + g.to.d}>{g.accountName}: салдо {fmt(g.from.c / 100)} по изводот {g.from.no ?? ''} од {dmy(g.from.d)} ≠ почетно салдо {fmt(g.to.o / 100)} на изводот {g.to.no ?? ''} од {dmy(g.to.d)} (разлика {fmt(g.diff)})</div>
        ))}</div>
      )}
      {trans.length > 0 && (
        <div className="callout warn"><b>Остаток на преодна сметка</b> (откуп / пренос меѓу свои сметки): {trans.map((t) => (
          <span key={t.konto + t.date} className="row" style={{ gap: 6, display: 'inline-flex' }}>{t.konto} на {dmy(t.date)}: {fmt(t.residue)} → {transitResidueLabel(t.residue)}
            {write && <RowAction className="btn sm" action={closeTransitAction.bind(null, t.konto, t.date)} label="Книжи курсна разлика" />}</span>
        ))}</div>
      )}
      {fees > 0 && (
        <div className="callout warn">{fees} банкарски провизии се книжени на 2200/4400 без фактура. <RowAction className="btn sm" action={feeFixAction} label="Прекнижи на 4460" confirm={`${fees} банкарски надомести се прокнижени на 2200/4400 без документ. Да се префрлат на 4460 Банкарски услуги?`} /></div>
      )}

      {review && (
        <div className="card" style={{ borderColor: 'var(--accent)' }}>
          <div className="hd"><h2>Автоматско книжење – преглед ({review.length})</h2><Link className="btn" href={q({})}>Затвори</Link></div>
          {review.length ? (
            <BankForm action={applyMatchesAction}>
              <div className="tw"><table className="dense">
                <thead><tr><th></th><th>Датум</th><th>Опис</th><th className="n">Износ</th><th>Предлог</th><th>Комитент</th></tr></thead>
                <tbody>{review.map((p) => (
                  <tr key={p.lineId}>
                    <td><input type="checkbox" name="accept" value={p.lineId} defaultChecked aria-label="Прифати" /></td>
                    <td>{dmy(p.date)}</td><td style={{ minWidth: 220 }}>{p.desc}</td><td className="n">{fmt(p.amount)}</td>
                    <td><span className="pill info">{AUTO_LBL[p.how] ?? p.how}</span> {p.refLabel ? <span className="pill good">{p.amount > 0 ? 'Наша фактура' : 'Влезна ф-ра'} {p.refLabel}</span> : <>{p.konto} {kName(p.konto)}</>}
                      {p.refs && <small className="note"> · {p.refs.map((r) => `${r.label}: ${fmt(r.amt)}`).join(', ')}</small>}
                      {p.excess ? <small className="note"> · аванс {fmt(p.excess)}</small> : null}</td>
                    <td>{p.partnerId ? pName.get(p.partnerId) : p.newPartner ? <label className="chk"><input type="checkbox" name="mkp" value={p.lineId} /> нов: {p.newPartner}</label> : p.pos ? 'POS терминал' : ''}</td>
                  </tr>
                ))}</tbody>
              </table></div>
              <div className="row"><span className="note">Редослед: POS картички, ДДВ, шифра на плаќање, девизни фактури, фактури по број / износ / збир, провизии, правила. Отштиклирајте ги погрешните.</span><span style={{ flex: 1 }} /><button className="btn pri">Прокнижи избраните</button></div>
            </BankForm>
          ) : <p className="note">Нема ставки за автоматско книжење – останатите прокнижете ги рачно (копче „Прокнижи…“).</p>}
          <div style={{ marginTop: 10, borderTop: '1px solid var(--line)', paddingTop: 8 }}>
            {aiProps ? (aiProps.length ? (
              <BankForm action={applyBankClassifyAction}>
                <input type="hidden" name="ai" value={sp.ai} />
                <h3 style={{ margin: '0 0 6px' }}>🤖 Препознаени ставки ({aiProps.length}) – проверете ги</h3>
                <div className="tw"><table className="dense">
                  <thead><tr><th></th><th>Датум</th><th>Опис</th><th className="n">Износ</th><th>Предлог</th><th>Причина</th></tr></thead>
                  <tbody>{aiProps.map((p) => { const l = lineById.get(p.id); return (
                    <tr key={p.id}>
                      <td><input type="checkbox" name="accept" value={p.id} defaultChecked aria-label="Прифати" /></td>
                      <td>{l ? dmy(l.date) : ''}</td><td style={{ minWidth: 220 }}>{l?.description ?? ''}</td><td className="n">{l ? fmt(Number(l.amount)) : ''}</td>
                      <td>{p.ref ? <span className="pill good">{p.ref.type === 'invoice' ? 'Наша фактура' : 'Влезна ф-ра'}</span> : <span className="pill info">{p.konto} {kName(p.konto)}</span>}</td>
                      <td><small>{p.reason}</small></td>
                    </tr>); })}</tbody>
                </table></div>
                <div className="row"><span className="note">Ставките ќе бидат означени „препознаено – провери“.</span><span style={{ flex: 1 }} /><button className="btn pri">Прокнижи ги избраните</button></div>
              </BankForm>
            ) : <p className="note">Ставките не се препознаени; изберете рачно.</p>) : (
              <div className="row" style={{ gap: 8, alignItems: 'center' }}><ClassifyButton base={base} /><span className="note">Ставките што ниту едно правило не ги препознало се препознаваат автоматски (фактура или конто, со причина).</span></div>
            )}
          </div>
        </div>
      )}

      {edLine && (
        <div className="card" style={{ borderColor: 'var(--accent)' }}>
          <div className="hd"><h2>Ставка од {dmy(edLine.date)} · {fmt(Number(edLine.amount))} ден.{edLine.amountCur != null ? ` (${edLine.cur} ${fmt(Number(edLine.amountCur))})` : ''}</h2>
            <Link className="btn" href={q({})}>Затвори</Link></div>
          <p>{edLine.description}{edLine.osnov ? <> · шифра <b>{edLine.osnov}</b></> : null}{edLine.counterAccount ? <> · сметка {edLine.counterAccount}</> : null}</p>
          {write && edDocs && (
            <div className="cols">
              <div>
                <h3>{Number(edLine.amount) > 0 ? 'Затвори наши фактури' : 'Затвори влезни фактури'}{edDocs.partnerId ? ' – ' + (pName.get(edDocs.partnerId) ?? '') : ''}</h3>
                {edDocs.docs.length ? (
                  <BankForm action={linkLineAction}>
                    <input type="hidden" name="line" value={edLine.id} />
                    <div className="tw" style={{ maxHeight: 300 }}><table className="dense">
                      <thead><tr><th></th><th>Број</th><th>Датум</th><th>Комитент</th><th>Конто</th><th className="n">Отворено</th></tr></thead>
                      <tbody>{edDocs.docs.map((d) => (
                        <tr key={d.doc.id}>
                          <td><input type="checkbox" name="doc" value={d.doc.id} defaultChecked={edDocs.fifo.includes(d.doc.id)} aria-label="Избери" /></td>
                          <td>{d.doc.number || <i className="mut">без број</i>}</td><td>{dmy(d.doc.date)}</td><td>{pName.get(d.doc.partner ?? '') ?? ''}</td><td>{d.doc.konto}</td>
                          <td className="n">{fmt(d.open / 100)}</td>
                        </tr>
                      ))}</tbody>
                    </table></div>
                    <div className="row"><span className="note">Предложени се најстарите до износот на плаќањето. Вишокот останува аванс кај комитентот.</span><button className="btn pri">Поврзи</button></div>
                  </BankForm>
                ) : <p className="note">Нема отворени фактури{edDocs.partnerId ? ' за овој комитент' : ''}. Отворените ставки се читаат од книжењата на 120–128 / 220–228 по број на документ.</p>}
              </div>
              <div>
                <h3>Директно на конто</h3>
                <BankForm action={setKontoAction} className="form">
                  <input type="hidden" name="line" value={edLine.id} />
                  <label className="f">Конто<input name="konto" list="bkK2" defaultValue={edLine.konto ?? ''} required /></label>
                  <label className="f">Комитент{partnerSelect('partner', edLine.partnerId)}</label>
                  <label className="f wide">На кого / за што (белешка, се додава на описот)<input name="note" defaultValue={/ · \[(.*)\]$/.exec(edLine.description)?.[1] ?? ''} /></label>
                  <label className="chk"><input type="checkbox" name="learn" defaultChecked /> запомни правило за овој опис / шифра</label>
                  <div className="row"><button className="btn pri">Прокнижи</button></div>
                </BankForm>
                {(edLine.newPartner || (edLine.konto && BKPK_RE.test(edLine.konto) && !edLine.partnerId)) && (
                  <BankForm action={setPartnerAction} className="row" style={{ gap: 6, marginTop: 8 }}>
                    <input type="hidden" name="line" value={edLine.id} />
                    {partnerSelect('partner', edLine.partnerId)}
                    {edLine.newPartner && <label className="chk"><input type="checkbox" name="create" value={edLine.newPartner} /> креирај „{edLine.newPartner}“</label>}
                    <button className="btn">Постави комитент</button>
                  </BankForm>
                )}
                {sameRef.length > 0 && (
                  <div className="callout" style={{ marginTop: 8 }}><b>Истата референца ({refKey}) во други изводи:</b>
                    {sameRef.map((x) => (
                      <BankForm key={x.id} action={setPartnerAction} className="row" style={{ gap: 6 }}>
                        <input type="hidden" name="line" value={edLine.id} /><input type="hidden" name="partner" value={x.partnerId ?? ''} />
                        <span className="mini">{dmy(x.date)} · {x.description.slice(0, 60)} · <b>{pName.get(x.partnerId ?? '')}</b></span>
                        <button className="btn sm">Преземи комитент</button>
                      </BankForm>
                    ))}
                  </div>
                )}
                {(edLine.konto || edLine.refId) && <div className="row" style={{ marginTop: 8 }}><RowAction className="btn" action={unlinkLineAction.bind(null, edLine.id)} label="Врати во непрокнижено" /></div>}
              </div>
            </div>
          )}
        </div>
      )}

      {BK.length > 0 && write && (
        <div className="card">
          <ImportBox firmId={firm.id} fx={fx} defaultAcct={acct!.id} accounts={BK.map((x) => ({ id: x.id, label: `${x.name} · ${x.account || x.iban || ''} · конто ${x.konto}` }))} />
        </div>
      )}

      <div className="card">
        <h2>Правила за автоматско книжење</h2>
        <p className="note">Редослед: 1) затворање на отворена фактура – по бројот од описот или по износот (една фактура или збир од повеќе фактури на истиот комитент), 2) провизии (4460), 3) вашите правила. Кога рачно ќе изберете конто, програмот го памети правилото (описот и шифрата на плаќање). На пр. „провизија“ → 4460, „ЕВН“ → 4020, „УЈП ДДВ“ (плаќање) → 23008.</p>
        {R.length > 0 && (
          <div className="tw"><table className="dense"><thead><tr><th>Текст во описот / шифра</th><th>Конто</th><th></th></tr></thead>
            <tbody>{R.map((r) => (
              <tr key={r.id}><td>{r.kind === 'osnov' ? <>шифра <b>{r.match.replace('|in', ' (прилив)').replace('|out', ' (одлив)')}</b></> : r.match}{r.learned && <span className="pill"> научено</span>}</td>
                <td>{r.konto} {kName(r.konto)}</td>
                <td>{write && <RowAction action={removeRuleAction.bind(null, r.id)} label="✕" className="btn sm ghost danger" />}</td></tr>
            ))}</tbody></table></div>
        )}
        {write && (
          <BankForm action={addRuleAction} className="row" style={{ gap: 6 }}>
            <input name="match" placeholder="текст, на пр. провизија" style={{ maxWidth: 220 }} required />
            <input name="konto" list="bkK" placeholder="конто, на пр. 4460" style={{ maxWidth: 160 }} defaultValue="4460" required />
            <button className="btn">Додај правило</button>
          </BankForm>
        )}
      </div>

      <form className="row" style={{ gap: 10, margin: '6px 0', alignItems: 'end' }}>
        <label className="f">Месец<select name="m" defaultValue={month}>
          <option value="">цела {year}</option>
          {Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, '0')).map((m) => <option key={m} value={m}>{m}/{year}</option>)}
        </select></label>
        <label className="chk"><input type="checkbox" name="open" value="1" defaultChecked={onlyOpen} /> само изводи со непрокнижени ставки</label>
        <button className="btn">Прикажи</button>
        {nOpen > 0 && <span className="pill warn">{nOpen} непрокнижени ставки</span>}
        <span style={{ flex: 1 }} />
        {write && BK.length > 0 && <Link className="btn" href={q({ manual: sp.manual ? undefined : '1' })}>✍️ Рачна ставка</Link>}
      </form>

      {sp.manual && write && acct && (
        <BankForm action={addManualLineAction} className="card form">
          <h3 style={{ width: '100%' }}>Рачна ставка во извод</h3>
          <label className="f">Сметка<select name="acct" defaultValue={acct.id}>{BK.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
          <label className="f">Датум<input type="date" name="date" required defaultValue={new Date().toISOString().slice(0, 10).startsWith(String(year)) ? new Date().toISOString().slice(0, 10) : `${year}-${month || '01'}-01`} /></label>
          <label className="f">Насока<select name="dir" defaultValue="in"><option value="in">Прилив (уплата кон нас)</option><option value="out">Одлив (плаќање)</option></select></label>
          <label className="f wide">Затвора наша / влезна фактура
            <select name="doc" defaultValue="">
              <option value="">— без фактура —</option>
              {manualDocs.map((d) => <option key={d.v} value={`${d.v}|${d.o}|${d.n}|${d.p}`}>{d.t}</option>)}
            </select></label>
          <label className="f">{fx ? `Износ во ${acct.cur}` : 'Износ'} (празно = отвореното на фактурата)<input name="amount" inputMode="decimal" /></label>
          {fx && <label className="f">Износ во денари (празно = по курсот на изводот)<input name="amountMkd" inputMode="decimal" /></label>}
          <label className="f wide">Опис (празно = „Уплата“ / „Плаќање“)<input name="desc" /></label>
          <label className="f">Конто (празно = за книжење)<input name="konto" list="bkK2" /></label>
          <label className="f">Комитент{partnerSelect('partner')}</label>
          <div className="row"><button className="btn pri">Додај</button></div>
        </BankForm>
      )}

      {S.length ? (
        <div className="tw"><table>
          <thead><tr><th>Датум</th><th>Опис</th><th className="n">Прилив</th><th className="n">Одлив</th><th>Поврзување / конто</th><th></th></tr></thead>
          <tbody>
            {S.map((s) => {
              const a = acctOf.get(s.bankAccountId)!;
              const its = byStatement.get(s.id) ?? [];
              const probs = its.map((l) => lineProblem(l, fx)).filter(Boolean).length;
              if (onlyOpen && !probs) return null;
              const av = (l: BankLine) => Number(fx ? l.amountCur ?? 0 : l.amount);
              const pr = its.filter((l) => av(l) > 0).reduce((x, l) => x + av(l), 0);
              const od = its.filter((l) => av(l) < 0).reduce((x, l) => x - av(l), 0);
              const prM = its.filter((l) => Number(l.amount) > 0).reduce((x, l) => x + Number(l.amount), 0);
              const odM = its.filter((l) => Number(l.amount) < 0).reduce((x, l) => x - Number(l.amount), 0);
              const tot = s.statedDebit != null || s.statedCredit != null ? Math.abs(Number(s.statedDebit ?? 0) - od) < 0.01 && Math.abs(Number(s.statedCredit ?? 0) - pr) < 0.01 : null;
              // devizni: balance in the account currency by the statement chain (legacy `bookSaldoCur` 12652)
              const book = s.closing != null ? (fx ? (fxBal.get(s.id) != null ? fxBal.get(s.id)! / 100 : bookBal(a.konto, s.date, fx)) : bookBal(a.konto, s.date, fx)) : null;
              const diff = book != null ? Math.round((book - Number(s.closing)) * 100) / 100 : null;
              const no = nalog.get(s.id);
              return [
                <tr key={s.id} className="sub"><td colSpan={6}>
                  <BankForm action={updateStatementAction} className="row" style={{ justifyContent: 'space-between', gap: 8 }}>
                    <input type="hidden" name="st" value={s.id} />
                    <span className="row" style={{ gap: 6 }}>
                      <b>{a.name}</b> · <label htmlFor={`izv-${s.id}`}>Извод бр.</label>
                      <input id={`izv-${s.id}`} name="number" defaultValue={s.number ?? ''} placeholder={sugg.get(s.id) ? 'предлог ' + sugg.get(s.id) : '—'} title={sugg.get(s.id) ? 'Предлог по редослед: ' + sugg.get(s.id) : undefined} style={{ width: 64, padding: '2px 6px', ...(sugg.get(s.id) ? { borderStyle: 'dashed' } : {}) }} disabled={!write} />
                      од {dmy(s.date)} · {its.length} ставки
                      {fx && <> · {a.cur} · <label htmlFor={`izr-${s.id}`}>курс</label><input id={`izr-${s.id}`} name="rate" defaultValue={n2(s.rate)} inputMode="decimal" style={{ width: 80, padding: '2px 6px' }} disabled={!write} /></>}
                    </span>
                    <span className="row" style={{ gap: 6, alignItems: 'center' }}>
                      <label className="mini" htmlFor={`izo-${s.id}`}>Салдо по банка</label>
                      <input id={`izo-${s.id}`} name="opening" defaultValue={n2(s.opening)} placeholder="почетно" style={{ width: 100, padding: '2px 6px', textAlign: 'right' }} disabled={!write} />
                      <input name="closing" defaultValue={n2(s.closing)} placeholder="ново салдо" aria-label="Ново салдо" style={{ width: 110, padding: '2px 6px', textAlign: 'right' }} disabled={!write} />
                      {diff != null && s.status !== 'posted' ? <span className="pill warn" title="Изводот има непрокнижени ставки и сè уште не е во книгите – салдото не може да се спореди">непрокнижен – не е во книгите</span>
                        : diff != null && (Math.abs(diff) < 0.5 ? <span className="pill good" title="Салдото во книгите = салдото на банката">✓ салдо</span>
                        : <span className="pill bad" title={`Во книгите: ${fmt(book)} · Банка: ${fmt(Number(s.closing))}`}>⚠ разлика {fmt(diff)}</span>)}
                      {s.status === 'posted' ? (no ? <Link className="btn sm pri" href={`/nalozi?n=${encodeURIComponent(no)}`}>Налог бр. {no}</Link> : <span className="pill good">нема што да се книжи</span>)
                        : <span className="pill warn">{probs} за книжење</span>}
                    </span>
                    <span className="row" style={{ gap: 10, fontWeight: 400, width: '100%' }}>
                      <span>По изводот{fx ? ` (${a.cur})` : ''}: должува <input name="sd" defaultValue={n2(s.statedDebit)} placeholder={fmt(od)} aria-label="Должува по извод" style={{ width: 110, padding: '2px 6px' }} disabled={!write} />
                        {' '}побарува <input name="sp" defaultValue={n2(s.statedCredit)} placeholder={fmt(pr)} aria-label="Побарува по извод" style={{ width: 110, padding: '2px 6px' }} disabled={!write} /></span>
                      <span>{fx ? <>Во {a.cur}: должува <b>{fmt(od)}</b> · побарува <b>{fmt(pr)}</b> · </> : null}Прокнижено на {a.konto}: Побарува <b>{fmt(odM)}</b> · Должи <b>{fmt(prM)}</b> ден.</span>
                      {tot === null ? <span className="pill">внесете ги износите од изводот за контрола</span> : tot ? <span className="pill good">изводот е затворен</span> : <span className="pill bad">разлика со изводот</span>}
                      <span style={{ flex: 1 }} />
                      {write && <button className="btn sm">Зачувај</button>}
                      {del && s.importBatch && <RowAction action={undoImportAction.bind(null, s.importBatch)} label="Поништи увоз" confirm={`Да се поништи увозот${s.fileName ? ' „' + s.fileName + '“' : ''} (сите изводи од таа датотека)?`} />}
                      {/* legacy `undoImp` 7201 / `impMsg` 4813: lines added to this statement by a later import can be undone too */}
                      {del && [...new Set(its.map((l) => l.importBatch).filter((b): b is string => !!b && b !== s.importBatch))].map((b) => (
                        <RowAction key={b} action={undoImportAction.bind(null, b)} label={`Поништи дополнителен увоз (${its.filter((l) => l.importBatch === b).length})`}
                          confirm="Да се поништи подоцнежниот увоз во овој извод (ставките додадени од друга датотека)?" />
                      ))}
                      {del && <RowAction action={deleteStatementAction.bind(null, s.id)} label="Избриши извод" className="btn sm ghost danger" confirm={`Да се избрише изводот од ${dmy(s.date)} со ${its.length} ставки и налогот?`} />}
                    </span>
                  </BankForm>
                </td></tr>,
                ...its.map((l) => <LineRow key={l.id} l={l} fx={fx} kName={kName} pName={pName} write={write} del={del} href={q({ line: l.id })} active={l.id === sp.line} unlinked={unlIds.has(l.id)} />),
              ];
            })}
          </tbody>
        </table></div>
      ) : <div className="card empty">Сè уште нема ставки од изводи за {year}{month ? ` (${month}. месец)` : ''}.</div>}
    </>
  );
}

function LineRow({ l, fx, kName, pName, write, del, href, active, unlinked }: {
  l: BankLine; fx: boolean; kName: (k: string | null | undefined) => string; pName: Map<string, string>; write: boolean; del: boolean; href: string; active: boolean; unlinked?: boolean;
}) {
  const amt = Number(l.amount);
  const cur = l.amountCur != null ? Number(l.amountCur) : null;
  const cell = (pos: boolean) => {
    const v = fx && cur != null ? cur : amt;
    if (pos ? !(v > 0) : !(v < 0)) return null;
    if (fx && cur != null) {
      const d = lineFxDifference(l);
      return <>{l.cur} {fmt(Math.abs(cur))}<br /><small className="note">{amt ? '= ' + fmt(Math.abs(amt)) + ' ден.' : 'внесете курс'}</small>{d && l.refId ? <><br /><small className="note">курсна разлика {fmt(d.amount)} ({d.konto})</small></> : null}</>;
    }
    return fmt(Math.abs(amt));
  };
  const prob = lineProblem(l, fx);
  const r = toBankRow(l);
  const effK = l.konto || l.refId ? bankEffKonto(r) : '';
  return (
    <tr style={active ? { outline: '2px solid var(--accent)' } : undefined}>
      <td>{dmy(l.date)}</td>
      <td style={{ minWidth: 200 }}>{l.description}{l.manual && <span className="pill"> рачно</span>}
        {(l.osnov || l.bref) && <><br /><small className="note">{[l.osnov ? 'шифра ' + l.osnov : '', l.bref ? 'реф. ' + l.bref : ''].filter(Boolean).join(' · ')}</small></>}</td>
      <td className="n">{cell(true)}</td>
      <td className="n">{cell(false)}</td>
      <td>
        {l.refId || l.konto ? (
          <div className="row" style={{ gap: 4 }}>
            {l.refId ? <span className="pill good">{l.refType === 'invoice' ? 'Наша фактура' : 'Влезна ф-ра'} {l.refLabel || 'без број'}</span>
              : <span className="pill info">{l.konto} {kName(l.konto)}</span>}
            {l.partnerId && <span className="mini">{pName.get(l.partnerId)}</span>}
            {l.refs && l.refs.length > 0 && <small className="note">{l.refs.map((x) => `${x.label}: ${fmt(x.amt)}`).join(', ')}</small>}
            {l.split && l.split.length > 0 && <small className="note">поделено на {l.split.length} конта</small>}
            {l.auto && <span className="pill warn" title={String((l.data as { ai?: string } | null)?.ai ?? 'Книжено автоматски – проверете')}>автоматски: {AUTO_LBL[l.auto] ?? l.auto}</span>}
            {l.own && !l.conv && l.auto !== 'own' && <span className="pill">сопствена сметка</span>}
            {l.conv && l.auto !== 'conv' && <span className="pill">💱 откуп (неутрално)</span>}
            {l.pos && l.auto !== 'pos' && <span className="pill">💳 POS</span>}
            {unlinked && <span className="pill warn" title="Плаќање на купувач / добавувач без поврзана фактура">без фактура</span>}
            {prob && <span className="pill bad">{prob}{effK && BKPK_RE.test(effK) && l.newPartner ? ` (${l.newPartner})` : ''}</span>}
            {write && <Link className="btn sm ghost" href={href}>Промени</Link>}
          </div>
        ) : prob ? (
          <div className="row" style={{ gap: 4 }}>
            <span className="pill bad">{prob}</span>
            {write && <Link className="btn sm" href={href}>Прокнижи…</Link>}
          </div>
        ) : null}
      </td>
      <td>
        <div className="row" style={{ flexWrap: 'nowrap' }}>
          {write && <RowAction action={flipLineAction.bind(null, l.id)} label="⇅" title="Промени насока (прилив ↔ одлив)" confirm="Да се промени насоката на ставката?" />}
          {del && <RowAction action={deleteLineAction.bind(null, l.id)} label="✕" className="btn sm ghost danger" confirm={`Да се избрише ставката „${l.description.slice(0, 60)}“?`} />}
        </div>
      </td>
    </tr>
  );
}
