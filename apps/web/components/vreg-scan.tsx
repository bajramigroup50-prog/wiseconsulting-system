'use client';
/**
 * Legacy `DIG.vreg` („🪪 Сообраќајна“ on Возила на клиенти and the work-order list): a photo / PDF of a vehicle
 * registration certificate is read in the worker (`ai.read-document`, kind `vreg`); when the read is done the vehicle
 * form opens prefilled (`/vozila?ed=new&vreg=<id>`) — „Проверете ги податоците и зачувајте го возилото.“
 */
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { AiDrop, AiReadList, useAiRead } from '@/components/ai-read';

export function VregScan({ firmId, back }: { firmId: string; back?: string }) {
  const router = useRouter();
  const ai = useAiRead(firmId);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const d = ai.docs.find((x) => x.status === 'done');
    if (d) { ai.reset(); setOpen(false); router.push(`/vozila?ed=new&vreg=${d.id}${back ? '&' + back : ''}`); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ai.docs]);
  return (
    <>
      <button type="button" className="btn" title="Сообраќајна дозвола (слика или PDF)" onClick={() => setOpen((x) => !x)}>🪪 Сообраќајна</button>
      {open && (
        <div className="card" style={{ flexBasis: '100%' }}>
          <AiDrop small multiple={false} onFiles={(f) => void ai.read('vreg', f.slice(0, 1))} disabled={ai.busy}
            label={<><b>Изберете или фотографирајте документ</b> — сообраќајна дозвола: PDF, слика (JPG/PNG), фотографија од телефон.</>} />
          <AiReadList docs={ai.docs} msg={ai.msg} />
        </div>
      )}
    </>
  );
}
