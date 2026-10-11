/**
 * Sequential numbering of issued invoices (ЗДДВ — „реден број … со кој фактурата еднозначно се идентификува“).
 * Numbers run per document kind (invoice / credit note), per series (the non-digit prefix: `F-`, `ПРО-`, empty) and
 * per calendar year, without gaps, duplicates or going back in time.
 *
 * A number is "used" also by a cancelled (сторнирана) invoice — cancellation keeps the number, which is exactly why
 * an issued invoice is cancelled instead of deleted.
 */

export interface NumberedDoc {
  number: string;
  date: string;
  kind?: string;
  /** Cancelled documents still occupy their number. */
  cancelled?: boolean;
}

export interface NumberingIssue {
  code: 'gap' | 'duplicate' | 'order' | 'unparsable';
  series: string;
  kind: string;
  year: string;
  text: string;
  numbers: string[];
}

/** `F-0012/2026` → { series: 'F-', n: 12 }; null when there is no number at all. */
export function parseDocNumber(no: string): { series: string; n: number } | null {
  const m = /^(\D*)(\d+)/.exec(String(no ?? '').trim());
  return m ? { series: m[1]!.trim().toUpperCase(), n: Number(m[2]) } : null;
}

const dmy = (d: string) => d.slice(0, 10).split('-').reverse().join('.');

/** Gaps, duplicates and chronology breaks per kind / series in `year`. */
export function numberingIssues(docs: readonly NumberedDoc[], year: string | number): NumberingIssue[] {
  const y = String(year);
  const groups = new Map<string, { kind: string; series: string; L: { n: number; d: NumberedDoc }[] }>();
  const out: NumberingIssue[] = [];
  for (const d of docs) {
    if (!d.date.startsWith(y)) continue;
    const kind = d.kind ?? 'invoice';
    const p = parseDocNumber(d.number);
    if (!p) { out.push({ code: 'unparsable', series: '', kind, year: y, text: `Документ без реден број (${dmy(d.date)}).`, numbers: [d.number] }); continue; }
    const k = `${kind}|${p.series}`;
    const g = groups.get(k) ?? { kind, series: p.series, L: [] };
    g.L.push({ n: p.n, d });
    groups.set(k, g);
  }
  for (const g of groups.values()) {
    const L = [...g.L].sort((a, b) => a.n - b.n || a.d.date.localeCompare(b.d.date));
    const label = `${g.kind === 'credit' ? 'Одобренија' : 'Фактури'}${g.series ? ` (серија ${g.series})` : ''}`;
    const dup = new Map<number, string[]>();
    for (const x of L) dup.set(x.n, [...(dup.get(x.n) ?? []), x.d.number]);
    const D = [...dup].filter(([, v]) => v.length > 1);
    if (D.length) out.push({ code: 'duplicate', series: g.series, kind: g.kind, year: y, text: `${label}: ист реден број повеќе пати – ${D.map(([n]) => n).join(', ')}.`, numbers: D.flatMap(([, v]) => v) });
    const u = [...new Set(L.map((x) => x.n))];
    const miss: number[] = [];
    for (let i = 1; i < u.length; i++) for (let n = u[i - 1]! + 1; n < u[i]! && miss.length < 50; n++) miss.push(n);
    // numbering starts at 1 each year (unless the series is continued from another program — then confirm by hand)
    const startsAt = u[0] ?? 1;
    if (miss.length) out.push({ code: 'gap', series: g.series, kind: g.kind, year: y, text: `${label}: прескокнати броеви ${miss.slice(0, 20).join(', ')}${miss.length > 20 ? ' …' : ''}.`, numbers: miss.map(String) });
    if (startsAt > 1) out.push({ code: 'gap', series: g.series, kind: g.kind, year: y, text: `${label}: првиот број во ${y} е ${startsAt} (броевите 1–${startsAt - 1} ги нема во програмата – потврдете дека се издадени во друга програма).`, numbers: [] });
    // chronology: a higher number must not carry an earlier date
    const back: string[] = [];
    let maxD = '', maxNo = '';
    for (const x of L) {
      if (maxD && x.d.date < maxD) back.push(`${x.d.number} (${dmy(x.d.date)}) по ${maxNo} (${dmy(maxD)})`);
      if (x.d.date > maxD) { maxD = x.d.date; maxNo = x.d.number; }
    }
    if (back.length) out.push({ code: 'order', series: g.series, kind: g.kind, year: y, text: `${label}: повисок број со постар датум – ${back.slice(0, 5).join('; ')}${back.length > 5 ? ' …' : ''}.`, numbers: back });
  }
  return out;
}

/**
 * Would issuing `proposed` on `date` break the sequence of the existing numbers of its series?
 * Returns a warning text, or null when it is the next number (or the series is new and starts at 1).
 */
export function numberGapWarning(existing: readonly NumberedDoc[], proposed: string, date: string): string | null {
  const p = parseDocNumber(proposed);
  if (!p) return 'Фактурата нема реден број.';
  const same = existing.map((d) => ({ d, x: parseDocNumber(d.number) })).filter((r) => r.x && r.x.series === p.series && r.d.date.slice(0, 4) === date.slice(0, 4));
  const max = same.reduce((m, r) => Math.max(m, r.x!.n), 0);
  if (p.n > max + 1) return `Бројот ${proposed} прескокнува ${p.n - max - 1 === 1 ? `број ${max + 1}` : `броеви ${max + 1}–${p.n - 1}`} – фактурите мора да се по ред без прескокнување (ЗДДВ).`;
  const later = same.filter((r) => r.x!.n < p.n && r.d.date > date);
  if (later.length) return `Бројот ${proposed} има постар датум од претходната фактура ${later[0]!.d.number} (${dmy(later[0]!.d.date)}).`;
  return null;
}

/** Is `number` the highest number of its kind / series / year — the only one that may be removed without a gap? */
export function isLastInSeries(existing: readonly NumberedDoc[], number: string, date: string): boolean {
  const p = parseDocNumber(number);
  if (!p) return true;
  return !existing.some((d) => {
    if (d.date.slice(0, 4) !== date.slice(0, 4)) return false;
    const x = parseDocNumber(d.number);
    return !!x && x.series === p.series && x.n > p.n;
  });
}
