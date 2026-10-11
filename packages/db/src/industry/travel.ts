/**
 * Travel-agency service (legacy ACT `taNewB … taCfgSave` 11928, `tuVatPost` 11989).
 *
 * Feeds Phase 5 VAT: margin-scheme invoices carry `data.tourM` + `data.arrangementId`, and {@link travelMarginInputs}
 * returns the `{ rev, cost, own }` totals per arrangement plus the basis (`agg`) — the `travel` option of `ddvFor`.
 * Prior-service purchases linked to an own arrangement are marked `noDed` (no input-VAT deduction, чл. 38 ст. 4).
 */
import { and, asc, eq, inArray, ne, sql } from 'drizzle-orm';
import { schemeValue, vatAccount, perRange, travelMarginFor, type TravelMarginOptions } from '@wise/core';
import {
  arrangementResult, arrangementVatTotals, bookingInvoice, bookingPaid, bookingPax, nextModuleNumber, travelConfig, type TravelConfig,
} from '@wise/core/industry';
import { audit, type Tx } from '../audit';
import { postJournal } from '../posting';
import { invoiceLines, invoices, purchases, travelArrangements, travelBookings, type Firm, type TravelArrangementRow, type TravelBookingRow } from '../schema/index';
import type { ArrangementCostRow, BookingPayRow } from '../schema/industry';
import { firmPostingContext } from '../sales/context';
import { setPurchaseNoDed } from '../sales/purchases';
import { deleteVoucher } from '../bank/cash';
import { documentsVatSource } from '../vat-source';
import {
  assertPartner, cashMovement, dec2, dmy, findOrCreatePartner, IndustryError, industryConfigOf, issueModuleInvoice, loadIndustryFirm, n, type IndActor,
} from './context';

const MOD = 'tour';
const fail = (m: string): never => { throw new IndustryError(m); };
export const firmTravelConfig = (f: Pick<Firm, 'settings'>): TravelConfig => travelConfig(industryConfigOf<TravelConfig>(f, 'travel'));

/** Advances konto: module setting, else the posting scheme (FIX 10.4 item 4: legacy fell back to the literal '2220'). */
async function advKonto(tx: Tx, f: Firm, cfg: TravelConfig) {
  return cfg.advK || schemeValue(await firmPostingContext(tx, f), 'advance');
}

/* ---------------- arrangements ---------------- */

export interface ArrangementInput {
  id?: string | null; code?: string | null; name: string; dest?: string | null; countries?: string[]; from?: string | null; to?: string | null;
  kind: 'own' | 'agent'; seats?: number | null; price?: number | null; priceCh?: number | null; comm?: number | null;
  prog?: string | null; incl?: string | null; excl?: string | null; costs?: ArrangementCostRow[]; status?: 'open' | 'full' | 'done' | 'cancel';
}

/** Purchase totals in MKD (incl. VAT — prior services' VAT is not deductible). */
async function purchaseTotals(tx: Tx, firmId: string, ids: string[]): Promise<Map<string, number>> {
  if (!ids.length) return new Map();
  const P = await tx.select({ id: purchases.id, total: purchases.total, fx: purchases.fx, cur: purchases.currency }).from(purchases).where(and(eq(purchases.firmId, firmId), inArray(purchases.id, ids)));
  return new Map(P.map((p) => [p.id, Math.round(n(p.total) * (p.cur === 'MKD' ? 1 : n(p.fx) || 1) * 100) / 100]));
}

