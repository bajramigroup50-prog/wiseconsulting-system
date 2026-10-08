'use client';
/**
 * Cash voucher editor (legacy `blgEditorHTML` 6569 + change handler `upd`): country → currency, rate and
 * expense konto; currency / date → exchange rate (`fxRate`: firm codebook → office list → default, FIX 4.4 #4);
 * category → konto and the Macedonian VAT rate (fuel 10 %). Receipt photo goes to MinIO (`uploadFile`).
 */
import Link from 'next/link';
import { useActionState, useState } from 'react';
import { CASH_COUNTRIES, CASH_COUNTRY_CURRENCY, cashDefaultRate } from '@wise/core/bank/cash';
import { CASH_EXPENSE_CATEGORIES } from '@wise/core/data/posting';
import { cashExpenseAccount } from '@wise/core/posting';
import { fxRate, type FxRateRow } from '@wise/core/bank-match';
import { r2 } from '@wise/core/money';
import { uploadFile } from '@/lib/upload';
import { fmt } from '@/lib/fmt';
import type { FormState } from '@/components/action-form';
import { saveVoucherAction } from './actions';

export interface VoucherInit {
  id?: string; kind: 'in' | 'out'; reg: string; date: string; number: string; docNo: string; merchant: string; vatId: string; country: string;
  cur: string; amt: string; fx: string; rate: number; vat: string; cat: string; konto: string; partner: string; note: string; liters: string;
  fileId?: string; fileName?: string;
}

