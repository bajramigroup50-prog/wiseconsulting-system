'use client';
/** Switch to a firm and open one of its screens (legacy `efFix`: `pickFirm` then `go(view)`). */
import { noteRendered } from '@/components/firm-guard';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { selectFirm } from '@/app/(app)/actions';

export function OpenFirm({ id, href, label }: { id: string; href: string; label: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return <button type="button" className="btn sm" disabled={pending} onClick={() => start(async () => { await selectFirm(id); noteRendered({ firm: id }); router.push(href); })}>{label}</button>;
}
