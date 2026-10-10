'use client';
/** Legacy `errCopy`: copy the errors as text for a fix. */
import { useState } from 'react';

export function CopyButton({ text, disabled }: { text: string; disabled?: boolean }) {
  const [ok, setOk] = useState(false);
  return (
    <button className="btn" type="button" disabled={disabled} onClick={async () => {
      try { await navigator.clipboard.writeText(text); setOk(true); setTimeout(() => setOk(false), 2000); } catch { window.alert('Копирањето не успеа.'); }
    }}>{ok ? '✓ Копирано' : '📋 Копирај за поправка'}</button>
  );
}
