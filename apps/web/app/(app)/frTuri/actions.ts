'use server';
/**
 * Freight parity actions (legacy 14498–14706): delete a tour (`del` right, legacy `frDel`), invoice from the selected
 * tours (`frInv` + `saveInv` patch), quick add of a vehicle / trailer / driver (`frQuickSave`), licences and documents
 * (`frDocSave` / `frDocDel` + Excel import), per-diem amounts per country (`frCfgSave`).
 */
import { redirect } from 'next/navigation';
import { fxRate } from '@wise/core';
import {
  deleteFreightDocParity, deleteFreightTour, importFreightDocs, invoiceFreightToursParity, loadFxSources, quickFreightDriver, quickFreightVehicle,
  saveFreightDocParity, saveFreightRatesParity,
} from '@wise/db';
import { indRun, str, today } from '@/lib/industry';
import type { FormState } from '@/components/bank-form';

const P = ['/frTuri', '/frFak', '/frDnev', '/frDok', '/frGor', '/izlez', '/flota', '/vraboteni'];

export async function frDeleteTourAction(id: string): Promise<FormState> {
  const r = await indRun('del', P, async ({ tx, a }) => { await deleteFreightTour(tx, a, id); return 'Турата е избришана.'; });
  if (r.error) return r;
  redirect('/frTuri');
}

/** „🧾 Фактурирај избрани“: one invoice, then the invoice editor opens for review (legacy opened the draft in Излезни фактури). */
export async function frInvoiceAction(_p: FormState, f: FormData): Promise<FormState> {
  let id = '';
  const r = await indRun('frInv', P, async ({ tx, a }) => {
    const fx = await loadFxSources(tx, a.firmId);
    const inv = await invoiceFreightToursParity(tx, a, f.getAll('sel').map(String), today(), (c, d) => { try { return fxRate(c, d, fx) || 0; } catch { return 0; } });
    id = inv.id;
    return `Нацрт-фактура од ${inv.tours} тури – проверете и зачувајте.`;
  });
  if (r.error || !id) return r;
  redirect(`/izlez?edit=${id}`);
}

export interface QuickState extends FormState { id?: string; label?: string; plate?: string; k?: string }

/** Legacy `frQuickSave`: `k` = veh | trl | drv. */
export async function frQuickAction(_p: QuickState, f: FormData): Promise<QuickState> {
  const k = str(f.get('k'));
  let out: QuickState = {};
  const r = await indRun('frQuickSave', P, async ({ tx, a }) => {
    if (k === 'drv') {
      const d = await quickFreightDriver(tx, a, { name: str(f.get('name')), embg: str(f.get('embg')), license: str(f.get('license')), start: today() });
      out = { id: d.id, label: d.name, k };
    } else {
      const v = await quickFreightVehicle(tx, a, { trailer: k === 'trl', plate: str(f.get('plate')), name: str(f.get('name')) });
      out = { id: v.id, label: v.plate + ' ' + v.name, plate: v.plate, k };
    }
    return 'Зачувано.';
  });
  return r.error ? r : { ...r, ...out };
}

export async function frDocSaveAction(_p: FormState, f: FormData): Promise<FormState> {
  const r = await indRun('frDocSave', P, async ({ tx, a }) => {
    await saveFreightDocParity(tx, a, str(f.get('id')) || null, {
      who: str(f.get('who')) === 'drv' ? 'drv' : 'veh', ref: str(f.get('ref')), kind: str(f.get('kind')), no: str(f.get('no')),
      validFrom: str(f.get('validFrom')) || null, validTo: str(f.get('validTo')) || null, note: str(f.get('note')),
    });
    return 'Документот е зачуван.';
  });
  if (r.error) return r;
  redirect('/frDok');
}

export async function frDocDeleteAction(id: string): Promise<FormState> {
  return indRun('del', P, async ({ tx, a }) => { await deleteFreightDocParity(tx, a, id); return 'Избришано.'; });
}

export async function frDocImportAction(_p: FormState, f: FormData): Promise<FormState> {
  return indRun('frDocSave', P, async ({ tx, a }) => {
    let rows: unknown;
    try { rows = JSON.parse(str(f.get('rows')) || '[]'); } catch { rows = []; }
    const R = (Array.isArray(rows) ? rows : []).map((r) => (Array.isArray(r) ? r.map((x) => String(x ?? '')) : []));
    return `Увезени ${await importFreightDocs(tx, a, R)} документи.`;
  });
}

export async function frRatesAction(_p: FormState, f: FormData): Promise<FormState> {
  const r = await indRun('frCfgSave', P, async ({ tx, a }) => {
    const E: [string, string][] = [];
    for (const [k, v] of f.entries()) if (k.startsWith('rate.')) E.push([k.slice(5), String(v)]);
    await saveFreightRatesParity(tx, a, E);
    return 'Износите се зачувани.';
  });
  if (r.error) return r;
  redirect('/frDnev');
}
