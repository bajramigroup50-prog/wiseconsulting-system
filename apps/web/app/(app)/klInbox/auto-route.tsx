'use client';
/**
 * Legacy `irGo` with „🤖 автоматски“ (14031): classify the message's document with AI, then route it like a manual
 * choice (`routeInboxFile`) and open the target screen. When the document cannot be classified the office chooses.
 */
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { inboxClassification } from '@wise/core/ai/classify';
import { INBOX_ROUTES } from '@wise/core/office';
import { useAiPoll } from '@/components/ai-read';
import { classifyInbox, routeInboxFile } from './actions';

export function AutoRoute({ itemId }: { itemId: string }) {
  const router = useRouter();
  const { docs, setDocs, busy } = useAiPoll();
  const [msg, setMsg] = useState('');
  const [working, setWorking] = useState(false);
  useEffect(() => {
    const d = docs[0];
    if (!d || d.status === 'queued' || d.status === 'reading') return;
    setDocs([]);
    if (d.status === 'error') { setMsg(d.error || 'Документот не е препознаен.'); setWorking(false); return; }
    const c = inboxClassification(d.result);
    if (!c.route) { setMsg(`🤖 ${c.what || 'Непознат документ'} – изберете рачно каде оди.`); setWorking(false); return; }
    setMsg(`🤖 ${c.what || INBOX_ROUTES[c.route]} → ${INBOX_ROUTES[c.route]}`);
    void routeInboxFile(itemId, null, c.route).then((r) => {
      setWorking(false);
      if (r.error) { setMsg(r.error); return; }
      setMsg(r.ok ?? '');
      if (r.go) router.push(r.go); else router.refresh();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docs]);
  const go = async () => {
    setWorking(true); setMsg('🤖 Се препознава…');
    const r = await classifyInbox(itemId);
    if (r.error || !r.id) { setMsg(r.error ?? 'Грешка.'); setWorking(false); return; }
    setDocs([{ id: r.id, kind: 'classify', status: 'queued', error: null, model: null, result: null, name: '', fileId: null }]);
  };
  return (
    <>
      <button className="btn sm" type="button" onClick={go} disabled={working || busy} title="AI препознава каков е документот и го праќа во соодветниот модул">🤖 Автоматски</button>
      {msg && <span className="mini">{msg}</span>}
    </>
  );
}
