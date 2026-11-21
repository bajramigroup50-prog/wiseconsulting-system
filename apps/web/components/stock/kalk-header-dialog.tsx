'use client';
/**
 * „Податоци за малопродажна калкулација“ like the old program Helix – the header of a goods document, entered before
 * its lines: „Нов (Ins)“ on Материјално › Влез / Влезни калкулации opens it, „Во ред (F9)“ opens the WISE document of
 * the chosen Тип (влезна фактура, повратница, прием по испратница, нивелација, излезна фактура, парагон, нарачка,
 * контролен попис) with the header filled in; „Излез (Esc)“ closes it. Keys: F5 По документ, F6 Број на испратница,
 * F7 Тип (next), F8 Комитент (search), F9 Во ред, Esc Излез, Enter next field; on „Посебни“ `*` / `+` / `-` select all /
 * add / remove the linked earlier (advance) calculations.
 */
import { NalogPicker } from '@/components/nalog-picker';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { blankHeader, headerHref, headerLocation, KALK_TIPS, type KalkHeader, type KalkTip } from '@/lib/kalk-header';
import type { KalkDialogData } from '@/lib/kalk-header-data';
import { nextCalcNoAction } from '@/app/(app)/vlez/actions';

const nf = new Intl.NumberFormat('mk-MK', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const Y: React.CSSProperties = { background: 'var(--warn-bg, #fffbe0)' };

/** „Нов (Ins)“ button + the Ins key of the list + `?hnov` (header link) → the dialog. */
export function KalkNewKeys({ data, today, defaults, label = 'Нов (Ins)' }: { data: KalkDialogData; today: string; defaults?: Partial<KalkHeader>; label?: string }) {
  const sp = useSearchParams();
  const [open, setOpen] = useState(false);
  const want = !!sp?.has('hnov');
  useEffect(() => { if (want) setOpen(true); }, [want]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.defaultPrevented || open || e.key !== 'Insert') return;
      const tg = (e.target as HTMLElement)?.tagName;
      if (tg === 'INPUT' || tg === 'SELECT' || tg === 'TEXTAREA') return;
      e.preventDefault(); setOpen(true);
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [open]);
  return (
    <>
      <button type="button" className="btn pri" onClick={() => setOpen(true)} title="Податоци за малопродажна калкулација: број, објект, комитент, тип…">{label}</button>
      {open && <KalkHeaderDialog data={data} initial={blankHeader(today, defaults)} onClose={() => setOpen(false)} />}
    </>
  );
}

