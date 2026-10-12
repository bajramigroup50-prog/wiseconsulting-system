'use client';
/**
 * „+ Нов уред“: the owner picks the firm from the database (search like the firm window) or „Канцеларија (нашата)“;
 * the device name is generated („<Фирма> – уред N“), an optional suffix („каса 1“) is added only if he wants.
 */
import { useMemo, useState } from 'react';
import { ActionForm, Submit } from '@/components/action-form';
import { createDevice } from './actions';

export interface FirmChoice { id: string; name: string; city: string | null; edb: string | null; devices: number; maxNo: number }

const norm = (s: string) => s.toLowerCase().normalize('NFKD').replace(/\p{M}/gu, '');

export function NewDevice({ firms, office, officeCount, officeMax }: { firms: FirmChoice[]; office: string; officeCount: number; officeMax: number }) {
  const [q, setQ] = useState('');
  const [sel, setSel] = useState<string>('');
  const [suffix, setSuffix] = useState('');
  const L = useMemo(() => {
    const n = norm(q.trim());
    return (n ? firms.filter((f) => norm(`${f.name} ${f.city ?? ''} ${f.edb ?? ''}`).includes(n)) : firms).slice(0, 80);
  }, [firms, q]);
  const picked = sel === 'office' ? { name: 'Канцеларија', maxNo: officeMax } : firms.find((f) => f.id === sel);
  const preview = picked ? `${picked.name} – уред ${picked.maxNo + 1}${suffix.trim() ? ` – ${suffix.trim()}` : ''}` : '';
  return (
    <ActionForm action={createDevice}>
      <h3 style={{ marginTop: 0 }}>+ Нов уред</h3>
      <input type="hidden" name="firm" value={sel} />
      <div className="row" style={{ gap: 10, flexWrap: 'wrap', alignItems: 'start' }}>
        <div style={{ flex: '1 1 340px', minWidth: 280 }}>
          <label className="f" style={{ margin: 0 }}>Фирма
            <input type="search" placeholder="🔍 Пребарај фирма (име, град, ЕДБ)…" value={q} onChange={(e) => setQ(e.target.value)} autoComplete="off" />
          </label>
          <div style={{ maxHeight: 260, overflow: 'auto', border: '1px solid var(--line, #ddd)', borderRadius: 6, marginTop: 4 }} role="listbox" aria-label="Фирми">
            <button type="button" role="option" aria-selected={sel === 'office'} className={`btn sm${sel === 'office' ? ' pri' : ' ghost'}`}
              style={{ display: 'block', width: '100%', textAlign: 'left' }} onClick={() => setSel('office')}>
              🏢 {office} {officeCount ? <span className="mk">({officeCount} уреди)</span> : null}
            </button>
            {L.map((f) => (
              <button key={f.id} type="button" role="option" aria-selected={sel === f.id} className={`btn sm${sel === f.id ? ' pri' : ' ghost'}`}
                style={{ display: 'block', width: '100%', textAlign: 'left' }} onClick={() => setSel(f.id)}>
                {f.name}{f.city ? <span className="mk"> · {f.city}</span> : null}{f.devices ? <span className="mk"> ({f.devices} уреди)</span> : null}
              </button>
            ))}
            {!L.length && <div className="note" style={{ padding: 8 }}>Нема фирма за „{q}“.</div>}
          </div>
        </div>
        <div style={{ flex: '1 1 260px' }}>
          <label className="f" style={{ margin: 0 }}>Дополнително име (по желба)
            <input name="suffix" maxLength={30} placeholder="на пр. каса 1" value={suffix} onChange={(e) => setSuffix(e.target.value)} />
          </label>
          <p className="note">Име на уредот: <b>{preview || '— изберете фирма —'}</b></p>
          {sel ? <Submit>🔐 Креирај уред</Submit> : <button className="btn pri" disabled>🔐 Креирај уред</button>}
          <p className="note">По креирањето се појавува копчето „⬇ Преземи инсталација за овој уред“ — една датотека за тој компјутер.</p>
        </div>
      </div>
    </ActionForm>
  );
}
