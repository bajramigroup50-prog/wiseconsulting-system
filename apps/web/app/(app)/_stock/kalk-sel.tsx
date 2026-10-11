'use client';
/**
 * Selection bar of the input calculations (legacy patch 17282: checkbox column + „Селектирани: N“ with
 * 📦 Пренос во продавница (`ksPren`), 📒 Книга на влезни ф-ри (`ksBook`), 📗 ЕТ (`ksET`), 🗑 Бришење на селектираните
 * (`ksDel`, admin), ✕ Откажи избор (`ksClr`)). Row checkboxes: `name="ks"`.
 */
import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { deletePurchaseAction } from '../vlez/actions';
import { mergeCalcsAction } from '../_retail/kalk-actions';

const boxes = () => Array.from(document.querySelectorAll<HTMLInputElement>('input[name="ks"]'));
const sel = () => boxes().filter((c) => c.checked);

export function KsAll() {
  return <input type="checkbox" title="Избери ги сите" aria-label="Избери ги сите" onChange={(e) => { for (const c of boxes()) c.checked = e.target.checked; document.dispatchEvent(new Event('kssel')); }} />;
}

export function KsBar({ admin, warehouse, fix = false }: { admin: boolean; warehouse: boolean; fix?: boolean }) {
  const [n, setN] = useState(0);
  const [pending, start] = useTransition();
  const router = useRouter();
  useEffect(() => {
    const upd = () => setN(sel().length);
    document.addEventListener('change', upd);
    document.addEventListener('kssel', upd);
    return () => { document.removeEventListener('change', upd); document.removeEventListener('kssel', upd); };
  }, []);
  const need = () => { const L = sel(); if (!L.length) window.alert('Селектирајте барем една калкулација (кутичката лево).'); return L; };
  return (
    <div className="card noprint" style={{ padding: '8px 12px' }}>
      <div className="row" style={{ gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
        <b style={{ marginRight: 6 }}>Селектирани: {n}</b>
        {warehouse && <button type="button" className="btn sm pri" title="Стоката од селектираните калкулации во продавница (преносница)" onClick={() => {
          const L = need(); if (!L.length) return;
          const wh = [...new Set(L.map((c) => c.dataset.wh))];
          if (wh.length > 1) { window.alert('Селектираните калкулации се од различни објекти – изберете од еден магацин.'); return; }
          router.push('/prenosi?calc=' + L.map((c) => c.value).join(','));
        }}>📦 Пренос во продавница</button>}
        <button type="button" className="btn sm" onClick={() => {
          // legacy `ksInv`: the goods of the selected calculations as a new outgoing invoice
          const L = need(); if (!L.length) return;
          router.push('/izlez?calc=' + L.map((c) => c.value).join(','));
        }}>📄 Копирање на калкулацијата во излез</button>
        {fix && <button type="button" className="btn sm" disabled={pending} onClick={() => {
          // legacy `ksMerge`: one supplier, one location, no import calculations
          const L = need(); if (!L.length) return;
          if (L.length < 2) { window.alert('Селектирајте најмалку две калкулации.'); return; }
          if (new Set(L.map((c) => c.dataset.wh)).size > 1 || new Set(L.map((c) => c.dataset.p)).size > 1) { window.alert('Спојување е можно само за ист добавувач и ист објект.'); return; }
          if (L.some((c) => c.dataset.imp === '1')) { window.alert('Увозни калкулации не се спојуваат (различни курсеви и трошоци).'); return; }
          if (!window.confirm(`Да се спојат ${L.length} калкулации (${L.map((c) => c.dataset.no ?? '').join(', ')}) во една нова?\nСтарите се бришат.`)) return;
          start(async () => { const r = await mergeCalcsAction(L.map((c) => c.value)); if (r?.error) window.alert(r.error); });
        }}>🔗 Спојување на селектираните</button>}
        <button type="button" className="btn sm" title="Секоја зачувана калкулација/фактура веќе е во книгата на влезни фактури и во налогот 2." onClick={() => router.push('/ddvKnigi?t=in')}>📒 Книга на влезни ф-ри</button>
        <button type="button" className="btn sm" title="Калкулациите во магацин автоматски се во ЕТ (трговска книга на големо)." onClick={() => router.push('/g_trgv')}>📗 ЕТ</button>
        {admin && <button type="button" className="btn sm ghost" style={{ color: 'var(--bad)' }} disabled={pending} onClick={() => {
          const L = need(); if (!L.length) return;
          if (!window.confirm(`Да се избришат ${L.length} калкулации?\nСе бришат и налозите и приемот на залиха.`)) return;
          start(async () => {
            const errs: string[] = [];
            for (const c of L) { const r = await deletePurchaseAction(c.value); if (r.error) errs.push(r.error); }
            if (errs.length) window.alert(`${errs.length} калкулации не се избришани: ${errs.slice(0, 3).join('; ')}`);
            router.refresh();
          });
        }}>🗑 Бришење на селектираните</button>}
        {n > 0 && <button type="button" className="btn sm ghost" onClick={() => { for (const c of boxes()) c.checked = false; setN(0); }}>✕ Откажи избор</button>}
      </div>
    </div>
  );
}
