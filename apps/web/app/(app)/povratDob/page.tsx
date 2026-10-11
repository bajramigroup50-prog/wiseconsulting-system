/** Legacy `VIEWS.povratDob` 8777 → 16233 — Повратници и одобренија од добавувачи. */
import Link from 'next/link';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { schemeValue } from '@wise/core';
import {
  firmPostingContext, journals, partners, purchases, purchaseStockLines, purchaseVatGroups, supplierCreditLines, supplierCredits,
} from '@wise/db';
import { booksPage, canDo } from '@/lib/books';
import { db } from '@/lib/db';
import { dmy, fmt } from '@/lib/fmt';
import { accountOptions, itemOptions, locationOptions, partnerOptions } from '@/lib/sales';
import { Hd } from '@/components/hd';
import { NoFirm } from '@/components/no-firm';
import { RowAction } from '@/components/row-action';
import { ScrEditor, type EdScr, type ScrPurchase } from '@/components/sales/scr-editor';
import { deleteScrAction } from './actions';
import { ScrScan } from '@/components/sales/scr-scan';
import { loadAiResult } from '@/lib/ai';
import { scrDraftFromScan, type ScrScanResult } from '@wise/core/sales';

type SP = { nov?: string; edit?: string; saved?: string; w?: string; ai?: string; scan?: string };