/** Legacy `taSave`: save the arrangement and mark linked purchases as prior services (noDed) for own arrangements. */
export async function saveArrangement(tx: Tx, a: IndActor, x: ArrangementInput): Promise<{ id: string; code: string }> {
  await loadIndustryFirm(tx, a.firmId, MOD);
  const name = x.name.trim() || fail('Внесете назив на аранжманот.');
  if (x.from && x.to && x.to < x.from) fail('Проверете ги датумите.');
  const [prev] = x.id ? await tx.select().from(travelArrangements).where(and(eq(travelArrangements.id, x.id), eq(travelArrangements.firmId, a.firmId))).limit(1) : [];
  if (x.id && !prev) fail('Аранжманот не постои.');
  const costs = (x.costs ?? prev?.costs ?? []).filter((c) => c.purchaseId || n(c.amt));
  const pids = costs.map((c) => c.purchaseId).filter((p): p is string => !!p);
  if (pids.length && (await purchaseTotals(tx, a.firmId, pids)).size !== new Set(pids).size) fail('Влезната фактура не постои.');
  let code = x.code?.trim() || prev?.code || '';
  if (!code) {
    const y = new Date().getFullYear();
    code = nextModuleNumber('A-', (await tx.select({ c: travelArrangements.code }).from(travelArrangements).where(eq(travelArrangements.firmId, a.firmId))).map((r) => r.c).filter((c) => c.endsWith('/' + y)), y);
  }
  const [dup] = await tx.select({ id: travelArrangements.id }).from(travelArrangements).where(and(eq(travelArrangements.firmId, a.firmId), eq(travelArrangements.code, code), prev ? ne(travelArrangements.id, prev.id) : undefined)).limit(1);
  if (dup) fail(`Шифрата ${code} веќе постои.`);
  const row = {
    code, name, dest: x.dest?.trim() || null, countries: x.countries ?? [], from: x.from || null, to: x.to || null, kind: x.kind === 'agent' ? 'agent' as const : 'own' as const,
    seats: x.seats ? Math.round(x.seats) : null, price: dec2(x.price ?? null), priceCh: dec2(x.priceCh ?? null), comm: x.comm == null ? null : String(x.comm),
    prog: x.prog ?? null, incl: x.incl ?? null, excl: x.excl ?? null, costs, status: x.status ?? prev?.status ?? 'open',
  };
  let id = prev?.id ?? '';
  if (prev) await tx.update(travelArrangements).set(row).where(eq(travelArrangements.id, id));
  else id = (await tx.insert(travelArrangements).values({ ...row, firmId: a.firmId, date: new Date().toISOString().slice(0, 10) }).returning({ id: travelArrangements.id }))[0]!.id;
  // noDed: linked purchases of an own arrangement are not deductible; purchases no longer linked get the deduction back.
  const before = (prev?.costs ?? []).map((c) => c.purchaseId).filter((p): p is string => !!p);
  for (const p of pids) await setPurchaseNoDed(tx, a.firmId, p, row.kind === 'own', a);
  for (const p of before.filter((p) => !pids.includes(p))) await setPurchaseNoDed(tx, a.firmId, p, false, a);
  await audit(tx, { userId: a.userId, firmId: a.firmId, action: prev ? 'taSave' : 'taNew', entityType: 'travel_arrangement', entityId: id, data: { code, kind: row.kind } });
  return { id, code };
}

/* ---------------- bookings ---------------- */

export interface BookingInput {
  id?: string | null; arrangementId: string; client: { name: string; phone?: string; email?: string; addr?: string }; partnerId?: string | null;
  adults?: number | null; children?: number | null; extra?: number | null; disc?: number | null; priceTot?: number | null;
  pax?: TravelBookingRow['pax']; room?: string | null; note?: string | null;
}

async function ownBooking(tx: Tx, firmId: string, id: string): Promise<TravelBookingRow> {
  const [b] = await tx.select().from(travelBookings).where(and(eq(travelBookings.id, id), eq(travelBookings.firmId, firmId))).for('update').limit(1);
  return b ?? fail('Пријавата не постои.');
}
async function ownArr(tx: Tx, firmId: string, id: string): Promise<TravelArrangementRow> {
  const [x] = await tx.select().from(travelArrangements).where(and(eq(travelArrangements.id, id), eq(travelArrangements.firmId, firmId))).limit(1);
  return x ?? fail('Аранжманот не постои.');
}

