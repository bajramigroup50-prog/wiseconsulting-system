'use client';
/** „📥 Пристигнати документи“ — the upload zone (`<Uvoz>`) and the one-click routing of each row. */
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { DOS_CAT, INBOX_ROUTES, incomingRoute, type IncomingKind, type InboxRoute } from '@wise/core/office';
import { uploadFile } from '@/lib/upload';
import { STALE_ACTION_MSG } from '@/lib/version';
import { Uvoz, type UvozResult } from '@/components/uvoz';
import { UploadTarget } from '@/components/firm-guard';
import { AiBadge } from '@/components/ai-badge';
import {
  addIncomingAction, assignIncomingAction, classifyIncomingAction, donePortalAction, redetectIncomingAction, routeIncomingAction, routePortalAction, skipIncomingAction,
} from './actions';

type Res = { ok?: string; error?: string; go?: string | null };

export function InUpload({ firmId, office }: { firmId: string | null; office: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [prog, setProg] = useState('');
  const [res, setRes] = useState<UvozResult[]>([]);
  const run = async (L: File[]) => {
    setBusy(true);
    const out: UvozResult[] = [];
    const ids: string[] = [];
    for (const [i, f] of L.entries()) {
      setProg(`Се прикачува ${i + 1}/${L.length}: ${f.name}`);
      const r = await uploadFile(f, firmId).catch((): { ok: false; error: string } => ({ ok: false, error: STALE_ACTION_MSG }));
      if (r.ok) { ids.push(r.id); out.push({ name: f.name, ok: true, msg: r.duplicate ? `веќе постои како „${r.name}“ – се препознава` : 'примено – се препознава' }); }
      else out.push({ name: f.name, ok: false, msg: r.error });
    }
    if (ids.length) {
      const r = await addIncomingAction(ids).catch(() => ({ error: STALE_ACTION_MSG }));
      if (r.error) out.push({ name: '', ok: false, msg: r.error });
    }
    setRes(out);
    setBusy(false);
    router.refresh();
  };
  return (
    <div className="card">
      {firmId ? <UploadTarget /> : office && <div className="callout" style={{ margin: '6px 0' }}>📂 Нема избрана фирма: датотеките одат во <b>канцеларијата</b> (ги гледаат само сопственикот и администраторите) – потоа изберете фирма за секоја.</div>}
      <Uvoz onFiles={run} busy={busy} progress={prog} results={res}
        label={<><b>📥 Повлечете ги документите тука</b> или кликнете – фактури, изводи, МПИН, решенија, договори…</>}
        hint="Видот се препознава сам, бесплатно (формат, XML, извод, текст на PDF). Извод со сметка на фирмата се увезува автоматски во налогот за неговиот период; фотографија / скен – „🤖 Препознај“ со AI на ваш клик." />
    </div>
  );
}

function useRun() {
  const router = useRouter();
  const [msg, setMsg] = useState<Res>({});
  const [pending, start] = useTransition();
  const run = (f: () => Promise<Res>) => start(async () => {
    const r = await f().catch((): Res => ({ error: STALE_ACTION_MSG }));
    setMsg(r);
    if (r.go) router.push(r.go); else router.refresh();
  });
  return { msg, pending, run };
}

const Msg = ({ m }: { m: Res }) => (m.error ? <span className="mini" style={{ color: 'var(--bad)' }}>{m.error}</span> : m.ok ? <span className="mini">{m.ok}</span> : null);

const QUICK: readonly [InboxRoute, string][] = [['purchase', '🧾 Влезна (скен)'], ['sale', '🧾 Излезна (скен)'], ['bank', '🏦 Извод'], ['payroll', '🧮 МПИН'], ['dossier', '🗂 Досие']];

export function InActions({ id, kind, firmId, status, proposed, needsAi, aiBusy, firms, canAi }: {
  id: string; kind: IncomingKind; firmId: string | null; status: string; proposed: { id: string; name: string }[];
  needsAi: boolean; aiBusy: boolean; firms: { id: string; name: string }[]; canAi: boolean;
}) {
  const { msg, pending, run } = useRun();
  const [to, setTo] = useState('');
  const [cat, setCat] = useState('');
  if (status === 'done') return <Msg m={msg} />;
  if (status === 'skipped') return <><button type="button" className="btn sm ghost" disabled={pending} onClick={() => run(() => skipIncomingAction(id, false))}>↺ Врати</button> <Msg m={msg} /></>;
  const sug = incomingRoute(kind);
  const L = [...(sug ? [[sug.route, INBOX_ROUTES[sug.route]] as [InboxRoute, string]] : []), ...QUICK.filter(([r]) => r !== sug?.route)];
  return (
    <div className="row" style={{ gap: 4, flexWrap: 'wrap', alignItems: 'center' }}>
      {proposed.map((p) => (
        <button key={p.id} type="button" className="btn sm pri" disabled={pending} title="Сметката од изводот е на оваа фирма"
          onClick={() => { if (window.confirm(`Изводот да се увезе во „${p.name}“?`)) run(() => assignIncomingAction(id, p.id, true)); }}>🏦 Увези во {p.name}</button>
      ))}
      {firmId && L.map(([r, l], j) => (
        <button key={r} type="button" className={`btn sm${j === 0 && sug && !proposed.length ? ' pri' : ''}`} disabled={pending}
          title={j === 0 && sug ? 'Предлог според препознаениот вид' : undefined}
          onClick={() => run(() => routeIncomingAction(id, r, r === 'dossier' ? (cat || sug?.category || null) : null))}>{j === 0 && sug ? '✓ ' : '→ '}{r === sug?.route ? l : QUICK.find((q) => q[0] === r)?.[1] ?? l}</button>
      ))}
      {firmId && (
        <select value={cat} onChange={(e) => setCat(e.target.value)} style={{ width: 'auto', maxWidth: 170 }} aria-label="Категорија во досие" title="Категорија за „Досие“">
          <option value="">досие: {sug?.category ?? 'Друго'}</option>{DOS_CAT.map((c) => <option key={c}>{c}</option>)}
        </select>
      )}
      {firms.length > 0 && (
        <span className="row" style={{ gap: 2 }}>
          <select value={to} onChange={(e) => setTo(e.target.value)} style={{ width: 'auto', maxWidth: 180 }} aria-label="Фирма">
            <option value="">→ Фирма…</option>{firms.filter((f) => f.id !== firmId).map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
          </select>
          {to && <button type="button" className="btn sm" disabled={pending} onClick={() => run(() => assignIncomingAction(id, to, false))}>Премести</button>}
        </span>
      )}
      {(needsAi || kind === 'unknown') && firmId && canAi && (
        <button type="button" className="btn sm" disabled={pending || aiBusy} onClick={() => run(() => classifyIncomingAction(id))}
          title="Само кога бесплатното препознавање не успеало (фотографија, скен); под ограничувањето на AI трошокот">🤖 Препознај<AiBadge /></button>
      )}
      <button type="button" className="btn sm ghost" disabled={pending} onClick={() => run(() => redetectIncomingAction(id))} title="Препознај повторно (бесплатно)">↻</button>
      <button type="button" className="btn sm ghost" disabled={pending} onClick={() => run(() => skipIncomingAction(id, true))}>Прескокни</button>
      <Msg m={msg} />
    </div>
  );
}

/** A client's portal message: the same routing as /klInbox (suggested route from what the client said first). */
export function PortalActions({ itemId, kind }: { itemId: string; kind: IncomingKind }) {
  const { msg, pending, run } = useRun();
  const sug = incomingRoute(kind);
  const L = [...(sug ? [[sug.route, INBOX_ROUTES[sug.route]] as [InboxRoute, string]] : []), ...QUICK.filter(([r]) => r !== sug?.route)];
  return (
    <div className="row" style={{ gap: 4, flexWrap: 'wrap', alignItems: 'center' }}>
      {L.map(([r, l], j) => (
        <button key={r} type="button" className={`btn sm${j === 0 && sug ? ' pri' : ''}`} disabled={pending}
          onClick={() => run(() => routePortalAction(itemId, r, r === 'dossier' ? sug?.category ?? null : null))}>{j === 0 && sug ? '✓ ' : '→ '}{r === sug?.route ? l : QUICK.find((q) => q[0] === r)?.[1] ?? l}</button>
      ))}
      <button type="button" className="btn sm ghost" disabled={pending} onClick={() => run(() => donePortalAction(itemId))}>Само означи обработено</button>
      <Msg m={msg} />
    </div>
  );
}
