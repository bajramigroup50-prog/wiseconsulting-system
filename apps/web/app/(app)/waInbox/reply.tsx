'use client';
/**
 * 💬 The reply box of a conversation: free text inside the client's 24-hour window; outside it only an approved
 * template (picked by purpose, its variables filled here).
 */
import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { WA_PURPOSES, WA_VARS, type WaPurpose, type WaTemplate, type WaVar } from '@wise/core/whatsapp/wa';
import { waSendAction } from '@/lib/whatsapp';

export function WaReply({ phone, firmId, open, templates, firm, on }: { phone: string; firmId: string | null; open: boolean; templates: WaTemplate[]; firm: string; on: boolean }) {
  const router = useRouter();
  const [text, setText] = useState('');
  const purposes = useMemo(() => [...new Set(templates.map((t) => t.purpose))], [templates]);
  const [purpose, setPurpose] = useState<WaPurpose>(purposes[0] ?? 'opsto');
  const tpl = templates.find((t) => t.purpose === purpose);
  const [vars, setVars] = useState<Partial<Record<WaVar, string>>>({ firma: firm });
  const [msg, setMsg] = useState<{ ok?: string; error?: string }>({});
  const [busy, start] = useTransition();
  if (!on) return <div className="callout warn">WhatsApp од WISE е исклучен (💬 WhatsApp → поставки) – одговорете од телефонот.</div>;
  const send = () => start(async () => {
    setMsg({});
    const r = await waSendAction(open ? { phone, firmId, text, freeOnly: true } : { phone, firmId, purpose, vars, text: vars.tekst ?? '' });
    if ('ok' in r) { setMsg({ ok: r.ok }); setText(''); router.refresh(); } else setMsg({ error: r.error });
  });
  return (
    <div className="card" style={{ borderColor: '#25D366' }}>
      {open ? (
        <label className="f">Одговор (слободен текст – клиентот пишал во последните 24 часа)
          <textarea rows={3} value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && text.trim()) send(); }} /></label>
      ) : (
        <>
          <p className="mini" style={{ marginTop: 0 }}>⏱ Клиентот не пишал во последните 24 часа: WhatsApp дозволува само <b>одобрен шаблон</b>. Слободен текст – откако клиентот ќе одговори.</p>
          {templates.length ? (
            <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'end' }}>
              <label className="f" style={{ margin: 0 }}>Шаблон<select value={purpose} onChange={(e) => setPurpose(e.target.value as WaPurpose)}>
                {purposes.map((p) => <option key={p} value={p}>{WA_PURPOSES[p]} ({templates.filter((t) => t.purpose === p).map((t) => t.name).join(', ')})</option>)}</select></label>
              {tpl?.vars.map((v) => (
                <label key={v} className="f" style={{ margin: 0 }}>{WA_VARS[v]}<input value={vars[v] ?? ''} onChange={(e) => setVars({ ...vars, [v]: e.target.value })} style={{ width: 180 }} /></label>
              ))}
            </div>
          ) : <div className="callout warn">Нема внесени шаблони (💬 WhatsApp → Шаблони).</div>}
        </>
      )}
      <div className="row" style={{ gap: 8, marginTop: 6, alignItems: 'center' }}>
        <button type="button" className="btn pri" disabled={busy || (open ? !text.trim() : !tpl)} onClick={send} style={{ background: '#25D366', borderColor: '#25D366' }}>{busy ? 'Се праќа…' : '💬 Испрати'}</button>
        {msg.ok && <span className="pill good">{msg.ok}</span>}
        {msg.error && <span className="callout bad" style={{ margin: 0, padding: '4px 8px' }}>{msg.error}</span>}
      </div>
    </div>
  );
}
