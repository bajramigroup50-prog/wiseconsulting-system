/**
 * Legacy `VIEWS.vlez` 4315 → 17374 — Материјално › Влез: incoming invoices list and purchase editor.
 * New: from a scan (`?scan=<ai_documents id>&i=<draft index>`), manual, import (`?imp`).
 */
import Link from 'next/link';
import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { schemeValue } from '@wise/core';
import type { ScanPurchaseDraft } from '@wise/core/sales';
import {
  aiDocuments, codes, vatPeriods, fileLinks, files, firmPostingContext, journals, partners, purchaseCosts, purchases, purchaseStockLines, purchaseVatGroups, stockMoves,
} from '@wise/db';
import { booksPage, canDo } from '@/lib/books';
import { db } from '@/lib/db';
import { dmy, fmt } from '@/lib/fmt';
import { accountOptions, itemOptions, listPayments, locationOptions, partnerOptions } from '@/lib/sales';
import { Hd } from '@/components/hd';
import { NoFirm } from '@/components/no-firm';
import { RowAction } from '@/components/row-action';
import { DownloadCsv } from '@/components/download-csv';
import { PurchaseEditor, type PurItemOpt, type ScanQueueProp } from '@/components/sales/purchase-editor';
import { PayPill } from '@/components/sales/invoices-view';
import { blankCost, COSTS, newPurchase, s, type EdPurchase } from '@/components/sales/model';
import { approvePurchaseAction, deletePurchaseAction } from './actions';
import { scanEditorHref, scanQueue } from '@/lib/scan-queue';
import { fuelRuleNow } from '@/lib/sales-parity';

type SP = { nov?: string; imp?: string; edit?: string; scan?: string; i?: string; back?: string; saved?: string; w?: string; q?: string; prevSaved?: string };

