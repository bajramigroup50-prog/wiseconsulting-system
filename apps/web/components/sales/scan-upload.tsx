'use client';
/**
 * Drop zone for documents to read (legacy `wireScanDrop` 4637 / masovno `btDrop`): uploads to MinIO, then registers
 * the files for the `ai.read-document` job. Refreshes the page while documents are being read.
 *
 * Single-scan screen (legacy `wireScanDrop` → `scanFile`): more than two files go to „Масовно внесување“ (a new batch);
 * one or two files are read and the first invoice opens in the editor automatically (`autoOpen`), the rest wait in the
 * queue and open after saving.
 */
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { uploadFile } from '@/lib/upload';
import { scanStatus, startScans } from '@/app/(app)/skan/actions';

export interface ScanOpts { kind: 'purchase' | 'sale'; batchId: string | null; cash?: boolean; warehouseId?: string; costOnly?: boolean }

/** Legacy `scanErr` (4687) for the stored worker errors. */
export const scanErrText = (e: string | null | undefined) => e || 'Читањето не успеа. Обидете се повторно.';

export function ScanUpload({ firmId, opts, label, small, autoOpen, batchView }: {
  firmId: string; opts: ScanOpts; label: React.ReactNode; small?: boolean;
  /** Open the editor when the first document is read (legacy `scanFile`). */
  autoOpen?: { back: string };
  /** Where more than two files go (legacy: `S.view='masovno'; batchRun(fs)`). */
  batchView?: string;
}) {
  const router = useRouter();
  const ref = useRef<HTMLInputElement>(null);
  const [msg, setMsg] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [on, setOn] = useState(false);
  const [wait, setWait] = useState<{ ids: string[]; t0: number; name: string } | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!wait || !autoOpen) return;
    let stop = false;
    const t = setInterval(async () => {
      setTick((x) => x + 1);
      try {
        const S = await scanStatus(wait.ids);
        if (stop) return;
        const done = S.find((d) => d.status === 'done' && d.drafts.length);
        if (done) {
          stop = true;
          clearInterval(t);
          const ed = done.kind === 'sale' ? '/izlez' : '/vlez';
          router.push(`${ed}?scan=${done.id}&i=0&back=${encodeURIComponent(autoOpen.back)}`);
          return;
        }
        if (S.length && S.every((d) => d.status === 'error' || (d.status === 'done' && !d.drafts.length))) {
          stop = true;
          clearInterval(t);
          setWait(null);
          // legacy `scanFile` 4661: the file stays attached to the read document; the amounts are entered by hand
          setMsg([...S.map((d) => '„' + wait.name + '“: ' + scanErrText(d.error)), 'Документот е прикачен, но не е прочитан автоматски. Внесете ги износите рачно.']);
          router.refresh();
        }
      } catch { /* keep polling */ }
    }, 2000);
    return () => { stop = true; clearInterval(t); };
  }, [wait, autoOpen, router]);

  const run = async (fs: File[]) => {
    fs = fs.filter((f) => /pdf|image\/|xml/i.test(f.type) || /\.(pdf|jpe?g|png|webp|xml)$/i.test(f.name));
    if (!fs.length) { setMsg(['Изберете PDF, слика или XML (е-фактура).']); return; }
    setBusy(true);
    const toBatch = !!batchView && !opts.batchId && fs.length > 2;
    const batchId = toBatch ? crypto.randomUUID() : opts.batchId;
    const ids: string[] = [], out: string[] = [];
    for (const [i, f] of fs.entries()) {
      setMsg([`Се прикачува ${i + 1}/${fs.length}: ${f.name}`]);
      const r = await uploadFile(f, firmId);
      if (r.ok) ids.push(r.id); else out.push(`${f.name}: ${r.error}`);
    }
    if (ids.length) {
      const r = await startScans({ fileIds: ids, ...opts, batchId });
      if (r.error) out.push(r.error);
      if (r.ok) out.unshift(r.ok);
      out.push(...(r.skipped ?? []));
      if (toBatch && r.ids?.length) {
        setBusy(false);
        router.push(`${batchView}?b=${batchId}&wh=${encodeURIComponent(opts.warehouseId ?? '')}`);
        return;
      }
      if (autoOpen && r.ids?.length) setWait({ ids: r.ids, t0: Date.now(), name: fs[0]!.name + (fs.length > 1 ? ` · уште ${fs.length - 1} во редица` : '') });
    }
    setMsg(out);
    setBusy(false);
    router.refresh();
  };
  const sec = wait ? Math.round((Date.now() - wait.t0) / 1000) : 0;
  void tick;
  return (
    <div>
      <label className={'drop' + (small ? ' drop-sm' : '') + (on ? ' on' : '')} onDragOver={(e) => { e.preventDefault(); setOn(true); }} onDragLeave={() => setOn(false)}
        onDrop={(e) => { e.preventDefault(); setOn(false); void run([...e.dataTransfer.files]); }} onClick={() => ref.current?.click()} style={{ display: 'block', cursor: busy ? 'progress' : 'pointer' }}>
        {label}
      </label>
      <input ref={ref} type="file" multiple hidden accept="application/pdf,.pdf,image/jpeg,image/png,image/webp,.xml" onChange={(e) => { const f = [...(e.target.files ?? [])]; e.target.value = ''; void run(f); }} />
      {wait && <div className="note"><span className="pill info">{sec < 25 ? 'Брзо читање…' : 'Подетално читање…'} {sec} сек.</span> „{wait.name}“ <button type="button" className="btn sm ghost" onClick={() => setWait(null)}>Откажи</button></div>}
      {msg.length > 0 && <div className="note" id="scanOut">{msg.map((m, i) => <div key={i}>{m}</div>)}</div>}
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
