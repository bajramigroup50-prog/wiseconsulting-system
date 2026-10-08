'use client';
import { useTransition } from 'react';
import { selectFirm } from '../actions';

export function PickButton({ id }: { id: string }) {
  const [pending, start] = useTransition();
  return <button className="btn sm" disabled={pending} onClick={() => start(() => selectFirm(id))}>Избери</button>;
}
