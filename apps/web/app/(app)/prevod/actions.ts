'use server';
import { revalidatePath } from 'next/cache';
import { requireUser } from '@/lib/auth';
import { isDemoUser } from '@/lib/demo';
import { deeplConfigured, deeplErr, deeplText, DEEPL_NO_KEY, isDeeplLang } from '@/lib/deepl';
import { translateStoredFile } from '@/lib/deepl-files';
import { isUuid } from '@/lib/office';

export interface TextResult { error?: string; text?: string; detected?: string | null; chars?: number }

const MAX_TEXT = 30_000;

/** 🌐 Превод: translate a pasted text. */
export async function translateTextAction(text0: string, to: string): Promise<TextResult> {
  const u = await requireUser();
  if (u.role === 'klient' || isDemoUser(u)) return { error: 'Преводот не е достапен.' };
  if (!deeplConfigured()) return { error: DEEPL_NO_KEY };
  if (!isDeeplLang(to)) return { error: 'Изберете јазик.' };
  const text = String(text0 ?? '').trim();
  if (!text) return { error: 'Внесете текст.' };
  if (text.length > MAX_TEXT) return { error: `Најмногу ${MAX_TEXT.toLocaleString('mk-MK')} знаци одеднаш – за подолг текст прикачете документ.` };
  try {
    const r = await deeplText([text], to);
    revalidatePath('/prevod');
    return { text: r.texts[0], detected: r.detected, chars: text.length };
  } catch (e) { return { error: deeplErr(e) }; }
}

/** 🌐 Translate a stored file (uploaded on the Превод page, a dossier document, an incoming document). */
export async function translateFileAction(fileId: string, to: string): Promise<{ error?: string; ok?: string; id?: string }> {
  const u = await requireUser();
  if (u.role === 'klient') return { error: 'Преводот не е достапен.' };
  if (!deeplConfigured()) return { error: DEEPL_NO_KEY };
  if (!isUuid(fileId) || !isDeeplLang(to)) return { error: 'Погрешно барање.' };
  const r = await translateStoredFile(u, fileId, to);
  if (r.ok) { revalidatePath('/prevod'); revalidatePath('/dosie'); revalidatePath('/prist'); }
  return r;
}
