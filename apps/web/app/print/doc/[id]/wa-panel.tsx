'use client';
/**
 * WhatsApp / Viber panel of the document preview (legacy `sendWa` 7058, `shareDoc` 7064, `waCopy` 7069): the payment
 * message, a QR of the wa.me link for the phone, open WhatsApp / Viber, share the PDF + message from a phone,
 * copy the message. Hidden on paper and left out of the server PDF.
 */
import { useMemo, useState } from 'react';
import { qrDataUrl } from '@wise/core/sales';
import { serverPdf } from '@/lib/print-pdf';

export function WaPanel({ phone, text, pdfName }: { phone: string; text: string; pdfName: string }) {
  const [ph, setPh] = useState(phone);
  const [tx, setTx] = useState(text);
  const [msg, setMsg] = useState('');
  const n = ph.replace(/\D/g, '');
  const wa = 'https://wa.me/' + n + '?text=' + encodeURIComponent(tx);
  const qr = useMemo(() => qrDataUrl(wa, 3), [wa]);
  const share = async () => {
    try {
      const nav = navigator as Navigator & { canShare?: (d: unknown) => boolean };
      if (nav.share) { await nav.share({ text: tx, title: pdfName }); return; }
    } catch (e) { if ((e as Error)?.name === 'AbortError') return; }
    setMsg('Споделувањето не е достапно на овој уред – преземете го PDF-от и прикачете го во разговорот.');
  };
  return (
    <details className="noprint card" style={{ width: '190mm', maxWidth: '100%', margin: '0 auto 12px' }}>
      <summary style={{ cursor: 'pointer', fontWeight: 600 }}>WhatsApp / Viber</summary>
      <div className="row" style={{ gap: 16, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 280 }}>
          <label className="f">Телефон на купувачот (со 389)<input value={ph} onChange={(e) => setPh(e.target.value)} placeholder="38970123456" /></label>
          <label className="f">Порака<textarea rows={5} value={tx} onChange={(e) => setTx(e.target.value)} /></label>
          <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
            <a className="btn pri" href={wa} target="_blank" rel="noopener noreferrer">Отвори WhatsApp (на компјутер)</a>
            <a className="btn" href={'viber://forward?text=' + encodeURIComponent(tx)}>Отвори Viber</a>
            <button type="button" className="btn" onClick={() => void share()}>📤 Сподели PDF + порака (телефон)</button>
            <button type="button" className="btn" onClick={async () => {
              try { await navigator.clipboard.writeText(tx); setMsg('Пораката е копирана – залепете ја во WhatsApp (Ctrl+V).'); } catch { setMsg('Означена е – притиснете Ctrl+C.'); }
            }}>📋 Копирај ја пораката</button>
            <button type="button" className="btn" onClick={() => void serverPdf({ selector: '#printArea .pdfdoc', title: pdfName })}>⬇ 1. Преземи ја фактурата (PDF)</button>
          </div>
          {msg && <p className="note">{msg}</p>}
          <ol className="note"><li>Преземете ја фактурата (PDF).</li><li>Отворете WhatsApp (копче или QR) – пораката е готова, притиснете Send.</li><li>Во истиот разговор притиснете <b>📎 → Document / Документ</b> и изберете ја <b>{pdfName}.pdf</b> од Downloads.</li></ol>
          <p className="note">WhatsApp не дозволува програмите сами да прикачат датотека: пораката со износот и жиро сметката оди автоматски, а PDF-от (преземен со „⬇ Преземи PDF“) го прикачувате со 📎 во разговорот.</p>
        </div>
        <div style={{ textAlign: 'center' }}>{qr && n && <img src={qr} alt="QR" style={{ width: 230, height: 230, imageRendering: 'pixelated' }} />}<div className="mini">Скенирај со телефон →<br />се отвора WhatsApp</div></div>
      </div>
    </details>
  );
}
