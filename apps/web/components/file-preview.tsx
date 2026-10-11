'use client';
/**
 * 👁 in-page viewer of a stored file (`/api/files/<id>`): PDF / text in a frame, images inline, other files (Word,
 * Excel…) only with „Отвори во нов прозорец“ / „⬇ Преземи“. Esc or the backdrop closes it.
 */
import { useEffect, useState } from 'react';
import { archPreviewKind } from '@wise/core/office/archive';

export function FilePreview({ id, name, mime, label, className = 'btn sm', title }: {
  id: string; name: string; mime: string; label?: React.ReactNode; className?: string; title?: string;
}) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('keydown', k);
    return () => document.removeEventListener('keydown', k);
  }, [open]);
  const src = `/api/files/${id}`;
  const kind = archPreviewKind(mime, name);
  return (
    <>
      <button type="button" className={className} title={title ?? `Преглед: ${name}`} onClick={() => setOpen(true)}>{label ?? '👁'}</button>
      {open && (
        <div className="modal" role="dialog" aria-modal="true" aria-label={`Преглед: ${name}`} onClick={(e) => { if (e.target === e.currentTarget) setOpen(false); }}>
          <div className="card" style={{ maxWidth: 1000, width: '100%' }}>
            <div className="hd">
              <h2 style={{ margin: 0, overflowWrap: 'anywhere' }}>{name}</h2>
              <div className="row" style={{ gap: 6 }}>
                <a className="btn sm" href={src} target="_blank" rel="noopener">↗ Отвори во нов прозорец</a>
                <a className="btn sm" href={`${src}?dl=1`}>⬇ Преземи</a>
                <button type="button" className="btn sm" onClick={() => setOpen(false)}>✕ Затвори</button>
              </div>
            </div>
            <div style={{ marginTop: 10 }}>
              {kind === 'img' ? <img src={src} alt={name} style={{ maxWidth: '100%', maxHeight: '75vh', display: 'block', margin: '0 auto' }} />
                : kind === 'frame' ? <iframe title={name} src={src} style={{ width: '100%', height: '75vh', border: '1px solid var(--line)', background: '#fff' }} />
                : <div className="callout">Оваа датотека не може да се прикаже во програмот – отворете ја во нов прозорец или преземете ја.</div>}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