/** Legacy `tbSave`: holder name and phone required; returns a warning when the seats are exceeded. */
export async function saveBooking(tx: Tx, a: IndActor, b: BookingInput): Promise<{ id: string; number: string; warning?: string }> {
  await loadIndustryFirm(tx, a.firmId, MOD);
  const A = await ownArr(tx, a.firmId, b.arrangementId);
  const prev = b.id ? await ownBooking(tx, a.firmId, b.id) : null;
  if (prev?.invoiceId) fail('Пријавата е фактурирана.');
  if (!b.client.name?.trim()) fail('Внесете име на носителот.');
  if (!String(b.client.phone ?? '').replace(/\D/g, '')) fail('Внесете телефон за контакт.');
  const partnerId = await assertPartner(tx, a.firmId, b.partnerId);
  const row = {
    arrangementId: A.id, client: { ...b.client, name: b.client.name.trim() }, partnerId, adults: Math.max(0, Math.round(n(b.adults))), children: Math.max(0, Math.round(n(b.children))),
    extra: dec2(b.extra ?? null), disc: dec2(b.disc ?? null), priceTot: dec2(b.priceTot ?? null), pax: (b.pax ?? prev?.pax ?? []).filter((p) => p.name?.trim()),
    room: b.room?.trim() || null, note: b.note?.trim() || null,
  };
  let id: string, number: string;
  if (prev) { await tx.update(travelBookings).set(row).where(eq(travelBookings.id, prev.id)); id = prev.id; number = prev.number; }
  else {
    const y = new Date().getFullYear();
    number = nextModuleNumber('П-', (await tx.select({ c: travelBookings.number }).from(travelBookings).where(eq(travelBookings.firmId, a.firmId))).map((r) => r.c).filter((c) => c.endsWith('/' + y)), y);
    id = (await tx.insert(travelBookings).values({ ...row, firmId: a.firmId, number, date: new Date().toISOString().slice(0, 10) }).returning({ id: travelBookings.id }))[0]!.id;
  }
  let warning: string | undefined;
  if (A.seats) {
    const B = await tx.select().from(travelBookings).where(and(eq(travelBookings.arrangementId, A.id), ne(travelBookings.status, 'cancel')));
    const pax = B.reduce((s, x) => s + bookingPax(x), 0);
    if (pax > A.seats) warning = `Аранжманот има ${A.seats} места, со оваа пријава се ${pax}.`;
  }
  await audit(tx, { userId: a.userId, firmId: a.firmId, action: prev ? 'tbSave' : 'tbNew', entityType: 'travel_booking', entityId: id, data: { number, arrangement: A.code } });
  return { id, number, ...(warning ? { warning } : {}) };
}

async function bookingPartner(tx: Tx, a: IndActor, b: TravelBookingRow) {
  return b.partnerId ?? b.payPartnerId ?? findOrCreatePartner(tx, a.firmId, b.client.name, { address: b.client.addr, phone: b.client.phone, email: b.client.email });
}

/** Legacy `tbPay`: cash → receipt D register / P advances konto; bank / card → recorded only (booked from the statement). */
export async function addBookingPayment(tx: Tx, a: IndActor, id: string, p: { date: string; amt: number; how: 'cash' | 'bank' | 'card' }): Promise<string> {
  const f = await loadIndustryFirm(tx, a.firmId, MOD);
  const b = await ownBooking(tx, a.firmId, id);
  if (!(p.amt > 0)) fail('Внесете износ.');
  const pid = await bookingPartner(tx, a, b);
  const A = await ownArr(tx, a.firmId, b.arrangementId);
  let pay: BookingPayRow = { date: p.date, amt: Math.round(p.amt * 100) / 100, how: p.how };
  if (p.how === 'cash') {
    const v = await cashMovement(tx, a, { kind: 'in', date: p.date, amount: p.amt, konto: await advKonto(tx, f, firmTravelConfig(f)), partnerId: pid, merchant: b.client.name, note: `Уплата – пријава ${b.number} (${A.code})` });
    pay = { ...pay, voucherId: v.id, no: v.number };
  }
  await tx.update(travelBookings).set({ pays: [...b.pays, pay], payPartnerId: pid }).where(eq(travelBookings.id, id));
  await audit(tx, { userId: a.userId, firmId: a.firmId, action: 'tbPay', entityType: 'travel_booking', entityId: id, data: { amt: pay.amt, how: p.how } });
  return pay.no ?? '';
}

