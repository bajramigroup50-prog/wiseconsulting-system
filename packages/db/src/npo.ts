/**
 * Humanitarian associations (НПО) next to „🍲 Корисници и оброци“ — persistence:
 * - consent of a beneficiary for processing personal data (date + scanned form in `file_links`);
 * - the register of members and of the members of the organs (Закон за здруженија и фондации);
 * - the УЈП-ИДС/ПР state of a received donation (fulfilment date, submitted date);
 * - the kitchen stock: settings + normatives per meal kind (`firms.settings.meals`), the daily consumption issued as an
 *   издатница (`stock_moves.source_type = 'meal_issue'`, source id = the day, one document per day, idempotent), and the
 *   приемници of donations in kind (`donation_receipts`, moves `don_receipt`, lots in `stock_lots`).
 * Every write checks the `meals` module for client users and is audited; stock goes through `replaceSourceMoves`
 * (period locks, stock journal).
 */
import { and, asc, desc, eq, inArray, isNotNull, or, sql } from 'drizzle-orm';
import { postOut, stockAt, type StockMove } from '@wise/core';
import { r2, r4 } from '@wise/core/stock/num';
import {
  cleanNorms, consumptionChanged, idsDue, mealConsumption, membersDue, nextReceiptNo, portionsByDay, type MealStockSettings, type MemberInput,
} from '@wise/core/npo';
import { mealKindsOf } from '@wise/core/meals';
import { audit, type Tx } from './audit';
import { assertOpenPeriod } from './posting';
import { IndustryError, loadIndustryFirm, type IndActor } from './industry/context';
import { listBeneficiaries, mealLogsBetween } from './meals';
import {
  donationReceipts, donations, fileLinks, files, firms, mealBeneficiaries, MEAL_CONSENT_FILE_ENTITY, npoMembers, partners, stockLots, stockMoves,
  type DonReceiptLine,
} from './schema/index';
import { loadStockContext, removeSourceMoves, replaceSourceMoves, requireLocation, requireTracked, StockDocError, whId } from './stock-service';

const fail = (m: string): never => { throw new IndustryError(m); };
const t = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim() || null;
const isIso = (d: unknown): d is string => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d);
const isoOrNull = (d: string | null | undefined) => (isIso(d) ? d : null);
const settingsOf = (f: { settings: unknown }) => (f.settings ?? {}) as Record<string, unknown>;

async function patchSettings(tx: Tx, firmId: string, key: string, value: unknown) {
  await tx.update(firms).set({ settings: sql`coalesce(${firms.settings}, '{}'::jsonb) || jsonb_build_object(${key}::text, ${JSON.stringify(value)}::jsonb)` }).where(eq(firms.id, firmId));
}

/* ================================================================== consent */

/**
 * Record (or clear, `date = null`) the signed consent of a beneficiary; scanned files of the firm are linked to it.
 */
export async function setConsent(tx: Tx, a: IndActor, beneficiaryId: string, date: string | null, fileIds: readonly string[] = []): Promise<void> {
  await loadIndustryFirm(tx, a.firmId, 'meals', a);
  if (date && !isIso(date)) fail('Невалиден датум на согласноста.');
  const [b] = await tx.select({ id: mealBeneficiaries.id }).from(mealBeneficiaries).where(and(eq(mealBeneficiaries.id, beneficiaryId), eq(mealBeneficiaries.firmId, a.firmId))).limit(1);
  if (!b) fail('Корисникот не постои.');
  await tx.update(mealBeneficiaries).set({ consentDate: date, updatedAt: new Date() }).where(eq(mealBeneficiaries.id, beneficiaryId));
  const F = fileIds.length ? await tx.select({ id: files.id }).from(files).where(and(eq(files.firmId, a.firmId), inArray(files.id, [...fileIds]))) : [];
  for (const x of F) await tx.insert(fileLinks).values({ fileId: x.id, entityType: MEAL_CONSENT_FILE_ENTITY, entityId: beneficiaryId, role: 'signed' }).onConflictDoNothing();
  await audit(tx, { userId: a.userId, firmId: a.firmId, action: 'mealConsent', entityType: 'meal_beneficiary', entityId: beneficiaryId, data: { date, files: F.length } });
}

