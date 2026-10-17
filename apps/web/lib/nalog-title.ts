/**
 * Title of a nalog everywhere it shows (list, opened nalog, print, exports): the user's „✎ Назив“
 * (`firms.settings.nalTitles[year][number]`) or else the automatic one — legacy `nalogMap` label: the NAL_DEF title of
 * a ranged number (2/4-6 → ВЛЕЗНИ ФАКТУРИ), bank series → ИЗВОДИ <bank>, a collective sale nalog → its header, else the
 * journal's description.
 */
import { bankNalCode, NAL_DEF, nalCode, type NalDefKey, type NalogSettings } from '@wise/core';
import { nalTitlesOf } from '@wise/db';

export type TitleJournal = { description: string | null; sourceId: string | null; meta: unknown };
export type TitleGroup = { no: string; journals: readonly TitleJournal[] };

/** Header row of a collective sale nalog opened with „+ Креирај налог“ in the invoice editor (`sales/invoice-nalog.ts`). */
export const collectiveHead = <J extends TitleJournal>(journals: readonly J[]): J | undefined =>
  journals.find((j) => !j.sourceId && ((j.meta ?? {}) as { collective?: unknown }).collective != null);

export function nalogTitler(o: { settings: unknown; year: number; nal: NalogSettings; banks: readonly { id: string; name: string }[] }) {
  const custom = nalTitlesOf(o.settings, o.year);
  const codeTitle = new Map<string, string>([
    ...(Object.keys(NAL_DEF) as NalDefKey[]).map((k) => [nalCode(k, o.nal), NAL_DEF[k][1]] as [string, string]),
    ...o.banks.map((b) => [bankNalCode(b.id, o.nal.banks), 'ИЗВОДИ ' + b.name.toUpperCase()] as [string, string]),
  ]);
  const auto = (g: TitleGroup): string => {
    const h = collectiveHead(g.journals);
    if (h) return h.description ?? '';
    if (g.journals.length === 1) return g.journals[0]!.description ?? '';
    const c = g.no.includes('/') ? g.no.split('/')[0]! : '';
    return codeTitle.get(c) ?? `${g.journals[0]?.description ?? ''} (+${g.journals.length - 1})`;
  };
  return {
    /** The user's name of nalog `no`, or null. */
    custom: (no: string): string | null => custom[no] ?? null,
    auto,
    title: (g: TitleGroup): string => custom[g.no] ?? auto(g),
  };
}
