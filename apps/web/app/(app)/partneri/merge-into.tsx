'use client';
/** „⇢ Спои во…“ on a partner's card: pick the main partner; this one is merged into it (`mergeIntoAction`). */
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { PartnerPicker, partnerLabel, type PickerPartner } from '@/components/partner-picker';
import { mergeIntoAction } from './actions';

export function MergeInto({ self, partners }: { self: PickerPartner; partners: PickerPartner[] }) {
  const [main, setMain] = useState('');
  const [msg, setMsg] = useState<{ ok?: string; error?: string } | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  const target = partners.find((p) => p.id === main);
  const go = () => {
    if (!target) { setMsg({ error: 'Изберете комитент.' }); return; }
    if (!window.confirm(`„${partnerLabel(self)}“ да се спои во „${partnerLabel(target)}“?\nСите книжења, фактури и изводи преминуваат на „${target.name}“, а „${self.name}“ се брише (името останува како алтернативно).\n\nОва не може да се врати.`)) return;
    start(async () => {
      const r = await mergeIntoAction(self.id, main);
      setMsg(r);
      if (r.ok) router.push('/partneri?edit=' + main);
    });
  };
  return (
    <div className="card" style={{ marginTop: -6, marginBottom: 10 }}>
      <div className="row" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <b>⇢ Спои во:</b>
        <PartnerPicker partners={partners.filter((p) => p.id !== self.id)} value={main} onChange={setMain} width={360} ariaLabel="Главен комитент" placeholder="главниот комитент (шифра / назив)" />
        <button type="button" className="btn" disabled={pending || !main} onClick={go}>{pending ? 'Се спојува…' : 'Спои'}</button>
        <span className="note">Ист комитент внесен двапати (на пр. од извод со друго име): овој се спојува во избраниот.</span>
      </div>
      {msg?.error && <p className="callout bad" style={{ margin: '6px 0 0' }}>{msg.error}</p>}
      {msg?.ok && <p className="callout good" style={{ margin: '6px 0 0' }}>{msg.ok}</p>}
    </div>
  );
}
