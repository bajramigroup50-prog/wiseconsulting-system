'use client';
/** Renders the ticked archive files for printing: photos as they are, PDFs page by page (pdf.js), each page stamped. */
import { useEffect, useRef, useState } from 'react';

type Item = { id: string; name: string; mime: string; label: string };
const isPdf = (x: Item) => /pdf/i.test(x.mime) || /\.pdf$/i.test(x.name);

const CSS = `@page{size:A4;margin:8mm}.ap{font-family:Arial,sans-serif}
.ap-bar{position:sticky;top:0;background:#fff;padding:8px 0;display:flex;gap:10px;align-items:center;border-bottom:1px solid #ddd;margin-bottom:10px}
.ap-page{page-break-after:always;break-after:page;margin:0 0 16px}.ap-page:last-child{page-break-after:auto}
.ap-stamp{border:2px solid #b00;color:#b00;font-weight:700;font-size:10pt;padding:3px 8px;margin:0 0 4px;display:inline-block}
.ap-img{max-width:100%;max-height:265mm;display:block;margin:0 auto}@media print{.ap-bar{display:none}}`;

function PdfPages({ item, stamp, onDone }: { item: Item; stamp: string; onDone: () => void }) {
  const box = useRef<HTMLDivElement>(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    let off = false;
    (async () => {
      try {
        const pdfjs = await import('pdfjs-dist');
        if (!pdfjs.GlobalWorkerOptions.workerPort) pdfjs.GlobalWorkerOptions.workerPort = new Worker(new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url), { type: 'module' });
        const data = new Uint8Array(await (await fetch(`/api/files/${item.id}`)).arrayBuffer());
        const doc = await pdfjs.getDocument({ data }).promise;
        for (let p = 1; p <= doc.numPages && !off; p++) {
          const page = await doc.getPage(p);
          const vp = page.getViewport({ scale: 1.6 });
          const c = document.createElement('canvas');
          c.width = vp.width; c.height = vp.height;
          await page.render({ canvas: c, canvasContext: c.getContext('2d')!, viewport: vp }).promise;
          const wrap = document.createElement('div');
          wrap.className = 'ap-page';
          const head = document.createElement('div');
          head.className = 'ap-stamp';
          head.textContent = `${stamp} · ${item.label} · стр. ${p}/${doc.numPages}`;
          const img = document.createElement('img');
          img.src = c.toDataURL('image/jpeg', 0.9);
          img.className = 'ap-img';
          wrap.append(head, img);
          box.current?.append(wrap);
        }
      } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
      onDone();
    })();
    return () => { off = true; };
  }, [item.id]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div ref={box}>
      {err && <div className="ap-page"><div className="ap-stamp">{stamp} · {item.label}</div><p>PDF-от не може да се прикаже за печатење ({err}) – <a href={`/api/files/${item.id}`} target="_blank" rel="noreferrer">отворете го</a>.</p></div>}
    </div>
  );
}

export function ArchPrint({ items, stamp }: { items: Item[]; stamp: string }) {
  const [left, setLeft] = useState(items.filter(isPdf).length);
  return (
    <div className="ap">
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <div className="ap-bar">
        <button type="button" onClick={() => window.print()} disabled={left > 0} style={{ padding: '6px 14px', fontWeight: 700 }}>{left > 0 ? `Се подготвуваат PDF-овите… (${left})` : '🖨 Печати'}</button>
        <span>{items.length} документи · секоја страница е означена „АРХИВСКИ ПРИМЕРОК“</span>
      </div>
      {!items.length && <p>Нема избрани документи.</p>}
      {items.map((x) => (isPdf(x)
        ? <PdfPages key={x.id} item={x} stamp={stamp} onDone={() => setLeft((n) => n - 1)} />
        // eslint-disable-next-line @next/next/no-img-element
        : <div key={x.id} className="ap-page"><div className="ap-stamp">{stamp} · {x.label}</div><img className="ap-img" src={`/api/files/${x.id}`} alt={x.name} /></div>))}
    </div>
  );
}
