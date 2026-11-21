'use client';
/**
 * „Налог“ of a document (like the old program): pick one of the firm's nalozi of the year, type its number, or
 * „+ Нов налог“ (empty = the next number is given when the document is saved; the button shows which one).
 * The list loads when the field is first focused, so the dialogs stay light.
 */
import { useId, useRef, useState } from 'react';
import { nalogOptionsAction, type NalogPick } from '@/app/(app)/nalozi/pick-actions';
import { nextNalogNumberAction, openNalogAction } from '@/app/(app)/nalozi/actions';

const dmy = (d: string) => (d ? d.slice(0, 10).split('-').reverse().join('.') : '');

export function NalogPicker({ id, name, value, onChange, date, style, preset }: {
  id?: string; name?: string; value: string; onChange: (v: string) => void;
  /** Document date: the year of the list and of „+ Нов налог“. */
  date: string; style?: React.CSSProperties;
  /** Nalozi already known on the page (shown before the full list loads). */
  preset?: { number: string; description?: string | null }[];
}) {
  const auto = useId();
  const listId = `${id ?? auto}-list`;
  const [list, setList] = useState<NalogPick[] | null>(null);
  const [next, setNext] = useState('');
  const [msg, setMsg] = useState('');
  const loading = useRef(false);
  const year = Number((date || '').slice(0, 4)) || new Date().getFullYear();

  async function load() {
    if (list || loading.current) return;
    loading.current = true;
    const r = await nalogOptionsAction(year);
    loading.current = false;
    if (r.list) setList(r.list); else setMsg(r.error ?? '');
  }
  async function fresh() {
    onChange('');
    const r = await nextNalogNumberAction(date);
    setNext(r.no ?? '');
    setMsg(r.no ? `Нов налог – при зачувување добива бр. ${r.no}` : r.error ?? '');
  }
  const L: { number: string; label: string }[] = list
    ? list.map((n) => ({ number: n.number, label: `${dmy(n.date)} · ${n.description || 'налог'}${n.docs > 1 ? ` · ${n.docs} док.` : ''}` }))
    : (preset ?? []).map((n) => ({ number: n.number, label: n.description ?? '' }));
  const known = !value || L.some((n) => n.number === value);
  /** A number that is not in the list: open that nalog now (empty, „Прекнижен“), then the document posts into it. */
  async function openTyped() {
    const f = new FormData();
    f.set('number', value); f.set('date', date); f.set('description', 'Налог бр. ' + value); f.set('prek', 'da');
    const r = await openNalogAction({}, f);
    if (r.error) { setMsg(r.error); return; }
    setList(null); setMsg(`Налогот бр. ${r.no ?? value} е отворен.`);
    const x = await nalogOptionsAction(year);
    if (x.list) setList(x.list);
  }

  return (
    <span style={{ display: 'inline-flex', flexDirection: 'column', gap: 2, width: '100%' }}>
      <span style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
        <input id={id} name={name} list={listId} value={value} autoComplete="off" style={{ minWidth: 0, flex: 1, ...style }}
          placeholder={next ? `нов (${next})` : 'нов налог (автоматски)'} aria-label="Налог"
          onFocus={() => void load()} onChange={(e) => { setMsg(''); onChange(e.target.value.trim()); }} />
        <button type="button" className="btn sm" title="Нов налог (следен број)" onClick={() => void fresh()}>+ Нов</button>
      </span>
      <datalist id={listId}>{L.map((n) => <option key={n.number} value={n.number}>{n.label}</option>)}</datalist>
      {value && list && !known && <small className="mini" style={{ color: 'var(--warn)' }}>бр. {value} не постои за {year}. <button type="button" className="btn sm" onClick={() => void openTyped()}>Отвори го</button></small>}
      {msg && <small className="mini muted">{msg}</small>}
    </span>
  );
}
