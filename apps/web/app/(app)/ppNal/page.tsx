/**
 * Legacy `VIEWS.ppNal` 15837 — Финансово › 💳 Платни налози (ПП30 / ПП50 / ПП10): new orders pre-filled with the firm
 * as payer, ПП50 tax templates (`PP_TAX`), suggestions from unpaid supplier invoices (`ppSuggest`), editor with
 * account validation (IBAN + MK control digits — FIX), saved orders and printing (full form or data only).
 */
import Link from 'next/link';
import { and, desc, eq } from 'drizzle-orm';
import {
  PP_NACIN, PP_SIF, PP_T, PP_TAX, ppIbanOn, ppNew, ppTaxNew, ppWarnings, ppAccTxt, type PaymentOrder, type PpKind,
} from '@wise/core';
import { orderSuggestions, payerOf, paymentOrders } from '@wise/db';
import { booksPage, canDo } from '@/lib/books';
import { db } from '@/lib/db';
import { dmy, fmt } from '@/lib/fmt';
import { BankForm } from '@/components/bank-form';
import { Hd } from '@/components/hd';
import { NoFirm } from '@/components/no-firm';
import { PpSlip } from '@/components/pp-slip';
import { RowAction } from '@/components/row-action';
import { deletePpAction, savePpAction } from './actions';

type SP = { nov?: string; edit?: string; tax?: string; ref?: string };
const KINDS: PpKind[] = ['pp30', 'pp50', 'pp10'];