/** Confirm (or clear) the consent of many beneficiaries at once (only the firm's own; one audit row each). Returns how many. */
export async function setConsentMany(tx: Tx, a: IndActor, ids: readonly string[], date: string | null): Promise<number> {
  await loadIndustryFirm(tx, a.firmId, 'meals', a);
  if (date && !isIso(date)) fail('Невалиден датум на согласноста.');
  if (!ids.length) return 0;
  const R = await tx.update(mealBeneficiaries).set({ consentDate: date, updatedAt: new Date() })
    .where(and(eq(mealBeneficiaries.firmId, a.firmId), inArray(mealBeneficiaries.id, [...ids]))).returning({ id: mealBeneficiaries.id, name: mealBeneficiaries.name });
  for (const r of R) await audit(tx, { userId: a.userId, firmId: a.firmId, action: 'mealConsent', entityType: 'meal_beneficiary', entityId: r.id, data: { date, name: r.name, bulk: true } });
  return R.length;
}

/** Scanned consents per beneficiary id. */
export async function consentFiles(tx: Tx, ids: readonly string[]): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  if (!ids.length) return out;
  const R = await tx.select({ id: fileLinks.entityId, fileId: fileLinks.fileId }).from(fileLinks)
    .where(and(eq(fileLinks.entityType, MEAL_CONSENT_FILE_ENTITY), inArray(fileLinks.entityId, [...ids])));
  for (const r of R) out.set(r.id, [...(out.get(r.id) ?? []), r.fileId]);
  return out;
}

/* ================================================================== members register */

export async function listMembers(tx: Tx, firmId: string) {
  return tx.select().from(npoMembers).where(eq(npoMembers.firmId, firmId)).orderBy(asc(npoMembers.name));
}

function memberValues(x: MemberInput) {
  const name = (x.name ?? '').replace(/\s+/g, ' ').trim();
  if (!name) fail('Внесете име и презиме на членот.');
  const embg = (x.embg ?? '').replace(/\D/g, '') || null;
  if (embg && embg.length !== 13) fail('ЕМБГ има 13 цифри.');
  const joined = isoOrNull(x.joined), left = isoOrNull(x.left);
  if (joined && left && left < joined) fail('Датумот на исчленување е пред датумот на зачленување.');
  return { name, embg, address: t(x.address), phone: t(x.phone), email: t(x.email), joined, left, organ: t(x.organ), role: t(x.role), note: t(x.note), updatedAt: new Date() };
}

export async function saveMember(tx: Tx, a: IndActor, x: MemberInput & { id?: string | null }): Promise<string> {
  await loadIndustryFirm(tx, a.firmId, 'meals', a);
  const v = memberValues(x);
  let id = x.id ?? '';
  if (id) {
    const r = await tx.update(npoMembers).set(v).where(and(eq(npoMembers.id, id), eq(npoMembers.firmId, a.firmId))).returning({ id: npoMembers.id });
    if (!r.length) fail('Членот не постои.');
  } else id = (await tx.insert(npoMembers).values({ ...v, firmId: a.firmId }).returning({ id: npoMembers.id }))[0]!.id;
  await audit(tx, { userId: a.userId, firmId: a.firmId, action: x.id ? 'npoMemSave' : 'npoMemNew', entityType: 'npo_member', entityId: id, data: { name: v.name, organ: v.organ, role: v.role } });
  return id;
}

export async function deleteMember(tx: Tx, a: IndActor, id: string): Promise<void> {
  await loadIndustryFirm(tx, a.firmId, 'meals', a);
  const r = await tx.delete(npoMembers).where(and(eq(npoMembers.id, id), eq(npoMembers.firmId, a.firmId))).returning({ name: npoMembers.name });
  if (!r.length) fail('Членот не постои.');
  await audit(tx, { userId: a.userId, firmId: a.firmId, action: 'npoMemDel', entityType: 'npo_member', entityId: id, data: { name: r[0]!.name } });
}

