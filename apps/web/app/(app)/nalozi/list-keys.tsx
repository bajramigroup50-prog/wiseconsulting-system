'use client';
/**
 * „Преглед на финансови налози за книжење“ like the old program: the panel on the right with
 * „Книжење (F10)“ · „Нов (Ins)“ · „Промена (Ent)“ · „Бришење (Del)“, and the keyboard: ↑ ↓ select a row, Enter =
 * Промена, Ins = Нов, Del = Бришење (the row's own „🗑 Избриши“ with its preview / confirm), F8 = „Синтетики“,
 * F10 = Книжење, + / − = selection with the sums of the selected nalozi.
 *
 * „Нов (Ins)“ first OPENS the nalog – the dialog „Податоци за налог“: Број на налог (F5 = the next number), Датум,
 * Прекн. – Непрекн. (Да / Не), Опис, „Во ред (F9)“ / „Излез (Esc)“ – the nalog appears in the list (selected) and its
 * lines are entered with „Книжење (F10)“. „Промена (Ent)“ on a manual nalog opens the same dialog with its data; on a
 * nalog of documents it opens the nalog. Works on the server-rendered rows (`tr[data-nal]` with `data-d` / `data-p`,
 * `data-jid` / `data-date` / `data-desc` / `data-prek` on a single manual nalog).
 */
import { useRouter, useSearchParams } from 'next/navigation';
import { useActionState, useEffect, useRef, useState } from 'react';
import { nextNalogNumberAction, openNalogAction } from './actions';

