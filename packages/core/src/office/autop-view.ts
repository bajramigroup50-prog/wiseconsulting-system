/**
 * Autopilot screen helpers — legacy `VIEWS.autop` (16316 …): message kinds (`AP_TYPES`), the short "what is missing"
 * summary of a proposed message (`apWhat`), the firm table order and KPI counts, and the peer count of the risk tab.
 */
export const AP_TYPES = [
  ['inv', '📄 Влезни фактури што недостасуваат', 'Платено на добавувач (излез од извод) без влезна фактура'],
  ['out', '📤 Излезни фактури што недостасуваат', 'Примена уплата од купувач (влез во извод) без излезна фактура'],
  ['cash', '💶 Благајна во минус / фискални', 'Недостасуваат дневни фискални извештаи или уплати во благајна'],
  ['vat', '🧾 ДДВ и даноци – проценка и рок', 'Колку ДДВ/аконтација доаѓа и до кога'],
  ['izv', '🏦 Изводи што недостасуваат', 'Недостасуваат изводи од банката'],
] as const;
export const AP_TYPE_KEYS = AP_TYPES.map((t) => t[0]);
export const apTypeName = (k: string) => AP_TYPES.find((t) => t[0] === k)?.[1] ?? (k === 'insp' ? '🛡 Документи за инспекција' : k);

/** Legacy `apWhat`: one line of what a message asks for. */
export function apWhat(g: { type: string; body: string }): string {
  const t = String(g.body || '');
  if (g.type === 'inv' || g.type === 'out') {
    const L = t.split('\n').filter((x) => /^\d+\. /.test(x));
    return L.slice(0, 4).join(' · ') + (L.length > 4 ? ` · … (${L.length})` : '');
  }
  if (g.type === 'cash') {
    const m = /во минус од ([\d.]+) \(најниско ([^)]*)\)/.exec(t);
    return m ? `во минус од ${m[1]} · најниско ${m[2]}` : 'благајна во минус';
  }
  if (g.type === 'vat') return t.split('\n').filter((x) => x.startsWith('• ')).map((x) => x.slice(2).split('\n')[0]).join(' · ').slice(0, 220);
  if (g.type === 'izv') return t.split('\n').filter((x) => x.startsWith('• ')).map((x) => x.slice(2)).join(' · ').slice(0, 220);
  return '';
}

export interface ApFinding { lvl: string; cat: string; txt: string }
export interface ApFirmRow<F> { f: F; bad: number; warn: number; I: ApFinding[] }

/** Legacy firms tab: open (not acknowledged, not info) findings per firm, sorted by problems, then warnings, then name. */
export function apFirmRows<F extends { name: string }>(firms: readonly F[], findingsOf: (f: F) => readonly ApFinding[]): ApFirmRow<F>[] {
  return firms.map((f) => {
    const I = findingsOf(f).filter((a) => a.lvl !== 'info').slice().sort((a, b) => (a.lvl === 'bad' ? 0 : 1) - (b.lvl === 'bad' ? 0 : 1));
    return { f, I, bad: I.filter((a) => a.lvl === 'bad').length, warn: I.filter((a) => a.lvl === 'warn').length };
  }).sort((a, b) => b.bad - a.bad || b.warn - a.warn || a.f.name.localeCompare(b.f.name, 'mk'));
}

/** KPI tiles: ready / with warnings / with problems. */
export function apKpi(rows: readonly { bad: number; warn: number }[]) {
  return { ok: rows.filter((r) => !r.bad && !r.warn).length, warn: rows.filter((r) => !r.bad && r.warn).length, bad: rows.filter((r) => r.bad).length };
}

/** Risk tab „Слични“: other firms with revenue in the same NKD division (legacy `apRisk` `peers`). */
export function apPeers(rows: readonly { firmId: string; m: Record<string, unknown> }[]): Map<string, number> {
  const ok = (r: { m: Record<string, unknown> }) => String(r.m.nkd ?? '') !== '' && Number(r.m.rev) > 0;
  const by = new Map<string, number>();
  for (const r of rows) if (ok(r)) by.set(String(r.m.nkd), (by.get(String(r.m.nkd)) ?? 0) + 1);
  return new Map(rows.map((r) => [r.firmId, ok(r) ? (by.get(String(r.m.nkd)) ?? 1) - 1 : (by.get(String(r.m.nkd ?? '')) ?? 0)]));
}

/** Risk pill class (legacy: ≥ 40 bad, ≥ 20 warn). */
export const apRiskClass = (n: number) => (n >= 40 ? 'bad' : n >= 20 ? 'warn' : 'good');
