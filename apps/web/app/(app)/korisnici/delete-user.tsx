'use client';
import { useTransition } from 'react';
import { deleteUser } from './actions';

export function DeleteUser({ id, name }: { id: string; name: string }) {
  const [pending, start] = useTransition();
  return (
    <button className="btn sm ghost" style={{ color: 'var(--bad)' }} disabled={pending} title="Избриши"
      onClick={() => { if (confirm(`Да се избрише корисникот „${name}“?`)) start(async () => { const r = await deleteUser(id); if (r.error) alert(r.error); }); }}>🗑</button>
  );
}
