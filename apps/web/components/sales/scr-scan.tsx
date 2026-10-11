'use client';
/**
 * „📷 Скенирај повратница“ (legacy `scrScanPick` / `scrScanFile` 16225–16232): read a supplier return / credit note with
 * SCR_PROMPT in the worker (`ai_documents.kind = 'scr'`), add an unknown supplier, then open the editor prefilled.
 */
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { AiDrop, AiReadList, useAiRead } from '@/components/ai-read';
import { scrScanPrepare } from '@/app/(app)/povratDob/actions';

export function ScrScan({ firmId, auto }: { firmId: string; auto?: boolean }) {
  const router = useRouter();
  const { docs, msg, busy, read, setMsg } = useAiRead(firmId);
  const done = docs.find((d) => d.status === 'done');
  useEffect(() => {
    if (!done) return;
    void (async () => {
      const r = await scrScanPrepare(done.id);
      if (r.error) { setMsg(r.error); return; }
      router.push(`/povratDob?nov&ai=${done.id}`);
    })();
  }, [done, router, setMsg]);
  return (
    <div className="card">
      <AiDrop small disabled={busy} multiple={false} onFiles={(f) => void read('scr', f.slice(0, 1))}
        label={<><b>📷 Скенирај повратница</b> — PDF или слика од повратница или одобрение (од добавувачот или наша). {auto ? 'Изберете датотека.' : ''}</>} />
      <AiReadList docs={docs} msg={msg || (busy ? '📷 Се чита повратницата / одобрението…' : '')} />
    </div>
  );
}