export function KalkHeaderDialog({ data, initial, onClose, onDone }: { data: KalkDialogData; initial: KalkHeader; onClose: () => void; onDone?: (href: string) => void }) {
  const router = useRouter();
  const [h, setH] = useState<KalkHeader>(initial);
  const [tab, setTab] = useState<'osn' | 'pos'>('osn');
  const [err, setErr] = useState('');
  const [noEdited, setNoEdited] = useState(!!initial.calcNo);
  const [pq, setPq] = useState(() => data.partners.find((p) => p.id === initial.partnerId)?.name ?? '');
  const [pOpen, setPOpen] = useState(false);
  const [cur, setCur] = useState(0);
  const formRef = useRef<HTMLFormElement>(null);
  const R = { no: useRef<HTMLInputElement>(null), doc: useRef<HTMLInputElement>(null), disp: useRef<HTMLInputElement>(null), kom: useRef<HTMLInputElement>(null), tip: useRef<HTMLFieldSetElement>(null) };
  const set = (x: Partial<KalkHeader>) => setH((o) => ({ ...o, ...x }));
  const wh = data.locations.filter((l) => l.kind === 'warehouse'), st = data.locations.filter((l) => l.kind === 'store');
  const loc = headerLocation(h);

  useEffect(() => { R.no.current?.focus(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // „Калкулација број“: the next number of the object on the date, until it is typed by hand
  useEffect(() => {
    if (noEdited || !h.date) return;
    let live = true;
    void nextCalcNoAction(loc, h.date).then((r) => { if (live && r.no) setH((o) => ({ ...o, calcNo: r.no! })); });
    return () => { live = false; };
  }, [loc, h.date, noEdited]);

  const P = useMemo(() => {
    const q = pq.toLowerCase().trim();
    return (q ? data.partners.filter((p) => `${p.name} ${p.edb ?? ''}`.toLowerCase().includes(q)) : data.partners).slice(0, 8);
  }, [pq, data.partners]);
  const pick = (id: string) => { const p = data.partners.find((x) => x.id === id); set({ partnerId: id }); setPq(p?.name ?? ''); setPOpen(false); };
  const C = data.calcs.filter((c) => c.advance === (h.vid === 'av'));
  const linked = new Set(h.links);
  const toggle = (id: string, on: boolean) => set({ links: on ? [...new Set([...h.links, id])] : h.links.filter((x) => x !== id) });
  const sum = data.calcs.filter((c) => linked.has(c.id)).reduce((a, c) => a + c.total, 0);

  const submit = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(h.date)) { setErr('Внесете датум.'); setTab('osn'); return; }
    const href = headerHref(h);
    if (onDone) onDone(href); else router.push(href);
  };
  const cycleTip = () => {
    const i = KALK_TIPS.findIndex(([k]) => k === h.tip);
    const next = KALK_TIPS[(i + 1) % KALK_TIPS.length]![0];
    set({ tip: next }); setTab('osn');
    setTimeout(() => R.tip.current?.querySelector<HTMLInputElement>(`input[value="${next}"]`)?.focus(), 0);
  };
  const onKey = (e: React.KeyboardEvent) => {
    const t = e.target as HTMLElement;
    const go = (f: () => void) => { e.preventDefault(); f(); };
    if (e.key === 'Escape') go(() => (pOpen ? setPOpen(false) : onClose()));
    else if (e.key === 'F9') go(() => submit());
    else if (e.key === 'F5') go(() => { setTab('osn'); setTimeout(() => R.doc.current?.focus(), 0); });
    else if (e.key === 'F6') go(() => { setTab('osn'); setTimeout(() => R.disp.current?.focus(), 0); });
    else if (e.key === 'F7') go(cycleTip);
    else if (e.key === 'F8') go(() => { setTab('osn'); setPOpen(true); setTimeout(() => R.kom.current?.focus(), 0); });
    else if (tab === 'pos' && t.tagName !== 'INPUT' && (e.key === '*' || e.key === '+' || e.key === '-')) go(() => {
      if (e.key === '*') set({ links: [...new Set([...h.links, ...C.map((c) => c.id)])] });
      else if (C[cur]) { toggle(C[cur]!.id, e.key === '+'); setCur((x) => Math.min(x + 1, C.length - 1)); }
    });
    else if (tab === 'pos' && (e.key === 'ArrowDown' || e.key === 'ArrowUp') && t.tagName !== 'INPUT') go(() => setCur((x) => Math.max(0, Math.min(C.length - 1, x + (e.key === 'ArrowDown' ? 1 : -1)))));
    else if (e.key === 'Enter' && t === R.kom.current) go(() => { if (pOpen && P[0]) pick(P[0].id); });
    else if (e.key === 'Enter' && (t.tagName === 'INPUT' || t.tagName === 'SELECT') && (t as HTMLInputElement).type !== 'radio' && (t as HTMLInputElement).type !== 'checkbox') go(() => {
      // Enter moves to the next field (like the old program); on the last one it confirms
      const F = [...(formRef.current?.querySelectorAll<HTMLElement>('input:not([type=hidden]):not([type=radio]):not([type=checkbox]), select, textarea') ?? [])];
      const i = F.indexOf(t);
      if (i >= 0 && i < F.length - 1) F[i + 1]!.focus(); else submit();
    });
  };

  const fld = (id: string, label: string, el: React.ReactNode, span = 1) => <><label htmlFor={id} className="mini">{label}</label><div style={{ gridColumn: `span ${span}` }}>{el}</div></>;
  const radio = (name: string, v: string, label: string, on: boolean, f: () => void) => (
    <label key={v} style={{ display: 'inline-flex', gap: 4, alignItems: 'center', margin: 0, whiteSpace: 'nowrap' }}><input type="radio" name={name} value={v} checked={on} onChange={f} style={{ width: 'auto', margin: 0 }} /> {label}</label>
  );
  return (
    <div role="dialog" aria-modal="true" aria-label="Податоци за малопродажна калкулација" onKeyDown={onKey}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.25)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 8 }}>
      <form ref={formRef} onSubmit={submit} className="card" style={{ width: 'min(900px, 98vw)', maxHeight: '96vh', overflow: 'auto', padding: 16, margin: 0 }}>
        <h2 style={{ marginTop: 0 }}>Податоци за малопродажна калкулација</h2>
        <div className="row" role="tablist" style={{ gap: 6, marginBottom: 10 }}>
          <button type="button" role="tab" aria-selected={tab === 'osn'} className={`btn sm ${tab === 'osn' ? 'pri' : ''}`} onClick={() => setTab('osn')}>Основно</button>
          <button type="button" role="tab" aria-selected={tab === 'pos'} className={`btn sm ${tab === 'pos' ? 'pri' : ''}`} onClick={() => setTab('pos')}>Посебни{h.links.length ? ` (${h.links.length})` : ''}</button>
        </div>
        {err && <div className="callout bad" role="alert">{err}</div>}
        {tab === 'osn' ? (
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(260px, 1.4fr) minmax(220px, 1fr)', gap: 14 }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr auto 1fr', gap: '6px 8px', alignItems: 'center', alignContent: 'start' }}>
              {fld('kh_no', 'Калкулација број', <input id="kh_no" ref={R.no} value={h.calcNo} style={Y} placeholder="автоматски" onChange={(e) => { setNoEdited(!!e.target.value); set({ calcNo: e.target.value }); }} />)}
              {fld('kh_oe', 'ОЕ', <input id="kh_oe" value={h.oe} onChange={(e) => set({ oe: e.target.value })} />)}
              {fld('kh_nal', 'Налог', <NalogPicker id="kh_nal" value={h.nalog} date={h.date} onChange={(v) => set({ nalog: v })} />)}
              {fld('kh_terk', 'Терк', <input id="kh_terk" value={h.terk} onChange={(e) => set({ terk: e.target.value })} />)}
              {fld('kh_wh', 'Во магацин …', <select id="kh_wh" value={h.wh} onChange={(e) => set({ wh: e.target.value })}>
                <option value="">—</option><option value="main">01 Главен магацин</option>{wh.map((l) => <option key={l.id} value={l.id}>{l.code} {l.name}</option>)}</select>, 3)}
              {fld('kh_st', 'Во продавница …', <select id="kh_st" value={h.store} onChange={(e) => set({ store: e.target.value })}>
                <option value="">—</option>{st.map((l) => <option key={l.id} value={l.id}>{l.code} {l.name}</option>)}</select>, 3)}
              {fld('kh_td', 'Терк за дестинациона продавница', <input id="kh_td" value={h.terkDest} onChange={(e) => set({ terkDest: e.target.value })} />, 3)}
              {fld('kh_date', 'Датум', <input id="kh_date" type="date" required value={h.date} style={Y} onChange={(e) => set({ date: e.target.value })} />)}
              {fld('kh_dd', 'Датум на фактура', <input id="kh_dd" type="date" value={h.docDate} onChange={(e) => set({ docDate: e.target.value })} />)}
              {fld('kh_due', 'Валута', <input id="kh_due" type="date" value={h.due} onChange={(e) => set({ due: e.target.value })} />, 3)}
              {fld('kh_kom', 'Комитент (F8)', <div style={{ position: 'relative' }}>
                <input id="kh_kom" ref={R.kom} value={pq} style={Y} autoComplete="off" placeholder="име или ЕДБ…" role="combobox" aria-expanded={pOpen} aria-controls="kh_kom_list"
                  onFocus={() => setPOpen(true)} onBlur={() => setTimeout(() => setPOpen(false), 150)} onChange={(e) => { setPq(e.target.value); set({ partnerId: '' }); setPOpen(true); }} />
                {pOpen && P.length > 0 && <ul id="kh_kom_list" role="listbox" className="card" style={{ position: 'absolute', zIndex: 5, left: 0, right: 0, margin: 0, padding: 4, listStyle: 'none', maxHeight: 220, overflow: 'auto' }}>
                  {P.map((p) => <li key={p.id} role="option" aria-selected={p.id === h.partnerId} onMouseDown={(e) => { e.preventDefault(); pick(p.id); }} style={{ padding: '3px 6px', cursor: 'pointer' }}>{p.name} <span className="mini muted">{p.edb ?? ''}</span></li>)}
                </ul>}
              </div>, 3)}
              {fld('kh_doc', 'По документ (F5)', <input id="kh_doc" ref={R.doc} value={h.doc} onChange={(e) => set({ doc: e.target.value })} />)}
              {fld('kh_disp', 'Број на испратница (F6)', <input id="kh_disp" ref={R.disp} value={h.dispNo} onChange={(e) => set({ dispNo: e.target.value })} />)}
              {fld('kh_arch', 'Архивски број', <input id="kh_arch" value={h.archNo} onChange={(e) => set({ archNo: e.target.value })} />)}
              {fld('kh_rab', 'Генерален рабат %', <input id="kh_rab" inputMode="decimal" value={h.rabat} onChange={(e) => set({ rabat: e.target.value })} />)}
              {fld('kh_ref', 'Повикување на', <input id="kh_ref" value={h.ref} onChange={(e) => set({ ref: e.target.value })} />, 3)}
              {fld('kh_note', 'Забелешка', <textarea id="kh_note" rows={3} value={h.note} onChange={(e) => set({ note: e.target.value })} style={{ width: '100%' }} />, 3)}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <fieldset ref={R.tip} style={{ border: '1px solid var(--line)', borderRadius: 6, padding: '4px 10px', margin: 0 }}>
                <legend className="mini">Тип (F7)</legend>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>{KALK_TIPS.map(([k, l]) => radio('kh_tip', k, l, h.tip === k, () => set({ tip: k as KalkTip })))}</div>
              </fieldset>
              <div className="row" style={{ gap: 8, alignItems: 'stretch' }}>
                <fieldset style={{ border: '1px solid var(--line)', borderRadius: 6, padding: '4px 10px', margin: 0 }}>
                  <legend className="mini">Салдо</legend>
                  <div style={{ display: 'flex', gap: 10 }}>{radio('kh_saldo', 'da', 'Да', h.saldo, () => set({ saldo: true }))}{radio('kh_saldo', 'ne', 'Не', !h.saldo, () => set({ saldo: false }))}</div>
                </fieldset>
                <fieldset style={{ border: '1px solid var(--line)', borderRadius: 6, padding: '4px 10px', margin: 0 }}>
                  <legend className="mini">Трошок/Наплата</legend>
                  <div style={{ display: 'flex', gap: 10 }}>{radio('kh_tn', 'nap', 'Наплата', h.tn === 'nap', () => set({ tn: 'nap' }))}{radio('kh_tn', 'tr', 'Трошок', h.tn === 'tr', () => set({ tn: 'tr' }))}</div>
                </fieldset>
              </div>
              <label className="mini" htmlFor="kh_pril">Прилог</label>
              <input id="kh_pril" value={h.prilog} onChange={(e) => set({ prilog: e.target.value })} placeholder="опис на прилогот" />
            </div>
          </div>
        ) : (
          <div>
            <div className="row" style={{ gap: 8, alignItems: 'center', marginBottom: 8, flexWrap: 'wrap' }}>
              <button type="button" className="btn sm" title="Селектирај ги сите" onClick={() => set({ links: [...new Set([...h.links, ...C.map((c) => c.id)])] })}>*</button>
              <button type="button" className="btn sm" title="Додај ја избраната" onClick={() => C[cur] && toggle(C[cur]!.id, true)}>+</button>
              <button type="button" className="btn sm" title="Отстрани ја избраната" onClick={() => C[cur] && toggle(C[cur]!.id, false)}>-</button>
              <fieldset style={{ border: '1px solid var(--line)', borderRadius: 6, padding: '2px 10px', margin: 0 }}>
                <legend className="mini">Изберете тип</legend>
                <div style={{ display: 'flex', gap: 10 }}>{radio('kh_vid', 'red', 'Редовна', h.vid === 'red', () => { set({ vid: 'red' }); setCur(0); })}{radio('kh_vid', 'av', 'Авансна', h.vid === 'av', () => { set({ vid: 'av' }); setCur(0); })}</div>
              </fieldset>
            </div>
            <div className="tw" style={{ maxHeight: 340, overflow: 'auto' }}><table>
              <thead><tr><th style={{ width: 60 }}>Селект</th><th>Број на калкулација</th><th>Документ</th><th className="n">ИЗНОС</th></tr></thead>
              <tbody>{C.length ? C.map((c, i) => (
                <tr key={c.id} onClick={() => setCur(i)} aria-selected={i === cur} style={i === cur ? { outline: '2px solid var(--accent)', outlineOffset: -2 } : undefined}>
                  <td><input type="checkbox" aria-label={'Селект ' + c.calcNo} checked={linked.has(c.id)} onChange={(e) => toggle(c.id, e.target.checked)} style={{ width: 'auto' }} /></td>
                  <td>{c.calcNo}</td><td>{c.doc}{c.partner ? <span className="mini muted"> · {c.partner}</span> : null}</td><td className="n">{nf.format(c.total)}</td>
                </tr>)) : <tr><td colSpan={4} className="muted">{h.vid === 'av' ? 'Нема авансни калкулации.' : 'Нема претходни калкулации.'}</td></tr>}</tbody>
              {h.links.length > 0 && <tfoot><tr><td colSpan={3}>Селектирани {h.links.length}</td><td className="n">{nf.format(sum)}</td></tr></tfoot>}
            </table></div>
            <p className="mini muted">* = сите · + = додај · − = отстрани · ↑ ↓ избор. Поврзаните калкулации се чуваат на документот.</p>
          </div>
        )}
        <div className="row" style={{ gap: 10, marginTop: 14, justifyContent: 'space-between' }}>
          <button type="button" className="btn" onClick={onClose} style={{ flex: 1 }}>Излез (Esc)</button>
          <button type="submit" className="btn pri" style={{ flex: 1 }}>Во ред (F9)</button>
        </div>
        <p className="mini muted" style={{ marginBottom: 0 }}>F5 По документ · F6 Испратница · F7 Тип · F8 Комитент · Enter = следно поле · ставките се внесуваат потоа во документот.</p>
      </form>
    </div>
  );
}