const nf = new Intl.NumberFormat('mk-MK', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

interface Head { id: string | null; number: string; date: string; description: string; prek: boolean }

export function ListKeys({ tableId, canWrite, today }: { tableId: string; canWrite: boolean; today: string }) {
  const router = useRouter();
  const sp = useSearchParams();
  const [sel, setSel] = useState(0);
  const [mark, setMark] = useState<Set<string>>(new Set());
  const [dlg, setDlg] = useState<Head | null>(null);
  const rows = () => [...(document.getElementById(tableId)?.querySelectorAll<HTMLTableRowElement>('tr[data-nal]') ?? [])];

  // „+ Нов налог (Ins)“ of the header (`?novo`) opens the dialog
  const novo = !!sp?.has('novo');
  useEffect(() => { if (novo && canWrite) setDlg({ id: null, number: '', date: today, description: '', prek: true }); }, [novo]); // eslint-disable-line react-hooks/exhaustive-deps
  // a nalog just opened (`?sel=`) is the selected row
  const want = sp?.get('sel') ?? null;
  useEffect(() => {
    if (!want) return;
    const i = rows().findIndex((tr) => tr.dataset.nal === want);
    if (i >= 0) setSel(i);
  }, [want]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const R = rows();
    R.forEach((tr, i) => {
      tr.setAttribute('aria-selected', String(i === sel));
      tr.style.outline = i === sel ? '2px solid var(--accent)' : '';
      tr.style.outlineOffset = '-2px';
      tr.style.background = mark.has(tr.dataset.nal!) ? 'var(--warn-bg, #fff7e0)' : '';
    });
    R[sel]?.scrollIntoView?.({ block: 'nearest' });
  });

  const cur = () => rows()[sel];
  const open = (q: string) => { const a = cur()?.querySelector<HTMLAnchorElement>(q); if (a) router.push(a.getAttribute('href')!); };
  const act = {
    book: () => open('a[data-book]'),
    neu: () => { if (canWrite) setDlg({ id: null, number: '', date: today, description: '', prek: true }); },
    change: () => {
      const tr = cur();
      if (!tr) return;
      // a single manual nalog: its header data („Податоци за налог“); otherwise the nalog itself
      if (canWrite && tr.dataset.jid) setDlg({ id: tr.dataset.jid, number: tr.dataset.nal ?? '', date: tr.dataset.date ?? today, description: tr.dataset.desc ?? '', prek: tr.dataset.prek !== '0' });
      else open('a[data-open]');
    },
    del: () => cur()?.querySelector<HTMLButtonElement>('[data-del] button, button[data-del]')?.click(),
  };

  useEffect(() => {
    const tb = document.getElementById(tableId);
    const click = (e: MouseEvent) => {
      const tr = (e.target as HTMLElement).closest?.('tr[data-nal]');
      if (tr) setSel(rows().indexOf(tr as HTMLTableRowElement));
    };
    const dbl = (e: MouseEvent) => { if ((e.target as HTMLElement).closest?.('tr[data-nal]') && !(e.target as HTMLElement).closest('a,button')) act.change(); };
    tb?.addEventListener('click', click);
    tb?.addEventListener('dblclick', dbl);
    const k = (e: KeyboardEvent) => {
      if (e.defaultPrevented || dlg) return; // the dialog has its own keys
      const tg = (e.target as HTMLElement)?.tagName;
      if (tg === 'INPUT' || tg === 'SELECT' || tg === 'TEXTAREA') return;
      const R = rows();
      const go = (f: () => void) => { e.preventDefault(); f(); };
      if (e.key === 'ArrowDown') go(() => setSel((s) => Math.min(s + 1, R.length - 1)));
      else if (e.key === 'ArrowUp') go(() => setSel((s) => Math.max(s - 1, 0)));
      else if (e.key === 'Insert') go(act.neu);
      else if (e.key === 'Enter' && tg !== 'BUTTON' && tg !== 'A') go(act.change);
      else if (e.key === 'Delete') go(act.del);
      else if (e.key === 'F8') go(() => open('a[data-sint]'));
      else if (e.key === 'F10') go(act.book);
      else if (e.key === '+' || e.key === '-') go(() => {
        const id = R[sel]?.dataset.nal;
        if (id) setMark((M) => { const n = new Set(M); if (e.key === '+') n.add(id); else n.delete(id); return n; });
        setSel((s) => Math.min(s + 1, R.length - 1));
      });
    };
    window.addEventListener('keydown', k);
    return () => { window.removeEventListener('keydown', k); tb?.removeEventListener('click', click); tb?.removeEventListener('dblclick', dbl); };
  });

  const M = mark.size ? rows().filter((tr) => mark.has(tr.dataset.nal!)) : [];
  const D = M.reduce((s, tr) => s + Number(tr.dataset.d), 0), P = M.reduce((s, tr) => s + Number(tr.dataset.p), 0);
  return (
    <>
      <aside className="card nal-panel" aria-label="Налози – акции" style={{ position: 'sticky', top: 70, alignSelf: 'flex-start', display: 'flex', flexDirection: 'column', gap: 8, padding: 10, minWidth: 150 }}>
        {canWrite && <button type="button" className="btn" onClick={act.book} title="Ставките на избраниот налог">Книжење (F10)</button>}
        <span style={{ height: 14 }} />
        {canWrite && <button type="button" className="btn pri" onClick={act.neu} title="Отвори нов налог: број, датум, опис">Нов (Ins)</button>}
        <button type="button" className="btn" onClick={act.change} title="Податоци за избраниот налог (рачен) / отвори го налогот">Промена (Ent)</button>
        <button type="button" className="btn danger" onClick={act.del} title="Избриши го избраниот налог">Бришење (Del)</button>
        <span className="mini" style={{ marginTop: 6, lineHeight: 1.4 }}>↑ ↓ избор · F8 синтетики · + / − селекција</span>
        {mark.size > 0 && (
          <span className="mini" data-testid="list-sel">
            Селекција {mark.size}<br />Должи <b>{nf.format(D)}</b><br />Побарува <b>{nf.format(P)}</b><br />Салдо <b>{nf.format(D - P)}</b>
            <br /><button type="button" className="btn sm ghost" onClick={() => setMark(new Set())}>✕</button>
          </span>
        )}
      </aside>
      {dlg && <NalogDialog key={dlg.id ?? 'new'} head={dlg} onClose={() => setDlg(null)} onDone={(no) => { setDlg(null); router.push(`/nalozi?sel=${encodeURIComponent(no)}`); router.refresh(); }} />}
    </>
  );
}

