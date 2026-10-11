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
import { ppExportRows } from '@wise/core/bank/fin-parity';
import { getOfficeProfile, orderSuggestions, payerOf, paymentOrders, vatDueEstimate } from '@wise/db';
import { booksPage, canDo } from '@/lib/books';
import { db } from '@/lib/db';
import { dmy, fmt } from '@/lib/fmt';
import { BankForm } from '@/components/bank-form';
import { Hd } from '@/components/hd';
import { NoFirm } from '@/components/no-firm';
import { PpSlip } from '@/components/pp-slip';
import { RowAction } from '@/components/row-action';
import { ExportBar } from '@/components/parity-fin/export-bar';
import { deletePpAction, savePpAction, savePpCalAction } from './actions';
import { PpTaxSelect, type PpTaxTpl } from './tax-select';

type SP = { nov?: string; edit?: string; tax?: string; ref?: string };
const KINDS: PpKind[] = ['pp30', 'pp50', 'pp10'];

export default async function PpNalPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const { u, firm, year } = await booksPage('ppNal');
  if (!firm) return <NoFirm t="Платни налози" />;
  if (u.role === 'klient') return <><Hd t="Платни налози" /><div className="empty">Нема пристап.</div></>;
  const write = canDo(u, 'write', firm.id), del = canDo(u, 'del', firm.id);
  const today = new Date().toISOString().slice(0, 10);
  const [payer, list, sug, est, office] = await Promise.all([
    payerOf(db(), firm.id),
    db().select().from(paymentOrders).where(eq(paymentOrders.firmId, firm.id)).orderBy(desc(paymentOrders.date), desc(paymentOrders.createdAt)).limit(300),
    db().transaction((tx) => orderSuggestions(tx, firm.id, year)),
    // ДДВ of the last finished VAT period (legacy 15772 `ddvFor(prevPeriod)`; filed figure when closed).
    vatDueEstimate(db(), firm.id, today),
    getOfficeProfile(db()),
  ]);
  const vat = est ? { label: est.period.replace('-Т', ' – квартал '), ref: est.period.replace('-Т', '-'), amount: est.amount > 0 ? est.amount : null } : undefined;
  const taxDraft = (key: string) => ppTaxNew(key, today, payer, { muni: payer.muni, akont: Number((firm.settings as Record<string, unknown>).akontDD) || null, ...(vat ? { vat } : {}) });
  const cal = ((office as Record<string, unknown>).ppCal ?? {}) as Record<string, { dx?: number; dy?: number }>;

  /* ---------- draft ---------- */
  let draft: PaymentOrder | null = null;
  let editId: string | null = null;
  let refId: string | null = null;
  if (sp.edit) {
    const [o] = await db().select().from(paymentOrders).where(and(eq(paymentOrders.id, sp.edit), eq(paymentOrders.firmId, firm.id))).limit(1);
    if (o) { draft = o.data as unknown as PaymentOrder; editId = o.id; refId = o.refId; }
  } else if (sp.tax && PP_TAX.some((t) => t[0] === sp.tax)) {
    draft = taxDraft(sp.tax);
  } else if (sp.ref) {
    const s = sug.find((x) => x.refId === sp.ref);
    if (s) {
      const same = s.recipAcc.slice(0, 3) === String(payer.account).replace(/\D/g, '').slice(0, 3);
      draft = ppNew('pp30', today, payer, { recip: s.recip, recipAcc: s.recipAcc, purpose: 'Плаќање по фактура бр. ' + s.refCredit, amount: s.amount, code: '930', refCredit: s.refCredit, nacin: same ? '3' : '2' });
      refId = s.refId;
    }
  } else if (sp.nov && KINDS.includes(sp.nov as PpKind)) draft = ppNew(sp.nov as PpKind, today, payer);
  const W = draft ? ppWarnings(draft) : [];
  const taxTpl: PpTaxTpl[] = PP_TAX.map((t) => { const d = taxDraft(t[0]); return { key: t[0], name: t[1], uplSm: d.uplSm ?? '', prihod: d.prihod ?? '', refDebit: d.refDebit ?? '', purpose: d.purpose ?? '', amount: d.amount ? String(d.amount) : '' }; });
  const kc = draft ? cal[draft.kind] ?? {} : {};
  // Legacy `ppSuggest` 15775: the VAT ПП50 on top, then unpaid supplier invoices by due date.
  const vatSug = est && est.amount > 0 && vat ? { label: 'ДДВ за ' + vat.label, amount: est.amount } : null;
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
        </div>
        <p className="mini" style={{ margin: '6px 0 0' }}>⚠ Од <b>01.11.2026</b> плаќањата во земјата се само со <b>IBAN</b> (MK + 2 контролни + 15 цифри) – програмата го пресметува автоматски од сметката.</p></div>
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
                  {draft.kind === 'pp50' && <><PpTaxSelect templates={taxTpl} value={draft.taxKey ?? ''} />{F('uplSm', 'Уплатна сметка / сметка на буџетски корисник')}{F('prihod', 'Приходна шифра и програма')}{F('refDebit', 'Повикување на број (задолжување)')}</>}
                  {draft.kind === 'pp30' && <>{F('refDebit', 'Повикување на број (задолжување)')}{F('refCredit', 'Повикување на број (одобрување)')}</>}
                  {draft.kind === 'pp10' && F('refCredit', 'Повикување на број (одобрување)')}
                  {F('place', 'Место')}
                  {F('date', 'Датум на поднесување', { type: 'date' })}
                  {draft.kind !== 'pp10' && F('valDate', 'Датум на валута', { type: 'date' })}
                </div>
                <datalist id="pp_sif">{PP_SIF.map(([c, t]) => <option key={c} value={c}>{t}</option>)}</datalist>
                <label className="chk" style={{ marginTop: 6 }}><input type="checkbox" name="iban" defaultChecked={draft.iban ?? ppIbanOn(draft.date)} /> Сметките во IBAN формат (задолжително од 01.11.2026)</label>
                {W.length > 0 && <div className="callout warn" style={{ marginTop: 8 }}>{W.map((w) => <div key={w}>{w}</div>)}</div>}
                <p className="note" style={{ margin: '6px 0' }}>За купени обрасци („Допечати“): ако текстот не паѓа точно во полињата, поместете го (во мм): десно + / лево −, долу + / горе −.</p>
                <p className="note">„Цел образец“ го црта налогот на бела хартија (А4, 3 налози). Пред прво користење прашајте ја банката дали прифаќа налог печатен на бела хартија. „Допечати“ печати само податоци врз купени обрасци (ласерски за единечни листови; за самокопирни сетови – матричен печатач). Распоредот е приближен – проверете со еден образец и калибрирајте.</p>
              </div>
              <div className="pdfwrap" style={{ maxHeight: '72vh', overflow: 'auto', background: '#fff' }}>
                <div style={{ transform: 'scale(.82)', transformOrigin: '0 0', width: '210mm' }}><PpSlip n={draft} /></div>
                <p className="mini" style={{ margin: 6 }}>{draft.kind !== 'pp10' ? 'Налогодавач: ' + ppAccTxt(draft.payerAcc, draft.date, draft.iban ?? undefined) + ' · ' : ''}Примач: {ppAccTxt(draft.recipAcc, draft.date, draft.iban ?? undefined)}</p>
              </div>
            </div>
          </BankForm>
        </div>
      )}

      {draft && write && (
        <BankForm action={savePpCalAction.bind(null, draft.kind)} className="card row" style={{ gap: 10, alignItems: 'end' }}>
          <b>📐 Калибрација за {PP_T[draft.kind]} (допечатување)</b>
          <label className="f">Поместување десно (мм)<input name="dx" type="number" step="0.5" defaultValue={kc.dx ?? 0} style={{ width: 90 }} /></label>
          <label className="f">Поместување долу (мм)<input name="dy" type="number" step="0.5" defaultValue={kc.dy ?? 0} style={{ width: 90 }} /></label>
          <button className="btn sm">Зачувај калибрација</button>
          <span className="note">Важи за сите фирми во канцеларијата (ист печатач).</span>
        </BankForm>
      )}

      {write && !(sug.length > 0 || vatSug) && <div className="card"><h2>💡 Предлози за плаќање (автоматски)</h2><p className="note">Нема отворени обврски кон добавувачи ни ДДВ за плаќање.</p></div>}
      {write && (sug.length > 0 || vatSug) && (
        <div className="card"><h2>💡 Предлози за плаќање (автоматски) – неплатени влезни фактури ({sug.length})</h2>
          <div className="tw" style={{ maxHeight: 300 }}><table className="dense">
            <thead><tr><th>Добавувач · фактура · датум</th><th className="n">Отворено</th><th></th></tr></thead>
            <tbody>{vatSug && (
              <tr><td><b>{vatSug.label}</b> <span className="pill">ПП50</span></td><td className="n">{fmt(vatSug.amount)}</td><td><Link className="btn sm" href="/ppNal?tax=ddv">Направи налог</Link></td></tr>
            )}{sug.map((s) => (
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
            <ExportBar pdf={false} name="Platni_nalozi" title="Платни налози" rows={ppExportRows(list.map((o) => ({ kind: o.kind, date: o.date, amount: o.amount, printedAt: o.printedAt, data: o.data as unknown as PaymentOrder })))} />
            <button className="btn" name="m" value="full">🖨 Избраните – цел образец</button>
            <button className="btn" name="m" value="data">🖨 Избраните – допечати</button>
            <button className="btn" name="m" value="data1">🖨 Допечати (210×99)</button>
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
      <div className="card">
        <h2>🖨 Печатач за налози</h2>
        <p className="note">За самокопирни (повеќеделни) обрасци ПП30/ПП50 потребен е <b>матричен (иглен) печатач</b> – на пр. Epson LQ-350 (за единечни налози) или Epson LQ-590II (полесно внесување на обрасците и подолг век). Ласерски / инкџет печатач може да печати само на единечни листови или „Цел образец“ на бела хартија (ако банката го прифаќа). По првото печатење проверете со вистински образец и подесете ја калибрацијата погоре.</p>
      </div>
    </>
  );
}
