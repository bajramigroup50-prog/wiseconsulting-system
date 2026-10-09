'use client';
/**
 * Bulk receipt scanning (legacy `blgScanFiles` / `blgBatchHTML` / `blgRowHTML` 6539–6553, ACT `blgBSave` 7945):
 * drop photos / PDFs of receipts → each is read with `BLG_PROMPT` (worker) → one editable row per receipt →
 * „Зачувај N сметки“ saves and posts them as исплатници of the chosen register. Nothing is saved before that.
 */
import { useRouter } from 'next/navigation';
import { useEffect, useState, useTransition } from 'react';
import { receiptDraftProblem, receiptDrafts, type ReceiptDraft } from '@wise/core/ai/receipts';
import { CASH_COUNTRIES, CASH_COUNTRY_CURRENCY, cashDefaultRate } from '@wise/core/bank/cash';
import { CASH_EXPENSE_CATEGORIES } from '@wise/core/data/posting';
import { cashExpenseAccount } from '@wise/core/posting';
import { fxRate, type FxRateRow } from '@wise/core/bank-match';
import { r2 } from '@wise/core/money';
import { fmt } from '@/lib/fmt';
import { AiDrop, AiReadList, useAiRead } from '@/components/ai-read';
import { saveReceiptBatchAction } from './actions';

type Row = ReceiptDraft & { key: string; docId: string; fileId: string | null; fname: string };

