'use client';
/**
 * "⇄ Промени фирма" window — legacy `VIEWS.firmWin` / `fwPick` (12039–12051): current firm, search, ↑↓ Enter, recent firms
 * first, notification badge per firm, „остани на истиот екран“. Scales to 400+ firms via server search.
 */
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, useTransition } from 'react';
import { selectFirm } from '@/app/(app)/actions';

interface Row { id: string; name: string; edb: string | null; city: string | null; vatRegistered: boolean; vatPeriod: string; al?: { n: number; bad: number; txt: string[] } | null }

const HIST = 'lk_firmHist';
const readHist = (): string[] => { try { return JSON.parse(localStorage.getItem(HIST) ?? '[]'); } catch { return []; } };

export function FirmWindow({ currentId, current, canFirms = true, onClose }: {
  currentId: string | null; current?: { name: string; edb: string | null } | null; canFirms?: boolean; onClose: () => void;
}) {
  const router = useRouter();
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<Row[]>([]);
  const [k, setK] = useState(0);
  const [stay, setStay] = useState(true);
  const [, start] = useTransition();
  const inp = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const ctl = new AbortController();
    const t = setTimeout(() => {
      fetch('/api/firms?q=' + encodeURIComponent(q), { signal: ctl.signal })
        .then((r) => r.json() as Promise<Row[]>)
        .then((L) => {
          const last = readHist();
          const rank = (id: string) => (id === currentId ? -1 : last.indexOf(id) + 1 || 99);
          setRows([...L].sort((a, b) => rank(a.id) - rank(b.id) || a.name.localeCompare(b.name, 'mk')));
          setK(0);
        })
        .catch(() => {});
    }, 150);
    return () => { clearTimeout(t); ctl.abort(); };
  }, [q, currentId]);

  useEffect(() => {
    inp.current?.focus();
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, [onClose]);

  const pick = (id: string) => {
    if (id === currentId) return onClose();
    try { localStorage.setItem(HIST, JSON.stringify([id, ...readHist().filter((x) => x !== id)].slice(0, 8))); } catch {}
    start(async () => {
      await selectFirm(id);
      onClose();
      if (!stay) router.push('/');
      const n = document.getElementById('firmName');
      n?.animate?.([{ background: 'var(--accent-soft)' }, { background: 'transparent' }], { duration: 1600 });
    });
  };
  const last = typeof window === 'undefined' ? [] : readHist();

  return (
    <div className="vwin" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="vwin-p sm" role="dialog" aria-label="⇄ Промени фирма">
        <div className="vwin-h"><b>⇄ Промени фирма</b><button className="btn sm" title="Затвори (Esc)" onClick={onClose}>✕ Затвори</button></div>
        <div className="vwin-b">
          {current && <div className="callout" style={{ marginBottom: 10 }}>Моментално работите во: <b>{current.name}</b> · ЕДБ {current.edb || '—'}</div>}
          <div className="row" style={{ gap: 8, marginBottom: 10, alignItems: 'center' }}>
            <input ref={inp} placeholder="🔍 Барај по назив, ЕДБ, ЕМБС или град…" value={q} autoComplete="off"
              style={{ flex: 1, minWidth: 220 }} onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                  e.preventDefault();
                  setK((v) => Math.max(0, Math.min(rows.length - 1, v + (e.key === 'ArrowDown' ? 1 : -1))));
                } else if (e.key === 'Enter' && rows.length) { e.preventDefault(); pick(rows[Math.min(k, rows.length - 1)]!.id); }
              }} />
            <label className="chk" style={{ whiteSpace: 'nowrap' }}><input type="checkbox" checked={stay} onChange={(e) => setStay(e.target.checked)} /> остани на истиот екран</label>
          </div>
          <div style={{ display: 'grid', gap: 6 }}>
            {rows.map((f, i) => (
              <button key={f.id} className={`fw-row ${f.id === currentId ? 'cur' : ''} ${i === k ? 'k' : ''}`} onClick={() => pick(f.id)}>
                <span className="pk-av" aria-hidden="true">{(f.name || '?').trim().charAt(0).toUpperCase()}</span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <b>{f.name}</b><br />
                  <small className="mini">ЕДБ {f.edb || '—'}{f.city ? ' · ' + f.city : ''} · {f.vatRegistered ? 'ДДВ ' + (f.vatPeriod === 'month' ? 'месечно' : 'тромесечно') : 'не е ДДВ обврзник'}</small>
                </span>
                {f.al && (f.al.n ? <span className={`pill ${f.al.bad ? 'bad' : 'warn'}`} title={f.al.txt.join('\n')}>{f.al.bad ? '🔴' : '🟠'} {f.al.n}</span> : <span className="pill good">✓</span>)}
                {f.id === currentId ? <span className="pill good">тековна</span> : last.includes(f.id) ? <span className="pill info">неодамна</span> : null}
              </button>
            ))}
            {!rows.length && <div className="note">{q ? `Нема фирма што одговара на „${q}“.` : 'Нема фирми.'}</div>}
          </div>
          <p className="mini" style={{ marginTop: 10 }}>
            ↑ ↓ за избор · Enter за префрлање · Esc за затворање. {canFirms && <a href="/izlezF">Сите фирми / нова фирма (цел екран)</a>}
          </p>
        </div>
      </div>
    </div>
  );
}
