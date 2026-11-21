'use client';
/**
 * A document list in the layout of the old desktop program (Helix): the firm in big letters and the line
 * „Магацин [..]“, the menu bar on top (Специјални опции, Безбедност, Сортирање…), the table in WISE's own colours,
 * the ▸ marker of the current row, the vertical panel of buttons on the right (with their keys), and the bottom
 * bar („Селекција: * + - F“, Прекнижување (F5), Главна книга (F7), Филтер, „F1 - Освежување на податоците“,
 * Излез (Esc)).
 *
 * Every control is mapped to a WISE feature (`HxAct`): a page (`href`), a link / button of the current row (`row`),
 * an event the page's own dialogs handle (`ev` → `hx:<name>` on `window`, `detail` = the row), or — where WISE has no
 * equivalent yet — shown disabled with the reason as its tooltip (`off`). The rows are the server-rendered
 * `tr[data-id]` of the table `tableId`; `data-sum` is the amount summed for the selection.
 */
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

export type HxAct = { href: string } | { row: string } | { ev: string } | { off: string } | { fn: 'refresh' | 'filter' | 'wh' | 'print' };
export interface HxBtn { label: string; key?: string; act: HxAct; title?: string; cls?: string }
export interface HxGroup { title?: string; items: HxBtn[] }
export interface HxMenu { label: string; items: HxBtn[]; off?: string }
export interface HxWh { value: string; options: { v: string; label: string }[] }

