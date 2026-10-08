'use client';
/** A `<button>` that navigates (legacy `data-go`), so the legacy `.ftabs button` styles apply. */
import { useRouter } from 'next/navigation';

export function GoButton({ href, children, className, selected, title }: {
  href: string; children: React.ReactNode; className?: string; selected?: boolean; title?: string;
}) {
  const r = useRouter();
  return (
    <button type="button" className={className} aria-selected={selected} title={title} onClick={() => r.push(href)}>{children}</button>
  );
}

/** Opens the browser print dialog (print view pages). */
export function PrintButton({ label = '🖨 Печати / PDF' }: { label?: string }) {
  return <button type="button" className="btn pri" onClick={() => window.print()}>{label}</button>;
}
