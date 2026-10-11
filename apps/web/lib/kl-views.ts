/**
 * View ids a `klient` user may open: `klAllowedViews` of their firm (the firm cookie if it is theirs, else their only
 * firm) + the contract with the office. Shared by `proxy.ts` and `/api/files/:id` (no `server-only`: the proxy
 * bundle imports it).
 */
import { eq } from 'drizzle-orm';
import { klAllowedViews, type KlConfig } from '@wise/core/office';
import { firms, getDb, userFirms } from '@wise/db';

export async function klientViews(userId: string, firmCookie: string | undefined): Promise<string[]> {
  const db = getDb();
  const own = (await db.select({ f: userFirms.firmId }).from(userFirms).where(eq(userFirms.userId, userId))).map((r) => r.f);
  const fid = firmCookie && own.includes(firmCookie) ? firmCookie : own.length === 1 ? own[0] : undefined;
  return firmKlientViews(fid);
}

/** The client views of one firm — also what an office user sees in 👁 Преглед како клиент (legacy `S.asClient`). */
export async function firmKlientViews(fid: string | undefined): Promise<string[]> {
  const [f] = fid && /^[0-9a-f-]{36}$/i.test(fid) ? await getDb().select({ settings: firms.settings, mods: firms.mods }).from(firms).where(eq(firms.id, fid)).limit(1) : [];
  return f ? [...klAllowedViews((f.settings as { kl?: KlConfig }).kl, f.mods), 'kdogovori'] : ['klHome', 'klSend', 'lozinka'];
}
