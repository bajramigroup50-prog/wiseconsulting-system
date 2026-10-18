/**
 * „📋 За физичка проверка“ — every read (scanned) invoice of the firm that is still not saved (outgoing `?k=sale` or
 * incoming), from the scan screen and the „масовно“ lists, with the reason it was not saved automatically, the file,
 * „Провери“ (the editor) and „Прескокни“; printable as a check list (a ☐ per row for the paper documents).
 */
import Link from 'next/link';
import { and, eq, inArray } from 'drizzle-orm';
import { aiDocuments, files, partners } from '@wise/db';
import { booksPage, canDo } from '@/lib/books';
import { db } from '@/lib/db';
import { dmy, fmt } from '@/lib/fmt';
import { Hd } from '@/components/hd';
import { NoFirm } from '@/components/no-firm';
import { RowAction } from '@/components/row-action';
import { skipScanDraft } from '../actions';
import { PrintBtn } from './print-btn';

type Draft = { partnerId?: string; buyer?: { name?: string }; supplierName?: string; number?: string; date?: string; docDate?: string; total?: number; groups?: { base?: number; vat?: number }[] };
const WHY: Record<string, string> = { ok: '✓ спремна – само „Зачувај ги сите спремни“', past: '⏸ минат ДДВ период – „Прокнижи во својот период“', dup: 'веќе внесена (ист број)', err: 'грешка при читање' };

export default async function ProverkaPage({ searchParams }: { searchParams: Promise<{ k?: string }> }) {
  const sp = await searchParams;
  const { u, firm } = await booksPage('skan');
  if (!firm) return <NoFirm t="За физичка проверка" />;
  const kind: 'sale' | 'purchase' = sp.k === 'sale' ? 'sale' : 'purchase';
  const write = canDo(u, 'write', firm.id);
  const D = await db().select().from(aiDocuments).where(and(eq(aiDocuments.firmId, firm.id), eq(aiDocuments.kind, kind), inArray(aiDocuments.status, ['done', 'saved'])));
  const rows = D.flatMap((d) => d.drafts.map((x, i) => ({ d, x, i, r: (x.draft ?? {}) as Draft })))
    .filter(({ x }) => !x.savedId && !x.skipped)
    .sort((a, b) => String(a.r.docDate ?? a.r.date ?? '').localeCompare(String(b.r.docDate ?? b.r.date ?? '')));
  const fids = [...new Set(rows.flatMap(({ d }) => (d.fileId ? [d.fileId] : [])))];
  const names = new Map((fids.length ? await db().select({ id: files.id, n: files.name }).from(files).where(inArray(files.id, fids)) : []).map((f) => [f.id, f.n]));
  const P = new Map((await db().select({ id: partners.id, n: partners.name }).from(partners).where(eq(partners.firmId, firm.id))).map((p) => [p.id, p.n]));
  const total = (r: Draft) => (kind === 'sale' ? Number(r.total ?? 0) : (r.groups ?? []).reduce((s, g) => s + Number(g.base ?? 0) + Number(g.vat ?? 0), 0));
  const editor = kind === 'sale' ? '/izlez' : '/vlez';
  const back = `/skan/proverka${kind === 'sale' ? '?k=sale' : ''}`;
  const title = `За физичка проверка – ${kind === 'sale' ? 'излезни' : 'влезни'} фактури`;
  return (
    <>
      <Hd t={title} sub={`${firm.name} · ${rows.length} скенирани фактури што не се зачувани – проверете ги со документите`}>
        <Link className={'btn noprint' + (kind === 'purchase' ? ' pri' : '')} href="/skan/proverka">Влезни</Link>
        <Link className={'btn noprint' + (kind === 'sale' ? ' pri' : '')} href="/skan/proverka?k=sale">Излезни</Link>
        <PrintBtn />
        <Link className="btn noprint" href={kind === 'sale' ? '/skan?k=sale' : '/skan'}>← Скенирање</Link>
      </Hd>
      {rows.length ? (
        <div className="tw"><table className="dense">
          <thead><tr><th style={{ width: 22 }}>☐</th><th>#</th><th>Датум</th><th>Број</th><th>{kind === 'sale' ? 'Купувач' : 'Добавувач'}</th><th className="n">Износ</th><th>Зошто не е зачувана</th><th>Датотека</th><th className="noprint" /></tr></thead>
          <tbody>{rows.map(({ d, x, i, r }, k) => (
            <tr key={d.id + ':' + i}>
              <td>☐</td><td>{k + 1}</td>
              <td>{r.docDate || r.date ? dmy(String(r.docDate ?? r.date)) : '—'}</td>
              <td>{r.number || <i className="mut">без број</i>}</td>
              <td>{(r.partnerId && P.get(r.partnerId)) || (kind === 'sale' ? r.buyer?.name : r.supplierName) || <i className="mut">непознат</i>}</td>
              <td className="n">{fmt(total(r))}</td>
              <td className="mini">{x.msg || WHY[x.status] || x.status}{!total(r) && <div><b>износ 0 – веројатно не е фактура</b></div>}</td>
              <td className="mini">{d.fileId ? <a href={`/api/files/${d.fileId}`} target="_blank" rel="noreferrer">{(names.get(d.fileId) ?? 'датотека').slice(0, 32)}</a> : '—'}</td>
              <td className="noprint row" style={{ gap: 4 }}>
                {write && <Link className="btn sm" href={`${editor}?scan=${d.id}&i=${i}&back=${encodeURIComponent(back)}`}>Провери</Link>}
                {write && <RowAction action={skipScanDraft.bind(null, d.id, i, true)} label="Прескокни" title="Не е фактура / веќе внесена – се тргнува од листата (може да се врати во Скенирање)" />}
              </td>
            </tr>
          ))}</tbody>
        </table></div>
      ) : <div className="callout good">✓ Сите скенирани {kind === 'sale' ? 'излезни' : 'влезни'} фактури се зачувани.</div>}
      <p className="note noprint">„Провери“ ја отвора фактурата со прочитаните податоци – поправете и зачувајте. „Прескокни“ ја тргнува од листата (не е фактура, двојна…). Печатете ја листата и штиклирајте ☐ кога ќе ја проверите со документот.</p>
    </>
  );
}
