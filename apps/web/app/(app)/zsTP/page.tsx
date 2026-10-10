/**
 * Legacy `VIEWS.zsTP` 10499 (+ ACT `tpSave`/`tpPdf`/`tpBook`, `tpBookHTML` 10512) — Годишна сметка – ТП / самостојна
 * дејност: Образец „Б“ + ДЛД-ДБ, and the simple-bookkeeping books КП / КТ / КО / КПС (Сл. весник 21/2020).
 * FIX(P8 #13): legacy `onchange` only mutated memory (lost on reload); inputs are saved by a guarded, audited action
 * that also stores the year's tax (next year's monthly advance, legacy `tpSave`).
 */
import Link from 'next/link';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { r2 } from '@wise/core';
import { tpBook, tpKps } from '@wise/core/yearend/books';
import { fixedAssets, items, partners, stockMoves } from '@wise/db';
import { db } from '@/lib/db';
import { dmy, fmt } from '@/lib/fmt';
import { accountNames, phaseDone, yePage } from '@/lib/yearend';
import { NoFirm } from '@/components/no-firm';
import { PdfButton } from '@/components/pdf-button';
import { XlsxButton } from '@/components/vp-tools';
import { ActionForm } from '@/components/yearend/action-form';
import { TpTables } from '@/components/yearend/entity-tables';
import { NotClosedNote, ZsHead } from '@/components/yearend/ph-bar';
import { saveDld } from '../zsProc/actions';

const BOOKS = [['kp', 'КП – приходи'], ['kt', 'КТ – трошоци'], ['ko', 'КО – основни средства и залихи'], ['kps', 'КПС – парични средства, побарувања и обврски']] as const;
type Bk = (typeof BOOKS)[number][0];

async function bookData(k: Bk, firmId: string, lines: Parameters<typeof tpBook>[1], year: number) {
  const names = await accountNames(firmId);
  if (k === 'kp' || k === 'kt') {
    const pids = [...new Set(lines.map((l) => l.partnerId).filter((x): x is string => !!x))];
    const P = pids.length ? await db().select({ id: partners.id, name: partners.name }).from(partners).where(inArray(partners.id, pids)) : [];
    const R = tpBook(k, lines, names, Object.fromEntries(P.map((p) => [p.id, p.name])));
    const t = r2(R.reduce((s, r) => s + r.amt, 0));
    return { head: ['Р.бр', 'Датум', 'Документ', 'Комитент / опис', 'Конто', 'Износ'], rows: R.map((r) => [r.no, dmy(r.date), r.doc, r.who, r.konto, r.amt]), total: ['Вкупно', '', '', '', '', t], num: [5] };
  }
  if (k === 'ko') {
    const A = await db().select({ name: fixedAssets.name, date: fixedAssets.date, cost: fixedAssets.cost }).from(fixedAssets).where(eq(fixedAssets.firmId, firmId));
    const S = await db().select({ name: items.name, qty: sql<string>`sum(${stockMoves.qty})`, value: sql<string>`sum(${stockMoves.value})` })
      .from(stockMoves).innerJoin(items, eq(items.id, stockMoves.itemId))
      .where(and(eq(stockMoves.firmId, firmId), eq(stockMoves.pending, false), sql`${items.type} <> 'service'`, sql`${stockMoves.date} <= ${year + '-12-31'}`))
      .groupBy(items.id, items.name).having(sql`abs(sum(${stockMoves.qty})) > 1e-9`);
    return {
      head: ['Основно средство / залиха', 'Датум', 'Набавна вредност', 'Количина'],
      rows: [...A.map((a) => [a.name, dmy(a.date), +a.cost, 1]), ...S.map((s) => [`${s.name} (залиха)`, '', r2(+s.value), +s.qty])], total: null, num: [2, 3],
    };
  }
  const R = tpKps(lines, names);
  return { head: ['Конто', 'Назив', 'Должи', 'Побарува', 'Салдо'], rows: R.map((r) => [r.k, r.n, r.d, r.p, r.s]), total: null, num: [2, 3, 4] };
}

