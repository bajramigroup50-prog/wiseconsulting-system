'use server';
/**
 * 💬 Server actions every send button uses (`components/wa-send.tsx`): is the API on (else the buttons keep the old
 * wa.me / Viber links), and „Испрати од WISE“ — text and / or PDFs straight from WISE through the Cloud API
 * (`@wise/db` `waSend`: 24-hour window / templates, rate limit, log + audit). Office staff only (never a client, a
 * field worker or the demo); the firm and every file are checked against the user's access.
 */
import { eq, inArray } from 'drizzle-orm';
import { can, firmAllowed } from '@wise/core';
import { isWaPurpose, waActive, type WaLang, type WaPurpose, type WaVar, WA_VARS } from '@wise/core/whatsapp/wa';
import { files, waSecrets, waSend, type Tx, type WaSendResult } from '@wise/db';
import { revalidatePath } from 'next/cache';
import { getUser, type SessionUser } from './auth';
import { db } from './db';
import { isDemoUser } from './demo';
import { isUuid } from './office';
import { getObjectBytes } from './storage';

const staff = (u: SessionUser | null): u is SessionUser => !!u && u.role !== 'klient' && u.role !== 'teren' && !isDemoUser(u);

/** On = the owner switched it on and every credential is set. */
export async function waApiOn(): Promise<boolean> {
  const u = await getUser();
  if (!staff(u)) return false;
  return waActive(await waSecrets(db() as unknown as Tx));
}

export interface WaSendRequest {
  phone: string; text?: string | null; fileIds?: string[]; firmId?: string | null;
  purpose?: WaPurpose; lang?: WaLang; vars?: Partial<Record<WaVar, string | number | null>>; freeOnly?: boolean;
}

export async function waSendAction(r: WaSendRequest): Promise<WaSendResult> {
  const u = await getUser();
  if (!staff(u)) return { error: 'Немате пристап.' };
  const firmId = r.firmId && isUuid(r.firmId) ? r.firmId : null;
  if (firmId ? !can(u.principal, 'write', firmId) : !can(u.principal, 'office')) return { error: 'Немате право да праќате за оваа фирма.' };
  const ids = (r.fileIds ?? []).filter(isUuid).slice(0, 10);
  const F = ids.length ? await db().select().from(files).where(inArray(files.id, ids)) : [];
  for (const f of F) {
    const ok = f.status === 'ready' && (f.firmId ? firmAllowed(u.principal, f.firmId) : can(u.principal, 'office') || f.uploadedBy === u.id);
    if (!ok) return { error: `Немате пристап до „${f.name}“.` };
  }
  if (F.length !== ids.length) return { error: 'Документот не е пронајден (освежете ја страницата).' };
  const vars = Object.fromEntries(Object.entries(r.vars ?? {}).filter(([k]) => k in WA_VARS).map(([k, v]) => [k, v == null ? null : String(v).slice(0, 500)]));
  const res = await waSend(db(), {
    userId: u.id, firmId, phone: String(r.phone ?? ''), text: String(r.text ?? '').slice(0, 4000), fileIds: ids,
    purpose: isWaPurpose(r.purpose) ? r.purpose : ids.length ? 'dokument' : 'opsto', lang: r.lang === 'sq' ? 'sq' : 'mk', vars, freeOnly: !!r.freeOnly,
  }, {
    readFile: async (id) => {
      const [f] = await db().select().from(files).where(eq(files.id, id)).limit(1);
      if (!f) throw new Error('Документот не е пронајден.');
      if (f.size > 100 * 1024 * 1024) throw new Error(`„${f.name}“ е поголем од 100 MB.`);
      return { bytes: await getObjectBytes(f.bucketKey), mime: f.mime || 'application/pdf', name: f.name };
    },
  });
  if ('ok' in res) revalidatePath('/waInbox');
  return res;
}
