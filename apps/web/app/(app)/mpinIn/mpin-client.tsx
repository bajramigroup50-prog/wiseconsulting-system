'use client';
/** Client parts of „МПИН од УЈП“: upload + polling while reads run, firm select per row, distribute with corrections confirm. */
import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { uploadFile } from '@/lib/upload';
import { distributeMpinRows, setMpinFirm, startMpinRead } from './actions';

export function MpinUpload({ pending }: { pending: boolean }) {
  const router = useRouter();
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!pending) return;
    const t = setInterval(() => router.refresh(), 3000);
    return () => clearInterval(t);
  }, [pending, router]);
  const add = async (fs: File[]) => {
    fs = fs.filter((f) => /pdf|image\//i.test(f.type) || /\.(pdf|jpe?g|png|webp)$/i.test(f.name));
    if (!fs.length) { setMsg('Изберете PDF или слика од МПИН.'); return; }
    setBusy(true);
    const ids: string[] = [], bad: string[] = [];
    for (const [i, f] of fs.entries()) {
      setMsg(`Се прикачува ${i + 1}/${fs.length}: ${f.name}`);
      const r = await uploadFile(f, null);
      if (r.ok) ids.push(r.id); else bad.push(`${f.name}: ${r.error}`);
    }
    if (ids.length) { const r = await startMpinRead(ids); if (r.error) bad.push(r.error); }
    setMsg(bad.join(' · '));
    setBusy(false);
    router.refresh();
  };
  return (
    <>
      <label className="btn pri" style={{ cursor: busy ? 'progress' : 'pointer' }}>📎 Прикачи МПИН (PDF / слики)
        <input type="file" multiple accept="application/pdf,image/*" style={{ display: 'none' }} disabled={busy}
          onChange={(e) => { const fs = [...(e.target.files ?? [])]; e.target.value = ''; if (fs.length) void add(fs); }} />
      </label>
      {msg && <span className="note">{msg}</span>}
    </>
  );
}

export function MpinFirmSelect({ id, value, firms }: { id: string; value: string; firms: { id: string; name: string }[] }) {
  const [pending, start] = useTransition();
  return (
    <select value={value} style={{ maxWidth: 220 }} disabled={pending}
      onChange={(e) => { const v = e.target.value; start(async () => { const r = await setMpinFirm(id, v); if (r.error) window.alert(r.error); }); }}>
      <option value="">— изберете —</option>
      {firms.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
    </select>
  );
}

export function MpinGo({ ready, corr, book }: { ready: number; corr: number; book: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [res, setRes] = useState<{ ok?: string; error?: string }>({});
  return (
    <>
      {res.error && <div className="callout bad" role="alert">{res.error}</div>}
      {res.ok && <div className="callout good" role="status">{res.ok}</div>}
      <div className="row" style={{ gap: 10, marginTop: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <button className="btn pri" disabled={!ready || pending} onClick={() => {
          if (corr && !window.confirm(`${corr} МПИН се КОРЕКЦИИ (за тој месец веќе има МПИН).\nСтариот ќе се замени: досие → „заменет“, налогот од МПИН се пресметува одново.\n\nДа продолжам?`)) return;
          start(async () => { setRes(await distributeMpinRows(book)); router.refresh(); });
        }}>{pending ? 'Се распоредува…' : `✓ Распореди ${ready} МПИН во фирмите`}</button>
        <span className="note">Се распоредуваат само редовите „Подготвено“ (или со ⚠ ако е избрана фирма и период).</span>
      </div>
    </>
  );
}

/** Legacy `#mpinBook` checkbox (kept in the URL: `?book=0`). */
export function MpinBook({ book }: { book: boolean }) {
  const router = useRouter();
  return (
    <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
      <input type="checkbox" checked={book} style={{ width: 'auto' }} onChange={(e) => router.replace(e.target.checked ? '/mpinIn' : '/mpinIn?book=0')} />
      Отвори налог кога платата не е пресметана во програмот
    </label>
  );
}
