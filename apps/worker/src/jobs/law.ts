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
import { get as httpsGet } from 'node:https';
import { rootCertificates } from 'node:tls';
import { desc, eq } from 'drizzle-orm';
import { LAW_SOURCES, lawAskPrompt, lawLinks, lawMailHtml, lawNewLinks, lawNorm, lawPageText, lawRaw, lawRobotPrompt, type LawEntry, type LawSource } from '@wise/core/law';
import { todaySkopje } from '@wise/core/office';
import { firstMailAddress, getAiBudget, getOfficeProfile, lawAsks, lawChanges, lawRuns, lawSources, queueMailRow, type Tx } from '@wise/db';
import { defineJob } from '../job';
import { askText } from '../ai/ask';
import { aiConfigured } from '../ai/client';
import { readContent } from '../ai/read-document';
import { AiBudgetError } from '../ai/budget';
import { sendQueuedMail } from './reminders';
import { weeklyLawTexts } from './law-texts';
import { LAW_EXTRA_CA } from './law-ca';

export type Fetcher = (url: string) => Promise<string>;

const UA = { 'user-agent': 'Mozilla/5.0 (WISE law robot)', accept: 'text/html,*/*;q=0.5' };
/** TLS errors of a site that sends an incomplete certificate chain (only the leaf). */
const CHAIN_ERR = /UNABLE_TO_VERIFY_LEAF_SIGNATURE|UNABLE_TO_GET_ISSUER_CERT_LOCALLY/;
const errCode = (e: unknown) => String((e as { cause?: { code?: string } }).cause?.code ?? (e as { code?: string }).code ?? '');

/** HTTPS GET with Node's roots plus `LAW_EXTRA_CA` (missing intermediates), following up to 5 redirects. */
function getWithExtraCa(url: string, left = 5): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = httpsGet(url, { headers: UA, ca: [...rootCertificates, ...LAW_EXTRA_CA], timeout: 30_000 }, (res) => {
      const st = res.statusCode ?? 0;
      if (st >= 300 && st < 400 && res.headers.location) {
        res.resume();
        if (left <= 0) return reject(new Error('too many redirects'));
        return resolve(getWithExtraCa(new URL(res.headers.location, url).toString(), left - 1));
      }
      if (st < 200 || st >= 300) { res.resume(); return reject(new Error(`HTTP ${st}`)); }
      const ct = String(res.headers['content-type'] ?? '');
      if (ct && !/html|text/i.test(ct)) { res.resume(); return resolve(''); }
      res.setEncoding('utf8');
      let body = '';
      res.on('data', (c: string) => { body += c; });
      res.on('end', () => resolve(body));
      res.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
  });
}

/** One try: 30 s timeout, HTML only; an incomplete certificate chain is retried with the bundled intermediates. */
async function fetchOnce(url: string): Promise<string> {
  let r: Response;
  try {
    r = await fetch(url, { signal: AbortSignal.timeout(30_000), headers: UA });
  } catch (e) {
    if (CHAIN_ERR.test(errCode(e))) return await getWithExtraCa(url);
    throw e;
  }
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const ct = r.headers.get('content-type') ?? '';
  if (ct && !/html|text/i.test(ct)) return '';
  return await r.text();
}

/** Default page fetch: up to 3 tries (wait 5 s, then 15 s) when the site answers 5xx / 429 or the network fails. */
export const fetchPage: Fetcher = async (url) => {
  const waits = [5_000, 15_000];
  for (let i = 0; ; i++) {
    try { return await fetchOnce(url); } catch (e) {
      const m = (e as Error).message;
      const retry = /^HTTP (5\d\d|429)$/.test(m) || !/^HTTP /.test(m);
      if (!retry || i >= waits.length) throw e;
      await new Promise((r) => setTimeout(r, waits[i]));
    }
  }
};

const MAX_NEW = 15, MAX_PAGES = 10;

async function entriesFor(db: Tx, src: LawSource, fresh: { url: string; text: string }[], today: string, fetcher: Fetcher, log: (m: string) => void, runId: string, ai: boolean): Promise<LawEntry[]> {
  // without AI (the default for the automatic run — owner opt-in `aiBudget.autoLawAi`): the new links are stored as
  // entries „⚠ да се потврди“; AI only describes / filters them
  if (!ai || !aiConfigured()) return lawRaw(src, fresh, today);
  const items = [];
  for (const [i, l] of fresh.entries()) {
    let page = '';
    if (i < MAX_PAGES && !/\.pdf($|\?)/i.test(l.url)) { try { page = lawPageText(await fetcher(l.url), 6000); } catch (e) { log(`${l.url}: ${(e as Error).message}`); } }
    items.push({ ...l, page });
  }
  try {
    const r = await readContent<unknown>({ db, firmId: null, prompt: lawRobotPrompt(src, items, today), tier: 'default', purpose: 'law', refId: runId, maxTokens: 8000 }, { blocks: [], extra: '' });
    return lawNorm(r.data, src, fresh, today);
  } catch (e) {
    // monthly AI limit reached: the free entries instead of losing the new links
    if (e instanceof AiBudgetError) { log(e.message); return lawRaw(src, fresh, today); }
    throw e;
  }
}

export interface LawRobotResult { sources: number; found: number; added: number; errors: string[]; mailIds: string[] }

export async function runLawRobot(db: Tx, o: { today?: string; fetcher?: Fetcher; log?: (m: string) => void; sources?: readonly LawSource[]; ai?: boolean } = {}): Promise<LawRobotResult> {
  const today = o.today ?? todaySkopje(), fetcher = o.fetcher ?? fetchPage, log = o.log ?? (() => {});
  const ai = o.ai ?? true;
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
      if (fresh.length) E = await entriesFor(db, src, fresh, today, fetcher, log, run!.id, ai);
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

/**
 * Whether a robot run may use AI (owner policy: no automatic AI). The daily cron and the dashboard's first check use
 * AI only when the owner switched on „🤖 AI за роботот за закони“ (`aiBudget.autoLawAi`, 💲 AI трошок); „▶ Провери
 * сега“ is free; „🤖 Провери со AI“ (`{ manual: true, ai: true }`) uses AI on the user's click.
 */
export async function lawRobotUsesAi(db: Tx, data: { manual?: boolean; ai?: boolean } | null | undefined): Promise<boolean> {
  if (data?.ai === true) return true;
  if (data?.manual === true) return false;
  return (await getAiBudget(db)).autoLawAi;
}

export const lawRobot = defineJob<{ today?: string; manual?: boolean; ai?: boolean }>({
  name: 'law.robot',
  cron: '52 6 * * *',
  async run(data, ctx) {
    const r = await runLawRobot(ctx.db, { today: data?.today, log: ctx.log, ai: await lawRobotUsesAi(ctx.db, data) });
    await sendQueuedMail(ctx, r.mailIds);
    ctx.log(`sources ${r.sources}, new links ${r.found}, added ${r.added}, errors ${r.errors.length}`);
    // ⚖ Правен асистент: the consolidated texts of the key laws, weekly (free text parsing, no AI)
    try {
      const t = await weeklyLawTexts(ctx.db, ctx.log);
      if (t) ctx.log(`law texts: checked ${t.checked}, new ${t.stored}, unchanged ${t.unchanged}, errors ${t.errors.length}`);
    } catch (e) { ctx.log(`law texts: ${(e as Error).message}`); }
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
