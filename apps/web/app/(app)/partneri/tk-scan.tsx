'use client';
/**
 * Legacy v404 „Нов комитент од тековна состојба“ (13455): drop zone on Комитенти — PDF or images of ЦРМ extracts (several
 * at once) are stored and read in the worker (`ai.read-document`, kind `tk`, `FS_PROMPT`); when every read finished the
 * page opens the review form for each (`?tk=<id>,<id>…`).
 */
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { AiDrop, AiReadList, useAiRead } from '@/components/ai-read';

export function TkScan({ firmId }: { firmId: string }) {
  const router = useRouter();
  const ai = useAiRead(firmId);
  useEffect(() => {
    if (!ai.docs.length || ai.busy) return;
    const ok = ai.docs.filter((d) => d.status === 'done').map((d) => d.id);
    if (ok.length) { ai.reset(); router.push(`/partneri?tk=${ok.join(',')}`); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ai.docs, ai.busy]);
  return (
    <div style={{ margin: '8px 0' }}>
      <AiDrop small multiple disabled={ai.busy} onFiles={(f) => void ai.read('tk', f.slice(0, 20))}
        label={<><b>Нов комитент од тековна состојба</b>PDF или слика од ЦРМ (може повеќе одеднаш). Програмот ги чита назив, ЕДБ, ЕМБС, адреса, управител, дејност и жиро сметка, а документот се чува кај комитентот.</>} />
      <AiReadList docs={ai.docs} msg={ai.msg} />
    </div>
  );
}
