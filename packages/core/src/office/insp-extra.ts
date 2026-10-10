/**
 * Inspection readiness — the screen-level parts of legacy `VIEWS.insp` (16533–16588): per-inspectorate scores
 * (`inspCheck` → `sc`), the row icons (`INSP_IC`), what is still missing (`inspMissing`), the client request letter
 * (`inspAsk`) and the activity code input (`inspCodeAdd`).
 */
import { INSP_G, type InspGroup, type InspRow, type InspS } from './inspection';

/** Files attached to a check (legacy `firm.insp[id].files`): `file_links` entity type, id `<firm>:<check>`. */
export const INSP_FILE_ENTITY = 'inspection';
export const inspFileKey = (firmId: string, itemId: string) => `${firmId}:${itemId}`;

/** Legacy `INSP_IC`. */
export const INSP_IC: Record<InspS, string> = { ok: '✅', warn: '⚠️', bad: '⛔', todo: '⬜', na: '➖' };
/** Legacy PDF status marks (`inspPdf`). */
export const INSP_PDF_MARK: Record<InspS, string> = { ok: '✓', warn: '!', bad: '✗', todo: '☐', na: '–' };

export interface InspGroupScore { n: number; pct: number; bad: number; todo: number }

/**
 * Legacy `inspCheck` score per inspectorate: rows that apply (not „не се однесува“); ok = 1 point, warn = ½;
 * a group without rows counts as 100 %.
 */
export function inspGroupScore(R: readonly InspRow[]): Record<InspGroup, InspGroupScore> {
  const out = {} as Record<InspGroup, InspGroupScore>;
  for (const [g] of INSP_G) {
    const L = R.filter((r) => r.it.g === g && r.s !== 'na');
    const pts = L.reduce((s, r) => s + (r.s === 'ok' ? 1 : r.s === 'warn' ? 0.5 : 0), 0);
    out[g] = { n: L.length, pct: L.length ? Math.round((pts / L.length) * 100) : 100, bad: L.filter((r) => r.s === 'bad').length, todo: L.filter((r) => r.s === 'todo').length };
  }
  return out;
}

/** Colour class of a score (legacy: ≥ 90 good, ≥ 60 warn, else bad). */
export const inspPctClass = (pct: number) => (pct >= 90 ? 'good' : pct >= 60 ? 'warn' : 'bad');

/** Legacy `inspMissing`. */
export const inspMissing = (R: readonly InspRow[]) => R.filter((r) => r.s === 'bad' || r.s === 'todo' || r.s === 'warn');

/** Legacy `inspAsk` text: documents the client should check and send (manual checks not yet ok). Null = nothing to ask. */
export function inspAskMessage(R: readonly InspRow[], firmName: string, officeName: string): { subj: string; body: string } | null {
  const L = inspMissing(R).filter((r) => r.it.man && r.s !== 'ok');
  if (!L.length) return null;
  const parts = INSP_G.map(([g, n]) => {
    const Q = L.filter((r) => r.it.g === g);
    return Q.length ? `${n}:\n${Q.map((r) => `• ${r.t}${r.it.ev ? ` – ${r.it.ev}` : ''}`).join('\n')}` : '';
  }).filter(Boolean);
  return {
    subj: `Документи за инспекција – ${firmName}`,
    body: `Почитувани,\n\nЗа да бидете подготвени при инспекциски надзор (УЈП, Пазарен инспекторат, Инспекторат за труд), ве молиме проверете ги и доставете ни ги (слика или PDF преку порталот) следниве документи:\n\n${parts.join('\n\n')}\n\nСо почит,\n${officeName || 'Канцеларија'}`,
  };
}

/** Legacy `inspCodeAdd` input: `46,90` → `46.90`; null when it is not an NKD code (two digits + optional class). */
export function inspCodeInput(v: unknown): string | null {
  const s = String(v ?? '').trim().replace(',', '.');
  return /^\d{2}(\.\d{1,2})?$/.test(s) ? s : null;
}

/** Legacy `inspCodesFromFile` normalisation: `"Шифра 47.11 – …"` → `47.11` (codes with a class only). */
export const inspNkdNorm = (x: unknown) => (/\d{2}\.\d{1,2}/.exec(String(x ?? '')) ?? [''])[0];

/**
 * Legacy `inspCodesFromFile` merge: all codes read from a CRM document go to the other activities, except the main one;
 * when the firm has no main code yet, the document's priority code becomes the main one.
 */
export function inspMergeCodes(cur: { nkd?: string | null; other?: readonly string[] }, read: { priority?: string; codes?: readonly string[] }) {
  const pri = inspNkdNorm(read.priority);
  const all = [...new Set([pri, ...(read.codes ?? []).map(inspNkdNorm)].filter(Boolean))];
  const main = inspNkdNorm(cur.nkd);
  const other = [...new Set([...(cur.other ?? []), ...all.filter((k) => k !== (main || pri))])];
  return { all, nkd: !main && pri ? pri : null, other, mismatch: !!(main && pri && pri !== main), pri };
}
