/**
 * „🏦 Изводи од банка (автоматски)“ — the statements the bank connections bring every evening (worker `bank.feeds`),
 * waiting for the office: 👁 the original, 🖨 print (one or all at once, for the paper archive), ✓ approve and book
 * (THE existing import into the bank nalog), ✕ reject. A statement whose account is not found waits for the firm.
 * The office owner sets the connections (SFTP host-to-host / e-mail / server folder) and the SSH key for the bank.
 */
import { notFound } from 'next/navigation';
import { and, asc, eq } from 'drizzle-orm';
import { isDemoFirm } from '@wise/core/demo';
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

export default async function BankFeedPage() {
  const u = await requireUser();
  if (['klient', 'teren', 'view'].includes(u.role) || u.demo) notFound();
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
  const waiting = rows.filter((r) => r.status === 'read');
  const decided = rows.filter((r) => r.status !== 'read').slice(0, 40);
  return (
    <>
      <Hd t="🏦 Изводи од банка (автоматски)" sub="Изводите што банките ги праќаат секоја вечер – печатење, проверка и книжење со еден клик" exp={false} />
      {!feeds.length && (
        <div className="callout">Сè уште нема поставена врска со банка. {own ? 'Додадете ја подолу кога банката ќе ги испрати техничките податоци (SFTP / е-пошта).' : 'Врските ги поставува сопственикот на канцеларијата.'}</div>
      )}
      <FeedList waiting={waiting} decided={decided} firms={firmList} />
      {own && <FeedSettings feeds={feeds.map((f) => ({ id: f.id, name: f.name, bank: f.bank, method: f.method, host: f.host, port: f.port, username: f.username, path: f.path, pattern: f.pattern, hasPassword: !!f.secret, hold: f.hold, at: f.at, active: f.active, lastRunAt: f.lastRunAt ? skDt(f.lastRunAt) : null, lastOk: f.lastOk, lastResult: f.lastResult }))} pub={pub} />}
    </>
  );
}
