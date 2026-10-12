'use client';
/**
 * „🧾 Фискален апарат“ of the till: device status, X / Z report, cash in / out and the fiscal log of the day (print
 * again a receipt the device did not confirm, storno of a fiscalised sale). Works only inside the WISE desktop app
 * (`window.wiseFiscal`); in a browser every button explains that.
 */
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { DESKTOP_ONLY, fiscalBridge, safeCall, type FiscalStatus, type WiseFiscal } from '@/lib/fiscal-bridge';
import { fmt } from '@/lib/fmt';
import { fiscalReportAction, fiscalReprintAction, fiscalResultAction, fiscalStornoAction } from './fiscal-actions';
import { printFiscal, saveAgain, type FiscalOutcome } from './fiscal-flow';

export interface FiscalLogItem {
  id: string; kind: string; status: string; number: string | null; total: number; time: string; error: string | null; ref: string | null; stornoed: boolean;
}
const KIND: Record<string, string> = { sale: 'Сметка', storno: 'Сторно', z: 'Z извештај', x: 'X извештај', cashIn: 'Внес пари', cashOut: 'Излез пари' };

export function useFiscalBridge(): WiseFiscal | null | undefined {
  const [b, setB] = useState<WiseFiscal | null | undefined>(undefined); // undefined = not checked yet (SSR)
  useEffect(() => { setB(fiscalBridge()); }, []);
  return b;
}