/** Excel import: the same person (ЕМБГ, else name + organ) is updated with the non-empty values, others are added. */
export async function importMembers(tx: Tx, a: IndActor, list: readonly MemberInput[]): Promise<{ added: number; updated: number }> {
  await loadIndustryFirm(tx, a.firmId, 'meals', a);
  const have = await listMembers(tx, a.firmId);
  const key = (m: { name: string; organ?: string | null }) => `${m.name.trim().toLowerCase()}|${(m.organ ?? '').toLowerCase()}`;
  let added = 0, updated = 0;
  for (const x of list) {
    const v = memberValues(x);
    const old = have.find((h) => (v.embg && h.embg ? h.embg === v.embg && (h.organ ?? '') === (v.organ ?? '') : key(h) === key(v)));
    if (old) {
      const keep = Object.fromEntries(Object.entries(v).map(([k, val]) => [k, val ?? (old as Record<string, unknown>)[k] ?? null]));
      await tx.update(npoMembers).set({ ...keep, updatedAt: new Date() }).where(eq(npoMembers.id, old.id));
      updated++;
    } else {
      const [r] = await tx.insert(npoMembers).values({ ...v, firmId: a.firmId }).returning();
      have.push(r!);
      added++;
    }
  }
  await audit(tx, { userId: a.userId, firmId: a.firmId, action: 'npoMemImport', entityType: 'npo_member', data: { added, updated } });
  return { added, updated };
}

/** „Регистарот е прегледан и ажуриран“ — the date is kept in `firms.settings.npoReg.reviewed`. */
export async function markMembersReviewed(tx: Tx, a: IndActor, date: string): Promise<void> {
  await loadIndustryFirm(tx, a.firmId, 'meals', a);
  if (!isIso(date)) fail('Невалиден датум.');
  await patchSettings(tx, a.firmId, 'npoReg', { reviewed: date });
  await audit(tx, { userId: a.userId, firmId: a.firmId, action: 'npoMemReview', entityType: 'firm', entityId: a.firmId, data: { date } });
}

/** Last update of the register per firm: the reviewed date or the newest change of a row (whichever is later). */
export async function membersLastUpdate(tx: Tx, firmIds: readonly string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!firmIds.length) return out;
  const [R, F] = await Promise.all([
    tx.select({ f: npoMembers.firmId, d: sql<string>`max(${npoMembers.updatedAt})` }).from(npoMembers).where(inArray(npoMembers.firmId, [...firmIds])).groupBy(npoMembers.firmId),
    tx.select({ id: firms.id, settings: firms.settings }).from(firms).where(inArray(firms.id, [...firmIds])),
  ]);
  for (const r of R) if (r.d) out.set(r.f, new Date(r.d).toISOString().slice(0, 10));
  for (const f of F) {
    const rv = (settingsOf(f).npoReg as { reviewed?: string } | undefined)?.reviewed;
    if (isIso(rv) && (!out.has(f.id) || rv > out.get(f.id)!)) out.set(f.id, rv);
  }
  return out;
}

/* ================================================================== УЈП-ИДС/ПР */

/** Fulfilment date and submitted date of the УЈП-ИДС/ПР of a received donation. */
export async function setDonationIds(tx: Tx, a: { firmId: string; userId: string | null }, id: string, x: { fulfilledDate?: string | null; idsFiled?: string | null }): Promise<void> {
  const [d] = await tx.select({ id: donations.id, role: donations.role }).from(donations).where(and(eq(donations.id, id), eq(donations.firmId, a.firmId))).limit(1);
  if (!d) fail('Договорот не постои.');
  if (d!.role !== 'received') fail('Извештајот УЈП-ИДС/ПР го поднесува примателот на донацијата.');
  const v = { fulfilledDate: isoOrNull(x.fulfilledDate), idsFiled: isoOrNull(x.idsFiled) };
  await tx.update(donations).set({ ...v, updatedAt: new Date() }).where(eq(donations.id, id));
  await audit(tx, { userId: a.userId, firmId: a.firmId, action: 'donIds', entityType: 'donation', entityId: id, data: v });
}

