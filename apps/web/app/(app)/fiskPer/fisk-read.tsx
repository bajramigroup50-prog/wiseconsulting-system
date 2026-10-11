'use client';
/**
 * Legacy `fiskPer` v2 result card (11419 + wrappers 13043, 13103–13123, 13151): „1. Промет“ with the rows of the read
 * (per group with VAT, cash, card, checks), VAT status, per-day / summed posting, posting date (ДД.ММ.ГГГГ), МЕТГ days,
 * posting scheme + cash account, location, revenue and card accounts, warnings, „ги проверив разликите“, then
 * „2. Излез на стока“ (method, plan, items). Options that change the computed rows / plan (location, VAT, sum, method,
 * scheme) re-render on the server through the URL; the rest stays in the form.
 */
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useActionState, useState } from 'react';
import type { ActionState } from '@/lib/books';
import { dmy, fmt, fq } from '@/lib/fmt';
import { postReadAction } from './actions';

export interface ReadRow { date: string; z: string; gross: Record<string, number>; vat: Record<string, number>; total: number; cash: number; card: number; probs: string[] }
export interface PlanRow { date: string; name: string; unit: string; rate: number; qty: number; price: number }

const isoOf = (v: string): string => {
  const s = v.trim();
  let m = s.match(/^(\d{1,2})[.\/\- ](\d{1,2})[.\/\- ](\d{2}|\d{4})$/);
  if (/^\d{8}$/.test(s)) m = [s, s.slice(0, 2), s.slice(2, 4), s.slice(4)] as unknown as RegExpMatchArray;
  if (!m) return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : '';
  const y = m[3]!.length === 2 ? '20' + m[3] : m[3]!;
  const mo = +m[2]!, da = +m[1]!;
  if (mo < 1 || mo > 12 || da < 1 || da > 31) return '';
  const x = `${y}-${String(mo).padStart(2, '0')}-${String(da).padStart(2, '0')}`;
  return new Date(x + 'T00:00:00').getDate() === da ? x : '';
};