const nf = new Intl.NumberFormat('mk-MK', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const isOff = (a: HxAct): a is { off: string } => 'off' in a;
const keyName = (k?: string) => (k ? ` (${k === 'Insert' ? 'Ins' : k === 'Enter' ? 'Ent' : k === 'Delete' ? 'Del' : k === 'Escape' ? 'Esc' : k})` : '');

// layout only (WISE keeps its own colours and theme): the firm line, the current row, the menu, panel and bottom bar
export const HELIX_CSS = `
.hx-list .hx-firm{font-weight:800;font-size:20px;letter-spacing:.2px}
.hx-list table.hx-t{table-layout:fixed;width:100%;font-size:12px}
.hx-list table.hx-t th,.hx-list table.hx-t td,.hx-list table.hx-t.dense td,.hx-list table.hx-t.dense th{font-size:11.5px;padding:2px 3px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.hx-list table.hx-t thead th,.hx-list table.hx-t.dense thead th{white-space:normal;line-height:1.15;vertical-align:bottom;font-size:10.5px;text-transform:none;letter-spacing:0;word-break:normal;overflow-wrap:normal;hyphens:manual;text-overflow:clip}
.hx-list table.hx-t td.hx-a{overflow:visible;white-space:nowrap}
.hx-list table.hx-t td.hx-a>.btn{margin-right:2px}
.hx-list table.hx-t td .pill{font-size:10.5px;padding:0 4px}
.hx-list table.hx-t td .btn.sm{padding:1px 5px;font-size:11px}
.hx-list .hx-act{position:relative;display:inline-block}
.hx-list .hx-act>summary{list-style:none;cursor:pointer}
.hx-list .hx-act>div{position:absolute;right:0;z-index:25;background:var(--surface,#fff);border:1px solid var(--line,#ddd);border-radius:6px;padding:4px;display:grid;gap:3px;min-width:170px;box-shadow:0 4px 14px rgba(0,0,0,.12)}
.hx-list .tw{overflow-x:auto}
.hx-list .hx-row{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:10px;align-items:start}
.hx-hd .hd{margin:0 0 2px;padding:0;min-height:0}
.hx-hd .hd h1{font-size:15px;margin:0;line-height:1.3}
.hx-list table.hx-t tbody tr[aria-selected=true]{outline:2px solid var(--accent);outline-offset:-2px;background:var(--accent-soft,rgba(31,94,255,.08))}
.hx-list table.hx-t tbody tr.hx-marked{background:var(--warn-bg,#fff7e0)}
.hx-list table.hx-t td.hx-mk{width:16px;font-weight:700;text-align:center;color:var(--accent)}
.hx-list .hx-menu{display:flex;flex-wrap:wrap;gap:2px;margin:0 0 6px;border-bottom:1px solid var(--line,#ddd)}
.hx-list .hx-menu details{position:relative}
.hx-list .hx-menu summary{list-style:none;cursor:pointer;padding:4px 10px;font-size:13px;border-radius:4px}
.hx-list .hx-menu summary:hover{background:var(--accent-soft,#e8eefc)}
.hx-list .hx-menu summary[aria-disabled=true]{color:var(--muted,#888);cursor:default}
.hx-list .hx-menu .hx-dd{position:absolute;z-index:30;left:0;top:100%;background:var(--surface,#fff);border:1px solid var(--line,#ddd);border-radius:6px;padding:4px;display:grid;gap:2px;min-width:230px;max-width:min(520px,90vw);box-shadow:0 4px 14px rgba(0,0,0,.12)}
.hx-list .hx-menu .hx-dd .hx-x{border-top:1px solid var(--line,#ddd);padding-top:6px;margin-top:4px;display:grid;gap:6px}
.hx-list .hx-menu .hx-dd .hx-sep{border-top:1px solid var(--line,#ddd)!important;margin-top:3px;padding-top:5px}
.hx-list .hx-menu .hx-dd{max-height:75vh;overflow:auto}
.hx-list .hx-menu .hx-dd > *{text-align:left;justify-content:flex-start}
.hx-list .hx-filter{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:0 0 6px}
.hx-list .hx-filter form{margin:0!important}
.hx-list .hx-panel{position:sticky;top:70px;align-self:flex-start;display:flex;flex-direction:column;gap:6px;padding:10px;min-width:150px;max-width:165px}
.hx-list .hx-panel .btn{font-size:12px;padding:4px 6px}
.hx-list .hx-panel .btn{justify-content:center;white-space:normal;text-align:center}
.hx-list .hx-panel fieldset{border:1px solid var(--line,#ddd);border-radius:6px;padding:6px;margin:4px 0 0;display:flex;flex-direction:column;gap:6px}
.hx-list .hx-panel legend{font-size:12px;color:var(--muted,#666);padding:0 4px}
.hx-list .hx-bottom{display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;margin-top:8px}
`;

export function HelixShell({ tableId, groups, menu, bottom, wh, exitHref, filterId, head, menuExtra, filter, filterOpen = false, children, onRow }: {
  tableId: string; groups: HxGroup[]; menu: HxMenu[]; bottom: HxBtn[]; wh?: HxWh | null; exitHref: string; filterId?: string;
  head?: React.ReactNode; children?: React.ReactNode; onRow?: (i: number) => void;
  /** Page parts shown inside a menu's dropdown (by menu label): the PDF reader, mass actions, Excel… */
  menuExtra?: Record<string, React.ReactNode>;
  /** The filter row („Филтер“): hidden until the key / button, shown when a filter is active. */
  filter?: React.ReactNode; filterOpen?: boolean;
}) {
  const router = useRouter();
  const [sel, setSel] = useState(-1);
  const [showF, setShowF] = useState(filterOpen);
  const [mark, setMark] = useState<Set<string>>(new Set());
  const [onlyMarked, setOnlyMarked] = useState(false);
  const whRef = useRef<HTMLSelectElement>(null);
  const rows = () => [...(document.getElementById(tableId)?.querySelectorAll<HTMLTableRowElement>('tr[data-id]') ?? [])];

  // the row just saved (`?saved=`) is the current one; otherwise the last (newest) row, as in the old program
  useEffect(() => {
    const R = rows();
    const want = new URLSearchParams(window.location.search).get('saved');
    const i = want ? R.findIndex((tr) => tr.dataset.id === want) : -1;
    setSel(i >= 0 ? i : R.length - 1);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const R = rows();
    R.forEach((tr, i) => {
      tr.setAttribute('aria-selected', String(i === sel));
      tr.classList.toggle('hx-marked', mark.has(tr.dataset.id!));
      tr.hidden = onlyMarked && !mark.has(tr.dataset.id!);
      const mk = tr.querySelector('td.hx-mk');
      if (mk) mk.textContent = i === sel ? '▸' : mark.has(tr.dataset.id!) ? '*' : '';
    });
    R[sel]?.scrollIntoView?.({ block: 'nearest' });
    onRow?.(sel);
  });

  const cur = () => rows()[sel];
  const run = (a: HxAct) => {
    if (isOff(a)) return;
    if ('href' in a) router.push(a.href);
    else if ('row' in a) {
      const el = cur()?.querySelector<HTMLElement>(a.row);
      // nothing behind the option for this row (e-mail of a draft, a scan that is not attached…): say so, never silently
      if (!el) { window.alert(!cur() ? 'Нема избран документ – изберете ред во листата (↑ ↓ или клик).' : /mail/.test(a.row) ? 'Е-пошта: само за прокнижена фактура – прво прокнижете ја (✓ Прокнижи).' : /att/.test(a.row) ? 'Избраниот документ нема прикачен скениран документ / PDF.' : /approve/.test(a.row) ? 'Избраниот документ е веќе прокнижен.' : /del/.test(a.row) ? 'Избраниот документ не може да се избрише (немате право или е заклучен).' : 'Оваа опција не е достапна за избраниот документ.'); return; }
      if (el instanceof HTMLAnchorElement) {
        const h = el.getAttribute('href')!;
        if (el.target === '_blank') window.open(h, '_blank'); else if (h.startsWith('/api/')) window.location.href = h; else router.push(h);
      } else el?.click();
    } else if ('ev' in a) window.dispatchEvent(new CustomEvent('hx:' + a.ev, { detail: cur() ?? null }));
    else if (a.fn === 'refresh') router.refresh();
    else if (a.fn === 'print') window.print();
    else if (a.fn === 'wh') whRef.current?.focus();
    else if (a.fn === 'filter') {
      setShowF(true);
      setTimeout(() => { const f = filterId ? document.getElementById(filterId) as HTMLInputElement | null : null; f?.focus(); f?.select?.(); }, 0);
    }
  };
  const all = [...groups.flatMap((g) => g.items), ...bottom];

  useEffect(() => {
    const tb = document.getElementById(tableId);
    const click = (e: MouseEvent) => { const tr = (e.target as HTMLElement).closest?.('tr[data-id]'); if (tr) setSel(rows().indexOf(tr as HTMLTableRowElement)); };
    const dbl = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest?.('tr[data-id]') || (e.target as HTMLElement).closest('a,button,input,summary')) return;
      const b = all.find((x) => x.key === 'Enter'); if (b) run(b.act);
    };
    tb?.addEventListener('click', click);
    tb?.addEventListener('dblclick', dbl);
    const k = (e: KeyboardEvent) => {
      if (e.defaultPrevented || document.querySelector('[role=dialog]')) return; // a dialog has its own keys
      const tg = (e.target as HTMLElement)?.tagName;
      if (tg === 'INPUT' || tg === 'SELECT' || tg === 'TEXTAREA') return;
      const R = rows().filter((tr) => !tr.hidden);
      const go = (f: () => void) => { e.preventDefault(); f(); };
      const idx = (tr?: HTMLTableRowElement) => (tr ? rows().indexOf(tr) : -1);
      const pos = R.indexOf(rows()[sel]!);
      if (e.key === 'ArrowDown') return go(() => setSel(idx(R[Math.min(pos + 1, R.length - 1)]) ));
      if (e.key === 'ArrowUp') return go(() => setSel(idx(R[Math.max(pos - 1, 0)])));
      if (e.key === 'Home') return go(() => setSel(idx(R[0])));
      if (e.key === 'End') return go(() => setSel(idx(R[R.length - 1])));
      if (e.key === '*') return go(() => setMark((M) => (M.size ? new Set() : new Set(rows().map((tr) => tr.dataset.id!)))));
      if (e.key === '+' || e.key === '-') return go(() => {
        const id = rows()[sel]?.dataset.id;
        if (id) setMark((M) => { const n = new Set(M); if (e.key === '+') n.add(id); else n.delete(id); return n; });
        setSel(idx(R[Math.min(pos + 1, R.length - 1)]));
      });
      if ((e.key === 'f' || e.key === 'F') && !e.ctrlKey && !e.metaKey && !e.altKey) return go(() => setOnlyMarked((o) => !o && mark.size > 0));
      if (e.key === 'Enter' && (tg === 'BUTTON' || tg === 'A' || tg === 'SUMMARY')) return;
      const b = all.find((x) => x.key === e.key);
      if (b) go(() => run(b.act));
    };
    window.addEventListener('keydown', k);
    return () => { window.removeEventListener('keydown', k); tb?.removeEventListener('click', click); tb?.removeEventListener('dblclick', dbl); };
  });

  const B = (b: HxBtn, extra?: string) => (
    <button key={b.label} type="button" className={'btn ' + (b.cls ?? '') + (extra ?? '')} disabled={isOff(b.act)}
      title={isOff(b.act) ? b.act.off : b.title} aria-disabled={isOff(b.act) || undefined} onClick={() => run(b.act)}>{b.label}{keyName(b.key)}</button>
  );
  const M = mark.size ? rows().filter((tr) => mark.has(tr.dataset.id!)) : [];
  const sum = M.reduce((s, tr) => s + (Number(tr.dataset.sum) || 0), 0);
  return (
    <>
      {head}
      <nav className="hx-menu noprint" aria-label="Мени на прегледот" data-hx-menu>
        {menu.map((m) => m.off && !menuExtra?.[m.label] ? <details key={m.label}><summary aria-disabled="true" title={m.off} onClick={(e) => e.preventDefault()}>{m.label}</summary></details> : (
          <details key={m.label}>
            <summary>{m.label}</summary>
            <div className="hx-dd">{m.items.map((b) => B({ ...b, cls: (b.cls ?? '') + ' sm ghost' }))}{menuExtra?.[m.label] && <div className="hx-x">{menuExtra[m.label]}</div>}</div>
          </details>
        ))}
      </nav>
      {filter && <div className="hx-filter noprint" hidden={!showF} data-hx-filter>{filter}</div>}
      {wh && (
        <div className="row noprint" style={{ gap: 8, alignItems: 'center', margin: '0 0 6px' }}>
          <label htmlFor={tableId + '-wh'} style={{ margin: 0 }}>Магацин</label>
          <select id={tableId + '-wh'} ref={whRef} value={wh.value} style={{ width: 'auto', minWidth: 220 }}
            onChange={(e) => { const u = new URL(window.location.href); if (e.target.value) u.searchParams.set('wh', e.target.value); else u.searchParams.delete('wh'); router.push(u.pathname + u.search); }}>
            {wh.options.map((o) => <option key={o.v} value={o.v}>{o.label}</option>)}
          </select>
        </div>
      )}
      <div className="hx-row">
        <div style={{ minWidth: 0 }}>{children}</div>
        <aside className="card hx-panel noprint" aria-label="Акции на прегледот">
          {groups.map((g, gi) => g.title ? (
            <fieldset key={gi}><legend>{g.title}</legend>{g.items.map((b) => B(b))}</fieldset>
          ) : <div key={gi} style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: gi ? 8 : 0 }}>{g.items.map((b) => B(b))}</div>)}
        </aside>
      </div>
      <div className="hx-bottom noprint">
        <div className="row" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <span className="mini" data-testid="hx-sel" title="* = сите / ниедна · + = означи и надолу · − = отстрани · F = само означените">
            Селекција: <b>* + - F</b>{mark.size > 0 && <> · означени <b>{mark.size}</b> · износ <b>{nf.format(sum)}</b>{onlyMarked ? ' · само означените' : ''}</>}
          </span>
          {bottom.filter((b) => b.key !== 'Escape' && b.key !== 'F1').map((b) => B(b, ' sm'))}
          {bottom.filter((b) => b.key === 'F1').map((b) => <a key={b.label} href="#" className="mini" onClick={(e) => { e.preventDefault(); run(b.act); }}>F1 - {b.label}</a>)}
        </div>
        <button type="button" className="btn" onClick={() => router.push(exitHref)}>Излез (Esc)</button>
      </div>
      <EscExit href={exitHref} />
    </>
  );
}

/** Esc on the list (no dialog, no field) leaves the screen – „Излез (Esc)“. */
function EscExit({ href }: { href: string }) {
  const router = useRouter();
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented || document.querySelector('[role=dialog]') || document.querySelector('.hx-menu details[open]')) return;
      const tg = (e.target as HTMLElement)?.tagName;
      if (tg === 'INPUT' || tg === 'SELECT' || tg === 'TEXTAREA') return;
      e.preventDefault(); router.push(href);
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [href, router]);
  return null;
}