/** Decision of the Ministry of Justice on the public interest (attachment 2 of the form), `firms.settings.npoPI`. */
export async function savePublicInterest(tx: Tx, a: { firmId: string; userId: string | null }, x: { no?: string | null; date?: string | null }): Promise<void> {
  const v = { no: t(x.no), date: isoOrNull(x.date) };
  await patchSettings(tx, a.firmId, 'npoPI', v);
  await audit(tx, { userId: a.userId, firmId: a.firmId, action: 'npoPI', entityType: 'firm', entityId: a.firmId, data: v });
}

/** ИДС/ПР deadlines for the calendar: received donations whose due date (fulfilment + 30 days) is in the range. */
export async function donIdsDeadlineRows(tx: Tx, o: { firmIds: readonly string[]; from: string; to: string }) {
  if (!o.firmIds.length) return [];
  const R = await tx.select({ id: donations.id, firmId: donations.firmId, number: donations.number, kind: donations.kind, fulfilledDate: donations.fulfilledDate, confDate: donations.confDate, idsFiled: donations.idsFiled, pn: partners.name, pn2: donations.partnerName })
    .from(donations).leftJoin(partners, eq(partners.id, donations.partnerId))
    .where(and(inArray(donations.firmId, [...o.firmIds]), eq(donations.role, 'received'), or(isNotNull(donations.fulfilledDate), isNotNull(donations.confDate))));
  return R.map((r) => ({ ...r, due: idsDue(r) })).filter((r): r is typeof r & { due: string } => !!r.due && r.due >= o.from && r.due <= o.to)
    .map((r) => ({ id: r.id, firmId: r.firmId, due: r.due, done: !!r.idsFiled, title: `УЈП-ИДС/ПР – ${r.kind === 'sponsorship' ? 'спонзорство' : 'донација'} ${r.number ?? ''} од ${r.pn ?? r.pn2 ?? ''}`.replace(/\s+/g, ' ').trim() }));
}

/** Members register due dates (last update + 2 years) of the firms that keep a register. */
export async function npoRegDue(tx: Tx, firmIds: readonly string[]): Promise<Map<string, string>> {
  const L = await membersLastUpdate(tx, firmIds);
  return new Map([...L].map(([f, d]) => [f, membersDue(d)!]));
}

/* ================================================================== kitchen stock */

export const mealStockSettings = (f: { settings: unknown }): MealStockSettings => {
  const m = (settingsOf(f).meals ?? {}) as MealStockSettings;
  return { wh: m.wh || null, konto: m.konto || null, norm: cleanNorms(m.norm), kinds: mealKindsOf(settingsOf(f)) };
};

export async function saveMealStockSettings(tx: Tx, a: IndActor, x: MealStockSettings): Promise<void> {
  const f = await loadIndustryFirm(tx, a.firmId, 'meals', a);
  const k = (x.konto ?? '').trim();
  if (k && !/^\d{3,10}$/.test(k)) fail('Неважечко конто.');
  const L = await loadStockContext(tx, a.firmId);
  const wh = x.wh ? requireLocation(L, x.wh) : null;
  const old = mealStockSettings(f);
  const kinds = x.kinds ? mealKindsOf({ meals: { kinds: x.kinds } }) : old.kinds!;
  // the normatives of the kinds not served now are kept (they come back when the kind is switched on again)
  const typed = cleanNorms(x.norm);
  const norm = { ...old.norm, ...Object.fromEntries(kinds.map((k) => [k, typed[k] ?? []])) };
  for (const n of Object.values(norm).flat()) requireTracked(L, n.itemId);
  const v: MealStockSettings = { ...old, wh, konto: k || null, norm, kinds };
  await patchSettings(tx, a.firmId, 'meals', v);
  await audit(tx, { userId: a.userId, firmId: a.firmId, action: 'mealNorm', entityType: 'firm', entityId: a.firmId, data: { wh, konto: v.konto, kinds, items: Object.values(norm).flat().length } });
}

export const MEAL_ISSUE = 'meal_issue';

