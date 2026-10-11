'use client';
/** Small button that runs a bound server action (delete, activate…), with optional confirm and an error toast. */
import { useTransition } from 'react';

export interface RowResult { error?: string; ok?: string }

export function RowAction({ action, label, title, confirm: ask, className = 'btn sm ghost', style, showOk }: {
  action: () => Promise<RowResult | void>;
  label: React.ReactNode;
  title?: string;
  confirm?: string;
  className?: string;
  style?: React.CSSProperties;
  /** Also show the success message (bulk actions whose result the user needs to read). */
  showOk?: boolean;
}) {
  const [pending, start] = useTransition();
  return (
    <button type="button" className={className} style={style} title={title} disabled={pending}
      onClick={() => {
        if (ask && !window.confirm(ask)) return;
        start(async () => { const r = await action(); if (r?.error) window.alert(r.error); else if (showOk && r?.ok) window.alert(r.ok); });
      }}>{label}</button>
  );
}
