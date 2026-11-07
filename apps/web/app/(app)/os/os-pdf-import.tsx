'use client';
/**
 * „📄 Увоз од PDF“ of the fixed-asset register: the old program's register as PDF / photo (any layout, also the old
 * program's fonts that do not copy as text) is read by AI (`os`) and imported like the Excel file.
 */
import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { uploadFile } from '@/lib/upload';
import { aiReadStatus, startAiRead } from '@/app/(app)/_ai/actions';
import { safeAction, STALE_ACTION_MSG } from '@/lib/version';
import { importAssetsFromRead } from './actions';

export function OsPdfImport({ firmId }: { firmId: string }) {
  const [msg, setMsg] = useState<{ ok?: string; error?: string; info?: string } | null>(null);
  const [pending, start] = useTransition();
  const inp = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const go = (f: File) => start(async () => {
    setMsg({ info: `Се прикачува „${f.name}“…` });
    const up = await uploadFile(f, firmId);
    if (!up.ok) { setMsg({ error: up.error }); return; }
    const s: { ids?: string[]; error?: string } = await safeAction(() => startAiRead({ kind: 'os', fileIds: [up.id] }));
    if (!s.ids?.[0]) { setMsg({ error: s.error ?? 'Не е прочитано.' }); return; }
    setMsg({ info: 'Се чита регистарот… (20–90 секунди)' });
    for (let t = 0; t < 150; t++) {
      await new Promise((r) => setTimeout(r, 3000));
      let x: Awaited<ReturnType<typeof aiReadStatus>>[number] | undefined;
      try { [x] = await aiReadStatus([s.ids[0]]); } catch { setMsg({ error: STALE_ACTION_MSG }); return; }
      if (x?.status === 'error') { setMsg({ error: 'Не е прочитано: ' + (x.error ?? '') }); return; }
      if (x?.status === 'done' || x?.status === 'saved') {
        const r = await importAssetsFromRead(s.ids[0]);
        setMsg(r.error ? { error: r.error } : { ok: r.ok ?? 'Увезено.' });
        router.refresh();
        return;
      }
    }
    setMsg({ error: 'Читањето трае предолго – обидете се повторно.' });
  });
  return (
    <>
      <button type="button" className="btn" disabled={pending} title="Регистар на основни средства од старата програма – PDF или слика" onClick={() => inp.current?.click()}>{pending ? '⏳ Се чита…' : '📄 Увоз од PDF'}</button>
      <input ref={inp} type="file" hidden accept="application/pdf,image/*" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) go(f); }} />
      {msg && <span className={'pill ' + (msg.error ? 'bad' : msg.ok ? 'good' : '')} style={{ alignSelf: 'center' }}>{msg.error ?? msg.ok ?? msg.info}</span>}
    </>
  );
}
