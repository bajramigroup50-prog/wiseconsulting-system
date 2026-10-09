'use server';
/** Legacy `VIEWS.moduli` toggles → `saveFirmPatch({mods})` (10240) and `modAutoProf` (10244). */
import { revalidatePath } from 'next/cache';
import { nkdProfiles, normalizeMods, suggestedModules } from '@wise/core/industry';
import { saveFirmModules } from '@wise/db';
import { indRun } from '@/lib/industry';
import type { FormState } from '@/components/bank-form';

export async function saveModulesAction(_p: FormState, form: FormData): Promise<FormState> {
  const r = await indRun('modSave', ['/moduli'], async ({ tx, a }) => {
    await saveFirmModules(tx, a, normalizeMods(form.getAll('mod').map(String)));
    return 'Модулите се зачувани.';
  });
  revalidatePath('/', 'layout');
  return r;
}

export async function suggestModulesAction(): Promise<FormState> {
  const r = await indRun('modSave', ['/moduli'], async ({ tx, a, firm }) => {
    const m = suggestedModules(nkdProfiles(firm.activity));
    await saveFirmModules(tx, a, normalizeMods([...firm.mods, ...m]));
    return m.length ? 'Вклучени модули според дејноста.' : 'Шифрата на дејност не предлага посебни модули.';
  });
  revalidatePath('/', 'layout');
  return r;
}
