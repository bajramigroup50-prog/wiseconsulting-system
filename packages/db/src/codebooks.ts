/**
 * Codebook service (legacy `cbSave` 7369, `cbDel` 7370 / `cbDelRow` 14291 with `cbUsage` 14289, `cbSeedCity` 7145,
 * `paySifSeed` 7144) on the `codes` table. Every mutation writes `audit_log` in the caller's transaction; the
 * permission check (`requireCan`) is the caller's job (`@wise/core` `cbPerm`).
 */
import { and, asc, eq, inArray, is, isNull, ne, or, sql } from 'drizzle-orm';
import { getTableConfig, PgTable, type PgColumn } from 'drizzle-orm/pg-core';
import { cbIsGlobal, cbNextCode, cbSort, cbUsageMessage, type CbInput, type CbKey, type CbRow } from '@wise/core/codebooks';
import { PSIF0 } from '@wise/core';
import { audit, type Tx } from './audit';
import * as S from './schema/index';
import { codes } from './schema/index';
import CITIES from './seed/data/cities.json' with { type: 'json' };

export class CodebookError extends Error {}

const scopeWhere = (firmId: string | null) => (firmId ? eq(codes.firmId, firmId) : isNull(codes.firmId));

/** Rows of a codebook for a firm: its own rows plus the office-wide rows (`global: true`). */
export async function listCodebook(tx: Tx, k: CbKey, firmId: string | null): Promise<CbRow[]> {
  const rows = await tx.select().from(codes)
    .where(and(eq(codes.cb, k), firmId && !cbIsGlobal(k) ? or(isNull(codes.firmId), eq(codes.firmId, firmId)) : isNull(codes.firmId)))
    .orderBy(asc(codes.code));
  return cbSort(rows.map((r) => ({ id: r.id, code: r.code, name: r.name, global: r.firmId == null, data: r.data ?? {} })));
}

/** Row counts per codebook for „Сите шифрарници“ (firm rows + office-wide rows). */
export async function codebookCounts(tx: Tx, firmId: string | null): Promise<Record<string, number>> {
  const rows = await tx.select({ cb: codes.cb, global: sql<boolean>`${codes.firmId} is null`, n: sql<number>`count(*)::int` }).from(codes)
    .where(firmId ? or(isNull(codes.firmId), eq(codes.firmId, firmId)) : isNull(codes.firmId))
    .groupBy(codes.cb, sql`${codes.firmId} is null`);
  const out: Record<string, number> = {};
  for (const r of rows) {
    if (!r.global && cbIsGlobal(r.cb as CbKey)) continue;
    out[r.cb] = (out[r.cb] ?? 0) + r.n;
  }
  return out;
}

export interface SaveCodeInput { userId: string; firmId: string | null; k: CbKey; id?: string | null; input: CbInput }

/**
 * Insert or update one row. New rows of office-wide codebooks get `firm_id NULL`, others the firm's id; an existing
 * row keeps its scope (editing an office-wide row needs `settings`, checked by the caller via `codeScope`).
 * A duplicate code in the same list is refused with the next free code.
 */
export async function saveCode(tx: Tx, a: SaveCodeInput): Promise<string> {
  let scope: string | null = cbIsGlobal(a.k) ? null : a.firmId;
  if (a.id) {
    const [r] = await tx.select().from(codes).where(and(eq(codes.id, a.id), eq(codes.cb, a.k))).limit(1);
    if (!r || (r.firmId && r.firmId !== a.firmId)) throw new CodebookError('Записот не постои.');
    scope = r.firmId;
  } else if (!scope && !cbIsGlobal(a.k)) throw new CodebookError('Изберете фирма.');
  const { code, name, data } = a.input;
  if (code) {
    const [dup] = await tx.select({ name: codes.name }).from(codes)
      .where(and(eq(codes.cb, a.k), scopeWhere(scope), eq(codes.code, code), a.id ? ne(codes.id, a.id) : undefined)).limit(1);
    if (dup) {
      const all = await tx.select({ code: codes.code }).from(codes).where(and(eq(codes.cb, a.k), scopeWhere(scope)));
      throw new CodebookError(`Шифрата ${code} веќе ја има „${dup.name}“. Следна слободна: ${cbNextCode(all.map((x) => x.code))}`);
    }
  }
  if (a.id) {
    await tx.update(codes).set({ code, name, data }).where(eq(codes.id, a.id));
    await audit(tx, { userId: a.userId, firmId: scope, action: 'cbSave', entityType: `code:${a.k}`, entityId: a.id, data: { code, name, ...data } });
    return a.id;
  }
  const [r] = await tx.insert(codes).values({ firmId: scope, cb: a.k, code, name, data }).returning({ id: codes.id });
  await audit(tx, { userId: a.userId, firmId: scope, action: 'cbNew', entityType: `code:${a.k}`, entityId: r!.id, data: { code, name, ...data } });
  return r!.id;
}