export default async function PpNalPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const { u, firm, year } = await booksPage('ppNal');
  if (!firm) return <NoFirm t="Платни налози" />;
  if (u.role === 'klient') return <><Hd t="Платни налози" /><div className="empty">Нема пристап.</div></>;
  const write = canDo(u, 'write', firm.id), del = canDo(u, 'del', firm.id);
  const [payer, list, sug] = await Promise.all([
    payerOf(db(), firm.id),
    db().select().from(paymentOrders).where(eq(paymentOrders.firmId, firm.id)).orderBy(desc(paymentOrders.date), desc(paymentOrders.createdAt)).limit(300),
    db().transaction((tx) => orderSuggestions(tx, firm.id, year)),
  ]);
  const today = new Date().toISOString().slice(0, 10);

  /* ---------- draft ---------- */
  let draft: PaymentOrder | null = null;
  let editId: string | null = null;
  let refId: string | null = null;
  if (sp.edit) {
    const [o] = await db().select().from(paymentOrders).where(and(eq(paymentOrders.id, sp.edit), eq(paymentOrders.firmId, firm.id))).limit(1);
    if (o) { draft = o.data as unknown as PaymentOrder; editId = o.id; refId = o.refId; }
  } else if (sp.tax && PP_TAX.some((t) => t[0] === sp.tax)) {
    // TODO(vat): the ДДВ amount and period come from the VAT module (Phase 5, legacy `ddvFor(prevPeriod)`).
    draft = ppTaxNew(sp.tax, today, payer, { muni: payer.muni, akont: Number((firm.settings as Record<string, unknown>).akontDD) || null });
  } else if (sp.ref) {
    const s = sug.find((x) => x.refId === sp.ref);
    if (s) {
      const same = s.recipAcc.slice(0, 3) === String(payer.account).replace(/\D/g, '').slice(0, 3);
      draft = ppNew('pp30', today, payer, { recip: s.recip, recipAcc: s.recipAcc, purpose: 'Плаќање по фактура бр. ' + s.refCredit, amount: s.amount, code: '930', refCredit: s.refCredit, nacin: same ? '3' : '2' });
      refId = s.refId;
    }
  } else if (sp.nov && KINDS.includes(sp.nov as PpKind)) draft = ppNew(sp.nov as PpKind, today, payer);
  const W = draft ? ppWarnings(draft) : [];
  const F = (k: keyof PaymentOrder, label: string, o: { type?: string; ml?: boolean; list?: string; mode?: 'numeric' | 'decimal' } = {}) => (
    o.ml
      ? <label className="f wide" key={k}>{label}<textarea name={k} rows={2} defaultValue={String(draft?.[k] ?? '')} style={{ width: '100%', font: 'inherit' }} /></label>
      : <label className="f" key={k}>{label}<input name={k} type={o.type} list={o.list} inputMode={o.mode} defaultValue={draft?.[k] == null ? '' : String(draft[k])} /></label>
  );

  return (
    <>
      <Hd t="💳 Платни налози" sub="ПП30 · ПП50 · ПП10 – автоматско пополнување и печатење" />
      {String(payer.account).replace(/\D/g, '').length !== 15 && <div className="callout warn">Внесете ја трансакциската сметка (15 цифри) на фирмата во „Изводи › Банкарски сметки“ – се користи како налогодавач.</div>}
      {write && (
        <div className="card"><div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <Link className="btn pri" href="/ppNal?nov=pp30">+ ПП30 налог за пренос</Link>
          <Link className="btn pri" href="/ppNal?nov=pp50">+ ПП50 јавни приходи</Link>
          <Link className="btn" href="/ppNal?nov=pp10">+ ПП10 уплатница</Link>
          <span style={{ flex: 1 }} />
          {PP_TAX.map((t) => <Link key={t[0]} className="btn sm" href={`/ppNal?tax=${t[0]}`}>ПП50: {t[1]}</Link>)}
        </div></div>
      )}

      {draft && write && (
        <div className="card" style={{ borderColor: 'var(--accent)' }}>
          <BankForm action={savePpAction}>
            <div className="hd"><h2>💳 {PP_T[draft.kind]}</h2>
              <div className="row">
                <button className="btn pri">Зачувај</button>
                {editId && <>
                  <Link className="btn" href={`/ppNal/print?ids=${editId}&m=full`} target="_blank">🖨 Цел образец (А4)</Link>
                  <Link className="btn" href={`/ppNal/print?ids=${editId}&m=data`} target="_blank">🖨 Допечати (А4 – 3 обрасци)</Link>
                  <Link className="btn" href={`/ppNal/print?ids=${editId}&m=data1`} target="_blank">🖨 Допечати (210×99)</Link>
                </>}
                <Link className="btn" href="/ppNal">Затвори</Link>
              </div></div>
            {editId && <input type="hidden" name="id" value={editId} />}
            {refId && <input type="hidden" name="refId" value={refId} />}
            <input type="hidden" name="kind" value={draft.kind} />
            {draft.taxKey && <input type="hidden" name="taxKey" value={draft.taxKey} />}
            <div className="ctgrid">
              <div>
                <div className="form">
                  {F('payer', draft.kind === 'pp10' ? 'Уплатувач' : 'Налогодавач (назив и седиште)', { ml: true })}
                  {draft.kind !== 'pp10' && F('payerBank', 'Банка на налогодавач')}
                  {draft.kind === 'pp50' ? F('payerTax', 'Даночен број (ЕДБ) или ЕМБГ') : draft.kind === 'pp30' ? F('payerAcc', 'Сметка на налогодавач', { mode: 'numeric' }) : null}
                  {F('recip', draft.kind === 'pp50' ? 'Примач' : 'Примач (назив и седиште)', { ml: true })}
                  {F('recipAcc', 'Сметка на примач', { mode: 'numeric' })}
                  {F('recipBank', 'Банка на примач')}
                  {F('purpose', 'Цел на дознаката', { ml: true })}
                  {F('amount', 'Износ (МКД)', { mode: 'decimal' })}
                  {draft.kind !== 'pp50' && F('code', 'Шифра', { list: 'pp_sif' })}
                  {draft.kind !== 'pp10' && (
                    <label className="f">Начин<select name="nacin" defaultValue={draft.nacin}>{PP_NACIN.map(([c, t]) => <option key={c} value={c}>{t}</option>)}</select></label>
                  )}
                  {draft.kind === 'pp50' && <>{F('uplSm', 'Уплатна сметка / сметка на буџетски корисник')}{F('prihod', 'Приходна шифра и програма')}{F('refDebit', 'Повикување на број (задолжување)')}</>}
                  {draft.kind === 'pp30' && <>{F('refDebit', 'Повикување на број (задолжување)')}{F('refCredit', 'Повикување на број (одобрување)')}</>}
                  {draft.kind === 'pp10' && F('refCredit', 'Повикување на број (одобрување)')}
                  {F('place', 'Место')}
                  {F('date', 'Датум на поднесување', { type: 'date' })}
                  {draft.kind !== 'pp10' && F('valDate', 'Датум на валута', { type: 'date' })}
                </div>
                <datalist id="pp_sif">{PP_SIF.map(([c, t]) => <option key={c} value={c}>{t}</option>)}</datalist>
                <label className="chk" style={{ marginTop: 6 }}><input type="checkbox" name="iban" defaultChecked={draft.iban ?? ppIbanOn(draft.date)} /> Сметките во IBAN формат (задолжително од 01.11.2026)</label>
                {W.length > 0 && <div className="callout warn" style={{ marginTop: 8 }}>{W.map((w) => <div key={w}>{w}</div>)}</div>}
                <p className="note">„Цел образец“ го црта налогот на бела хартија (А4, 3 налози). Пред прво користење прашајте ја банката дали прифаќа налог печатен на бела хартија. „Допечати“ печати само податоци врз купени обрасци. Распоредот е приближен – проверете со еден образец.</p>
              </div>
              <div className="pdfwrap" style={{ maxHeight: '72vh', overflow: 'auto', background: '#fff' }}>
                <div style={{ transform: 'scale(.82)', transformOrigin: '0 0', width: '210mm' }}><PpSlip n={draft} /></div>
                <p className="mini" style={{ margin: 6 }}>{draft.kind !== 'pp10' ? 'Налогодавач: ' + ppAccTxt(draft.payerAcc, draft.date, draft.iban ?? undefined) + ' · ' : ''}Примач: {ppAccTxt(draft.recipAcc, draft.date, draft.iban ?? undefined)}</p>
              </div>
            </div>
          </BankForm>
        </div>
      )}

      {write && sug.length > 0 && (
        <div className="card"><h2>Предлог – неплатени влезни фактури ({sug.length})</h2>
          <div className="tw" style={{ maxHeight: 300 }}><table className="dense">
            <thead><tr><th>Добавувач · фактура · датум</th><th className="n">Отворено</th><th></th></tr></thead>
            <tbody>{sug.map((s) => (
              <tr key={s.refId}><td>{s.label}{s.warn && <span className="pill warn"> {s.warn}</span>}</td><td className="n">{fmt(s.amount)}</td>
                <td><Link className="btn sm" href={`/ppNal?ref=${encodeURIComponent(s.refId)}`}>ПП30</Link></td></tr>
            ))}</tbody>
          </table></div>
          <p className="note">Отворените износи се од книжењата на 220–228 по број на фактура, намалени за плаќањата од изводите.</p>
        </div>
      )}

      <form className="card" action="/ppNal/print" target="_blank">
        <div className="hd"><h2>Зачувани налози ({list.length})</h2>
          <div className="row">
            <select name="m" defaultValue="full" aria-label="Начин на печатење"><option value="full">Цел образец (А4)</option><option value="data">Допечати (А4 – 3)</option><option value="data1">Допечати (210×99)</option></select>
            <button className="btn">🖨 Печати избрани</button>
          </div></div>
        {list.length ? (
          <div className="tw"><table className="dense">
            <thead><tr><th></th><th>Вид</th><th>Датум</th><th>Примач</th><th>Цел</th><th className="n">Износ</th><th>Печатен</th><th></th></tr></thead>
            <tbody>{list.map((o) => {
              const d = o.data as unknown as PaymentOrder;
              return (
                <tr key={o.id}>
                  <td><input type="checkbox" name="ids" value={o.id} aria-label="Избери" /></td>
                  <td>{o.kind.replace('pp', 'ПП')}</td><td>{dmy(o.date)}</td><td>{o.recipient}</td><td>{String(d.purpose ?? '').slice(0, 60)}</td>
                  <td className="n">{o.amount != null ? fmt(Number(o.amount)) : ''}</td><td>{o.printedAt ? dmy(o.printedAt.toISOString()) : ''}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    {write && <Link className="btn sm" href={`/ppNal?edit=${o.id}`}>Отвори</Link>}{' '}
                    {del && <RowAction action={deletePpAction.bind(null, o.id)} label="🗑" className="btn sm ghost danger" confirm="Да се избрише налогот?" />}
                  </td>
                </tr>
              );
            })}</tbody>
          </table></div>
        ) : <p className="note">Нема зачувани налози.</p>}
      </form>
    </>
  );
}
