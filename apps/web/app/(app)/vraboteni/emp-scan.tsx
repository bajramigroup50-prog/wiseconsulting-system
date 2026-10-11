'use client';
/**
 * Legacy "Додај вработени од PDF" (`readEmployeeDocs` 6044–6056): drop contracts / М1 / ID cards → each is read with
 * `EMP_PROMPT` (worker) → the read names are listed → „Зачувај“ adds or updates the employees by ЕМБГ.
 */
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { AiDrop, AiReadList, useAiRead } from '@/components/ai-read';
import { saveEmployeesFromReads } from './actions';

export function EmpScan({ firmId }: { firmId: string }) {
  const router = useRouter();
  const ai = useAiRead(firmId);
  const [res, setRes] = useState<{ ok?: string; error?: string }>({});
  const [saving, start] = useTransition();
  const done = ai.docs.filter((d) => d.status === 'done');
  const nm = (r: unknown) => {
    const o = (r ?? {}) as { name?: string; embg?: string; position?: string };
    return [o.name, o.embg && 'ЕМБГ ' + o.embg, o.position].filter(Boolean).join(' · ');
  };
  const save = () => start(async () => {
    const r = await saveEmployeesFromReads(done.map((d) => d.id));
    setRes(r);
    if (!r.error) { ai.reset(); router.refresh(); }
  });
  return (
    <div className="card">
      <AiDrop small onFiles={(f) => { setRes({}); void ai.read('emp', f); }} disabled={ai.busy && !ai.docs.length}
        label={<><b>📄 Додај вработени од PDF</b> — договор за вработување, М1/М2 пријава или лична карта (PDF / слика). Се читаат автоматски, потоа ги потврдувате.</>} />
      <AiReadList docs={ai.docs} msg={ai.msg} doneHint="data" />
      {res.error && <div className="callout bad" role="alert">{res.error}</div>}
      {res.ok && <div className="callout good" role="status">{res.ok}</div>}
      {done.length > 0 && (
        <div style={{ marginTop: 8 }}>
          <ul>{done.map((d) => <li key={d.id}>{d.name}: <b>{nm(d.result) || '—'}</b></li>)}</ul>
          <div className="row" style={{ gap: 8 }}>
            <button className="btn" type="button" onClick={() => ai.reset()}>Откажи</button>
            <button className="btn pri" type="button" disabled={saving || ai.busy} onClick={save}>Зачувај {done.length} вработени</button>
          </div>
          <p className="note">Вработениот со ист ЕМБГ се ажурира (се задржуваат податоците што ги нема во документот); нето платата се пресметува од бруто со параметрите за тековниот месец.</p>
        </div>
      )}
    </div>
  );
}
