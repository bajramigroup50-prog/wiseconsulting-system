/**
 * Duplicate partners (комитенти) of a firm and merging them into one (like the item merge `mergeItems`):
 * every reference — foreign keys to `partners`, the `partner_id` columns without one (dunning), partner ids inside
 * JSON documents of the firm (compensation rows, payment orders, read drafts…) — moves to the main partner; missing
 * ЕДБ / ЕМБС / address / accounts are filled from the merged ones and their names stay as aliases, so later scans
 * and imports match; the merged rows are deleted.
 *
 * Safety: only partners of one firm; refused when an affected journal is locked or in the locked period (listed);
 * the konto totals are compared before and after inside the transaction (only the partner dimension changes).
 */
import { and, eq, inArray, sql } from 'drizzle-orm';
import { addPartnerAccount, partnerAccountPatch, partnerAccounts, type PartnerAccount } from '@wise/core/bank/partner-accounts';
import { mergedPartnerFields, partnerDuplicates, type PartnerDupGroup } from '@wise/core/partners/match';
import { audit, type Tx } from './audit';
import { firms, invoices, itemSupplierCodes, journalLines, journals, partners, purchases } from './schema/index';

export class PartnerMergeError extends Error {}

type Row = typeof partners.$inferSelect;
const qid = (s: string) => '"' + s.replace(/"/g, '""') + '"';
const rowsOf = <T>(r: unknown): T[] => (Array.isArray(r) ? r : (r as { rows: T[] }).rows) as T[];
const countOf = (r: unknown) => Number((r as { count?: number; rowCount?: number }).count ?? (r as { rowCount?: number }).rowCount ?? 0);

/** Movements per partner (journal lines + invoices + purchases) — the main partner of a group has more. */
export async function partnerMoves(tx: Tx, firmId: string): Promise<Map<string, number>> {
  const R = rowsOf<{ p: string; n: number | string }>(await tx.execute(sql`
    select p, sum(n)::int as n from (
      select partner_id as p, count(*) as n from journal_lines where firm_id = ${firmId}::uuid and partner_id is not null group by 1
      union all select partner_id, count(*) from invoices where firm_id = ${firmId}::uuid and partner_id is not null group by 1
      union all select partner_id, count(*) from purchases where firm_id = ${firmId}::uuid and partner_id is not null group by 1
    ) x group by p`));
  return new Map(R.map((r) => [r.p, Number(r.n)]));
}

export interface PartnerDupView { groups: (PartnerDupGroup & { rows: (Row & { moves: number; score: number; sameId: boolean })[] })[] }

/** The „Дупликати“ view: groups of likely duplicate partners with their movements. */
export async function partnerDupGroups(tx: Tx, firmId: string): Promise<PartnerDupView> {
  const [P, M] = await Promise.all([tx.select().from(partners).where(eq(partners.firmId, firmId)), partnerMoves(tx, firmId)]);
  const by = new Map(P.map((p) => [p.id, p]));
  return {
    groups: partnerDuplicates(P, M).map((g) => ({
      ...g, rows: g.members.map((m) => ({ ...by.get(m.id)!, moves: M.get(m.id) ?? 0, score: m.score, sameId: m.sameId })),
    })),
  };
}

async function kontoTotals(tx: Tx, firmId: string): Promise<string> {
  const R = await tx.select({ a: journalLines.account, d: sql<string>`sum(${journalLines.debit})::text`, c: sql<string>`sum(${journalLines.credit})::text` })
    .from(journalLines).where(eq(journalLines.firmId, firmId)).groupBy(journalLines.account).orderBy(journalLines.account);
  return JSON.stringify(R.map((r) => [r.a, Number(r.d).toFixed(2), Number(r.c).toFixed(2)]));
}

export interface PartnerMergeResult { main: string; merged: number; refs: number; byTable: Record<string, number> }

/**
 * Merge partners `ids` into `mainId` (same firm). Throws {@link PartnerMergeError} when a partner is not of the firm
 * or an affected journal / document is in a locked period.
 */
export async function mergePartners(tx: Tx, a: { firmId: string; userId: string | null }, mainId: string, ids: readonly string[]): Promise<PartnerMergeResult> {
  const others = [...new Set(ids.filter((x) => x !== mainId))];
  if (!others.length) return { main: mainId, merged: 0, refs: 0, byTable: {} };
  const R = await tx.select().from(partners).where(and(eq(partners.firmId, a.firmId), inArray(partners.id, [mainId, ...others]))).for('update');
  const M = R.find((p) => p.id === mainId);
  const D = R.filter((p) => p.id !== mainId);
  if (!M || D.length !== others.length) throw new PartnerMergeError('Комитентите не се од оваа фирма – се спојуваат само комитенти на иста фирма.');

  // locked period / locked nalog → refused, listed
  const [f] = await tx.select({ lock: firms.lockDate }).from(firms).where(eq(firms.id, a.firmId)).limit(1);
  const lock = f?.lock ?? null;
  const LJ = await tx.selectDistinct({ n: journals.number, d: journals.date, locked: journals.locked }).from(journalLines)
    .innerJoin(journals, eq(journals.id, journalLines.journalId))
    .where(and(eq(journalLines.firmId, a.firmId), inArray(journalLines.partnerId, others), lock ? sql`(${journals.locked} or ${journals.date} <= ${lock})` : eq(journals.locked, true)));
  const LD = lock ? [
    ...(await tx.select({ n: invoices.number, d: invoices.date }).from(invoices).where(and(eq(invoices.firmId, a.firmId), inArray(invoices.partnerId, others), sql`${invoices.date} <= ${lock}`))).map((x) => `фактура ${x.n} (${x.d})`),
    ...(await tx.select({ n: purchases.number, d: purchases.date }).from(purchases).where(and(eq(purchases.firmId, a.firmId), inArray(purchases.partnerId, others), sql`${purchases.date} <= ${lock}`))).map((x) => `влезна ${x.n} (${x.d})`),
  ] : [];
  const blocked = [...LJ.map((j) => `налог ${j.n} (${j.d}${j.locked ? ', заклучен' : ''})`), ...LD];
  if (blocked.length) {
    throw new PartnerMergeError(`Не може да се спои: ${blocked.length} ставки се во заклучен период или налог${lock ? ` (заклучено до ${lock})` : ''}: ${blocked.slice(0, 10).join(', ')}${blocked.length > 10 ? ' …' : ''}`);
  }

  const before = await kontoTotals(tx, a.firmId);
  // per-partner unique rows that would collide on the main partner: the supplier item codes the main one has
  const msc = await tx.select({ c: itemSupplierCodes.code }).from(itemSupplierCodes).where(eq(itemSupplierCodes.partnerId, M.id));
  if (msc.length) await tx.delete(itemSupplierCodes).where(and(inArray(itemSupplierCodes.partnerId, others), inArray(itemSupplierCodes.code, msc.map((x) => x.c))));

  const byTable: Record<string, number> = {};
  const add = (t: string, n: number) => { if (n) byTable[t] = (byTable[t] ?? 0) + n; };
  const idList = sql.join(others.map((x) => sql`${x}::uuid`), sql`, `);
  // foreign keys to partners(id), plus partner_id columns without one (e.g. dunning letters)
  const fk = rowsOf<{ tbl: string; col: string }>(await tx.execute(sql`select c.conrelid::regclass::text as tbl, a.attname as col
      from pg_constraint c join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any(c.conkey)
      where c.contype = 'f' and c.confrelid = 'partners'::regclass`));
  const loose = rowsOf<{ tbl: string; col: string }>(await tx.execute(sql`select table_name as tbl, column_name as col from information_schema.columns
      where table_schema = 'public' and data_type = 'uuid' and (column_name = 'partner_id' or column_name like '%\\_partner\\_id') and table_name <> 'partners'`));
  const cols = new Map<string, { tbl: string; col: string }>();
  for (const x of [...fk, ...loose]) { const t = x.tbl.replace(/^public\./, '').replace(/"/g, ''); cols.set(t + '.' + x.col, { tbl: t, col: x.col }); }
  for (const c of cols.values()) {
    const r = await tx.execute(sql`update ${sql.raw(qid(c.tbl))} set ${sql.raw(qid(c.col))} = ${M.id}::uuid where ${sql.raw(qid(c.col))} in (${idList})`);
    add(c.tbl, countOf(r));
  }
  // partner ids inside JSON documents and text references („L|konto|partner|doc“) of the firm, except the audit log
  const js = rowsOf<{ tbl: string; col: string; t: string }>(await tx.execute(sql`select c.table_name as tbl, c.column_name as col, c.data_type as t from information_schema.columns c
      where c.table_schema = 'public' and (c.data_type = 'jsonb' or (c.data_type = 'text' and c.column_name in ('ref_id', 'ref'))) and c.table_name not in ('audit_log', 'partners')
        and exists (select 1 from information_schema.columns f where f.table_schema = 'public' and f.table_name = c.table_name and f.column_name = 'firm_id')`));
  for (const j of js) {
    for (const d of D) {
      const col = sql.raw(qid(j.col));
      const r = j.t === 'jsonb'
        ? await tx.execute(sql`update ${sql.raw(qid(j.tbl))} set ${col} = replace(${col}::text, ${d.id}, ${M.id})::jsonb where firm_id = ${a.firmId}::uuid and ${col}::text like ${'%' + d.id + '%'}`)
        : await tx.execute(sql`update ${sql.raw(qid(j.tbl))} set ${col} = replace(${col}, ${d.id}, ${M.id}) where firm_id = ${a.firmId}::uuid and ${col} like ${'%' + d.id + '%'}`);
      add(j.tbl, countOf(r));
    }
  }

  // the main partner: missing fields, accounts, aliases
  const F = mergedPartnerFields(M, D);
  let acc: PartnerAccount[] = partnerAccounts(M);
  for (const d of D) for (const x of partnerAccounts(d)) acc = addPartnerAccount(acc, x.iban || x.acc, { bank: x.bank, src: x.src ?? 'import', ...(x.at ? { at: x.at } : {}) }).accounts;
  const data = { ...(M.data ?? {}), aliases: F.aliases, ...(F.aliasIds.length ? { aliasIds: F.aliasIds } : {}) };
  const bank = acc.length ? partnerAccountPatch(data, acc) : { data };
  await tx.update(partners).set({
    edb: F.edb, embs: F.embs, address: F.address, city: F.city, email: F.email, phone: F.phone, ...bank,
    vatRegistered: M.vatRegistered || D.some((d) => d.vatRegistered && /^MK/i.test(d.edb ?? '')),
  }).where(eq(partners.id, M.id));
  await tx.delete(partners).where(and(eq(partners.firmId, a.firmId), inArray(partners.id, others)));

  const after = await kontoTotals(tx, a.firmId);
  if (after !== before) throw new PartnerMergeError('Спојувањето би ги сменило салдата по конта – откажано.');
  const refs = Object.values(byTable).reduce((s, n) => s + n, 0);
  await audit(tx, {
    userId: a.userId, firmId: a.firmId, action: 'partnerMerge', entityType: 'partner', entityId: M.id,
    data: { main: { id: M.id, code: M.code, name: M.name }, merged: D.map((d) => ({ id: d.id, code: d.code, name: d.name, edb: d.edb, embs: d.embs })), refs, byTable },
  });
  return { main: M.id, merged: D.length, refs, byTable };
}
