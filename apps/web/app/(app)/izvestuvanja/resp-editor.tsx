'use client';
/** „👥 Распределба на фирми по колеги“: pick a colleague, tick the firms they follow (search box), save. */
import { useActionState, useMemo, useState } from 'react';
import type { ActionState } from '@/lib/books';

export function RespEditor({ action, colleagues, firms, resp }: {
  action: (p: ActionState, f: FormData) => Promise<ActionState>;
  colleagues: { id: string; name: string }[];
  firms: { id: string; name: string }[];
  resp: Record<string, string[]>;
}) {
  const [st, run, pending] = useActionState(action, {});
  const [who, setWho] = useState(colleagues[0]?.id ?? '');
  const [q, setQ] = useState('');
  const owner = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of colleagues) for (const f of resp[c.id] ?? []) m.set(f, c.name);
    return m;
  }, [colleagues, resp]);
  const mine = new Set(resp[who] ?? []);
  const qq = q.trim().toLowerCase();
  return (
    <form action={run} key={who}>
      <div className="row" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 8 }}>
        <label className="f" style={{ margin: 0 }}>Колега
          <select name="userId" value={who} onChange={(e) => setWho(e.target.value)} style={{ width: 'auto' }}>
            {colleagues.map((c) => <option key={c.id} value={c.id}>{c.name} ({(resp[c.id] ?? []).length})</option>)}
          </select>
        </label>
        <input placeholder="Пребарај фирма…" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: 260 }} />
        <button className="btn pri" disabled={pending}>{pending ? 'Се зачувува…' : 'Зачувај'}</button>
        {st.error && <span className="pill bad" role="alert">{st.error}</span>}
        {st.ok && <span className="pill good" role="status">{st.ok}</span>}
      </div>
      <div style={{ columns: '3 260px', maxHeight: 360, overflow: 'auto', fontSize: 13 }}>
        {firms.map((f) => {
          const other = owner.get(f.id);
          const hide = qq && !f.name.toLowerCase().includes(qq);
          return (
            <label key={f.id} className="chk" style={{ display: hide ? 'none' : 'flex', margin: '1px 0', breakInside: 'avoid' }}>
              <input type="checkbox" name="f" value={f.id} defaultChecked={mine.has(f.id)} style={{ width: 'auto' }} />
              {f.name}{other && !mine.has(f.id) && <span className="mini" style={{ marginLeft: 4 }}>({other})</span>}
            </label>
          );
        })}
      </div>
      <p className="mini">Фирмата е кај еден колега: ако ја штиклирате, се префрла од претходниот. Распределбата не го ограничува пристапот – само кој ги следи известувањата.</p>
    </form>
  );
}
