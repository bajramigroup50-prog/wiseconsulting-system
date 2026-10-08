'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { uploadFile } from '@/lib/upload';

export function UploadBox({ firmId }: { firmId: string }) {
  const router = useRouter();
  const [msg, setMsg] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  async function onFiles(list: FileList | null) {
    if (!list?.length) return;
    setBusy(true);
    const out: string[] = [];
    for (const f of Array.from(list)) {
      const r = await uploadFile(f, firmId);
      out.push(!r.ok ? `✗ ${f.name}: ${r.error}` : r.duplicate ? `↺ ${f.name}: веќе постои како „${r.name}“` : `✓ ${f.name}`);
      setMsg([...out]);
    }
    setBusy(false);
    router.refresh();
  }

  return (
    <div className="card">
      <label className="btn pri" style={{ cursor: busy ? 'wait' : 'pointer' }}>
        📷 Прикачи документи
        <input type="file" multiple hidden disabled={busy} onChange={(e) => { void onFiles(e.target.files); e.target.value = ''; }} />
      </label>
      {busy && <span className="note"> Се прикачува…</span>}
      {msg.length > 0 && <ul className="note" style={{ margin: '8px 0 0' }}>{msg.map((m) => <li key={m}>{m}</li>)}</ul>}
    </div>
  );
}
