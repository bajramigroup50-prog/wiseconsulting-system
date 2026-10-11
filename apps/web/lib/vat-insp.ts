import 'server-only';
/** Legacy `ddvTab` 16812 data: ДДВ-04 fields per month / per filed period for the chosen years (shared by the screen and the PDF). */
import { DDV04_FIELDS, ddv04FromResult, ddvFor } from '@wise/core';
import { loadVatPostingContext, vatYearOverview, type Firm } from '@wise/db';
import { db } from './db';
import { vatSource } from './vat-source';
import { DT_DEF, periodShortLabel } from './vat-view';

export type InspRow = { l: string; F: Record<string, number> };

const list = (v: string | string[] | undefined) => (v == null ? [] : Array.isArray(v) ? v : [v]);

/** Columns: the URL's `c`, else the firm's saved choice (`settings.dtCols`, legacy `dtSaveCols`), else `DT_DEF`. */
export function inspCols(firm: Firm, c: string | string[] | undefined): string[] {
  const allK = DDV04_FIELDS.map(([k]) => k);
  const picked = list(c).filter((k) => allK.includes(k));
  if (picked.length) return allK.filter((k) => picked.includes(k));
  const saved = ((firm.settings ?? {}) as { dtCols?: string[] }).dtCols;
  if (Array.isArray(saved) && saved.some((k) => allK.includes(k))) return allK.filter((k) => saved.includes(k));
  return DT_DEF;
}

export function inspYears(y: string | string[] | undefined, year: number): number[] {
  const YS = [...new Set(list(y).map(Number).filter((v) => Number.isInteger(v) && v > 2000 && v < 2100))].sort((a, b) => a - b);
  return YS.length ? YS : [year];
}

export async function inspTables(firm: Firm, YS: readonly number[], mode: 'month' | 'per'): Promise<{ y: number; rows: InspRow[] }[]> {
  const ctx = await loadVatPostingContext(db(), firm);
  return Promise.all(YS.map(async (y) => {
    if (mode === 'per') {
      const ov = await vatYearOverview(db(), firm, y, vatSource);
      return { y, rows: ov.periods.map((p) => ({ l: periodShortLabel(p.period), F: p.fields })) };
    }
    const data = await vatSource.load(db(), firm, `${y}-01-01`, `${y}-12-31`, ctx);
    return { y, rows: Array.from({ length: 12 }, (_, i) => {
      const p = `${y}-${String(i + 1).padStart(2, '0')}`;
      return { l: periodShortLabel(p), F: ddv04FromResult(ddvFor(data.docs, p, 'month', ctx, { travel: data.travel })) };
    }) };
  }));
}
