/**
 * Legacy `VIEWS.blagajna` 6569 — Финансово › Благајна: registers (1020 MKD, 1051/1052 EUR…), vouchers (уплатница /
 * исплатница, Macedonian and foreign receipts) posted through `blgEntries`, and the cash book (благајнички дневник).
 */
import Link from 'next/link';
import { and, eq } from 'drizzle-orm';
import { CASH_EXPENSE_CATEGORIES, cashExpenseAccount, FX_DEF, fxRate } from '@wise/core';
import {
  cashBook, cashVouchers, effectiveChart, files, loadFxSources, loadRegisters, missingAccounts, nextVoucherNo,
} from '@wise/db';
import { booksPage, canDo, inYearOr, partnerOptions } from '@/lib/books';
import { db } from '@/lib/db';
import { dmy, fmt } from '@/lib/fmt';
import { BankForm } from '@/components/bank-form';
import { DownloadCsv } from '@/components/download-csv';
import { Hd } from '@/components/hd';
import { NoFirm } from '@/components/no-firm';
import { RowAction } from '@/components/row-action';
import { createDefaultRegistersAction, deleteVoucherAction, removeRegisterAction, saveRegisterAction } from './actions';
import { VoucherForm, type VoucherInit } from './voucher-form';
import { ReceiptScan } from './receipt-scan';

type SP = { reg?: string; nov?: string; edit?: string; set?: string; from?: string; to?: string; saldo?: string };

const CURS = ['MKD', ...FX_DEF.map((x) => x[0])];
const CAT_KONTA = [...new Set(['44010', '44011', '44021', ...Object.values(CASH_EXPENSE_CATEGORIES).flatMap((c) => [...c[1]])])];

