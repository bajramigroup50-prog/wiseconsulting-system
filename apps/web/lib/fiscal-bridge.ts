/**
 * The fiscal device bridge of the WISE desktop app (`window.wiseFiscal`, desktop/preload.js). In a normal browser it
 * does not exist: the fiscal buttons then explain that a fiscal device works only in the desktop app.
 * Client-side only (no server imports).
 */
import type { FiscalReceipt, FiscalResult } from '@wise/core/retail/fiscal';
import type { VatGroup } from '@wise/core/retail/vat-groups';

/** VAT rates the device reported (X report / status) and whether they differ from „Даночни групи на апаратот“. */
export interface FiscalRates { rates?: Partial<Record<VatGroup, number>>; vatMismatch?: boolean; warnings?: string[] }

export interface FiscalStatus extends FiscalResult, FiscalRates {
  available?: boolean; configured?: boolean; connected?: boolean; fiscal?: boolean; receiptOpen?: boolean;
  errors?: string[]; warnings?: string[]; serial?: string; firmware?: string;
}
export interface FiscalConfig {
  vendor: string; model: string; driver: string; port: string; baud: number; host: string; tcpPort: number;
  folder: string; exePath: string; op: number; pwd: string; till: number; fault: string;
  /** „Даночни групи на апаратот“: letter → VAT rate as programmed in the device (default the legal А 18, Б 5, В 10, Г 0). */
  groups?: Record<VatGroup, number>;
}
export interface FiscalConfigResult { ok: boolean; config?: FiscalConfig; configured?: boolean; code?: string; error?: string }
export interface FiscalInfo {
  ok: boolean; version?: string;
  vendors: Record<string, { label: string; models: string[]; drivers: string[]; nameMax: number; baud: number }>;
  drivers: Record<string, string>;
  vatGroups?: Record<VatGroup, number>; vatGroupsOld?: Record<VatGroup, number>;
}

/** The API the desktop preload exposes (version 1). */
export interface WiseFiscal {
  version: number;
  info(): Promise<FiscalInfo>;
  status(): Promise<FiscalStatus>;
  printReceipt(r: FiscalReceipt): Promise<FiscalResult>;
  printStorno(r: FiscalReceipt): Promise<FiscalResult>;
  xReport(): Promise<FiscalResult & FiscalRates>;
  zReport(): Promise<FiscalResult>;
  cash(amount: number): Promise<FiscalResult & { cashSum?: number }>;
  lastReceipt(): Promise<FiscalResult>;
  test(): Promise<FiscalResult>;
  getConfig(): Promise<FiscalConfigResult>;
  setConfig(c: Partial<FiscalConfig>): Promise<FiscalConfigResult>;
  listPorts(): Promise<{ ok: boolean; ports: { path: string; name: string }[]; code?: string }>;
  pickFolder(): Promise<FiscalConfigResult>;
  pickExe(): Promise<FiscalConfigResult>;
}

export const DESKTOP_ONLY = 'Фискалниот апарат работи само во WISE десктоп апликацијата (инсталирана на компјутерот на касата). Во прелистувач продажбата се евидентира без фискална сметка.';

/** The bridge if this page runs inside the WISE desktop app, else null. `w` = window (tests pass a fake). */
export function fiscalBridge(w: unknown = typeof window === 'undefined' ? undefined : window): WiseFiscal | null {
  const f = (w as { wiseFiscal?: Partial<WiseFiscal> } | undefined)?.wiseFiscal;
  if (!f || typeof f !== 'object' || typeof f.version !== 'number' || f.version < 1) return null;
  if (typeof f.printReceipt !== 'function' || typeof f.status !== 'function') return null;
  return f as WiseFiscal;
}

/** A failed bridge call (IPC error, crash) as a device result, so the caller always gets { ok, error }. */
export async function safeCall<T extends FiscalResult>(p: () => Promise<T>): Promise<T | FiscalResult> {
  try {
    const r = await p();
    return r && typeof r === 'object' ? r : { ok: false, code: 'DEVICE_ERROR', error: 'Фискалниот апарат не врати одговор.' };
  } catch (e) {
    return { ok: false, code: 'DEVICE_ERROR', error: e instanceof Error ? e.message : 'Грешка во врската со фискалниот апарат.' };
  }
}
