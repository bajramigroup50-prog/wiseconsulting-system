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
import { useEffect, useState } from 'react';
import { uploadFile } from '@/lib/upload';
import { UploadTarget } from '@/components/firm-guard';
import { Uvoz } from '@/components/uvoz';
import { scanStatus, startScans } from '@/app/(app)/skan/actions';

export interface ScanOpts { kind: 'purchase' | 'sale'; batchId: string | null; cash?: boolean; warehouseId?: string; costOnly?: boolean; /** posted into this nalog when approved */ nalogNo?: string }

/** Legacy `scanErr` (4687) for the stored worker errors. */
export const scanErrText = (e: string | null | undefined) => e || 'Читањето не успеа. Обидете се повторно.';

/** What the scan zones take: PDF, photos / scans, UBL e-invoice XML. */
export const SCAN_ACCEPT = 'application/pdf,.pdf,image/*,.jpg,.jpeg,.png,.webp,.xml,text/xml,application/xml';

const isImage = (f: File) => /^image\//.test(f.type) || /\.(jpe?g|png|webp)$/i.test(f.name);

export function ScanUpload({ firmId, opts, label, small, autoOpen, batchView }: {
  firmId: string; opts: ScanOpts; label: React.ReactNode; small?: boolean;
  /** Open the editor when the first document is read (legacy `scanFile`). */
  autoOpen?: { back: string };
  /** Where more than two files go (legacy: `S.view='masovno'; batchRun(fs)`). */
  batchView?: string;
}) {
  const router = useRouter();

  const [msg, setMsg] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const [wait, setWait] = useState<{ ids: string[]; t0: number; name: string } | null>(null);
  const [tick, setTick] = useState(0);
  const [pagesTogether, setPagesTogether] = useState(true);
  /** Photos can be read together as pages (single-scan uploads; a „масовно“ list reads every file on its own). */
  const canGroup = !opts.batchId && !!(autoOpen || batchView);

  useEffect(() => {
    if (!wait || !autoOpen) return;
    let stop = false;
    const t = setInterval(async () => {
      setTick((x) => x + 1);
      try {
        const S = await scanStatus(wait.ids);
        if (stop) return;
        const done = S.find((d) => d.status === 'done' && d.drafts.length);
        if (done && done.drafts.length > 1) {
          // one file, several invoices: never one document — each is listed on its own (review / save / skip)
          stop = true;
          clearInterval(t);
          setWait(null);
          const dup = done.drafts.filter((x) => x.status === 'dup').length;
          setMsg([`„${wait.name}“: Пронајдени ${done.drafts.length} фактури – секоја е посебен документ со свој број, датум, износ и налог.`
            + (dup ? ` ${dup} се веќе заведени (дупликати) и се прескокнуваат.` : '') + ' Прегледајте ги во листата подолу.']);
          router.refresh();
          return;
        }
        if (done) {
          stop = true;
          clearInterval(t);
          const ed = done.kind === 'sale' ? '/izlez' : '/vlez';
          const x = done.drafts[0]!;
          router.push(`${ed}?scan=${x.docId}&i=${x.index}&back=${encodeURIComponent(autoOpen.back)}`);
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
    // photos uploaded together = the pages of one or several invoices: read together, one draft per invoice
    const group = canGroup && pagesTogether && fs.length > 1 && fs.length <= 20 && fs.every(isImage);
    const toBatch = !group && !!batchView && !opts.batchId && fs.length > 2;
    const batchId = toBatch ? crypto.randomUUID() : opts.batchId;
    const ids: string[] = [], out: string[] = [];
    for (const [i, f] of fs.entries()) {
      setMsg([`Се прикачува ${i + 1}/${fs.length}: ${f.name}`]);
      const r = await uploadFile(f, firmId);
      if (r.ok) ids.push(r.id); else out.push(`${f.name}: ${r.error}`);
    }
    if (ids.length) {
      const r = await startScans({ fileIds: ids, ...opts, batchId, group });
      if (r.error) out.push(r.error);
      if (r.ok) out.unshift(r.ok);
      out.push(...(r.skipped ?? []));
      if (toBatch && r.ids?.length) {
        setBusy(false);
        router.push(`${batchView}?b=${batchId}&wh=${encodeURIComponent(opts.warehouseId ?? '')}`);
        return;
      }
      if (autoOpen && r.ids?.length) setWait({ ids: r.ids, t0: Date.now(), name: group ? `${fs.length} фотографии` : fs[0]!.name + (fs.length > 1 ? ` · уште ${fs.length - 1} во редица` : '') });
    }
    setMsg(out);
    setBusy(false);
    router.refresh();
  };
  const sec = wait ? Math.round((Date.now() - wait.t0) / 1000) : 0;
  void tick;
  return (
    <div>
      <UploadTarget compact={small} />
      {/* UX P6: the shared import zone (drag and drop, several files, format per file); the read flow below is unchanged */}
      <Uvoz onFiles={run} accept={SCAN_ACCEPT} label={label} busy={busy} zoneClass={small ? 'drop-sm' : undefined} />
      {canGroup && (
        <label className="mini" style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 4 }} title="Повеќе фотографии прикачени заедно се читаат како страници; секоја фактура меѓу нив е посебна">
          <input type="checkbox" checked={pagesTogether} onChange={(e) => setPagesTogether(e.target.checked)} style={{ width: 'auto' }} />
          Фотографиите прикачени заедно се страници (од една или повеќе фактури)
        </label>
      )}
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
