'use server';
/**
 * Legacy `schSaveAll` / `schReset` (5244–5246): the posting schemes are office-wide (`app_settings.schemes`, legacy
 * `appsettings/schemes`) and saving them clears the per-firm overrides (`firms.settings.sch / vatIn / vatOut / vatImp /
 * vatInKonto`) so they apply to every firm. Needs `settings`; audit in the same transaction.
 */
import { revalidatePath } from 'next/cache';
import { eq } from 'drizzle-orm';
import { customSchemeBalanced, type CustomScheme } from '@wise/core/finance';
import { J_TITLES } from '@wise/core/sch-journals';
import { appSettings, audit, firms, missingAccounts, SCHEMES_SETTINGS_KEY, type Tx } from '@wise/db';
import { actionError, firmAction, type ActionState } from '@/lib/books';
import { db } from '@/lib/db';
import { SCH_FIELD_KEYS, SCH_FLAGS, VAT_RATES } from './schema';

const KONTO = /^\d{3,10}$/;

async function clearFirmOverrides(tx: Tx): Promise<number> {
  const F = await tx.select({ id: firms.id, settings: firms.settings }).from(firms);
  let n = 0;
  for (const f of F) {
    const S = (f.settings ?? {}) as Record<string, unknown>;
    if (!['sch', 'vatIn', 'vatOut', 'vatImp', 'vatInKonto'].some((k) => S[k] && (typeof S[k] !== 'object' || Object.keys(S[k] as object).length))) continue;
    const { sch: _s, vatIn: _i, vatOut: _o, vatImp: _m, vatInKonto: _k, ...rest } = S;
    await tx.update(firms).set({ settings: rest }).where(eq(firms.id, f.id));
    n++;
  }
  return n;
}

export async function saveSchemesAction(_p: ActionState, f: FormData): Promise<ActionState> {
  try {
    const { u, firm } = await firmAction('schSaveAll');
    const g = (k: string) => String(f.get(k) ?? '').trim();
    const sch: Record<string, string | boolean> = {};
    const errs: string[] = [];
    for (const k of SCH_FIELD_KEYS) {
      const v = g('s_' + k);
      if (!v) continue;
      if (v !== '-' && !KONTO.test(v)) { errs.push(`${k}: „${v}“ не е конто (3–10 цифри)`); continue; }
      sch[k] = v;
    }
    for (const [k] of SCH_FLAGS) sch[k] = f.get('s_' + k) === '1';
    const map = (p: string) => Object.fromEntries(VAT_RATES.map((r) => [r, g(p + r)]).filter(([, v]) => v));
    const vatIn = map('VI'), vatImp = map('VM'), vatOut = map('VO');
    for (const v of [...Object.values(vatIn), ...Object.values(vatImp), ...Object.values(vatOut)]) if (!KONTO.test(String(v))) errs.push(`„${v}“ не е конто за ДДВ`);
    // custom schemes: c_name_<i>, c_k_<i>, c_s_<i>, c_v_<i>, c_n_<i> (rows as repeated fields)
    const custom: CustomScheme[] = [];
    for (const i of f.getAll('c_i').map(String)) {
      const name = g('c_name_' + i);
      const K = f.getAll('c_k_' + i).map(String), Sd = f.getAll('c_s_' + i).map(String), V = f.getAll('c_v_' + i).map(String), N = f.getAll('c_n_' + i).map(String);
      const rows = K.map((k, j) => ({ k: k.trim(), s: (Sd[j] === 'p' ? 'p' : 'd') as 'd' | 'p', v: Number(String(V[j] ?? '').replace(',', '.')) || 0, n: String(N[j] ?? '').trim() })).filter((r) => r.k);
      if (!name && !rows.length) continue;
      if (rows.some((r) => !KONTO.test(r.k))) { errs.push(`Шемата „${name}“: контото мора да има 3–10 цифри.`); continue; }
      if (!customSchemeBalanced({ rows })) { errs.push(`Шемата „${name || '(без назив)'}“ не е изедначена (Д% мора = П%).`); continue; }
      custom.push({ id: g('c_id_' + i) || 'c' + Date.now().toString(36) + i, name: name || 'Шема', rows });
    }
    // legacy `hidden` / `names` of „Шеми како налози“ (Скриј, renamed example journals)
    const hidden = [...new Set(f.getAll('hid').map(String))].filter((x) => x in J_TITLES);
    const names: Record<string, string> = {};
    for (const id of Object.keys(J_TITLES)) { const v = g('n_' + id).slice(0, 120); if (v && v !== J_TITLES[id] && !(id === 'purR' && v.startsWith('Влезна фактура во продавница'))) names[id] = v; }
    if (errs.length) return { error: errs.join(' · ') };
    const codes = [...Object.values(sch).filter((v): v is string => typeof v === 'string' && v !== '-'), ...Object.values(vatIn), ...Object.values(vatImp), ...Object.values(vatOut), ...custom.flatMap((c) => c.rows.map((r) => r.k))].map(String);
    const missing = await missingAccounts(db(), firm.id, codes);
    if (missing.length) return { error: `Контото ${missing.join(', ')} не постои во контниот план.` };
    let cleared = 0;
    await db().transaction(async (tx) => {
      const [row] = await tx.select().from(appSettings).where(eq(appSettings.key, SCHEMES_SETTINGS_KEY)).limit(1);
      const G = (row?.value ?? {}) as Record<string, unknown>;
      const value = { ...G, sch, vatIn, vatOut, vatImp, custom, hidden, names, updated: new Date().toISOString(), by: u.name };
      await tx.insert(appSettings).values({ key: SCHEMES_SETTINGS_KEY, value, updatedBy: u.id }).onConflictDoUpdate({ target: appSettings.key, set: { value, updatedBy: u.id } });
      cleared = await clearFirmOverrides(tx);
      await audit(tx, { userId: u.id, firmId: null, action: 'schSaveAll', entityType: 'appSettings', entityId: SCHEMES_SETTINGS_KEY, data: { sch, vatIn, vatOut, vatImp, custom: custom.length, firmsCleared: cleared } });
    });
    revalidatePath('/semi');
    return { ok: 'Шемите се зачувани и важат за сите фирми, и за новите. Промената важи за новите книжења.' + (cleared ? ` (${cleared} фирми имаа свои конта – отстранети.)` : '') };
  } catch (e) { return actionError(e); }
}

