'use client';
export function PrintBtn() {
  return <button type="button" className="btn" onClick={() => window.print()}>⬇ PDF / Печати</button>;
}
