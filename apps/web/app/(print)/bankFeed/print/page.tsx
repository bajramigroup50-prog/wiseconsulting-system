/**
 * „🖨 Печати“ in „🏦 Изводи од банка“: the fetched statements as read (header with balances, every line), one
 * statement per page, for the office's paper archive before approval. Marked „испечатен“ after printing.
 */
import { notFound } from 'next/navigation';
import { and, eq, inArray } from 'drizzle-orm';
import type { Statement } from '@wise/core/bank-parsers';
import { can } from '@wise/core';
import { BANKFEED_SOURCE, firms, incomingDocs } from '@wise/db';
import { PrintPage } from '@/components/print-page';
import { requireUser } from '@/lib/auth';
import { db } from '@/lib/db';
import { markPrintedAction } from '../../../(app)/bankFeed/actions';

const m = (c: number | null | undefined) => (c == null ? '' : (c / 100).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const dmy = (d: string) => (d ? d.slice(0, 10).split('-').reverse().join('.') : '');

export default async function BankFeedPrint({ searchParams }: { searchParams: Promise<{ ids?: string }> }) {
  const u = await requireUser();
  if (['klient', 'teren', 'view'].includes(u.role) || u.demo) notFound();
  const ids = String((await searchParams).ids ?? '').split(',').filter((x) => /^[0-9a-f-]{36}$/i.test(x));
  const R = ids.length ? await db().select({ d: incomingDocs, firm: firms.name }).from(incomingDocs).leftJoin(firms, eq(firms.id, incomingDocs.firmId))
    .where(and(inArray(incomingDocs.id, ids), eq(incomingDocs.source, BANKFEED_SOURCE))) : [];
  const L = R.filter((r) => !r.d.firmId || can(u.principal, 'read', r.d.firmId));
  if (!L.length) return <PrintPage title="Изводи"><p>Нема изводи за печатење.</p></PrintPage>;
  return (
    <PrintPage title="Изводи од банка" onPrinted={markPrintedAction.bind(null, L.map((r) => r.d.id))}>
      <style>{`.st{page-break-after:always;font:10pt Arial}.st table{width:100%;border-collapse:collapse;margin-top:8px}.st th,.st td{border:1px solid #999;padding:3px 5px;font-size:9pt;vertical-align:top}.st th{background:#eee}.n{text-align:right;white-space:nowrap}`}</style>
      {L.flatMap((r) => (((r.d.detect as { full?: Statement[] }).full ?? []) as Statement[]).map((s, k) => (
        <div className="st" key={r.d.id + k}>
          <h2 style={{ margin: '0 0 4px' }}>ИЗВОД бр. {s.no || '—'} од {dmy(s.date)}</h2>
          <div><b>{r.firm ?? 'Фирма: —'}</b> · сметка {s.iban || s.account} · {s.currency || 'MKD'}</div>
          <div>Почетна состојба: <b>{m(s.opening)}</b> · Должи: {m(s.debit)} · Побарува: {m(s.credit)} · Нова состојба: <b>{m(s.closing)}</b></div>
          <table>
            <thead><tr><th>#</th><th>Датум</th><th>Налогодавач / примач</th><th>Сметка</th><th>Цел на дознака</th><th>Шифра</th><th>Повик</th><th className="n">Одлив</th><th className="n">Прилив</th></tr></thead>
            <tbody>
              {s.lines.map((l, i) => (
                <tr key={i}><td>{i + 1}</td><td>{dmy(l.date)}</td><td>{l.counterparty}</td><td>{l.iban ?? ''}</td><td>{l.purpose || l.desc}</td><td>{l.osnov}</td><td>{l.ref}</td>
                  <td className="n">{l.amount < 0 ? m(-l.amount) : ''}</td><td className="n">{l.amount > 0 ? m(l.amount) : ''}</td></tr>
              ))}
            </tbody>
            <tfoot><tr><td colSpan={7}>Вкупно ({s.lines.length} ставки)</td><td className="n">{m(s.lines.reduce((a, l) => a + (l.amount < 0 ? -l.amount : 0), 0))}</td><td className="n">{m(s.lines.reduce((a, l) => a + (l.amount > 0 ? l.amount : 0), 0))}</td></tr></tfoot>
          </table>
          <p style={{ fontSize: '8pt', color: '#555', marginTop: 10 }}>Преземено автоматски од банката · {r.d.what} · Проверил: ____________________ Датум: __________</p>
        </div>
      )))}
    </PrintPage>
  );
}
