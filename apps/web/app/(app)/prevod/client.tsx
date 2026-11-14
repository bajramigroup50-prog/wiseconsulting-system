'use client';
import { useState, useTransition } from 'react';
import { uploadFile } from '@/lib/upload';
import { translateFileAction, translateTextAction } from './actions';

const LANGS: [string, string][] = [['MK', '🇲🇰 македонски'], ['SQ', '🇦🇱 албански'], ['EN', '🇬🇧 англиски'], ['DE', '🇩🇪 германски']];

function LangSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <label className="mini">На јазик{' '}
      <select value={value} onChange={(e) => onChange(e.target.value)} style={{ width: 'auto' }}>
        {LANGS.map(([k, n]) => <option key={k} value={k}>{n}</option>)}
      </select>
    </label>
  );
}

/** Paste a text → translation (copy). */
export function TextTranslate({ disabled }: { disabled?: boolean }) {
  const [text, setText] = useState('');
  const [to, setTo] = useState('MK');
  const [out, setOut] = useState<{ text?: string; error?: string; note?: string }>({});
  const [pending, start] = useTransition();
  return (
    <div className="card">
      <h2 style={{ fontSize: 15 }}>✍ Текст</h2>
      <div className="grid2" style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit,minmax(280px,1fr))' }}>
        <textarea rows={10} value={text} onChange={(e) => setText(e.target.value)} placeholder="Залепете текст на кој било јазик…" />
        <textarea rows={10} value={out.text ?? ''} readOnly placeholder="Преводот ќе се појави тука" />
      </div>
      <div className="row" style={{ gap: 10, alignItems: 'center', flexWrap: 'wrap', marginTop: 8 }}>
        <LangSelect value={to} onChange={setTo} />
        <button type="button" className="btn pri" disabled={disabled || pending || !text.trim()} onClick={() => start(async () => {
          const r = await translateTextAction(text, to);
          setOut(r.error ? { error: r.error } : { text: r.text, note: `${r.detected ? `од ${r.detected} · ` : ''}${(r.chars ?? 0).toLocaleString('mk-MK')} знаци` });
        })}>{pending ? 'Се преведува…' : '🌐 Преведи'}</button>
        {out.text && <button type="button" className="btn" onClick={() => navigator.clipboard?.writeText(out.text ?? '')}>📋 Копирај</button>}
        {out.text && <button type="button" className="btn" onClick={() => {
          const a = document.createElement('a');
          a.href = URL.createObjectURL(new Blob([out.text ?? ''], { type: 'text/plain;charset=utf-8' }));
          a.download = `prevod-${to}.txt`; a.click(); URL.revokeObjectURL(a.href);
        }}>⬇ Преземи .txt</button>}
        {out.note && <span className="mini">{out.note}</span>}
      </div>
      {out.error && <div className="callout bad" style={{ marginTop: 8 }}>{out.error}</div>}
    </div>
  );
}

/** Upload a document (PDF / Word / Excel / PowerPoint / TXT) → translated document to download. */
export function DocTranslate({ firmId, disabled }: { firmId: string | null; disabled?: boolean }) {
  const [to, setTo] = useState('MK');
  const [file, setFile] = useState<File | null>(null);
  const [res, setRes] = useState<{ ok?: string; error?: string; id?: string }>({});
  const [pending, start] = useTransition();
  return (
    <div className="card">
      <h2 style={{ fontSize: 15 }}>📄 Документ</h2>
      <div className="row" style={{ gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <input type="file" accept=".pdf,.docx,.pptx,.xlsx,.txt,.htm,.html" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        <LangSelect value={to} onChange={setTo} />
        <button type="button" className="btn pri" disabled={disabled || pending || !file} onClick={() => start(async () => {
          if (!file) return;
          setRes({});
          const up = await uploadFile(file, firmId).catch(() => ({ ok: false as const, error: 'Прикачувањето не успеа.' }));
          if (!up.ok) { setRes({ error: up.error }); return; }
          setRes(await translateFileAction(up.id, to));
        })}>{pending ? 'Се преведува… (до неколку минути)' : '🌐 Преведи документ'}</button>
      </div>
      {res.error && <div className="callout bad" style={{ marginTop: 8 }}>{res.error}</div>}
      {res.ok && <div className="callout good" style={{ marginTop: 8 }}>{res.ok} {res.id && <a className="btn sm pri" href={`/api/files/${res.id}?dl=1`}>⬇ Преземи</a>}</div>}
      <p className="note">PDF, Word (.docx), Excel (.xlsx), PowerPoint (.pptx), TXT, HTML. Изгледот на документот останува ист. Документот се зачувува {firmId ? 'кај избраната фирма' : 'во канцеларијата'}.</p>
    </div>
  );
}

/** One 🌐 button next to a stored file: translate (to MK by default) and save next to the original. */
export function FileTranslateButton({ fileId, to = 'MK', label = '🌐 Преведи на македонски', disabled, noKey }: { fileId: string; to?: string; label?: string; disabled?: boolean; noKey?: string }) {
  const [pending, start] = useTransition();
  const [res, setRes] = useState<{ ok?: string; error?: string; id?: string } | null>(null);
  return (
    <>
      <button type="button" className="btn sm" disabled={pending || disabled} title={noKey ?? 'DeepL превод – резултатот се зачувува до оригиналот'}
        onClick={() => {
          if (noKey) { window.alert(noKey); return; }
          start(async () => setRes(await translateFileAction(fileId, to)));
        }}>{pending ? '⏳ Се преведува…' : label}</button>
      {res?.error && <span className="pill bad" title={res.error}>{res.error}</span>}
      {res?.ok && res.id && <a className="btn sm pri" href={`/api/files/${res.id}`} target="_blank" rel="noopener">👁 Превод</a>}
    </>
  );
}