export async function removeBookingPayment(tx: Tx, a: IndActor, id: string, i: number): Promise<void> {
  await loadIndustryFirm(tx, a.firmId, MOD);
  const b = await ownBooking(tx, a.firmId, id);
  const p = b.pays[i] ?? fail('Уплатата не постои.');
  if (b.advanceSettled) fail('Авансот е пребиен со фактурата.');
  if (p.voucherId) await deleteVoucher(tx, { firmId: a.firmId, userId: a.userId, id: p.voucherId });
  await tx.update(travelBookings).set({ pays: b.pays.filter((_, k) => k !== i) }).where(eq(travelBookings.id, id));
  await audit(tx, { userId: a.userId, firmId: a.firmId, action: 'tbPayRm', entityType: 'travel_booking', entityId: id, data: { amt: p.amt } });
}

/** Legacy `tbInv`: own arrangement → margin-scheme invoice (`tourM` + `arrangementId`); intermediary → commission + pass-through. */
export async function invoiceBooking(tx: Tx, a: IndActor, id: string, date: string): Promise<{ id: string; number: string; warnings: string[] }> {
  const f = await loadIndustryFirm(tx, a.firmId, MOD);
  const b = await ownBooking(tx, a.firmId, id);
  if (b.invoiceId) fail('Пријавата е веќе фактурирана.');
  if (b.status === 'cancel') fail('Пријавата е откажана.');
  const A = await ownArr(tx, a.firmId, b.arrangementId);
  const I = bookingInvoice(b, { ...A, costs: A.costs }, firmTravelConfig(f), dmy);
  if (!I.lines.some((l) => l.price > 0)) fail('Цената е 0.');
  const partnerId = await bookingPartner(tx, a, b);
  const inv = await issueModuleInvoice(tx, a, {
    partnerId, date, lines: I.lines, note: `${I.note ? I.note + ' ' : ''}Пријава ${b.number} · ${b.client.name}`,
    data: { source: { type: 'travel_booking', id: b.id }, ...(I.tourM ? { tourM: true, arrangementId: A.id } : {}) },
  });
  await tx.update(travelBookings).set({ invoiceId: inv.id, payPartnerId: b.payPartnerId ?? partnerId }).where(eq(travelBookings.id, id));
  await audit(tx, { userId: a.userId, firmId: a.firmId, action: 'tbInv', entityType: 'travel_booking', entityId: id, data: { invoice: inv.number, tourM: I.tourM } });
  return inv;
}

/** Legacy `tbAdv`: offset the received advance against the invoice (journal `tadv`: D advances / P customer). */
export async function settleBookingAdvance(tx: Tx, a: IndActor, id: string, date: string): Promise<number> {
  const f = await loadIndustryFirm(tx, a.firmId, MOD);
  const b = await ownBooking(tx, a.firmId, id);
  if (!b.invoiceId) fail('Прво издадете фактура.');
  if (b.advanceSettled) fail('Авансот е веќе пребиен.');
  const [inv] = await tx.select().from(invoices).where(eq(invoices.id, b.invoiceId!)).limit(1);
  const amt = Math.round(Math.min(bookingPaid(b), n(inv?.total)) * 100) / 100;
  if (!(amt > 0)) fail('Нема што да се пребие.');
  const ctx = await firmPostingContext(tx, f);
  await postJournal(tx, {
    firmId: a.firmId, date, kind: 'tadv', sourceType: 'travel_advance', sourceId: b.id, userId: a.userId,
    description: `Пребивање аванс – пријава ${b.number} со фактура ${inv!.number}`,
    lines: [
      { account: await advKonto(tx, f, firmTravelConfig(f)), debit: amt, partnerId: b.payPartnerId ?? inv!.partnerId, note: `Аванс ${b.number}` },
      { account: schemeValue(ctx, 'customer'), credit: amt, partnerId: inv!.partnerId, note: 'Пребиено со аванс', doc: inv!.number },
    ],
  });
  await tx.update(travelBookings).set({ advanceSettled: dec2(amt) }).where(eq(travelBookings.id, id));
  await audit(tx, { userId: a.userId, firmId: a.firmId, action: 'tbAdv', entityType: 'travel_booking', entityId: id, data: { amt } });
  return amt;
}

