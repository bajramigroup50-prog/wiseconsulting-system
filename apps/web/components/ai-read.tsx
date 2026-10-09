'use client';
/**
 * Client side of the AI reads (receipts, employee documents, statements, fiscal reports, BOM): upload to MinIO →
 * `startAiRead` → poll `aiReadStatus` every few seconds until every read is done or failed. The screen maps the
 * results and lets the user apply them.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { uploadFile } from '@/lib/upload';
import { aiReadStatus, startAiRead, type AiReadState } from '@/app/(app)/_ai/actions';

export interface AiReadDoc extends AiReadState { name: string; fileId: string | null }
type StartKind = 'blg' | 'emp' | 'bank' | 'fisk' | 'bom';

const pending = (d: { status: string }) => d.status === 'queued' || d.status === 'reading';

/** Poll the given reads while any is pending (also used by klInbox with its own start action). */
export function useAiPoll(initial: AiReadDoc[] = []) {
  const [docs, setDocs] = useState<AiReadDoc[]>(initial);
  const ref = useRef(docs);
  ref.current = docs;
  const busy = docs.some(pending);
  useEffect(() => {
    if (!busy) return;
    const t = setInterval(async () => {
      const ids = ref.current.filter(pending).map((d) => d.id);
      if (!ids.length) return;
      try {
        const S = new Map((await aiReadStatus(ids)).map((s) => [s.id, s]));
        setDocs((D) => D.map((d) => (S.has(d.id) ? { ...d, ...S.get(d.id)! } : d)));
      } catch { /* keep polling */ }
    }, 2500);
    return () => clearInterval(t);
  }, [busy]);
  return { docs, setDocs, busy };
}

export function useAiRead(firmId: string) {
  const { docs, setDocs, busy } = useAiPoll();
  const [msg, setMsg] = useState('');
  const [uploading, setUploading] = useState(false);

  /** Upload files and start one read per file. */
  const read = useCallback(async (kind: StartKind, fs: File[]) => {
    fs = fs.filter((f) => /pdf|image\//i.test(f.type) || /\.(pdf|jpe?g|png|webp)$/i.test(f.name));
    if (!fs.length) { setMsg('Изберете слики (JPG/PNG) или PDF.'); return; }
    setUploading(true);
    const up: { id: string; name: string }[] = [], err: string[] = [];
    for (const [i, f] of fs.entries()) {
      setMsg(`Се прикачува ${i + 1}/${fs.length}: ${f.name}`);
      const r = await uploadFile(f, firmId);
      if (r.ok) up.push({ id: r.id, name: f.name }); else err.push(`${f.name}: ${r.error}`);
    }
    if (up.length) {
      const r = await startAiRead({ kind, fileIds: up.map((x) => x.id) });
      if (r.error) err.push(r.error);
      const add: AiReadDoc[] = (r.ids ?? []).map((id, i) => ({ id, kind, status: 'queued', error: null, model: null, result: null, name: up[i]!.name, fileId: up[i]!.id }));
      setDocs((D) => [...D, ...add]);
    }
    setMsg(err.join(' · '));
    setUploading(false);
  }, [firmId, setDocs]);

  /** Start a read without a file (BOM suggestion). */
  const suggest = useCallback(async (productId: string) => {
    setUploading(true);
    const r = await startAiRead({ kind: 'bom', productId });
    setMsg(r.error ?? '');
    if (r.ids) setDocs((D) => [...D, ...r.ids!.map((id) => ({ id, kind: 'bom', status: 'queued', error: null, model: null, result: null, name: '', fileId: null }))]);
    setUploading(false);
  }, [setDocs]);

  return { docs, setDocs, msg, setMsg, busy: busy || uploading, read, suggest, reset: () => { setDocs([]); setMsg(''); } };
}

/** Drop zone + file picker (legacy `.drop` label). */
export function AiDrop({ onFiles, label, disabled, multiple = true, small }: { onFiles: (f: File[]) => void; label: React.ReactNode; disabled?: boolean; multiple?: boolean; small?: boolean }) {
  const ref = useRef<HTMLInputElement>(null);
  const [on, setOn] = useState(false);
  return (
    <>
      <label className={'drop' + (small ? ' drop-sm' : '') + (on ? ' on' : '')} style={{ display: 'block', cursor: disabled ? 'progress' : 'pointer' }}
        onDragOver={(e) => { e.preventDefault(); setOn(true); }} onDragLeave={() => setOn(false)}
        onDrop={(e) => { e.preventDefault(); setOn(false); if (!disabled) onFiles([...e.dataTransfer.files]); }}
        onClick={(e) => { e.preventDefault(); if (!disabled) ref.current?.click(); }}>
        {label}
      </label>
      <input ref={ref} type="file" hidden multiple={multiple} accept="application/pdf,.pdf,image/jpeg,image/png,image/webp"
        onChange={(e) => { const f = [...(e.target.files ?? [])]; e.target.value = ''; if (f.length) onFiles(f); }} />
    </>
  );
}

/** One line per read that is not done yet (or failed). */
export function AiReadList({ docs, msg }: { docs: AiReadDoc[]; msg?: string }) {
  const L = docs.filter((d) => d.status !== 'done' && d.status !== 'saved');
  if (!L.length && !msg) return null;
  return (
    <div>
      {L.map((d) => (
        <div key={d.id} className="mini">{d.name ? d.name + ': ' : ''}{d.status === 'error'
          ? <span className="pill bad">{d.error || 'грешка'}</span>
          : <span className="pill info">{d.status === 'reading' ? 'се чита…' : 'чека…'}</span>}</div>
      ))}
      {msg && <div className="note">{msg}</div>}
    </div>
  );
}