export function FiskReadPost(p: {
  ai?: string | null; manual?: { total: number; from: string; to: string; card?: number; group: 'Г0' | 'А' | 'Б' | 'В' | 'Г'; device?: string } | null; from: string; to: string; device: string; edb: string; edbOk: boolean; G: Record<string, number>; Ls: string[];
  rows: ReadRow[]; daily: boolean; dayCount: number; nonVat: boolean; sum: boolean; sc: 'trg' | 'usl' | 'trgNoVat'; schemes: [string, string][];
  wh: string; locs: { id: string; name: string; kind: string }[]; rev: string; cashK: string; cardK: string; existing: number;
  meth: 'fifo' | 'lifo' | 'prop'; plan: PlanRow[] | null; planTarget: number; planRest: number; hasGoods: boolean;
}) {
  const router = useRouter();
  const path = usePathname();
  const sp = useSearchParams();
  const go = (k: string, v: string) => { const q = new URLSearchParams(sp.toString()); q.set(k, v); router.push(`${path}?${q.toString()}`); };
  const [st, action, pending] = useActionState<ActionState, FormData>(postReadAction, {});
  const [date, setDate] = useState(dmy(p.rows[0]?.date ?? ''));
  const [mg, setMg] = useState<'spread' | 'one'>('spread');
  const [rev, setRev] = useState(p.rev);
  const [cashK, setCashK] = useState(p.cashK);
  const [cardK, setCardK] = useState(p.cardK);
  const [ok, setOk] = useState(false);
  const [issue, setIssue] = useState(false);
  const bad = p.rows.filter((r) => r.probs.length).length;
  const T = p.rows.reduce((a, r) => {
    a.t += r.total; a.c += r.cash; a.k += r.card;
    for (const L of p.Ls) { a.g[L] = (a.g[L] ?? 0) + (r.gross[L] ?? 0); a.v[L] = (a.v[L] ?? 0) + (r.vat[L] ?? 0); }
    return a;
  }, { t: 0, c: 0, k: 0, g: {} as Record<string, number>, v: {} as Record<string, number> });
  const single = p.rows.length === 1;
  const iso = isoOf(date);
  const store = p.locs.find((l) => l.id === p.wh)?.kind === 'store';
  const payload = { ai: p.ai ?? null, manual: p.manual ?? null, wh: p.wh, nonVat: p.nonVat, sum: p.sum, date: single ? iso || null : null, mg, sc: p.sc, rev, cashK, cardK, issue: issue && p.sc === 'trg' && !!p.plan?.length, meth: p.meth };
  const planTot = (p.plan ?? []).reduce((a, l) => a + l.qty * l.price, 0);
  return (
    <form action={action} onSubmit={(e) => { if (!window.confirm(`Да се прокнижат ${p.rows.length} ${p.rows.length === 1 ? 'запис' : 'дневни прометa'} (вкупно ${fmt(T.t)} ден.${p.nonVat ? ', без ДДВ' : ''}) во „${p.locs.find((l) => l.id === p.wh)?.name ?? ''}“?`)) e.preventDefault(); }}>
      <input type="hidden" name="payload" value={JSON.stringify(payload)} />
      {st.error && <div className="callout bad" role="alert">{st.error}</div>}
      <div className="card" style={{ borderColor: 'var(--accent)' }}>
        <div className="hd"><h2 style={{ fontSize: 16 }}>1. Промет · {dmy(p.from) || dmy(p.rows[0]?.date)} – {dmy(p.to) || dmy(p.rows[p.rows.length - 1]?.date)}</h2>
          {bad ? <span className="pill bad">{bad} со разлика</span> : <span className="pill good">контролите се во ред</span>}</div>
        <div className="row" style={{ gap: 14, flexWrap: 'wrap', marginBottom: 6 }}>
          {p.device && <span className="mini">Апарат <b>{p.device}</b></span>}
          {p.edb && <span className="mini">ЕДБ на извештајот {p.edb}{p.edbOk ? ' ✓' : <> <span className="pill bad">не е ЕДБ на фирмата</span></>}</span>}
          <label className="chk" style={{ margin: 0 }}><input type="checkbox" checked={p.nonVat} onChange={(e) => go('nv', e.target.checked ? '1' : '0')} /> фирмата <b>не е ДДВ обврзник</b> (само вкупен промет)</label>
          {p.daily && p.dayCount > 1 && <label className="mini">Книжење <select style={{ width: 'auto' }} value={p.sum ? '1' : '0'} onChange={(e) => go('sum', e.target.value)}>
            <option value="0">по денови ({p.dayCount})</option><option value="1">вкупно за периодот</option></select></label>}
          {single && <label className="mini">Датум на книжење <input inputMode="numeric" placeholder="ДД.ММ.ГГГГ" value={date} style={{ width: 130, borderColor: date && !iso ? 'var(--bad)' : undefined }}
            onChange={(e) => { const d = e.target.value.replace(/\D/g, ''); setDate(/^\d+$/.test(e.target.value) && d.length === 8 ? `${d.slice(0, 2)}.${d.slice(2, 4)}.${d.slice(4)}` : e.target.value); }}
            onBlur={() => { if (iso) setDate(dmy(iso)); }} /></label>}
        </div>
        {single && (p.daily && p.dayCount > 1
          ? <p className="mini" style={{ margin: '0 0 6px' }}>📒 МЕТГ: прометот ќе се запише <b>по денови</b> од дневните Z извештаи ({p.dayCount} дена), иако налогот е еден.</p>
          : <>
            <div className="callout warn" style={{ margin: '0 0 6px' }}>⚠ Извештајот нема <b>дневни износи</b>. За МЕТГ се потребни прометите за секој ден – побарајте од клиентот <b>детален периодичен извештај по денови (по Z извештаи)</b> од фискалниот апарат и скенирајте го (тогаш сè е точно). Додека не го донесе, прометот може привремено да се распредели.</div>
            <label className="mini" style={{ display: 'block', margin: '0 0 6px' }}>📒 МЕТГ по денови: <select style={{ width: 'auto' }} value={mg} onChange={(e) => setMg(e.target.value as 'spread' | 'one')}>
              <option value="spread">привремено: распредели еднакво по работни денови (пон–саб) – означено „распределено“</option><option value="one">еден ред на датумот на книжење</option></select> <span style={{ color: 'var(--muted)' }}>– точно е кога клиентот ќе донесе периодичен извештај <b>со дневните износи</b> (детален по Z).</span></label>
          </>)}
        <div className="tw" style={{ maxHeight: 340, overflow: 'auto' }}><table className="dense">
          <thead><tr><th>Датум</th><th>Z</th>{p.Ls.map((L) => p.nonVat ? <th key={L} className="n">Промет</th> : [<th key={L} className="n">{L} {p.G[L]}%</th>, <th key={L + 'v'} className="n">ДДВ</th>])}<th className="n">Вкупно</th><th className="n">Готовина</th><th className="n">Картичка</th><th>Контрола</th></tr></thead>
          <tbody>{p.rows.map((r, i) => (
            <tr key={i}><td>{dmy(r.date)}</td><td>{r.z}</td>
              {p.Ls.map((L) => p.nonVat ? <td key={L} className="n">{fmt(r.gross[L] ?? 0)}</td> : [<td key={L} className="n">{fmt(r.gross[L] ?? 0)}</td>, <td key={L + 'v'} className="n mini">{fmt(r.vat[L] ?? 0)}</td>])}
              <td className="n"><b>{fmt(r.total)}</b></td><td className="n">{fmt(r.cash)}</td><td className="n">{fmt(r.card)}</td>
              <td>{r.probs.length ? r.probs.map((x, k) => <div key={k} className="mini" style={{ color: 'var(--bad)' }}>{x}</div>) : '✓'}</td></tr>
          ))}</tbody>
          {p.rows.length > 1 && <tfoot><tr><td colSpan={2}>Вкупно</td>{p.Ls.map((L) => p.nonVat ? <td key={L} className="n">{fmt(T.g[L])}</td> : [<td key={L} className="n">{fmt(T.g[L])}</td>, <td key={L + 'v'} className="n">{fmt(T.v[L])}</td>])}<td className="n">{fmt(T.t)}</td><td className="n">{fmt(T.c)}</td><td className="n">{fmt(T.k)}</td><td /></tr></tfoot>}
        </table></div>
        <div className="row" style={{ gap: 12, flexWrap: 'wrap', margin: '8px 0' }}>
          <label className="f" style={{ flex: 2, minWidth: 280 }}>Шема на книжење<select value={p.sc} onChange={(e) => go('sc', e.target.value)}>{p.schemes.map(([v, n]) => <option key={v} value={v}>{n}</option>)}</select></label>
          <label className="f" style={{ flex: 1, minWidth: 140 }}>Конто за готовина<input value={cashK} onChange={(e) => setCashK(e.target.value)} /></label>
        </div>
        <div className="form" style={{ marginTop: 10 }}>
          <label className="f">Продавница / каса<select value={p.wh} onChange={(e) => go('wh', e.target.value)}>{p.locs.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select></label>
          <label className="f">Конто за приход<input value={rev} onChange={(e) => setRev(e.target.value)} style={{ width: 120 }} /></label>
          <label className="f">Конто за картичка<input value={cardK} onChange={(e) => setCardK(e.target.value)} style={{ width: 120 }} /></label>
        </div>
        {p.existing > 0 && <div className="callout warn">⚠ За {p.existing} ден(а) во овој период веќе има промет во оваа каса – со книжењето ќе се <b>заменат</b>.</div>}
        {p.sc !== 'usl' && !store && <div className="callout warn" style={{ margin: '8px 0' }}>⚠ „{p.locs.find((l) => l.id === p.wh)?.name}“ не е продавница – дневниот промет нема да се прикаже во <b>МЕТГ</b> (евиденција во трговија на мало). Ако фирмата има продавница, додајте ја во <b>Шифрарник → Продавници</b> и изберете ја овде. За фирма само со услуги изберете шема „Само услуги“.</div>}
      </div>
      <div className="card">
        <div className="hd"><h2 style={{ fontSize: 15, margin: 0 }}>2. Излез на стока{p.sc === 'trg' && p.hasGoods ? ` од „${p.locs.find((l) => l.id === p.wh)?.name}“ до вредноста на прометот` : ''}</h2></div>
        {p.sc !== 'trg' ? <p className="note" style={{ margin: '6px 0 0' }}>{p.sc === 'usl' ? 'Фирма за услуги – нема излез на стока.' : <>Залихата во продавницата се раздолжува во истиот налог: <b>Д 6690 / П 6630</b> за вкупниот промет.</>}</p>
          : !p.hasGoods ? <p className="mini" style={{ margin: 0 }}>Во „{p.locs.find((l) => l.id === p.wh)?.name}“ нема залиха на стока – излез не е потребен (или прво внесете ја почетната залиха / приемниците).</p>
            : <>
              <div className="row" style={{ gap: 12, flexWrap: 'wrap', alignItems: 'end' }}>
                <label className="mini">Метод<select style={{ width: 'auto' }} value={p.meth} onChange={(e) => go('meth', e.target.value)}>
                  <option value="fifo">FIFO – прво најстарата стока</option><option value="lifo">LIFO – прво најновата стока</option><option value="prop">Пропорционално на залихата</option></select></label>
                <span className="mini">Се избираат артикли со залиха по малопродажна цена{p.nonVat ? '' : <> и <b>по иста ДДВ стапка</b> како прометот (А 18% → артикли со 18%…)</>}, до износот на прометот. Артиклите на парче се земаат во цели количини.</span>
              </div>
              <p style={{ margin: '8px 0' }}>Промет <b>{fmt(p.planTarget)}</b> · избрана стока <b>{fmt(planTot)}</b> ({p.plan?.length ?? 0} ставки) · {Math.abs(p.planRest) < 1 ? <span className="pill good">се совпаѓа</span> : <>остаток <b>{fmt(p.planRest)}</b> {p.planRest > 0 && <span className="pill warn">нема доволно залиха / ситна разлика</span>}</>}</p>
              <details><summary className="mini" style={{ cursor: 'pointer' }}>Прикажи ги ставките</summary><div className="tw" style={{ maxHeight: 300, overflow: 'auto' }}><table className="dense">
                <thead><tr><th>Датум</th><th>Артикл</th><th className="n">Кол.</th><th className="n">МПЦ</th><th className="n">Вредност</th></tr></thead>
                <tbody>{(p.plan ?? []).map((l, i) => <tr key={i}><td>{dmy(l.date)}</td><td>{l.name} <span className="mini">{l.rate}%</span></td><td className="n">{fq(l.qty)} {l.unit}</td><td className="n">{fmt(l.price)}</td><td className="n">{fmt(l.qty * l.price)}</td></tr>)}</tbody>
              </table></div></details>
              <label className="chk" style={{ marginTop: 8 }}><input type="checkbox" checked={issue} onChange={(e) => setIssue(e.target.checked)} /> 📦 Направи излез на стока заедно со книжењето</label>
              {issue && !p.plan?.length && <span className="pill warn">Нема ставки за излез.</span>}
            </>}
      </div>
      <div className="row" style={{ justifyContent: 'flex-end', gap: 8, marginTop: 10 }}>
        {bad > 0 && <label className="chk" style={{ margin: 0 }}><input type="checkbox" checked={ok} onChange={(e) => setOk(e.target.checked)} /> ги проверив разликите</label>}
        <div className="savebar"><button className="btn pri" disabled={pending || (bad > 0 && !ok) || (single && !iso)}>✓ Прокнижи го прометот</button></div>
      </div>
    </form>
  );
}
