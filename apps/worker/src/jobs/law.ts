/**
 * ⚖️ Законски промени — the daily law robot (`law.robot`, 06:52 Europe/Skopje like the legacy robot's text) and the law
 * assistant (`law.ask`, legacy `ACT.lawAsk`).
 *
 * Robot: for every watched page (`LAW_SOURCES`: УЈП announcements and regulations, Службен весник free issues) fetch the
 * HTML, find item links that were not there at the previous check, read those item pages, let the model keep and
 * describe the law changes (`lawRobotPrompt` → `lawNorm`), store them in `law_changes` (deduped by URL) and e-mail the
 * office when something new was added. The first check of a page only stores its links (baseline). Without an API key
 * the new links are stored as entries „⚠ да се потврди“. A failing page is recorded on `law_sources.error` and does not
 * stop the others.
 */
import { desc, eq } from 'drizzle-orm';
import { LAW_SOURCES, lawAskPrompt, lawLinks, lawMailHtml, lawNewLinks, lawNorm, lawPageText, lawRaw, lawRobotPrompt, type LawEntry, type LawSource } from '@wise/core/law';
import { todaySkopje } from '@wise/core/office';
import { firstMailAddress, getOfficeProfile, lawAsks, lawChanges, lawRuns, lawSources, queueMailRow, type Tx } from '@wise/db';
import { defineJob } from '../job';
import { askText } from '../ai/ask';
import { aiConfigured } from '../ai/client';
import { readContent } from '../ai/read-document';
import { sendQueuedMail } from './reminders';

export type Fetcher = (url: string) => Promise<string>;

/** Default page fetch: 30 s timeout, HTML only. */
export const fetchPage: Fetcher = async (url) => {
  const r = await fetch(url, { signal: AbortSignal.timeout(30_000), headers: { 'user-agent': 'Mozilla/5.0 (WISE law robot)', accept: 'text/html,*/*;q=0.5' } });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const ct = r.headers.get('content-type') ?? '';
  if (ct && !/html|text/i.test(ct)) return '';
  return await r.text();
};

const MAX_NEW = 15, MAX_PAGES = 10;

async function entriesFor(db: Tx, src: LawSource, fresh: { url: string; text: string }[], today: string, fetcher: Fetcher, log: (m: string) => void, runId: string): Promise<LawEntry[]> {
  if (!aiConfigured()) return lawRaw(src, fresh, today);
  const items = [];
  for (const [i, l] of fresh.entries()) {
    let page = '';
    if (i < MAX_PAGES && !/\.pdf($|\?)/i.test(l.url)) { try { page = lawPageText(await fetcher(l.url), 6000); } catch (e) { log(`${l.url}: ${(e as Error).message}`); } }
    items.push({ ...l, page });
  }
  const r = await readContent<unknown>({ db, firmId: null, prompt: lawRobotPrompt(src, items, today), tier: 'default', purpose: 'law', refId: runId, maxTokens: 8000 }, { blocks: [], extra: '' });
  return lawNorm(r.data, src, fresh, today);
}

export interface LawRobotResult { sources: number; found: number; added: number; errors: string[]; mailIds: string[] }

