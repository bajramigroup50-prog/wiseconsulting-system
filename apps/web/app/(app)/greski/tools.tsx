'use client';
import { useState } from 'react';

/** Legacy `errCopy`: copy the listed errors as text to paste into a conversation with Claude. */
export function CopyButton({ text, disabled }: { text: string; disabled?: boolean }) {
  const [msg, setMsg] = useState('');
  return (
    <button type="button" className="btn" disabled={disabled} title={msg || undefined} onClick={async () => {
      try { await navigator.clipboard.writeText(text); setMsg('Копирано – залепете го во разговорот со Claude.'); } catch {
        const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select();
        try { document.execCommand('copy'); setMsg('Копирано.'); } catch { setMsg('Копирањето не успеа.'); }
        ta.remove();
      }
      window.alert('Копирано – залепете го во разговорот со Claude.');
    }}>📋 Копирај за поправка</button>
  );
}

/** Legacy `errTest`: throw a test error so the register can be checked. */
export function TestButton() {
  return (
    <button type="button" className="btn" onClick={() => {
      setTimeout(() => { throw new Error('Тест-грешка од регистарот (' + new Date().toLocaleTimeString() + ')'); }, 10);
      setTimeout(() => location.reload(), 1200);
    }}>Тест</button>
  );
}