export async function resetSchemesAction(): Promise<ActionState> {
  try {
    const { u } = await firmAction('schReset');
    await db().transaction(async (tx) => {
      const [row] = await tx.select().from(appSettings).where(eq(appSettings.key, SCHEMES_SETTINGS_KEY)).limit(1);
      const custom = ((row?.value ?? {}) as { custom?: unknown }).custom ?? [];
      const value = { sch: {}, vatIn: {}, vatOut: {}, vatImp: {}, custom, updated: new Date().toISOString() };
      await tx.insert(appSettings).values({ key: SCHEMES_SETTINGS_KEY, value, updatedBy: u.id }).onConflictDoUpdate({ target: appSettings.key, set: { value, updatedBy: u.id } });
      const n = await clearFirmOverrides(tx);
      await audit(tx, { userId: u.id, firmId: null, action: 'schReset', entityType: 'appSettings', entityId: SCHEMES_SETTINGS_KEY, data: { firmsCleared: n } });
    });
    revalidatePath('/semi');
    return { ok: 'Вратени се стандардните конта.' };
  } catch (e) { return actionError(e); }
}

/** Legacy `custDel` („Избриши шема“): remove one of the user's own schemes (office-wide). */
export async function deleteCustomSchemeAction(id: string): Promise<ActionState> {
  try {
    const { u } = await firmAction('schSaveAll');
    let name = '';
    await db().transaction(async (tx) => {
      const [row] = await tx.select().from(appSettings).where(eq(appSettings.key, SCHEMES_SETTINGS_KEY)).limit(1);
      const G = (row?.value ?? {}) as { custom?: CustomScheme[] } & Record<string, unknown>;
      const c = (G.custom ?? []).find((x) => x.id === id);
      if (!c) throw new Error('Шемата не постои.');
      name = c.name;
      const value = { ...G, custom: (G.custom ?? []).filter((x) => x.id !== id), updated: new Date().toISOString(), by: u.name };
      await tx.update(appSettings).set({ value, updatedBy: u.id }).where(eq(appSettings.key, SCHEMES_SETTINGS_KEY));
      await audit(tx, { userId: u.id, firmId: null, action: 'custDel', entityType: 'appSettings', entityId: SCHEMES_SETTINGS_KEY, data: { id, name } });
    });
    revalidatePath('/semi');
    return { ok: `Шемата „${name}“ е избришана.` };
  } catch (e) { return e instanceof Error && e.message === 'Шемата не постои.' ? { error: e.message } : actionError(e); }
}
