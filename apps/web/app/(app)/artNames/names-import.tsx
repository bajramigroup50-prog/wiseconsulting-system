'use client';
/** Legacy `anImp` (17363): Excel with columns Шифра and Назив (any sheet; header found in the first 30 rows). */
import { startTransition, useActionState, useRef } from 'react';
import type { ActionState } from '@/lib/books';
import { artNamesImportAction } from '../_retail/actions';
import { readRows } from '../_retail/read-file';

const CODE = /шифра|šifra|sifra|code|kodi|šifr|арт\.?\s*бр/i;
const NAME = /назив|naziv|name|emri|опис|artikl|артикл/i;

export function NamesImport() {
  const [st, run, pending] = useActionState<ActionState, FormData>(artNamesImportAction, {});
  const inp = useRef<HTMLInputElement>(null);
  const pick = async (f: File | undefined) => {
    if (!f) return;
    const A = (await readRows(f)).filter((r) => r.some((x) => String(x ?? '').trim()));
    let hi = -1, cC = -1, cN = -1;
    for (let k = 0; k < Math.min(30, A.length); k++) {
      const H = A[k]!.map((x) => String(x ?? '').trim());
      const c = H.findIndex((x) => CODE.test(x)), n = H.findIndex((x) => NAME.test(x));
      if (c >= 0 && n >= 0 && c !== n) { hi = k; cC = c; cN = n; break; }
    }
    if (hi < 0) { window.alert('Потребни се колони Шифра и Назив.'); return; }
    const rows = A.slice(hi + 1).map((r) => ({ code: String(r[cC] ?? '').trim(), name: String(r[cN] ?? '').trim() })).filter((r) => r.code && r.name);
    if (!window.confirm(`Да се сменат називите според ${rows.length} редови од „${f.name}“?`)) return;
    const fd = new FormData();
    fd.set('payload', JSON.stringify({ rows }));
    startTransition(() => run(fd));
  };
  return (
    <>
      <button type="button" className="btn" disabled={pending} onClick={() => inp.current?.click()}>📥 Називи од Excel (Шифра · Назив)</button>
      <input ref={inp} type="file" hidden accept=".xlsx,.xls,.csv" onChange={(e) => { void pick(e.target.files?.[0]); e.target.value = ''; }} />
      {st.error && <span className="pill bad">{st.error}</span>}{st.ok && <span className="pill good">{st.ok}</span>}
    </>
  );
}