export function VoucherForm({ init, registers, partners, kontos, fx, ddv, curs, firmId, nextNo }: {
  init: VoucherInit;
  registers: { id: string; name: string; konto: string; cur: string }[];
  partners: { id: string; name: string }[];
  /** Expense kontos that exist in the firm chart (for the category → konto suggestion). */
  kontos: string[];
  fx: { firm: FxRateRow[]; office: FxRateRow[] };
  ddv: boolean;
  curs: string[];
  firmId: string;
  nextNo: Record<string, string>;
}) {
  const [st, action, pending] = useActionState<FormState, FormData>(saveVoucherAction, {});
  const [v, setV] = useState(init);
  const [up, setUp] = useState<string>('');
  const inn = v.kind === 'in';
  const has = new Set(kontos);
  const kontoFor = (cat: string, country: string) => cashExpenseAccount(cat, country !== 'MK', (k) => has.has(k));
  const rateOf = (cur: string, date: string) => (cur === 'MKD' ? '1' : String(fxRate(cur, date, fx) || ''));
  const set = (patch: Partial<VoucherInit>) => setV((o) => ({ ...o, ...patch }));
  const reg = registers.find((r) => r.id === v.reg) ?? registers[0]!;

  const onCountry = (country: string) => {
    const cur = CASH_COUNTRY_CURRENCY[country] ?? v.cur;
    set({ country, cur, fx: rateOf(cur, v.date), rate: cashDefaultRate(v.cat, country), vat: '', konto: inn ? v.konto : kontoFor(v.cat, country) });
  };
  const onCat = (cat: string) => set({ cat, konto: kontoFor(cat, v.country), ...(v.country === 'MK' ? { rate: cashDefaultRate(cat, 'MK'), vat: '' } : {}) });

  // preview (same rules as blgCalc: VAT deductible only for MK expenses of a VAT firm)
  const fxN = v.cur === 'MKD' ? 1 : Number(v.fx) || 0;
  const mkd = r2((Number(v.amt) || 0) * fxN);
  const ded = !inn && v.country === 'MK' && ddv && v.rate > 0;
  const vat = ded ? (v.vat !== '' ? r2(Number(v.vat) * fxN) : r2((mkd * v.rate) / (100 + v.rate))) : 0;

  return (
    <form className="card" style={{ borderColor: 'var(--accent)' }} action={action}>
      <div className="hd"><h2>{inn ? 'Уплатница' : 'Исплатница'} {v.number || nextNo[v.reg + ':' + v.kind] || ''}</h2>
        <div className="row"><Link className="btn" href={`/blagajna?reg=${v.reg}`}>Откажи</Link><button className="btn pri" disabled={pending}>Зачувај</button></div></div>
      {st.error && <div className="callout bad" role="alert">{st.error}</div>}
      {st.ok && <div className="callout warn" role="status">{st.ok}</div>}
      {v.id && <input type="hidden" name="id" value={v.id} />}
      <input type="hidden" name="kind" value={v.kind} />
      <input type="hidden" name="fileId" value={v.fileId ?? ''} />
      <div className="form">
        <label className="f">Благајна<select name="reg" value={v.reg} onChange={(e) => {
          const r = registers.find((x) => x.id === e.target.value)!;
          set({ reg: r.id, number: '', ...(inn ? { cur: r.cur, fx: rateOf(r.cur, v.date) } : {}) });
        }}>{registers.map((r) => <option key={r.id} value={r.id}>{r.name} · {r.konto} · {r.cur}</option>)}</select></label>
        <label className="f">Датум<input type="date" name="date" value={v.date} required onChange={(e) => set({ date: e.target.value, ...(v.cur !== 'MKD' ? { fx: rateOf(v.cur, e.target.value) } : {}) })} /></label>
        <label className="f">Број ({inn ? 'уплатница' : 'исплатница'})<input name="number" value={v.number} placeholder={nextNo[v.reg + ':' + v.kind] ?? 'автоматски'} onChange={(e) => set({ number: e.target.value })} /></label>
        <label className="f">{inn ? 'Документ (бр.)' : 'Бр. на фискална сметка / фактура'}<input name="docNo" defaultValue={v.docNo} /></label>
        {!inn && <>
          <label className="f">Земја<select name="country" value={v.country} onChange={(e) => onCountry(e.target.value)}>
            {Object.entries(CASH_COUNTRIES).map(([k, n]) => <option key={k} value={k}>{k} · {n}</option>)}</select></label>
          <label className="f">Продавач<input name="merchant" defaultValue={v.merchant} /></label>
          <label className="f">ЕДБ / VAT на продавачот<input name="vatId" defaultValue={v.vatId} /></label>
          <label className="f">Вид трошок<select name="cat" value={v.cat} onChange={(e) => onCat(e.target.value)}>
            {Object.entries(CASH_EXPENSE_CATEGORIES).map(([k, c]) => <option key={k} value={k}>{c[0]}</option>)}</select></label>
        </>}
        <label className="f">{inn ? 'Спротивно конто (од каде)' : 'Конто на трошок'}<input name="konto" list="blgK" value={v.konto} onChange={(e) => set({ konto: e.target.value })} required={inn} /></label>
        <label className="f">Валута<select name="cur" value={v.cur} onChange={(e) => set({ cur: e.target.value, fx: rateOf(e.target.value, v.date) })}>
          {curs.map((c) => <option key={c}>{c}</option>)}</select></label>
        <label className="f">Износ ({v.cur})<input name="amt" inputMode="decimal" value={v.amt} required onChange={(e) => set({ amt: e.target.value, vat: '' })} /></label>
        {v.cur !== 'MKD' && <label className="f">Курс (1 {v.cur} = МКД)<input name="fx" inputMode="decimal" value={v.fx} onChange={(e) => set({ fx: e.target.value })} /></label>}
        {!inn && v.country === 'MK' && <>
          <label className="f">ДДВ стапка<select name="rate" value={v.rate} onChange={(e) => set({ rate: Number(e.target.value), vat: '' })}>
            {[18, 10, 5, 0].map((r) => <option key={r} value={r}>{r}%</option>)}</select></label>
          <label className="f">ДДВ на сметката (ако е отпечатен)<input name="vat" inputMode="decimal" value={v.vat} onChange={(e) => set({ vat: e.target.value })} /></label>
        </>}
        {!inn && v.cat === 'fuel' && <label className="f">Литри<input name="liters" inputMode="decimal" defaultValue={v.liters} /></label>}
        <label className="f">Комитент<select name="partner" defaultValue={v.partner}><option value="">—</option>
          {partners.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
        <label className="f wide">Опис<input name="note" defaultValue={v.note} /></label>
        <label className="f">Скен на сметката
          <input type="file" accept="application/pdf,image/*" onChange={async (e) => {
            const f = e.target.files?.[0];
            if (!f) return;
            setUp('Се прикачува…');
            const r = await uploadFile(f, firmId);
            if (!r.ok) { setUp('✗ ' + r.error); return; }
            set({ fileId: r.id, fileName: f.name });
            setUp(r.duplicate ? `↺ веќе постои како „${r.name}“` : '✓ ' + f.name);
            // TODO(ai): read the receipt with the Phase 3 AI client (legacy `BLG_PROMPT` 6525 / `blgScanFiles`) and prefill
            // date, docNo, merchant, country, currency, total, VAT rate/amount, category, liters.
          }} />
          {(up || v.fileName) && <small className="mut">{up || v.fileName}</small>}
        </label>
      </div>
      <div className="callout">Во денари: <b>{fmt(mkd)}</b>{vat ? <> · основа {fmt(mkd - vat)} + претходен ДДВ {fmt(vat)}</> : !inn && v.country !== 'MK' ? ' · странски ДДВ не се одбива (влегува во трошокот)' : ''}.
        {' '}Книжење: {inn ? <>Должи {reg.konto} / Побарува {v.konto || '—'}</> : <>Должи {v.konto}{vat ? ' + претходен ДДВ' : ''} / Побарува {reg.konto}</>}.</div>
    </form>
  );
}
