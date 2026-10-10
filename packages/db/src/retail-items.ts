/**
 * Item master maintenance and Excel / CSV / XML import — persistence for legacy `artNames` (17360), `artQ` (11276,
 * merge `artMerge` 11266), `artKonta` (8445), `barkodi` (9201) and `uvoz` / `uvozMat` / `uvozMalo` (5413, 17222).
 * Every function runs in the caller's transaction and writes `audit_log`.
 */
import { nextNumericCode } from './sales/partners-auto';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { r2, r4 } from '@wise/core/stock/num';
import {
  artFixName, artRoleFields, eanNextInternal, impItemType, impPurchaseGroups, impYes, type ArtRole, type ImpType,
} from '@wise/core/retail';
import { audit, type Tx } from './audit';
import { postJournal } from './posting';
import {
  boms, codes, employees, itemBarcodes, items, itemSupplierCodes, partners, type Item,
} from './schema/index';
import { StockDocError, loadStockContext, replaceSourceMoves, setRetailPrices, whId, requireLocation } from './stock-service';
import { saveLevelling, saveStockCount, type Actor } from './stock-docs';
import { savePurchase } from './sales/purchases';
import { saveInvoice } from './sales/invoices';

const n = (v: unknown) => { const x = Number(v); return Number.isFinite(x) ? x : 0; };
const dataOf = (it: Pick<Item, 'data'>) => ({ ...((it.data ?? {}) as Record<string, unknown>) });

async function firmItem(tx: Tx, firmId: string, id: string): Promise<Item> {
  const [it] = await tx.select().from(items).where(and(eq(items.firmId, firmId), eq(items.id, id))).limit(1);
  if (!it) throw new StockDocError('Артиклот не постои.');
  return it;
}

/** Rename items keeping the old names as aliases (legacy `aliases`, used to recognise items on import). */
export async function renameItems(tx: Tx, a: Actor, changes: readonly { id: string; name: string }[], action: string, keepAlias = true): Promise<number> {
  let c = 0;
  for (const ch of changes) {
    const name = ch.name.trim();
    if (!name) continue;
    const it = await firmItem(tx, a.firmId, ch.id);
    if (it.name === name) continue;
    const d = dataOf(it);
    if (keepAlias) d.aliases = [...new Set([...((d.aliases as string[] | undefined) ?? []), it.name])];
    await tx.update(items).set({ name, data: d }).where(eq(items.id, it.id));
    c++;
  }
  if (c) await audit(tx, { userId: a.userId, firmId: a.firmId, action, entityType: 'item', data: { renamed: c } });
  return c;
}

/** Legacy `artUnitsGo`: set standard units by a map from the unit as typed. */
export async function setItemUnits(tx: Tx, a: Actor, map: Readonly<Record<string, string>>): Promise<number> {
  let c = 0;
  for (const [from, to] of Object.entries(map)) {
    if (!to.trim() || from === to) continue;
    const r = await tx.update(items).set({ unit: to.trim() })
      .where(and(eq(items.firmId, a.firmId), from ? sql`trim(${items.unit}) = ${from}` : sql`coalesce(trim(${items.unit}), '') = ''`)).returning({ id: items.id });
    c += r.length;
  }
  if (c) await audit(tx, { userId: a.userId, firmId: a.firmId, action: 'artUnitsGo', entityType: 'item', data: { changed: c, map } });
  return c;
}

/** Legacy `artFmt`: collapse spaces and ALL CAPS names (abbreviation rules applied too). */
export async function tidyItemNames(tx: Tx, a: Actor, abbr: Readonly<Record<string, string>>, ids?: readonly string[]): Promise<number> {
  const rows = await tx.select({ id: items.id, name: items.name }).from(items).where(and(eq(items.firmId, a.firmId), eq(items.active, true), ids ? inArray(items.id, [...ids]) : undefined));
  const ch = rows.map((r) => ({ id: r.id, name: artFixName(r.name, abbr) })).filter((x, i) => x.name !== rows[i]!.name);
  return renameItems(tx, a, ch, 'artFmt');
}

