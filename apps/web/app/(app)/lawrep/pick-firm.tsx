'use client';
/** Legacy `ACT.lrOpen`: select the firm and open its review. */
import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { selectFirm } from '../actions';

export function PickFirm({ id, to = '/lawrep', label = 'Отвори →' }: { id: string; to?: string; label?: string }) {
  const [pending, start] = useTransition();
  const router = useRouter();
  return <button className="btn sm" disabled={pending} onClick={() => start(async () => { await selectFirm(id); router.push(to); })}>{label}</button>;
}
