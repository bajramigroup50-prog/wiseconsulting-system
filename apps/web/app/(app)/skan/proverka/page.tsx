/**
 * „📋 За физичка проверка“ — the read (scanned) invoices of the firm (outgoing `?k=sale` or incoming) checked against the
 * paper documents, in three parts:
 * 1. not saved yet, with the reason — tick and „✓ Книжи ги избраните“ (posted into the nalog of their period) or
 *    „📁 Само за архива“ (cancelled, not an invoice… — not posted, the file stays); the others stay on the list;
 * 2. posted from this list, waiting for the physical check — „✓ Проверено“, or open the invoice to correct it;
 * 3. the archive (not posted) and the checked ones — „Врати“ puts an archived one back.
 * Printable (the checkbox column is the ☐ on paper).
 */
import Link from 'next/link';
import { and, eq, inArray } from 'drizzle-orm';
import { aiDocuments, draftSourceFiles, files, journals, partners, refreshStaleScanDrafts, releaseDeletedScanDrafts, type AiDocument } from '@wise/db';
import { booksPage, canDo } from '@/lib/books';
import { db } from '@/lib/db';
import { dmy, fmt } from '@/lib/fmt';
import { Hd } from '@/components/hd';
import { NoFirm } from '@/components/no-firm';
import { BulkBar, SelAll, SelBox } from '@/components/sales/bulk-select';
import { archiveScansAction, markScansCheckedAction, saveSelectedScansAction } from '../actions';
import { PrintBtn } from './print-btn';

type Draft = { partnerId?: string; buyer?: { name?: string }; supplierName?: string; number?: string; date?: string; docDate?: string; total?: number; groups?: { base?: number; vat?: number }[] };
type Row = { d: AiDocument; x: AiDocument['drafts'][number]; i: number; r: Draft };
const WHY: Record<string, string> = { ok: '✓ спремна', past: '⏸ минат ДДВ период', dup: 'веќе внесена (ист број)', err: 'грешка при читање' };

