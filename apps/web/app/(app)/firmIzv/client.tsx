'use client';
/**
 * „🗂 Целосен извештај за фирма“ — the browser side: the searchable picker over ALL firms (a GET form, the selected
 * firm cookie is not touched), the report body whose „→ …“ links first switch to the reported firm / year and then
 * open the screen that fixes the finding, and the „💲 AI анализа“ button.
 */
import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { noteRendered } from '@/components/firm-guard';
import { selectFirm, setYear } from '../actions';
import { firmReportAiAction } from './actions';

interface PickFirm { id: string; name: string; edb: string | null; city: string | null; active: boolean }

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();

export function FiPicker({ firms, f, y, to, years }: { firms: PickFirm[]; f: string | null; y: number; to: string | null; years: number[] }) {
  const [q, setQ] = useState('');
  const L = useMemo(() => {
    const t = norm(q);
    return t ? firms.filter((x) => norm(`${x.name} ${x.edb ?? ''} ${x.city ?? ''}`).includes(t)) : firms;
  }, [q, firms]);
  return (
    <form method="get" action="/firmIzv" className="card noprint" style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
      <label style={{ flex: '1 1 320px' }}>Фирма ({firms.length})
        <input type="search" placeholder="🔍 Пребарај по назив, ЕДБ или град…" value={q} onChange={(e) => setQ(e.target.value)} autoComplete="off" />
        <select name="f" size={Math.min(8, Math.max(3, L.length))} defaultValue={f ?? undefined} required style={{ width: '100%' }}
          onDoubleClick={(e) => (e.currentTarget.form as HTMLFormElement | null)?.requestSubmit()}>
          {L.slice(0, 400).map((x) => <option key={x.id} value={x.id}>{x.name}{x.edb ? ` · ${x.edb}` : ''}{x.city ? ` · ${x.city}` : ''}{x.active ? '' : ' (неактивна)'}</option>)}
        </select>
      </label>
      <label>Година
        <select name="y" defaultValue={String(y)}>{years.map((v) => <option key={v} value={v}>{v}</option>)}</select>
      </label>
      <label>До датум
        <input type="date" name="do" defaultValue={to ?? ''} />
      </label>
      <button className="btn pri" type="submit">📊 Прикажи извештај</button>
    </form>
  );
}

/** The report HTML; `data-go` links switch to the reported firm (and year) before opening the screen. */
export function FiBody({ html, firmId, year, current, currentYear }: { html: string; firmId: string; year: number; current: string | null; currentYear: number }) {
  const router = useRouter();
  const [busy, start] = useTransition();
  return (
    <div id="frBody" style={{ opacity: busy ? 0.6 : 1 }} dangerouslySetInnerHTML={{ __html: html }}
      onClick={(e) => {
        const a = (e.target as HTMLElement).closest('a[data-go]') as HTMLAnchorElement | null;
        if (!a) return;
        e.preventDefault();
        const href = a.getAttribute('href') ?? '/';
        start(async () => {
          if (firmId !== current) await selectFirm(firmId);
          if (year !== currentYear) await setYear(year);
          noteRendered({ firm: firmId, year });
          router.push(href);
        });
      }} />
  );
}

export function FiAiButton({ firmId, year, to, queued }: { firmId: string; year: number; to: string | null; queued: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok?: string; error?: string } | null>(null);
  return (
    <>
      <button type="button" className="btn" disabled={pending || queued} title="Анализа од AI само од бројките и наодите (без имиња, ЕДБ и лични податоци) – се наплаќа според AI лимитот"
        onClick={() => start(async () => { const r = await firmReportAiAction(firmId, year, to); setMsg(r); router.refresh(); })}>
        {pending || queued ? 'AI пишува…' : '💲 AI анализа'}
      </button>
      {msg?.error && <span className="pill bad" role="alert">{msg.error}</span>}
      {msg?.ok && !msg.error && <span className="pill good">{msg.ok}</span>}
    </>
  );
}