export async function runLawRobot(db: Tx, o: { today?: string; fetcher?: Fetcher; log?: (m: string) => void; sources?: readonly LawSource[] } = {}): Promise<LawRobotResult> {
  const today = o.today ?? todaySkopje(), fetcher = o.fetcher ?? fetchPage, log = o.log ?? (() => {});
  const [run] = await db.insert(lawRuns).values({}).returning({ id: lawRuns.id });
  const errors: string[] = [];
  const added: LawEntry[] = [];
  let found = 0, n = 0;
  for (const src of o.sources ?? LAW_SOURCES) {
    n++;
    const [st] = await db.select().from(lawSources).where(eq(lawSources.url, src.url)).limit(1);
    try {
      const links = lawLinks(await fetcher(src.url), src.url);
      const { items, fresh: all } = lawNewLinks(src, links, st ? st.links : null);
      const fresh = all.slice(0, MAX_NEW);
      found += fresh.length;
      let E: LawEntry[] = [];
      if (fresh.length) E = await entriesFor(db, src, fresh, today, fetcher, log, run!.id);
      for (const e of E) {
        const [x] = await db.insert(lawChanges).values({ ...e, source: 'robot' }).onConflictDoNothing({ target: lawChanges.key }).returning({ id: lawChanges.id });
        if (x) added.push(e);
      }
      const keep = [...new Set([...items.map((l) => l.url), ...(st?.links ?? [])])].slice(0, 3000);
      const now = new Date();
      await db.insert(lawSources).values({ url: src.url, inst: src.inst, name: src.name, links: keep, checkedAt: now, changedAt: fresh.length ? now : null, error: null })
        .onConflictDoUpdate({ target: lawSources.url, set: { inst: src.inst, name: src.name, links: keep, checkedAt: now, ...(fresh.length ? { changedAt: now } : {}), error: null } });
      log(`${src.name}: ${items.length} items, ${fresh.length} new, ${E.length} relevant`);
    } catch (e) {
      const m = `${src.name}: ${(e as Error).message || e}`;
      errors.push(m);
      log(m);
      await db.insert(lawSources).values({ url: src.url, inst: src.inst, name: src.name, links: st?.links ?? [], checkedAt: new Date(), error: m })
        .onConflictDoUpdate({ target: lawSources.url, set: { checkedAt: new Date(), error: m } });
    }
  }
  const mailIds: string[] = [];
  if (added.length) {
    const O = await getOfficeProfile(db);
    const to = firstMailAddress(O.email);
    if (to) {
      const m = lawMailHtml(added, process.env.APP_URL ?? (process.env.DOMAIN ? `https://${process.env.DOMAIN}` : ''));
      mailIds.push(await queueMailRow(db, { firmId: null, to, subject: m.subject, html: m.html, entityType: 'law_run', entityId: run!.id, userId: null }));
    }
  }
  await db.update(lawRuns).set({ finishedAt: new Date(), sources: n, found, added: added.length, errors }).where(eq(lawRuns.id, run!.id));
  return { sources: n, found, added: added.length, errors, mailIds };
}

export const lawRobot = defineJob<{ today?: string }>({
  name: 'law.robot',
  cron: '52 6 * * *',
  async run(data, ctx) {
    const r = await runLawRobot(ctx.db, { today: data?.today, log: ctx.log });
    await sendQueuedMail(ctx, r.mailIds);
    ctx.log(`sources ${r.sources}, new links ${r.found}, added ${r.added}, errors ${r.errors.length}`);
  },
});

/** Answer one question (legacy `ACT.lawAsk`): the newest 80 records are the context. */
export async function runLawAsk(db: Tx, id: string, today = todaySkopje()): Promise<void> {
  const [q] = await db.select().from(lawAsks).where(eq(lawAsks.id, id)).limit(1);
  if (!q || q.status !== 'queued') return;
  try {
    if (!aiConfigured()) throw new Error('AI не е достапен: на серверот не е поставен ANTHROPIC_API_KEY.');
    const L = await db.select().from(lawChanges).orderBy(desc(lawChanges.date), desc(lawChanges.createdAt)).limit(80);
    const r = await askText({ db, prompt: lawAskPrompt(L.map((x) => ({ ...x, at: x.createdAt.toISOString() })), q.question, today), purpose: 'lawAsk', refId: id, userId: q.userId });
    await db.update(lawAsks).set({ status: 'done', answer: r.text, error: null }).where(eq(lawAsks.id, id));
  } catch (e) {
    await db.update(lawAsks).set({ status: 'error', error: (e as Error).message || String(e) }).where(eq(lawAsks.id, id));
  }
}

export const lawAsk = defineJob<{ id: string }>({
  name: 'law.ask',
  async run(data, { db }) {
    if (data?.id) await runLawAsk(db, data.id);
  },
});