/** Scope of an existing row (`null` = office-wide) or `undefined` when it doesn't exist. */
export async function codeScope(tx: Tx, id: string): Promise<{ firmId: string | null; cb: string; name: string; code: string | null } | undefined> {
  const [r] = await tx.select({ firmId: codes.firmId, cb: codes.cb, name: codes.name, code: codes.code }).from(codes).where(eq(codes.id, id)).limit(1);
  return r;
}

/** Every foreign key in the schema that points at `codes.id` (warehouses, stores, … used by documents). */
function codeReferences(): { table: PgTable; name: string; col: PgColumn }[] {
  const out: { table: PgTable; name: string; col: PgColumn }[] = [];
  for (const t of Object.values(S)) {
    if (!is(t, PgTable)) continue;
    const c = getTableConfig(t);
    for (const fk of c.foreignKeys) {
      const r = fk.reference();
      if (getTableConfig(r.foreignTable).name !== 'codes') continue;
      for (const col of r.columns) out.push({ table: t, name: c.name, col });
    }
  }
  return out;
}

/** Legacy `cbUsage`: how many rows of each table use the code. */
export async function codeUsage(tx: Tx, id: string): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const ref of codeReferences()) {
    const [r] = (await tx.select({ n: sql<number>`count(*)::int` }).from(ref.table).where(eq(ref.col, id))) as [{ n: number }];
    if (r.n) out[ref.name] = (out[ref.name] ?? 0) + r.n;
  }
  return out;
}

/** Delete a row unless it is used (legacy `cbDelRow`). Returns the refusal message, or null when deleted. */
export async function deleteCode(tx: Tx, a: { userId: string; firmId: string | null; id: string }): Promise<string | null> {
  const r = await codeScope(tx, a.id);
  if (!r || (r.firmId && r.firmId !== a.firmId)) throw new CodebookError('Записот не постои.');
  const msg = cbUsageMessage(r.name || r.code || '', await codeUsage(tx, a.id));
  if (msg) return msg;
  await tx.delete(codes).where(eq(codes.id, a.id));
  await audit(tx, { userId: a.userId, firmId: r.firmId, action: 'cbDelRow', entityType: `code:${r.cb}`, entityId: a.id, data: { code: r.code, name: r.name } });
  return null;
}

/** Legacy `cbSeedCity`: the Macedonian cities into the (office-wide) city list; existing codes are kept. */
export async function seedCities(tx: Tx, userId: string): Promise<number> {
  const C = CITIES as [string, string, string, string][];
  const have = new Set((await tx.select({ code: codes.code }).from(codes).where(and(eq(codes.cb, 'city'), isNull(codes.firmId)))).map((r) => r.code));
  const add = C.filter(([code]) => !have.has(code));
  if (add.length) await tx.insert(codes).values(add.map(([code, name, postal, muni]) => ({ cb: 'city', code, name, data: { postal, muni } })));
  await audit(tx, { userId, action: 'cbSeedCity', entityType: 'code:city', data: { added: add.length } });
  return add.length;
}

/** Legacy `paySifSeed`: copy the standard payroll codes (`PSIF0`) into the firm's list so they can be changed. */
export async function seedPaySif(tx: Tx, a: { userId: string; firmId: string }): Promise<number> {
  const have = new Set((await tx.select({ code: codes.code }).from(codes)
    .where(and(eq(codes.cb, 'paysif'), eq(codes.firmId, a.firmId)))).map((r) => r.code));
  const add = PSIF0.filter((r) => !have.has(r.code));
  if (add.length) {
    await tx.insert(codes).values(add.map((r) => ({
      firmId: a.firmId, cb: 'paysif', code: r.code, name: r.name, data: { cat: r.cat, pct: r.pct, payer: r.payer, mpin: r.mpin, basis: r.basis },
    })));
  }
  await audit(tx, { userId: a.userId, firmId: a.firmId, action: 'paySifSeed', entityType: 'code:paysif', data: { added: add.length } });
  return add.length;
}

/** Codes by id (for labels), e.g. a price list header. */
export async function codesById(tx: Tx, ids: readonly string[]) {
  return ids.length ? tx.select().from(codes).where(inArray(codes.id, [...ids])) : [];
}