/** Days of the period that already have a kitchen issue, with their lines (item → qty, positive). */
export async function mealIssues(tx: Tx, firmId: string, from: string, to: string): Promise<Map<string, { itemId: string; qty: number; value: number }[]>> {
  const R = await tx.select({ day: stockMoves.sourceId, itemId: stockMoves.itemId, qty: stockMoves.qty, value: stockMoves.value }).from(stockMoves)
    .where(and(eq(stockMoves.firmId, firmId), eq(stockMoves.sourceType, MEAL_ISSUE), sql`${stockMoves.sourceId} between ${from} and ${to}`));
  const out = new Map<string, { itemId: string; qty: number; value: number }[]>();
  for (const r of R) out.set(r.day, [...(out.get(r.day) ?? []), { itemId: r.itemId, qty: r4(-Number(r.qty)), value: r2(-Number(r.value)) }]);
  return out;
}

export interface IssueResult { issued: string[]; removed: string[]; same: number; short: { date: string; item: string; need: number; have: number }[]; locked: string[]; noNorm: boolean }

/**
 * Issue the kitchen consumption for every day of `[from, to]`: portions × normative per meal kind, at average cost
 * (Д expense / П stock) from the kitchen warehouse, one document per day (`meal_issue`, source id = the day).
 * Idempotent: a day whose consumption is unchanged is left alone, a changed one is re-issued, a day without meals
 * loses its document. A day without enough stock, or in a locked period, is skipped and reported.
 */
export async function issueMealDays(tx: Tx, a: IndActor, from: string, to: string): Promise<IssueResult> {
  const f = await loadIndustryFirm(tx, a.firmId, 'meals', a);
  if (!isIso(from) || !isIso(to) || from > to) fail('Невалиден период.');
  if (Date.parse(to) - Date.parse(from) > 370 * 864e5) fail('Најмногу една година одеднаш.');
  const S = mealStockSettings(f);
  const res: IssueResult = { issued: [], removed: [], same: 0, short: [], locked: [], noNorm: !Object.values(S.norm ?? {}).some((x) => x?.length) };
  const [B, L0, old] = await Promise.all([listBeneficiaries(tx, a.firmId, true), mealLogsBetween(tx, a.firmId, from, to), mealIssues(tx, a.firmId, from, to)]);
  // only the meal kinds the firm serves (ticks of the others stay hidden)
  const L = L0.filter((x) => (S.kinds ?? []).includes(x.meal as never));
  const P = portionsByDay(B, L);
  const days = [...new Set([...P.keys(), ...old.keys()])].sort();
  const konto = S.konto || '4000';
  for (const day of days) {
    const want = res.noNorm ? [] : mealConsumption(P.get(day) ?? {}, S.norm ?? {});
    const had = old.get(day) ?? [];
    if (!consumptionChanged(had, want)) { if (want.length) res.same++; continue; }
    // a locked period keeps its documents (skipped and reported, the other days go on)
    try { assertOpenPeriod(f, day); } catch { res.locked.push(day); continue; }
    if (!want.length) {
      await removeSourceMoves(tx, { firmId: a.firmId, sourceType: MEAL_ISSUE, sourceId: day, userId: a.userId });
      res.removed.push(day);
      continue;
    }
    const St = await loadStockContext(tx, a.firmId, { excludeSource: { sourceType: MEAL_ISSUE, sourceId: day } });
    const wh = whId(S.wh ? requireLocation(St, S.wh) : null);
    const short = want.map((w) => ({ w, have: stockAt(St.ctx, { item: w.itemId, wh, date: day }).qty })).filter((x) => x.have < x.w.qty - 1e-9);
    if (short.length) {
      for (const x of short) res.short.push({ date: day, item: St.items.get(x.w.itemId)?.name ?? x.w.itemId, need: x.w.qty, have: r4(x.have) });
      continue;
    }
    const p = P.get(day) ?? { b: 0, l: 0, d: 0 };
    const label = `Оброци ${day.split('-').reverse().join('.')} (${p.b}/${p.l}/${p.d} порции)`;
    const moves: StockMove[] = want.map((w) => postOut(St.ctx, { item: requireTracked(St, w.itemId), qty: w.qty, date: day, type: 'use', src: `${MEAL_ISSUE}-${day}`, label, debitAccount: konto, wh }).move);
    await replaceSourceMoves(tx, { firmId: a.firmId, sourceType: MEAL_ISSUE, sourceId: day, moves, date: day, description: `Издатница – ${label}`, userId: a.userId });
    res.issued.push(day);
  }
  await audit(tx, { userId: a.userId, firmId: a.firmId, action: 'mealIssue', entityType: 'stock_move', data: { from, to, issued: res.issued.length, removed: res.removed.length, short: res.short.length, locked: res.locked.length } });
  return res;
}