export default async function PovratDobPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const { u, firm, year } = await booksPage('povratDob');
  if (!firm) return <NoFirm t="Повратници и одобренија од добавувачи" />;
  const write = canDo(u, 'write', firm.id) && u.role !== 'klient', del = canDo(u, 'del', firm.id);
  const today = new Date().toISOString().slice(0, 10);

  if (write && (sp.nov !== undefined || sp.edit)) {
    let init: EdScr = { id: null, kind: 'ret', number: '', date: today.startsWith(String(year)) ? today : `${year}-12-31`, supNo: '', partnerId: '', refPurchaseId: '', warehouseId: '', note: '', rows: [] };
    if (sp.edit) {
      const [d] = await db().select().from(supplierCredits).where(and(eq(supplierCredits.id, sp.edit), eq(supplierCredits.firmId, firm.id))).limit(1);
      if (!d) return <NoFirm t="Документот не постои" />;
      const L = await db().select().from(supplierCreditLines).where(eq(supplierCreditLines.creditId, d.id)).orderBy(asc(supplierCreditLines.lineNo));
      init = { id: d.id, kind: d.kind, number: d.number, date: d.date, supNo: d.supNo ?? '', partnerId: d.partnerId, refPurchaseId: d.refPurchaseId ?? '', warehouseId: d.warehouseId ?? '', note: d.note ?? '',
        rows: L.map((l) => ({ itemId: l.itemId ?? '', name: l.name, qty: String(Number(l.qty)), price: String(Number(l.price)), rate: String(l.rate), account: l.account })) };
    }
    const ctx = await firmPostingContext(db(), firm);
    const PU = await db().select().from(purchases).where(eq(purchases.firmId, firm.id)).orderBy(desc(purchases.date)).limit(300);
    let scanMsgs: string[] = [];
    const ids = PU.map((x) => x.id);
    const [ST, G] = ids.length ? await Promise.all([
      db().select().from(purchaseStockLines).where(inArray(purchaseStockLines.purchaseId, ids)),
      db().select().from(purchaseVatGroups).where(inArray(purchaseVatGroups.purchaseId, ids)),
    ]) : [[], []];
    const purs: ScrPurchase[] = PU.map((x) => ({
      id: x.id, number: x.number, date: x.date, partnerId: x.partnerId, total: Number(x.total), warehouseId: x.warehouseId,
      supKonto: x.imp ? x.supplierAccount || schemeValue(ctx, 'supplierFx') : schemeValue(ctx, 'supplier'),
      stock: ST.filter((s) => s.purchaseId === x.id).map((s) => ({ itemId: s.itemId, qty: Number(s.qty), value: Number(s.value) })),
      groups: G.filter((g) => g.purchaseId === x.id).map((g) => ({ account: g.account, rate: g.rate, base: Number(g.base) })),
    }));
    const [P, I, Lc, A] = await Promise.all([partnerOptions(firm.id), itemOptions(firm.id), locationOptions(firm.id), accountOptions(firm.id, (k) => /^[34675]/.test(k))]);
    // legacy `scrFromScan` (16213): the read document prefills the editor
    const ad = sp.ai ? await loadAiResult(firm.id, sp.ai, 'scr') : null;
    if (ad) {
      const R0 = scrDraftFromScan(ad.result as ScrScanResult, {
        partners: P.map((x) => ({ id: x.id, name: x.name, edb: x.edb })), items: I.map((x) => ({ id: x.id, name: x.name, code: x.code, type: x.type, unit: x.unit, rate: x.rate, barcodes: x.barcodes })),
        purchases: purs.map((x) => ({ id: x.id, number: x.number, date: x.date, partnerId: x.partnerId, warehouseId: x.warehouseId, itemIds: x.stock.map((s) => s.itemId), groups: x.groups.map((g) => ({ rate: g.rate, account: g.account })) })),
        today, stockKonto: (t) => schemeValue(ctx, t === 'material' ? 'material' : t === 'product' ? 'product' : 'stock'),
      });
      const dr = R0.draft;
      init = { ...init, kind: dr.kind, date: dr.date, supNo: dr.supNo, note: dr.note, partnerId: dr.partnerId, refPurchaseId: dr.refPurchaseId, warehouseId: dr.warehouseId,
        rows: dr.rows.map((x) => ({ itemId: x.itemId, name: x.name, qty: String(x.qty), price: String(x.price), rate: String(x.rate), account: x.account })) };
      const tot = dr.rows.reduce((a, x) => a + x.qty * x.price * (1 + (firm.vatRegistered ? x.rate : 0) / 100), 0);
      scanMsgs = [...R0.msgs, ...(R0.total && Math.abs(tot - R0.total) > 1 ? ['Пресметано ' + fmt(tot) + ' ≠ на документот ' + fmt(R0.total)] : [])];
    }
    return <>{ad && <div className={'callout ' + (scanMsgs.length ? 'warn' : 'good')}>{scanMsgs.length ? '⚠ ' + scanMsgs.join(' · ') : '✓ Прочитано – проверете и „Зачувај и книжи“.'}</div>}<ScrEditor initial={init} partners={P} items={I} purchases={purs} locations={Lc} accounts={A} ddv={firm.vatRegistered} supplierKonto={schemeValue(ctx, 'supplier')} /></>;
  }

  const L = await db().select({ d: supplierCredits, p: partners.name, pur: { n: purchases.number, d: purchases.date } }).from(supplierCredits)
    .innerJoin(partners, eq(partners.id, supplierCredits.partnerId)).leftJoin(purchases, eq(purchases.id, supplierCredits.refPurchaseId))
    .where(and(eq(supplierCredits.firmId, firm.id), sql`extract(year from ${supplierCredits.date}) = ${year}`)).orderBy(desc(supplierCredits.date));
  const J = new Map((await db().select({ s: journals.sourceId, n: journals.number }).from(journals).where(and(eq(journals.firmId, firm.id), eq(journals.sourceType, 'supplier_credit')))).map((x) => [x.s, x.n]));
  const T = L.reduce((t, { d }) => ({ b: t.b + Number(d.base), v: t.v + Number(d.vat), t: t.t + Number(d.total) }), { b: 0, v: 0, t: 0 });
  return (
    <>
      <Hd t="Повратници и одобренија од добавувачи" sub={`враќање стока на добавувач · книжно одобрение (попуст) од добавувач · ${year}`}>
        {write && <Link className="btn" href="/povratDob?scan=1">📷 Скенирај повратница</Link>}
        {write && <Link className="btn pri" href="/povratDob?nov">+ Нов документ</Link>}
      </Hd>
      {write && sp.scan && <ScrScan firmId={firm.id} auto />}
      {sp.saved && <div className="callout good">Зачувано и прокнижено. <Link href={`/print/scr/${sp.saved}`} target="_blank">PDF</Link>{sp.w && sp.w.split(' | ').map((w, k) => <span key={k}><br />⚠ {w}</span>)}</div>}
      {L.length ? <div className="tw"><table><thead><tr><th>Датум</th><th>Број</th><th>Вид</th><th>Добавувач</th><th>Кон влезна ф-ра</th><th className="n">Основа</th><th className="n">ДДВ</th><th className="n">Вкупно</th><th>Налог</th><th /></tr></thead>
        <tbody>{L.map(({ d, p, pur }) => (
          <tr key={d.id}><td>{dmy(d.date)}</td><td>{d.number}{d.supNo && <div className="mini">одобр. {d.supNo}</div>}</td>
            <td>{d.kind === 'ret' ? <span className="pill warn">Повратница</span> : <span className="pill info">Одобрение</span>}</td><td>{p}</td><td>{pur?.n ? `${pur.n} · ${dmy(pur.d)}` : '—'}</td>
            <td className="n">{fmt(-Number(d.base))}</td><td className="n">{fmt(-Number(d.vat))}</td><td className="n"><b>{fmt(-Number(d.total))}</b></td>
            <td>{J.get(d.id) && <Link className="btn sm ghost" href={`/nalozi?n=${encodeURIComponent(J.get(d.id)!)}`}>{J.get(d.id)}</Link>}</td>
            <td style={{ whiteSpace: 'nowrap' }}>{write && <Link className="btn sm" href={`/povratDob?edit=${d.id}`}>Отвори</Link>}<Link className="btn sm" href={`/print/scr/${d.id}`} target="_blank">PDF</Link>
              {del && <RowAction action={deleteScrAction.bind(null, d.id)} label="🗑" title="Избриши" confirm={`Да се избрише ${d.kind === 'ret' ? 'повратницата' : 'одобрението'} ${d.number}?${d.kind === 'ret' ? ' Стоката се враќа на залиха.' : ''}`} style={{ color: 'var(--bad)' }} />}</td></tr>))}</tbody>
        <tfoot><tr><td colSpan={5}>Вкупно ({L.length})</td><td className="n">{fmt(-T.b)}</td><td className="n">{fmt(-T.v)}</td><td className="n">{fmt(-T.t)}</td><td colSpan={2} /></tr></tfoot></table></div>
        : <div className="card empty">Нема повратници ни одобренија од добавувачи за {year}.</div>}
      <p className="note"><b>Повратница</b> – стоката физички се враќа на добавувачот: се намалува залихата (количина и вредност по набавна цена), обврската кон добавувачот и влезниот ДДВ. <b>Одобрение од добавувач</b> – добавувачот дава попуст/рабат по веќе примена фактура: се намалува обврската и влезниот ДДВ, а основата оди на избраното конто (залиха, трошок или приход). Во ДДВ-04 влезниот ДДВ се намалува во периодот на датумот на документот.</p>
    </>
  );
}