export default async function ProverkaPage({ searchParams }: { searchParams: Promise<{ k?: string }> }) {
  const sp = await searchParams;
  const { u, firm } = await booksPage('skan');
  if (!firm) return <NoFirm t="За физичка проверка" />;
  const kind: 'sale' | 'purchase' = sp.k === 'sale' ? 'sale' : 'purchase';
  const write = canDo(u, 'write', firm.id);
  // as on the scan screen: reads whose invoice was deleted are free again, and unsaved reads built with older rules are
  // rebuilt from the stored read with the current rules (no AI) — e.g. „0 % = чл. 24“, a work order archived
  await releaseDeletedScanDrafts(db(), firm.id, [kind]);
  const D0 = await db().select().from(aiDocuments).where(and(eq(aiDocuments.firmId, firm.id), eq(aiDocuments.kind, kind), inArray(aiDocuments.status, ['done', 'saved'])));
  const { docs: D } = write ? await refreshStaleScanDrafts(db(), firm, D0, { userId: u.id }) : { docs: D0 };
  const dateOf = (r: Draft) => String(r.docDate ?? r.date ?? '');
  const all: Row[] = D.flatMap((d) => d.drafts.map((x, i) => ({ d, x, i, r: (x.draft ?? {}) as Draft }))).sort((a, b) => dateOf(a.r).localeCompare(dateOf(b.r)));
  // not saved: also the reads the program put aside as „not an invoice“ (испратница / профактура…) — the AI can be
  // wrong (an invoice read as a delivery note), so they are shown to decide; only the user's archive stays out
  const open = all.filter(({ x }) => !x.savedId && (!x.skipped || (x.status === 'skip' && !x.archived)));
  const posted = all.filter(({ x }) => x.savedId && x.review && !x.checkedAt);
  const checked = all.filter(({ x }) => x.savedId && x.review && x.checkedAt);
  const archived = all.filter(({ x }) => !x.savedId && x.skipped && x.archived);
  // each invoice's own file (several photos read together: the page of that invoice, not the first photo)
  const fileOf = (d: AiDocument, i: number) => draftSourceFiles(d, i).fileIds[0] ?? d.fileId;
  const fids = [...new Set(all.flatMap(({ d, i }) => { const f = fileOf(d, i); return f ? [f] : []; }))];
  const names = new Map((fids.length ? await db().select({ id: files.id, n: files.name }).from(files).where(inArray(files.id, fids)) : []).map((f) => [f.id, f.n]));
  const P = new Map((await db().select({ id: partners.id, n: partners.name }).from(partners).where(eq(partners.firmId, firm.id))).map((p) => [p.id, p.n]));
  const sids = posted.map(({ x }) => x.savedId!);
  const J = new Map((sids.length ? await db().select({ s: journals.sourceId, n: journals.number }).from(journals).where(and(eq(journals.firmId, firm.id), inArray(journals.sourceId, sids))) : []).map((j) => [j.s, j.n]));
  const total = (r: Draft) => (kind === 'sale' ? Number(r.total ?? 0) : (r.groups ?? []).reduce((s, g) => s + Number(g.base ?? 0) + Number(g.vat ?? 0), 0));
  const editor = kind === 'sale' ? '/izlez' : '/vlez';
  const back = `/skan/proverka${kind === 'sale' ? '?k=sale' : ''}`;
  const party = (r: Draft) => (r.partnerId && P.get(r.partnerId)) || (kind === 'sale' ? r.buyer?.name : r.supplierName) || <i className="mut">непознат</i>;
  const file = (d: AiDocument, i: number) => { const f = fileOf(d, i); return f ? <a href={`/api/files/${f}`} target="_blank" rel="noreferrer">{(names.get(f) ?? 'датотека').slice(0, 32)}</a> : '—'; };
  const cancelled = (d: AiDocument, i: number) => { const f = fileOf(d, i); return !!f && /откажан|сторн|поништ|cancel|storno|anulua/i.test(names.get(f) ?? ''); };
  const head = (g: string, extra: string) => (
    <thead><tr><th style={{ width: 22 }}>{write ? <SelAll group={g} /> : '☐'}</th><th>#</th><th>Датум</th><th>Број</th><th>{kind === 'sale' ? 'Купувач' : 'Добавувач'}</th><th className="n">Износ</th><th>{extra}</th><th>Датотека</th><th className="noprint" /></tr></thead>
  );
  const cells = ({ d, i, r }: Row, k: number, g: string) => (<>
    <td>{write ? <SelBox id={`${d.id}:${i}`} group={g} /> : '☐'}</td><td>{k + 1}</td>
    <td>{dateOf(r) ? dmy(dateOf(r)) : '—'}</td><td>{r.number || <i className="mut">без број</i>}</td><td>{party(r)}</td><td className="n">{fmt(total(r))}</td>
  </>);
  const title = `За физичка проверка – ${kind === 'sale' ? 'излезни' : 'влезни'} фактури`;
  return (
    <>
      <Hd t={title} sub={`${firm.name} · за проверка ${open.length} · прокнижени, непроверени ${posted.length} · проверени ${checked.length} · архива ${archived.length}`}>
        <Link className={'btn noprint' + (kind === 'purchase' ? ' pri' : '')} href="/skan/proverka">Влезни</Link>
        <Link className={'btn noprint' + (kind === 'sale' ? ' pri' : '')} href="/skan/proverka?k=sale">Излезни</Link>
        <PrintBtn />
        <Link className="btn noprint" href={kind === 'sale' ? '/skan?k=sale' : '/skan'}>← Скенирање</Link>
      </Hd>

      <div className="card">
        <h2>1. За проверка – не се книжени ({open.length})</h2>
        {open.length > 0 && write && (
          <div className="noprint">
            <BulkBar group="pv" label="✓ Книжи ги избраните – во налог ({n})" btnClass="btn pri" busy="Се книжи…" action={saveSelectedScansAction.bind(null, kind)}
              confirm="Да се прокнижат {n} избрани фактури (проверени со документот), секоја во налогот на својот период? Новите купувачи се додаваат. Остануваат на оваа страница под „Прокнижени – за физичка проверка“." />
            <BulkBar group="pv" label="📁 Само за архива ({n})" btnClass="btn" busy="…" action={archiveScansAction.bind(null, false)}
              confirm="{n} избрани да НЕ се книжат – само за архива (откажана, не е фактура, двојна…)? Датотеката останува; може да се врати." />
          </div>
        )}
        {open.length ? (
          <div className="tw"><table className="dense">
            {head('pv', 'Зошто не е зачувана')}
            <tbody>{open.map((row, k) => (
              <tr key={row.d.id + ':' + row.i}>
                {cells(row, k, 'pv')}
                <td className="mini">{row.x.status === 'skip' && <b>⚠ програмот ја оставил настрана – </b>}{row.x.msg || WHY[row.x.status] || row.x.status}{row.x.status === 'skip' && <div>Ако е фактура – „✓ Книжи“; ако не е – „📁 Само за архива“.</div>}
                  {!total(row.r) && <div><b>износ 0 – веројатно не е фактура</b></div>}
                  {cancelled(row.d, row.i) && <div><b>⚠ датотеката е означена како ОТКАЖАНА / СТОРНО</b></div>}</td>
                <td className="mini">{file(row.d, row.i)}</td>
                <td className="noprint">{write && <Link className="btn sm" href={`${editor}?scan=${row.d.id}&i=${row.i}&back=${encodeURIComponent(back)}`}>Провери / поправи</Link>}</td>
              </tr>
            ))}</tbody>
          </table></div>
        ) : <div className="callout good">✓ Нема незачувани скенирани {kind === 'sale' ? 'излезни' : 'влезни'} фактури.</div>}
      </div>

      <div className="card">
        <h2>2. Прокнижени – за физичка проверка ({posted.length})</h2>
        {posted.length > 0 && write && <div className="noprint">
          <BulkBar group="pp" label="✓ Проверено ({n})" btnClass="btn pri" busy="…" action={markScansCheckedAction.bind(null, false)} confirm="{n} прокнижени фактури се проверени со документите?" />
        </div>}
        {posted.length ? (
          <div className="tw"><table className="dense">
            {head('pp', 'Налог')}
            <tbody>{posted.map((row, k) => (
              <tr key={row.d.id + ':' + row.i}>
                {cells(row, k, 'pp')}
                <td>{J.get(row.x.savedId!) ? <Link href={`/nalozi?n=${encodeURIComponent(J.get(row.x.savedId!)!)}`}>{J.get(row.x.savedId!)}</Link> : '—'}</td>
                <td className="mini">{file(row.d, row.i)}</td>
                <td className="noprint"><Link className="btn sm" href={`${editor}?edit=${row.x.savedId}`}>Отвори / поправи</Link></td>
              </tr>
            ))}</tbody>
          </table></div>
        ) : <div className="mini">Нема прокнижени фактури што чекаат физичка проверка.</div>}
      </div>

      {(checked.length > 0 || archived.length > 0) && (
        <div className="card noprint">
          <h2>3. Само за архива ({archived.length}) · Проверени ({checked.length})</h2>
          {archived.length > 0 && write && <BulkBar group="pa" label="↺ Врати ги избраните за проверка ({n})" btnClass="btn" busy="…" action={archiveScansAction.bind(null, true)} confirm="{n} фактури да се вратат во листата за проверка?" />}
          <div className="tw"><table className="dense">
            {head('pa', 'Одлука')}
            <tbody>
              {archived.map((row, k) => (
                <tr key={row.d.id + ':' + row.i}>{cells(row, k, 'pa')}<td><span className="pill">📁 архива</span> <span className="mini">{dmy(row.x.archived!.slice(0, 10))}</span></td><td className="mini">{file(row.d, row.i)}</td><td /></tr>
              ))}
              {checked.map((row, k) => (
                <tr key={row.d.id + ':' + row.i}>
                  <td /><td>{archived.length + k + 1}</td><td>{dateOf(row.r) ? dmy(dateOf(row.r)) : '—'}</td><td>{row.r.number}</td><td>{party(row.r)}</td><td className="n">{fmt(total(row.r))}</td>
                  <td><span className="pill good">✓ прокнижена, проверена</span> <span className="mini">{dmy(row.x.checkedAt!.slice(0, 10))}</span></td><td className="mini">{file(row.d, row.i)}</td>
                  <td><Link className="btn sm ghost" href={`${editor}?edit=${row.x.savedId}`}>Отвори</Link></td>
                </tr>
              ))}
            </tbody>
          </table></div>
        </div>
      )}
      <p className="note noprint">Штиклирајте ги проверените и изберете: „✓ Книжи“ (во налогот на својот период) или „📁 Само за архива“ (откажана, не е фактура…). Неизбраните остануваат во листата. Прокнижените стојат под 2. додека не ги проверите физички („✓ Проверено“).</p>
    </>
  );
}
