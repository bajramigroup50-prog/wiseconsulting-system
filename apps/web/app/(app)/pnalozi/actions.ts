'use server';
/**
 * Legacy travel-order ACT (9337, 9417) and freight ACT (14498–14697). FIX LEGACY-MAP 10.4 item 1: every save goes to
 * `travel_orders` (legacy `pnSave` was the payroll-notes function and nothing persisted).
 */
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { and, eq } from 'drizzle-orm';
import { can, fxRate } from '@wise/core';
import { transportConfig, type TravelStop } from '@wise/core/industry';
import {
  deleteDoc, deleteFreightTour, deleteTravelOrder, firms, industryConfigOf, invoiceFreightTours, loadFxSources, postTravelCash, saveDoc, saveFreightTour,
  saveIndustryConfig, saveTravelOrder, stopsFrom, travelOrderEvent, travelOrders, travelReturnCredit, unassignedDocs, type FreightDoc,
} from '@wise/db';
import { requireCan, requireUser } from '@/lib/auth';
import { storeImageDataUrl } from '@/lib/data-url-file';
import { bankError } from '@/lib/bank';
import { db } from '@/lib/db';
import { indRun, num, nz, rows, str, today } from '@/lib/industry';
import type { FormState } from '@/components/bank-form';

const P = ['/pnalozi', '/pnGorivo', '/mojpn', '/blagajna', '/odobrenija', '/frTuri', '/frDnev', '/frDok', '/izlez'];

export async function saveTravelOrderAction(_p: FormState, f: FormData): Promise<FormState> {
  let id = '';
  const r = await indRun('pnSaveB', P, async ({ tx, a }) => {
    const stops: TravelStop[] = JSON.parse(str(f.get('stops')) || '[]');
    const drop = new Set(f.getAll('rm').map(Number));
    const kept = stops.filter((_, i) => !drop.has(i));
    const mp = str(f.get('mPartner'));
    if (mp) kept.push({ ref: null, kind: str(f.get('mKind')) === 'deliv' ? 'deliv' : 'pick', doc: 'Рачно', partner: mp, addr: str(f.get('mAddr')), goods: str(f.get('mGoods')) ? [{ name: str(f.get('mGoods')), qty: '' }] : [], status: 'open' });
    const x = await saveTravelOrder(tx, a, {
      id: str(f.get('id')) || null, date: str(f.get('date')), number: str(f.get('number')), vehicleId: str(f.get('veh')) || null, driverId: str(f.get('drv')) || null,
      codriver: str(f.get('codriver')), from: str(f.get('from')), purpose: str(f.get('purpose')), stops: kept, depKm: num(f.get('depKm')), retKm: num(f.get('retKm')),
      fuelL: num(f.get('fuelL')), fuelAmt: num(f.get('fuelAmt')), assigneeId: str(f.get('assignee')) || null, dnev: f.get('dnev') === 'on',
    });
    id = x.id;
    return `Патниот налог ${x.number} е зачуван.`;
  });
  if (r.error || str(f.get('id'))) return r;
  redirect(`/pnalozi?id=${id}`);
}

/** Legacy `pnFromDay`: a new order with every unassigned document of the day as a stop. */
export async function travelOrderFromDayAction(_p: FormState, f: FormData): Promise<FormState> {
  let id = '';
  const r = await indRun('pnFromDay', P, async ({ tx, a, firm }) => {
    const date = str(f.get('date')) || today();
    const cfg = transportConfig(industryConfigOf(firm, 'transport'));
    const U = await unassignedDocs(tx, a.firmId, date);
    if (!U.length) return 'Нема документи без патен налог.';
    const veh = str(f.get('veh')) || cfg.vehicleId, drv = str(f.get('drv')) || cfg.driverId;
    const x = await saveTravelOrder(tx, a, {
      date, vehicleId: veh || null, driverId: drv || null, from: cfg.from || [firm.address, firm.city].filter(Boolean).join(', '), purpose: 'Превоз на стока (преземање и испорака)',
      stops: await stopsFrom(tx, a.firmId, U.map((u) => ({ type: u.type, id: u.id }))), assigneeId: cfg.assignee || null, dnev: cfg.dnevOn,
    });
    id = x.id;
    return `Креиран е патен налог ${x.number}.`;
  });
  if (r.error || !id) return r;
  redirect(`/pnalozi?id=${id}`);
}

