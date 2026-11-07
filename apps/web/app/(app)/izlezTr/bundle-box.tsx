/**
 * „📦 Пакет на патувањето (еден PDF)“: the whole trip in one file — split by the AI into invoice / CMR / travel order /
 * receipts, each sent to its place, the trip booked in the invoice's nalog. The last packets with what was done.
 */
import Link from 'next/link';
import { and, desc, eq, gte, ne } from 'drizzle-orm';
import { BUNDLE_LABEL, type BundleKind } from '@wise/core/industry';
import { docReads, freightTours, type Firm } from '@wise/db';
import { db } from '@/lib/db';
import { dmy } from '@/lib/fmt';
import { ActionForm, Submit } from '@/components/action-form';
import { UploadField } from '@/components/upload-field';
import { AutoRefresh } from '@/components/auto-refresh';
import { attachBundleAction, readTripBundleAction } from './actions';

type Res = { parts?: { kind: BundleKind; fileId: string; pages: string; number: string; aiDocId?: string; invoiceId?: string }[]; tourId?: string | null; nalog?: string | null; notes?: string[] };

export async function BundleBox({ firm, year, write }: { firm: Firm; year: number; write: boolean }) {
  const [B, T] = await Promise.all([
    db().select().from(docReads).where(and(eq(docReads.firmId, firm.id), eq(docReads.kind, 'tripbundle'))).orderBy(desc(docReads.createdAt)).limit(12),
    db().select({ id: freightTours.id, number: freightTours.number, date: freightTours.date }).from(freightTours)
      .where(and(eq(freightTours.firmId, firm.id), ne(freightTours.status, 'cancel'), gte(freightTours.date, `${year - 1}-12-01`))).orderBy(desc(freightTours.date)).limit(80),
  ]);
  const tno = (id?: string | null) => (id ? T.find((t) => t.id === id)?.number ?? '' : '');
  const busy = B.some((b) => b.status === 'queued' || b.status === 'reading');
  const trips = (first: string) => (
    <select name="tourId" style={{ maxWidth: 360 }}><option value="">{first}</option>{T.map((t) => <option key={t.id} value={t.id}>{t.number} · {dmy(t.date)}</option>)}</select>
  );
  return (
    <div className="card">
      <h2 style={{ fontSize: 15, marginTop: 0 }}>📦 Пакет на патувањето – сè во еден PDF</h2>
      <p className="note" style={{ marginTop: 0 }}>Ако клиентот ги испраќа <b>фактурата, CMR, патниот налог и фискалните сметки во еден PDF</b>: повлечете го тука. Програмот ги препознава страниците, ги дели и ги праќа секоја на своето место – фактурата се зачувува како излезна, од патниот налог се прави патувањето со дневниците, CMR се прикачува, сметките (од сите држави) се читаат – и сè се книжи во <b>еден налог со бројот на фактурата</b>. Што не може автоматски, е напишано подолу.</p>
      {write && (
        <ActionForm action={readTripBundleAction} className="" style={{ marginBottom: 8 }}>
          <div className="row" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <UploadField firmId={firm.id} accept="application/pdf,image/*" label="📎 Избери PDF со целото патување (може повеќе – секој е едно патување)" />
            {trips('— ново патување (од патниот налог во пакетот) —')}
            <Submit className="btn pri">🤖 Подели и книжи</Submit>
          </div>
        </ActionForm>
      )}
      {busy && <div className="callout info">⏳ Пакетите се делат и читаат…<AutoRefresh seconds={20} /></div>}
      {B.length > 0 && (
        <div className="tw"><table className="dense">
          <thead><tr><th>Прикачено</th><th>Делови</th><th>Патување</th><th>Налог</th><th>Забелешки</th></tr></thead>
          <tbody>{B.map((b) => {
            const r = (b.result ?? {}) as Res;
            const tour = r.tourId ?? b.refId;
            return (
              <tr key={b.id}>
                <td className="mini">{b.createdAt.toISOString().slice(0, 16).replace('T', ' ')}</td>
                <td className="mini">
                  {b.status === 'queued' || b.status === 'reading' ? '⏳ се дели…' : b.status === 'error' ? <span style={{ color: 'var(--bad)' }}>✕ {b.error}</span> : null}
                  {(r.parts ?? []).map((p, i) => (
                    <div key={i} style={{ whiteSpace: 'nowrap' }}>
                      <a href={`/api/files/${p.fileId}`} target="_blank" rel="noopener">{BUNDLE_LABEL[p.kind] ?? p.kind}</a> <span className="mini">стр. {p.pages}{p.number ? ` · ${p.number}` : ''}</span>
                      {p.kind === 'invoice' && (p.invoiceId ? <> · <Link href={`/izlez?edit=${p.invoiceId}`}>зачувана</Link></> : p.aiDocId ? <> · <Link href={`/izlez?scan=${p.aiDocId}&i=0&back=/izlezTr`}>провери и зачувај</Link></> : null)}
                    </div>
                  ))}
                </td>
                <td>{tour ? <Link href={`/izlezTr?t=${tour}#dosie`}>📁 {tno(tour) || 'досие'}</Link> : b.status === 'done' && write ? (
                  <ActionForm action={attachBundleAction.bind(null, b.id)} className="row" reset={false} style={{ gap: 4 }}>{trips('— изберете патување —')}<Submit className="btn sm">Поврзи</Submit></ActionForm>
                ) : '—'}</td>
                <td>{r.nalog ? <span className="pill good">{r.nalog}</span> : '—'}</td>
                <td className="mini">{(r.notes ?? []).map((n, i) => <div key={i}>• {n}</div>)}</td>
              </tr>
            );
          })}</tbody>
        </table></div>
      )}
    </div>
  );
}
