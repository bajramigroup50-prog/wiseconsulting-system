'use client';
/** 🔒 The owner's office setting „Колегите гледаат само сметководство“ (Корисници). */
import { useActionState } from 'react';
import { setBookOnlyAction, type FormState } from './actions';

export function BookOnlyCard({ on }: { on: boolean }) {
  const [st, action, pending] = useActionState<FormState, FormData>(setBookOnlyAction, {});
  return (
    <form className="card" id="samoSmetkovodstvo" action={action}>
      <h2>🔒 Пристап на колегите</h2>
      <label className="chk" style={{ display: 'flex', gap: 8, alignItems: 'center', fontWeight: 600 }}>
        <input type="checkbox" name="on" defaultChecked={on} style={{ width: 'auto' }} /> 🔒 Колегите гледаат само сметководство
      </label>
      <p className="note">
        Кога е вклучено, секој колега (освен вас како сопственик) ги гледа само фирмите што му се доделени и само сметководството:
        изводи и банки, налози, картици, бруто биланс, влезни и излезни фактури и документи, плати, ДДВ, залиха, шифрарници.
        Систем, Корисници, Канцеларија, договори, анализи, роботот, законите, роковите и досиејата не се гледаат.
        За поединечен колега: „Измени“ → „Пристап до менија“. Клиентите и теренските корисници си имаат свои правила.
      </p>
      {st.error && <div className="callout bad" role="alert">{st.error}</div>}
      {st.ok && <div className="callout good" role="status">{st.ok}</div>}
      <div className="row" style={{ justifyContent: 'flex-end' }}><button className="btn" disabled={pending}>Зачувај</button></div>
    </form>
  );
}
