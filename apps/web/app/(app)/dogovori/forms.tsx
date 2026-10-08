'use client';
import Link from 'next/link';
import { useActionState } from 'react';
import type { ActionState } from '@/lib/books';
import { registerLeaveAction, savePrefixAction } from './actions';

/** Registry number prefix (legacy `#hr_pre`). */
export function PrefixForm({ prefix }: { prefix: string }) {
  const [st, action, pending] = useActionState<ActionState, FormData>(savePrefixAction, {});
  return (
    <form action={action} className="row" style={{ gap: 8, marginBottom: 8, alignItems: 'center' }}>
      <label className="mini">Префикс на бројот <input name="prefix" defaultValue={prefix} placeholder="на пр. 03-" style={{ width: 80 }} /></label>
      <button className="btn sm" disabled={pending}>Зачувај</button>
      {st.error && <span className="pill bad">{st.error}</span>}{st.ok && <span className="pill good">{st.ok}</span>}
    </form>
  );
}

/** Annual leave decision / sick-leave record. */
export function LeaveForm({ employees, nextNo }: { employees: { id: string; name: string }[]; nextNo: string }) {
  const [st, action, pending] = useActionState<ActionState, FormData>(registerLeaveAction, {});
  const today = new Date().toISOString().slice(0, 10);
  return (
    <form className="card" action={action}>
      <h2>Годишен одмор / боледување</h2>
      {st.error && <div className="callout bad">{st.error}</div>}
      {st.ok && <div className="callout good">{st.ok}</div>}
      <div className="form">
        <label className="f">Вид<select name="kind"><option value="leave">Решение за годишен одмор</option><option value="sick">Боледување (евиденција)</option></select></label>
        <label className="f">Вработен<select name="employeeId" required><option value="">— избери —</option>{employees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}</select></label>
        <label className="f">Број (празно = {nextNo})<input name="no" /></label>
        <label className="f">Датум на документот<input name="date" type="date" defaultValue={today} required /></label>
        <label className="f">Од<input name="start" type="date" required /></label>
        <label className="f">До<input name="end" type="date" required /></label>
        <label className="f">Работни денови<input name="days" type="number" step="0.5" min="0.5" required /></label>
        <label className="f wide">Белешка<input name="note" /></label>
      </div>
      <div className="row"><Link className="btn" href="/dogovori">Затвори</Link><button className="btn pri" disabled={pending}>Заведи</button></div>
      <p className="note">Часовите за платата („Годишен одмор“, „Боледување…“) се внесуваат во пресметката на месецот; евиденцијата служи за решенијата и досието на вработениот.</p>
    </form>
  );
}
