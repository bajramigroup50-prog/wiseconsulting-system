'use client';
/**
 * „✋ Спои рачно“ in Дупликати: any partners the office knows are one (ОПШТИНА ДЕБАР ↔ ДЕБАР – ОРГАН НА ОПШТИНА), also
 * when the automatic groups do not pair them: search, tick, choose the main one, merge (the same server action and
 * checks as the groups – a different ЕДБ / ЕМБС is still refused).
 */
import { useActionState, useMemo, useState } from 'react';
import { latToCyr } from '@wise/core/text/cyr';
import type { ActionState } from '@/lib/books';

export interface MmPartner { id: string; code: string | null; name: string; edb: string | null; city: string | null }

const norm = (s: string) => latToCyr(s).toUpperCase().replace(/\s+/g, ' ').trim();

export function ManualMerge({ partners, action }: { partners: MmPartner[]; action: (p: ActionState, f: FormData) => Promise<ActionState> }) {
  const [q, setQ] = useState('');
  const [sel, setSel] = useState<string[]>([]);
  const [main, setMain] = useState('');
  const [st, run, pending] = useActionState(action, {});
  const byId = useMemo(() => new Map(partners.map((p) => [p.id, p])), [partners]);
  const hits = useMemo(() => {
    const k = norm(q);
    if (k.length < 2) return [];
    return partners.filter((p) => !sel.includes(p.id) && (norm(p.name).includes(k) || (p.edb ?? '').includes(k) || (p.code ?? '') === q.trim())).slice(0, 25);
  }, [q, partners, sel]);
  const add = (id: string) => { setSel((s) => [...s, id]); if (!main) setMain(id); };
  const drop = (id: string) => { setSel((s) => s.filter((x) => x !== id)); if (main === id) setMain(sel.find((x) => x !== id) ?? ''); };
  const label = (p: MmPartner) => `${p.code ?? ''} ${p.name}`.trim();
  return (
    <form className="card" action={(f) => { run(f); setSel([]); setMain(''); setQ(''); }} aria-busy={pending}>
      <h3 style={{ marginTop: 0 }}>✋ Спои рачно</h3>
      <p className="note" style={{ marginTop: 0 }}>Пребарајте ги комитентите што се ист субјект (на пр. „дебар“), додадете ги, изберете го главниот и спојте ги. Комитенти со различен ЕДБ / ЕМБС не се спојуваат.</p>
      {st.error && <div className="callout bad" role="alert">{st.error}</div>}
      {st.ok && <div className="callout good" role="status">{st.ok}</div>}
      <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="🔍 Барај комитент по име, ЕДБ или шифра…" style={{ width: '100%', maxWidth: 520 }} />
      {hits.length > 0 && (
        <div className="tw" style={{ maxHeight: 220, marginTop: 6 }}><table className="dense"><tbody>
          {hits.map((p) => <tr key={p.id}><td>{label(p)}</td><td>{p.edb}</td><td>{p.city}</td><td><button type="button" className="btn sm" onClick={() => add(p.id)}>+ додај</button></td></tr>)}
        </tbody></table></div>
      )}
      {sel.length > 0 && (
        <>
          <input type="hidden" name="group" value={sel.join(',')} />
          <div className="tw" style={{ marginTop: 8 }}><table className="dense">
            <thead><tr><th>Главен</th><th>Комитент</th><th>ЕДБ</th><th>Град</th><th /></tr></thead>
            <tbody>{sel.map((id) => { const p = byId.get(id)!; return (
              <tr key={id}><td><input type="radio" name="main" value={id} checked={main === id} onChange={() => setMain(id)} /></td>
                <td><b>{label(p)}</b><input type="hidden" name="ids" value={id} /></td><td>{p.edb}</td><td>{p.city}</td>
                <td><button type="button" className="btn sm ghost" onClick={() => drop(id)}>✕</button></td></tr>
            ); })}</tbody>
          </table></div>
          <button className="btn pri" style={{ marginTop: 6 }} disabled={sel.length < 2 || !main || pending}
            onClick={(e) => { if (!confirm(`Да се спојат ${sel.length} комитенти во „${label(byId.get(main)!)}“? Сите фактури, налози и изводи се префрлаат на главниот.`)) e.preventDefault(); }}>
            ⇢ Спои {sel.length} во главниот
          </button>
        </>
      )}
    </form>
  );
}
