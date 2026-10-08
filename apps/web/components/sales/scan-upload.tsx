'use client';
/**
 * Drop zone for documents to read (legacy `wireScanDrop` 4637 / masovno `btDrop`): uploads to MinIO, then registers
 * the files for the `ai.read-document` job. Refreshes the page while documents are being read.
 */
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { uploadFile } from '@/lib/upload';
import { startScans } from '@/app/(app)/skan/actions';

export interface ScanOpts { kind: 'purchase' | 'sale'; batchId: string | null; cash?: boolean; warehouseId?: string; costOnly?: boolean }

export function ScanUpload({ firmId, opts, label, small }: { firmId: string; opts: ScanOpts; label: React.ReactNode; small?: boolean }) {
  const router = useRouter();
  const ref = useRef<HTMLInputElement>(null);
  const [msg, setMsg] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [on, setOn] = useState(false);
  const run = async (fs: File[]) => {
    fs = fs.filter((f) => /pdf|image\/|xml/i.test(f.type) || /\.(pdf|jpe?g|png|webp|xml)$/i.test(f.name));
    if (!fs.length) return;
    setBusy(true);
    const ids: string[] = [], out: string[] = [];
    for (const [i, f] of fs.entries()) {
      setMsg([`Се прикачува ${i + 1}/${fs.length}: ${f.name}`]);
      const r = await uploadFile(f, firmId);
      if (r.ok) ids.push(r.id); else out.push(`${f.name}: ${r.error}`);
    }
    if (ids.length) {
      const r = await startScans({ fileIds: ids, ...opts, batchId: opts.batchId });
      if (r.error) out.push(r.error);
      if (r.ok) out.unshift(r.ok);
      out.push(...(r.skipped ?? []));
    }
    setMsg(out);
    setBusy(false);
    router.refresh();
  };
  return (
    <div>
      <label className={'drop' + (small ? ' drop-sm' : '') + (on ? ' on' : '')} onDragOver={(e) => { e.preventDefault(); setOn(true); }} onDragLeave={() => setOn(false)}
        onDrop={(e) => { e.preventDefault(); setOn(false); void run([...e.dataTransfer.files]); }} onClick={() => ref.current?.click()} style={{ display: 'block', cursor: busy ? 'progress' : 'pointer' }}>
        {label}
      </label>
      <input ref={ref} type="file" multiple hidden accept="application/pdf,.pdf,image/jpeg,image/png,image/webp,.xml" onChange={(e) => { const f = [...(e.target.files ?? [])]; e.target.value = ''; void run(f); }} />
      {msg.length > 0 && <div className="note">{msg.map((m, i) => <div key={i}>{m}</div>)}</div>}
    </div>
  );
}

/** Re-render every few seconds while documents are queued or being read. */
export function AutoRefresh({ active }: { active: boolean }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => router.refresh(), 3000);
    return () => clearInterval(t);
  }, [active, router]);
  return null;
}
