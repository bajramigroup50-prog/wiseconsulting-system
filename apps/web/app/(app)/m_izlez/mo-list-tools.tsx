'use client';
/** m_izlez list controls: type radios „Тип (F7)“, store filter, shortcuts Ins (new document) and F7 (next type). */
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

const KINDS = ['sale', 'inv', 'ret', 'otp', 'pop'];
const href = (t: string, wh: string) => `/m_izlez?t=${t}${wh ? '&wh=' + wh : ''}`;

export function MoKeys({ t, write }: { t: string; write: boolean }) {
  const router = useRouter();
  useEffect(() => {
    const kd = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return;
      if (e.key === 'Insert' && write && t !== 'inv') { e.preventDefault(); router.push(`/m_izlez?t=${t}&nov`); }
      if (e.key === 'F7') { e.preventDefault(); router.push(`/m_izlez?t=${KINDS[(KINDS.indexOf(t) + 1) % KINDS.length]}`); }
    };
    window.addEventListener('keydown', kd);
    return () => window.removeEventListener('keydown', kd);
  }, [router, t, write]);
  return null;
}

export function MoTypeRadios({ t, wh, options }: { t: string; wh: string; options: [string, string][] }) {
  const router = useRouter();
  return (
    <fieldset className="fs" style={{ margin: 0 }}><legend>Тип (F7)</legend>
      {options.map(([k, n]) => <label key={k} className="chk" style={{ display: 'block', margin: '6px 0' }}><input type="radio" name="mo_t" checked={t === k} onChange={() => router.push(href(k, wh))} /> {n}</label>)}
    </fieldset>
  );
}

export function MoStoreFilter({ t, wh, stores }: { t: string; wh: string; stores: [string, string][] }) {
  const router = useRouter();
  return (
    <label className="f" style={{ marginTop: 10 }}>Продавница
      <select value={wh} onChange={(e) => router.push(href(t, e.target.value))}><option value="">Сите продавници</option>{stores.map(([id, n]) => <option key={id} value={id}>{n}</option>)}</select>
    </label>
  );
}
