'use client';
/** Submit button that asks first (legacy `askConfirm`). */
export function ConfirmButton({ msg, className = 'btn sm', title, children }: { msg: string; className?: string; title?: string; children: React.ReactNode }) {
  return <button className={className} title={title} onClick={(e) => { if (!confirm(msg)) e.preventDefault(); }}>{children}</button>;
}
