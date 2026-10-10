import 'server-only';
/** Law changes for the screens (legacy `S.law` from `applaw`, newest first) and the user's „прочитано“ mark. */
import { desc, eq } from 'drizzle-orm';
import type { LawRow } from '@wise/core/law';
import { lawChanges, lawSeen, type LawChangeRow } from '@wise/db';
import { db } from './db';

export type LawItem = LawChangeRow & LawRow;

export async function loadLaw(): Promise<LawItem[]> {
  const L = await db().select().from(lawChanges).orderBy(desc(lawChanges.date), desc(lawChanges.createdAt));
  return L.map((x) => ({ ...x, at: x.createdAt.toISOString() }));
}

export async function lawSeenOf(userId: string): Promise<string | null> {
  const [s] = await db().select().from(lawSeen).where(eq(lawSeen.userId, userId)).limit(1);
  return s ? s.seenAt.toISOString() : null;
}
