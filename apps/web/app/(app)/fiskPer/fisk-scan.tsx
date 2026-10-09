'use client';
/**
 * Legacy `fkRead` (FISK_PROMPT 11342): a photo / PDF of a periodic or daily fiscal report is read in the worker; when
 * the read is done the page reopens with `?ai=<id>` and the editor is prefilled (the user checks and posts).
 */
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { AiDrop, AiReadList, useAiRead } from '@/components/ai-read';

export function FiskScan({ firmId }: { firmId: string }) {
  const router = useRouter();
  const ai = useAiRead(firmId);
  useEffect(() => {
    const d = ai.docs.find((x) => x.status === 'done');
    if (d) { ai.reset(); router.push(`/fiskPer?ai=${d.id}`); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ai.docs]);
  return (
    <div className="card">
      <AiDrop small multiple={false} onFiles={(f) => void ai.read('fisk', f.slice(0, 1))} disabled={ai.busy}
        label={<><b>📷 Прочитај фискален извештај</b> — слика или PDF од периодичен / дневен (Z) извештај. Податоците се пополнуваат во формата подолу.</>} />
      <AiReadList docs={ai.docs} msg={ai.msg} />
    </div>
  );
}
