'use client';
/**
 * Keyboard of the old desktop lists („Аналитика“, Бруто биланс): ↑ / ↓ (PageUp / PageDown, Home / End) select a row of
 * the table `#<table>` (rows with `data-href`), Enter or a double click opens the selected row, a click selects it.
 * `keys` maps a key (`F2`…`F7`, `Escape`) to an address, or to `#id` = click that element (a button / link on the page).
 * Buttons with `data-tpl="/x?k={k}"` open the address with `{k}` / `{id}` taken from the selected row (`data-k` /
 * `data-id`); `data-new` opens it in a new tab.
 * The search box (`data-keynav` + `data-filter`) filters the rows by their `data-s` text / `data-k` code as you type and
 * jumps to the first match (the exact code first) — typing „2200“ in the konto list.
 */
import { useRouter } from 'next/navigation';
import { useCallback, useEffect } from 'react';
import { akMatch } from '@/lib/akart-match';

const rowsOf = (table: string) => [...document.querySelectorAll<HTMLTableRowElement>(`#${table} tbody tr[data-href]`)].filter((r) => !r.hidden);

export function KeyNav({ table, keys = {}, digitsInText = false }: { table: string; keys?: Record<string, string>; digitsInText?: boolean }) {
  const router = useRouter();
  const go = useCallback((href: string, blank = false) => {
    if (!href) return;
    if (blank || href.startsWith('/print/')) window.open(href, '_blank', 'noopener');
    else router.push(href);
  }, [router]);
  const sel = useCallback(() => document.querySelector<HTMLTableRowElement>(`#${table} tbody tr.sel[data-href]`), [table]);
  const select = useCallback((r: HTMLTableRowElement | null | undefined) => {
    if (!r) return;
    document.querySelectorAll(`#${table} tbody tr.sel`).forEach((x) => x.classList.remove('sel'));
    r.classList.add('sel');
    r.scrollIntoView({ block: 'nearest' });
  }, [table]);

  useEffect(() => {
    const T = document.getElementById(table);
    if (!T) return;
    if (!sel()) select(T.querySelector<HTMLTableRowElement>('tbody tr[data-sel]') ?? rowsOf(table)[0]);
    const click = (e: MouseEvent) => {
      const r = (e.target as HTMLElement).closest<HTMLTableRowElement>('tbody tr[data-href]');
      if (r) select(r);
    };
    const dbl = (e: MouseEvent) => {
      const r = (e.target as HTMLElement).closest<HTMLTableRowElement>('tbody tr[data-href]');
      if (r && !(e.target as HTMLElement).closest('a,button,input,select')) go(r.dataset.href!);
    };
    T.addEventListener('click', click);
    T.addEventListener('dblclick', dbl);
    return () => { T.removeEventListener('click', click); T.removeEventListener('dblclick', dbl); };
  }, [table, go, sel, select]);

  useEffect(() => {
    const tpl = (e: MouseEvent) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('[data-tpl]');
      if (!b) return;
      e.preventDefault();
      const r = sel();
      if (!r) return;
      go(b.dataset.tpl!.replace('{k}', encodeURIComponent(r.dataset.k ?? '')).replace('{id}', encodeURIComponent(r.dataset.id ?? '')), b.hasAttribute('data-new'));
    };
    const input = (e: Event) => {
      const el = e.target as HTMLInputElement;
      if (!el.matches?.('input[data-filter]')) return;
      const q = el.value;
      const all = [...document.querySelectorAll<HTMLTableRowElement>(`#${table} tbody tr[data-href]`)];
      for (const r of all) r.hidden = !akMatch(r.dataset.k ?? '', r.dataset.s ?? '', q, digitsInText);
      const vis = all.filter((r) => !r.hidden);
      select(vis.find((r) => r.dataset.k === q.trim()) ?? vis[0]);
    };
    const key = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const inField = !!t && /INPUT|TEXTAREA|SELECT/.test(t.tagName) && !t.hasAttribute('data-keynav');
      const k = e.key;
      if (/^F\d+$/.test(k) || k === 'Escape') {
        const a = keys[k];
        if (!a) return;
        if (k === 'Escape' && inField) return;
        e.preventDefault();
        if (a.startsWith('#')) document.getElementById(a.slice(1))?.click();
        else go(a);
        return;
      }
      if (inField || e.altKey || e.ctrlKey || e.metaKey) return;
      const R = rowsOf(table);
      if (!R.length) return;
      const i = Math.max(0, R.indexOf(sel()!));
      const step: Record<string, number> = { ArrowDown: 1, ArrowUp: -1, PageDown: 15, PageUp: -15 };
      if (k in step) { e.preventDefault(); select(R[Math.min(R.length - 1, Math.max(0, i + step[k]!))]); }
      else if (k === 'Home' && !t?.hasAttribute('data-keynav')) { e.preventDefault(); select(R[0]); }
      else if (k === 'End' && !t?.hasAttribute('data-keynav')) { e.preventDefault(); select(R[R.length - 1]); }
      else if (k === 'Enter') { const r = sel(); if (r) { e.preventDefault(); go(r.dataset.href!); } }
    };
    document.addEventListener('click', tpl);
    document.addEventListener('input', input);
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('click', tpl); document.removeEventListener('input', input); document.removeEventListener('keydown', key); };
  }, [table, keys, digitsInText, go, sel, select]);
  return null;
}
