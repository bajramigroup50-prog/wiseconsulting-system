'use client';
/** Small button that runs a bound server action (delete, activate…), with optional confirm and an error toast. */
import Link from 'next/link';
import { useState, useTransition } from 'react';

export interface RowResult { error?: string; ok?: string }

export function RowAction({ action, label, title, confirm: ask, className = 'btn sm ghost', style, showOk, inline, okHref, okLink }: {
  action: () => Promise<RowResult | void>;
  label: React.ReactNode;
  title?: string;
  confirm?: string;
  className?: string;
  style?: React.CSSProperties;
  /** Also show the success message (bulk actions whose result the user needs to read). */
  showOk?: boolean;
  /** Show the result (success or error) on the page under the button instead of the browser's alert. */
  inline?: boolean;
  /** With `inline`: a link after the success message (e.g. „Пренос на салда →“). */
  okHref?: string;
  okLink?: string;
}) {
  const [pending, start] = useTransition();
  const [res, setRes] = useState<RowResult | null>(null);
  const button = (
    <button type="button" className={className} style={style} title={title} disabled={pending}
      onClick={() => {
        if (ask && !window.confirm(ask)) return;
        setRes(null);
        start(async () => {
          const r = await action();
          if (inline) { setRes(r && (r.error || r.ok) ? r : null); return; }
          if (r?.error) window.alert(r.error); else if (showOk && r?.ok) window.alert(r.ok);
        });
      }}>{label}</button>
  );
  if (!inline) return button;
  return (
    <>
      {button}
      {res && (
        <div className={`callout ${res.error ? 'bad' : 'good'}`} role="status" style={{ flexBasis: '100%', margin: '8px 0 0' }}>
          {res.error ?? res.ok}{' '}
          {!res.error && okHref && <Link className="btn sm" href={okHref}>{okLink ?? 'Отвори →'}</Link>}
        </div>
      )}
    </>
  );
}
