'use client';
/**
 * Switch to a firm and open a screen in it — legacy `alGo` / `recGoFirm` / `ainbGo` / `modPick` (selectFirm → go(view)).
 * Renders a button (or an inline span when `inline`) so it can sit inside tables and task chips.
 */
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { selectFirm } from '@/app/(app)/actions';

export function FirmGo({ fid, to, current, className, title, inline, children, style }: {
  fid: string; to: string; current?: string | null; className?: string; title?: string; inline?: boolean; children: React.ReactNode; style?: React.CSSProperties;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const go = () => start(async () => {
    if (fid !== current) await selectFirm(fid);
    router.push(to);
  });
  if (inline) {
    return <span role="link" tabIndex={0} title={title} className={className} style={{ cursor: 'pointer', opacity: pending ? 0.6 : 1, ...style }} onClick={go}
      onKeyDown={(e) => { if (e.key === 'Enter') go(); }}>{children}</span>;
  }
  return <button type="button" className={className} title={title} disabled={pending} style={style} onClick={go}>{children}</button>;
}
