'use client';
/**
 * Client side of the AI reads (receipts, employee documents, statements, fiscal reports, BOM): upload to MinIO →
 * `startAiRead` → poll `aiReadStatus` every few seconds until every read is done or failed. The screen maps the
 * results and lets the user apply them.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { AI_UNAVAILABLE_MSG, aiReadDoneMsg, isAiUnavailable } from '@wise/core/ai/messages';
import { AI_ERR_FREE, aiErrCodeOf } from '@wise/core/ai/errors';
import { uploadFile } from '@/lib/upload';
import { UploadTarget } from '@/components/firm-guard';
import { aiReadStatus, retryAiRead, startAiRead, type AiReadState } from '@/app/(app)/_ai/actions';

export interface AiReadDoc extends AiReadState { name: string; fileId: string | null }
type StartKind = 'blg' | 'emp' | 'bank' | 'fisk' | 'bom' | 'cmp' | 'imp' | 'scr' | 'ob' | 'rec'
  | 'vreg'
  | 'rcdoc' | 'rclic'
  | 'tk' | 'zm';

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
  const read = useCallback(async (kind: StartKind, fs: File[], group = false) => {
    // statements and trial balances are also read from XML / CSV / TXT (without AI)
    const txt = kind === 'bank' || kind === 'ob';
    fs = fs.filter((f) => /pdf|image\//i.test(f.type) || /\.(pdf|jpe?g|png|webp)$/i.test(f.name) || (txt && /\.(xml|csv|txt|sta|mt940|940|\d{3})$/i.test(f.name)));
    if (!fs.length) { setMsg(txt ? 'Изберете PDF, слика, XML, CSV или TXT.' : 'Изберете слики (JPG/PNG) или PDF.'); return; }
    setUploading(true);
    const up: { id: string; name: string }[] = [], err: string[] = [];
    for (const [i, f] of fs.entries()) {
      setMsg(`Се прикачува ${i + 1}/${fs.length}: ${f.name}`);
      const r = await uploadFile(f, firmId);
      if (r.ok) up.push({ id: r.id, name: f.name }); else err.push(`${f.name}: ${r.error}`);
    }
    if (up.length) {
      const r = await startAiRead({ kind, fileIds: up.map((x) => x.id), ...(group ? { group: true } : {}) });
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
export function AiDrop({ onFiles, label, disabled, multiple = true, small, text }: { onFiles: (f: File[]) => void; label: React.ReactNode; disabled?: boolean; multiple?: boolean; small?: boolean; /** also XML / CSV / TXT (statements, trial balance) */ text?: boolean }) {
  const ref = useRef<HTMLInputElement>(null);
  const [on, setOn] = useState(false);
  return (
    <>
      <UploadTarget compact={small} />
      <label className={'drop' + (small ? ' drop-sm' : '') + (on ? ' on' : '')} style={{ display: 'block', cursor: disabled ? 'progress' : 'pointer' }}
        onDragOver={(e) => { e.preventDefault(); setOn(true); }} onDragLeave={() => setOn(false)}
        onDrop={(e) => { e.preventDefault(); setOn(false); if (!disabled) onFiles([...e.dataTransfer.files]); }}
        onClick={(e) => { e.preventDefault(); if (!disabled) ref.current?.click(); }}>
        {label}
      </label>
      <input ref={ref} type="file" hidden multiple={multiple} accept={'application/pdf,.pdf,image/jpeg,image/png,image/webp' + (text ? ',.xml,.csv,.txt,.sta,.mt940' : '')}
        onChange={(e) => { const f = [...(e.target.files ?? [])]; e.target.value = ''; if (f.length) onFiles(f); }} />
    </>
  );
}

/** One line per read that is not done yet (or failed). */
export function AiReadList({ docs, msg, doneHint, setDocs }: {
  docs: AiReadDoc[]; msg?: string; /** legacy „Прочитано: …“ callout once every read finished */ doneHint?: 'amounts' | 'data';
  /** From `useAiRead` / `useAiPoll`: enables „↻ Повторно“ on failed reads. */
  setDocs?: React.Dispatch<React.SetStateAction<AiReadDoc[]>>;
}) {
  const L = docs.filter((d) => d.status !== 'done' && d.status !== 'saved');
  const done = doneHint && !docs.some(pending) ? docs.filter((d) => d.status === 'done' || d.status === 'saved') : [];
  if (!L.length && !msg && !done.length) return null;
  return (
    <div>
      {L.map((d) => (
        <div key={d.id} className="mini">{d.name ? d.name + ': ' : ''}{d.status === 'error'
          ? <AiErrLine d={d} onRetry={setDocs ? () => setDocs((D) => D.map((x) => (x.id === d.id ? { ...x, status: 'queued', error: null, errCode: null } : x))) : undefined} />
          : <span className="pill info">{d.status === 'reading' ? 'се чита…' : 'чека…'}</span>}</div>
      ))}
      {done.length > 0 && <div className="callout good">{aiReadDoneMsg(done.map((d) => d.name || 'документ'), doneHint)}</div>}
      {msg && <div className="note">{msg}</div>}
    </div>
  );
}

/**
 * A failed read: the clear message (never the raw provider JSON), „↻ Повторно“ and — when AI is not usable (credit,
 * key, switched off, scanned document) — the free paths: the screen's own Excel / CSV / XML import and the converter.
 */
export function AiErrLine({ d, onRetry }: { d: Pick<AiReadDoc, 'id' | 'error' | 'errCode'>; onRetry?: () => void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const code = d.errCode ?? aiErrCodeOf(d.error);
  const text = isAiUnavailable(d.error) ? AI_UNAVAILABLE_MSG : d.error || 'грешка';
  return (
    <>
      <span className="pill bad">{text}</span>
      {onRetry && code !== 'off' && (
        <button type="button" className="btn sm ghost" disabled={busy} style={{ marginLeft: 6 }} onClick={async () => {
          setBusy(true); const r = await retryAiRead(d.id); setBusy(false);
          if (r.error) setErr(r.error); else onRetry();
        }}>↻ Повторно</button>
      )}
      {code && AI_ERR_FREE.has(code) && <a className="btn sm ghost" style={{ marginLeft: 6 }} href="/konvertor" target="_blank" rel="noreferrer">🔄 Конвертор на датотеки</a>}
      {err && <span className="mini" style={{ marginLeft: 6 }}>{err}</span>}
    </>
  );
}
