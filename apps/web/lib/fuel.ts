import 'server-only';
/** Fuel-card rows of the firm (legacy `frFuelImps` / `frFuelRows`) and the FX lookup used to convert them. */
import { fxRate } from '@wise/core';
import type { FuelRow } from '@wise/core/industry';
import { listDocs, loadFxSources, type FuelImport } from '@wise/db';
import { db } from './db';

export async function fuelImports(firmId: string) {
  return (await listDocs<FuelImport & { at?: string }>(db(), firmId, 'frfuel')).sort((a, b) => String(b.data.at ?? '').localeCompare(String(a.data.at ?? '')));
}
export const fuelRowsOf = (I: Awaited<ReturnType<typeof fuelImports>>): FuelRow[] => I.flatMap((x) => x.data.rows ?? []);

/** `(cur, date) → MKD rate` (0 when unknown), from the firm's FX sources. */
export async function fxLookup(firmId: string): Promise<(cur: string, d: string) => number> {
  const fx = await loadFxSources(db(), firmId);
  return (c, d) => { if (c === 'MKD') return 1; try { return fxRate(c, d, fx) || 0; } catch { return 0; } };
}
