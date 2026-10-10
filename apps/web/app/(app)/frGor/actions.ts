'use server';
/** Legacy `ACT.frGSave` / `frGDel` (14638): fuel-card imports are `firm_docs` rows of type `frfuel`. */
import { FUEL_MAX_ROWS, fuelDate } from '@wise/core/industry';
import { deleteDoc, loadIndustryFirm, saveDoc, type FuelImport } from '@wise/db';
import { indRun, str } from '@/lib/industry';
import type { FormState } from '@/components/bank-form';

const P = ['/frGor', '/frTuri'];
const r2 = (v: unknown) => Math.round((Number(v) || 0) * 100) / 100;

export async function saveFuelImportAction(_p: FormState, f: FormData): Promise<FormState> {
  return indRun('frGSave', P, async ({ tx, a }) => {
    await loadIndustryFirm(tx, a.firmId, 'frt');
    let raw: unknown;
    try { raw = JSON.parse(str(f.get('rows')) || '[]'); } catch { raw = []; }
    const rows = (Array.isArray(raw) ? raw : []).map((x: Record<string, unknown>) => ({
      d: fuelDate(x?.d), plate: String(x?.plate ?? '').trim().slice(0, 30), ctry: String(x?.ctry ?? '').trim().slice(0, 30), prod: String(x?.prod ?? '').trim().slice(0, 60),
      qty: r2(x?.qty), amt: r2(x?.amt), cur: String(x?.cur ?? 'MKD').trim().toUpperCase().slice(0, 3) || 'MKD',
    })).filter((r) => r.d && r.plate && r.amt);
    if (!rows.length) return 'Нема важечки редови (датум, регистрација, износ).';
    if (rows.length > FUEL_MAX_ROWS) return `Премногу редови во една датотека (најмногу ${FUEL_MAX_ROWS}) – поделете ја.`;
    const name = str(f.get('name')).slice(0, 200) || 'увоз';
    await saveDoc<FuelImport & { at: string }>(tx, a, 'frfuel', { date: rows.map((r) => r.d).sort()[0]!, number: name, data: { name, at: new Date().toISOString(), rows } });
    return `Увезени ${rows.length} точења.`;
  });
}

export async function deleteFuelImportAction(id: string): Promise<FormState> {
  return indRun('del', P, async ({ tx, a }) => { await deleteDoc(tx, a, 'frfuel', id); return 'Увозот е избришан.'; });
}
