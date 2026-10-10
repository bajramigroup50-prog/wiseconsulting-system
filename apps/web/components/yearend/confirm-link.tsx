'use client';
/** A download link that asks first when `confirm` is set (legacy `askConfirm` before `crmXmlDl`). */
export function ConfirmLink({ href, confirm, className = 'btn', children }: { href: string; confirm?: string; className?: string; children: React.ReactNode }) {
  return <a className={className} href={href} onClick={(e) => { if (confirm && !window.confirm(confirm)) e.preventDefault(); }}>{children}</a>;
}