/** After a tick changed: re-issue the day only when it was already issued (keeps the stock in step with the list). */
export async function reissueIfIssued(tx: Tx, a: IndActor, day: string): Promise<IssueResult | null> {
  const [x] = await tx.select({ id: stockMoves.id }).from(stockMoves).where(and(eq(stockMoves.firmId, a.firmId), eq(stockMoves.sourceType, MEAL_ISSUE), eq(stockMoves.sourceId, day))).limit(1);
  return x ? issueMealDays(tx, a, day, day) : null;
}

export const DON_RECEIPT = 'don_receipt';

export interface DonReceiptInput {
  id?: string | null;
  donationId?: string | null;
  partnerId?: string | null;
  date: string;
  wh?: string | null;
  /** Counter account (donation income: 731 NPO chart / 7672); empty = no posting. */
  account?: string | null;
  note?: string | null;
  lines: readonly DonReceiptLine[];
}

/**
 * Приемница of a donation in kind: Д stock / П the donation konto at the value of the goods; lot and expiry of every
 * line go to the move and to „🏷 Лотови и рок“ (`stock_lots`, FEFO). Linked to the donation contract (its donor).
 */
export async function saveDonationReceipt(tx: Tx, a: IndActor, x: DonReceiptInput): Promise<{ id: string; number: string }> {
  await loadIndustryFirm(tx, a.firmId, 'meals', a);
  if (!isIso(x.date)) fail('Невалиден датум.');
  const lines = x.lines.map((l) => ({ itemId: l.itemId, qty: r4(Number(l.qty) || 0), price: r4(Number(l.price) || 0), lot: t(l.lot), expiry: isoOrNull(l.expiry) })).filter((l) => l.itemId && l.qty > 0);
  if (!lines.length) fail('Внесете барем еден артикл и количина.');
  const k = (x.account ?? '').trim();
  if (k && !/^\d{3,10}$/.test(k)) fail('Неважечко конто.');
  let partnerId = x.partnerId || null;
  if (x.donationId) {
    const [d] = await tx.select({ id: donations.id, partnerId: donations.partnerId, role: donations.role }).from(donations).where(and(eq(donations.id, x.donationId), eq(donations.firmId, a.firmId))).limit(1);
    if (!d) fail('Договорот за донација не постои.');
    if (d!.role !== 'received') fail('Приемница се прави само за примена донација.');
    partnerId = d!.partnerId ?? partnerId;
  }
  const L = await loadStockContext(tx, a.firmId, x.id ? { excludeSource: { sourceType: DON_RECEIPT, sourceId: x.id } } : {});
  const loc = requireLocation(L, x.wh);
  const all = await tx.select({ id: donationReceipts.id, number: donationReceipts.number, date: donationReceipts.date }).from(donationReceipts).where(eq(donationReceipts.firmId, a.firmId));
  const ex = x.id ? all.find((r) => r.id === x.id) : undefined;
  if (x.id && !ex) fail('Приемницата не постои.');
  const id = ex?.id ?? crypto.randomUUID();
  const number = ex?.number ?? nextReceiptNo(all, x.date.slice(0, 4));
  const src = `${DON_RECEIPT}-${id}`;
  const label = `Приемница донација ${number}`;
  const moves: StockMove[] = lines.map((l, i) => {
    const it = requireTracked(L, l.itemId);
    const v = r2(l.qty * l.price);
    const stockK = it.type === 'material' ? (L.ctx.scheme?.material || '3100') : it.type === 'product' ? (L.ctx.scheme?.product || '6300') : (L.ctx.scheme?.stock || '6600');
    return { id: `${src}-${i}`, date: x.date, item: it.id, qty: l.qty, value: v, type: 'in', src, wh: whId(loc), label, lines: k && v ? [{ account: stockK, debit: v, credit: 0 }, { account: k, debit: 0, credit: v }] : [] };
  });
  const total = r2(moves.reduce((s, m) => s + m.value, 0));
  const row = { firmId: a.firmId, donationId: x.donationId || null, partnerId, number, date: x.date, locationId: loc, account: k || null, note: t(x.note), lines, total: total.toFixed(2), userId: a.userId, updatedAt: new Date() };
  if (ex) await tx.update(donationReceipts).set(row).where(eq(donationReceipts.id, id));
  else await tx.insert(donationReceipts).values({ ...row, id });
  const ids = await replaceSourceMoves(tx, { firmId: a.firmId, sourceType: DON_RECEIPT, sourceId: id, moves, date: x.date, description: label, userId: a.userId, partnerId });
  for (const [i, l] of lines.entries()) if ((l.lot || l.expiry) && ids[i]) await tx.update(stockMoves).set({ lot: l.lot, expiry: l.expiry }).where(eq(stockMoves.id, ids[i]!));
  await tx.delete(stockLots).where(and(eq(stockLots.firmId, a.firmId), eq(stockLots.sourceType, DON_RECEIPT), eq(stockLots.sourceId, id)));
  const lots = lines.map((l, i) => ({ l, i })).filter(({ l }) => l.lot || l.expiry);
  if (lots.length) await tx.insert(stockLots).values(lots.map(({ l, i }) => ({ firmId: a.firmId, sourceType: DON_RECEIPT as 'don_receipt', sourceId: id, lineNo: i, itemId: l.itemId, qty: l.qty.toFixed(4), lot: l.lot, expiry: l.expiry })));
  await audit(tx, { userId: a.userId, firmId: a.firmId, action: ex ? 'donRecSave' : 'donRecNew', entityType: 'donation_receipt', entityId: id, data: { number, donationId: x.donationId ?? null, total, lines: lines.length } });
  return { id, number };
}

