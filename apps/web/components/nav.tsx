'use client';
/** Top-bar dropdown menu — same markup/classes as legacy `renderNav` / `navDD`. */
import { usePathname, useRouter } from 'next/navigation';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { hrefFor, NAV_MINI, NAV_SHORT, navFlat, type NavGroup, type NavItem } from '@/lib/nav';

/** Route handlers (not pages) need a full navigation. */
const HARD = new Set(['izlezF', 'klExit']);
const go = (router: ReturnType<typeof useRouter>, id: string) =>
  HARD.has(id) ? window.location.assign(hrefFor(id)) : router.push(hrefFor(id));

const viewOf = (path: string) => (path === '/' ? 'home' : path.split('/')[1] ?? 'home');

export function Nav({ groups }: { groups: readonly NavGroup[] }) {
  const view = viewOf(usePathname());
  const router = useRouter();
  const [open, setOpen] = useState<string | null>(null);
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    const click = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(null); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(null); };
    document.addEventListener('click', click);
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('click', click); document.removeEventListener('keydown', key); };
  }, []);
  useEffect(() => setOpen(null), [view]);

  return (
    <nav id="nav" aria-label="Главно мени" ref={ref}>
      {groups.map(([g, items0]) => {
        const items = navFlat(items0);
        const cur = items.some(([id]) => id === view);
        const lab = <><span className="ln">{NAV_SHORT[g] ?? g}</span><span className="sn">{NAV_MINI[g] ?? NAV_SHORT[g] ?? g}</span></>;
        if (items.length === 1) {
          const [id, t] = items[0]!;
          return (
            <div className="mg" key={g}>
              <button className={cur ? 'cur' : ''} aria-current={cur} title={t} onClick={() => go(router, id)}>{lab}</button>
            </div>
          );
        }
        const isOpen = open === g;
        return (
          <div className="mg" key={g}>
            <button className={cur ? 'cur' : ''} aria-expanded={isOpen} aria-haspopup="true" onClick={() => setOpen(isOpen ? null : g)}>
              {lab}<i className="chev" aria-hidden="true">▾</i>
            </button>
            {isOpen && <div className="dd" role="menu"><DD items={items0} view={view} /></div>}
          </div>
        );
      })}
    </nav>
  );
}

function DD({ items, view }: { items: readonly NavItem[]; view: string }) {
  // one open flyout at a time (legacy `subOpen`); hovering a plain item closes it (legacy mouseover 14713)
  const [sub, setSub] = useState<number | null>(null);
  return (
    <>
      {items.map((x, i) => {
        if (x[0] === '-') return <hr className="ddsep" key={i} onMouseEnter={() => wide() && setSub(null)} />;
        if (x[0] === '>') return <Sub key={i} label={x[1] ?? ''} items={x[2] ?? []} view={view} open={sub === i} setOpen={(o) => setSub(o ? i : null)} />;
        return (
          <Go key={i} id={x[0]} className={x[0] === 'zs_bu' ? 'sep' : ''} current={view === x[0]} onHover={() => wide() && setSub(null)}>{x[1]}</Go>
        );
      })}
    </>
  );
}

/** Legacy `subWide`: flyouts beside the menu (desktop); below 700px they open inline. */
const wide = () => typeof window !== 'undefined' && window.innerWidth > 700;

function Sub({ label, items, view, open, setOpen }: { label: string; items: readonly NavItem[]; view: string; open: boolean; setOpen: (o: boolean) => void }) {
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const fly = useRef<HTMLDivElement>(null);
  // Desktop: the flyout is `position:fixed` (legacy CSS parks it at left:-9999px). Legacy `subPlace` (14709): next to the
  // button, then moved up when its bottom would leave the window and to the left of the menu when its right edge would.
  const place = useCallback(() => {
    const b = btn.current, f = fly.current;
    if (!b || !f || !wide()) return setPos(null);
    const r = b.getBoundingClientRect();
    const dd = b.closest('.dd')?.getBoundingClientRect() ?? r;
    const w = f.offsetWidth, hgt = f.offsetHeight;
    let left = r.right + 2, top = Math.max(8, r.top - 6);
    if (top + hgt > window.innerHeight - 8) top = Math.max(8, window.innerHeight - 8 - hgt);
    if (left + w > window.innerWidth - 8) left = Math.max(8, dd.left - w - 2);
    setPos((p) => (p && Math.abs(p.left - left) < 1 && Math.abs(p.top - top) < 1 ? p : { left, top }));
  }, []);
  useLayoutEffect(() => {
    if (!open) return;
    place();
    const dd = btn.current?.closest('.dd');
    window.addEventListener('resize', place);
    dd?.addEventListener('scroll', place);
    return () => { window.removeEventListener('resize', place); dd?.removeEventListener('scroll', place); };
  }, [open, place]);
  return (
    <div className={'dsub' + (open ? ' open' : '')} onMouseEnter={() => { if (wide() && !open) setOpen(true); }}>
      <button ref={btn} role="menuitem" aria-haspopup="true" aria-expanded={open} className={items.some(([id]) => id === view) ? 'subcur' : ''}
        onClick={(e) => { e.stopPropagation(); setOpen(!open); }}>
        {label}<i aria-hidden="true">▸</i>
      </button>
      <div ref={fly} className="fly" role="menu" style={open && pos ? { left: pos.left, top: pos.top, minWidth: 260 } : open ? { minWidth: 260 } : undefined}>
        {items.map((x, i) => (x[0] === '-' ? <hr className="ddsep" key={i} /> : <Go key={i} id={x[0]} current={view === x[0]}>{x[1]}</Go>))}
      </div>
    </div>
  );
}

/** Menu item: a <button> like legacy `data-go` (the legacy CSS styles `.dd button`). */
function Go({ id, current, className, children, onHover }: { id: string; current: boolean; className?: string; children: React.ReactNode; onHover?: () => void }) {
  const router = useRouter();
  return <button role="menuitem" className={className} aria-current={current} onMouseEnter={onHover} onClick={() => go(router, id)}>{children}</button>;
}