export default async function BlagajnaPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const { u, firm, year } = await booksPage('blagajna');
  if (!firm) return <NoFirm t="Благајна" />;
  const write = canDo(u, 'write', firm.id), del = canDo(u, 'del', firm.id);
  const R = await loadRegisters(db(), firm.id);
  const [chart, P] = await Promise.all([effectiveChart(db(), firm.id), partnerOptions(firm.id)]);
  const kName = (k: string | null | undefined) => chart.find((a) => a.code === k)?.name ?? '';
  const datalist = <datalist id="blgK">{chart.map((a) => <option key={a.code} value={a.code}>{a.name}</option>)}</datalist>;

  if (!R.length) {
    return (
      <>
        <Hd t="Благајна" />
        <div className="callout">Фирмата сè уште нема благајна. Основни: <b>1020 Главна благајна (МКД)</b>, а ако постојат во контниот план и <b>1051</b> / <b>1052</b> девизни благајни (EUR).</div>
        {write && <RowAction className="btn pri" action={createDefaultRegistersAction} label="Креирај благајни" />}
      </>
    );
  }
  const reg = R.find((r) => r.id === sp.reg) ?? R[0]!;
  const fxR = reg.cur !== 'MKD';
  const from = inYearOr(sp.from, year, `${year}-01-01`), to = inYearOr(sp.to, year, `${year}-12-31`);
  const X = await db().transaction((tx) => cashBook(tx, firm.id, reg, from, to));
  const saldo = sp.saldo === '1';
  const q = (o: Partial<SP>) => {
    const p = new URLSearchParams({ reg: reg.id, ...(sp.from ? { from } : {}), ...(sp.to ? { to } : {}), ...(saldo ? { saldo: '1' } : {}) });
    for (const [k, v] of Object.entries(o)) if (v == null) p.delete(k); else p.set(k, v);
    return '/blagajna?' + p.toString();
  };

  /* ---------- editor ---------- */
  let init: VoucherInit | null = null;
  const editRow = sp.edit ? (await db().select().from(cashVouchers).where(and(eq(cashVouchers.id, sp.edit), eq(cashVouchers.firmId, firm.id))).limit(1))[0] : undefined;
  const today = new Date().toISOString().slice(0, 10);
  const d0 = today.startsWith(String(year)) ? today : `${year}-12-31`;
  if (write && editRow) {
    const fn = editRow.fileId ? (await db().select({ name: files.name }).from(files).where(eq(files.id, editRow.fileId)).limit(1))[0]?.name : undefined;
    init = {
      id: editRow.id, kind: editRow.kind, reg: editRow.registerId, date: editRow.date, number: editRow.number, docNo: editRow.docNo ?? '',
      merchant: editRow.merchant ?? '', vatId: editRow.vatId ?? '', country: editRow.country, cur: editRow.cur, amt: String(Number(editRow.amt)),
      fx: String(Number(editRow.fx)), rate: editRow.vatRate, vat: editRow.vat == null ? '' : String(Number(editRow.vat)), cat: editRow.cat ?? 'other',
      konto: editRow.konto ?? '', partner: editRow.partnerId ?? '', note: editRow.note ?? '', liters: editRow.liters ? String(Number(editRow.liters)) : '',
      ...(editRow.fileId ? { fileId: editRow.fileId, fileName: fn } : {}),
    };
  } else if (write && (sp.nov === 'in' || sp.nov === 'out')) {
    const country = reg.cur === 'MKD' ? 'MK' : '';
    const missing = new Set(await missingAccounts(db(), firm.id, CAT_KONTA));
    init = {
      kind: sp.nov, reg: reg.id, date: d0, number: '', docNo: '', merchant: '', vatId: '', country: country || 'DE', cur: reg.cur, amt: '', fx: '',
      rate: country === 'MK' ? 10 : 0, vat: '', cat: 'fuel', konto: sp.nov === 'in' ? '1000' : cashExpenseAccount('fuel', country !== 'MK', (k) => !missing.has(k)),
      partner: '', note: '', liters: '',
    };
  }
  let editor: React.ReactNode = null;
  if (init) {
    const [fx, missing, nn] = await Promise.all([
      loadFxSources(db(), firm.id),
      missingAccounts(db(), firm.id, CAT_KONTA),
      Promise.all(R.flatMap((r) => (['in', 'out'] as const).map(async (k) => [r.id + ':' + k, await nextVoucherNo(db(), r.id, k, init!.date)] as const))),
    ]);
    if (init.cur !== 'MKD' && !init.fx) {
      init.fx = String(fxRate(init.cur, init.date, fx) || '');
    }
    editor = <VoucherForm init={init} registers={R} partners={P} kontos={CAT_KONTA.filter((k) => !missing.includes(k))} fx={fx} ddv={firm.vatRegistered}
      curs={CURS} firmId={firm.id} nextNo={Object.fromEntries(nn)} />;
  }

  // bulk receipt scanning (legacy `blgScanFiles` / `blgBatchHTML`): only when no editor is open
  let scan: React.ReactNode = null;
  if (write && !init) {
    const [fxS, missing] = await Promise.all([loadFxSources(db(), firm.id), missingAccounts(db(), firm.id, CAT_KONTA)]);
    scan = <ReceiptScan firmId={firm.id} registers={R} reg0={reg.id} kontos={CAT_KONTA.filter((k) => !missing.includes(k))} codes={chart.map((a) => a.code)}
      fx={fxS} ddv={firm.vatRegistered} curs={CURS} />;
  }

  const closing = X.closing;
  return (
    <>
      <Hd t="Благајна" sub={`${reg.name} · конто ${reg.konto} · ${reg.cur}`}>
        <Link className="btn" href={`/kkart?k=${reg.konto}`}>Картица {reg.konto}</Link>
        <Link className="btn" href={q({ set: sp.set ? undefined : '1' })}>⚙ Благајни</Link>
        <DownloadCsv name={`Blagajna_${reg.konto}_${year}.csv`} label="Excel" rows={[
          ['Датум', 'Налог', 'Број', 'Документ', 'Опис', 'Земја', 'Валута', 'Износ во валута', 'Уплата', 'Исплата', 'Салдо'],
          ...X.rows.map((r) => [dmy(r.date), r.nalog ?? '', r.voucher?.number ?? '', r.doc, r.label, r.voucher?.country ?? '', r.voucher?.cur ?? '',
            r.voucher && r.voucher.cur !== 'MKD' ? Number(r.voucher.amt) : '', r.debit, r.credit, r.balance]),
        ]} />
        <Link className="btn" href={`/blagajna/dnevnik?reg=${reg.id}&from=${from}&to=${to}`} target="_blank">PDF дневник</Link>
        {write && <Link className="btn" href={q({ nov: 'in', edit: undefined })}>+ Уплатница</Link>}
        {write && <Link className="btn pri" href={q({ nov: 'out', edit: undefined })}>+ Исплатница / сметка</Link>}
      </Hd>
      <div className="row" style={{ gap: 6, margin: '-4px 0 10px', flexWrap: 'wrap' }}>
        {R.map((r) => <Link key={r.id} className={`btn sm ${r.id === reg.id ? 'pri' : ''}`} href={`/blagajna?reg=${r.id}`}>{r.name} · {r.cur}</Link>)}
      </div>
      {datalist}

      {sp.set && (
        <div className="card">
          <div className="hd"><h2>Благајни на фирмата</h2><Link className="btn" href={q({ set: undefined })}>Затвори</Link></div>
          <div className="tw"><table className="dense"><thead><tr><th>Назив · Конто · Валута</th></tr></thead>
            <tbody>{R.map((r) => (
              <tr key={r.id}><td>
                <BankForm action={saveRegisterAction} className="row" style={{ gap: 6, flexWrap: 'nowrap' }}>
                  <input type="hidden" name="id" value={r.id} />
                  <input name="name" defaultValue={r.name} style={{ width: 280 }} disabled={!write} />
                  <input name="konto" list="blgK" defaultValue={r.konto} style={{ width: 100 }} disabled={!write} />
                  <small className="mut">{kName(r.konto)}</small>
                  <select name="cur" defaultValue={r.cur} disabled={!write}>{CURS.map((c) => <option key={c}>{c}</option>)}</select>
                  {write && <button className="btn sm">Зачувај</button>}
                  {write && R.length > 1 && <RowAction action={removeRegisterAction.bind(null, r.id)} label="✕" className="btn sm ghost danger" confirm={`Да се отстрани благајната „${r.name}“?`} />}
                </BankForm>
              </td></tr>
            ))}</tbody></table></div>
          {write && (
            <BankForm action={saveRegisterAction} className="row" style={{ gap: 6 }}>
              <input name="name" placeholder="Назив, на пр. Девизна благајна" style={{ width: 280 }} required />
              <input name="konto" list="blgK" placeholder="Конто" style={{ width: 100 }} required />
              <select name="cur" defaultValue="MKD">{CURS.map((c) => <option key={c}>{c}</option>)}</select>
              <button className="btn">+ Благајна</button>
            </BankForm>
          )}
          <p className="note">На пр. 1020 Главна благајна (МКД), 1051 Девизна благајна за службени патувања (EUR), 1052 Девизна благајна за транспорт (EUR). Налогот за секоја благајна го носи бројот на контото (1020/7-9, 1051/7-9…).</p>
        </div>
      )}

      {scan}
      {editor}

      <div className="tiles">
        <div className="tile"><span>Почетно салдо</span><b>{fmt(X.opening)}</b>{fxR && <i>{fmt(X.openingCur)} {reg.cur}</i>}</div>
        <div className="tile"><span>Уплати (Должи)</span><b>{fmt(X.debit)}</b></div>
        <div className="tile"><span>Исплати (Побарува)</span><b>{fmt(X.credit)}</b></div>
        <div className="tile"><span>Салдо на благајна</span><b style={{ color: closing < -0.009 ? 'var(--bad)' : 'var(--ink)' }}>{fmt(closing)}</b>
          {fxR && <i>{fmt(X.closingCur)} {reg.cur}</i>}{closing < -0.009 && <i style={{ color: 'var(--bad)' }}>негативно салдо – недостасува уплата</i>}</div>
      </div>

      <form className="card"><div className="row" style={{ gap: '10px 16px', alignItems: 'end' }}>
        <input type="hidden" name="reg" value={reg.id} />
        <label className="mini">Од <input type="date" name="from" defaultValue={from} /></label>
        <label className="mini">До <input type="date" name="to" defaultValue={to} /></label>
        <label className="chk mini"><input type="checkbox" name="saldo" value="1" defaultChecked={saldo} /> прикажи колона салдо</label>
        <button className="btn">Прикажи</button>
      </div></form>

      <div className="tw"><table className="dense">
        <thead><tr><th>Датум</th><th>Налог</th><th>Број</th><th>Документ (бр. сметка)</th><th>Опис</th><th>Земја</th>{!fxR && <th className="n">Во валута</th>}
          <th className="n">Уплата</th><th className="n">Исплата</th>{saldo && <><th className="n">Салдо</th>{fxR && <th className="n">Салдо {reg.cur}</th>}</>}<th></th></tr></thead>
        <tbody>
          {(X.opening || X.openingCur) ? (
            <tr><td></td><td></td><td></td><td></td><td><i>Почетно салдо</i></td><td></td>{!fxR && <td></td>}
              <td className="n">{X.opening > 0 ? fmt(X.opening) : ''}</td><td className="n">{X.opening < 0 ? fmt(-X.opening) : ''}</td>
              {saldo && <><td className="n">{fmt(X.opening)}</td>{fxR && <td className="n">{fmt(X.openingCur)}</td>}</>}<td></td></tr>
          ) : null}
          {X.rows.map((r, i) => {
            const v = r.voucher;
            return (
              <tr key={i}>
                <td>{dmy(r.date)}</td>
                <td>{r.nalog && <Link className="btn sm ghost" href={`/nalozi?n=${encodeURIComponent(r.nalog)}`}>{r.nalog}</Link>}</td>
                <td>{v?.number ?? ''}</td><td>{r.doc}</td>
                <td>{r.label}{v && v.kind === 'out' && v.cat ? <small className="mut"> {CASH_EXPENSE_CATEGORIES[v.cat]?.[0] ?? ''}</small> : null}
                  {v?.fileId && <> <a href={`/api/files/${v.fileId}`} target="_blank" rel="noopener" title="Скен на сметката">📎</a></>}</td>
                <td>{v?.country ?? ''}</td>
                {!fxR && <td className="n">{v && v.cur !== 'MKD' ? `${fmt(Number(v.amt))} ${v.cur}` : ''}</td>}
                <td className="n"><b>{r.debit ? fmt(r.debit) : ''}</b></td><td className="n"><b>{r.credit ? fmt(r.credit) : ''}</b></td>
                {saldo && <><td className="n">{fmt(r.balance)}</td>{fxR && <td className="n">{fmt(r.balanceCur)}</td>}</>}
                <td>{v && (
                  <div className="row" style={{ flexWrap: 'nowrap', gap: 2 }}>
                    {write && <Link className="btn sm" href={q({ edit: v.id, nov: undefined })}>Измени</Link>}
                    {del && <RowAction action={deleteVoucherAction.bind(null, v.id)} label="🗑" className="btn sm ghost danger" confirm={`Да се избрише ${v.number}?`} />}
                  </div>
                )}</td>
              </tr>
            );
          })}
          {!X.rows.length && <tr><td colSpan={12} className="empty">Нема промет на оваа благајна во периодот.</td></tr>}
        </tbody>
        <tfoot><tr><td colSpan={fxR ? 6 : 7}>Вкупно</td><td className="n">{fmt(X.debit)}</td><td className="n">{fmt(X.credit)}</td>
          {saldo && <><td className="n">{fmt(closing)}</td>{fxR && <td></td>}</>}<td></td></tr></tfoot>
      </table></div>
      <div className="callout"><b>Книжење:</b> исплатница / фискална сметка → Должи трошок (+ претходен ДДВ само за македонски сметки со ДДВ), <b>Побарува благајна</b>.
        Странска сметка → се пресметува во денари по курсот од курсната листа, странскиот ДДВ влегува во трошокот. Уплатница → Должи благајна / Побарува спротивно конто
        (на пр. 1000 подигање од банка, 1431 враќање аконтација). Подигање готовина од банка може и преку изводот (конто {reg.konto}).</div>
    </>
  );
}
