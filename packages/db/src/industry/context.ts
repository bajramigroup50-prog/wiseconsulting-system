/**
 * Shared plumbing of the Phase 10 industry services: module configuration in `firms.settings.industry`, the module
 * toggle, find-or-create partner (legacy `bzPartner`), issuing invoices through the Phase 3 invoice service (legacy
 * `bzInvDraft`) and cash receipts through the Phase 4 cash register (legacy `blgNew` + `save('docs', …)`).
 */
import { and, asc, eq, sql } from 'drizzle-orm';
import { schemeValue } from '@wise/core';
import { moduleOn, type ModuleInvoiceLine } from '@wise/core/industry';
import { audit, type Tx } from '../audit';
import { cashRegisters, firms, partners, type Firm } from '../schema/index';
import { DocumentError, firmPostingContext, loadFirmForUpdate, type DocActor } from '../sales/context';
import { saveInvoice, type InvoiceInput } from '../sales/invoices';
import { saveVoucher } from '../bank/cash';
import type { InvoiceData } from '../schema/sales';

/** Business-rule error of an industry module (shown to the user; extends the posting error like `DocumentError`). */
export class IndustryError extends DocumentError {
  constructor(message: string) {
    super(message);
    this.name = 'IndustryError';
  }
}

export interface IndActor extends DocActor { firmId: string }

/** Module config keys in `firms.settings.industry`. */
export type IndustryConfigKey = 'hotel' | 'rent' | 'travel' | 'cons' | 'appt' | 'transport' | 'frt';

export const industrySettings = (f: Pick<Firm, 'settings'>): Record<string, Record<string, unknown>> =>
  (((f.settings ?? {}) as Record<string, unknown>).industry ?? {}) as Record<string, Record<string, unknown>>;
export const industryConfigOf = <T>(f: Pick<Firm, 'settings'>, key: IndustryConfigKey): Partial<T> => (industrySettings(f)[key] ?? {}) as Partial<T>;

/** Replace one module's configuration (`firms.settings.industry.<key>`). */
export async function saveIndustryConfig(tx: Tx, a: IndActor, key: IndustryConfigKey, value: Record<string, unknown>): Promise<void> {
  await tx.update(firms).set({
    settings: sql`jsonb_set(coalesce(${firms.settings}, '{}'::jsonb), '{industry}', coalesce(${firms.settings}->'industry', '{}'::jsonb) || jsonb_build_object(${key}::text, ${JSON.stringify(value)}::jsonb))`,
  }).where(eq(firms.id, a.firmId));
  await audit(tx, { userId: a.userId, firmId: a.firmId, action: 'industryCfgSave', entityType: 'firm', entityId: a.firmId, data: { key } });
}

/** Set the enabled modules of a firm (legacy `saveFirmPatch({mods})`). */
export async function saveFirmModules(tx: Tx, a: IndActor, mods: string[]): Promise<void> {
  const [f] = await tx.select({ mods: firms.mods }).from(firms).where(eq(firms.id, a.firmId)).limit(1);
  await tx.update(firms).set({ mods }).where(eq(firms.id, a.firmId));
  await audit(tx, { userId: a.userId, firmId: a.firmId, action: 'modSave', entityType: 'firm', entityId: a.firmId, data: { before: f?.mods ?? [], after: mods } });
}

/** Services refuse to work for a firm whose module is switched off (the route is blocked too). */
export function assertModule(f: Pick<Firm, 'mods'>, k: string): void {
  if (!moduleOn(f.mods, k)) throw new IndustryError('Модулот не е вклучен за оваа фирма (Фирми → Модули по дејност).');
}

export async function loadIndustryFirm(tx: Tx, firmId: string, module?: string): Promise<Firm> {
  const f = await loadFirmForUpdate(tx, firmId);
  if (module) assertModule(f, module);
  return f;
}

/** Legacy `bzPartner`: partner by exact name (case-insensitive), created when missing. */
export async function findOrCreatePartner(tx: Tx, firmId: string, name: string, extra: { phone?: string | null; email?: string | null; address?: string | null } = {}): Promise<string> {
  const nm = name.trim();
  if (!nm) throw new IndustryError('Внесете име на комитентот.');
  const [ex] = await tx.select({ id: partners.id }).from(partners).where(and(eq(partners.firmId, firmId), sql`lower(trim(${partners.name})) = ${nm.toLowerCase()}`)).limit(1);
  if (ex) return ex.id;
  const [p] = await tx.insert(partners).values({
    firmId, name: nm, vatRegistered: false, phone: extra.phone?.trim() || null, email: extra.email?.trim() || null, address: extra.address?.trim() || null,
  }).returning({ id: partners.id });
  return p!.id;
}

