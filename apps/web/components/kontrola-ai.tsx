'use client';
/**
 * Reading of the inspection record / decision on the case page (worker kind `kontrola`): the reads started when the
 * case was saved with an attached act (`initial`, from `data.reads`) and the ones started here (drop zone → the file
 * is attached and read). The page polls them; a finished read is applied (findings + blank header fields) and the
 * page refreshed. Without AI the worker reads text PDFs / Word / TXT itself („прочитано без AI – проверете ги
 * наодите“); a scan without AI fails with the message and the next step (↻ Повторно, ✎ Внеси рачно) — never silently.
 */
import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { AiDrop, AiErrLine, useAiPoll, type AiReadDoc } from '@/components/ai-read';
import { kApplyAi, kDismissRead, kReadUpload } from '@/app/(app)/kontroli/actions';
import { uploadFile } from '@/lib/upload';

const ACCEPT = 'application/pdf,.pdf,image/jpeg,image/png,image/webp,.docx,.txt';
const READABLE = /\.(pdf|jpe?g|png|webp|docx|txt)$/i;

export function KontrolaAi({ firmId, kid, initial = [] }: { firmId: string; kid: string; initial?: AiReadDoc[] }) {
  const { docs, setDocs, busy } = useAiPoll(initial);
  const router = useRouter();
  const [msg, setMsg] = useState<{ ok?: string; error?: string } | null>(null);
  const [upMsg, setUpMsg] = useState('');
  const [uploading, setUploading] = useState(false);
  const [pending, start] = useTransition();
  const applied = useRef(new Set<string>());

  // reads started on the server after the page was rendered (case saved again, „↻ Прочитај“) come with the new props
  const sig = initial.map((d) => d.id).join(',');
  useEffect(() => {
    setDocs((D) => [...D, ...initial.filter((x) => !D.some((d) => d.id === x.id))]);
  }, [sig]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const d = docs.find((x) => x.status === 'done' && !applied.current.has(x.id));
    if (!d) return;
    applied.current.add(d.id);
    start(async () => {
      const r = await kApplyAi(kid, d.id);
      setMsg(r);
      setDocs((D) => D.filter((x) => x.id !== d.id));
      router.refresh();
    });
  }, [docs]); // eslint-disable-line react-hooks/exhaustive-deps

  async function onFiles(fs: File[]) {
    setMsg(null);
    fs = fs.filter((f) => /pdf|image\/|wordprocessingml|text\/plain/i.test(f.type) || READABLE.test(f.name)).slice(0, 5);
    if (!fs.length) { setUpMsg('Изберете PDF, слика (JPG/PNG), Word (.docx) или TXT.'); return; }
    setUploading(true);
    const up: { id: string; name: string }[] = [], err: string[] = [];
    for (const [i, f] of fs.entries()) {
      setUpMsg(`Се прикачува ${i + 1}/${fs.length}: ${f.name}`);
      const r = await uploadFile(f, firmId);
      if (r.ok) up.push({ id: r.id, name: f.name }); else err.push(`${f.name}: ${r.error}`);
    }
    if (up.length) {
      const r = await kReadUpload(kid, up.map((x) => x.id));
      if (r.error) err.push(r.error);
      setDocs((D) => [...D, ...(r.ids ?? []).map((id, i) => ({ id, kind: 'kontrola', status: 'queued', error: null, model: null, result: null, name: up[i]!.name, fileId: up[i]!.id }))]);
      router.refresh();
    }
    setUpMsg(err.join(' · '));
    setUploading(false);
  }

  const working = busy || uploading || pending;
  const manual = () => {
    const el = document.getElementById('rachen-vnes');
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el?.querySelector<HTMLElement>('select, textarea, input')?.focus();
  };
  return (
    <div>
      <AiDrop small multiple={false} disabled={working} onFiles={(f) => void onFiles(f)} accept={ACCEPT}
        label={working ? '⏳ Се чита документот…' : '🤖 Прикачи го записникот / решението (PDF, слика, Word) – програмата ги чита наодите'} />
      {docs.map((d) => (
        <div key={d.id} className={d.status === 'error' ? 'callout bad' : 'note'} style={{ marginTop: 6 }}>
          {d.name ? <b>{d.name}: </b> : null}
          {d.status === 'error' ? (
            <>
              <AiErrLine d={d} onRetry={() => setDocs((D) => D.map((x) => (x.id === d.id ? { ...x, status: 'queued', error: null, errCode: null } : x)))} />
              <div className="row" style={{ gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
                <button type="button" className="btn sm" onClick={manual}>✎ Внеси рачно</button>
                <button type="button" className="btn sm ghost" title="Не прикажувај повеќе" onClick={() => { setDocs((D) => D.filter((x) => x.id !== d.id)); void kDismissRead(kid, d.id); }}>✕</button>
              </div>
            </>
          ) : d.status === 'done' ? <span className="pill info">⏳ се додаваат наодите…</span>
            : <span className="pill info">⏳ {d.status === 'reading' ? 'се чита…' : 'чека на читање…'}</span>}
        </div>
      ))}
      {upMsg && <div className="note">{upMsg}</div>}
      {msg && <div className={'callout ' + (msg.error ? 'bad' : 'good')} style={{ marginTop: 6 }}>
        {msg.error ?? msg.ok}
        {msg.error && <> <button type="button" className="btn sm" style={{ marginLeft: 6 }} onClick={manual}>✎ Внеси рачно</button></>}
      </div>}
    </div>
  );
}
