/**
 * ⚖ Правен асистент — the stored law corpus, kept by the law robot (free: no AI, plain text parsing).
 *
 * For every key law with an official source (`LAW_CORPUS[].src`, ujp.gov.mk regulation pages) the robot reads the
 * listing page, finds the link of the consolidated text („пречистен текст“ preferred), follows a description page to
 * its attachment, downloads the PDF / HTML, extracts the text, segments it into articles (`segmentArticles`) and
 * stores it as a new version when the text changed (`storeLawText`, deduped by hash). The version date comes from
 * the title / file name (UJP names the files „…30.12.2025.pdf“), else the fetch date; the source URL and the fetch
 * time are stored with it. Weekly from the daily robot run, or on demand (`law.texts`, „🔄 Синхронизирај текстови“).
 * The office can also give the official URL of a law that has no robot source (`{ law, url }`).
 */
import { gazetteRefs, LAW_BY_KEY, LAW_CORPUS, lawKey, lawLinks, lawOfficialUrl, lawPageText, lawTextDate, type LawCorpusEntry } from '@wise/core/law';
import { lineText, pdfLines } from '@wise/core/noai/pdf-lines';
import { todaySkopje } from '@wise/core/office';
import { autoOn, lawTextSync, noteAutoRun, storeLawText, type Tx } from '@wise/db';
import { defineJob } from '../job';
import { pdfTextItems } from '../ai/pdf-text';
import { fetchPage, type Fetcher } from './law';

export interface FetchedDoc { bytes: Uint8Array; type: string }
export type BinFetcher = (url: string) => Promise<FetchedDoc>;

/** Download a document (PDF / HTML), 60 s timeout, at most 30 MB. */
export const fetchDoc: BinFetcher = async (url) => {
  const r = await fetch(url, { signal: AbortSignal.timeout(60_000), headers: { 'user-agent': 'Mozilla/5.0 (WISE law robot)', accept: 'application/pdf,text/html,*/*;q=0.5' } });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const b = new Uint8Array(await r.arrayBuffer());
  if (b.length > 30 * 1024 * 1024) throw new Error('документот е преголем');
  return { bytes: b, type: r.headers.get('content-type') ?? '' };
};

const isPdf = (d: FetchedDoc) => /pdf/i.test(d.type) || (d.bytes[0] === 0x25 && d.bytes[1] === 0x50 && d.bytes[2] === 0x44 && d.bytes[3] === 0x46);

/** Text of a downloaded document: PDF text layer as lines (scans give nothing), HTML as plain text. */
export async function docText(d: FetchedDoc): Promise<string> {
  if (isPdf(d)) {
    const L = pdfLines(await pdfTextItems(d.bytes, 800));
    return L.map((l) => lineText(l).replace(/\s{2,}/g, ' ').trim()).join('\n');
  }
  return lawPageText(new TextDecoder('utf-8').decode(d.bytes), 5_000_000);
}

const DOC = /\.pdf($|\?)|\/files\/attachment\//i;

/** Find the consolidated text's document URL of a law on its official listing page(s). */
export async function findLawDoc(l: LawCorpusEntry, fetcher: Fetcher): Promise<{ url: string; title: string } | null> {
  for (const s of l.src) {
    const links = lawLinks(await fetcher(s.url), s.url).filter((x) => s.pick.test(x.text) || s.pick.test(decodeURIComponent(x.url)));
    // „пречистен текст“ first, documents before description pages
    links.sort((a, b) => Number(/пречистен/i.test(b.text)) - Number(/пречистен/i.test(a.text)) || Number(DOC.test(b.url)) - Number(DOC.test(a.url)));
    for (const x of links.slice(0, 4)) {
      if (DOC.test(x.url)) return { url: x.url, title: x.text };
      const inner = lawLinks(await fetcher(x.url), x.url).filter((y) => DOC.test(y.url));
      inner.sort((a, b) => Number(/пречистен/i.test(b.text)) - Number(/пречистен/i.test(a.text)) || Number(s.pick.test(b.text)) - Number(s.pick.test(a.text)));
      if (inner[0]) return { url: inner[0].url, title: x.text || inner[0].text };
    }
  }
  return null;
}

export interface LawTextsResult { checked: number; stored: number; unchanged: number; errors: string[] }

/** Fetch and store one law's text from a document URL. */
export async function importLawFromUrl(db: Tx, law: string, url: string, o: { title?: string; bin?: BinFetcher; userId?: string | null; source?: 'robot' | 'link'; today?: string } = {}) {
  const L = LAW_BY_KEY[law];
  if (!L) throw new Error('Непознат закон.');
  if (!lawOfficialUrl(url)) throw new Error('Дозволени се само официјални извори (gov.mk, slvesnik.com.mk, sobranie.mk, …).');
  const doc = await (o.bin ?? fetchDoc)(url);
  const text = await docText(doc);
  if (text.replace(/\s/g, '').length < 200) throw new Error('Документот нема текст (скениран PDF?) – внесете го текстот рачно.');
  const title = o.title?.trim() || L.n;
  return storeLawText(db, {
    law, title, text, sourceUrl: url, asOf: lawTextDate(title, url, text.slice(0, 1500)) ?? o.today ?? todaySkopje(), gazette: gazetteRefs(text.slice(0, 5000)),
    source: o.source ?? 'link', userId: o.userId ?? null,
  });
}

