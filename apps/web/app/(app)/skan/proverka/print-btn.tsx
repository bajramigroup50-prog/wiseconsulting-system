'use client';
/** „🖨 Печати листа“ of the check list. */
export function PrintBtn() {
  return <button type="button" className="btn noprint" onClick={() => window.print()}>🖨 Печати листа</button>;
}
