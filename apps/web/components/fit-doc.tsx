'use client';
/**
 * An A4 document shown whole on any screen: rendered at its paper width (`width`, e.g. 277mm landscape / 190mm
 * portrait) and scaled down to the width of its container on a narrow screen (phone, portal), like a PDF preview —
 * never cut on the right. The children keep their real size, so „⬇ PDF“ (which clones the inner element by its id)
 * and printing stay A4. Pinch-zoom enlarges it on a phone.
 */
import { useLayoutEffect, useRef, useState } from 'react';

export function FitDoc({ width, children }: { width: string; children: React.ReactNode }) {
  const outer = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const [k, setK] = useState(1);
  const [h, setH] = useState<number | undefined>(undefined);
  useLayoutEffect(() => {
    const o = outer.current, i = inner.current;
    if (!o || !i) return;
    const fit = () => {
      const s = Math.min(1, o.clientWidth / Math.max(1, i.offsetWidth));
      setK(s);
      setH(s < 1 ? Math.ceil(i.offsetHeight * s) : undefined);
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(o);
    ro.observe(i);
    return () => ro.disconnect();
  }, []);
  return (
    <div ref={outer} className="fitdoc" style={{ width: '100%', overflow: 'hidden', height: h }}>
      <div ref={inner} style={{ width, margin: k < 1 ? 0 : '0 auto', transform: k < 1 ? `scale(${k})` : undefined, transformOrigin: 'top left' }}>{children}</div>
    </div>
  );
}
