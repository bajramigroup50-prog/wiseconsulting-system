'use client';
/**
 * File picker inside a form: uploads each file to MinIO right away (hash → presigned PUT → confirm, with
 * duplicate detection) and keeps the resulting ids in hidden `name` inputs for the server action.
 * Images are shrunk to 1800 px JPEG first (legacy `dosCompress` / `upFiles`).
 */
import { useState } from 'react';
import { uploadFile } from '@/lib/upload';

async function shrink(f: File): Promise<File> {
  if (!/^image\//.test(f.type) || f.type === 'image/gif') return f;
  try {
    const bmp = await createImageBitmap(f);
    const sc = Math.min(1, 1800 / Math.max(bmp.width, bmp.height));
    if (sc === 1 && f.size < 1.5e6) return f;
    const c = document.createElement('canvas');
    c.width = Math.round(bmp.width * sc); c.height = Math.round(bmp.height * sc);
    c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height);
    const bl = await new Promise<Blob | null>((r) => c.toBlob(r, 'image/jpeg', 0.85));
    return bl ? new File([bl], f.name.replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' }) : f;
  } catch { return f; }
}

export function UploadField({ firmId, name = 'fileIds', label = '📎 Прикачи датотеки', accept, capture }: {
  firmId: string | null; name?: string; label?: string; accept?: string; capture?: boolean;
}) {
  const [items, setItems] = useState<{ id?: string; name: string; msg: string }[]>([]);
  const [busy, setBusy] = useState(false);
  async function onFiles(list: FileList | null) {
    if (!list?.length) return;
    setBusy(true);
    for (const f0 of Array.from(list)) {
      const f = await shrink(f0);
      const r = await uploadFile(f, firmId);
      setItems((p) => [...p, r.ok ? { id: r.id, name: f.name, msg: r.duplicate ? `веќе постои како „${r.name}“` : '✓' } : { name: f.name, msg: `✗ ${r.error}` }]);
    }
    setBusy(false);
  }
  return (
    <div className="f wide">
      <label className="btn" style={{ cursor: busy ? 'wait' : 'pointer', width: 'fit-content' }}>
        {label}
        <input type="file" multiple hidden disabled={busy} accept={accept} {...(capture ? { capture: 'environment' as const } : {})}
          onChange={(e) => { void onFiles(e.target.files); e.target.value = ''; }} />
      </label>
      {busy && <span className="note"> Се прикачува…</span>}
      {items.length > 0 && (
        <ul className="note" style={{ margin: '6px 0 0' }}>
          {items.map((x, i) => (
            <li key={i}>
              {x.name} {x.msg}
              {x.id && <><input type="hidden" name={name} value={x.id} /> <button type="button" className="btn sm ghost" onClick={() => setItems((p) => p.filter((_, j) => j !== i))}>✕</button></>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
