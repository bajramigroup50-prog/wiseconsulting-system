/**
 * „📷 Сметки во готово“ – the one place for the receipts paid in cash: drop any number of photos / PDFs (read as
 * purchases paid in cash, a PDF with several receipts split, the same file read once), and every receipt not yet
 * booked stays in this table until it is – „✓ Книжи ги сите спремни“ / the ticked ones, „🗑 Избриши“, or „Отвори“ for
 * one whose reason must be fixed. Booked: expense (the firm's cash rules) / ДДВ for a VAT payer / Г 1020 cash, in the
 * nalog of its period. Nothing to look for in the archive or in „За физичка проверка“.
 */
import Link from 'next/link';
import { and, eq, gte, inArray } from 'drizzle-orm';
import { aiDocuments, draftSourceFiles, files, partners, purchases, refreshStaleScanDrafts, type AiDocument } from '@wise/db';
import { isReceiptDoc, scanInvoices, type ScanResult } from '@wise/core/sales';
import { db } from '@/lib/db';
import { dmy, fmt } from '@/lib/fmt';
import { AutoRefresh } from '@/components/auto-refresh';
import { BulkBar, SelAll, SelBox } from '@/components/sales/bulk-select';
import { ScanUpload } from '@/components/sales/scan-upload';
import { RowAction } from '@/components/row-action';
import { bookCashScansAction, cashNalogOf, deleteCashScansAction, restartCashScansAction } from './actions';
import type { Firm } from '@wise/db';

type Draft = { cash?: boolean; partnerId?: string; supplierName?: string; number?: string; date?: string; docDate?: string; groups?: { base?: number; vat?: number; konto?: string }[] };
type Row = { d: AiDocument; i: number; r: Draft; status: string; msg: string };

