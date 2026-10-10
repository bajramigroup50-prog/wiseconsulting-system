/**
 * Find or create a partner from a read document (legacy `ensureSupplier` 4439, `addSupplier`, `outEnsurePartner`
 * 8408). Matching: tax number (last 7 digits, legacy `draftFromScan`) or the exact name; new partners get the next
 * numeric code (legacy `save('partners')` auto-code, `nextCode` 3293).
 */
import { and, eq } from 'drizzle-orm';
import type { Tx } from '../audit';
import { partners } from '../schema/index';

/** Legacy `nextCode` 3293: next numeric code after the highest one, keeping zero padding. */
export function nextNumericCode(existing: readonly (string | null | undefined)[]): string {
  const L = existing.map((x) => String(x ?? '').trim()).filter((v) => /^\d+$/.test(v));
  let w = 0, mx = 0;
  for (const v of L) { mx = Math.max(mx, +v); if (v.length > 1 && v[0] === '0') w = Math.max(w, v.length); }
  const n = mx + 1;
  return w ? String(n).padStart(w, '0') : String(n);
}

export interface AutoPartnerInput { name: string; edb?: string | null; address?: string | null; city?: string | null; foreign?: boolean; vatRegistered?: boolean; type?: 'customer' | 'supplier' }

/** Existing partner id for the name / tax number, or a new partner. `created` tells which. */
export async function ensurePartner(tx: Tx, firmId: string, p: AutoPartnerInput): Promise<{ id: string; created: boolean }> {
  const name = p.name.trim();
  const ed = String(p.edb ?? '').replace(/\D/g, '');
  const all = await tx.select({ id: partners.id, name: partners.name, edb: partners.edb, code: partners.code }).from(partners).where(eq(partners.firmId, firmId));
  const hit = (ed.length >= 7 && all.find((x) => x.edb && x.edb.replace(/\D/g, '').endsWith(ed.slice(-7))))
    || all.find((x) => x.name.trim().toLowerCase() === name.toLowerCase());
  if (hit) return { id: hit.id, created: false };
  const [row] = await tx.insert(partners).values({
    firmId, code: nextNumericCode(all.map((x) => x.code)), name, edb: p.edb?.trim() || null, address: p.address?.trim() || null, city: p.city?.trim() || null,
    foreign: !!p.foreign, vatRegistered: p.vatRegistered ?? true, data: p.type ? { type: p.type } : {},
  }).returning({ id: partners.id });
  return { id: row!.id, created: true };
}

/** The partner exists in the firm. */
export async function partnerExists(tx: Tx, firmId: string, id: string): Promise<boolean> {
  const [r] = await tx.select({ id: partners.id }).from(partners).where(and(eq(partners.id, id), eq(partners.firmId, firmId))).limit(1);
  return !!r;
}
