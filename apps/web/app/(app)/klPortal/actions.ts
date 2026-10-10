'use server';
import { revalidatePath } from 'next/cache';
import { eq, sql } from 'drizzle-orm';
import { firmProfiles, KL_PROF, KL_SEC, klAddRecommended, klModuleOff, type KlConfig, type KlNote } from '@wise/core/office';
import { klNoteClean } from '@wise/core/firms/klnote';
import { appSettings, audit, files, firms, type Tx } from '@wise/db';
import type { ActionState } from '@/lib/books';
import { db } from '@/lib/db';
import { fv, isUuid, officeAction, officeError } from '@/lib/office';

/** Office-wide original sticker image (legacy `appsettings/notice` {url,id}). */
const NOTICE_KEY = 'notice';

/**
 * Merge `patch` into `firm.settings.kl` (jsonb, only the `kl` key changes — other settings and the other `kl`
 * fields such as the store notice are kept). FIX: the earlier save replaced the whole `kl` object.
 */
async function patchKl(tx: Tx, firmId: string, patch: Partial<KlConfig>) {
  await tx.update(firms).set({
    settings: sql`${firms.settings} || jsonb_build_object('kl', coalesce(${firms.settings}->'kl', '{}'::jsonb) || ${JSON.stringify(patch)}::jsonb)`,
  }).where(eq(firms.id, firmId));
}

const done = (ok: string): ActionState => { revalidatePath('/klPortal'); revalidatePath('/klHome'); return { ok }; };

/** Legacy `data-klp` change: the firm's activity profiles, set by hand (`profSet`). */
export async function saveProfiles(_p: ActionState, f: FormData): Promise<ActionState> {
  try {
    const { u, firm } = await officeAction('office');
    const prof = f.getAll('prof').map(String).filter((p) => KL_PROF.some(([k]) => k === p));
    await db().transaction(async (tx) => {
      await patchKl(tx, firm.id, { prof, profSet: true });
      await audit(tx, { userId: u.id, firmId: firm.id, action: 'klProf', entityType: 'firm', entityId: firm.id, data: { prof } });
    });
    return done('Дејноста е зачувана.');
  } catch (e) { return officeError(e); }
}

/** Legacy `data-kls` change: which sections the client sees (sections of a module that is off keep their value). */
export async function saveSections(_p: ActionState, f: FormData): Promise<ActionState> {
  try {
    const { u, firm } = await officeAction('office');
    const sel = new Set(f.getAll('on').map(String));
    const old = (firm.settings as { kl?: KlConfig }).kl?.on ?? {};
    const on = Object.fromEntries(KL_SEC.map((s) => [s[0], klModuleOff(s, firm.mods) ? (old[s[0]] ?? false) : sel.has(s[0])]));
    await db().transaction(async (tx) => {
      await patchKl(tx, firm.id, { on });
      await audit(tx, { userId: u.id, firmId: firm.id, action: 'klSave', entityType: 'firm', entityId: firm.id, data: { on: [...sel] } });
    });
    return done('Зачувано.');
  } catch (e) { return officeError(e); }
}

/** Legacy `klOnlyBase` (ACT_NEED settings): the client sees only the base sections. */
export async function onlyBase(): Promise<ActionState> {
  try {
    const { u, firm } = await officeAction('settings');
    await db().transaction(async (tx) => {
      await tx.update(firms).set({ settings: sql`${firms.settings} || jsonb_build_object('kl', (coalesce(${firms.settings}->'kl', '{}'::jsonb) - 'on') || '{"on":{}}'::jsonb)` }).where(eq(firms.id, firm.id));
      await audit(tx, { userId: u.id, firmId: firm.id, action: 'klOnlyBase', entityType: 'firm', entityId: firm.id });
    });
    return done('Клиентот гледа само основно.');
  } catch (e) { return officeError(e); }
}

/** Legacy `klAddRec` (ACT_NEED settings): switch on every recommended section of the firm's profile. */
export async function addRecommended(): Promise<ActionState> {
  try {
    const { u, firm } = await officeAction('settings');
    const kl = (firm.settings as { kl?: KlConfig }).kl ?? {};
    const on = klAddRecommended(kl, firmProfiles(kl, firm.activity), firm.mods);
    await db().transaction(async (tx) => {
      await patchKl(tx, firm.id, { on });
      await audit(tx, { userId: u.id, firmId: firm.id, action: 'klAddRec', entityType: 'firm', entityId: firm.id });
    });
    return done('Препорачаните делови се вклучени.');
  } catch (e) { return officeError(e); }
}

/** Legacy `klNotePdf`: save the store-door notice settings (`kl.note`); the caller then opens the print view. */
export async function saveNote(_p: ActionState, f: FormData): Promise<ActionState> {
  try {
    const { u, firm } = await officeAction('office');
    const note: KlNote = klNoteClean({
      obj: fv(f, 'obj') ?? '', hrs: fv(f, 'hrs') ?? '', ujp: fv(f, 'ujp') ?? '', ujp2: fv(f, 'ujp2') ?? '',
      insp: f.getAll('insp').map(String), sq: f.get('sq') === 'on',
    });
    await db().transaction(async (tx) => {
      await patchKl(tx, firm.id, { note });
      await audit(tx, { userId: u.id, firmId: firm.id, action: 'klNotePdf', entityType: 'firm', entityId: firm.id });
    });
    revalidatePath('/klPortal');
    return { ok: 'Зачувано.' };
  } catch (e) { return officeError(e); }
}

/** Legacy `kn_img` upload: the original УЈП sticker image, office-wide (`appsettings/notice`). */
export async function setNoticeImage(_p: ActionState, f: FormData): Promise<ActionState> {
  try {
    const { u, firm } = await officeAction('settings');
    const id = f.getAll('fileIds').map(String).find(isUuid);
    if (!id) return { error: 'Прикачете слика (PNG/JPG).' };
    const [file] = await db().select({ mime: files.mime }).from(files).where(eq(files.id, id)).limit(1);
    if (!file || !/^image\//.test(file.mime ?? '')) return { error: 'Датотеката не е слика.' };
    await db().transaction(async (tx) => {
      const value = { fileId: id, at: new Date().toISOString() };
      await tx.insert(appSettings).values({ key: NOTICE_KEY, value, updatedBy: u.id }).onConflictDoUpdate({ target: appSettings.key, set: { value, updatedBy: u.id } });
      await audit(tx, { userId: u.id, firmId: firm.id, action: 'klImgUp', entityType: 'app_settings', entityId: NOTICE_KEY, data: { fileId: id } });
    });
    revalidatePath('/klPortal');
    return { ok: 'Оригиналот е прикачен – важи за сите фирми.' };
  } catch (e) { return officeError(e); }
}

/** Legacy `klImgRm`: back to the drawn sticker. */
export async function removeNoticeImage(): Promise<ActionState> {
  try {
    const { u, firm } = await officeAction('settings');
    await db().transaction(async (tx) => {
      await tx.delete(appSettings).where(eq(appSettings.key, NOTICE_KEY));
      await audit(tx, { userId: u.id, firmId: firm.id, action: 'klImgRm', entityType: 'app_settings', entityId: NOTICE_KEY });
    });
    revalidatePath('/klPortal');
    return { ok: 'Се печати дизајнот.' };
  } catch (e) { return officeError(e); }
}