export default async function ZsTpPage({ searchParams }: { searchParams: Promise<{ b?: string }> }) {
  const sp = await searchParams;
  const c = await yePage('zsTP', 'zsTP');
  if (!c) return <NoFirm t="Годишна сметка – ТП / самостојна дејност" />;
  const { L, firm, year } = c;
  const prevTax = Number((L.prevStatement?.dldAdj as Record<string, number> | undefined)?.tax ?? 0) || 0;
  const bk = BOOKS.find(([k]) => k === sp.b)?.[0] ?? null;
  // КП / КТ use the year without open/close; КПС the whole ledger of the year (legacy `ledger()`).
  const B = bk ? await bookData(bk, firm.id, L.lines, year) : null;
  const bkName = bk ? BOOKS.find(([k]) => k === bk)![1] : '';
  return (
    <>
      <ZsHead id="zsTP" t={`Годишна сметка – ${L.ent === 'sd' ? 'самостојна дејност' : 'трговец поединец'}`} year={year} ent={L.ent} done={phaseDone(L)}>
        <Link className="btn" href="/zsRok">📅 Каде и кога се поднесува</Link>
        <Link className="btn pri" href="/pecati/tp" target="_blank">🖨 Б + ДЛД-ДБ (печати / PDF)</Link>
      </ZsHead>
      <NotClosedNote closed={L.Y.closed} year={year} />
      <ActionForm action={saveDld} submit="Зачувај" className="">
        <TpTables T={L.Y.tp!} firm={firm} year={year} />
      </ActionForm>
      {prevTax > 0 && <p className="note">Аконтации за {year} според минатата година: <b>{fmt(r2(prevTax / 12))}</b> месечно.</p>}
      <div className="card" id="tpBook">
        <h2 style={{ fontSize: 15, margin: '0 0 6px' }}>Деловни книги (просто книговодство)</h2>
        <p className="note" style={{ margin: '0 0 8px' }}>Ако водите просто книговодство (Правилник, Сл. весник 21/2020): КП – книга на приходи, КТ – книга на трошоци, КО – книга на основни средства, ситен инвентар и залихи, КПС – книга на парични средства, побарувања и обврски. Се генерираат од внесените документи.</p>
        <div className="row noprint" style={{ gap: 6, flexWrap: 'wrap' }}>
          {BOOKS.map(([k, n]) => <Link key={k} className={`btn${bk === k ? ' pri' : ''}`} href={bk === k ? '/zsTP' : `/zsTP?b=${k}`}>{n}</Link>)}
          {B && <PdfButton selector="#tpBook" title={`${bkName} ${year}`} landscape />}
          {B && <XlsxButton name={`Kniga_${bk}_${year}.xlsx`} label="Excel" sheets={[{ name: bkName.slice(0, 30), rows: [B.head, ...B.rows, ...(B.total ? [B.total] : [])] }]} />}
        </div>
        {B && (
          <div className="tw" style={{ marginTop: 8 }}><table className="dense">
            <thead><tr>{B.head.map((h, i) => <th key={h} className={B.num.includes(i) ? 'n' : ''}>{h}</th>)}</tr></thead>
            <tbody>
              {B.rows.map((r, j) => <tr key={j}>{r.map((v, i) => <td key={i} className={B.num.includes(i) ? 'n' : ''}>{B.num.includes(i) && typeof v === 'number' ? fmt(v) : v}</td>)}</tr>)}
              {B.total && <tr className="tot"><td colSpan={B.head.length - 1}>Вкупно</td><td className="n">{fmt(+B.total.at(-1)!)}</td></tr>}
            </tbody>
          </table></div>
        )}
      </div>
      <p className="note">Данок на личен доход од самостојна дејност: 10% од разликата меѓу приходите и расходите зголемена за непризнаените расходи. Данокот од ДЛД-ДБ се книжи при затворањето на годината (8100 / 2330). ТП не може да премине на данок на вкупен приход. Проверете ја тековната верзија на образецот ДЛД-ДБ на ujp.gov.mk пред поднесување.</p>
    </>
  );
}
