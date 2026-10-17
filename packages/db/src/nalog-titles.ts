/**
 * User-given names of nalozi („✎ Назив“ in Налози за книжење): `firms.settings.nalTitles = { "<year>": { "<number>": "ДДВ 01-03" } }`.
 * The name only replaces the automatic title (NAL_DEF label / ИЗВОДИ <bank> / description) — amounts never change, so it may
 * be set also in a locked period; every change is audited (`nalTitle`).
 */
import { and, eq, sql } from 'drizzle-orm';
import { audit, type Tx } from './audit';
import { firms, journals } from './schema/index';

export type NalTitles = Record<string, Record<string, string>>;
export const NAL_TITLE_MAX = 120;

/** All user names of one year: number → name. */
export function nalTitlesOf(settings: unknown, year: number | string): Record<string, string> {
  const all = ((settings ?? {}) as { nalTitles?: unknown }).nalTitles;
  const y = all && typeof all === 'object' ? (all as Record<string, unknown>)[String(year)] : undefined;
  if (!y || typeof y !== 'object') return {};
  return Object.fromEntries(Object.entries(y as Record<string, unknown>).filter((e): e is [string, string] => typeof e[1] === 'string' && !!e[1].trim()));
}

/** The user name of nalog `number` in `year`, or null (→ automatic title). */
export const nalTitleOf = (settings: unknown, year: number | string, number: string): string | null => nalTitlesOf(settings, year)[number] ?? null;

/** Settings with the name of one nalog set (empty title = removed). Pure. */
export function withNalTitle(settings: unknown, year: number | string, number: string, title: string): Record<string, unknown> {
  const s = { ...((settings ?? {}) as Record<string, unknown>) };
  const all: NalTitles = { ...((s.nalTitles && typeof s.nalTitles === 'object' ? s.nalTitles : {}) as NalTitles) };
  const y = { ...(all[String(year)] ?? {}) };
  const t = title.replace(/\s+/g, ' ').trim().slice(0, NAL_TITLE_MAX);
  if (t) y[number] = t; else delete y[number];
  if (Object.keys(y).length) all[String(year)] = y; else delete all[String(year)];
  s.nalTitles = all;
  return s;
}

export class NalTitleError extends Error {}

/** Set (or clear with an empty title) the name of a nalog of the year. The nalog must exist. Audited. */
export async function setNalogTitle(tx: Tx, a: { firmId: string; userId: string | null; year: number; number: string; title: string }): Promise<{ title: string | null }> {
  const no = a.number.trim();
  if (!no) throw new NalTitleError('Нема број на налог.');
  const [j] = await tx.select({ id: journals.id }).from(journals)
    .where(and(eq(journals.firmId, a.firmId), eq(journals.number, no), sql`${journals.date} between ${`${a.year}-01-01`} and ${`${a.year}-12-31`}`)).limit(1);
  if (!j) throw new NalTitleError(`Налогот ${no} не постои за ${a.year}.`);
  const [f] = await tx.select({ settings: firms.settings }).from(firms).where(eq(firms.id, a.firmId)).for('update').limit(1);
  if (!f) throw new NalTitleError('Фирмата не постои.');
  const from = nalTitleOf(f.settings, a.year, no);
  const s = withNalTitle(f.settings, a.year, no, a.title);
  const to = nalTitleOf(s, a.year, no);
  if (from === to) return { title: to };
  await tx.update(firms).set({ settings: s }).where(eq(firms.id, a.firmId));
  await audit(tx, { userId: a.userId, firmId: a.firmId, action: 'nalTitle', entityType: 'nalog', entityId: `${a.year}:${no}`, data: { year: a.year, number: no, from, to } });
  return { title: to };
}
