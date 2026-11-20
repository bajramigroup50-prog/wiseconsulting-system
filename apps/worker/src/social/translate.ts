/**
 * 🇦🇱 The website news titles in Albanian: the institutions publish in Macedonian only, so the worker translates each new
 * title once (Haiku) and keeps them in `news-sq.json` next to the site's `news.json` ({ updated, titles: { url: title } }).
 * The website shows them when the visitor picks SQ; `social.web` puts them on the card and in the caption.
 * Reads only the public news file – nothing of the firms.
 */
import { readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { WebNews } from '@wise/core/social/post';
import { AI_MODELS, aiConfigured, aiMessages } from '../ai/client';

/** Translates titles (Macedonian → Albanian), same order and length; throws when the AI is unavailable or answers badly. */
export type TranslateFn = (titles: string[]) => Promise<string[]>;

export interface SqFile { updated: string; titles: Record<string, string> }

const PROMPT = `Translate these news titles of North Macedonian institutions (УЈП, Министерство за финансии, АВРСМ, НБРСМ, …) from Macedonian into standard Albanian, as Albanians in North Macedonia write it. Keep names of people (in Albanian spelling, e.g. Dimitrieska-Koçoska), numbers, dates and form / law codes (ДДВ-04, МПИН, ДБ, …) as they are. Translate the institution names (УЈП = DAP, Министерство за финансии = Ministria e Financave). Answer ONLY with a JSON array of strings, one translation per title, in the same order.`;

/** The AI translation (Haiku). */
export const aiTranslateSq: TranslateFn = async (titles) => {
  if (!titles.length) return [];
  const res = await aiMessages().create({
    model: AI_MODELS.quick,
    max_tokens: 4000,
    messages: [{ role: 'user', content: `${PROMPT}\n\n${JSON.stringify(titles)}` }],
  });
  const text = res.content.map((b) => (b.type === 'text' ? b.text : '')).join('');
  const m = text.match(/\[[\s\S]*\]/);
  const arr = m ? (JSON.parse(m[0]) as unknown) : null;
  if (!Array.isArray(arr) || arr.length !== titles.length || arr.some((x) => typeof x !== 'string' || !x.trim())) {
    throw new Error('the translation did not come back as one title per news item');
  }
  return arr.map((x) => String(x).trim());
};

export const sqFilePath = () => join(dirname(process.env.SITE_NEWS_FILE || '/srv/site-data/news.json'), 'news-sq.json');

export async function readSqFile(path = sqFilePath()): Promise<Record<string, string>> {
  try {
    const j = JSON.parse(await readFile(path, 'utf8')) as Partial<SqFile>;
    return j && typeof j.titles === 'object' && j.titles ? (j.titles as Record<string, string>) : {};
  } catch { return {}; }
}

/** Written atomically (temporary file + rename), like fetch_news.py writes news.json. */
export async function writeSqFile(titles: Record<string, string>, path = sqFilePath()): Promise<void> {
  const tmp = `${path}.tmp`;
  await writeFile(tmp, JSON.stringify({ updated: new Date().toISOString(), titles } satisfies SqFile), 'utf8');
  await rename(tmp, path);
}

/** At most this many titles per run (the site keeps ~5 per institution, so a normal run has a handful). */
export const SQ_MAX_PER_RUN = 40;

/**
 * The titles still missing in `known` are translated (in batches of 20) and added; titles no longer on the site are
 * dropped so the file stays small. Returns the new map and how many were translated.
 */
export async function fillSq(items: readonly WebNews[], known: Record<string, string>, translate: TranslateFn): Promise<{ titles: Record<string, string>; added: number }> {
  const titles: Record<string, string> = {};
  for (const it of items) if (known[it.url]) titles[it.url] = known[it.url]!;
  const missing = items.filter((it) => !titles[it.url]).slice(0, SQ_MAX_PER_RUN);
  let added = 0;
  for (let i = 0; i < missing.length; i += 20) {
    const part = missing.slice(i, i + 20);
    const out = await translate(part.map((it) => it.title));
    part.forEach((it, k) => { titles[it.url] = out[k]!; });
    added += part.length;
  }
  return { titles, added };
}

/** The Albanian title of one item: the file's, else translated now (null when the AI is off or fails – the post goes out in Macedonian). */
export async function titleSqFor(w: WebNews, known: Record<string, string>, translate: TranslateFn | null): Promise<string | null> {
  if (known[w.url]) return known[w.url]!;
  if (!translate) return null;
  try { return (await translate([w.title]))[0] ?? null; } catch { return null; }
}

export const defaultTranslate = (): TranslateFn | null => (aiConfigured() ? aiTranslateSq : null);