export async function CashScans({ firm, year, userId, write }: { firm: Firm; year: number; userId: string; write: boolean }) {
  const D0 = await db().select().from(aiDocuments)
    .where(and(eq(aiDocuments.firmId, firm.id), eq(aiDocuments.kind, 'purchase'), inArray(aiDocuments.status, ['queued', 'reading', 'done', 'saved']), gte(aiDocuments.createdAt, new Date(`${year - 1}-12-01`))));
  const reading = D0.filter((d) => (d.status === 'queued' || d.status === 'reading') && (d.options as { cash?: boolean } | null)?.cash).length;
  // reads made with older rules (a receipt put aside as „не е фактура“) are rebuilt first – no new AI
  const { docs } = write ? await refreshStaleScanDrafts(db(), firm, D0.filter((d) => d.status === 'done'), { userId }) : { docs: D0.filter((d) => d.status === 'done') };
  const rows: Row[] = docs.flatMap((d) => d.drafts.map((x, i) => ({ d, i, r: (x.draft ?? {}) as Draft, status: x.status, msg: x.msg ?? '', x })))
    .filter(({ r, x }) => r.cash && !x.savedId && !x.skipped)
    .sort((a, b) => String(a.r.docDate || a.r.date).localeCompare(String(b.r.docDate || b.r.date)));
  const ready = rows.filter((r) => r.status === 'ok');
  // receipts already booked from scans (also the ones read before as „влезни“): can be deleted and booked again
  const booked = D0.flatMap((d) => { const I = scanInvoices(d.result as ScanResult | null); return d.drafts.map((x, i) => ({ d, x, r: (x.draft ?? {}) as Draft, inv: I[i] })); })
    .filter(({ x, r, inv }) => x.savedId && /^[0-9a-f-]{36}$/i.test(x.savedId) && (r.cash || (inv && isReceiptDoc(inv))));
  const live = booked.length ? new Set((await db().select({ id: purchases.id }).from(purchases).where(and(eq(purchases.firmId, firm.id), inArray(purchases.id, booked.map((b) => b.x.savedId!))))).map((p) => p.id)) : new Set<string>();
  const B = booked.filter((b) => live.has(b.x.savedId!));
  const fileOf = (d: AiDocument, i: number) => draftSourceFiles(d, i).fileIds[0] ?? d.fileId;
  const fids = [...new Set(rows.map(({ d, i }) => fileOf(d, i)).filter((x): x is string => !!x))];
  const names = new Map((fids.length ? await db().select({ id: files.id, n: files.name }).from(files).where(inArray(files.id, fids)) : []).map((f) => [f.id, f.n]));
  const pids = [...new Set(rows.map(({ r }) => r.partnerId).filter((x): x is string => !!x))];
  const P = new Map((pids.length ? await db().select({ id: partners.id, n: partners.name }).from(partners).where(inArray(partners.id, pids)) : []).map((p) => [p.id, p.n]));
  const total = (r: Draft) => (r.groups ?? []).reduce((s, g) => s + Number(g.base ?? 0) + Number(g.vat ?? 0), 0);
  const back = '/blagajna';
  const nal = await cashNalogOf(firm.id, year);
  return (
    <div className="card" id="cash-scans">
      <h3 style={{ marginTop: 0 }}>📷 Сметки платени во готово</h3>
      {write && <ScanUpload firmId={firm.id} small opts={{ kind: 'purchase', batchId: null, cash: true }}
        label={<><b>Повлечете ги сметките тука</b> (JPG / PDF, колку сакате одеднаш) – се читаат сами, се појавуваат подолу и се книжат со едно копче (трошок / готовина 1020, во налогот на периодот).</>} />}
      {write && B.length > 0 && <div className="callout warn row" style={{ justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
        <span>Прокнижени од скенирање: <b>{B.length}</b> сметки. За да ги книжите одново (налог {nal.nalogNo || 'на периодот'}, датум на отворен ДДВ период) – избришете ги; се враќаат во табелата без ново читање.</span>
        <RowAction className="btn danger" action={restartCashScansAction.bind(null, [...new Set(B.map((b) => b.x.savedId!))], [...new Set(B.map((b) => b.d.id))])} label={`↺ Избриши ги прокнижените (${B.length}) и книжи пак`} confirm={`Да се избришат ${B.length} прокнижени сметки (со налозите) и да се вратат во табелата за повторно книжење?`} showOk />
      </div>}
      {reading > 0 && <div className="callout info">⏳ Се читаат <b>{reading}</b> сметки – табелата се освежува сама.<AutoRefresh seconds={15} /></div>}
      {rows.length > 0 ? (<>
        {write && <div className="row" style={{ gap: 8, flexWrap: 'wrap', margin: '8px 0' }}>
          {ready.length > 0 && <RowAction className="btn pri" action={bookCashScansAction.bind(null, ready.map(({ d, i }) => `${d.id}:${i}`))} label={`✓ Книжи ги сите спремни (${ready.length})`} confirm={`Да се прокнижат сите ${ready.length} спремни сметки?`} showOk />}
          <BulkBar group="cs" label="✓ Книжи ги избраните ({n})" btnClass="btn" busy="Се книжи…" action={bookCashScansAction} confirm="Да се прокнижат {n} избрани сметки?" />
          <BulkBar group="cs" label="🗑 Избриши ги избраните ({n})" action={deleteCashScansAction} confirm="Да се избришат {n} избрани сметки (непрокнижени, со датотеката)?" />
        </div>}
        <div className="tw"><table className="dense">
          <thead><tr><th style={{ width: 22 }}>{write && <SelAll group="cs" />}</th><th>Датум</th><th>Продавач</th><th>Број</th><th className="n">Износ</th><th>Конто</th><th>Состојба</th><th>Датотека</th><th /></tr></thead>
          <tbody>{rows.map(({ d, i, r, status, msg }) => {
            const f = fileOf(d, i);
            return (
              <tr key={d.id + ':' + i}>
                <td>{write && <SelBox id={`${d.id}:${i}`} group="cs" />}</td>
                <td>{(r.docDate || r.date) ? dmy(String(r.docDate || r.date)) : '—'}</td>
                <td>{(r.partnerId && P.get(r.partnerId)) || r.supplierName || <i className="mut">непознат</i>}</td>
                <td>{r.number}</td><td className="n">{fmt(total(r))}</td>
                <td>{[...new Set((r.groups ?? []).map((g) => g.konto).filter(Boolean))].join(', ')}</td>
                <td>{status === 'ok' ? <span style={{ color: 'var(--good)' }}>✓ спремна</span> : <span style={{ color: 'var(--bad)' }}>{msg || 'провери'}</span>}</td>
                <td>{f ? <a href={`/api/files/${f}`} target="_blank" rel="noreferrer">{(names.get(f) ?? 'датотека').slice(0, 28)}</a> : '—'}</td>
                <td>{write && <Link className="btn sm" href={`/vlez?scan=${d.id}&i=${i}&back=${encodeURIComponent(back)}`}>Отвори</Link>}</td>
              </tr>
            );
          })}</tbody>
        </table></div>
        <p className="note">Се книжат во налог <b>{nal.nalogNo || 'на својот период'}</b>; сметка од затворен ДДВ период се книжи со датум {nal.from ? dmy(nal.from) : 'денес'} (датумот на сметката останува како датум на документот). ✓ спремна = се книжи со „Книжи ги сите спремни“. Црвените: „Отвори“, поправете и зачувајте – или избришете ги.</p>
      </>) : reading ? null : <p className="note">Нема непрокнижени сметки.</p>}
    </div>
  );
}
