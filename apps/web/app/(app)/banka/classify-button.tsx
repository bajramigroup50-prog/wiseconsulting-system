'use client';
/** „🤖 Предложи со AI“ (was „Препознај ги останатите“) — after the rules and learned kontos, starts the AI classification (legacy `aiClassify`) of the remaining lines and opens its proposals. */
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { aiReadStatus } from '@/app/(app)/_ai/actions';
import { startBankClassifyAction } from './classify-actions';
import { AiBadge } from '@/components/ai-badge';

export function ClassifyButton({ base }: { base: string }) {
  const router = useRouter();
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <span className="row" style={{ gap: 6, display: 'inline-flex' }}>
      <button type="button" className="btn" disabled={busy} onClick={async () => {
        setBusy(true);
        setMsg('Автоматско препознавање… (10–40 секунди)');
        try {
          const r = await startBankClassifyAction();
          if (!r.id) { setMsg(r.error ?? 'Препознавањето не успеа.'); return; }
          for (let t = 0; t < 120; t++) {
            await new Promise((ok) => setTimeout(ok, 2500));
            const [s] = await aiReadStatus([r.id]);
            if (s?.status === 'error') { setMsg('Препознавањето не успеа: ' + (s.error ?? '')); return; }
            if (s && (s.status === 'done' || s.status === 'saved')) { setMsg(''); router.push(`${base}?review=1&ai=${r.id}`); return; }
          }
          setMsg('Препознавањето трае предолго – обидете се повторно.');
        } finally { setBusy(false); }
      }} title="Само ставките што ниту едно правило / научено конто не ги препознало – AI предлага фактура или конто">🤖 Предложи со AI<AiBadge /></button>
      {msg && <span className="note">{msg}</span>}
    </span>
  );
}
