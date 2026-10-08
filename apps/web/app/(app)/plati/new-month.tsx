'use client';
/** New payroll month (legacy `payNewM` + `VIEWS.payPredlog` / `ppMake`). */
import { useActionState } from 'react';
import type { ActionState } from '@/lib/books';
import { createRun } from './actions';

export function NewMonth({ next, full }: { next: string; full?: boolean }) {
  const [st, action, pending] = useActionState<ActionState, FormData>(createRun, {});
  return (
    <form action={action} className={full ? 'card' : undefined} style={full ? undefined : { display: 'flex', flexDirection: 'column', gap: 6 }}>
      {st.error && <div className="callout bad">{st.error}</div>}
      <label className="f">Месец<input name="month" type="month" defaultValue={next} required /></label>
      <label className="chk"><input type="radio" name="mode" value="cal" defaultChecked /> {full ? 'Стандардни часови според календарот (редовно + државни празници) за сите активни вработени' : 'по календар'}</label>
      <label className="chk"><input type="radio" name="mode" value="prev" /> {full ? 'Како претходниот месец (исти вработени, плати и дополнителни ставки; часовите по календар)' : 'како претходниот'}</label>
      <button className="btn pri" disabled={pending}>{full ? 'Креирај предлог и отвори' : 'Нов месец (Ins)'}</button>
      {full && <p className="note">Предлогот се зачувува како нацрт и не се книжи додека не притиснете „Пресметка (F4)“ во содржината на пресметката. Ако месецот веќе постои, се отвора постојниот.</p>}
    </form>
  );
}
