import 'server-only';
/** Shared state + data of „Аналитички картици по комитент“ (screen and print views). */
import { linesWithoutPartner, partnerKontoCards, partnerSums, type CardSort } from '@wise/core/finance';
import { effectiveChart, type Firm } from '@wise/db';
import { inYearOr } from '@/lib/books';
import { db } from '@/lib/db';
import { finLines, partnerMap, srchMatch } from '@/lib/finance';

export type KcSP = { k?: string; from?: string; to?: string; sort?: string; pid?: string; open?: string; q?: string; syn?: string; nop?: string; kq?: string; post?: string };

/** Legacy `kcState` 6426, from the query string. */
export function kcState(sp: KcSP, year: number) {
  const kontos = [...new Set(String(sp.k ?? '').split(/[,\s+]+/).filter((x) => /^\d{1,10}$/.test(x)))];
  return {
    kontos,
    from: inYearOr(sp.from, year, `${year}-01-01`), to: inYearOr(sp.to, year, `${year}-12-31`),
    sort: (sp.sort === 'nal' ? 'nal' : 'date') as CardSort,
    pid: sp.pid && /^[0-9a-f-]{36}$/i.test(sp.pid) ? sp.pid : '',
    open: sp.open === '1', q: (sp.q ?? '').trim(),
  };
}
export type KcState = ReturnType<typeof kcState>;

/** Query string of a state (for links). */
export const kcQs = (s: KcState, o: Record<string, string | undefined> = {}) =>
  new URLSearchParams(Object.entries({ k: s.kontos.join(','), from: s.from, to: s.to, sort: s.sort === 'nal' ? 'nal' : '', pid: s.pid, open: s.open ? '1' : '', q: s.q, ...o })
    .filter(([, v]) => v) as [string, string][]).toString();

/** Lines of the selected kontos for the whole business year up to `to` (openings come from the year's opening journal). */
export async function kcData(firm: Firm, year: number, s: KcState) {
  const [lines, P, chart] = await Promise.all([finLines(firm.id, `${year}-01-01`, s.to, { kontos: s.kontos }), partnerMap(firm.id), effectiveChart(db(), firm.id)]);
  const kName = (k: string) => chart.find((a) => a.code === k)?.name ?? '';
  let sums = partnerSums(lines, { to: s.to, open: s.open }).map((x) => ({ ...x, name: P.get(x.id)?.name ?? '—' }));
  if (s.q) sums = sums.filter((x) => { const p = P.get(x.id); return srchMatch([x.name, p?.edb, p?.code, p?.city].filter(Boolean).join(' '), s.q); });
  sums.sort((a, b) => a.name.localeCompare(b.name, 'mk'));
  const cardsOf = (pid: string) => partnerKontoCards(lines, pid, s);
  const noPartner = linesWithoutPartner(lines, s.kontos.filter((x) => /^(1|2|12|22)$/.test(x) || /^(12[0-8]|22[0-8])/.test(x)));
  return { lines, P, chart, kName, sums, cardsOf, noPartner, hasPartners: lines.some((l) => l.partnerId) };
}