export async function travelOrderStepAction(id: string, step: 'cash' | 'del' | `ret${number}`): Promise<FormState> {
  return indRun(step === 'cash' ? 'pnCashPost' : step === 'del' ? 'pnlDel' : 'pnRetCr', P, async ({ tx, a, u, firm }) => {
    if (step === 'cash') return `Прокнижени ${await postTravelCash(tx, a, id)} уплатници во благајна.`;
    if (step === 'del') { await deleteTravelOrder(tx, a, id, can(u.principal, 'del', firm.id)); return 'Избришано.'; }
    return `Креирана е повратница ${await travelReturnCredit(tx, a, id, Number(step.slice(3)), today())} – стоката е вратена на залиха.`;
  });
}

/**
 * Departure / delivery / return — from the office (`write`) or by the assigned field user (`mojpn`, role `teren`).
 * The firm comes from the order; the user must be its assignee or have `write` on that firm.
 */
export async function travelEventAction(_p: FormState, f: FormData): Promise<FormState> {
  try {
    const u0 = await requireUser();
    const u = await requireCan(u0.role === 'teren' ? 'teren' : 'write');
    const id = str(f.get('id'));
    const [o] = await db().select({ firmId: travelOrders.firmId, assigneeId: travelOrders.assigneeId }).from(travelOrders).where(eq(travelOrders.id, id)).limit(1);
    if (!o) return { error: 'Патниот налог не постои.' };
    if (o.assigneeId !== u.id && !can(u.principal, 'write', o.firmId)) return { error: 'Немате дозвола за овој налог.' };
    const [fm] = await db().select().from(firms).where(and(eq(firms.id, o.firmId))).limit(1);
    if (!fm?.mods.includes('pn')) return { error: 'Модулот за патни налози не е вклучен за фирмата.' };
    const k = str(f.get('k'));
    const geo = num(f.get('lat')) != null && num(f.get('lon')) != null ? { lat: num(f.get('lat'))!, lon: num(f.get('lon'))! } : null;
    const at = new Date().toISOString();
    await db().transaction(async (tx) => {
      // Driver flow (legacy `pnDeliv`): signature and photo are stored as files and referenced from the stop.
      const sig = k === 'deliv' ? await storeImageDataUrl(tx, { firmId: o.firmId, userId: u.id, dataUrl: str(f.get('sig')), name: `potpis-${id.slice(0, 8)}-${f.get('i')}` }) : null;
      const photo = k === 'deliv' ? await storeImageDataUrl(tx, { firmId: o.firmId, userId: u.id, dataUrl: str(f.get('photo')), name: `isporaka-${id.slice(0, 8)}-${f.get('i')}` }) : null;
      await travelOrderEvent(tx, { firmId: o.firmId, userId: u.id, role: u.role }, id,
        k === 'dep' ? { k: 'dep', km: num(f.get('km')) }
          : k === 'deliv' ? { k: 'deliv', i: Number(f.get('i')), recv: str(f.get('recv')), cash: num(f.get('cash')) ?? 0, ret: rows(f, 'r', ['k', 'qty'], (r) => nz(r.qty) > 0).map((r) => ({ k: Number(r.k), qty: nz(r.qty) })), sig, photo }
            : { k: 'ret', km: num(f.get('km')), fuelL: num(f.get('fuelL')), fuelAmt: num(f.get('fuelAmt')) }, at, u.name, geo);
    });
  } catch (e) { return bankError(e); }
  for (const p of P) revalidatePath(p);
  return { ok: 'Забележано.' };
}

export async function saveTransportConfigAction(_p: FormState, f: FormData): Promise<FormState> {
  return indRun('pnDefsSave', P, async ({ tx, a }) => {
    await saveIndustryConfig(tx, a, 'transport', { vehicleId: str(f.get('veh')), driverId: str(f.get('drv')), assignee: str(f.get('assignee')), from: str(f.get('from')), dnevAmt: num(f.get('dnevAmt')) ?? '', dnevOn: f.get('dnevOn') === 'on' });
    return 'Зачувано.';
  });
}