export function ReceiptScan({ firmId, registers, reg0, kontos, codes, fx, ddv, curs }: {
  firmId: string;
  registers: { id: string; name: string; konto: string; cur: string }[];
  reg0: string;
  kontos: string[];
  /** Every konto of the firm chart (a row needs an existing konto). */
  codes: string[];
  fx: { firm: FxRateRow[]; office: FxRateRow[] };
  ddv: boolean;
  curs: string[];
}) {
  const router = useRouter();
  const ai = useAiRead(firmId);
  const [rows, setRows] = useState<Row[]>([]);
  const [done, setDone] = useState<Set<string>>(new Set());
  const [reg, setReg] = useState(reg0);
  const [res, setRes] = useState<{ ok?: string; error?: string }>({});
  const [saving, start] = useTransition();
  const has = new Set(kontos), chart = new Set(codes);
  const kontoFor = (cat: string, abroad: boolean) => cashExpenseAccount(cat, abroad, (k) => has.has(k));
  const rateOf = (cur: string, date: string) => (cur === 'MKD' ? 1 : fxRate(cur, date, fx) || '');

  // turn finished reads into rows (legacy: rows of the batch, one per receipt found)
  useEffect(() => {
    const fresh = ai.docs.filter((d) => d.status === 'done' && !done.has(d.id));
    if (!fresh.length) return;
    const today = new Date().toISOString().slice(0, 10);
    const add: Row[] = [];
    for (const d of fresh) {
      const D = receiptDrafts(d.result, { today, kontoFor, fxFor: (c, dt) => Number(rateOf(c, dt)) || 0 });
      if (!D.length) { ai.setDocs((X) => X.map((x) => (x.id === d.id ? { ...x, status: 'error', error: 'Не е пронајдена сметка на сликата.' } : x))); continue; }
      D.forEach((x, i) => add.push({ ...x, key: d.id + ':' + i, docId: d.id, fileId: d.fileId, fname: d.name + (D.length > 1 ? ' #' + (i + 1) : '') }));
    }
    setDone((s) => new Set([...s, ...fresh.map((d) => d.id)]));
    setRows((r) => [...r, ...add]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ai.docs]);

  const upd = (key: string, f: keyof ReceiptDraft, val: string) => setRows((R) => R.map((r) => {
    if (r.key !== key) return r;
    const x: Row = { ...r };
    if (f === 'country') { x.country = val; x.cur = CASH_COUNTRY_CURRENCY[val] ?? x.cur; x.fx = rateOf(x.cur, x.date); x.rate = cashDefaultRate(x.cat, val); x.vat = ''; x.konto = kontoFor(x.cat, val !== 'MK'); }
    else if (f === 'cat') { x.cat = val; x.konto = kontoFor(val, x.country !== 'MK'); if (x.country === 'MK') { x.rate = cashDefaultRate(val, 'MK'); x.vat = ''; } }
    else if (f === 'cur') { x.cur = val; x.fx = rateOf(val, x.date); }
    else if (f === 'date') { x.date = val; if (x.cur !== 'MKD') x.fx = rateOf(x.cur, val); }
    else if (f === 'amt' || f === 'fx') { x[f] = val === '' ? '' : Number(val.replace(',', '.')) || 0; if (f === 'amt') x.vat = ''; }
    else if (f === 'rate') { x.rate = Number(val); x.vat = ''; }
    else (x as unknown as Record<string, unknown>)[f] = val;
    return x;
  }));
  const calc = (d: Row) => {
    const mkd = r2((+d.amt || 0) * (d.cur === 'MKD' ? 1 : +d.fx || 0));
    const vat = d.country === 'MK' && ddv && d.rate > 0 ? (d.vat !== '' && d.cur === 'MKD' ? +d.vat : r2((mkd * d.rate) / (100 + d.rate))) : 0;
    return { mkd, vat };
  };
  const bad = rows.filter((r) => receiptDraftProblem(r, (k) => chart.has(k)));
  const save = () => {
    if (bad.length) { setRes({ error: `${bad.length} сметки немаат износ, курс или точно конто – поправете ги (жолто).` }); return; }
    start(async () => {
      const r = await saveReceiptBatchAction(reg, rows.map(({ key: _k, fname: _f, docId: _d, ...d }) => d), [...new Set(rows.map((r) => r.docId))]);
      setRes(r);
      if (!r.error) { setRows([]); setDone(new Set()); ai.reset(); router.refresh(); }
    });
  };

  return (
    <div className="card">
      <AiDrop onFiles={(f) => { setRes({}); void ai.read('blg', f); }} disabled={ai.busy && !ai.docs.length} small
        label={<><b>📷 Скенирај сметки</b> — повлечете слики (JPG/PNG) или PDF од фискалните / странските сметки тука или кликнете. Секоја се чита автоматски; потоа ги проверувате и зачувувате.</>} />
      <AiReadList docs={ai.docs} msg={ai.msg} />
      {res.error && <div className="callout bad" role="alert">{res.error}</div>}
      {res.ok && <div className="callout good" role="status">{res.ok}</div>}
      {rows.length > 0 && (
        <div style={{ borderTop: '1px solid var(--line)', marginTop: 8, paddingTop: 8 }}>
          <div className="hd"><h2>Прочитани сметки ({rows.length})</h2>
            <div className="row">
              <label className="mini">Исплатено од <select value={reg} onChange={(e) => setReg(e.target.value)}>
                {registers.map((r) => <option key={r.id} value={r.id}>{r.name} · {r.konto} · {r.cur}</option>)}</select></label>
              <button className="btn" type="button" onClick={() => { setRows([]); setDone(new Set()); ai.reset(); }}>Откажи</button>
              <button className="btn pri" type="button" onClick={save} disabled={saving || ai.busy}>Зачувај {rows.length} сметки</button>
            </div></div>
          <div className="tw"><table className="dense">
            <thead><tr><th>Датум</th><th>Земја</th><th>Бр. на сметка</th><th>Продавач</th><th>Вид трошок</th><th>Конто</th><th>Валута</th><th className="n">Износ</th><th className="n">Курс</th><th>ДДВ</th><th className="n">Денари</th><th>Скен</th><th></th></tr></thead>
            <tbody>{rows.map((d) => {
              const c = calc(d);
              return (
                <tr key={d.key} style={receiptDraftProblem(d, (k) => chart.has(k)) ? { background: 'var(--warn-soft,#fff5e6)' } : undefined}>
                  <td><input type="date" value={d.date} onChange={(e) => upd(d.key, 'date', e.target.value)} style={{ width: 132 }} /></td>
                  <td><select value={d.country} onChange={(e) => upd(d.key, 'country', e.target.value)} style={{ width: 72 }}>{Object.keys(CASH_COUNTRIES).map((k) => <option key={k}>{k}</option>)}</select></td>
                  <td><input value={d.docNo} onChange={(e) => upd(d.key, 'docNo', e.target.value)} style={{ width: 120 }} placeholder="бр. сметка" /></td>
                  <td><input value={d.merchant} onChange={(e) => upd(d.key, 'merchant', e.target.value)} style={{ width: 150 }} /></td>
                  <td><select value={d.cat} onChange={(e) => upd(d.key, 'cat', e.target.value)} style={{ width: 140 }}>{Object.entries(CASH_EXPENSE_CATEGORIES).map(([k, v]) => <option key={k} value={k}>{v[0]}</option>)}</select></td>
                  <td><input list="blgK" value={d.konto} onChange={(e) => upd(d.key, 'konto', e.target.value)} className="kin" style={{ width: 86 }} /></td>
                  <td><select value={d.cur} onChange={(e) => upd(d.key, 'cur', e.target.value)} style={{ width: 70 }}>{curs.map((k) => <option key={k}>{k}</option>)}</select></td>
                  <td><input inputMode="decimal" value={d.amt} onChange={(e) => upd(d.key, 'amt', e.target.value)} style={{ width: 90, textAlign: 'right' }} /></td>
                  <td>{d.cur === 'MKD' ? '' : <input inputMode="decimal" value={d.fx} onChange={(e) => upd(d.key, 'fx', e.target.value)} style={{ width: 72, textAlign: 'right' }} />}</td>
                  <td>{d.country === 'MK'
                    ? <select value={d.rate} onChange={(e) => upd(d.key, 'rate', e.target.value)} style={{ width: 66 }}>{[18, 10, 5, 0].map((r) => <option key={r} value={r}>{r}%</option>)}</select>
                    : <small className="mut">странски</small>}</td>
                  <td className="n"><b>{fmt(c.mkd)}</b>{c.vat ? <><br /><small className="mut">ДДВ {fmt(c.vat)}</small></> : null}</td>
                  <td>{d.fileId && <a href={`/api/files/${d.fileId}`} target="_blank" rel="noopener" title={d.fname}>📎</a>}</td>
                  <td><button type="button" className="btn sm ghost" style={{ color: 'var(--bad)' }} onClick={() => setRows((R) => R.filter((x) => x.key !== d.key))}>✕</button></td>
                </tr>
              );
            })}</tbody>
            <tfoot><tr><td colSpan={10}>Вкупно</td><td className="n">{fmt(rows.reduce((a, r) => a + calc(r).mkd, 0))}</td><td colSpan={2}></td></tr></tfoot>
          </table></div>
          <p className="note">Проверете го <b>бројот на сметката, датумот и износот</b> (жолто = недостасува нешто). Курсот е од шифрарникот „Странски валути“ – за точна пресметка внесете го средниот курс на НБРСМ на денот. Странскиот ДДВ не се одбива во Македонија и влегува во трошокот; македонскиот ДДВ (18/10/5%) се книжи како претходен ДДВ.</p>
        </div>
      )}
    </div>
  );
}
