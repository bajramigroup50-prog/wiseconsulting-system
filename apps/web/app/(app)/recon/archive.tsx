'use client';
/**
 * Legacy `ACT.recDone` 13725 („✅ Заврши и архивирај“) + `recArchive` 13723: the balance confirmation (ИОС, with the
 * difference noted) and the reconciliation record are rendered as PDFs and filed in the firm's dossier („Документи на
 * фирмата“ › „Усогласување со комитенти (ИОС)“), then the ИОС can be opened. `potvrda` is omitted for the free comparison of
 * two cards (`recFree`), which files the record only.
 */
import { useState } from 'react';
import { DOS_REC_CAT } from '@wise/core/office';
import { fmt } from '@/lib/fmt';
import { captureUrl, pageCss, requestPdf } from '@/lib/pdf-capture';

const dm = (d: string) => d.split('-').reverse().join('.');

export function RecArchive({ partner, from, to, sO, dif, ok, potvrda }: {
  partner: string; from: string; to: string; sO: number; dif: number; ok: boolean; potvrda?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [ios, setIos] = useState('');
  const note = `Салдо кај нас ${fmt(sO)} · разлика ${fmt(dif)}`;
  const run = async () => {
    setBusy(true); setMsg('');
    try {
      const el = document.querySelector('#recDoc .pdfdoc');
      if (!el) throw new Error('Нема записник.');
      // legacy `recZapHTML` = ph(title, sub) (with the firm head) + the tables: the server puts the firm head in front
      const z = el.cloneNode(true) as HTMLElement;
      const pt = z.querySelector('.ph .pt')?.textContent ?? 'ЗАПИСНИК ЗА УСОГЛАСУВАЊЕ НА КАРТИЦА', ps = z.querySelector('.ph .ps')?.textContent ?? '';
      z.querySelector('.ph')?.remove();
      await requestPdf({
        html: z.innerHTML, css: pageCss(), title: pt, head: { sub: ps },
        save: { to: 'dossier', category: DOS_REC_CAT, title: `Записник за усогласување ${partner} ${dm(from)} – ${dm(to)}`, date: to, partner, note },
      });
      let n = 1;
      if (potvrda) {
        const c = await captureUrl(potvrda);
        const t = `Потврда на салдо – ${partner} на ${dm(to)}`;
        setIos(await requestPdf({ ...c, title: `Potvrda_saldo_${partner}_${to}`, save: { to: 'dossier', category: DOS_REC_CAT, title: t, date: to, partner, note } }));
        n++;
      }
      setMsg(`📁 ${n === 2 ? 'ИОС-потврдата и записникот се зачувуваат' : 'Записникот се зачувува'} во „Документи на фирмата“ (Усогласување со комитенти).`);
    } catch (e) {
      setMsg('Не е зачувано: ' + ((e as Error).message || e));
    } finally { setBusy(false); }
  };
  return (
    <span className="row" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
      {potvrda && <a className="btn" href={potvrda} target="_blank" rel="noopener">📄 Потврда на салдо</a>}
      <button type="button" className="btn pri" disabled={busy} onClick={run} title="Ги прави ИОС-потврдата и записникот и ги зачувува во досието">
        {busy ? 'Се подготвува…' : `✅ Заврши и архивирај${ok ? '' : ' (со разликите)'}`}
      </button>
      {msg && <span className="mini">{msg}</span>}
      {ios && <a className="btn sm" href={'/api/files/' + ios} target="_blank" rel="noopener" title="Достапно штом серверот ќе го изработи PDF-от">⬇ ИОС (PDF)</a>}
    </span>
  );
}
