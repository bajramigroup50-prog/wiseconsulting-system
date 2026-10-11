'use server';
/**
 * Legacy `VIEWS.moduli` 10231 → 10531: activity profiles (`data-mpf`, `modAutoProf` „↺ Врати автоматски од шифрата“),
 * tri-state module settings (`data-mod`: автоматски / секогаш вклучен / исклучен) and the entity type (10531 radio).
 */
import { revalidatePath } from 'next/cache';
import { nkdProfiles, normalizeMods, suggestedModules, type EntityKind, type ModSetting, setModule } from '@wise/core/industry';
import { firmModuleState, saveFirmEntity, saveFirmModules, saveModuleSetup } from '@wise/db';
import { indRun, str } from '@/lib/industry';
import type { FormState } from '@/components/bank-form';

const done = (r: FormState) => { revalidatePath('/', 'layout'); return r; };

/** Old checkbox list (kept for compatibility): the enabled modules as explicit settings. */
export async function saveModulesAction(_p: FormState, form: FormData): Promise<FormState> {
  return done(await indRun('modSave', ['/moduli'], async ({ tx, a }) => {
    await saveFirmModules(tx, a, normalizeMods(form.getAll('mod').map(String)));
    return 'Модулите се зачувани.';
  }));
}

export async function suggestModulesAction(): Promise<FormState> {
  return done(await indRun('modSave', ['/moduli'], async ({ tx, a, firm }) => {
    const m = suggestedModules(nkdProfiles(firm.activity));
    await saveFirmModules(tx, a, normalizeMods([...firm.mods, ...m]));
    return m.length ? 'Вклучени модули според дејноста.' : 'Шифрата на дејност не предлага посебни модули.';
  }));
}

/** Legacy `data-mpf` (profiles ticked) + `data-mod` (one select per module), saved together. */
export async function saveModuleSetupAction(_p: FormState, form: FormData): Promise<FormState> {
  return done(await indRun('modSave', ['/moduli'], async ({ tx, a, firm }) => {
    const st = firmModuleState(firm);
    const profiles = form.getAll('prof').map(String);
    const profChanged = profiles.slice().sort().join() !== st.profiles.slice().sort().join();
    let ov = st.ov;
    for (const [k, v] of form.entries()) if (k.startsWith('mod.')) ov = setModule(ov, k.slice(4), (['', '1', '0'].includes(String(v)) ? String(v) : '') as ModSetting);
    const mods = await saveModuleSetup(tx, a, { ...(profChanged ? { profiles } : {}), ov });
    return `Зачувано · вклучени модули: ${mods.length}.`;
  }));
}

/** Legacy `modAutoProf`: the activity again from the NKD code. */
export async function autoProfilesAction(): Promise<FormState> {
  return done(await indRun('modSave', ['/moduli'], async ({ tx, a }) => {
    await saveModuleSetup(tx, a, { profiles: null });
    return 'Дејноста се зема автоматски од шифрата.';
  }));
}

/** Legacy 10531: „Вид на субјект“ (sets the legal form). */
export async function saveEntityAction(_p: FormState, form: FormData): Promise<FormState> {
  return done(await indRun('settings', ['/moduli', '/zsProc'], async ({ tx, a }) => {
    await saveFirmEntity(tx, a, str(form.get('ent')) as EntityKind);
    return 'Видот на субјектот е зачуван.';
  }));
}