export async function assertPartner(tx: Tx, firmId: string, id: string | null | undefined): Promise<string | null> {
  if (!id) return null;
  const [p] = await tx.select({ id: partners.id }).from(partners).where(and(eq(partners.id, id), eq(partners.firmId, firmId))).limit(1);
  if (!p) throw new IndustryError('Комитентот не постои во оваа фирма.');
  return p.id;
}

/**
 * Issue (or re-issue) an invoice through the Phase 3 service. Lines without a konto and item get the firm's
 * posting-scheme service revenue (FIX LEGACY-MAP 10.4 item 4: legacy wrote the literal '7400').
 */
export async function issueModuleInvoice(tx: Tx, a: IndActor, o: {
  id?: string | null; partnerId: string; date: string; lines: readonly ModuleInvoiceLine[]; note?: string; data?: InvoiceData;
  art32?: boolean; advance?: boolean; advances?: InvoiceInput['advances']; currency?: string; fx?: number | null;
}): Promise<{ id: string; number: string; warnings: string[] }> {
  const f = await loadFirmForUpdate(tx, a.firmId);
  const ctx = await firmPostingContext(tx, f);
  const rev = schemeValue(ctx, 'revService') || schemeValue(ctx, 'revDefault');
  const lines = o.lines.filter((l) => l.qty && (l.price || l.itemId)).map((l) => ({
    itemId: l.itemId || null, name: l.name, unit: l.unit ?? null, qty: l.qty, price: l.price, rate: l.rate, account: l.account || (l.itemId ? null : rev),
  }));
  if (!lines.length) throw new IndustryError('Нема ставки за фактурирање.');
  const r = await saveInvoice(tx, a.firmId, {
    id: o.id ?? null, kind: 'invoice', date: o.date, partnerId: o.partnerId, lines, note: o.note ?? null, data: o.data ?? {},
    art32: !!o.art32, advance: !!o.advance, advances: o.advances ?? [], currency: o.currency ?? 'MKD', fx: o.fx ?? null,
  }, a);
  return { id: r.id, number: r.number, warnings: r.warnings };
}

/** First MKD cash register of the firm (legacy `blgRegs().find(MKD) || blgRegs()[0]`). */
export async function defaultRegister(tx: Tx, firmId: string): Promise<{ id: string; name: string; konto: string }> {
  const R = await tx.select().from(cashRegisters).where(eq(cashRegisters.firmId, firmId)).orderBy(asc(cashRegisters.sort), asc(cashRegisters.createdAt));
  const reg = R.find((r) => r.cur === 'MKD') ?? R[0];
  if (!reg) throw new IndustryError('Фирмата нема благајна – креирајте ја во Финансово → Благајна.');
  return reg;
}

/** Cash receipt / payment in MKD through the Phase 4 cash register (posted D/P register ↔ `konto` with the partner). */
export async function cashMovement(tx: Tx, a: IndActor, o: { kind: 'in' | 'out'; date: string; amount: number; konto: string; partnerId: string | null; merchant?: string | null; note: string }) {
  const reg = await defaultRegister(tx, a.firmId);
  return saveVoucher(tx, {
    firmId: a.firmId, userId: a.userId,
    input: { registerId: reg.id, kind: o.kind, date: o.date, amt: o.amount, cur: 'MKD', fx: 1, country: 'MK', vatRate: 0, vat: null, cat: null, konto: o.konto, partnerId: o.partnerId, merchant: o.merchant ?? null, note: o.note },
  });
}

export const isoToday = () => new Date().toISOString().slice(0, 10);
export const n = (v: unknown) => Number(v) || 0;
export const dec2 = (v: number | null | undefined) => (v == null || Number.isNaN(v) ? null : (Math.round(v * 100) / 100).toFixed(2));
export const dmy = (d: string) => (d ? d.slice(0, 10).split('-').reverse().join('.') : '');
