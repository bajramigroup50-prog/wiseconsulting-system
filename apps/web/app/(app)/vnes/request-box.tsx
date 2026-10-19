'use client';
/**
 * „📨 Побарај од клиентот“ on /vnes: the message of what is missing (editable) — ✉ Gmail, 💬 WhatsApp / Viber,
 * 📋 Копирај, or „→ Автопилот“ (proposed under Пораки до клиенти, sent from there to the portal / e-mail).
 */
import { useState } from 'react';
import { ActionForm, Submit } from '@/components/action-form';
import { queueVnesRequest } from './actions';

export function VnesRequestBox({ subject, body, email, items }: { subject: string; body: string; email: string; items: number }) {
  const [subj, setSubj] = useState(subject);
  const [text, setText] = useState(body);
  const [to, setTo] = useState(email);
  const [note, setNote] = useState('');
  if (!items) return <div className="callout good noprint">✓ Од клиентот не фали ништо за поминатите месеци (изводи, излезни и влезни фактури).</div>;
  const gmail = () => window.open(`https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(to)}&su=${encodeURIComponent(subj)}&body=${encodeURIComponent(text)}`, '_blank', 'noopener');
  const wa = () => window.open('https://wa.me/?text=' + encodeURIComponent(text), '_blank', 'noopener');
  const copy = async () => { try { await navigator.clipboard.writeText(text); setNote('Копирано – залепете го во Viber / SMS.'); } catch { setNote('Копирањето не успеа – означете го текстот и копирајте рачно.'); } };
  return (
    <details className="card noprint">
      <summary style={{ cursor: 'pointer' }}><b>📨 Побарај од клиентот</b> – {items} {items === 1 ? 'работа фали' : 'работи фалат'} (изводи, фактури)</summary>
      <ActionForm action={queueVnesRequest} reset={false} className="">
        <label className="f">Наслов<input name="subject" value={subj} onChange={(e) => setSubj(e.target.value)} style={{ width: '100%' }} /></label>
        <textarea name="body" rows={12} value={text} onChange={(e) => setText(e.target.value)} style={{ width: '100%', margin: '6px 0' }} aria-label="Порака до клиентот" />
        <div className="row" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <input type="email" placeholder="е-пошта на клиентот" value={to} onChange={(e) => setTo(e.target.value)} style={{ width: 230 }} aria-label="Е-пошта на клиентот" />
          <button type="button" className="btn" onClick={gmail}>✉ Gmail</button>
          <button type="button" className="btn" style={{ borderColor: '#25D366' }} onClick={wa}>💬 WhatsApp</button>
          <button type="button" className="btn" onClick={copy}>📋 Копирај (Viber / SMS)</button>
          <Submit className="btn pri">→ Во Автопилот (портал + е-пошта)</Submit>
          {note && <span className="note">{note}</span>}
        </div>
        <p className="note" style={{ margin: '6px 0 0' }}>Пораката ја составува програмата од табелата подолу; изменете ја пред праќање. Автопилотот ја предлага и сам при утринската проверка (Пораки до клиенти › „📋 Што фали“).</p>
      </ActionForm>
    </details>
  );
}
