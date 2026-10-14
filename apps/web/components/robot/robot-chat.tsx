'use client';
/**
 * 🤖 WISE Робот — the chat (side panel and the full /robot page). Polls the conversation while an answer is being
 * prepared; drafts are cards with „✓ Потврди“ / „✕ Откажи“ (only the human's click executes them).
 */
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState, useTransition } from 'react';
import { ROBOT_ONLY_PROPOSES } from '@wise/core/robot/prompt';
import { ROBOT_STARTERS } from '@wise/core/robot/router';
import { robotAsk, robotCancel, robotClear, robotConfirm, robotPoll, type RobotMsgView, type RobotProposalView, type RobotThreadView } from '@/app/(app)/robot/actions';

const ROBOT_STARTERS_UI = ROBOT_STARTERS;
const ROBOT_NOTE = ROBOT_ONLY_PROPOSES;

const fmt = (n: unknown) => (Number(n) || 0).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dmy = (d: unknown) => String(d ?? '').slice(0, 10).split('-').reverse().join('.');
const pending = (m: RobotMsgView) => m.role === 'assistant' && (m.status === 'queued' || m.status === 'running');

function ProposalCard({ p, onDone }: { p: RobotProposalView; onDone: () => void }) {
  const [busy, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const router = useRouter();
  const P = p.payload;
  const act = (fn: () => Promise<{ error?: string; ok?: string; go?: string }>) => start(async () => {
    const r = await fn();
    if (r.error) setMsg('⚠ ' + r.error);
    else if (r.ok) setMsg('✓ ' + r.ok);
    if (r.go) router.push(r.go);
    onDone();
  });
  const lines = (Array.isArray(P.lines) ? P.lines : []) as { konto: string; debit: number; credit: number; partnerName?: string | null; note?: string | null }[];
  const D = lines.reduce((s, l) => s + (+l.debit || 0), 0), C = lines.reduce((s, l) => s + (+l.credit || 0), 0);
  const parts = (Array.isArray(P.partners) ? P.partners : []) as { name: string; saldo: number; invoices: { number: string; due: string }[] }[];
  const open = p.status === 'open';
  return (
    <div className="card" style={{ margin: '6px 0', padding: 10, borderColor: open ? 'var(--accent)' : undefined, background: open ? undefined : 'var(--bg2, #f6f7f9)' }}>
      <div style={{ fontWeight: 700, marginBottom: 4 }}>📝 Предлог: {p.title}</div>
      {p.kind === 'journal' && (
        <div className="tw"><table style={{ fontSize: 12 }}>
          <thead><tr><th>Конто</th><th>Комитент / опис</th><th style={{ textAlign: 'right' }}>Должи</th><th style={{ textAlign: 'right' }}>Побарува</th></tr></thead>
          <tbody>
            {lines.map((l, i) => <tr key={i}><td>{l.konto}</td><td>{l.partnerName ?? ''}{l.note ? ` ${l.note}` : ''}</td><td style={{ textAlign: 'right' }}>{l.debit ? fmt(l.debit) : ''}</td><td style={{ textAlign: 'right' }}>{l.credit ? fmt(l.credit) : ''}</td></tr>)}
            <tr style={{ fontWeight: 700 }}><td colSpan={2}>Вкупно ({dmy(P.date)})</td><td style={{ textAlign: 'right' }}>{fmt(D)}</td><td style={{ textAlign: 'right' }}>{fmt(C)}</td></tr>
          </tbody>
        </table></div>
      )}
      {p.kind === 'dunning' && (
        <ul style={{ margin: '4px 0', paddingLeft: 18, fontSize: 13 }}>
          {parts.map((g, i) => <li key={i}><b>{g.name}</b> – салдо {fmt(g.saldo)} ден., {g.invoices.length} фактури со поминат рок</li>)}
        </ul>
      )}
      {(p.kind === 'task' || p.kind === 'reminder') && (
        <div style={{ fontSize: 13 }}>{String(P.title ?? '')}{P.due ? ` · рок ${dmy(P.due)}` : ''}{p.kind === 'reminder' ? ` · потсетување ${String(P.remindDays ?? 7)} дена пред` : ''}{P.description || P.note ? <div className="mini">{String(P.description ?? P.note ?? '')}</div> : null}</div>
      )}
      {open ? (
        <div className="row" style={{ gap: 6, marginTop: 6 }}>
          <button type="button" className="btn sm pri" disabled={busy} onClick={() => act(() => robotConfirm(p.id))}>
            {p.kind === 'dunning' ? '✓ Потврди (отвори Опомени)' : '✓ Потврди'}
          </button>
          <button type="button" className="btn sm" disabled={busy} onClick={() => act(() => robotCancel(p.id))}>✕ Откажи</button>
        </div>
      ) : (
        <div className="mini" style={{ marginTop: 4 }}>{p.status === 'confirmed' ? '✓ Потврдено' : p.status === 'cancelled' ? '✕ Откажано' : '⚠ Не успеа'}{p.result ? ` – ${p.result}` : ''}</div>
      )}
      {msg && <div className="mini" style={{ marginTop: 4 }}>{msg}</div>}
    </div>
  );
}

function Message({ m, P, owner, onDone }: { m: RobotMsgView; P: RobotProposalView[]; owner: boolean; onDone: () => void }) {
  if (m.role === 'user') return <div style={{ alignSelf: 'flex-end', background: 'var(--accent, #1f6feb)', color: '#fff', borderRadius: 10, padding: '6px 10px', maxWidth: '85%', whiteSpace: 'pre-wrap' }}>{m.text}</div>;
  return (
    <div style={{ alignSelf: 'stretch', background: m.status === 'error' ? '#fff4f4' : '#f4f7fb', border: '1px solid var(--line, #dde3ea)', borderRadius: 10, padding: '8px 10px' }}>
      {pending(m) ? <div className="mini">⏳ {m.deep ? 'Длабока анализа во тек…' : 'Роботот размислува…'}</div> : <div style={{ whiteSpace: 'pre-wrap' }}>{m.text}</div>}
      {m.unverified.length > 0 && (
        <div className="callout warn" style={{ margin: '6px 0 0', fontSize: 12 }}>⚠ Овие износи не ги вратила ниту една алатка – проверете ги пред да ги користите: {m.unverified.join(', ')}</div>
      )}
      {P.map((p) => <ProposalCard key={p.id} p={p} onDone={onDone} />)}
      {m.sources.length > 0 && (
        <div className="mini" style={{ marginTop: 6 }}>
          Извор: {m.sources.map((s, i) => <span key={s.href}>{i ? ' · ' : ''}<Link href={s.href}>{s.label}</Link></span>)}
        </div>
      )}
      {!pending(m) && (
        <div className="mini" style={{ marginTop: 2, opacity: 0.75 }}>
          {m.free ? '⚡ Без AI (бесплатно)' : m.tools.length ? `Алатки: ${[...new Set(m.tools)].join(', ')}` : ''}
          {owner && m.costUsd != null && !m.free ? ` · трошок $${m.costUsd.toFixed(4)}` : ''}
        </div>
      )}
    </div>
  );
}

export function RobotChat({ initial, full = false }: { initial?: RobotThreadView | null; full?: boolean }) {
  const [T, setT] = useState<RobotThreadView | null>(initial ?? null);
  const [q, setQ] = useState('');
  const [deep, setDeep] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busy, start] = useTransition();
  const end = useRef<HTMLDivElement>(null);
  const refresh = useCallback(async () => { const t = await robotPoll(); setT(t); if (t.error) setErr(t.error); }, []);
  useEffect(() => { if (!initial) void refresh(); }, [initial, refresh]);
  const waiting = !!T?.messages.some(pending);
  useEffect(() => {
    if (!waiting) return;
    const t = setInterval(() => { void refresh(); }, 2500);
    return () => clearInterval(t);
  }, [waiting, refresh]);
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }); }, [T?.messages.length, waiting]);
  const ask = (text: string, d = deep) => {
    const t = text.trim();
    if (!t) return;
    setErr(null);
    start(async () => {
      const r = await robotAsk(t, d);
      if (r.error) setErr(r.error); else setQ('');
      await refresh();
    });
  };
  const clear = () => start(async () => { await robotClear(); await refresh(); });
  if (T && !T.firm) return <div className="note" style={{ padding: 12 }}>{T.error ?? 'Изберете фирма за да разговарате со Роботот.'}</div>;
  const M = T?.messages ?? [];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, height: full ? 'calc(100vh - 210px)' : '100%', minHeight: 0 }}>
      <div className="mini" style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
        <span>{T?.firm ? <>Фирма: <b>{T.firm.name}</b> · {T.year}</> : 'Се вчитува…'}</span>
        {M.length > 0 && <button type="button" className="btn sm" onClick={clear} disabled={busy}>🗑 Нов разговор</button>}
      </div>
      <div style={{ flex: 1, overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 8, padding: '4px 2px', minHeight: 0 }}>
        {!M.length && T && (
          <div>
            <div className="note" style={{ marginBottom: 8 }}>Прашајте за салда, ДДВ, рокови, залихи, закони… или побарајте предлог-налог. Примери:</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {ROBOT_STARTERS_UI.map((s) => <button key={s} type="button" className="btn sm" disabled={busy} onClick={() => ask(s, false)}>{s}</button>)}
            </div>
          </div>
        )}
        {M.map((m) => <Message key={m.id} m={m} owner={!!T?.owner} P={(T?.proposals ?? []).filter((p) => p.messageId === m.id)} onDone={() => { void refresh(); }} />)}
        <div ref={end} />
      </div>
      {err && <div className="callout warn" style={{ margin: 0 }}>{err}</div>}
      <form onSubmit={(e) => { e.preventDefault(); ask(q); }} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <textarea value={q} onChange={(e) => setQ(e.target.value)} rows={full ? 3 : 2} maxLength={2000} placeholder="Прашајте го Роботот…"
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ask(q); } }} style={{ width: '100%', resize: 'vertical' }} disabled={busy || !T?.firm} />
        <div className="row" style={{ gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          <button type="submit" className="btn pri sm" disabled={busy || waiting || !q.trim()}>➤ Прашај</button>
          <label className="mini" title="Подлабок модел (повеќе чини) – само кога е потребно" style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
            <input type="checkbox" checked={deep} onChange={(e) => setDeep(e.target.checked)} /> 🔍 Длабока анализа
          </label>
          {!full && <Link className="mini" href="/robot" style={{ marginLeft: 'auto' }}>⤢ Цел екран</Link>}
        </div>
        <div className="mini" style={{ opacity: 0.85 }}>{ROBOT_NOTE}</div>
      </form>
    </div>
  );
}
