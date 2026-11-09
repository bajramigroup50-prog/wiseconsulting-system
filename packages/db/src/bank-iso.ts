/**
 * Per-bank purpose codes (app setting `bankIso`): where the national list leaves two ISO codes for one old code, the
 * code each bank uses (bank code → old code → ISO code). Read by every screen that prints payment orders.
 */
import { eq } from 'drizzle-orm';
import { bankIsoClean, type BankIsoRules } from '@wise/core';
import { appSettings } from './schema/index';
import type { Tx } from './audit';

type Q = Pick<Tx, 'select' | 'insert'>;
export const BANK_ISO_KEY = 'bankIso';

export async function getBankIso(tx: Q): Promise<BankIsoRules> {
  const [r] = await tx.select({ v: appSettings.value }).from(appSettings).where(eq(appSettings.key, BANK_ISO_KEY)).limit(1);
  return bankIsoClean(r?.v);
}

export async function putBankIso(tx: Q, rules: unknown, userId: string | null): Promise<BankIsoRules> {
  const value = bankIsoClean(rules);
  await tx.insert(appSettings).values({ key: BANK_ISO_KEY, value, updatedBy: userId })
    .onConflictDoUpdate({ target: appSettings.key, set: { value, updatedBy: userId } });
  return value;
}
