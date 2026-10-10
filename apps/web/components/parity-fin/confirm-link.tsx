'use client';
/** A link that asks first when `ask` is set (legacy `askConfirm` before long PDF runs, e.g. ИОС for > 30 partners). */
export function ConfirmLink({ href, ask, className = 'btn', children, newTab = true }: { href: string; ask?: string; className?: string; children: React.ReactNode; newTab?: boolean }) {
  return (
    <a className={className} href={href} {...(newTab ? { target: '_blank', rel: 'noopener' } : {})}
      onClick={(e) => { if (ask && !window.confirm(ask)) e.preventDefault(); }}>{children}</a>
  );
}