/** „Податоци за налог“: Број на налог (F5), Датум, Прекн. – Непрекн., Опис · „Во ред (F9)“ / „Излез (Esc)“. */
function NalogDialog({ head, onClose, onDone }: { head: Head; onClose: () => void; onDone: (no: string) => void }) {
  const [h, setH] = useState(head);
  const [st, run, pending] = useActionState(openNalogAction, {});
  const formRef = useRef<HTMLFormElement>(null);
  const noRef = useRef<HTMLInputElement>(null);
  const [hint, setHint] = useState('');
  useEffect(() => { noRef.current?.focus(); }, []);
  useEffect(() => { if (st.ok && st.no) onDone(st.no); }, [st]); // eslint-disable-line react-hooks/exhaustive-deps
  const suggest = async () => {
    const r = await nextNalogNumberAction(h.date);
    if (r.no) { setH((x) => ({ ...x, number: r.no! })); setHint(''); } else setHint(r.error ?? '');
  };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); onClose(); }
    else if (e.key === 'F9') { e.preventDefault(); formRef.current?.requestSubmit(); }
    else if (e.key === 'F5') { e.preventDefault(); void suggest(); }
    else if (e.key === 'Enter' && (e.target as HTMLElement).tagName === 'INPUT' && (e.target as HTMLInputElement).type !== 'radio') {
      // Enter moves to the next field (like the old program); on the last field it confirms
      e.preventDefault();
      const F = [...(formRef.current?.querySelectorAll<HTMLInputElement>('input:not([type=hidden])') ?? [])].filter((x) => x.type !== 'radio' || x.checked);
      const i = F.indexOf(e.target as HTMLInputElement);
      if (i >= 0 && i < F.length - 1) F[i + 1]!.focus(); else formRef.current?.requestSubmit();
    }
  };
  return (
    <div role="dialog" aria-modal="true" aria-label="Податоци за налог" onKeyDown={onKey}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.25)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
      <form ref={formRef} action={run} className="card" style={{ width: 'min(520px, 94vw)', padding: 16, margin: 0 }}>
        <h2 style={{ marginTop: 0 }}>Податоци за налог</h2>
        {h.id && <input type="hidden" name="id" value={h.id} />}
        {st.error && <div className="callout bad" role="alert">{st.error}</div>}
        <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr auto', gap: '10px 12px', alignItems: 'center' }}>
          <label htmlFor="nd_no">Број на налог (F5)</label>
          <input id="nd_no" ref={noRef} name="number" value={h.number} onChange={(e) => setH({ ...h, number: e.target.value })} placeholder="празно = следен број" style={{ background: 'var(--warn-bg, #fffbe0)' }} />
          <fieldset style={{ gridRow: 'span 2', border: '1px solid var(--line)', borderRadius: 6, padding: '4px 10px', margin: 0 }}>
            <legend className="mini">Прекн. – Непрекн.</legend>
            <div style={{ display: 'flex', gap: 14 }}>
              <label style={{ display: 'inline-flex', gap: 4, alignItems: 'center', margin: 0 }}><input type="radio" name="prek" value="da" checked={h.prek} onChange={() => setH({ ...h, prek: true })} style={{ width: 'auto', margin: 0 }} /> Да</label>
              <label style={{ display: 'inline-flex', gap: 4, alignItems: 'center', margin: 0 }}><input type="radio" name="prek" value="ne" checked={!h.prek} onChange={() => setH({ ...h, prek: false })} style={{ width: 'auto', margin: 0 }} /> Не</label>
            </div>
          </fieldset>
          <label htmlFor="nd_date">Датум</label>
          <input id="nd_date" type="date" name="date" value={h.date} required onChange={(e) => setH({ ...h, date: e.target.value })} style={{ background: 'var(--warn-bg, #fffbe0)' }} />
          <label htmlFor="nd_desc">Опис</label>
          <input id="nd_desc" name="description" value={h.description} onChange={(e) => setH({ ...h, description: e.target.value })} style={{ gridColumn: 'span 2' }} />
        </div>
        {hint && <p className="mini" style={{ color: 'var(--bad)' }}>{hint}</p>}
        <div className="row" style={{ gap: 10, marginTop: 16, justifyContent: 'space-between' }}>
          <button className="btn pri" disabled={pending} style={{ flex: 1 }}>Во ред (F9)</button>
          <button type="button" className="btn" onClick={onClose} style={{ flex: 1 }}>Излез (Esc)</button>
        </div>
        <p className="mini muted" style={{ marginBottom: 0 }}>F5 = следен број на налог · Enter = следно поле · ставките се внесуваат потоа со „Книжење (F10)“.</p>
      </form>
    </div>
  );
}
