'use client';
/**
 * Upload of an inspection record / decision (PDF or photos) → AI read (worker kind `kontrola`) → the findings are
 * added to the case for review. Without AI (no key / quota) the read fails with the usual message and the office
 * enters the findings by hand.
 */
import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { AiDrop, AiReadList, useAiRead } from '@/components/ai-read';
import { kApplyAi } from '@/app/(app)/kontroli/actions';

export function KontrolaAi({ firmId, kid }: { firmId: string; kid: string }) {
  const ai = useAiRead(firmId);
  const router = useRouter();
  const [msg, setMsg] = useState<{ ok?: string; error?: string } | null>(null);
  const [pending, start] = useTransition();
  useEffect(() => {
    const d = ai.docs.find((x) => x.status === 'done');
    if (!d) return;
    ai.reset();
    start(async () => { const r = await kApplyAi(kid, d.id); setMsg(r); if (!r.error) router.refresh(); });
  }, [ai.docs]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div>
      <AiDrop small multiple={false} disabled={ai.busy || pending} onFiles={(f) => { setMsg(null); void ai.read('kontrola', f); }}
        label={ai.busy || pending ? '⏳ Се чита документот…' : '🤖 Прикачи го записникот / решението (PDF или една слика) – програмата ги чита наодите'} />
      <AiReadList docs={ai.docs} msg={ai.msg} />
      {msg && <div className={'callout ' + (msg.error ? 'bad' : 'good')} style={{ marginTop: 6 }}>{msg.error ?? msg.ok}</div>}
    </div>
  );
}
