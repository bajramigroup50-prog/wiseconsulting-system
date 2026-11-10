/**
 * „🏦 Изводи од банка (автоматски)“ — the statements the bank connections bring every evening (worker `bank.feeds`),
 * waiting for the office: 👁 the original, 🖨 print (one or all at once, for the paper archive), ✓ approve and book
 * (THE existing import into the bank nalog), ✕ reject. A statement whose account is not found waits for the firm.
 * The office owner sets the connections (SFTP host-to-host / e-mail / server folder) and the SSH key for the bank.
 */
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { and, asc, eq } from 'drizzle-orm';
import { isDemoFirm } from '@wise/core/demo';
import { brandCustom } from '@wise/core';
import type { Statement } from '@wise/core/bank-parsers';
import { feedDocs, feedPublicKey, firms, listFeeds } from '@wise/db';
import { Hd } from '@/components/hd';
import { requireUser } from '@/lib/auth';
import { db } from '@/lib/db';
import { isOfficeOwner } from '@/lib/office-owner';
import { FeedList, FeedSettings, type FeedRow } from './client';

export const dynamic = 'force-dynamic';

/** dd.mm.yyyy HH:MM in Skopje time (formatted here so the page hydrates with the same text). */
const skDt = (d: Date) => { const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Skopje', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(d).map((x) => [x.type, x.value])); return `${p.day}.${p.month}.${p.year} ${p.hour}:${p.minute}`; };

const sum = (L: Statement['lines'], sign: 1 | -1) => L.reduce((s, l) => s + (Math.sign(l.amount) === sign ? Math.abs(l.amount) : 0), 0);

export default async function BankFeedPage({ searchParams }: { searchParams: Promise<{ f?: string }> }) {
  const sp = await searchParams;
  const u = await requireUser();
  // the bank connection is the office's own (WISE) server only – not on another installation (Фејкан)
  if (['klient', 'teren', 'view'].includes(u.role) || u.demo || brandCustom()) notFound();
  const own = await isOfficeOwner(u);
  const [docs, feeds, pub, F] = await Promise.all([
    feedDocs(db(), { limit: 300 }), listFeeds(db()), own ? feedPublicKey(db()) : Promise.resolve(''),
    db().select({ id: firms.id, name: firms.name, settings: firms.settings }).from(firms).where(and(eq(firms.active, true))).orderBy(asc(firms.name)),
  ]);
  const firmList = F.filter((f) => !isDemoFirm(f)).map((f) => ({ id: f.id, name: f.name }));
  const rows: FeedRow[] = docs.map((d) => {
    const det = d.detect as { full?: Statement[]; feed?: string; printedAt?: string; problems?: string[] };
    const S = det.full ?? [];
    return {
      id: d.id, at: skDt(d.createdAt), status: d.status, result: d.result ?? '', firmId: d.firmId, firmName: d.firmName,
      fileId: d.fileId, fileName: d.fileName ?? d.what ?? '', feed: det.feed ?? '', printedAt: det.printedAt ?? null, problems: (det.problems ?? []).length > 0,
      st: S.map((s) => ({ no: s.no, date: s.date, account: s.account || s.iban || '', opening: s.opening, closing: s.closing, lines: s.lines.length, inn: sum(s.lines, 1), out: sum(s.lines, -1) })),
    };
  });
  // each firm's statements apart: chips per firm with the count waiting, ?f=<firm> shows only that firm's
  const byName = (a: FeedRow, b: FeedRow) => (a.firmName ?? 'я').localeCompare(b.firmName ?? 'я', 'mk') || b.at.localeCompare(a.at);
  const allWaiting = rows.filter((r) => r.status === 'read').sort(byName);
  const fSel = sp.f === 'none' ? 'none' : sp.f && firmList.some((x) => x.id === sp.f) ? sp.f : '';
  const inF = (r: FeedRow) => !fSel || (fSel === 'none' ? !r.firmId : r.firmId === fSel);
  const waiting = allWaiting.filter(inF);
  const decided = rows.filter((r) => r.status !== 'read' && inF(r)).slice(0, 40);
  const chips = new Map<string, { name: string; n: number }>();
  for (const r of allWaiting) { const k = r.firmId ?? 'none'; const c = chips.get(k) ?? { name: r.firmName ?? '❓ без препознаена фирма', n: 0 }; c.n++; chips.set(k, c); }
  const fName = fSel === 'none' ? 'без препознаена фирма' : fSel ? firmList.find((x) => x.id === fSel)?.name : '';
  return (
    <>
      <Hd t="🏦 Изводи од банка (автоматски)" sub="Изводите што банките ги праќаат секоја вечер – печатење, проверка и книжење со еден клик" exp={false} />
      {!feeds.length && (
        <div className="callout">Сè уште нема поставена врска со банка. {own ? 'Додадете ја подолу кога банката ќе ги испрати техничките податоци (SFTP / е-пошта).' : 'Врските ги поставува сопственикот на канцеларијата.'}</div>
      )}
      {(chips.size > 0 || fSel) && (
        <div className="row" style={{ gap: 6, flexWrap: 'wrap', margin: '0 0 8px', alignItems: 'center' }}>
          <span className="mini">По фирма:</span>
          <Link className={'btn sm' + (fSel ? '' : ' pri')} href="/bankFeed">Сите ({allWaiting.length})</Link>
          {[...chips].sort((a, b) => a[1].name.localeCompare(b[1].name, 'mk')).map(([k, c]) => (
            <Link key={k} className={'btn sm' + (fSel === k ? ' pri' : '')} href={`/bankFeed?f=${k}`}>{c.name} ({c.n})</Link>
          ))}
        </div>
      )}
      {fSel && <div className="callout info" style={{ marginBottom: 8 }}>Само изводите на <b>{fName}</b> · <Link href="/bankFeed">сите фирми</Link></div>}
      <FeedList waiting={waiting} decided={decided} firms={firmList} />
      {own && <FeedSettings feeds={feeds.map((f) => ({ id: f.id, name: f.name, bank: f.bank, method: f.method, host: f.host, port: f.port, username: f.username, path: f.path, pattern: f.pattern, hasPassword: !!f.secret, hold: f.hold, at: f.at, active: f.active, lastRunAt: f.lastRunAt ? skDt(f.lastRunAt) : null, lastOk: f.lastOk, lastResult: f.lastResult }))} pub={pub} />}
    </>
  );
}
