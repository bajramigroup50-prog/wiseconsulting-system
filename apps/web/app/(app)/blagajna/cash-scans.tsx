/**
 * „📷 Сметки во готово“ – the one place for the receipts paid in cash: drop any number of photos / PDFs (read as
 * purchases paid in cash, a PDF with several receipts split, the same file read once), and every receipt not yet
 * booked stays in this table until it is – „✓ Книжи ги сите спремни“ / the ticked ones, „🗑 Избриши“, or „Отвори“ for
 * one whose reason must be fixed. Booked: expense (the firm's cash rules) / ДДВ for a VAT payer / Г 1020 cash, in the
 * nalog of its period. Nothing to look for in the archive or in „За физичка проверка“.
 */
import Link from 'next/link';
import { and, eq, gte, inArray } from 'drizzle-orm';
import { aiDocuments, draftSourceFiles, files, partners, refreshStaleScanDrafts, type AiDocument } from '@wise/db';
import { db } from '@/lib/db';
import { dmy, fmt } from '@/lib/fmt';
import { AutoRefresh } from '@/components/auto-refresh';
import { BulkBar, SelAll, SelBox } from '@/components/sales/bulk-select';
import { ScanUpload } from '@/components/sales/scan-upload';
import { saveSelectedScansAction } from '../skan/actions';
import { RowAction } from '@/components/row-action';
import { bookReadyCashScansAction, deleteCashScansAction } from './actions';
import type { Firm } from '@wise/db';

type Draft = { cash?: boolean; partnerId?: string; supplierName?: string; number?: string; date?: string; docDate?: string; groups?: { base?: number; vat?: number; konto?: string }[] };
type Row = { d: AiDocument; i: number; r: Draft; status: string; msg: string };

export async function CashScans({ firm, year, userId, write }: { firm: Firm; year: number; userId: string; write: boolean }) {
  const D0 = await db().select().from(aiDocuments)
    .where(and(eq(aiDocuments.firmId, firm.id), eq(aiDocuments.kind, 'purchase'), inArray(aiDocuments.status, ['queued', 'reading', 'done']), gte(aiDocuments.createdAt, new Date(`${year - 1}-12-01`))));
  const reading = D0.filter((d) => (d.status === 'queued' || d.status === 'reading') && (d.options as { cash?: boolean } | null)?.cash).length;
  // reads made with older rules (a receipt put aside as „не е фактура“) are rebuilt first – no new AI
  const { docs } = write ? await refreshStaleScanDrafts(db(), firm, D0.filter((d) => d.status === 'done'), { userId }) : { docs: D0.filter((d) => d.status === 'done') };
  const rows: Row[] = docs.flatMap((d) => d.drafts.map((x, i) => ({ d, i, r: (x.draft ?? {}) as Draft, status: x.status, msg: x.msg ?? '', x })))
    .filter(({ r, x }) => r.cash && !x.savedId && !x.skipped)
    .sort((a, b) => String(a.r.docDate || a.r.date).localeCompare(String(b.r.docDate || b.r.date)));
  const ready = rows.filter((r) => r.status === 'ok');
  const fileOf = (d: AiDocument, i: number) => draftSourceFiles(d, i).fileIds[0] ?? d.fileId;
  const fids = [...new Set(rows.map(({ d, i }) => fileOf(d, i)).filter((x): x is string => !!x))];
  const names = new Map((fids.length ? await db().select({ id: files.id, n: files.name }).from(files).where(inArray(files.id, fids)) : []).map((f) => [f.id, f.n]));
  const pids = [...new Set(rows.map(({ r }) => r.partnerId).filter((x): x is string => !!x))];
  const P = new Map((pids.length ? await db().select({ id: partners.id, n: partners.name }).from(partners).where(inArray(partners.id, pids)) : []).map((p) => [p.id, p.n]));
  const total = (r: Draft) => (r.groups ?? []).reduce((s, g) => s + Number(g.base ?? 0) + Number(g.vat ?? 0), 0);
  const back = '/blagajna';
  return (
    <div className="card" id="cash-scans">
      <h3 style={{ marginTop: 0 }}>📷 Сметки платени во готово</h3>
      {write && <ScanUpload firmId={firm.id} small opts={{ kind: 'purchase', batchId: null, cash: true }}
        label={<><b>Повлечете ги сметките тука</b> (JPG / PDF, колку сакате одеднаш) – се читаат сами, се појавуваат подолу и се книжат со едно копче (трошок / готовина 1020, во налогот на периодот).</>} />}
      {reading > 0 && <div className="callout info">⏳ Се читаат <b>{reading}</b> сметки – табелата се освежува сама.<AutoRefresh seconds={15} /></div>}
      {rows.length > 0 ? (<>
        {write && <div className="row" style={{ gap: 8, flexWrap: 'wrap', margin: '8px 0' }}>
          {ready.length > 0 && <RowAction className="btn pri" action={bookReadyCashScansAction.bind(null, ready.map(({ d, i }) => `${d.id}:${i}`))} label={`✓ Книжи ги сите спремни (${ready.length})`} confirm={`Да се прокнижат сите ${ready.length} спремни сметки?`} showOk />}
          <BulkBar group="cs" label="✓ Книжи ги избраните ({n})" btnClass="btn" busy="Се книжи…" action={saveSelectedScansAction.bind(null, 'purchase')} confirm="Да се прокнижат {n} избрани сметки?" />
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
        <p className="note">✓ спремна = се книжи со „Книжи ги сите спремни“. Црвените: „Отвори“, поправете и зачувајте – или избришете ги.</p>
      </>) : reading ? null : <p className="note">Нема непрокнижени сметки.</p>}
    </div>
  );
}