export default async function VlezPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const { u, firm, year } = await booksPage('vlez');
  if (!firm) return <NoFirm t="Влезни фактури" />;
  const write = canDo(u, 'write', firm.id), del = canDo(u, 'del', firm.id);
  const today = new Date().toISOString().slice(0, 10);
  const dflt = today.startsWith(String(year)) ? today : `${year}-12-31`;
  const S = (firm.settings ?? {}) as Record<string, unknown>;

  if (write && (sp.nov !== undefined || sp.imp !== undefined || sp.edit || sp.scan)) {
    const ctx = await firmPostingContext(db(), firm);
    const acc = { supplierFx: schemeValue(ctx, 'supplierFx'), stock: schemeValue(ctx, 'stock'), purDefault: schemeValue(ctx, 'purDefault') };
    const [eur] = await db().select({ d: codes.data }).from(codes).where(and(isNull(codes.firmId), eq(codes.cb, 'currency'), eq(codes.code, 'EUR'))).limit(1);
    let init: EdPurchase = newPurchase(dflt, sp.imp !== undefined, acc, sp.imp !== undefined ? String((eur?.d as { rate?: number } | undefined)?.rate ?? '') : '1');
    let title = sp.imp !== undefined ? 'Увозна (девизна) влезна фактура' : 'Влезна фактура', scanInfo: string | undefined, back = '/vlez';
    let nalogNo: string | null = null;
    let fileIds: string[] = [];
    let queue: ScanQueueProp | undefined;
    if (sp.edit) {
      const [pu] = await db().select().from(purchases).where(and(eq(purchases.id, sp.edit), eq(purchases.firmId, firm.id))).limit(1);
      if (!pu) return <NoFirm t="Влезната фактура не постои" />;
      const [G, ST, C, F, J] = await Promise.all([
        db().select().from(purchaseVatGroups).where(eq(purchaseVatGroups.purchaseId, pu.id)).orderBy(asc(purchaseVatGroups.lineNo)),
        db().select().from(purchaseStockLines).where(eq(purchaseStockLines.purchaseId, pu.id)).orderBy(asc(purchaseStockLines.lineNo)),
        db().select().from(purchaseCosts).where(eq(purchaseCosts.purchaseId, pu.id)),
        db().select({ id: fileLinks.fileId }).from(fileLinks).where(and(eq(fileLinks.entityType, 'purchase'), eq(fileLinks.entityId, pu.id))),
        db().select({ n: journals.number }).from(journals).where(and(eq(journals.firmId, firm.id), eq(journals.sourceType, 'purchase'), eq(journals.sourceId, pu.id))).limit(1),
      ]);
      nalogNo = J[0]?.n ?? null;
      fileIds = F.map((f) => f.id);
      init = {
        id: pu.id, number: pu.number, date: pu.date, docDate: pu.docDate ?? '', due: pu.due ?? '', partnerId: pu.partnerId ?? '', supplierName: pu.supplierName ?? '', supplierEdb: pu.supplierEdb ?? '',
        ptype: pu.ptype, art32: pu.art32, imp: pu.imp, cash: pu.cash, noDed: pu.noDed, warehouseId: pu.warehouseId ?? '', supplierAccount: pu.supplierAccount ?? '',
        currency: pu.currency, fx: s(Number(pu.fx)), calcNo: pu.calcNo ?? '', distMode: pu.distMode, cnames: pu.cnames,
        groups: G.map((g) => ({ account: g.account, rate: s(g.rate), base: s(Number(g.base)), vat: s(Number(g.vat)) })),
        stock: ST.map((x) => ({ itemId: x.itemId, name: x.name ?? '', code: x.code ?? '', barcode: x.barcode ?? '', unit: '', qty: s(Number(x.qty)), price: s(Number(x.price)), rab: Number(x.rab) ? s(Number(x.rab)) : '',
          amount: x.amount ? s(Number(x.amount)) : '', cn: x.cn == null ? '' : s(x.cn), dep: x.dep == null ? '' : s(Number(x.dep)), sp: x.sp == null ? '' : s(Number(x.sp)), type: x.type ?? '', rate: '' })),
        costs: Object.fromEntries(COSTS.map(([k]) => {
          const c = C.find((x) => x.slot === k);
          if (!c) return [k, blankCost()];
          const lines = [0, 1, 2].map((i) => ({ base: s(c.lines[i]?.base ?? ''), rate: s(c.lines[i]?.rate ?? 18), vat: s(c.lines[i]?.vat ?? '') }));
          return [k, { amount: s(Number(c.amount)), fx: c.fx ? s(Number(c.fx)) : '', doc: c.doc ?? '', date: c.date ?? '', due: c.due ?? '', partnerId: c.partnerId ?? '', byQty: c.byQty, foreign: c.foreign, lines }];
        })),
        data: Object.fromEntries(Object.entries(pu.data ?? {}).filter(([, v]) => typeof v === 'string')) as Record<string, string>,
        fileIds, scanned: pu.scanned, shifted: false, status: pu.status,
      };
      title = 'Измена на влезна фактура' + (pu.number ? ' ' + pu.number : '');
    } else if (sp.scan) {
      const [doc] = await db().select().from(aiDocuments).where(and(eq(aiDocuments.id, sp.scan), eq(aiDocuments.firmId, firm.id))).limit(1);
      const idx = Number(sp.i ?? 0) || 0;
      const x = doc?.drafts[idx];
      const dr = x?.draft as ScanPurchaseDraft | undefined;
      if (!doc || !dr) return <NoFirm t="Скенираниот документ не постои" />;
      fileIds = doc.fileId ? [doc.fileId] : [];
      init = {
        ...init, number: dr.number, date: dr.date, docDate: dr.docDate, due: dr.due, partnerId: dr.partnerId, supplierName: dr.supplierName, supplierEdb: dr.supplierEdb,
        ptype: dr.ptype, art32: dr.art32, cash: dr.cash, warehouseId: dr.warehouseId ?? '', shifted: dr.shifted, credit: dr.credit,
        groups: dr.groups.map((g) => ({ account: g.konto, rate: s(g.rate), base: s(g.base), vat: s(g.vat) })),
        stock: dr.stock.map((l) => ({ itemId: l.itemId, name: l.name, code: l.code, barcode: l.barcode, unit: l.unit ?? 'ком', qty: s(l.qty), price: s(l.price), rab: '', amount: l.amount ? s(l.amount) : '', cn: '', dep: '', sp: l.sp === undefined ? '' : s(l.sp), type: l.type ?? '', rate: s(l.rate ?? ''), isNew: l.isNew })),
        fileIds, scanned: true, scanDocId: doc.id, scanIndex: idx,
      };
      scanInfo = 'Податоците се прочитани автоматски од документот' + (x?.msg ? ' – провери: ' + x.msg : '') + '. Проверете ги износите пред да зачувате.';
      back = sp.back && sp.back.startsWith('/') ? sp.back : '/skan';
      const Q = await scanQueue(firm.id, doc.id, idx);
      if (Q && (Q.batchId || Q.rest)) queue = { batch: !!Q.batchId, name: Q.name, rest: Q.rest, skipHref: Q.next ? await scanEditorHref(firm.id, Q.next, back) : null, listHref: back };
    }
    const [fuelRule, closedP] = await Promise.all([
      fuelRuleNow(),
      db().select({ a: vatPeriods.dateFrom, b: vatPeriods.dateTo }).from(vatPeriods).where(and(eq(vatPeriods.firmId, firm.id), eq(vatPeriods.status, 'closed'))),
    ]);
    const [P, I, Lc, accts, F, last] = await Promise.all([
      partnerOptions(firm.id), itemOptions(firm.id), locationOptions(firm.id), accountOptions(firm.id, (k) => /^[02346]/.test(k)),
      fileIds.length ? db().select({ id: files.id, name: files.name }).from(files).where(inArray(files.id, fileIds)) : Promise.resolve([]),
      db().select({ item: stockMoves.itemId, v: stockMoves.value, q: stockMoves.qty, d: stockMoves.date }).from(stockMoves)
        .where(and(eq(stockMoves.firmId, firm.id), eq(stockMoves.direction, 'in'), eq(stockMoves.kind, 'in'))).orderBy(desc(stockMoves.date)),
    ]);
    const lastCost = new Map<string, number>();
    for (const m of last) if (!lastCost.has(m.item) && Number(m.q) > 0) lastCost.set(m.item, Math.round((Number(m.v) / Number(m.q)) * 1e4) / 1e4);
    const items: PurItemOpt[] = I.map((i) => ({ ...i, lastCost: lastCost.get(i.id) }));
    return <PurchaseEditor initial={init} title={title} partners={P} items={items} locations={Lc} accounts={accts} nonVat={!firm.vatRegistered}
      defMargin={Number(S.defMargin) || 25} mgRound={Number(S.mgRound) || 1} back={back} scanInfo={scanInfo} files={F} nalogNo={nalogNo} queue={queue} prevSaved={!!sp.prevSaved} warn={sp.prevSaved ? sp.w : undefined}
      firmId={firm.id} canDel={del} fuelRule={fuelRule} closed={closedP.map((x) => [String(x.a), String(x.b)] as [string, string])}
      typeKonto={{ goods: schemeValue(ctx, 'stock'), material: schemeValue(ctx, 'material'), product: schemeValue(ctx, 'product') }} />;
  }

  const q = (sp.q ?? '').toLowerCase().trim();
  const rows = await db().select({ p: purchases, name: partners.name }).from(purchases).leftJoin(partners, eq(partners.id, purchases.partnerId))
    .where(and(eq(purchases.firmId, firm.id), sql`extract(year from ${purchases.date}) = ${year}`)).orderBy(desc(purchases.date));
  const list = rows.filter(({ p, name }) => !q || `${p.number} ${name ?? p.supplierName ?? ''}`.toLowerCase().includes(q));
  const J = new Map((await db().select({ s: journals.sourceId, n: journals.number }).from(journals).where(and(eq(journals.firmId, firm.id), eq(journals.sourceType, 'purchase')))).map((x) => [x.s, x.n]));
  const ids = list.map((r) => r.p.id);
  const att = ids.length ? await db().select({ e: fileLinks.entityId, id: files.id, name: files.name }).from(fileLinks).innerJoin(files, eq(files.id, fileLinks.fileId))
    .where(and(eq(fileLinks.entityType, 'purchase'), inArray(fileLinks.entityId, ids))) : [];
  const nStock = ids.length ? new Map((await db().select({ p: purchaseStockLines.purchaseId, n: sql<number>`count(*)::int` }).from(purchaseStockLines).where(inArray(purchaseStockLines.purchaseId, ids)).groupBy(purchaseStockLines.purchaseId)).map((x) => [x.p, x.n])) : new Map<string, number>();
  // Платено / Останува / Плаќање (legacy `payPill(paidFor('purchase'), purTotal)`).
  const PM = await listPayments(firm.id, { purchaseIds: ids });
  const payOf = (id: string, total: string) => { const m = PM.get(id); return m ? { paid: m.paid, rest: m.remaining, due: m.total } : { paid: 0, rest: Number(total), due: Number(total) }; };
  const T = list.reduce((t, { p }) => ({ b: t.b + Number(p.base), v: t.v + (p.art32 ? 0 : Number(p.vat)), t: t.t + Number(p.total), pd: t.pd + payOf(p.id, p.total).paid, r: t.r + payOf(p.id, p.total).rest }), { b: 0, v: 0, t: 0, pd: 0, r: 0 });

  return (
    <>
      <Hd t="Влезни фактури" sub={String(year)}>
        <DownloadCsv name={`Vlez_${year}.csv`} label="Excel" rows={[['Датум', 'Бр.', 'Добавувач', 'Основица', 'ДДВ', 'Вкупно', 'Налог'], ...list.map(({ p, name }) => [dmy(p.date), p.number, name ?? p.supplierName ?? '', Number(p.base), Number(p.vat), Number(p.total), J.get(p.id) ?? ''])]} />
        {write && <Link className="btn" href="/vlez?imp">+ Увозна (девизна)</Link>}
        {write && <Link className="btn pri" href="/vlez?nov">+ Рачен внес</Link>}
      </Hd>
      {sp.saved && <div className="callout good">Влезната фактура е зачувана и прокнижена. {sp.w && sp.w.split(' | ').map((w, k) => <span key={k}><br />⚠ {w}</span>)}</div>}
      {write && <Link className="drop drop-sm" href="/skan?k=purchase"><b>Прочитај фактура од PDF</b> — прикачете една или повеќе фактури (PDF, JPG, PNG, UBL XML). Програмот ги чита добавувачот, бројот, датумот и износите по стапка, и ја прикачува оригиналната фактура.</Link>}
      <form className="row" style={{ gap: 8, margin: '0 0 8px' }}><input name="q" defaultValue={sp.q ?? ''} placeholder="🔍 Број или добавувач…" style={{ width: 260 }} /><button className="btn">Барај</button><span className="note">{list.length} од {rows.length}</span></form>
      {list.length ? (
        <div className="tw"><table><thead><tr><th>Датум</th><th>Бр.</th><th>Добавувач</th><th>Вид</th><th className="n">Основица</th><th className="n">ДДВ</th><th className="n">Вкупно</th><th className="n">Платено</th><th className="n">Останува</th><th>Плаќање</th><th></th></tr></thead>
          <tbody>{list.map(({ p, name }) => (
            <tr key={p.id}>
              <td>{dmy(p.date)}</td><td>{p.number}</td><td>{name ?? p.supplierName}</td>
              <td>{p.status === 'pending' && <span className="pill warn">⏳ чека одобрување </span>}{p.cash && <span className="pill info">готовина </span>}{p.imp && <span className="pill info">увозна </span>}{p.art32 && <span className="pill info">Чл. 32-а </span>}{p.scanned && <span className="pill good">скенирана </span>}{nStock.get(p.id) ? <span className="pill">на залиха </span> : null}
                {att.filter((a) => a.e === p.id).map((a) => <a key={a.id} className="pill info" href={`/api/files/${a.id}`} target="_blank" rel="noreferrer">📎 {a.name.slice(0, 20)}</a>)}
                {!att.some((a) => a.e === p.id) && <span className="pill warn">без документ</span>}</td>
              <td className="n">{fmt(p.base)}</td><td className="n">{fmt(p.art32 ? 0 : p.vat)}</td><td className="n">{fmt(p.total)}</td>
              {(() => { const pm = payOf(p.id, p.total); return <><td className="n">{fmt(pm.paid)}</td><td className="n" style={pm.rest > 0.009 && p.due && p.due < today ? { color: 'var(--bad)', fontWeight: 600 } : undefined}>{fmt(pm.rest)}</td><td>{p.status === 'pending' ? null : <PayPill paid={pm.paid} total={pm.due} />}</td></>; })()}
              <td><div className="row" style={{ flexWrap: 'nowrap' }}>
                {write && <Link className="btn sm" href={`/vlez?edit=${p.id}`}>Измени</Link>}
                {nStock.get(p.id) ? <Link className="btn sm" href={`/print/kalk/${p.id}`} target="_blank">Калкулација</Link> : null}
                {J.get(p.id) && <Link className="btn sm" href={`/nalozi?n=${encodeURIComponent(J.get(p.id)!)}`}>Налог бр. {J.get(p.id)}</Link>}
                {write && u.role !== 'klient' && p.status === 'pending' && <RowAction className="btn sm pri" action={approvePurchaseAction.bind(null, p.id)} label="✓ Одобри" />}
                {del && <RowAction action={deletePurchaseAction.bind(null, p.id)} label="Избриши" className="btn sm ghost danger" confirm={`Да се избрише влезната фактура ${p.number}? Се бришат и налогот и приемот на залиха.`} />}
              </div></td>
            </tr>))}</tbody>
          <tfoot><tr><td colSpan={4}>Вкупно ({list.length})</td><td className="n">{fmt(T.b)}</td><td className="n">{fmt(T.v)}</td><td className="n">{fmt(T.t)}</td><td className="n">{fmt(T.pd)}</td><td className="n">{fmt(T.r)}</td><td colSpan={2} /></tr></tfoot></table></div>
      ) : <div className="card empty">Сè уште нема влезни фактури за {year}.</div>}
    </>
  );
}
