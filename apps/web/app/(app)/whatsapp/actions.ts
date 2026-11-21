'use server';
/**
 * 💬 WhatsApp settings – owner only, audited. The owner types the Meta values into the page themselves; the secrets
 * are sealed at once (`saveWaSettings`) and never shown again (only „поставено / не е поставено“).
 */
import { revalidatePath } from 'next/cache';
import { isWaPurpose, type WaTemplate, type WaVar, WA_VARS } from '@wise/core/whatsapp/wa';
import { saveWaSettings, saveWaTemplates, waEnsureVerifyToken, waTestResult, waTestSend, WaError } from '@wise/db';
import type { RowResult } from '@/components/row-action';
import { requireUser } from '@/lib/auth';
import { DEMO_OFF_MSG, isDemoUser } from '@/lib/demo';
import { db } from '@/lib/db';
import { OWNER_ONLY_MSG, isOfficeOwner } from '@/lib/office-owner';

const PATH = '/whatsapp';

async function owner(): Promise<{ id: string } | RowResult> {
  const u = await requireUser();
  if (isDemoUser(u)) return { error: DEMO_OFF_MSG };
  if (!(await isOfficeOwner(u))) return { error: OWNER_ONLY_MSG };
  return u;
}
const isErr = (x: unknown): x is RowResult => !!x && typeof x === 'object' && 'error' in x;
const str = (f: FormData, k: string) => String(f.get(k) ?? '').trim();

export async function waSaveAction(_p: RowResult, f: FormData): Promise<RowResult> {
  const u = await owner();
  if (isErr(u)) return u;
  try {
    const s = await db().transaction((tx) => saveWaSettings(tx, {
      on: f.get('on') === 'on', phoneNumberId: str(f, 'phoneNumberId'), wabaId: str(f, 'wabaId'),
      appSecret: str(f, 'appSecret') || null, token: str(f, 'token') || null, clearToken: f.get('clearToken') === 'on',
      perMinute: Number(str(f, 'perMinute')) || null, perDay: Number(str(f, 'perDay')) || null,
    }, u.id));
    revalidatePath(PATH);
    return { ok: s.on ? '✓ Зачувано – WhatsApp од WISE е вклучен.' : '✓ Зачувано (исклучено – копчињата ги отвораат старите wa.me линкови).' };
  } catch (e) {
    return { error: e instanceof WaError ? e.message : 'Не успеа: ' + (e as Error).message };
  }
}

export async function waTemplatesAction(_p: RowResult, f: FormData): Promise<RowResult> {
  const u = await owner();
  if (isErr(u)) return u;
  const N = f.getAll('t_name').map(String);
  const T: Partial<WaTemplate>[] = [];
  const bad: string[] = [];
  N.forEach((name, i) => {
    if (!name.trim()) return;
    if (!/^[a-z0-9_]+$/.test(name.trim().toLowerCase())) { bad.push(name); return; }
    const vars = String(f.getAll('t_vars')[i] ?? '').split(/[,\s]+/).map((x) => x.trim()).filter(Boolean);
    const unknown = vars.filter((v) => !(v in WA_VARS));
    if (unknown.length) { bad.push(`${name}: ${unknown.join(', ')}`); return; }
    const purpose = String(f.getAll('t_purpose')[i] ?? '');
    T.push({ name: name.trim().toLowerCase(), lang: f.getAll('t_lang')[i] === 'sq' ? 'sq' : 'mk', purpose: isWaPurpose(purpose) ? purpose : 'opsto', vars: vars as WaVar[], doc: f.getAll('t_doc').map(String).includes(String(i)) });
  });
  if (bad.length) return { error: 'Неисправно (името: мали латинични букви, бројки и „_“; променливите од листата): ' + bad.join('; ') };
  const saved = await db().transaction((tx) => saveWaTemplates(tx, T, u.id));
  revalidatePath(PATH);
  return { ok: `✓ Зачувани ${saved.length} шаблони.` };
}

export async function waTestAction(_p: RowResult, f: FormData): Promise<RowResult> {
  const u = await owner();
  if (isErr(u)) return u;
  const r = await waTestSend(db(), { userId: u.id, phone: str(f, 'phone') }, {});
  await db().transaction((tx) => waTestResult(tx, 'ok' in r, 'ok' in r ? r.ok : r.error));
  revalidatePath(PATH);
  return 'ok' in r ? { ok: r.ok } : { error: r.error };
}

export async function waRotateAction(): Promise<RowResult> {
  const u = await owner();
  if (isErr(u)) return u;
  await db().transaction((tx) => waEnsureVerifyToken(tx, u.id, true));
  revalidatePath(PATH);
  return { ok: 'Нов verify token – внесете го и во Meta (Webhook → Edit).' };
}
