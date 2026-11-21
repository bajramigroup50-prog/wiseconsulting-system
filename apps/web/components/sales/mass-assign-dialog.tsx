'use client';
/**
 * „Масовно доделување“ (Специјални опции of Излез / Влез, like the old program): the ticked documents (checkbox, „+“ or
 * „*“; none ticked = the current row) get the same Терк и налог, Комитент, Датум и валута. `what` opens the dialog on
 * one group of fields (the four menu items of the old program); empty fields are not changed.
 */
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { massAssignAction } from '@/app/(app)/izlez/mass-assign';
import { NalogPicker } from '@/components/nalog-picker';
import { PartnerPicker, type PickerPartner } from '@/components/partner-picker';

export type MassWhat = 'nalog' | 'partner' | 'date';
const TITLE: Record<MassWhat, string> = { nalog: 'Масовно доделување на терк и налог', partner: 'Масовно доделување на комитент', date: 'Масовно доделување на датум и валута' };

/** Ids of the ticked rows of the table (checkbox / marked), or the current row. */
export function pickedIds(tableId: string): { ids: string[]; numbers: string[] } {
  const R = [...document.querySelectorAll<HTMLTableRowElement>(`#${CSS.escape(tableId)} tr[data-id]`)];
  let T = R.filter((tr) => tr.classList.contains('hx-marked') || !!tr.querySelector<HTMLInputElement>('input[type=checkbox]:checked'));
  if (!T.length) T = R.filter((tr) => tr.getAttribute('aria-selected') === 'true');
  return { ids: T.map((tr) => tr.dataset.id!), numbers: T.map((tr) => tr.dataset.no ?? '') };
}

export function MassAssignDialog({ tableId, kind, partners, schemes, today }: {
  tableId: string; kind: 'invoice' | 'purchase'; partners?: PickerPartner[]; schemes?: { no: number; label: string }[]; today: string;
}) {
  const router = useRouter();
  const [what, setWhat] = useState<MassWhat | null>(null);
  const [sel, setSel] = useState<{ ids: string[]; numbers: string[] }>({ ids: [], numbers: [] });
  const [f, setF] = useState({ nalogNo: '', scheme: '', partnerId: '', date: '', due: '' });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok?: string; error?: string; skipped?: string[] } | null>(null);

  useEffect(() => {
    const open = (e: Event) => {
      const w = (e as CustomEvent).type.replace('hx:mass-', '') as MassWhat;
      setSel(pickedIds(tableId)); setF({ nalogNo: '', scheme: '', partnerId: '', date: '', due: '' }); setMsg(null); setWhat(w);
    };
    const ev = ['hx:mass-nalog', 'hx:mass-partner', 'hx:mass-date'];
    ev.forEach((x) => window.addEventListener(x, open));
    return () => ev.forEach((x) => window.removeEventListener(x, open));
  }, [tableId]);

  if (!what) return null;
  const close = () => setWhat(null);
  const run = async () => {
    if (busy) return;
    const patch = what === 'nalog' ? { nalogNo: f.nalogNo, scheme: f.scheme } : what === 'partner' ? { partnerId: f.partnerId } : { date: f.date, due: f.due };
    setBusy(true);
    const r = await massAssignAction(kind, sel.ids, patch);
    setBusy(false);
    setMsg(r);
    if (!r.error) router.refresh();
  };
  return (
    <div className="modal-back" style={{ position: 'fixed', inset: 0, zIndex: 80, background: 'rgba(0,0,0,.25)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 12 }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}>
      <div role="dialog" aria-modal="true" aria-label={TITLE[what]} className="card" style={{ width: 'min(520px, 100%)', margin: 0 }}
        onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); close(); } else if (e.key === 'F9') { e.preventDefault(); void run(); } }}>
        <h3 style={{ marginTop: 0 }}>{TITLE[what]}</h3>
        <p className="mini" style={{ marginTop: 0 }}>
          {sel.ids.length ? <>За <b>{sel.ids.length}</b> {sel.ids.length === 1 ? 'документ' : 'документи'}: {sel.numbers.slice(0, 8).join(', ')}{sel.numbers.length > 8 ? '…' : ''}</> : <span style={{ color: 'var(--bad)' }}>Нема избрани документи – штиклирајте ги (квадратче или „+“).</span>}
          {' '}Празно поле = не се менува; прокнижените се прекнижуваат.
        </p>
        <div className="form" style={{ gap: 8 }}>
          {what === 'nalog' && <>
            <label className="f">Терк (шема за книжење)
              {schemes && schemes.length ? (
                <select value={f.scheme} onChange={(e) => setF({ ...f, scheme: e.target.value })}>
                  <option value="">— не се менува —</option>
                  {schemes.map((s) => <option key={s.no} value={String(s.no)}>{s.label}</option>)}
                </select>
              ) : <input inputMode="numeric" value={f.scheme} onChange={(e) => setF({ ...f, scheme: e.target.value.replace(/\D/g, '').slice(0, 3) })} placeholder="1, 2, 3… (празно = не се менува)" />}
            </label>
            <label className="f">Налог
              <NalogPicker value={f.nalogNo} date={today} onChange={(v) => setF({ ...f, nalogNo: v })} />
            </label>
          </>}
          {what === 'partner' && (
            <label className="f">Комитент (F8)
              {partners ? <PartnerPicker partners={partners} value={f.partnerId} onChange={(id) => setF({ ...f, partnerId: id })} />
                : <span className="mut">Листата на комитенти не е достапна тука.</span>}
            </label>
          )}
          {what === 'date' && <>
            <label className="f">Датум<input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></label>
            <label className="f">Валута (рок за плаќање)<input type="date" value={f.due} onChange={(e) => setF({ ...f, due: e.target.value })} /></label>
          </>}
        </div>
        {msg?.error && <div className="callout bad" role="alert" style={{ marginTop: 8 }}>{msg.error}</div>}
        {msg?.ok && <div className="callout good" role="status" style={{ marginTop: 8 }}>{msg.ok}</div>}
        {!!msg?.skipped?.length && <ul className="mini" style={{ margin: '6px 0 0', color: 'var(--bad)' }}>{msg.skipped.slice(0, 12).map((s, i) => <li key={i}>{s}</li>)}</ul>}
        <div className="row" style={{ gap: 8, marginTop: 12, justifyContent: 'flex-end' }}>
          <button type="button" className="btn pri" disabled={busy || !sel.ids.length} onClick={() => void run()}>{busy ? 'Се доделува…' : 'Во ред (F9)'}</button>
          <button type="button" className="btn" onClick={close}>Излез (Esc)</button>
        </div>
      </div>
    </div>
  );
}