/* ---------------- freight ---------------- */

export async function saveFreightAction(_p: FormState, f: FormData): Promise<FormState> {
  const r = await indRun('frSave', P, async ({ tx, a }) => {
    const s = (k: string) => str(f.get(k)) || null;
    await saveFreightTour(tx, a, {
      id: str(f.get('id')) || null, number: str(f.get('number')), date: str(f.get('date')), status: (str(f.get('status')) || 'plan') as 'plan', partnerId: s('partner'), orderNo: s('orderNo'),
      km: num(f.get('km')), vehicleId: s('veh'), trailer: s('trailer'), driverId: s('drv'), driver2Id: s('drv2'), loadPlace: s('loadPlace'), loadC: s('loadC'), sender: s('sender'),
      unloadDate: s('unloadDate'), unloadPlace: s('unloadPlace'), unloadC: s('unloadC'), consignee: s('consignee'), retDate: s('retDate'), goods: s('goods'), packages: s('packages'),
      kg: num(f.get('kg')), m3: num(f.get('m3')), adr: s('adr'), docsAtt: s('docsAtt'), price: num(f.get('price')), cur: str(f.get('cur')) || 'EUR', fx: num(f.get('fx')),
      vat: str(f.get('vat')) === 'dom' ? 'dom' : 'intl', red: num(f.get('red')) ?? 100, tolls: num(f.get('tolls')), tollCur: s('tollCur'), otherCost: num(f.get('otherCost')), note: s('note'),
      segs: rows(f, 'g', ['c', 'in', 'out', 'units'], (g) => !!g.c).map((g) => ({ c: g.c, in: g.in, out: g.out, units: g.units === '' ? null : nz(g.units) })),
    });
    return 'Турата е зачувана.';
  });
  if (r.error) return r;
  redirect('/frTuri');
}

export async function deleteFreightAction(id: string): Promise<FormState> {
  return indRun('frDel', P, async ({ tx, a }) => { await deleteFreightTour(tx, a, id); return 'Избришано.'; });
}

export async function invoiceFreightAction(_p: FormState, f: FormData): Promise<FormState> {
  return indRun('frInv', P, async ({ tx, a }) => {
    const fx = await loadFxSources(tx, a.firmId);
    const inv = await invoiceFreightTours(tx, a, f.getAll('sel').map(String), today(), async (c, d) => fxRate(c, d, fx));
    return `Издадена е фактура ${inv.number}.`;
  });
}

export async function saveFreightDocAction(_p: FormState, f: FormData): Promise<FormState> {
  return indRun('frDocSave', P, async ({ tx, a }) => {
    const who = str(f.get('who')) === 'drv' ? 'drv' : 'veh';
    if (!str(f.get('ref'))) return 'Изберете возило / возач.';
    await saveDoc<FreightDoc>(tx, a, 'frdoc', { id: str(f.get('id')) || null, date: str(f.get('validTo')) || null, data: { who, ref: str(f.get('ref')), kind: str(f.get('kind')), no: str(f.get('no')), validFrom: str(f.get('validFrom')) || null, validTo: str(f.get('validTo')) || null, note: str(f.get('note')) } });
    return 'Документот е зачуван.';
  });
}
export async function deleteFreightDocAction(id: string): Promise<FormState> {
  return indRun('frDocDel', P, async ({ tx, a }) => { await deleteDoc(tx, a, 'frdoc', id); return 'Избришано.'; });
}

export async function saveFreightRatesAction(_p: FormState, f: FormData): Promise<FormState> {
  return indRun('frCfgSave', P, async ({ tx, a }) => {
    const rates: Record<string, [number, string]> = {};
    for (const [k, v] of f.entries()) if (k.startsWith('rate.') && nz(String(v)) > 0) rates[k.slice(5)] = [nz(String(v)), str(f.get('cur.' + k.slice(5))) || 'EUR'];
    await saveIndustryConfig(tx, a, 'frt', { rates });
    return 'Износите се зачувани.';
  });
}