export function FiscalPanel({ wh, log, canWrite }: { wh: string; log: FiscalLogItem[]; canWrite: boolean }) {
  const bridge = useFiscalBridge();
  const router = useRouter();
  const [st, setSt] = useState<FiscalStatus | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [unsaved, setUnsaved] = useState<FiscalOutcome['unsaved']>(undefined);

  const refreshStatus = async (b: WiseFiscal) => setSt(await safeCall(() => b.status()) as FiscalStatus);
  useEffect(() => { if (bridge) void refreshStatus(bridge); }, [bridge]);

  const need = (): WiseFiscal | null => { if (!bridge) { setMsg({ ok: false, text: DESKTOP_ONLY }); return null; } return bridge; };
  const run = async (f: (b: WiseFiscal) => Promise<void>) => {
    const b = need();
    if (!b || busy) return;
    setBusy(true); setMsg(null);
    try { await f(b); } finally { setBusy(false); router.refresh(); }
  };
  const outcome = (o: FiscalOutcome) => { setMsg({ ok: o.ok, text: o.msg }); setUnsaved(o.unsaved); };

  const report = (type: 'X' | 'Z') => run(async (b) => {
    if (type === 'Z' && !window.confirm('Да се направи Z дневен извештај (затворање на денот во фискалната меморија)? Се прави еднаш дневно, на крајот на работата.')) return;
    const r = await safeCall(() => (type === 'Z' ? b.zReport() : b.xReport()));
    if (!r.ok) { setMsg({ ok: false, text: r.error || 'Апаратот не го направи извештајот.' }); return; }
    const s = await fiscalReportAction({ kind: type === 'Z' ? 'z' : 'x', wh, result: r });
    setMsg(s.ok ? { ok: true, text: s.ok } : { ok: false, text: `Апаратот го испечати извештајот${r.number ? ' бр. ' + r.number : ''}, но записот не е зачуван: ${s.error}` });
  });
  const cash = (dir: 1 | -1) => run(async (b) => {
    const v = Number(String(window.prompt(dir > 0 ? 'Износ што се внесува во касата (ден.):' : 'Износ што се вади од касата (ден.):') ?? '').replace(',', '.'));
    if (!Number.isFinite(v) || v <= 0) return;
    const r = await safeCall(() => b.cash(dir * v));
    if (!r.ok) { setMsg({ ok: false, text: r.error || 'Апаратот ја одби операцијата.' }); return; }
    const s = await fiscalReportAction({ kind: dir > 0 ? 'cashIn' : 'cashOut', wh, amount: v, result: r });
    setMsg(s.ok ? { ok: true, text: s.ok } : { ok: false, text: s.error || '' });
  });
  const reprint = (id: string) => run(async (b) => {
    const j = await fiscalReprintAction(id);
    if (j.error || !j.fiskId || !j.receipt) { setMsg({ ok: false, text: j.error || 'Грешка.' }); return; }
    outcome(await printFiscal(b, { fiskId: j.fiskId, receipt: j.receipt, storno: !!j.storno }, fiscalResultAction));
  });
  const storno = (id: string, no: string | null) => run(async (b) => {
    if (!window.confirm(`Да се издаде СТОРНО сметка за фискална сметка бр. ${no}? Залихата и книжењето се коригираат посебно (поврат / бришење на прометот).`)) return;
    const j = await fiscalStornoAction(id);
    if (j.error || !j.fiskId || !j.receipt) { setMsg({ ok: false, text: j.error || 'Грешка.' }); return; }
    outcome(await printFiscal(b, { fiskId: j.fiskId, receipt: j.receipt, storno: true }, fiscalResultAction));
  });
  const save = () => run(async () => { if (unsaved) outcome(await saveAgain(unsaved.fiskId, unsaved.result, fiscalResultAction)); });

  const dev = st?.device;
  return (
    <div className="card" id="fiscalPanel">
      <div className="hd"><h2>🧾 Фискален апарат</h2>
        <div className="row noprint" style={{ gap: 6 }}><Link className="btn sm" href="/kasa/aparat">⚙️ Поставки</Link></div>
      </div>
      {bridge === null && <div className="callout warn" data-testid="fiscal-desktop-only">{DESKTOP_ONLY}</div>}
      {bridge && st && (
        <div className={'callout ' + (st.ok ? 'good' : 'bad')} data-testid="fiscal-status">
          {st.ok ? '✅ Апаратот е поврзан' : `⚠️ ${st.error || (st.errors ?? []).join(' ') || 'Апаратот не е подготвен.'}`}
          {dev?.vendor ? ` · ${dev.vendor.toUpperCase()} ${dev.model ?? ''}` : ''}{st.serial ? ` · сер. бр. ${st.serial}` : ''}
          {(st.warnings ?? []).length > 0 && <div className="mini">{st.warnings!.join(' ')}</div>}
        </div>
      )}
      {msg && <div className={'callout ' + (msg.ok ? 'good' : 'bad')} role="alert">{msg.text}</div>}
      {unsaved && <button type="button" className="btn pri" onClick={save} disabled={busy}>Зачувај го бројот {unsaved.result.number}</button>}
      {canWrite && (
        <div className="row" style={{ gap: 6, flexWrap: 'wrap', margin: '8px 0' }}>
          <button type="button" className="btn" disabled={busy} onClick={() => run(refreshStatus)}>Статус</button>
          <button type="button" className="btn" disabled={busy} onClick={() => report('X')}>X извештај</button>
          <button type="button" className="btn" disabled={busy} onClick={() => report('Z')}>Z извештај</button>
          <button type="button" className="btn" disabled={busy} onClick={() => cash(1)}>Внес пари</button>
          <button type="button" className="btn" disabled={busy} onClick={() => cash(-1)}>Излез пари</button>
        </div>
      )}
      {log.length ? (
        <div className="tw"><table>
          <thead><tr><th>Време</th><th>Вид</th><th className="n">Износ</th><th>Апарат</th><th className="noprint" /></tr></thead>
          <tbody>{log.map((l) => (
            <tr key={l.id}>
              <td>{l.time}</td><td>{KIND[l.kind] ?? l.kind}{l.ref ? <span className="mini"> · за бр. {l.ref}</span> : ''}</td><td className="n">{fmt(l.total)}</td>
              <td>{l.status === 'ok' ? `✅ бр. ${l.number ?? ''}` : l.status === 'pending' ? '⏳ не е потврдена' : <span title={l.error ?? ''}>❌ {l.error ?? 'не е испечатена'}</span>}</td>
              <td className="noprint">{canWrite && (l.kind === 'sale' || l.kind === 'storno') && l.status !== 'ok' && <button type="button" className="btn sm" disabled={busy} onClick={() => reprint(l.id)}>Печати повторно</button>}
                {canWrite && l.kind === 'sale' && l.status === 'ok' && !l.stornoed && <button type="button" className="btn sm ghost danger" disabled={busy} onClick={() => storno(l.id, l.number)}>Сторно</button>}</td>
            </tr>
          ))}</tbody>
        </table></div>
      ) : <div className="empty">Денес нема фискални сметки.</div>}
    </div>
  );
}
