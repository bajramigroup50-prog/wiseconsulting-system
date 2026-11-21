'use server';
/** „🍲 Корисници и оброци“: register, daily meal ticks and the import of the association's Excel register. */
import * as XLSX from 'xlsx';
import { isMealKind, parseRegister } from '@wise/core/meals';
import { importBeneficiaries, saveBeneficiary, setMeal, setMealsBulk } from '@wise/db';
import { indRun, num, str } from '@/lib/industry';
import type { FormState } from '@/components/bank-form';

const P = ['/obroci'];
const iso = (s: string) => (/^\d{4}-\d{2}-\d{2}$/.test(s) ? s : '');

export async function saveBenefAction(_p: FormState, f: FormData): Promise<FormState> {
  return indRun('mealBenSave', P, async ({ tx, a }) => {
    await saveBeneficiary(tx, a, {
      id: str(f.get('id')) || null, no: num(f.get('no')), name: str(f.get('name')), members: num(f.get('members')) ?? 1,
      nationality: str(f.get('nationality')), embg: str(f.get('embg')), place: str(f.get('place')), phone: str(f.get('phone')),
      note: str(f.get('note')), active: f.get('active') !== 'off',
    });
    return 'Корисникот е зачуван.';
  });
}

/** One checkbox of the daily list (called from the client on every click). */
export async function toggleMealAction(id: string, date: string, meal: string, on: boolean): Promise<FormState> {
  if (!iso(date) || !isMealKind(meal)) return { error: 'Невалиден датум или оброк.' };
  return indRun(on ? 'mealOn' : 'mealOff', [], async ({ tx, a }) => { await setMeal(tx, a, id, date, meal, on); return on ? 'Означено.' : 'Тргнато.'; });
}

export async function bulkMealAction(ids: string[], date: string, meal: string): Promise<FormState> {
  if (!iso(date) || !isMealKind(meal)) return { error: 'Невалиден датум или оброк.' };
  return indRun('mealBulk', P, async ({ tx, a }) => `Означени ${await setMealsBulk(tx, a, ids, date, meal)} корисници.`);
}

export async function importBenefAction(_p: FormState, f: FormData): Promise<FormState> {
  const file = f.get('file');
  if (!(file instanceof File) || !file.size) return { error: 'Изберете Excel датотека (.xlsx).' };
  if (file.size > 5_000_000) return { error: 'Датотеката е преголема (најмногу 5 MB).' };
  let parsed: ReturnType<typeof parseRegister>;
  try {
    const wb = XLSX.read(new Uint8Array(await file.arrayBuffer()), { type: 'array' });
    // the first sheet that has a name column (the association's „Regjistri“; „Përmbledhje“ is only a summary)
    parsed = { list: [], skipped: 0 };
    for (const n of wb.SheetNames) {
      const r = parseRegister(XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[n]!, { header: 1, raw: false, defval: '' }));
      if (r.list.length) { parsed = r; break; }
    }
  } catch { return { error: 'Датотеката не може да се прочита. Зачувајте ја како .xlsx и обидете се повторно.' }; }
  if (!parsed.list.length) return { error: 'Не е најдена колона со име (Emri dhe Mbiemri / Име и презиме).' };
  return indRun('mealImport', P, async ({ tx, a }) => {
    const r = await importBeneficiaries(tx, a, parsed.list);
    return `Увезено: ${r.added} нови, ${r.updated} ажурирани${parsed.skipped ? `, ${parsed.skipped} редови без име прескокнати` : ''}.`;
  });
}
