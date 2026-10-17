'use client';
/**
 * Partner of a read (scanned / AI) document in the invoice and purchase editors: how it was recognised, the uncertain
 * candidates („Дали е ова: …“) as one-click buttons, the partner created automatically („нов партнер креиран“ with
 * ✎ / откажи), and the document's ЕДБ / ЕМБС to save on a picked partner. The identifier is labelled by its kind
 * (13 digits ЕДБ, 7 digits ЕМБС).
 */
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { classifyPartnerId, partnerIdLabel, type DraftPartnerMatch } from '@wise/core/partners/match';
import { pickScanPartner, saveScanPartnerId, undoScanPartner } from '@/app/(app)/skan/actions';

export interface PickedPartner { id: string; name: string; code: string | null; edb: string | null }

export function ScanPartnerNote(p: {
  docId: string; index: number; match?: DraftPartnerMatch | null; partnerId: string;
  /** Name and ЕДБ / ЕМБС as printed on the document. */
  name: string; idRaw: string;
  /** 'Купувачот' / 'Добавувачот'. */
  who: string;
  /** „Додај го како партнер“ (a bound server action or the editor's own handler). */
  onAdd: () => Promise<unknown> | void;
  /** The editor keeps its own state (purchase): told about the change; without it the page is refreshed. */
  onPicked?: (x: PickedPartner) => void;
  onUndone?: () => void;
}) {
  const router = useRouter();
  const [m, setM] = useState(p.match ?? null);
  const [msg, setMsg] = useState('');
  const [pending, start] = useTransition();
  const idk = m?.idKind ?? classifyPartnerId(p.idRaw).kind;
  const idTxt = (m?.id || p.idRaw) ? `${partnerIdLabel(idk)} ${m?.id || p.idRaw}` : 'без ЕДБ / ЕМБС';
  const done = () => { if (!p.onPicked) router.refresh(); };
  const run = (f: () => Promise<{ error?: string; ok?: string }>, after?: () => void) => start(async () => {
    const r = await f();
    if (r.error) { setMsg(r.error); return; }
    setMsg('');
    after?.();
  });

  const pick = (id: string) => run(() => pickScanPartner(p.docId, p.index, id).then((r) => {
    if (!r.error && r.partner) {
      setM((o) => ({ ...(o ?? { idKind: idk, id: p.idRaw, candidates: [] }), by: 'picked', partner: r.partner!, created: false, ...(r.offerId ? { offerId: r.offerId } : {}) }));
      p.onPicked?.(r.partner);
      done();
    }
    return r;
  }));
  const add = () => run(async () => { const r = await p.onAdd(); done(); return (r && typeof r === 'object' ? r : {}) as { error?: string } });
  const undo = () => run(() => undoScanPartner(p.docId, p.index), () => { setM((o) => (o ? { ...o, by: '', created: false, declined: true } : o)); p.onUndone?.(); done(); });
  const saveId = () => run(() => saveScanPartnerId(p.docId, p.index), () => { setM((o) => (o ? { ...o, offerId: undefined } : o)); });

  const err = msg ? <span className="bad"> {msg}</span> : null;
  if (p.partnerId && m) {
    if (m.partner && m.partner.id !== p.partnerId) return null;
    const nm = m?.partner?.name ?? '';
    return <>
      {m?.created && <div className="callout good mini">нов партнер креиран: <b>{nm || p.name}</b>{m.partner?.code ? ` (шифра ${m.partner.code})` : ''} · {idTxt}{' '}
        <Link className="btn sm ghost" href={`/partneri?edit=${p.partnerId}`} title="Уреди го комитентот">✎</Link>{' '}
        <button type="button" className="btn sm ghost" disabled={pending} onClick={undo} title="Не креирај нов комитент">откажи</button>{err}</div>}
      {m?.by === 'name' && <div className="callout mini">{p.who} „{p.name}“ е препознаен по име (проверете){nm ? <>: <b>{nm}</b>{m.partner?.code ? ` (${m.partner.code})` : ''}</> : ''}.</div>}
      {m?.offerId && <div className="callout mini">{partnerIdLabel(m.offerId.kind)} {m.offerId.value} од документот не е запишан кај комитентот.{' '}
        <button type="button" className="btn sm" disabled={pending} onClick={saveId}>Запиши го</button>{err}</div>}
    </>;
  }
  if (p.partnerId || !p.name) return null;
  const C = m?.candidates ?? [];
  if (C.length) {
    return <div className="callout warn">{p.who} „{p.name}“ ({idTxt}) не е препознаен со сигурност. Дали е ова:{' '}
      {C.map((c) => <button key={c.id} type="button" className="btn sm" disabled={pending} onClick={() => pick(c.id)} title={`сличност ${Math.round(c.score * 100)}%`}>
        {c.name}{c.code ? ` · ${c.code}` : ''}{c.edb ? ` · ЕДБ ${c.edb}` : c.embs ? ` · ЕМБС ${c.embs}` : ''}</button>)}{' '}
      <button type="button" className="btn sm ghost" disabled={pending} onClick={add}>Додај нов партнер</button>{err}</div>;
  }
  return <div className="callout warn">{p.who} „{p.name}“ ({idTxt}) не е во комитенти.{' '}
    <button type="button" className="btn sm pri" disabled={pending} onClick={add}>Додај го како партнер</button>{err}</div>;
}
