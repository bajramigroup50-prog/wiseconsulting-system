'use client';
/**
 * `<Uvoz>` — THE file input of the program (UX P6, docs/ux-rindertim.md): drag and drop or click, several files,
 * the format of every file recognised on the spot (PDF, слика, XML, Excel, CSV/TXT, MT940, КБ, Word), files of a
 * format the screen does not take refused with the reason, progress, and a clear result per file.
 *
 * Only the input is shared: each screen keeps its own flow (`onFiles` gets the accepted files and does what the
 * screen did before — upload through the presigned flow, preview a statement, start a read…) and reports back
 * with `progress` / `results`. The upload limits stay where they are (`/api/files`, the server actions).
 */
import { useRef, useState } from 'react';
import { acceptsFile, fileFormatLabel } from '@wise/core/office/file-format';

export interface UvozResult { name: string; ok?: boolean; msg: string }

/** The picked / dropped files the screen takes (`accept`; one when not `multiple`), and the refused ones with the reason. */
export function uvozSplit<F extends { name: string; type: string }>(L: readonly F[], accept: string | undefined, multiple: boolean): { take: F[]; refused: UvozResult[] } {
  const ok = L.filter((f) => acceptsFile(accept, { name: f.name, mime: f.type }));
  const bad = L.filter((f) => !ok.includes(f));
  return {
    take: multiple ? ok : ok.slice(0, 1),
    refused: [
      ...bad.map((f) => ({ name: f.name, ok: false, msg: `форматот (${fileFormatLabel({ name: f.name, mime: f.type })}) не се прима тука` })),
      ...(!multiple && ok.length > 1 ? ok.slice(1).map((f) => ({ name: f.name, ok: false, msg: 'тука се прима една датотека' })) : []),
    ],
  };
}

export function Uvoz({
  onFiles, accept, multiple = true, label, hint, busy, disabled, compact, progress, results, id, style, title, zoneClass, pickerAccept,
}: {
  /** The accepted files (in the order picked). */
  onFiles: (files: File[]) => void | Promise<unknown>;
  /** The formats the screen takes: the picker's filter AND drops of other formats are refused per file. */
  accept?: string;
  /** Only the picker's filter (drops of any format are passed on, the screen decides). */
  pickerAccept?: string;
  multiple?: boolean;
  label: React.ReactNode;
  hint?: React.ReactNode;
  busy?: boolean;
  disabled?: boolean;
  /** A button-size zone (forms) instead of the large drop zone. */
  compact?: boolean;
  /** „Се прикачува 2/5: …“ — shown while `busy`. */
  progress?: React.ReactNode;
  /** The screen's result per file (shown under the zone, with the format chip). */
  results?: readonly UvozResult[];
  id?: string;
  style?: React.CSSProperties;
  title?: string;
  /** Extra class of the zone (`drop-sm`). */
  zoneClass?: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const [on, setOn] = useState(false);
  const [refused, setRefused] = useState<UvozResult[]>([]);
  const off = !!busy || !!disabled;
  const pick = (L: File[]) => {
    if (off || !L.length) return;
    const s = uvozSplit(L, accept, multiple);
    setRefused(s.refused);
    if (s.take.length) void onFiles(s.take);
  };
  const shown = [...refused, ...(results ?? [])];
  const fmt = (name: string) => fileFormatLabel({ name, mime: '' });
  return (
    <div className="uvoz" style={style}>
      <div
        id={id} role="button" tabIndex={0} aria-disabled={off} title={title}
        className={(compact ? 'btn' : 'drop') + (zoneClass ? ' ' + zoneClass : '') + (on ? ' on' : '')}
        style={compact ? { cursor: off ? 'wait' : 'pointer', width: 'fit-content', ...(on ? { borderColor: 'var(--accent)' } : {}) } : { display: 'block', cursor: off ? 'progress' : 'pointer', opacity: off ? 0.6 : 1 }}
        onClick={() => !off && ref.current?.click()}
        onKeyDown={(e) => { if ((e.key === 'Enter' || e.key === ' ') && !off) { e.preventDefault(); ref.current?.click(); } }}
        onDragOver={(e) => { e.preventDefault(); if (!off) setOn(true); }}
        onDragLeave={() => setOn(false)}
        onDrop={(e) => { e.preventDefault(); setOn(false); pick([...e.dataTransfer.files]); }}>
        {label}
        {hint && !compact && <><br /><small>{hint}</small></>}
      </div>
      <input ref={ref} type="file" hidden multiple={multiple} accept={accept ?? pickerAccept} disabled={off}
        onChange={(e) => { const L = [...(e.target.files ?? [])]; e.target.value = ''; pick(L); }} />
      {busy && progress && <div className="note" role="status">{progress}</div>}
      {shown.length > 0 && (
        <ul className="note uvoz-res" style={{ margin: '6px 0 0', paddingLeft: 18 }}>
          {shown.map((r, i) => (
            <li key={i}>
              <span className="pill" style={{ fontSize: 11 }}>{fmt(r.name)}</span> {r.name}{' '}
              <span style={r.ok === false ? { color: 'var(--bad)' } : undefined}>{r.ok === false ? '✗ ' : r.ok ? '✓ ' : ''}{r.msg}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