/** The robot's step: every law with an official source. A failing law is recorded and does not stop the others. */
export async function syncLawTexts(db: Tx, o: { fetcher?: Fetcher; bin?: BinFetcher; laws?: readonly string[]; today?: string; log?: (m: string) => void } = {}): Promise<LawTextsResult> {
  const fetcher = o.fetcher ?? fetchPage, log = o.log ?? (() => {});
  const res: LawTextsResult = { checked: 0, stored: 0, unchanged: 0, errors: [] };
  for (const l of LAW_CORPUS.filter((x) => x.src.length && (!o.laws || o.laws.includes(x.k)))) {
    res.checked++;
    const now = new Date();
    try {
      const d = await findLawDoc(l, fetcher);
      if (!d) throw new Error('текстот не е најден на официјалната страница');
      const r = await importLawFromUrl(db, l.k, d.url, { title: d.title, bin: o.bin, source: 'robot', today: o.today });
      if (r.isNew) res.stored++; else res.unchanged++;
      await db.insert(lawTextSync).values({ law: l.k, url: d.url, checkedAt: now, changedAt: r.isNew ? now : null, error: null })
        .onConflictDoUpdate({ target: lawTextSync.law, set: { url: d.url, checkedAt: now, ...(r.isNew ? { changedAt: now } : {}), error: null } });
      log(`${l.abbr}: ${r.isNew ? `нова верзија (${r.articles} членови)` : 'без промена'} – ${lawKey(d.url)}`);
    } catch (e) {
      const m = `${l.abbr}: ${(e as Error).message || e}`;
      res.errors.push(m);
      log(m);
      await db.insert(lawTextSync).values({ law: l.k, checkedAt: now, error: m }).onConflictDoUpdate({ target: lawTextSync.law, set: { checkedAt: now, error: m } });
    }
  }
  return res;
}

/** Weekly: true when no law text was checked in the last 7 days. */
export async function lawTextsDue(db: Tx, now = new Date()): Promise<boolean> {
  const S = await db.select({ at: lawTextSync.checkedAt }).from(lawTextSync);
  const last = Math.max(0, ...S.map((s) => s.at?.getTime() ?? 0));
  return now.getTime() - last > 7 * 864e5;
}

export const lawTexts = defineJob<{ law?: string; url?: string; title?: string; userId?: string | null }>({
  name: 'law.texts',
  async run(data, ctx) {
    if (data?.law && data.url) {
      const now = new Date();
      try {
        const r = await importLawFromUrl(ctx.db, data.law, data.url, { title: data.title, userId: data.userId ?? null, source: 'link' });
        await ctx.db.insert(lawTextSync).values({ law: data.law, url: data.url, checkedAt: now, changedAt: r.isNew ? now : null, error: null })
          .onConflictDoUpdate({ target: lawTextSync.law, set: { url: data.url, checkedAt: now, ...(r.isNew ? { changedAt: now } : {}), error: null } });
        ctx.log(`${data.law}: ${r.isNew ? 'stored' : 'unchanged'} (${r.articles} articles)`);
      } catch (e) {
        const m = `${LAW_BY_KEY[data.law]?.abbr ?? data.law}: ${(e as Error).message || e}`;
        await ctx.db.insert(lawTextSync).values({ law: data.law, url: data.url, checkedAt: now, error: m }).onConflictDoUpdate({ target: lawTextSync.law, set: { url: data.url, checkedAt: now, error: m } });
        throw e;
      }
      return;
    }
    const r = await syncLawTexts(ctx.db, { log: ctx.log, laws: data?.law ? [data.law] : undefined });
    ctx.log(`law texts: checked ${r.checked}, new ${r.stored}, unchanged ${r.unchanged}, errors ${r.errors.length}`);
  },
});

/**
 * Used by the daily robot: weekly, while the office switch „Текстови на законите“ is on (P43, on by default — the
 * behaviour before the switch existed); the run is recorded for the status line.
 */
export async function weeklyLawTexts(db: Tx, log: (m: string) => void): Promise<LawTextsResult | null> {
  if (!(await autoOn(db, 'lawTexts'))) return null;
  if (!(await lawTextsDue(db))) return null;
  const r = await syncLawTexts(db, { log });
  await noteAutoRun(db, 'lawTexts', `проверени ${r.checked} закони · нови верзии ${r.stored}${r.errors.length ? ` · недостапни ${r.errors.length}` : ''}`, { stored: r.stored });
  return r;
}
