'use client';
/**
 * Legacy `schEx` 5180–5205 „Шеми како налози – поправете го контото директно во налогот“: one example journal per
 * scheme; the konto is typed / picked in the journal and the same konto changes everywhere (also in „Сите поставки по
 * групи“, `data-sch` inputs are kept in sync like legacy), ✕ removes an optional row („-“ = не се користи, „+ Врати“),
 * the scheme can be renamed and hidden („Скриј“, „Скриени шеми: … ↺“). Saved with the page's „Зачувај“.
 */
import { useEffect, useState } from 'react';
import { J_LBL, jField, journalBalance, type JCard } from '@wise/core/sch-journals';

const kName = (k: string) => {
  if (!k) return '';
  const o = [...(document.getElementById('kpl')?.querySelectorAll('option') ?? [])].find((x) => x.value === k);
  return o ? o.textContent ?? '' : '⚠ контото не постои во контниот план';
};
const fv = (x: number | string) => (typeof x === 'string' ? x : x ? x.toLocaleString('mk-MK', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '');

export function SchJournals({ cards, vals, defs, names, hidden, ed }: {
  cards: JCard[]; vals: Record<string, string>; defs: Record<string, string>; names: Record<string, string>; hidden: string[]; ed: boolean;
}) {
  const [V, setV] = useState(vals);
  const [H, setH] = useState(hidden);
  const [mounted, setMounted] = useState(false);
  // legacy `data-sch` input listener: the same konto in every field of the page, names under the inputs
  useEffect(() => {
    const on = (e: Event) => {
      const t = e.target as HTMLInputElement;
      const k = t?.dataset?.sch;
      if (!k || t.type === 'checkbox') return;
      document.querySelectorAll<HTMLInputElement>(`[data-sch="${k}"]`).forEach((x) => { if (x !== t) x.value = t.value; });
      setV((o) => ({ ...o, [k]: t.value.trim() }));
    };
    document.addEventListener('input', on);
    setMounted(true); // konto names come from the datalist (after hydration, no mismatch)
    return () => document.removeEventListener('input', on);
  }, []);
  const set = (k: string, v: string) => {
    document.querySelectorAll<HTMLInputElement>(`[data-sch="${k}"]`).forEach((x) => { x.value = v; });
    setV((o) => ({ ...o, [k]: v }));
  };
  const hiddenList = cards.filter((c) => H.includes(c.id));
  return (
    <>
      <h2 style={{ margin: '18px 0 4px' }}>Шеми како налози – поправете го контото директно во налогот</h2>
      <p className="note" style={{ margin: '0 0 8px' }}>Кликнете на бројот на контото и внесете/изберете друго; истото конто се менува насекаде. <b>Д</b> = Должи, <b>П</b> = Побарува. Редовите со ✕ се дополнителни и може да се отстранат, а шемите што не ги користите – „Скриј“. Потоа „Зачувај“.</p>
      {H.map((id) => <input key={id} type="hidden" name="hid" value={id} />)}
      <div className="schg">
        {cards.filter((c) => !H.includes(c.id)).map((c) => {
          const live = c.rows.filter((r) => !r.key || V[r.key] !== '-');
          const b = journalBalance(live);
          return (
            <div className="card" key={c.id} style={c.wide ? { gridColumn: '1/-1' } : undefined}>
              <div className="hd" style={{ margin: '0 0 6px', gap: 8 }}>
                <input className="schname" name={'n_' + c.id} defaultValue={names[c.id] || c.title} aria-label="Назив на шемата" title="Кликнете за да го смените називот" disabled={!ed} />
                {ed && <button type="button" className="btn sm ghost" title="Скриј ја оваа шема (не ја користам)" onClick={() => setH((h) => [...h, c.id])}>Скриј</button>}
              </div>
              <table>
                <thead><tr><th>Конто</th><th>Страна</th><th className="n">Должи</th><th className="n">Побарува</th></tr></thead>
                <tbody>{c.rows.map((r, i) => {
                  const side = r.d ? 'd' : 'p';
                  const sideCell = <td className="c"><select className={`sidesel ${side === 'd' ? 'sd' : 'sp'}`} value={side} disabled aria-label="Страна"><option value="d">Д</option><option value="p">П</option></select></td>;
                  if (r.key && V[r.key] === '-') {
                    return (
                      <tr key={i} className="off"><td colSpan={4}>
                        <span className="note">{J_LBL[r.key] ?? r.key} – не се користи</span>{' '}
                        {ed && <button type="button" className="btn sm ghost" onClick={() => set(r.key!, defs[r.key!] && defs[r.key!] !== '-' ? defs[r.key!]! : '')}>+ Врати</button>}
                      </td></tr>
                    );
                  }
                  const k = r.key ? V[r.key] ?? '' : r.k ?? '';
                  return (
                    <tr key={i}>
                      <td><div className="kcell">
                        {r.key
                          ? <input data-sch={r.key} name={jField(r.key)} list="kpl" value={k} className="kin" aria-label="Конто" disabled={!ed} onChange={(e) => setV((o) => ({ ...o, [r.key!]: e.target.value }))} />
                          : <b>{k}</b>}
                        <span className="kn">{mounted ? kName(k) : ''}</span>
                        {ed && r.opt && <button type="button" className="btn sm ghost kx" title="Отстрани го овој ред (не се користи)" onClick={() => set(r.key!, '-')}>✕</button>}
                      </div></td>
                      {sideCell}
                      <td className="n">{fv(r.d)}</td><td className="n">{fv(r.p)}</td>
                    </tr>
                  );
                })}</tbody>
                <tfoot>{b.nums
                  ? <tr><td colSpan={2}>{b.ok ? <span className="pill good">изедначен</span> : <span className="pill bad">не е изедначен – проверете ги страните</span>}</td><td className="n">{fv(b.d)}</td><td className="n">{fv(b.p)}</td></tr>
                  : !b.ok && <tr><td colSpan={4}><span className="pill bad">Налогот мора да има и Д и П страна</span></td></tr>}</tfoot>
              </table>
            </div>
          );
        })}
      </div>
      {hiddenList.length > 0 && (
        <div className="card row" style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
          <b>Скриени шеми:</b> {hiddenList.map((c) => <button key={c.id} type="button" className="btn sm" style={{ width: 'auto' }} disabled={!ed} onClick={() => setH((h) => h.filter((x) => x !== c.id))}>{names[c.id] || c.title} ↺</button>)}
        </div>
      )}
    </>
  );
}
