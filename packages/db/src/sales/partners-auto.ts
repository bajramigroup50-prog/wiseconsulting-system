/**
 * Find or create a partner from a read document (legacy `ensureSupplier` 4439, `addSupplier`, `outEnsurePartner`
 * 8408). Matching: ЕДБ / ЕМБС / bank account, a learned or the same name; new partners get the next
 * numeric code (legacy `save('partners')` auto-code, `nextCode` 3293).
 */
import { and, eq, sql } from 'drizzle-orm';
import type { Tx } from '../audit';
import { partners } from '../schema/index';
import { addPartnerAccount, partnerAccountPatch } from '@wise/core/bank/partner-accounts';
import { classifyPartnerId, findPartnerMatch, partnerById } from '@wise/core/partners/match';

/** Legacy `nextCode` 3293: next numeric code after the highest one, keeping zero padding. */
export function nextNumericCode(existing: readonly (string | null | undefined)[]): string {
  const L = existing.map((x) => String(x ?? '').trim()).filter((v) => /^\d+$/.test(v));
  let w = 0, mx = 0;
  for (const v of L) { mx = Math.max(mx, +v); if (v.length > 1 && v[0] === '0') w = Math.max(w, v.length); }
  const n = mx + 1;
  return w ? String(n).padStart(w, '0') : String(n);
}

export interface AutoPartnerInput {
  name: string;
  /** The tax / registration number read from the document: a 13-digit ЕДБ goes to `edb`, a 7-digit ЕМБС to `embs`. */
  edb?: string | null;
  embs?: string | null;
  address?: string | null; city?: string | null; foreign?: boolean; vatRegistered?: boolean; type?: 'customer' | 'supplier';
  /** Bank account read from the document (saved as the partner's account). */
  bankAccount?: string | null;
}

/**
 * Existing partner id for the identifier (ЕДБ / ЕМБС / bank account), a learned name or the same name
 * (`@wise/core/partners/match`, never a merely similar one), or a new partner. `created` tells which.
 * FIX: legacy matched the last 7 digits of the ЕДБ and stored a 7-digit ЕМБС as the ЕДБ.
 */
export async function ensurePartner(tx: Tx, firmId: string, p: AutoPartnerInput): Promise<{ id: string; created: boolean; code: string | null }> {
  const name = p.name.trim();
  // one partner create per firm at a time: concurrent reads never collide on the next code (or a twin card)
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${'partner:' + firmId}))`);
  const all = await tx.select({ id: partners.id, name: partners.name, edb: partners.edb, embs: partners.embs, code: partners.code, bankAccount: partners.bankAccount, bankName: partners.bankName, data: partners.data })
    .from(partners).where(eq(partners.firmId, firmId));
  const id = classifyPartnerId(p.edb);
  const em = classifyPartnerId(p.embs);
  const hit = (em.kind === 'embs' ? partnerById(all, em)?.p : null)
    ?? findPartnerMatch(all, { name, id: p.edb, bankAccount: p.bankAccount }, { fuzzy: false }).partner;
  if (hit) return { id: hit.id, created: false, code: hit.code };
  const edb = id.kind === 'edb' ? id.store : id.kind === '' && id.value.length > 7 ? String(p.edb).trim() : null;
  const embs = em.kind === 'embs' ? em.value : id.kind === 'embs' ? id.value : null;
  const acc = p.bankAccount ? addPartnerAccount([], p.bankAccount, { src: 'invoice' }) : null;
  const bank = acc && acc.added ? partnerAccountPatch(p.type ? { type: p.type } : {}, acc.accounts) : null;
  const [row] = await tx.insert(partners).values({
    firmId, code: nextNumericCode(all.map((x) => x.code)), name, edb, embs, address: p.address?.trim() || null, city: p.city?.trim() || null,
    foreign: !!p.foreign, vatRegistered: p.vatRegistered ?? true, ...(bank ?? { data: p.type ? { type: p.type } : {} }),
  }).returning({ id: partners.id, code: partners.code });
  return { id: row!.id, created: true, code: row!.code };
}

/** The partner exists in the firm. */
export async function partnerExists(tx: Tx, firmId: string, id: string): Promise<boolean> {
  const [r] = await tx.select({ id: partners.id }).from(partners).where(and(eq(partners.id, id), eq(partners.firmId, firmId))).limit(1);
  return !!r;
}
