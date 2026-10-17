'use client';
/**
 * Submit button of a bulk „Преглед“ form (UX Phase 3): asks for confirmation with the number of ticked rows
 * (`name` checkboxes of its form) and refuses an empty selection. Disabled while the form's action runs.
 */
import { useFormStatus } from 'react-dom';

export function ConfirmSubmit({ children, confirm, name = 'id', className = 'btn pri' }: {
  children: React.ReactNode;
  /** `{n}` = number of ticked rows. */
  confirm: string;
  name?: string;
  className?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button className={className} disabled={pending} aria-disabled={pending || undefined} onClick={(e) => {
      const n = e.currentTarget.form?.querySelectorAll<HTMLInputElement>(`input[type=checkbox][name="${name}"]:checked`).length ?? 0;
      if (!n) { e.preventDefault(); window.alert('Означете барем еден ред.'); return; }
      if (!window.confirm(confirm.replace('{n}', String(n)))) e.preventDefault();
    }}>{pending ? 'Се работи…' : children}</button>
  );
}