export async function cancelBooking(tx: Tx, a: IndActor, id: string): Promise<void> {
  await loadIndustryFirm(tx, a.firmId, MOD);
  const b = await ownBooking(tx, a.firmId, id);
  if (b.invoiceId) fail('Пријавата е фактурирана – откажете ја со одобрение.');
  await tx.update(travelBookings).set({ status: 'cancel' }).where(eq(travelBookings.id, id));
  await audit(tx, { userId: a.userId, firmId: a.firmId, action: 'tbCancel', entityType: 'travel_booking', entityId: id, data: { number: b.number } });
}

/* ---------------- results and VAT ---------------- */

/** Arrangements with their bookings and results (legacy `taCalc` for the list and the reports). */
export async function arrangementsWithResults(tx: Tx, f: Firm) {
  const A = await tx.select().from(travelArrangements).where(eq(travelArrangements.firmId, f.id)).orderBy(asc(travelArrangements.from));
  const B = await tx.select().from(travelBookings).where(eq(travelBookings.firmId, f.id));
  const PT = await purchaseTotals(tx, f.id, A.flatMap((x) => x.costs.map((c) => c.purchaseId)).filter((p): p is string => !!p));
  const cfg = firmTravelConfig(f);
  return A.map((x) => {
    const bs = B.filter((b) => b.arrangementId === x.id);
    return { A: x, B: bs, R: arrangementResult({ ...x, costs: x.costs }, bs, (id) => PT.get(id), cfg, f.vatRegistered), V: arrangementVatTotals({ ...x, costs: x.costs }, bs, (id) => PT.get(id), cfg) };
  });
}

/**
 * The `travel` option of Phase 5 `ddvFor` / `vatBookOut` for this firm: `{ rev, cost, own }` of every own arrangement
 * and the margin basis. `documentsVatSource` attaches it whenever a period has margin-scheme invoices.
 */
export async function travelMarginInputs(tx: Tx, f: Firm): Promise<TravelMarginOptions> {
  const L = await arrangementsWithResults(tx, f);
  const arrangements: NonNullable<TravelMarginOptions['arrangements']> = {};
  for (const x of L) if (x.V) (arrangements as Record<string, typeof x.V>)[x.A.id] = x.V;
  return { arrangements, agg: firmTravelConfig(f).agg };
}

/**
 * Legacy `tuMarginFor` for one VAT period, from the same documents Phase 5 files (`documentsVatSource`: invoices with
 * `data.tourM` / `data.arrangementId` and the arrangement totals of {@link travelMarginInputs}).
 */
export async function travelMarginPeriod(tx: Tx, f: Firm, period: string) {
  const [a, b] = perRange(period);
  const ctx = await firmPostingContext(tx, f);
  const D = await documentsVatSource.load(tx, f, a, b, ctx);
  return travelMarginFor(D.docs.invoices ?? [], period, f.vatPeriod, ctx, D.travel ?? (await travelMarginInputs(tx, f)));
}

/** Legacy `tuVatPost`: VAT on the margin of a period — journal `tourVat`, D revenue / P output VAT 18%. */
export async function postTravelVat(tx: Tx, a: IndActor, period: string): Promise<number> {
  const f = await loadIndustryFirm(tx, a.firmId, MOD);
  const X = await travelMarginPeriod(tx, f, period);
  const vat = Math.round((X.vat + X.ownVat) * 100) / 100;
  if (!(vat > 0)) fail('Нема ДДВ на маржа за периодот.');
  const ctx = await firmPostingContext(tx, f);
  const out = vatAccount(ctx, 'out', 18) ?? fail('Нема конто за излезен ДДВ 18%.');
  const rev = firmTravelConfig(f).revK || schemeValue(ctx, 'revService');
  const [, d2] = perRange(period);
  await postJournal(tx, {
    firmId: a.firmId, date: d2, kind: 'tourVat', sourceType: 'travel_vat', sourceId: period, userId: a.userId,
    description: `ДДВ на маржа – туристички агенции (чл. 38 ЗДДВ) за ${period}`,
    lines: [{ account: rev, debit: vat, note: `ДДВ на маржа ${period}` }, { account: out, credit: vat, note: `ДДВ на маржа ${period}` }],
  });
  await audit(tx, { userId: a.userId, firmId: a.firmId, action: 'tuVatPost', entityType: 'travel_vat', entityId: period, data: { vat } });
  return vat;
}
