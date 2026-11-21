/** 💬 The phones the office assigned to a firm (`app_settings` `wa.senders`, phone → firm id). */
import { eq } from 'drizzle-orm';
import { waPhone } from '@wise/core/whatsapp/wa';
import type { Tx } from './audit';
import { appSettings } from './schema/index';

export const WA_SENDERS = 'wa.senders';

export async function waLearned(tx: Pick<Tx, 'select'>): Promise<Record<string, string>> {
  const [r] = await tx.select({ value: appSettings.value }).from(appSettings).where(eq(appSettings.key, WA_SENDERS)).limit(1);
  return { ...((r?.value as Record<string, string> | undefined) ?? {}) };
}

/** Remember: messages from this phone belong to this firm (null = forget). */
export async function waLearn(tx: Pick<Tx, 'select' | 'insert'>, phone: string, firmId: string | null, userId: string | null): Promise<void> {
  const p = waPhone(phone);
  if (!p) return;
  const S = await waLearned(tx);
  if (firmId ? S[p] === firmId : !(p in S)) return;
  if (firmId) S[p] = firmId; else delete S[p];
  await tx.insert(appSettings).values({ key: WA_SENDERS, value: S, updatedBy: userId })
    .onConflictDoUpdate({ target: appSettings.key, set: { value: S, updatedAt: new Date(), updatedBy: userId } });
}
