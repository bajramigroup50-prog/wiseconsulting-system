'use client';
/**
 * Legacy „Изјава · Договор“ cell of a colleague (15485): state of the confidentiality statement (✓ date / нема),
 * 👁 the scanned signed copy, „✓ Потпишана“ / „↺“ and 📎 upload of the signed copy (PDF / image, office-wide file).
 */
import { useRef, useState, useTransition } from 'react';
import { uploadFile } from '@/lib/upload';
import { zzIzj } from './actions';

const dmy = (d?: string) => (d ? d.slice(0, 10).split('-').reverse().join('.') : '');

export function IzjCell({ uid, signed, at, fileId, fileName }: { uid: string; signed: boolean; at?: string; fileId?: string; fileName?: string }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState('');
  const ref = useRef<HTMLInputElement>(null);
  return (
    <>
      {signed ? <span className="pill good">✓ {dmy(at)}</span> : <span className="pill warn">нема</span>}
      {fileId && <> <a className="btn sm ghost" href={`/api/files/${fileId}`} target="_blank" rel="noopener" title={`Скениран примерок${fileName ? ': ' + fileName : ''}`}>👁</a></>}{' '}
      <button type="button" className={`btn sm ${signed ? 'ghost' : 'pri'}`} disabled={pending} onClick={() => start(async () => { const r = await zzIzj(uid); setMsg(r.error ?? ''); })}>{signed ? '↺' : '✓ Потпишана'}</button>
      <button type="button" className="btn sm ghost" disabled={pending} title="Прикачи скениран потпишан примерок" onClick={() => ref.current?.click()}>📎</button>
      <input ref={ref} type="file" hidden accept="application/pdf,image/*" onChange={(e) => {
        const f = e.target.files?.[0]; e.target.value = '';
        if (!f) return;
        setMsg('Се прикачува…');
        start(async () => {
          const up = await uploadFile(f, null);
          if (!up.ok) { setMsg('Прикачувањето не успеа.'); return; }
          const r = await zzIzj(uid, up.id);
          setMsg(r.error ?? r.ok ?? '');
        });
      }} />
      {msg && <span className="mini"> {msg}</span>}
    </>
  );
}