const qid = (s: string) => '"' + s.replace(/"/g, '""') + '"';

/**
 * Merge duplicate items into a master (legacy `artMerge` 11266): every reference (foreign keys to `items` and item ids
 * inside JSON documents of the firm) is moved to the master; barcodes, supplier codes and the old names (aliases) are
 * kept on the master; the duplicates are deleted.
 */
export async function mergeItems(tx: Tx, a: Actor, masterId: string, ids: readonly string[]): Promise<{ merged: number; refs: number }> {
  const M = await firmItem(tx, a.firmId, masterId);
  const dupIds = [...new Set(ids.filter((x) => x !== masterId))];
  if (!dupIds.length) return { merged: 0, refs: 0 };
  const D = await tx.select().from(items).where(and(eq(items.firmId, a.firmId), inArray(items.id, dupIds)));
  if (D.length !== dupIds.length) throw new StockDocError('Артиклот не постои.');
  // per-item unique rows that would collide on the master
  const mb = await tx.select({ id: boms.id }).from(boms).where(eq(boms.productId, M.id)).limit(1);
  if (mb.length) await tx.delete(boms).where(inArray(boms.productId, dupIds));
  else {
    const keep = (await tx.select({ id: boms.id }).from(boms).where(inArray(boms.productId, dupIds)).limit(1))[0];
    if (keep) await tx.delete(boms).where(and(inArray(boms.productId, dupIds), sql`${boms.id} <> ${keep.id}`));
  }
  const msc = await tx.select({ p: itemSupplierCodes.partnerId, c: itemSupplierCodes.code }).from(itemSupplierCodes).where(eq(itemSupplierCodes.itemId, M.id));
  for (const s of msc) {
    await tx.delete(itemSupplierCodes).where(and(inArray(itemSupplierCodes.itemId, dupIds), eq(itemSupplierCodes.code, s.c), s.p ? eq(itemSupplierCodes.partnerId, s.p) : sql`${itemSupplierCodes.partnerId} is null`));
  }
  await tx.update(itemBarcodes).set({ primary: false }).where(inArray(itemBarcodes.itemId, dupIds));
  // foreign keys referencing items(id)
  const fks = (await tx.execute(sql`select c.conrelid::regclass::text as tbl, a.attname as col
      from pg_constraint c join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any(c.conkey)
      where c.contype = 'f' and c.confrelid = 'items'::regclass`)) as unknown as { tbl: string; col: string }[] | { rows: { tbl: string; col: string }[] };
  const fkRows = Array.isArray(fks) ? fks : fks.rows;
  let refs = 0;
  const idList = sql.join(dupIds.map((x) => sql`${x}::uuid`), sql`, `);
  for (const f of fkRows) {
    const r = await tx.execute(sql`update ${sql.raw(f.tbl.split('.').map(qid).join('.'))} set ${sql.raw(qid(f.col))} = ${M.id}::uuid where ${sql.raw(qid(f.col))} in (${idList})`);
    refs += Number((r as { count?: number; rowCount?: number }).count ?? (r as { rowCount?: number }).rowCount ?? 0);
  }
  // item ids inside JSON documents of the firm (jsonb columns of tables with firm_id, except the audit log)
  const js = (await tx.execute(sql`select c.table_name as tbl, c.column_name as col from information_schema.columns c
      where c.table_schema = 'public' and c.data_type = 'jsonb' and c.table_name <> 'audit_log'
        and exists (select 1 from information_schema.columns f where f.table_schema = 'public' and f.table_name = c.table_name and f.column_name = 'firm_id')`)) as unknown as { tbl: string; col: string }[] | { rows: { tbl: string; col: string }[] };
  const jsRows = Array.isArray(js) ? js : js.rows;
  for (const j of jsRows) {
    for (const d of dupIds) {
      const r = await tx.execute(sql`update ${sql.raw(qid(j.tbl))} set ${sql.raw(qid(j.col))} = replace(${sql.raw(qid(j.col))}::text, ${d}, ${M.id})::jsonb
          where firm_id = ${a.firmId}::uuid and ${sql.raw(qid(j.col))}::text like ${'%' + d + '%'}`);
      refs += Number((r as { count?: number; rowCount?: number }).count ?? (r as { rowCount?: number }).rowCount ?? 0);
    }
  }
  const md = dataOf(M);
  md.aliases = [...new Set([...((md.aliases as string[] | undefined) ?? []), ...D.map((i) => i.name).filter((x) => x !== M.name), ...D.flatMap((i) => (dataOf(i).aliases as string[] | undefined) ?? [])])];
  await tx.update(items).set({ data: md, code: M.code || D.find((i) => i.code)?.code || null }).where(eq(items.id, M.id));
  await tx.delete(items).where(inArray(items.id, dupIds));
  await audit(tx, { userId: a.userId, firmId: a.firmId, action: 'artMerge', entityType: 'item', entityId: M.id, data: { master: M.name, merged: D.map((i) => i.name), refs } });
  return { merged: D.length, refs };
}

/** Legacy `akSave` (8470): item role → type and raw-material account, own-production cost price / %. */
export async function setItemRoles(tx: Tx, a: Actor, changes: readonly { id: string; role: ArtRole; costPrice?: number | null; costPct?: number | null }[], rawK: string): Promise<{ n: number; missing: string[] }> {
  let c = 0;
  const missing: string[] = [];
  for (const ch of changes) {
    const it = await firmItem(tx, a.firmId, ch.id);
    const f = artRoleFields(ch.role, it.rawAccount || rawK);
    const v: Partial<Item> = { type: f.type, rawAccount: f.rawAccount };
    if (ch.costPrice !== undefined) v.costPrice = ch.costPrice == null ? null : String(ch.costPrice);
    if (ch.costPct !== undefined) v.costPct = ch.costPct == null ? null : String(ch.costPct);
    if (ch.role === 'prod' && !n(v.costPrice ?? it.costPrice) && !n(v.costPct ?? it.costPct)) missing.push(it.name);
    await tx.update(items).set(v).where(eq(items.id, it.id));
    c++;
  }
  if (c) await audit(tx, { userId: a.userId, firmId: a.firmId, action: 'akSave', entityType: 'item', data: { changed: c } });
  return { n: c, missing };
}

/** Legacy `bkGen`: internal EAN-13 `29…` for every active non-service item without a barcode. */
export async function assignInternalBarcodes(tx: Tx, a: Actor): Promise<number> {
  const used = (await tx.select({ b: itemBarcodes.barcode }).from(itemBarcodes).where(eq(itemBarcodes.firmId, a.firmId))).map((r) => r.b);
  const its = await tx.select({ id: items.id }).from(items)
    .where(and(eq(items.firmId, a.firmId), eq(items.active, true), sql`${items.type} <> 'service'`, sql`not exists (select 1 from ${itemBarcodes} b where b.item_id = ${items.id})`));
  const U = new Set(used);
  for (const it of its) {
    const c = eanNextInternal(U);
    U.add(c);
    await tx.insert(itemBarcodes).values({ firmId: a.firmId, itemId: it.id, barcode: c, primary: true });
  }
  if (its.length) await audit(tx, { userId: a.userId, firmId: a.firmId, action: 'bkGen', entityType: 'item', data: { assigned: its.length } });
  return its.length;
}

/* ================================================================== import */

export interface RetailImportResult { add: number; upd: number; newP: number; skip: string[] }
/** One parsed row: field key → cell value (numbers already parsed by the client with the detected decimal mode). */
export type ImpRow = Record<string, string | number | null | undefined>;

const gs = (r: ImpRow, k: string) => String(r[k] ?? '').trim();
const gn = (r: ImpRow, k: string) => (typeof r[k] === 'number' ? (r[k] as number) : n(String(r[k] ?? '').replace(',', '.')));
const has = (r: ImpRow, k: string) => r[k] !== undefined && r[k] !== null && r[k] !== '';

async function nextItemCode(tx: Tx, firmId: string): Promise<string> {
  const [r] = await tx.select({ m: sql<number>`coalesce(max(case when ${items.code} ~ '^[0-9]{1,15}$' then ${items.code}::bigint end), 0)` }).from(items).where(eq(items.firmId, firmId));
  return String(Math.max(1000, Number(r?.m ?? 0)) + 1);
}

/** Item by code, barcode, exact name or an alias (legacy `matchItem` + `artKey` recognition, simplified to exact). */
async function findItem(tx: Tx, firmId: string, code: string, bc: string, name: string): Promise<Item | undefined> {
  if (code) {
    const [x] = await tx.select().from(items).where(and(eq(items.firmId, firmId), eq(items.code, code))).limit(1);
    if (x) return x;
  }
  for (const b of [bc, code].filter(Boolean)) {
    const [x] = await tx.select({ it: items }).from(itemBarcodes).innerJoin(items, eq(items.id, itemBarcodes.itemId)).where(and(eq(itemBarcodes.firmId, firmId), eq(itemBarcodes.barcode, b))).limit(1);
    if (x) return x.it;
  }
  if (name) {
    const [x] = await tx.select().from(items).where(and(eq(items.firmId, firmId), sql`lower(${items.name}) = lower(${name})`)).limit(1);
    if (x) return x;
    const [y] = await tx.select().from(items).where(and(eq(items.firmId, firmId), sql`${items.data}->'aliases' ? ${name}`)).limit(1);
    if (y) return y;
  }
  return undefined;
}

async function findPartner(tx: Tx, firmId: string, name: string, edb: string) {
  const e = edb.replace(/\D/g, '');
  if (e) {
    const [p] = await tx.select().from(partners).where(and(eq(partners.firmId, firmId), sql`regexp_replace(coalesce(${partners.edb}, ''), '\\D', '', 'g') like ${'%' + e.slice(-7)}`)).limit(1);
    if (p) return p;
  }
  if (name) {
    const [p] = await tx.select().from(partners).where(and(eq(partners.firmId, firmId), sql`lower(${partners.name}) = lower(${name})`)).limit(1);
    if (p) return p;
  }
  return undefined;
}

/**
 * Import parsed rows of one type (legacy `impExec` 5434 + stock-list imports `lagImpGo` 7926 / `lagImport` 4949).
 * Each row runs in its own savepoint: a failing row is skipped with a message, the others are kept.
 */
export async function importRows(tx: Tx, a: Actor & { role: string }, t: ImpType, rows: readonly ImpRow[], o: { date: string; wh?: string | null; today: string }): Promise<RetailImportResult> {
  const R: RetailImportResult = { add: 0, upd: 0, newP: 0, skip: [] };
  const ensureP = async (name: string, edb: string): Promise<string> => {
    const p = await findPartner(tx, a.firmId, name, edb);
    if (p) return p.id;
    // legacy `save('partners')` auto-code (AUTO_CODE 3288): new partners get the next numeric code
    const [c] = await tx.insert(partners).values({ firmId: a.firmId, code: await nextPartnerCode(), name, edb: edb.replace(/\D/g, '') || null, vatRegistered: true }).returning({ id: partners.id });
    R.newP++;
    return c!.id;
  };
  const nextPartnerCode = async () => nextNumericCode((await tx.select({ c: partners.code }).from(partners).where(eq(partners.firmId, a.firmId))).map((x) => x.c));
  const row = async (label: string, f: () => Promise<void>) => {
    try { await tx.transaction(async () => { await f(); }); } catch (e) { R.skip.push(label + ': ' + (e instanceof Error ? e.message : String(e))); }
  };

  if (t === 'partners') {
    for (const r of rows) {
      const name = gs(r, 'name');
      if (!name) { R.skip.push('ред без назив'); continue; }
      await row(name, async () => {
        const v: Partial<typeof partners.$inferInsert> = { name };
        if (gs(r, 'edb')) v.edb = gs(r, 'edb');
        if (gs(r, 'code')) v.code = gs(r, 'code');
        if (gs(r, 'address')) v.address = gs(r, 'address');
        if (gs(r, 'city')) v.city = gs(r, 'city');
        if (gs(r, 'bank')) v.bankAccount = gs(r, 'bank');
        if (gs(r, 'email')) v.email = gs(r, 'email');
        if (gs(r, 'phone')) v.phone = gs(r, 'phone');
        if (has(r, 'ddv')) v.vatRegistered = impYes(gs(r, 'ddv'));
        const ex = await findPartner(tx, a.firmId, name, gs(r, 'edb'));
        if (ex) { await tx.update(partners).set(v).where(eq(partners.id, ex.id)); R.upd++; }
        else { await tx.insert(partners).values({ vatRegistered: true, ...v, code: v.code || await nextPartnerCode(), firmId: a.firmId, name }); R.add++; }
      });
    }
  }

  if (t === 'items') {
    for (const r of rows) {
      const name = gs(r, 'name');
      if (!name) { R.skip.push('ред без назив'); continue; }
      await row(name, async () => {
        const code = gs(r, 'code'), bc = gs(r, 'barcode').replace(/\D/g, '');
        const v: Partial<typeof items.$inferInsert> = { name, unit: gs(r, 'unit') || 'ком', type: impItemType(gs(r, 'type')) };
        if (has(r, 'price')) v.price = String(gn(r, 'price'));
        if (has(r, 'rate')) v.vatRate = Math.trunc(gn(r, 'rate'));
        if (has(r, 'min')) v.minStock = String(gn(r, 'min'));
        if (has(r, 'weight')) v.weight = String(gn(r, 'weight'));
        if (gs(r, 'oe')) v.oe = gs(r, 'oe');
        if (gs(r, 'cross')) v.crossRefs = gs(r, 'cross');
        if (gs(r, 'fits')) v.fits = gs(r, 'fits');
        if (v.vatRate != null && ![0, 5, 10, 18].includes(v.vatRate)) throw new StockDocError('ДДВ стапка ' + v.vatRate);
        const byCode = code ? (await tx.select().from(items).where(and(eq(items.firmId, a.firmId), eq(items.code, code))).limit(1))[0] : undefined;
        const owner = bc ? (await tx.select({ it: items }).from(itemBarcodes).innerJoin(items, eq(items.id, itemBarcodes.itemId)).where(and(eq(itemBarcodes.firmId, a.firmId), eq(itemBarcodes.barcode, bc))).limit(1))[0]?.it : undefined;
        const ex = byCode ?? owner;
        if (ex && !byCode && code && String(ex.code ?? '') !== code) throw new StockDocError(`баркодот ${bc} веќе е на артиклот шифра ${ex.code ?? ''} „${ex.name}“ – редот е прескокнат`);
        let id: string;
        if (ex) { await tx.update(items).set(v).where(eq(items.id, ex.id)); id = ex.id; R.upd++; }
        else {
          const [c] = await tx.insert(items).values({ vatRate: 18, price: '0', ...v, name, firmId: a.firmId, code: code || await nextItemCode(tx, a.firmId) }).returning({ id: items.id });
          id = c!.id; R.add++;
        }
        if (bc && !owner) {
          const cur = await tx.select({ b: itemBarcodes.barcode }).from(itemBarcodes).where(eq(itemBarcodes.itemId, id));
          if (cur.length) R.skip.push(`${name}: во Excel баркод ${bc}, артиклот има ${cur[0]!.b} – не е сменет (ако е втор баркод, додајте го рачно)`);
          else await tx.insert(itemBarcodes).values({ firmId: a.firmId, itemId: id, barcode: bc, primary: true });
        } else if (bc && owner && owner.id !== id) R.skip.push(`${name}: баркодот ${bc} веќе е на „${owner.name}“`);
      });
    }
  }

  if (t === 'employees') {
    for (const r of rows) {
      const name = gs(r, 'name');
      if (!name) { R.skip.push('ред без име'); continue; }
      await row(name, async () => {
        const v: Partial<typeof employees.$inferInsert> = { name };
        for (const k of ['position', 'bankAcc', 'bank', 'address', 'city', 'email'] as const) if (gs(r, k)) v[k] = gs(r, k);
        if (gs(r, 'embg')) v.embg = gs(r, 'embg').replace(/\D/g, '').padStart(13, '0');
        if (has(r, 'netBase')) v.netBase = String(r2(gn(r, 'netBase')));
        if (has(r, 'coef')) v.coef = String(gn(r, 'coef') || 1);
        for (const k of ['start', 'end'] as const) if (/^\d{4}-\d{2}-\d{2}$/.test(gs(r, k))) v[k] = gs(r, k);
        const [ex] = v.embg
          ? await tx.select().from(employees).where(and(eq(employees.firmId, a.firmId), eq(employees.embg, v.embg))).limit(1)
          : await tx.select().from(employees).where(and(eq(employees.firmId, a.firmId), sql`lower(${employees.name}) = lower(${name})`)).limit(1);
        if (ex) { await tx.update(employees).set(v).where(eq(employees.id, ex.id)); R.upd++; }
        else { await tx.insert(employees).values({ ...v, name, firmId: a.firmId, active: true }); R.add++; }
      });
    }
  }

  if (t === 'purchases') {
    for (const r of rows) {
      const number = gs(r, 'number'), date = gs(r, 'date'), pn = gs(r, 'partner');
      if (!number || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !pn) { R.skip.push((number || '?') + ': нема број/датум/добавувач'); continue; }
      await row(number, async () => {
        const groups = impPurchaseGroups((k) => gn(r, k), (k) => has(r, k), gs(r, 'konto') || '4000');
        if (!groups.length) throw new StockDocError('нема износи');
        const pid = await ensureP(pn, gs(r, 'edb'));
        const due = gs(r, 'due');
        await savePurchase(tx, a.firmId, { number, date, docDate: date, due: /^\d{4}-\d{2}-\d{2}$/.test(due) ? due : null, partnerId: pid, ptype: 'cost', groups }, { userId: a.userId, role: a.role });
        R.add++;
      });
    }
  }

  if (t === 'invoices') {
    const by = new Map<string, ImpRow[]>();
    for (const r of rows) {
      const number = gs(r, 'number');
      if (!number) { R.skip.push('ред без број'); continue; }
      by.set(number, [...(by.get(number) ?? []), r]);
    }
    for (const [number, Rs] of by) {
      const r0 = Rs[0]!;
      const date = gs(r0, 'date'), pn = gs(r0, 'partner');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !pn) { R.skip.push(number + ': нема датум/купувач'); continue; }
      await row(number, async () => {
        const pid = await ensureP(pn, gs(r0, 'edb'));
        const lines = [];
        for (const r of Rs) {
          const it = await findItem(tx, a.firmId, gs(r, 'code'), '', gs(r, 'item'));
          lines.push({
            itemId: it?.id ?? null, name: gs(r, 'item') || it?.name || 'Ставка', unit: it?.unit ?? 'ком', qty: gn(r, 'qty') || 1,
            price: has(r, 'price') ? gn(r, 'price') : n(it?.price), disc: gn(r, 'disc'), rate: has(r, 'rate') ? gn(r, 'rate') : it?.vatRate ?? 18, account: it?.revenueAccount ?? null,
          });
        }
        const due = gs(r0, 'due');
        await saveInvoice(tx, a.firmId, { kind: 'invoice', number, date, due: /^\d{4}-\d{2}-\d{2}$/.test(due) ? due : date, partnerId: pid, lines }, { userId: a.userId, role: a.role });
        R.add++;
      });
    }
  }

  if (t === 'journal') {
    const by = new Map<string, { date: string; desc: string; lines: { account: string; debit: number; credit: number; partnerId: string | null; note: string | null }[] }>();
    for (const r of rows) {
      const date = gs(r, 'date'), k = gs(r, 'k');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !k) { R.skip.push('ред без датум/конто'); continue; }
      const key = gs(r, 'no') || date;
      if (!by.has(key)) by.set(key, { date, desc: gs(r, 'desc') || 'Увезен налог ' + key, lines: [] });
      const pn = gs(r, 'partner');
      const p = pn ? await findPartner(tx, a.firmId, pn, '') : undefined;
      by.get(key)!.lines.push({ account: k, debit: r2(gn(r, 'd')), credit: r2(gn(r, 'p')), partnerId: p?.id ?? null, note: gs(r, 'desc') || null });
    }
    for (const [key, J] of by) {
      const D = r2(J.lines.reduce((s, l) => s + l.debit, 0)), P = r2(J.lines.reduce((s, l) => s + l.credit, 0));
      if (Math.abs(D - P) > 0.01) { R.skip.push(`налог ${key}: не е во рамнотежа (${D.toFixed(2)} / ${P.toFixed(2)})`); continue; }
      await row('налог ' + key, async () => {
        await postJournal(tx, { firmId: a.firmId, date: J.date, kind: 'manual', description: J.desc, lines: J.lines.filter((l) => l.debit || l.credit), userId: a.userId, auditAction: 'impJournal', requirePartner: false });
        R.add++;
      });
    }
  }

  if (t === 'stock' || t === 'in') {
    const L0 = await loadStockContext(tx, a.firmId);
    const W0 = t === 'in' ? requireLocation(L0, o.wh) : null;
    const isStore = !!W0 && L0.locations.some((l) => l.id === W0 && l.kind === 'store');
    const srcId = crypto.randomUUID();
    const moves: import('@wise/core').StockMove[] = [];
    const sp = new Map<string, number>();
    const locs = await tx.select({ id: codes.id, code: codes.code, name: codes.name }).from(codes).where(and(eq(codes.firmId, a.firmId), inArray(codes.cb, ['warehouse', 'store'])));
    let i = 0;
    for (const r of rows) {
      i++;
      const bc = gs(r, 'barcode').replace(/\D/g, ''), code = gs(r, 'code'), name = gs(r, 'name');
      const q = gn(r, 'qty');
      if ((!code && !bc && !name) || !q) { R.skip.push((code || bc || name || '?') + ': нема шифра/баркод/количина'); continue; }
      if (/^(вкупно|total)/i.test(code || name)) continue;
      let it = await findItem(tx, a.firmId, code, bc, t === 'in' ? name : '');
      if (!it) {
        const nm = name || code || bc;
        const mpc = gn(r, 'mpc');
        const [c] = await tx.insert(items).values({
          firmId: a.firmId, code: code || await nextItemCode(tx, a.firmId), name: nm, type: 'goods', unit: gs(r, 'unit') || 'ком', vatRate: [0, 5, 10, 18].includes(gn(r, 'rate')) && has(r, 'rate') ? gn(r, 'rate') : 18,
          // retail stock import (m_lager): the new item gets the store's retail price, the rate from the row
          price: mpc ? String(r2(mpc / (1 + ([0, 5, 10, 18].includes(gn(r, 'rate')) && has(r, 'rate') ? gn(r, 'rate') : 18) / 100))) : '0', data: { cost: gn(r, 'cost') || 0, ...(mpc && isStore && W0 ? { sp: { [whId(W0)]: r2(mpc) } } : {}) },
        }).returning();
        it = c!;
        if (bc) {
          const [own] = await tx.select({ id: itemBarcodes.id }).from(itemBarcodes).where(and(eq(itemBarcodes.firmId, a.firmId), eq(itemBarcodes.barcode, bc))).limit(1);
          if (!own) await tx.insert(itemBarcodes).values({ firmId: a.firmId, itemId: it.id, barcode: bc, primary: true });
        }
        R.add++;
      } else if (it.type === 'service') { R.skip.push(`${it.name}: услуга – нема залиха`); continue; }
      const whc = gs(r, 'wh');
      const W = t === 'in' ? W0 : whc ? locs.find((l) => String(l.code ?? '') === whc || l.name === whc)?.id ?? null : null;
      const cost = has(r, 'cost') ? gn(r, 'cost') : has(r, 'amount') && q ? r2(gn(r, 'amount') / q) : 0;
      moves.push({ id: `${srcId}-${i}`, date: o.date, item: it.id, qty: r4(q), value: r2(q * cost), type: t === 'stock' ? 'opening' : 'in', src: 'stock_import-' + srcId, wh: whId(W), label: t === 'stock' ? 'Почетна залиха' : 'Приемница (увоз)', lines: [] });
      if (t === 'in' && isStore && gn(r, 'mpc') > 0) {
        const has0 = L0.ctx.moves.some((m) => m.item === it!.id && whId(m.wh) === whId(W0) && !m.pend && m.date <= o.date);
        const cur = n(((it.data as Record<string, unknown>).sp as Record<string, unknown> | undefined)?.[whId(W0)]);
        if (!has0 || Math.abs(cur - gn(r, 'mpc')) < 0.005) sp.set(it.id, r2(gn(r, 'mpc')));
        else R.skip.push(`${it.name}: има залиха со друга МПЦ – цената не е сменета (нивелација)`);
      }
      R.upd++;
    }
    if (moves.length) await replaceSourceMoves(tx, { firmId: a.firmId, sourceType: 'stock_import', sourceId: srcId, moves, date: o.date, description: t === 'stock' ? 'Почетна залиха (увоз)' : 'Приемница (увоз)', userId: a.userId });
    if (sp.size && W0) await setRetailPrices(tx, a.firmId, whId(W0), sp);
  }

  if (t === 'pop') {
    const L = await loadStockContext(tx, a.firmId);
    const W = requireLocation(L, o.wh);
    const cnt = new Map<string, number>();
    for (const r of rows) {
      const it = await findItem(tx, a.firmId, gs(r, 'code'), gs(r, 'barcode').replace(/\D/g, ''), gs(r, 'name'));
      if (!it) { R.skip.push((gs(r, 'code') || gs(r, 'name') || '?') + ': непознат артикл'); continue; }
      cnt.set(it.id, r4((cnt.get(it.id) ?? 0) + gn(r, 'cnt')));
    }
    const sys = new Map<string, number>();
    for (const m of L.ctx.moves) if (whId(m.wh) === whId(W) && !m.pend && m.date <= o.date) sys.set(m.item, r4((sys.get(m.item) ?? 0) + m.qty));
    const ids = new Set([...[...sys.entries()].filter(([, q]) => Math.abs(q) > 1e-9).map(([id]) => id), ...cnt.keys()]);
    const lines = [...ids].filter((id) => { const it = L.ctx.items?.find((x) => x.id === id); return it && it.type !== 'service'; })
      .map((id) => ({ itemId: id, cnt: cnt.has(id) ? cnt.get(id)! : sys.get(id) ?? 0 }));
    if (!lines.length) throw new StockDocError('Нема ставки за попис.');
    await saveStockCount(tx, a, { kind: 'count', date: o.date, wh: W, lines, note: 'Попис (увоз од Excel)' });
    R.upd = cnt.size;
  }

  if (t === 'nivel') {
    const prices: Record<string, number> = {};
    for (const r of rows) {
      const it = await findItem(tx, a.firmId, gs(r, 'code'), gs(r, 'barcode').replace(/\D/g, ''), gs(r, 'name'));
      if (!it) { R.skip.push((gs(r, 'code') || gs(r, 'name') || '?') + ': непознат артикл'); continue; }
      if (gn(r, 'mpc') > 0) prices[it.id] = r2(gn(r, 'mpc'));
    }
    if (!Object.keys(prices).length) throw new StockDocError('Нема нови цени.');
    await saveLevelling(tx, a, { date: o.date, wh: o.wh, prices, today: o.today, note: 'Нивелација (увоз од Excel)' });
    R.upd = Object.keys(prices).length;
  }

  await audit(tx, { userId: a.userId, firmId: a.firmId, action: 'impRun', entityType: 'import', data: { type: t, rows: rows.length, add: R.add, upd: R.upd, newP: R.newP, skipped: R.skip.length } });
  return R;
}

