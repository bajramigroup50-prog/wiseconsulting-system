/** Кадровска евиденција records of an employee (`employees.data.hr`), Helix HR codebooks. Pure. */
export const HR_KINDS = [
  'Степен на образование', 'Квалификација / лиценца', 'Странски јазик', 'Инвалидитет', 'Систематски преглед',
  'Семинар / обука', 'Наградна мерка', 'Казнена мерка', 'Друго',
] as const;

export interface HrRec { id: string; kind: string; date: string; title: string; issuer?: string; until?: string; note?: string }

/** The records, newest first. */
export function hrRecs(data: unknown): HrRec[] {
  const L = ((data ?? {}) as { hr?: HrRec[] }).hr;
  return Array.isArray(L) ? [...L].sort((a, b) => b.date.localeCompare(a.date)) : [];
}

/** Records whose „важи до“ is past or within `days` (systematic checks, licences). */
export function hrExpiring(data: unknown, today: string, days = 30): HrRec[] {
  const lim = new Date(Date.parse(today + 'T12:00:00Z') + days * 864e5).toISOString().slice(0, 10);
  /* only the latest record of a kind + title counts (a new check replaces the old one) */
  const last = new Map<string, HrRec>();
  for (const r of hrRecs(data).reverse()) last.set(r.kind + '|' + (r.kind === 'Систематски преглед' ? '' : r.title.toLowerCase()), r);
  return [...last.values()].filter((r) => r.until && r.until <= lim);
}
