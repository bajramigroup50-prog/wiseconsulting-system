'use client';
/** Legacy `zpGo`: switch the working year, then open a screen. */
import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { setYear } from '@/app/(app)/actions';

export function YearGo({ year, to, children, className = 'btn sm' }: { year: number; to: string; children: React.ReactNode; className?: string }) {
  const [pending, start] = useTransition();
  const router = useRouter();
  return <button type="button" className={className} disabled={pending} onClick={() => start(async () => { await setYear(year); router.push(to); router.refresh(); })}>{children}</button>;
}
