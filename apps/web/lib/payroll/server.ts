import 'server-only';
/**
 * Shared server helpers for the Phase 6 payroll & HR pages and actions.
 * Guards: the payroll views are not in the klient/teren menus, so every payroll action also requires that the
 * role may open `plati` (legacy blocked klient through its click-dispatcher regex; `klient` has `write`).
 */
import { notFound } from 'next/navigation';
import { and, asc, eq, isNull, like, or } from 'drizzle-orm';
import {
  codes, employees, loadPayOverrides, loadRun, payrollRuns, loadPayScheme, loadPaySettings, PayrollError, PostingError, type Employee, type Firm, type Tx,
} from '@wise/db';
import { psifCodes, type MpinTemplate, type PayOrderSettings, type PsifCode } from '@wise/core';
import { Forbidden, requireUser, type SessionUser } from '../auth';
import { actionError, booksPage, firmAction, type ActionState } from '../books';
import { db } from '../db';
import { viewAllowed } from '../nav';

export async function payPage(view: string) {
  return booksPage(view);
}

/** Server-action guard for payroll/HR: current firm, `requireCan(action, firm)`, and a role that may use payroll. */
export async function payAction(action: string): Promise<{ u: SessionUser; firm: Firm; year: number }> {
  const u0 = await requireUser();
  if (!viewAllowed(u0.role, 'plati')) throw new Forbidden(action);
  return firmAction(action);
}

/** Route-handler variant of `payAction`: a plain-text error response instead of throwing. */
export async function payRoute(action: string): Promise<{ u: SessionUser; firm: Firm } | Response> {
  try {
    const { u, firm } = await payAction(action);
    return { u, firm };
  } catch (e) {
    if (e instanceof Forbidden) return new Response(e.message, { status: 403, headers: { 'content-type': 'text/plain; charset=utf-8' } });
    if (e instanceof Error && e.message === 'Изберете фирма.') return new Response(e.message, { status: 400, headers: { 'content-type': 'text/plain; charset=utf-8' } });
    throw e;
  }
}

/** Map payroll/posting/permission errors to form state. */
export function payError(e: unknown): ActionState {
  if (e instanceof PayrollError) return { error: e.message };
  if (e instanceof PostingError || e instanceof Forbidden) return { error: e.message };
  const cause = (e as { cause?: { code?: string } })?.cause;
  if (cause?.code === '23505') return { error: 'Записот веќе постои (дупликат ЕМБГ или деловоден број).' };
  if (e instanceof Error && /Payroll params missing/.test(e.message)) return { error: 'Недостасуваат параметри за плата: ' + e.message };
  return actionError(e);
}

/** Firm details used on payroll documents (legacy firm fields `bank`, `bankName`, `signer`, `nkd`, `opstina`). */
export interface PayFirmInfo {
  id: string;
  name: string;
  address: string;
  city: string;
  edb: string;
  embs: string;
  activity: string;
  bankAccount: string;
  bankName: string;
  signer: string;
  signerRole: string;
  opstina: string;
  email: string;
}

export function payFirmInfo(f: Firm, orders: Record<string, unknown> = {}): PayFirmInfo {
  const s = (f.settings ?? {}) as Record<string, unknown>;
  const str = (...v: unknown[]) => String(v.find((x) => x != null && x !== '') ?? '');
  return {
    id: f.id, name: f.name, address: f.address ?? '', city: f.city ?? '', edb: f.edb ?? '', embs: f.embs ?? '', email: f.email ?? '',
    activity: str(s.nkd, f.activity),
    bankAccount: str(orders.payerAcc, s.bank),
    bankName: str(orders.payerBank, s.bankName),
    signer: str(orders.signer, s.signer, [s.ro_first, s.ro_last].filter(Boolean).join(' '), s.manager),
    signerRole: str(orders.signerRole, s.signerRole, 'Управител'),
    opstina: str(orders.opstina, s.opstina),
  };
}

export interface PayCtx {
  firm: PayFirmInfo;
  overrides: Awaited<ReturnType<typeof loadPayOverrides>>;
  scheme: Awaited<ReturnType<typeof loadPayScheme>>;
  settings: Awaited<ReturnType<typeof loadPaySettings>>;
  orders: PayOrderSettings & Record<string, unknown>;
  template: MpinTemplate | null;
  psif: PsifCode[];
}

/** Everything payroll calculations of a firm need. */
export async function payCtx(f: Firm, tx: Tx = db()): Promise<PayCtx> {
  const [overrides, scheme, settings, cb] = await Promise.all([
    loadPayOverrides(tx, f.id), loadPayScheme(tx, f), loadPaySettings(tx, f.id),
    tx.select().from(codes).where(and(eq(codes.cb, 'paysif'), or(isNull(codes.firmId), eq(codes.firmId, f.id)))),
  ]);
  const orders = (settings.orders ?? {}) as PayOrderSettings & Record<string, unknown>;
  return {
    firm: payFirmInfo(f, orders), overrides, scheme, settings, orders,
    template: (settings.mpinTemplate as MpinTemplate | null) ?? null,
    psif: psifCodes(cb.map((c) => ({ code: c.code ?? '', name: c.name, ...(c.data as Record<string, string>) }))),
  };
}

export async function firmEmployees(firmId: string, tx: Tx = db()): Promise<Employee[]> {
  return tx.select().from(employees).where(eq(employees.firmId, firmId)).orderBy(asc(employees.no), asc(employees.name));
}

/** Employee in the shape `@wise/core` functions take. */
export const coreEmp = (e: Employee) => ({
  id: e.id, no: e.no ?? '', name: e.name, embg: e.embg ?? '', netBase: Number(e.netBase), coef: Number(e.coef),
  start: e.start ?? undefined, end: e.end ?? undefined, stazPrev: e.stazPrev ?? undefined, stazY: e.stazY ?? undefined,
  hNorm: e.hNorm ?? undefined, active: e.active, city: e.city ?? '', address: e.address ?? '', mpOps: e.mpOps ?? '',
  mpZan: e.mpZan ?? '', mpC26: e.mpC26 ?? '', bankAcc: e.bankAcc ?? '', bank: e.bank ?? '', email: e.email ?? '',
  position: e.position ?? '', oe: e.oe ?? '',
});

/** All runs of a business year with employees and lines (reports: annual, М4). */
export async function yearRuns(firmId: string, year: number) {
  const R = await db().select({ id: payrollRuns.id }).from(payrollRuns)
    .where(and(eq(payrollRuns.firmId, firmId), like(payrollRuns.month, `${year}-%`))).orderBy(asc(payrollRuns.month));
  const out = [];
  for (const r of R) { const x = await loadRun(db(), firmId, { id: r.id }); if (x) out.push(x); }
  return out;
}

export const isMonth =(m: string | undefined): m is string => !!m && /^\d{4}-(0[1-9]|1[0-2])$/.test(m);
export const monthOr404 = (m: string): string => (isMonth(m) ? m : notFound());
