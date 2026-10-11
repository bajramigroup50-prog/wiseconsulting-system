'use client';
/** Top-bar dropdown menu — same markup/classes as legacy `renderNav` / `navDD`. */
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { hrefFor, NAV_MINI, NAV_SHORT, navFlat, type NavGroup, type NavItem } from '@/lib/nav';

/** Route handlers (not pages) need a full navigation. */
const HARD = new Set(['izlezF']);
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
  return (
    <>
      {items.map((x, i) => {
        if (x[0] === '-') return <hr className="ddsep" key={i} />;
        if (x[0] === '>') return <Sub key={i} label={x[1] ?? ''} items={x[2] ?? []} view={view} />;
        return (
          <Go key={i} id={x[0]} className={x[0] === 'zs_bu' ? 'sep' : ''} current={view === x[0]}>{x[1]}</Go>
        );
      })}
    </>
  );
}

function Sub({ label, items, view }: { label: string; items: readonly NavItem[]; view: string }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<React.CSSProperties>({});
  const btn = useRef<HTMLButtonElement>(null);
  // Desktop: the flyout is `position:fixed` (legacy CSS parks it at left:-9999px) — place it next to the button, as legacy `navDD` did.
  const place = () => {
    const b = btn.current?.getBoundingClientRect();
    if (!b || window.innerWidth <= 700) return setPos({});
    const w = 260, left = b.right + w > window.innerWidth ? Math.max(8, b.left - w) : b.right;
    setPos({ left, top: Math.max(8, Math.min(b.top, window.innerHeight - 80)), minWidth: w });
  };
  return (
    <div className={'dsub' + (open ? ' open' : '')}>
      <button ref={btn} role="menuitem" aria-haspopup="true" aria-expanded={open} className={items.some(([id]) => id === view) ? 'subcur' : ''}
        onClick={(e) => { e.stopPropagation(); if (!open) place(); setOpen(!open); }}>
        {label}<i aria-hidden="true">▸</i>
      </button>
      <div className="fly" role="menu" style={open ? pos : undefined}>
        {items.map((x, i) => (x[0] === '-' ? <hr className="ddsep" key={i} /> : <Go key={i} id={x[0]} current={view === x[0]}>{x[1]}</Go>))}
      </div>
    </div>
  );
}

/** Menu item: a <button> like legacy `data-go` (the legacy CSS styles `.dd button`). */
function Go({ id, current, className, children }: { id: string; current: boolean; className?: string; children: React.ReactNode }) {
  const router = useRouter();
  return <button role="menuitem" className={className} aria-current={current} onClick={() => go(router, id)}>{children}</button>;
}
