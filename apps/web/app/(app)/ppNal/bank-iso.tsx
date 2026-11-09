'use client';
/**
 * „⚙ Шифри за плаќање по банка“: where the national list (НБРМ, ISO 20022) leaves two new codes for one old code,
 * the code each bank uses. One line per code: „220=GDDS“. Empty = the national list.
 */
import { useActionState } from 'react';
import type { FormState } from '@/components/bank-form';
import { saveBankIsoAction } from './actions';

export function BankIsoForm({ banks, rules }: { banks: { code: string; name: string }[]; rules: Record<string, Record<string, string>> }) {
  const [st, run, pending] = useActionState<FormState, FormData>(saveBankIsoAction, {});
  const txt = (b: string) => Object.entries(rules[b] ?? {}).map(([o, i]) => `${o}=${i}`).join('\n');
  return (
    <details className="card" style={{ marginTop: 12 }}>
      <summary style={{ cursor: 'pointer', fontWeight: 600 }}>⚙ Шифри за плаќање по банка (стари → нови)</summary>
      <p className="note">Националната листа (НБРМ, ISO 20022) за некои стари шифри дава две нови (на пр. 220 → GDSV или GDDS). Ако вашата банка користи друга, внесете ја тука: по еден ред „стара=нова“, на пр. <b>220=GDDS</b>. Налогот ја зема шифрата според банката на сметката од која се плаќа (Халк 270, Комерцијална 300, НЛБ 210…). Празно = националната листа. Важи за сите фирми.</p>
      <form action={run}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))', gap: 10 }}>
          {banks.map((b) => (
            <label key={b.code} className="f">{b.code} · {b.name}
              <textarea name={`b_${b.code}`} defaultValue={txt(b.code)} rows={3} placeholder="220=GDDS" style={{ fontFamily: 'monospace' }} />
            </label>
          ))}
        </div>
        <div className="row" style={{ gap: 8, marginTop: 8, alignItems: 'center' }}>
          <button className="btn pri" disabled={pending}>{pending ? 'Се зачувува…' : 'Зачувај'}</button>
          {st.error && <span className="pill bad">{st.error}</span>}
          {st.ok && <span className="pill good">{st.ok}</span>}
        </div>
      </form>
    </details>
  );
}