export async function deleteDonationReceipt(tx: Tx, a: IndActor, id: string): Promise<void> {
  await loadIndustryFirm(tx, a.firmId, 'meals', a);
  const [r] = await tx.select({ id: donationReceipts.id, number: donationReceipts.number }).from(donationReceipts).where(and(eq(donationReceipts.id, id), eq(donationReceipts.firmId, a.firmId))).limit(1);
  if (!r) throw new StockDocError('Приемницата не постои.');
  await removeSourceMoves(tx, { firmId: a.firmId, sourceType: DON_RECEIPT, sourceId: id, userId: a.userId });
  await tx.delete(stockLots).where(and(eq(stockLots.firmId, a.firmId), eq(stockLots.sourceType, DON_RECEIPT), eq(stockLots.sourceId, id)));
  await tx.delete(donationReceipts).where(eq(donationReceipts.id, id));
  await audit(tx, { userId: a.userId, firmId: a.firmId, action: 'donRecDel', entityType: 'donation_receipt', entityId: id, data: { number: r.number } });
}

export async function listDonationReceipts(tx: Tx, firmId: string, o: { donationId?: string; from?: string; to?: string } = {}) {
  return tx.select().from(donationReceipts).where(and(eq(donationReceipts.firmId, firmId), o.donationId ? eq(donationReceipts.donationId, o.donationId) : undefined,
    o.from ? sql`${donationReceipts.date} >= ${o.from}` : undefined, o.to ? sql`${donationReceipts.date} <= ${o.to}` : undefined)).orderBy(desc(donationReceipts.date), desc(donationReceipts.number));
}

/** Moves of the kitchen warehouse up to `to` (for `kitchenReport`). */
export async function kitchenMoves(tx: Tx, firmId: string, wh: string | null | undefined, to: string) {
  const R = await tx.select({ itemId: stockMoves.itemId, date: stockMoves.date, qty: stockMoves.qty, value: stockMoves.value, sourceType: stockMoves.sourceType }).from(stockMoves)
    .where(and(eq(stockMoves.firmId, firmId), eq(stockMoves.pending, false), wh ? eq(stockMoves.locationId, wh) : sql`${stockMoves.locationId} is null`, sql`${stockMoves.date} <= ${to}`));
  return R.map((r) => ({ itemId: r.itemId, date: r.date, qty: Number(r.qty), value: Number(r.value), sourceType: r.sourceType }));
}

