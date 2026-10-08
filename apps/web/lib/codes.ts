/**
 * Legacy `nextCode` 3293: next numeric code after the highest one, keeping zero padding
 * (codes like `0007` → `0008`). Non-numeric codes are ignored.
 */
export function nextCode(existing: readonly (string | null | undefined)[]): string {
  const L = existing.map((x) => String(x ?? '').trim()).filter((v) => /^\d+$/.test(v));
  let w = 0, mx = 0;
  for (const v of L) { mx = Math.max(mx, +v); if (v.length > 1 && v[0] === '0') w = Math.max(w, v.length); }
  const n = mx + 1;
  return w ? String(n).padStart(w, '0') : String(n);
}
