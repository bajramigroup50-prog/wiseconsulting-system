'use client';
/**
 * Daily list: one row per family / person, three boxes (појадок / ручек / вечера). Each click saves at once; a box goes
 * back when the server refuses. Search by name, place or number.
 */
import { useMemo, useState, useTransition } from 'react';
import { bulkMealAction, toggleMealAction } from './actions';
import { tr, type Lang } from '@/lib/npo-i18n';

type Row = { id: string; no: number | null; name: string; members: number; place: string | null };
const ALL = [['b', 'Појадок'], ['l', 'Ручек'], ['d', 'Вечера']] as const;

export function DayList({ rows, date, taken, write, kinds = ['b', 'l', 'd'], lang = 'mk' }: { rows: Row[]; date: string; taken: string[]; write: boolean; kinds?: string[]; lang?: Lang }) {
  const t = tr(lang);
  // only the meal kinds the firm serves
  const MEALS = ALL.filter(([k]) => kinds.includes(k));
  const [on, setOn] = useState(() => new Set(taken));
  const [q, setQ] = useState('');
  const [err, setErr] = useState('');
  const [busy, start] = useTransition();
  const L = useMemo(() => {
    const s = q.trim().toLowerCase();
    return s ? rows.filter((r) => `${r.no ?? ''} ${r.name} ${r.place ?? ''}`.toLowerCase().includes(s)) : rows;
  }, [rows, q]);
  const key = (id: string, m: string) => `${id}:${m}`;
  const count = (m: string) => rows.filter((r) => on.has(key(r.id, m))).length;
  const portions = (m: string) => rows.filter((r) => on.has(key(r.id, m))).reduce((s, r) => s + r.members, 0);

  function flip(id: string, m: string) {
    const k = key(id, m);
    const next = !on.has(k);
    setOn((S) => { const N = new Set(S); if (next) N.add(k); else N.delete(k); return N; });
    start(async () => {
      const r = await toggleMealAction(id, date, m, next);
      if (r.error) {
        setErr(r.error);
        setOn((S) => { const N = new Set(S); if (next) N.delete(k); else N.add(k); return N; });
      } else setErr('');
    });
  }
  function all(m: string) {
    const ids = L.map((r) => r.id);
    if (!ids.length || !window.confirm(`${t(MEALS.find((x) => x[0] === m)![1])} – ${t('да се означи за сите прикажани?')} (${ids.length})`)) return;
    start(async () => {
      const r = await bulkMealAction(ids, date, m);
      if (r.error) setErr(r.error);
      else { setErr(''); setOn((S) => { const N = new Set(S); for (const id of ids) N.add(key(id, m)); return N; }); }
    });
  }

  return (
    <>
      <div className="row" style={{ gap: 12, alignItems: 'center', flexWrap: 'wrap', margin: '8px 0' }}>
        <input type="search" placeholder={t('Барај по име, место или број…')} value={q} onChange={(e) => setQ(e.target.value)} style={{ minWidth: 260 }} />
        {MEALS.map(([m, n]) => <span key={m} className="pill">{t(n)}: <b>{count(m)}</b> ({portions(m)} {t('порции)')}</span>)}
        {busy && <span className="mk">{t('се зачувува…')}</span>}
      </div>
      {err && <div className="callout bad" role="alert">{err}</div>}
      <table className="tbl">
        <thead>
          <tr>
            <th style={{ width: 50 }}>{t('Бр.')}</th><th>{t('Корисник (семејство)')}</th><th style={{ width: 70 }}>{t('Членови')}</th><th>{t('Место')}</th>
            {MEALS.map(([m, n]) => (
              <th key={m} style={{ width: 110, textAlign: 'center' }}>
                {t(n)}
                {write && <><br /><button type="button" className="btn sm" onClick={() => all(m)} disabled={busy}>{t('✓ сите')}</button></>}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {L.map((r) => (
            <tr key={r.id} className={MEALS.some(([m]) => on.has(key(r.id, m))) ? 'sel' : undefined}>
              <td>{r.no ?? ''}</td><td>{r.name}</td><td style={{ textAlign: 'center' }}>{r.members}</td><td>{r.place ?? ''}</td>
              {MEALS.map(([m, n]) => (
                <td key={m} style={{ textAlign: 'center' }}>
                  <input type="checkbox" aria-label={`${t(n)} – ${r.name}`} checked={on.has(key(r.id, m))} disabled={!write}
                    onChange={() => flip(r.id, m)} style={{ width: 22, height: 22 }} />
                </td>
              ))}
            </tr>
          ))}
          {!L.length && <tr><td colSpan={4 + MEALS.length} className="mk">{t('Нема корисници')}{q ? t(' за пребарувањето') : t(' – додајте ги во „Корисници“ или увезете го Excel регистарот')}.</td></tr>}
        </tbody>
      </table>
    </>
  );
}
